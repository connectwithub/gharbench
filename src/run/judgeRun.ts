/**
 * The judge runner (`pnpm judge:calibration` / `pnpm judge:run`).
 *
 * Two work sources, one machinery:
 *   - calibration mode (default): the stored calibration cases, verdicts to
 *     calibration/judgments/ - Phase 5 judge validation.
 *   - run mode (--run=<runId>): a sweep's transcripts, verdicts to
 *     runs/<runId>/judgments/ - Phase 6 Layer-2 scoring. The §4.1 gating
 *     rule applies here: conversations whose Layer-1 report says
 *     `gatesJudging` are SKIPPED (their composite is already 0), which is
 *     the single biggest judging cost saver.
 *
 * Verdict files are per-(judge, case, dimension), idempotent and resumable:
 * existing verdicts are skipped unless --force, so an interrupted pass costs
 * nothing to continue. `--dry-run` builds every prompt and prints the
 * token/cost estimate without a single API call; the estimate is list-price
 * (the cache-first system prefix makes the real pass cheaper).
 *
 *   pnpm judge:calibration --dry-run
 *   pnpm judge:run --run=<runId> --dry-run
 *   pnpm judge:calibration --retest        # test-retest second pass
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
import { TRANSCRIPT_FILENAME, readTranscripts } from '../logging/transcript.js';
import { parseModelRef } from '../providers/registry.js';
import { CostMeter, isPriceKnown } from '../telemetry/cost.js';
import { estimateCostUsd } from '../telemetry/prices.js';
import {
  CALIBRATION_DIR,
  CASES_DIR,
  calibrationCaseSchema,
  type CalibrationCase,
} from './calibrationCase.js';
import { projectMessages } from './calibrationBuild.js';
import { terminationSource } from './g6AuditServer.js';
import { readCheckReports } from './checkReports.js';
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

/** A unit of judgeable work, whatever its source. */
export interface Judgeable {
  caseId: string;
  family: string;
  language: string;
  endedBy?: JudgeCaseInput['endedBy'];
  applicability: Record<JudgeDimension, readonly string[]>;
  messages: { role: 'buyer' | 'agent' | 'system'; text: string }[];
  scenarioCard?: JudgeCaseInput['scenarioCard'];
  programmaticResults?: unknown;
}

export function inputFor(j: Judgeable, dimension: JudgeDimension): JudgeCaseInput {
  const input: JudgeCaseInput = {
    caseId: j.caseId,
    family: j.family,
    language: j.language,
    applicableItems: j.applicability[dimension],
    messages: j.messages,
  };
  if (j.endedBy !== undefined) input.endedBy = j.endedBy;
  if (j.scenarioCard) input.scenarioCard = j.scenarioCard;
  if (j.programmaticResults !== undefined) input.programmaticResults = j.programmaticResults;
  return input;
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

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');

/**
 * Case id for a run conversation - unique across contestants in one run.
 * The full ref (minus the `contestant:` role prefix) is slugged: taking only
 * the last path segment would collide `openai/gpt-x` with `openrouter/openai/gpt-x`,
 * silently handing one contestant's verdicts to the other.
 */
export function runCaseId(contestantId: string, conversationId: string): string {
  return `${slug(contestantId.replace(/^contestant:/, ''))}_${slug(conversationId)}`;
}

/** Judgeables from the stored calibration set (Phase 5). */
function loadCalibrationJudgeables(sliceOnly: boolean, caseIds: readonly string[]): Judgeable[] {
  let cases = loadCalibrationCases();
  if (sliceOnly) {
    if (!existsSync(SLICE_FILE)) throw new Error('run pnpm calibration:slice first');
    const allowed = new Set(
      (JSON.parse(readFileSync(SLICE_FILE, 'utf8')) as { ids: string[] }).ids,
    );
    cases = cases.filter((c) => allowed.has(c.caseId));
  }
  if (caseIds.length > 0) {
    const wanted = new Set(caseIds);
    cases = cases.filter((c) => wanted.has(c.caseId));
  }

  return cases.map(toCalibrationJudgeable);
}

/**
 * ADR-0025: calibration judging uses ONE uniform prompt shape for every case
 * - no scenario card, no Layer-1 results - regardless of provenance. Real
 * cases could carry both (the pilot-era code attached them), which gave the
 * 18 seeded cases a visibly different prompt (no card, "PROGRAMMATIC RESULTS
 * unavailable") - a 100%-accurate tell on exactly the seeded-recall
 * measurement. The minimal shape also matches the human labeler's
 * information set (transcript + rubric + source documents), which is the
 * right basis for G8 agreement. Run-mode judging (loadRunJudgeables) keeps
 * card + Layer-1: every run conversation has them, so that shape is uniform
 * too. Never re-add per-provenance enrichment here.
 */
export function toCalibrationJudgeable(c: CalibrationCase): Judgeable {
  return {
    caseId: c.caseId,
    family: c.family,
    language: c.language,
    endedBy: c.endedBy,
    applicability: c.judgeApplicability,
    messages: c.messages,
  };
}

/**
 * Judgeables from a sweep's transcripts (Phase 6). Applies the gating rule:
 * error terminations and hard-fail-gated conversations are excluded.
 */
export function loadRunJudgeables(runId: string): {
  judgeables: Judgeable[];
  gated: number;
  skipped: string[];
} {
  const runDir = join(REPO_ROOT, 'runs', runId);
  const transcriptPath = join(runDir, TRANSCRIPT_FILENAME);
  if (!existsSync(transcriptPath)) throw new Error(`No ${TRANSCRIPT_FILENAME} in runs/${runId}`);
  const checks = readCheckReports(runDir);
  if (checks.size === 0) {
    throw new Error(
      `No checks.jsonl in runs/${runId} - run pnpm checks --run=${runId} first (the gating rule needs it).`,
    );
  }

  const set = loadScenarioSet({ includePrivate: true });
  const scenarioById = new Map(set.scenarios.map((s) => [s.scenarioId, s]));

  const judgeables: Judgeable[] = [];
  const skipped: string[] = [];
  let gated = 0;
  for (const record of readTranscripts(transcriptPath)) {
    const endedBy = terminationSource(record.terminationReason);
    if (endedBy === 'error') {
      skipped.push(`${record.conversationId} (error termination)`);
      continue;
    }
    const scenario = scenarioById.get(record.scenarioId);
    if (!scenario) {
      skipped.push(`${record.conversationId} (scenario not in set)`);
      continue;
    }
    const report = checks.get(record.contestantId, record.conversationId);
    if (report?.gatesJudging) {
      gated += 1;
      continue; // composite already 0: judging spend on it is wasted money
    }
    judgeables.push({
      caseId: runCaseId(record.contestantId, record.conversationId),
      family: scenario.family,
      language: scenario.language,
      endedBy,
      applicability: scenario.judgeApplicability,
      messages: projectMessages(record),
      scenarioCard: {
        activeTrapIds: scenario.activeTrapIds,
        expectedOutcome: scenario.groundTruth.expectedOutcome,
        mustHold: scenario.groundTruth.mustHold,
      },
      ...(report !== undefined ? { programmaticResults: report } : {}),
    });
  }
  return { judgeables, gated, skipped };
}

export function judgmentPath(
  baseDir: string,
  judgeRef: string,
  caseId: string,
  dimension: JudgeDimension,
): string {
  return join(baseDir, judgeSlug(judgeRef), `${caseId}.${dimension}.json`);
}

interface CliOptions {
  dryRun: boolean;
  retest: boolean;
  force: boolean;
  cases: 'all' | 'slice';
  caseIds: string[];
  runId?: string;
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
      case '--run':
        // '' is falsy and would silently fall into calibration mode - the
        // whole panel budget spent on the wrong work source.
        if (!value) throw new Error('--run needs a value: --run=<runId>');
        options.runId = value;
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
        // NaN compares false forever - the cap would be silently disabled.
        if (!Number.isFinite(options.maxUsd)) {
          throw new Error(`--max-usd needs a number, got "${value}"`);
        }
        break;
      case '--concurrency':
        options.concurrency = Number.parseInt(value, 10);
        break;
      default:
        throw new Error(`unknown flag ${flag}`);
    }
  }
  if (judges.length > 0) options.judges = judges;
  if (options.runId && options.retest) throw new Error('--retest is a calibration-mode flag');
  return options;
}

const estTokens = (text: string): number => Math.ceil(text.length / 4);

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const items: JudgeItems = loadJudgeItems();
  const sourceDocuments = loadSourceDocuments();

  let judgeables: Judgeable[];
  let baseDir: string;
  if (options.runId) {
    const loaded = loadRunJudgeables(options.runId);
    judgeables = loaded.judgeables;
    baseDir = join(REPO_ROOT, 'runs', options.runId, 'judgments');
    console.log(
      `run ${options.runId}: ${judgeables.length} conversation(s) to judge, ` +
        `${loaded.gated} hard-fail-gated (skipped - composite already 0), ` +
        `${loaded.skipped.length} unjudgeable`,
    );
    if (options.caseIds.length > 0) {
      const wanted = new Set(options.caseIds);
      judgeables = judgeables.filter((j) => wanted.has(j.caseId));
    }
  } else {
    judgeables = loadCalibrationJudgeables(options.cases === 'slice', options.caseIds);
    baseDir = options.retest ? JUDGMENTS_RETEST_DIR : JUDGMENTS_DIR;
  }

  // Work list: (judge, case, dimension) triples that still need a verdict.
  const work: { judgeRef: string; j: Judgeable; dimension: JudgeDimension }[] = [];
  let skippedExisting = 0;
  for (const judgeRef of options.judges) {
    for (const j of judgeables) {
      for (const dimension of options.dimensions) {
        if (!options.force && existsSync(judgmentPath(baseDir, judgeRef, j.caseId, dimension))) {
          skippedExisting += 1;
          continue;
        }
        work.push({ judgeRef, j, dimension });
      }
    }
  }

  console.log(
    `judge pass: ${judgeables.length} case(s) x ${options.dimensions.length} dimension(s) x ` +
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
        for (const j of judgeables) {
          const user = buildJudgeUser(inputFor(j, dimension));
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

  // The cap compares meter.totalUsd, and unpriced calls add $0 to it - say so
  // loudly rather than letting the operator believe the ceiling covers them.
  if (options.maxUsd !== undefined) {
    const unpricedRefs = options.judges.filter((ref) => !isPriceKnown(parseModelRef(ref).modelId));
    if (unpricedRefs.length > 0) {
      console.warn(
        `WARNING: --max-usd cannot see spend on unpriced judge(s) ${unpricedRefs.join(', ')} - ` +
          'their calls bill $0 against the cap until src/telemetry/prices.ts knows them.',
      );
    }
  }

  const meter = new CostMeter();
  const ts = new Date().toISOString();
  const limit = pLimit(options.concurrency);
  const callers = new Map(options.judges.map((ref) => [ref, modelJudgeCaller(ref, meter, ts)]));
  let done = 0;
  let errored = 0;
  let budgetStopped = false;

  await Promise.all(
    work.map(({ judgeRef, j, dimension }) =>
      limit(async () => {
        if (options.maxUsd !== undefined && meter.summary().totalUsd >= options.maxUsd) {
          budgetStopped = true;
          return;
        }
        const call = callers.get(judgeRef);
        if (!call) return;
        const result = await judgeCase({
          call,
          items,
          dimension,
          input: inputFor(j, dimension),
          sourceDocuments,
        });
        const stored: StoredJudgment = { ...result, judgeRef, ts };
        mkdirSync(join(baseDir, judgeSlug(judgeRef)), { recursive: true });
        writeFileSync(
          judgmentPath(baseDir, judgeRef, j.caseId, dimension),
          JSON.stringify(stored, null, 2) + '\n',
        );
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
        source: options.runId ? { run: options.runId } : { calibration: options.cases },
        judges: options.judges,
        dimensions: options.dimensions,
        cases: judgeables.length,
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
