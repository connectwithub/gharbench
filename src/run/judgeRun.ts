/**
 * The Phase 5 judge runner (`pnpm judge:calibration`).
 *
 * Runs the §6.4 panel over the stored calibration cases, one verdict file per
 * (judge, case, dimension) under calibration/judgments/ - idempotent and
 * resumable like the labeling flow: existing verdicts are skipped unless
 * --force, so an interrupted pass costs nothing to continue.
 *
 * Safe by default: `--dry-run` builds every prompt and prints the token/cost
 * estimate without a single API call. The estimate is list-price - the §7.3
 * cache lever (stable system prefix per judge x dimension) makes the real
 * pass cheaper, and the costs snapshot written next to the judgments is the
 * evidence of by how much.
 *
 *   pnpm judge:calibration --dry-run
 *   pnpm judge:calibration --judge=xai/grok-4.3 --dimension=compliance --cases=slice
 *   pnpm judge:calibration --retest        # second pass for test-retest self-consistency
 */

import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import pLimit from 'p-limit';

import { sha256 } from '../env/db.js';
import { judgeCase, modelJudgeCaller, type JudgeCaseResult } from '../judge/judge.js';
import { JUDGE_PANEL, judgeSlug } from '../judge/panel.js';
import { buildJudgeSystem, buildJudgeUser, type JudgeCaseInput } from '../judge/prompt.js';
import { parseModelRef } from '../providers/registry.js';
import { CostMeter } from '../telemetry/cost.js';
import { estimateCostUsd } from '../telemetry/prices.js';
import {
  CALIBRATION_DIR,
  CASES_DIR,
  calibrationCaseSchema,
  type CalibrationCase,
} from './calibrationCase.js';
import { SLICE_FILE } from './calibrationSlice.js';
import { loadJudgeItems, type JudgeDimension, type JudgeItems } from './judgeItems.js';
import { REPO_ROOT, loadScenarioSet } from './scenarioSet.js';

export const JUDGMENTS_DIR = join(CALIBRATION_DIR, 'judgments');
export const JUDGMENTS_RETEST_DIR = join(CALIBRATION_DIR, 'judgments-retest');
const DOCS_DIR = join(REPO_ROOT, 'data', 'corpus', 'documents');

export const DIMENSIONS: readonly JudgeDimension[] = [
  'factuality',
  'compliance',
  'salesEffectiveness',
  'conversationQuality',
];

/** One stored verdict file: the JudgeCaseResult plus who produced it when. */
export interface StoredJudgment extends JudgeCaseResult {
  judgeRef: string;
  ts: string;
}

/** Corpus documents, filename-sorted so the prompt prefix is byte-stable. */
export function loadSourceDocuments(dir: string = DOCS_DIR): string {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => `--- ${f} ---\n${readFileSync(join(dir, f), 'utf8').trim()}`)
    .join('\n\n');
}

export function loadCalibrationCases(casesDir: string = CASES_DIR): CalibrationCase[] {
  return readdirSync(casesDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const parsed = calibrationCaseSchema.safeParse(
        JSON.parse(readFileSync(join(casesDir, f), 'utf8')),
      );
      if (!parsed.success) throw new Error(`${f} failed case schema: ${parsed.error.message}`);
      return parsed.data;
    });
}

/** Lazy per-run cache of checks.jsonl, keyed conversationId. */
export function makeChecksLookup(
  runsDir: string = join(REPO_ROOT, 'runs'),
): (runId: string, conversationId: string) => unknown {
  const byRun = new Map<string, Map<string, unknown>>();
  return (runId, conversationId) => {
    let reports = byRun.get(runId);
    if (!reports) {
      reports = new Map();
      const path = join(runsDir, runId, 'checks.jsonl');
      if (existsSync(path)) {
        for (const line of readFileSync(path, 'utf8').split('\n')) {
          if (!line.trim()) continue;
          const report = JSON.parse(line) as { conversationId?: string };
          if (report.conversationId) reports.set(report.conversationId, report);
        }
      }
      byRun.set(runId, reports);
    }
    return reports.get(conversationId);
  };
}

/** Assemble the per-case judge input for one dimension. */
export function buildCaseInput(
  c: CalibrationCase,
  dimension: JudgeDimension,
  deps: {
    scenarioById: ReadonlyMap<string, { activeTrapIds: string[]; groundTruth: { expectedOutcome: string; mustHold: string[] } }>;
    checksFor: (runId: string, conversationId: string) => unknown;
  },
): JudgeCaseInput {
  const input: JudgeCaseInput = {
    caseId: c.caseId,
    family: c.family,
    language: c.language,
    applicableItems: c.judgeApplicability[dimension],
    messages: c.messages,
  };
  if (c.provenance) {
    const scenario = deps.scenarioById.get(c.provenance.scenarioId);
    if (scenario) {
      input.scenarioCard = {
        activeTrapIds: scenario.activeTrapIds,
        expectedOutcome: scenario.groundTruth.expectedOutcome,
        mustHold: scenario.groundTruth.mustHold,
      };
    }
    const checks = deps.checksFor(c.provenance.runId, c.provenance.conversationId);
    if (checks !== undefined) input.programmaticResults = checks;
  }
  return input;
}

export function judgmentPath(baseDir: string, judgeRef: string, caseId: string, dimension: JudgeDimension): string {
  return join(baseDir, judgeSlug(judgeRef), `${caseId}.${dimension}.json`);
}

interface CliOptions {
  dryRun: boolean;
  retest: boolean;
  force: boolean;
  cases: 'all' | 'slice';
  caseIds: string[];
  dimensions: JudgeDimension[];
  judges: string[];
  maxUsd?: number;
  concurrency: number;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    retest: false,
    force: false,
    cases: 'all',
    caseIds: [],
    dimensions: [...DIMENSIONS],
    judges: JUDGE_PANEL.map((j) => j.ref),
    concurrency: 3,
  };
  const judges: string[] = [];
  for (const arg of argv) {
    const [flag, value = ''] = arg.split(/=(.*)/s);
    switch (flag) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--retest':
        options.retest = true;
        break;
      case '--force':
        options.force = true;
        break;
      case '--cases':
        if (value !== 'all' && value !== 'slice') throw new Error('--cases=all|slice');
        options.cases = value;
        break;
      case '--case':
        options.caseIds.push(value);
        break;
      case '--dimension': {
        if (!DIMENSIONS.includes(value as JudgeDimension)) {
          throw new Error(`--dimension must be one of ${DIMENSIONS.join(', ')}`);
        }
        options.dimensions = [value as JudgeDimension];
        break;
      }
      case '--judge':
        judges.push(value);
        break;
      case '--max-usd':
        options.maxUsd = Number.parseFloat(value);
        break;
      case '--concurrency':
        options.concurrency = Number.parseInt(value, 10);
        break;
      default:
        throw new Error(`unknown flag ${flag}`);
    }
  }
  if (judges.length > 0) options.judges = judges;
  return options;
}

function selectCases(options: CliOptions): CalibrationCase[] {
  let cases = loadCalibrationCases();
  if (options.cases === 'slice') {
    if (!existsSync(SLICE_FILE)) throw new Error('run pnpm calibration:slice first');
    const slice = JSON.parse(readFileSync(SLICE_FILE, 'utf8')) as { ids: string[] };
    const allowed = new Set(slice.ids);
    cases = cases.filter((c) => allowed.has(c.caseId));
  }
  if (options.caseIds.length > 0) {
    const wanted = new Set(options.caseIds);
    cases = cases.filter((c) => wanted.has(c.caseId));
  }
  return cases;
}

const estTokens = (text: string): number => Math.ceil(text.length / 4);

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const items: JudgeItems = loadJudgeItems();
  const sourceDocuments = loadSourceDocuments();
  const cases = selectCases(options);
  const set = loadScenarioSet();
  const scenarioById = new Map(set.scenarios.map((s) => [s.scenarioId, s]));
  const checksFor = makeChecksLookup();
  const baseDir = options.retest ? JUDGMENTS_RETEST_DIR : JUDGMENTS_DIR;

  // Work list: (judge, case, dimension) triples that still need a verdict.
  const work: { judgeRef: string; c: CalibrationCase; dimension: JudgeDimension }[] = [];
  let skippedExisting = 0;
  for (const judgeRef of options.judges) {
    for (const c of cases) {
      for (const dimension of options.dimensions) {
        if (!options.force && existsSync(judgmentPath(baseDir, judgeRef, c.caseId, dimension))) {
          skippedExisting += 1;
          continue;
        }
        work.push({ judgeRef, c, dimension });
      }
    }
  }

  console.log(
    `judge pass: ${cases.length} case(s) x ${options.dimensions.length} dimension(s) x ` +
      `${options.judges.length} judge(s) -> ${work.length} call(s)` +
      (skippedExisting > 0 ? ` (${skippedExisting} already judged, skipped)` : ''),
  );

  if (options.dryRun) {
    // Estimate at list price; caching makes the real pass cheaper.
    let totalUsd = 0;
    let unpriced = 0;
    for (const judgeRef of options.judges) {
      const { modelId } = parseModelRef(judgeRef);
      let judgeUsd = 0;
      let judgeTokens = 0;
      for (const dimension of options.dimensions) {
        const sysTok = estTokens(buildJudgeSystem(items, dimension, sourceDocuments));
        for (const c of cases) {
          const user = buildJudgeUser(buildCaseInput(c, dimension, { scenarioById, checksFor }));
          const usage = {
            inputTokens: sysTok + estTokens(user),
            outputTokens: 1000,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          };
          judgeTokens += usage.inputTokens + usage.outputTokens;
          const priced = estimateCostUsd(modelId, usage);
          if (priced.priced) judgeUsd += priced.usd ?? 0;
          else unpriced += 1;
        }
      }
      totalUsd += judgeUsd;
      console.log(
        `  ${judgeRef}: ~${Math.round(judgeTokens / 1000)}k tokens, ` +
          (judgeUsd > 0 ? `~$${judgeUsd.toFixed(2)} list-price` : 'UNPRICED (verify at smoke)'),
      );
    }
    console.log(
      `dry run: ~$${totalUsd.toFixed(2)} list-price upper bound` +
        (unpriced > 0 ? `; ${unpriced} call(s) on unpriced models - verify prices first` : '') +
        '; caching reduces the real figure. No API calls made.',
    );
    return;
  }

  const meter = new CostMeter();
  const ts = new Date().toISOString();
  const limit = pLimit(options.concurrency);
  const callers = new Map(options.judges.map((ref) => [ref, modelJudgeCaller(ref, meter, ts)]));
  let done = 0;
  let errored = 0;
  let budgetStopped = false;

  await Promise.all(
    work.map(({ judgeRef, c, dimension }) =>
      limit(async () => {
        if (options.maxUsd !== undefined && meter.summary().totalUsd >= options.maxUsd) {
          budgetStopped = true;
          return;
        }
        const call = callers.get(judgeRef);
        if (!call) return;
        const input = buildCaseInput(c, dimension, { scenarioById, checksFor });
        const result = await judgeCase({ call, items, dimension, input, sourceDocuments });
        const stored: StoredJudgment = { ...result, judgeRef, ts };
        const path = judgmentPath(baseDir, judgeRef, c.caseId, dimension);
        mkdirSync(join(baseDir, judgeSlug(judgeRef)), { recursive: true });
        writeFileSync(path, JSON.stringify(stored, null, 2) + '\n');
        done += 1;
        if (result.outcome.kind === 'error') errored += 1;
        if (done % 25 === 0) {
          console.log(`  ${done}/${work.length} judged ($${meter.summary().totalUsd.toFixed(2)})`);
        }
      }),
    ),
  );

  const summary = meter.summary();
  const stamp = ts.replace(/[-:]/g, '').replace(/\..*$/, 'Z');
  const metaDir = join(baseDir, 'meta');
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(
    join(metaDir, `${stamp}-pass.json`),
    JSON.stringify(
      {
        ts,
        judges: options.judges,
        dimensions: options.dimensions,
        cases: cases.length,
        judged: done,
        errored,
        skippedExisting,
        budgetStopped,
        promptShas: Object.fromEntries(
          options.dimensions.map((d) => [d, sha256(buildJudgeSystem(items, d, sourceDocuments))]),
        ),
        costs: summary,
      },
      null,
      2,
    ) + '\n',
  );

  console.log(
    `judged ${done}/${work.length} (${errored} structured errors), ` +
      `$${summary.totalUsd.toFixed(4)} across ${summary.calls} calls, ` +
      `cache hits ${summary.cacheHits}/${summary.calls}` +
      (summary.unpricedCalls > 0 ? `, UNPRICED calls: ${summary.unpricedCalls}` : '') +
      (budgetStopped ? ' - BUDGET STOP' : ''),
  );
  console.log(`verdicts: ${baseDir}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
