/**
 * Gate G1: the offline smoke run.
 *
 * A complete buyer <-> agent conversation through the *real* orchestrator, the
 * real environment, the real tools, the real logging and the real telemetry -
 * with a scripted buyer and a scripted contestant, so it needs no API key and
 * costs nothing. If this passes, the engine is wired end to end.
 *
 * It runs the scenario several times and asserts every trial is byte-identical.
 * Determinism is a property of the harness, not a hope, and this is where that
 * is enforced.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

import { FakeContestant, mockAgentScript } from '../contestants/fake.js';
import {
  Orchestrator,
  createEnvironment,
  type ConversationRecord,
  type ScenarioConfig,
} from '../engine/orchestrator.js';
import {
  SimClock,
  canonicalJson,
  hashDb,
  loadGoldDb,
  resetDb,
  type RealEstateDb,
} from '../env/db.js';
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
import { passPowerKCurve, type TaskOutcome } from '../metrics/passk.js';
import { FakeBuyer, mockBuyerScript } from '../simulator/fakeBuyer.js';
import { buildBuyerSystemPrompt, type PersonaCard } from '../simulator/buyer.js';
import { loadPersonaCard } from '../simulator/persona.js';
import { buildAgentSystemPrompt } from '../contestants/providerModel.js';
import { sha256 } from '../env/db.js';
import { CostMeter } from '../telemetry/cost.js';

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
export const DATA_DIR = join(REPO_ROOT, 'data', 'realestate-mock');
export const RUNS_DIR = join(REPO_ROOT, 'runs');

const scenarioSchema = z.object({
  scenarioId: z.string().min(1),
  version: z.string().min(1),
  personaId: z.string().min(1),
  dbVersion: z.string().min(1),
  channel: z.string().min(1),
  seed: z.number().int(),
  clock: z.object({ startIso: z.string().min(1), stepSeconds: z.number().nonnegative() }),
  temperatures: z.object({ buyer: z.number(), contestant: z.number() }),
  maxSteps: z.number().int().positive(),
  maxToolStepsPerTurn: z.number().int().positive(),
  flowEndingTools: z.array(z.string()),
  openingMessage: z.string().min(1),
  agentBrief: z.object({ role: z.string().min(1), objectives: z.array(z.string()).min(1) }),
});

export interface Fixtures {
  gold: RealEstateDb;
  goldHash: string;
  goldPath: string;
  persona: PersonaCard;
  scenario: ScenarioConfig;
}

export function loadFixtures(dataDir: string = DATA_DIR): Fixtures {
  const goldPath = join(dataDir, 'project.json');
  const gold = loadGoldDb(goldPath);
  const persona = loadPersonaCard(join(dataDir, 'persona.json'));
  const scenario = scenarioSchema.parse(
    JSON.parse(readFileSync(join(dataDir, 'scenario.json'), 'utf8')),
  ) as ScenarioConfig;

  if (scenario.dbVersion !== gold.dbVersion) {
    throw new Error(
      `Scenario ${scenario.scenarioId} targets dbVersion ${scenario.dbVersion} but the gold DB is ${gold.dbVersion}.`,
    );
  }
  if (scenario.personaId !== persona.personaId) {
    throw new Error(
      `Scenario ${scenario.scenarioId} targets persona ${scenario.personaId} but persona.json is ${persona.personaId}.`,
    );
  }

  return { gold, goldHash: hashDb(gold), goldPath, persona, scenario };
}

export interface OfflineTrial {
  record: ConversationRecord;
  db: RealEstateDb;
}

/** One offline trial: fresh DB clone, fresh clock, scripted buyer and agent. */
export async function runOfflineTrial(
  fixtures: Fixtures,
  runIndex: number,
  costMeter?: CostMeter,
): Promise<OfflineTrial> {
  const db = resetDb(fixtures.gold);
  const clock = new SimClock(fixtures.scenario.clock);

  const orchestrator = new Orchestrator({
    contestant: new FakeContestant({ script: mockAgentScript() }),
    buyer: new FakeBuyer({ script: mockBuyerScript(fixtures.scenario) }),
    environment: createEnvironment(db, clock),
    scenario: fixtures.scenario,
    runIndex,
    ...(costMeter ? { costMeter } : {}),
  });

  return { record: await orchestrator.run(), db };
}

/** Phase 0 success: the conversation ended cleanly and produced a booking. */
export function isSuccessfulTrial(trial: OfflineTrial): boolean {
  return trial.record.terminationReason.kind !== 'error' && trial.db.bookings.length > 0;
}

function parseArgs(argv: readonly string[]): { runs: number } {
  let runs = 3;
  for (const arg of argv) {
    const match = /^--runs=(\d+)$/.exec(arg);
    if (match?.[1]) runs = Math.max(1, Number.parseInt(match[1], 10));
  }
  return { runs };
}

async function main(): Promise<void> {
  const { runs } = parseArgs(process.argv.slice(2));
  const fixtures = loadFixtures();

  const runId = makeRunId('smoke-offline');
  const runDir = join(RUNS_DIR, runId);
  mkdirSync(runDir, { recursive: true });

  const costMeter = new CostMeter();
  const transcripts = new TranscriptWriter(runDir);
  const trials: OfflineTrial[] = [];

  for (let i = 0; i < runs; i += 1) {
    const trial = await runOfflineTrial(fixtures, i, costMeter);
    transcripts.append(trial.record);
    trials.push(trial);
  }

  // --- Determinism check -----------------------------------------------------
  const fingerprints = trials.map((t) =>
    sha256(canonicalJson({ ...t.record, runIndex: 0, conversationId: '' })),
  );
  const deterministic = fingerprints.every((f) => f === fingerprints[0]);
  const endHashes = [...new Set(trials.map((t) => t.record.dbHashEnd))];

  // --- Metrics ---------------------------------------------------------------
  const outcomes: TaskOutcome[] = [
    {
      taskId: fixtures.scenario.scenarioId,
      successes: trials.filter(isSuccessfulTrial).length,
      trials: trials.length,
    },
  ];
  const curve = passPowerKCurve(outcomes, trials.length);

  // --- Artefacts -------------------------------------------------------------
  const costSummary = costMeter.summary();
  const costsPath = join(runDir, 'costs.json');
  writeFileSync(
    costsPath,
    `${JSON.stringify(
      {
        runId,
        mode: 'offline',
        note: 'Offline smoke makes zero model calls by construction. Zero cost here is the expected result, not a missing measurement.',
        summary: costSummary,
        records: costMeter.records,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const buyerPrompt = buildBuyerSystemPrompt(fixtures.persona, fixtures.scenario);
  const agentPrompt = buildAgentSystemPrompt(fixtures.scenario);

  const manifest: RunManifest = {
    runId,
    startedAt: new Date().toISOString(),
    harnessVersion: readHarnessVersion(),
    mode: 'offline',
    git: collectGitInfo(REPO_ROOT),
    node: nodeInfo(),
    packages: collectPackageVersions(TRACKED_PACKAGES),
    models: [],
    prompts: [
      { name: 'buyer.system', sha256: sha256(buyerPrompt) },
      { name: 'contestant.system', sha256: sha256(agentPrompt) },
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
        maxSteps: fixtures.scenario.maxSteps,
        runs,
      },
    ],
    contestants: [
      { id: trials[0]!.record.contestantId, version: trials[0]!.record.contestantVersion },
    ],
    buyers: [{ id: trials[0]!.record.buyerId, version: trials[0]!.record.buyerVersion }],
    artefacts: { transcripts: transcripts.path, costs: costsPath },
    notes: [
      'Offline smoke: scripted buyer and scripted contestant, no provider calls.',
      'Prompt hashes are recorded even though no model saw them, so the offline and live manifests are comparable.',
    ],
  };
  const manifestPath = writeManifest(runDir, manifest);

  // --- Report ----------------------------------------------------------------
  const first = trials[0]!;
  const events = tallyEvents(first.record);

  console.log('');
  console.log('GharBench - Gate G1 (offline smoke)');
  console.log('='.repeat(64));
  console.log(`scenario          ${fixtures.scenario.scenarioId} v${fixtures.scenario.version}`);
  console.log(`trials            ${runs}`);
  console.log(`termination       ${describeTermination(first.record)}`);
  console.log(`steps             ${first.record.steps} (max ${fixtures.scenario.maxSteps})`);
  console.log(`messages          ${first.record.messages.length}`);
  console.log(`db hash start     ${first.record.dbHashStart}`);
  console.log(`db hash end       ${first.record.dbHashEnd}`);
  console.log(
    `db mutated        ${first.record.dbHashStart !== first.record.dbHashEnd ? 'yes' : 'no'}`,
  );
  console.log(`bookings created  ${first.db.bookings.length}`);
  console.log(
    `tool events       ${Object.entries(events)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')}`,
  );
  console.log(
    `determinism       ${deterministic ? 'PASS' : 'FAIL'} (${fingerprints.length} identical transcripts, ${endHashes.length} distinct end hash)`,
  );
  console.log(`pass^k            ${curve.map((c) => `k=${c.k}:${c.value.toFixed(3)}`).join('  ')}`);
  console.log(
    `cost              ${costSummary.calls} model calls, $${costSummary.totalUsd.toFixed(4)}`,
  );
  console.log('-'.repeat(64));
  console.log(`transcript        ${transcripts.path}`);
  console.log(`manifest          ${manifestPath}`);
  console.log(`cost report       ${costsPath}`);
  console.log('='.repeat(64));

  if (!deterministic || endHashes.length !== 1) {
    console.error('\nG1 FAILED: trials were not identical.');
    process.exitCode = 1;
    return;
  }
  if (!isSuccessfulTrial(first)) {
    console.error('\nG1 FAILED: the smoke conversation did not reach a booking.');
    process.exitCode = 1;
    return;
  }
  // G1 has two clauses (Master Plan §8): an end-to-end mock conversation with
  // full logging, AND a repeated call that demonstrably bills cached input.
  // This run is offline and makes zero model calls, so it can only ever prove
  // the first. Saying "G1 PASSED" here would green-light Phase 1 authoring on
  // half a gate; the cache clause needs `pnpm smoke:live`.
  console.log('\nG1 OFFLINE HALF PASSED - end-to-end mock conversation + full logging.');
  console.log(
    "G1's cache-billing clause is not testable here (0 model calls). It is proven\n" +
      'separately by `pnpm smoke:live --model=<provider/model>` — re-run that whenever\n' +
      'the prompt layout or provider options change. See the cache measurements in\n' +
      'the README and docs/decisions/ADR-0004 for what a passing run looks like.',
  );
}

function describeTermination(record: ConversationRecord): string {
  const reason = record.terminationReason;
  switch (reason.kind) {
    case 'buyer_token':
      return `buyer_token ${reason.token}`;
    case 'flow_ending_tool':
      return `flow_ending_tool ${reason.tool}`;
    case 'max_steps':
      return `max_steps ${reason.maxSteps}`;
    case 'error':
      return `error: ${reason.message}`;
  }
}

function tallyEvents(record: ConversationRecord): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const event of record.toolEvents) tally[event.type] = (tally[event.type] ?? 0) + 1;
  return tally;
}

function readHarnessVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
