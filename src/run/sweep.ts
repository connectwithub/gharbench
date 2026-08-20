/**
 * The sweep runner: scenarios x trials x contestants (`pnpm sweep`).
 *
 *   pnpm sweep --contestant=anthropic/claude-haiku-4-5 \
 *              --buyer=openai/gpt-4.1-mini \
 *              [--contestant=... more] [--scenarios=public|all|id,id,...]
 *              [--trials=1] [--concurrency=4] [--max-usd=X] [--dry-run]
 *
 * Costs real money. Every conversation gets a fresh DB clone, its own sim
 * clock and its own cost meter; records land in one runs/<runId>/ tree with
 * transcripts.jsonl, sweep-manifest.json and costs.json. Conversations run
 * concurrently under p-limit, but the written output is sorted so two sweeps
 * over the same set produce comparable files regardless of completion order.
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import pLimit from 'p-limit';

import { ProviderModelContestant, buildAgentSystemPrompt } from '../contestants/providerModel.js';
import { Orchestrator, createEnvironment } from '../engine/orchestrator.js';
import type { ScenarioConfig } from '../engine/scenario.js';
import { SimClock, resetDb, sha256 } from '../env/db.js';
import {
  TRACKED_PACKAGES,
  collectGitInfo,
  collectPackageVersions,
  makeRunId,
  nodeInfo,
} from '../logging/manifest.js';
import { TranscriptWriter } from '../logging/transcript.js';
import { resolveModel } from '../providers/registry.js';
import { ModelBuyer, buildBuyerSystemPrompt } from '../simulator/buyer.js';
import { CostMeter, type CostSummary } from '../telemetry/cost.js';
import { checkRun } from './checksRun.js';
import { REPO_ROOT, loadScenarioSet, type ScenarioSet } from './scenarioSet.js';

export interface SweepOptions {
  contestants: string[];
  buyer: string;
  scenarios: 'public' | 'all' | string[];
  trials: number;
  concurrency: number;
  maxUsd?: number;
  dryRun: boolean;
}

export function parseSweepArgs(argv: readonly string[]): SweepOptions {
  const contestants: string[] = [];
  let buyer = '';
  let scenarios: SweepOptions['scenarios'] = 'public';
  let trials = 1;
  let concurrency = 4;
  let maxUsd: number | undefined;
  let dryRun = false;

  for (const arg of argv) {
    const [flag, value = ''] = arg.split(/=(.*)/s, 2);
    switch (flag) {
      case '--contestant':
        if (value) contestants.push(value);
        break;
      case '--buyer':
        buyer = value;
        break;
      case '--scenarios':
        scenarios =
          value === 'public' || value === 'all' ? value : value.split(',').filter(Boolean);
        break;
      case '--trials':
        trials = Math.max(1, Number.parseInt(value, 10) || 1);
        break;
      case '--concurrency':
        concurrency = Math.max(1, Number.parseInt(value, 10) || 4);
        break;
      case '--max-usd':
        maxUsd = Number.parseFloat(value);
        break;
      case '--dry-run':
        dryRun = true;
        break;
      default:
        throw new Error(`Unknown sweep argument: ${arg}`);
    }
  }

  if (contestants.length === 0)
    throw new Error('At least one --contestant=<provider/model> is required.');
  if (!buyer) throw new Error('--buyer=<provider/model> is required (the buyer simulator model).');
  return {
    contestants,
    buyer,
    scenarios,
    trials,
    concurrency,
    ...(maxUsd !== undefined ? { maxUsd } : {}),
    dryRun,
  };
}

export function selectScenarios(
  set: ScenarioSet,
  selection: SweepOptions['scenarios'],
): ScenarioConfig[] {
  if (selection === 'all') return set.scenarios;
  if (selection === 'public') return set.scenarios.filter((s) => s.pool === 'public');
  const wanted = new Set(selection);
  const picked = set.scenarios.filter((s) => wanted.has(s.scenarioId));
  const missing = [...wanted].filter((id) => !picked.some((s) => s.scenarioId === id));
  if (missing.length > 0) throw new Error(`Unknown scenario ids: ${missing.join(', ')}`);
  return picked;
}

interface Job {
  contestantRef: string;
  scenario: ScenarioConfig;
  trial: number;
}

async function main(): Promise<void> {
  const options = parseSweepArgs(process.argv.slice(2));
  const set = loadScenarioSet();
  const scenarios = selectScenarios(set, options.scenarios);

  // Family-separation hygiene (6.1): the buyer simulator should not share a
  // provider family with any contestant. A pilot may accept this; a paper
  // run must not, so it is loud.
  const buyerProvider = options.buyer.split('/')[0];
  for (const c of options.contestants) {
    if (c.split('/')[0] === buyerProvider) {
      console.warn(
        `WARN family separation: buyer ${options.buyer} shares a provider with contestant ${c}`,
      );
    }
  }

  const jobs: Job[] = [];
  for (const contestantRef of [...options.contestants].sort()) {
    for (const scenario of scenarios) {
      for (let trial = 0; trial < options.trials; trial += 1) {
        jobs.push({ contestantRef, scenario, trial });
      }
    }
  }

  console.log(
    `sweep plan: ${options.contestants.length} contestant(s) x ${scenarios.length} scenario(s) x ${options.trials} trial(s) = ${jobs.length} conversations` +
      ` (buyer: ${options.buyer}, concurrency ${options.concurrency}${options.maxUsd !== undefined ? `, budget $${options.maxUsd}` : ''})`,
  );
  if (!set.privatePoolLoaded && options.scenarios === 'all') {
    console.warn(
      'WARN --scenarios=all requested but the private pool is not present on this machine.',
    );
  }
  if (options.dryRun) {
    for (const job of jobs)
      console.log(`  ${job.contestantRef} :: ${job.scenario.scenarioId} #${job.trial}`);
    console.log('dry run - no API calls made.');
    return;
  }

  const runId = makeRunId('sweep');
  const runDir = join(REPO_ROOT, 'runs', runId);
  mkdirSync(runDir, { recursive: true });

  const limit = pLimit(options.concurrency);
  let spentUsd = 0;
  let aborted = false;

  const results = await Promise.all(
    jobs.map((job) =>
      limit(async () => {
        if (aborted) return null;

        const persona = set.personas.get(job.scenario.personaId);
        if (!persona) throw new Error(`persona ${job.scenario.personaId} missing`);

        const db = resetDb(set.corpus);
        const clock = new SimClock(job.scenario.clock);
        const costMeter = new CostMeter();

        const orchestrator = new Orchestrator({
          contestant: new ProviderModelContestant({
            modelRef: job.contestantRef,
            scenario: job.scenario,
            costMeter,
            clock,
          }),
          buyer: new ModelBuyer({
            persona,
            scenario: job.scenario,
            modelRef: options.buyer,
            costMeter,
            clock,
            // Thinking buyers (qwen3-32b) spend reasoning tokens inside the
            // output budget; the default 300 truncates the surface reply to a
            // fragment. The surface stays terse - the prompt controls style,
            // this cap is only the runaway bound.
            maxOutputTokens: 1000,
          }),
          environment: createEnvironment(db, clock),
          scenario: job.scenario,
          runIndex: job.trial,
        });

        const record = await orchestrator.run();
        const summary = costMeter.summary();
        spentUsd += summary.totalUsd;
        console.log(
          `done ${job.contestantRef} :: ${record.conversationId} -> ${record.terminationReason.kind}` +
            ` ($${summary.totalUsd.toFixed(4)}, ${summary.totalTokens} tokens, running $${spentUsd.toFixed(2)})`,
        );
        if (options.maxUsd !== undefined && spentUsd >= options.maxUsd && !aborted) {
          aborted = true;
          console.warn(
            `BUDGET: $${spentUsd.toFixed(2)} >= $${options.maxUsd}; skipping remaining conversations.`,
          );
        }
        return { job, record, summary };
      }),
    ),
  );

  const completed = results.filter((r): r is NonNullable<typeof r> => r !== null);
  completed.sort((a, b) =>
    `${a.job.contestantRef}|${a.record.conversationId}` <
    `${b.job.contestantRef}|${b.record.conversationId}`
      ? -1
      : 1,
  );

  const transcripts = new TranscriptWriter(runDir);
  for (const r of completed) transcripts.append(r.record);

  const aggregate = completed.reduce(
    (acc, r) => {
      acc.calls += r.summary.calls;
      acc.totalTokens += r.summary.totalTokens;
      acc.totalUsd += r.summary.totalUsd;
      acc.unpricedCalls += r.summary.unpricedCalls;
      acc.cacheHits += r.summary.cacheHits;
      return acc;
    },
    { calls: 0, totalTokens: 0, totalUsd: 0, unpricedCalls: 0, cacheHits: 0 },
  );

  writeFileSync(
    join(runDir, 'costs.json'),
    JSON.stringify(
      {
        aggregate,
        perConversation: completed.map((r) => ({
          contestant: r.job.contestantRef,
          conversationId: r.record.conversationId,
          summary: r.summary satisfies CostSummary,
        })),
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(runDir, 'sweep-manifest.json'),
    JSON.stringify(
      {
        runId,
        kind: 'sweep',
        git: collectGitInfo(REPO_ROOT),
        node: nodeInfo(),
        packages: collectPackageVersions(TRACKED_PACKAGES),
        corpus: { dbVersion: set.corpus.dbVersion },
        buyer: describeModel(options.buyer),
        contestants: [...options.contestants].sort().map(describeModel),
        trials: options.trials,
        concurrency: options.concurrency,
        budgetUsd: options.maxUsd ?? null,
        abortedOnBudget: aborted,
        plannedConversations: jobs.length,
        completedConversations: completed.length,
        scenarios: scenarios.map((s) => {
          const persona = set.personas.get(s.personaId);
          return {
            scenarioId: s.scenarioId,
            version: s.version,
            pool: s.pool,
            seed: s.seed,
            personaId: s.personaId,
            personaVersion: persona?.version ?? 'unknown',
            agentPromptSha256: sha256(buildAgentSystemPrompt(s)),
            buyerPromptSha256: persona ? sha256(buildBuyerSystemPrompt(persona, s)) : 'unknown',
          };
        }),
      },
      null,
      2,
    ),
  );

  console.log(
    `\nsweep ${runId}: ${completed.length}/${jobs.length} conversations, $${aggregate.totalUsd.toFixed(4)}, ` +
      `${aggregate.totalTokens} tokens, ${aggregate.cacheHits} cache hits, ${aggregate.unpricedCalls} unpriced calls`,
  );

  // Layer-1 checks run right away: every sweep leaves with its transcripts
  // already scored. A checker crash must not lose the paid-for transcripts,
  // so it degrades to a warning.
  try {
    const { reports } = checkRun(runId);
    const checkFails = reports.reduce((a, r) => a + r.results.filter((x) => !x.passed).length, 0);
    const gated = reports.filter((r) => r.gatesJudging).length;
    console.log(
      `layer-1 checks: ${reports.length} conversation(s) scored, ${checkFails} check fail(s), ${gated} judge-gated -> checks.jsonl`,
    );
  } catch (cause) {
    console.warn(
      `WARN layer-1 checks failed to run: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  console.log(
    `outputs: runs/${runId}/{transcripts.jsonl, sweep-manifest.json, costs.json, checks.jsonl}`,
  );
}

function describeModel(ref: string): Record<string, unknown> {
  const resolved = resolveModel(ref, process.env);
  return {
    requestedRef: resolved.requestedRef,
    resolvedRef: resolved.ref,
    modelId: resolved.modelId,
    pinned: resolved.pinned,
    routingPin: resolved.routingPin ?? null,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
