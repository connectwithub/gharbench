/**
 * Optional live smoke: the same scenario against a real (cheap) model, plus a
 * prompt-cache billing check.
 *
 *   pnpm smoke:live --model=anthropic/claude-haiku-4-5
 *
 * The cache check is the point of this script as much as the conversation is.
 * Cache-first prompt layout is a load-bearing cost decision for a benchmark
 * that will run tens of thousands of conversations, and "we set cacheControl"
 * is not evidence. Two byte-identical calls are: the second one must report
 * non-zero cache-read tokens, or the layout is wrong and every sweep is paying
 * full price for a prefix it thinks is cached.
 */

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateText } from 'ai';

import { ProviderModelContestant } from '../contestants/providerModel.js';
import {
  Orchestrator,
  createEnvironment,
  type ConversationRecord,
} from '../engine/orchestrator.js';
import { SimClock, resetDb, sha256 } from '../env/db.js';
import {
  collectGitInfo,
  collectPackageVersions,
  makeRunId,
  nodeInfo,
  writeManifest,
  TRACKED_PACKAGES,
  type RunManifest,
} from '../logging/manifest.js';
import { TranscriptWriter } from '../logging/transcript.js';
import { ModelBuyer } from '../simulator/buyer.js';
import { CostMeter, isPriceKnown, normaliseUsage } from '../telemetry/cost.js';
import {
  cacheCallOptions,
  parseModelRef,
  providerEndpoint,
  resolveModel,
} from '../providers/registry.js';
import { RUNS_DIR, loadFixtures } from './smoke.js';

interface LiveArgs {
  contestantModel: string;
  buyerModel: string;
  skipCacheCheck: boolean;
  forceCacheCheck: boolean;
  maxSteps: number | undefined;
}

function parseArgs(argv: readonly string[]): LiveArgs {
  let contestantModel: string | undefined;
  let buyerModel: string | undefined;
  let skipCacheCheck = false;
  let forceCacheCheck = false;
  let maxSteps: number | undefined;

  for (const arg of argv) {
    const model = /^--model=(.+)$/.exec(arg);
    if (model?.[1]) contestantModel = model[1];
    const buyer = /^--buyer-model=(.+)$/.exec(arg);
    if (buyer?.[1]) buyerModel = buyer[1];
    const steps = /^--max-steps=(\d+)$/.exec(arg);
    if (steps?.[1]) maxSteps = Number.parseInt(steps[1], 10);
    if (arg === '--no-cache-check') skipCacheCheck = true;
    if (arg === '--force-cache-check') forceCacheCheck = true;
  }

  if (!contestantModel) {
    throw new Error(
      'Usage: pnpm smoke:live --model=<provider/model> [--buyer-model=<provider/model>] [--max-steps=N] [--no-cache-check] [--force-cache-check]\n' +
        'Example: pnpm smoke:live --model=anthropic/claude-haiku-4-5\n' +
        '  --force-cache-check  run the probe against a provider whose cache reporting is unverified',
    );
  }
  return {
    contestantModel,
    buyerModel: buyerModel ?? contestantModel,
    skipCacheCheck,
    forceCacheCheck,
    maxSteps,
  };
}

/**
 * Deterministic filler that is comfortably above every current model's minimum
 * cacheable prefix (the largest is 4096 tokens). Content is irrelevant; only
 * its size and byte-stability matter.
 */
export function buildCacheProbePrefix(clauses = 900): string {
  const lines = ['GHARBENCH CACHE PROBE. Stable prefix, identical on every call.', ''];
  for (let i = 1; i <= clauses; i += 1) {
    lines.push(
      `Clause ${i}: the sales executive must verify claim ${i} against a tool result before stating it to the buyer, and must never quote a figure that no tool returned.`,
    );
  }
  lines.push('', 'When asked, reply with the single word OK.');
  return lines.join('\n');
}

export interface CacheProbeResult {
  supported: boolean;
  /**
   * `explicit` — we placed the breakpoint, so a miss is unambiguously our bug.
   * `automatic` — the provider caches on its own; a miss is ambiguous.
   */
  mode: 'explicit' | 'automatic' | 'none';
  calls: Array<{
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }>;
  cacheHit: boolean;
  note?: string;
}

/** Automatic caches populate asynchronously; give the provider a moment. */
const AUTOMATIC_RETRY_DELAY_MS = 2_000;
/** Call 1 warms; up to 3 more may be needed before an automatic cache reports. */
const AUTOMATIC_MAX_CALLS = 4;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Byte-identical calls; a later one must read cached tokens.
 *
 * Two regimes, because a miss means different things in each:
 *
 * - **explicit** (Anthropic): we place the breakpoint. Call 1 writes, call 2
 *   reads. Two calls, no retries — a miss here means the prefix layout is
 *   broken, full stop.
 * - **automatic** (OpenAI, Google): the provider caches a >=1,024-token prefix
 *   by itself, best-effort, with no write signal to observe. A miss can mean a
 *   broken layout *or* a cold/elsewhere-routed cache, so we retry before
 *   concluding anything. That ambiguity is why an explicit provider is the
 *   stronger witness for G1.
 */
export async function runCacheProbe(
  modelRef: string,
  meter: CostMeter,
  ts: string,
  force = false,
): Promise<CacheProbeResult> {
  const resolved = resolveModel(modelRef);
  const { supportsExplicitCaching, reportsCacheReads } = resolved.spec;

  if (!reportsCacheReads && !force) {
    return {
      supported: false,
      mode: 'none',
      calls: [],
      cacheHit: false,
      note:
        `Provider "${resolved.provider}" is not known to report cache reads through ` +
        `this registry. Re-run with --force-cache-check to probe it anyway; if it ` +
        `reports, set reportsCacheReads: true for it.`,
    };
  }

  const mode: 'explicit' | 'automatic' = supportsExplicitCaching ? 'explicit' : 'automatic';
  const maxCalls = mode === 'explicit' ? 2 : AUTOMATIC_MAX_CALLS;
  const system = buildCacheProbePrefix();
  const calls: CacheProbeResult['calls'] = [];

  for (let attempt = 0; attempt < maxCalls; attempt += 1) {
    if (attempt > 0 && mode === 'automatic') await sleep(AUTOMATIC_RETRY_DELAY_MS);

    const started = performance.now();
    const result = await generateText({
      model: resolved.model,
      system,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      maxOutputTokens: 16,
      maxRetries: 2,
      // Exactly what a real sweep sends: breakpoint on Anthropic, stable cache
      // routing on OpenAI. The probe must not be luckier than production.
      ...cacheCallOptions(resolved.spec, `gharbench-probe-${sha256(system)}`),
    });
    const usage = normaliseUsage(result.usage);
    meter.record(
      { role: 'contestant', modelId: resolved.modelId, provider: resolved.provider, ts },
      usage,
      performance.now() - started,
    );
    calls.push({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
    });

    // Anything after the warming call counts; stop as soon as one reads.
    if (attempt > 0 && usage.cacheReadTokens > 0) break;
  }

  return {
    supported: true,
    mode,
    calls,
    cacheHit: calls.slice(1).some((c) => c.cacheReadTokens > 0),
    ...(force && !reportsCacheReads
      ? { note: `forced probe: "${resolved.provider}" cache reporting was unverified` }
      : {}),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = loadFixtures();

  const contestantRef = parseModelRef(args.contestantModel);
  const buyerRef = parseModelRef(args.buyerModel);

  for (const ref of new Set([contestantRef.ref, buyerRef.ref])) {
    if (!isPriceKnown(parseModelRef(ref).modelId)) {
      console.warn(
        `warning: no price-table entry for "${ref}". Token counts will be recorded, dollar cost will not.`,
      );
    }
  }

  const runId = makeRunId('smoke-live');
  const runDir = join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  const costMeter = new CostMeter();
  const db = resetDb(fixtures.gold);
  const clock = new SimClock(fixtures.scenario.clock);

  const buyer = new ModelBuyer({
    persona: fixtures.persona,
    scenario: fixtures.scenario,
    modelRef: buyerRef.ref,
    costMeter,
    clock,
  });
  const contestant = new ProviderModelContestant({
    modelRef: contestantRef.ref,
    scenario: fixtures.scenario,
    costMeter,
    clock,
  });

  for (const ref of [contestantRef, buyerRef]) {
    if (ref.pinned && ref.modelId !== ref.requestedModelId) {
      console.log(`pinned ${ref.requestedRef} -> ${ref.modelId}`);
    } else if (!ref.pinned) {
      console.warn(
        `warning: "${ref.requestedRef}" is not version-pinned - no dated snapshot is published for it.\n` +
          '  A provider can repoint a floating alias with no signal, and no provider honours `seed`,\n' +
          '  so a scored run using this cannot be shown to have used one model throughout.',
      );
    }
  }

  console.log(`\nRunning live smoke: contestant=${contestantRef.ref} buyer=${buyerRef.ref}`);

  const orchestrator = new Orchestrator({
    contestant,
    buyer,
    environment: createEnvironment(db, clock),
    scenario: fixtures.scenario,
    runIndex: 0,
    costMeter,
    ...(args.maxSteps !== undefined ? { maxSteps: args.maxSteps } : {}),
  });
  const record: ConversationRecord = await orchestrator.run();

  const transcripts = new TranscriptWriter(runDir);
  transcripts.append(record);

  // --- Prompt-cache billing check -------------------------------------------
  const probe: CacheProbeResult = args.skipCacheCheck
    ? {
        supported: false,
        mode: 'none',
        calls: [],
        cacheHit: false,
        note: 'skipped via --no-cache-check',
      }
    : await runCacheProbe(contestantRef.ref, costMeter, clock.now(), args.forceCacheCheck);

  const costSummary = costMeter.summary();
  const costsPath = join(runDir, 'costs.json');
  writeFileSync(
    costsPath,
    `${JSON.stringify(
      { runId, mode: 'live', summary: costSummary, cacheProbe: probe, records: costMeter.records },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const manifest: RunManifest = {
    runId,
    startedAt: new Date().toISOString(),
    harnessVersion: '0.1.0',
    mode: 'live',
    git: collectGitInfo(),
    node: nodeInfo(),
    packages: collectPackageVersions(TRACKED_PACKAGES),
    models: [
      {
        role: 'buyer',
        ref: buyerRef.ref,
        provider: buyerRef.provider,
        modelId: buyerRef.modelId,
        endpoint: providerEndpoint(buyerRef.provider),
        requestedRef: buyerRef.requestedRef,
        versionPinned: buyerRef.pinned,
      },
      {
        role: 'contestant',
        ref: contestantRef.ref,
        provider: contestantRef.provider,
        modelId: contestantRef.modelId,
        endpoint: providerEndpoint(contestantRef.provider),
        requestedRef: contestantRef.requestedRef,
        versionPinned: contestantRef.pinned,
      },
    ],
    prompts: [
      { name: 'buyer.system', sha256: buyer.systemPromptSha256 },
      { name: 'contestant.system', sha256: contestant.systemPromptSha256 },
      { name: 'contestant.tools', sha256: contestant.toolSchemaSha256 },
      { name: 'cacheProbe.system', sha256: sha256(buildCacheProbePrefix()) },
    ],
    db: {
      version: fixtures.gold.dbVersion,
      goldHash: fixtures.goldHash,
      path: 'data/realestate-mock/project.json',
    },
    scenarios: [
      {
        scenarioId: fixtures.scenario.scenarioId,
        version: fixtures.scenario.version,
        seed: fixtures.scenario.seed,
        temperatures: fixtures.scenario.temperatures,
        maxSteps: args.maxSteps ?? fixtures.scenario.maxSteps,
        runs: 1,
      },
    ],
    contestants: [{ id: contestant.id, version: contestant.version }],
    buyers: [{ id: buyer.id, version: buyer.version }],
    artefacts: { transcripts: transcripts.path, costs: costsPath },
  };
  const manifestPath = writeManifest(runDir, manifest);

  // --- Report ----------------------------------------------------------------
  console.log('');
  console.log('GharBench - live smoke');
  console.log('='.repeat(64));
  console.log(`termination       ${record.terminationReason.kind}`);
  console.log(`steps             ${record.steps}`);
  console.log(`messages          ${record.messages.length}`);
  console.log(`db mutated        ${record.dbHashStart !== record.dbHashEnd ? 'yes' : 'no'}`);
  console.log(`bookings          ${db.bookings.length}`);
  console.log(`qualifications    ${db.qualifications.length}`);
  console.log(
    `cost              ${costSummary.calls} calls, ${costSummary.totalTokens} tokens, $${costSummary.totalUsd.toFixed(4)}` +
      (costSummary.unpricedCalls > 0 ? ` (${costSummary.unpricedCalls} unpriced)` : ''),
  );
  console.log(
    `conversation cache ${costSummary.cacheHits}/${costSummary.calls} calls hit, ${costSummary.cacheReadTokens} cached-read tokens`,
  );
  console.log('-'.repeat(64));
  console.log(
    `prompt cache billing check (byte-identical calls, ${probe.mode} caching)` +
      (probe.mode === 'automatic' ? ' - provider caches on its own, no breakpoint sent' : ''),
  );
  if (!probe.supported) {
    console.log(`  skipped: ${probe.note ?? 'unsupported'}`);
  } else {
    if (probe.note) console.log(`  note: ${probe.note}`);
    probe.calls.forEach((c, i) => {
      console.log(
        `  call ${i + 1}: input=${c.inputTokens} cacheWrite=${c.cacheWriteTokens} cacheRead=${c.cacheReadTokens} output=${c.outputTokens}`,
      );
    });
    const hitIndex = probe.calls.findIndex((c, i) => i > 0 && c.cacheReadTokens > 0);
    if (probe.cacheHit) {
      console.log(
        `  verdict: CACHE HIT - call ${hitIndex + 1} billed ${probe.calls[hitIndex]?.cacheReadTokens ?? 0} tokens at cache-read rate`,
      );
    } else if (probe.mode === 'explicit') {
      console.log('  verdict: NO CACHE READ - prompt layout is not caching');
    } else {
      // Do not let an ambiguous miss masquerade as a proven defect.
      console.log(
        `  verdict: NO CACHE READ after ${probe.calls.length} calls - INCONCLUSIVE.\n` +
          '           Automatic caching is best-effort, so this is either a broken prefix\n' +
          '           layout or a cold/elsewhere-routed cache. Re-run before concluding;\n' +
          '           an explicit-cache provider (anthropic) gives an unambiguous answer.',
      );
    }
  }
  console.log('-'.repeat(64));
  console.log(`transcript        ${transcripts.path}`);
  console.log(`manifest          ${manifestPath}`);
  console.log(`cost report       ${costsPath}`);
  console.log('='.repeat(64));

  if (probe.supported && !probe.cacheHit) {
    console.error(
      probe.mode === 'explicit'
        ? '\nLive smoke FAILED: no cache read on the second identical call. G1 not met.'
        : '\nLive smoke INCONCLUSIVE: no cache read after retries. G1 not met (yet).',
    );
    process.exitCode = 1;
  } else if (probe.supported) {
    console.log(
      `\nG1 CACHE CLAUSE MET (${probe.mode}): a repeated identical call billed cached input.`,
    );
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
