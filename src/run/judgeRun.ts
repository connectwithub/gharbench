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
 *   pnpm judge:calibration --item-order=reversed   # ADR-0030 order ablation
 *
 * One writer per (judge, verdict dir): a real pass holds
 * `<verdict dir>/meta/<judge slug>.lock` from before the skip-existing scan
 * until its meta file is written (ADR-0036). A second pass on the same judge
 * and dir is refused, never merged - two writers on one judge directory is
 * how the 2026-09-20 stray process silently rewrote verdicts.
 */

import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import pLimit from 'p-limit';

import { sha256 } from '../env/db.js';
import {
  applicableAnchorIds,
  hasConditionalAnchor,
  rubricAnchors,
} from '../judge/anchorApplicability.js';
import { judgeCase, modelJudgeCaller, type JudgeCaseResult } from '../judge/judge.js';
import { JUDGE_PANEL, judgeSlug } from '../judge/panel.js';
import {
  buildJudgeSystem,
  buildJudgeUser,
  withApplicableAnchors,
  type JudgeCaseInput,
  type JudgeItemOrder,
} from '../judge/prompt.js';
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
import { closingTool, projectMessages } from './calibrationBuild.js';
import { terminationSource } from './g6AuditServer.js';
import { readCheckReports } from './checkReports.js';
import { SLICE_FILE } from './calibrationSlice.js';
import { loadJudgeItems, type JudgeDimension, type JudgeItems } from './judgeItems.js';
import { REPO_ROOT, loadScenarioSet } from './scenarioSet.js';

export const JUDGMENTS_DIR = join(CALIBRATION_DIR, 'judgments');
export const JUDGMENTS_RETEST_DIR = join(CALIBRATION_DIR, 'judgments-retest');
/** ADR-0030: order-reversed ablation verdicts live apart from the primary pass. */
export const JUDGMENTS_REVERSED_DIR = join(CALIBRATION_DIR, 'judgments-reversed');
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
  /**
   * `data/judge-items.json` `version` the verdict was produced under. Absent on
   * verdicts written before rubric v2 (treated as "unversioned" by readers).
   */
  itemsVersion?: string;
}

/** A unit of judgeable work, whatever its source. */
export interface Judgeable {
  caseId: string;
  family: string;
  language: string;
  endedBy?: JudgeCaseInput['endedBy'];
  endedByTool?: JudgeCaseInput['endedByTool'];
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
  if (j.endedByTool !== undefined) input.endedByTool = j.endedByTool;
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
    // Not per-provenance enrichment: every agent-ended case carries it,
    // whatever its source (ADR-0029), so the shape stays uniform.
    ...(c.endedByTool !== undefined ? { endedByTool: c.endedByTool } : {}),
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
    const endedByTool = endedBy === 'agent' ? closingTool(record) : undefined;
    judgeables.push({
      caseId: runCaseId(record.contestantId, record.conversationId),
      family: scenario.family,
      language: scenario.language,
      endedBy,
      ...(endedByTool !== undefined ? { endedByTool } : {}),
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
  itemOrder: JudgeItemOrder;
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
    itemOrder: 'original',
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
      case '--item-order':
        if (value !== 'original' && value !== 'reversed') {
          throw new Error('--item-order=original|reversed');
        }
        options.itemOrder = value;
        break;
      default:
        throw new Error(`unknown flag ${flag}`);
    }
  }
  if (judges.length > 0) options.judges = judges;
  if (options.runId && options.retest) throw new Error('--retest is a calibration-mode flag');
  if (options.retest && options.itemOrder !== 'original') {
    // Two independent axes would need a 4th verdict dir; the ablation design
    // (docs/judge-protocol.md) only ever compares reversed vs the primary pass.
    throw new Error('--item-order=reversed cannot combine with --retest');
  }
  return options;
}

const estTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * A transport failure (`call_failed`) says nothing about the judge's output,
 * and a persisted file would make a resume skip it forever. Judge-format
 * errors (`no_json`, `schema_violation`) are data (ADR-0019) and stay on disk.
 */
export function shouldPersistJudgment(outcome: JudgeCaseResult['outcome']): boolean {
  return !(outcome.kind === 'error' && outcome.code === 'call_failed');
}

/** Where a pass writes its verdicts: calibration primary/reversed/retest, or a run's dir. */
export function verdictBaseDir(
  options: Pick<CliOptions, 'runId' | 'retest' | 'itemOrder'>,
): string {
  if (options.runId) {
    const runJudgmentsDir = options.itemOrder === 'reversed' ? 'judgments-reversed' : 'judgments';
    return join(REPO_ROOT, 'runs', options.runId, runJudgmentsDir);
  }
  if (options.retest) return JUDGMENTS_RETEST_DIR;
  return options.itemOrder === 'reversed' ? JUDGMENTS_REVERSED_DIR : JUDGMENTS_DIR;
}

/**
 * Meta pass filename: `<stamp>-<judge slug | 'multi'>[-reversed]-pass.json`.
 * The stamp alone has one-second resolution, so the three per-judge passes of
 * the documented recipe, started together, overwrote each other's meta file
 * (ADR-0036). No reader parses these names. `discriminator` is the
 * collision fallback (see writeMetaPass), never used on the normal path.
 */
export function metaPassFilename(
  stamp: string,
  judgeRefs: readonly string[],
  itemOrder: JudgeItemOrder,
  discriminator?: string,
): string {
  const slugs = [...new Set(judgeRefs.map(judgeSlug))];
  const who = slugs.length === 1 ? (slugs[0] ?? 'multi') : 'multi';
  return (
    `${stamp}-${who}` +
    (itemOrder === 'reversed' ? '-reversed' : '') +
    (discriminator !== undefined ? `-${discriminator}` : '') +
    '-pass.json'
  );
}

/**
 * Writes a meta pass file and never overwrites one: two `multi` passes on
 * disjoint judge sets can share a stamp (the judge locks do not order them),
 * so a taken name falls back to a pid-suffixed one. Returns the path written.
 */
export function writeMetaPass(
  metaDir: string,
  stamp: string,
  judgeRefs: readonly string[],
  itemOrder: JudgeItemOrder,
  content: string,
): string {
  mkdirSync(metaDir, { recursive: true });
  const first = join(metaDir, metaPassFilename(stamp, judgeRefs, itemOrder));
  try {
    writeFileSync(first, content, { flag: 'wx' });
    return first;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  const fallback = join(
    metaDir,
    metaPassFilename(stamp, judgeRefs, itemOrder, String(process.pid)),
  );
  writeFileSync(fallback, content, { flag: 'wx' });
  return fallback;
}

/**
 * The lock for one judge's verdicts under a base dir. It lives in meta/ - the
 * one subdirectory every verdict reader already skips - and is never a .json
 * file, so no loader can mistake it for a verdict or a judge directory.
 */
export function judgeLockPath(baseDir: string, judgeRef: string): string {
  return join(baseDir, 'meta', `${judgeSlug(judgeRef)}.lock`);
}

export interface JudgeLocks {
  /** Lock files this process holds, in acquisition (sorted slug) order. */
  readonly paths: readonly string[];
  /** Removes every lock this process still holds; idempotent. */
  release(): void;
}

/** `process.kill(pid, 0)` probes without signalling; EPERM means alive but not ours. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLockPid(path: string): { pid?: number; ts?: string } {
  try {
    const holder = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown; ts?: unknown };
    return {
      ...(typeof holder.pid === 'number' && Number.isInteger(holder.pid) && holder.pid > 0
        ? { pid: holder.pid }
        : {}),
      ...(typeof holder.ts === 'string' ? { ts: holder.ts } : {}),
    };
  } catch {
    return {};
  }
}

/** An existing lock is never stolen: a live holder and a dead one are both refusals. */
function refuseExistingLock(path: string): never {
  const { pid, ts } = readLockPid(path);
  if (pid !== undefined && isPidAlive(pid)) {
    throw new Error(
      `judge dir locked: ${path} is held by running pid ${pid}` +
        (ts !== undefined ? ` (since ${ts})` : '') +
        ' - another judge pass is writing this judge here. Wait for it to finish or stop ' +
        'that process; two writers on one judge directory is never allowed (ADR-0036).',
    );
  }
  throw new Error(
    `stale judge lock: ${path} ` +
      (pid !== undefined ? `names pid ${pid}, which is not running` : 'has no readable pid') +
      '. A previous pass ended without releasing it. Confirm nothing is writing to this ' +
      'directory, then delete the lock file by hand and re-run (locks are never taken over ' +
      'automatically).',
  );
}

/**
 * Takes the per-(judge, base dir) locks for a real pass, in sorted slug order
 * so overlapping multi-judge passes contend on the same first lock instead of
 * each holding part of the set; if any one is refused, every lock already
 * taken is released before the error propagates.
 */
export function acquireJudgeLocks(
  baseDir: string,
  judgeRefs: readonly string[],
  argv: readonly string[],
): JudgeLocks {
  const paths = [...new Set(judgeRefs.map((ref) => judgeLockPath(baseDir, ref)))].sort();
  mkdirSync(join(baseDir, 'meta'), { recursive: true });
  const body =
    JSON.stringify({ pid: process.pid, ts: new Date().toISOString(), argv: [...argv] }, null, 2) +
    '\n';
  const held: string[] = [];
  const release = (): void => {
    for (const path of held.splice(0)) {
      // Remove only a lock that still names this process.
      if (readLockPid(path).pid === process.pid) rmSync(path, { force: true });
    }
  };
  try {
    for (const path of paths) {
      try {
        writeFileSync(path, body, { flag: 'wx' });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') refuseExistingLock(path);
        throw err;
      }
      held.push(path);
    }
  } catch (err) {
    release();
    throw err;
  }
  return { paths: [...held], release };
}

/**
 * Ctrl-C / kill releases the locks before exiting (verdicts already written
 * stay; a resume skips them). Returns the uninstaller for the normal path.
 */
function releaseLocksOnExit(locks: JudgeLocks): () => void {
  const onSignal = (signal: NodeJS.Signals): void => {
    locks.release();
    console.error(`${signal}: judge lock(s) released; verdicts written so far are kept.`);
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  const onExit = (): void => locks.release();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('exit', onExit);
  return () => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('exit', onExit);
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const baseDir = verdictBaseDir(options);
  // Before the skip-existing scan: a second writer must be refused before it
  // decides what is "already judged". A dry run writes nothing and locks nothing.
  const locks = options.dryRun
    ? undefined
    : acquireJudgeLocks(baseDir, options.judges, process.argv.slice(2));
  const uninstall = locks ? releaseLocksOnExit(locks) : undefined;
  try {
    await runPass(options, baseDir);
  } finally {
    uninstall?.();
    locks?.release();
  }
}

async function runPass(options: CliOptions, baseDir: string): Promise<void> {
  const items: JudgeItems = loadJudgeItems();
  const sourceDocuments = loadSourceDocuments();

  let judgeables: Judgeable[];
  if (options.runId) {
    const loaded = loadRunJudgeables(options.runId);
    judgeables = loaded.judgeables;
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
    `judge pass: rubric v${items.version}, ${judgeables.length} case(s) x ` +
      `${options.dimensions.length} dimension(s) x ` +
      `${options.judges.length} judge(s) -> ${work.length} call(s)` +
      (options.itemOrder === 'reversed' ? ' [item-order REVERSED ablation]' : '') +
      (skippedExisting > 0 ? ` (${skippedExisting} already judged, skipped)` : ''),
  );

  if (options.dryRun) {
    // ADR-0037: which anchors each conditional dimension will ask, from the
    // same rule the judge call and the parser use.
    for (const dimension of options.dimensions) {
      if (!hasConditionalAnchor(items, dimension)) continue;
      const asked = new Map<string, number>();
      for (const j of judgeables) {
        for (const id of applicableAnchorIds(items, dimension, j.applicability[dimension])) {
          asked.set(id, (asked.get(id) ?? 0) + 1);
        }
      }
      console.log(
        `  ${dimension} anchors: ` +
          rubricAnchors(items, dimension)
            .map(
              (a) =>
                `${a.id} on ${asked.get(a.id) ?? 0}/${judgeables.length} case(s)` +
                (a.appliesWithItem !== undefined
                  ? ` (where ${a.appliesWithItem} is declared)`
                  : ''),
            )
            .join(', '),
      );
    }
    // Estimate at list price; caching makes the real pass cheaper.
    let totalUsd = 0;
    let unpriced = 0;
    for (const judgeRef of options.judges) {
      const { modelId } = parseModelRef(judgeRef);
      let judgeUsd = 0;
      let judgeTokens = 0;
      for (const dimension of options.dimensions) {
        const sysTok = estTokens(
          buildJudgeSystem(items, dimension, sourceDocuments, options.itemOrder),
        );
        for (const j of judgeables) {
          const user = buildJudgeUser(
            withApplicableAnchors(items, dimension, inputFor(j, dimension)),
            options.itemOrder,
          );
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
  let callFailed = 0;
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
          itemOrder: options.itemOrder,
        });
        if (!shouldPersistJudgment(result.outcome)) {
          // Transport failure: no verdict file, so the next resume retries it.
          callFailed += 1;
          return;
        }
        const stored: StoredJudgment = { ...result, judgeRef, ts, itemsVersion: items.version };
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
  writeMetaPass(
    join(baseDir, 'meta'),
    stamp,
    options.judges,
    options.itemOrder,
    JSON.stringify(
      {
        ts,
        source: options.runId ? { run: options.runId } : { calibration: options.cases },
        judges: options.judges,
        dimensions: options.dimensions,
        itemOrder: options.itemOrder,
        cases: judgeables.length,
        judged: done,
        errored,
        callFailed,
        skippedExisting,
        budgetStopped,
        // The rubric the whole pass ran under. promptSha pins the exact bytes,
        // but only the version says whether two passes are COMPARABLE - a
        // mixed-version verdict directory is an agreement statistic computed
        // over two different questionnaires.
        itemsVersion: items.version,
        promptShas: Object.fromEntries(
          options.dimensions.map((d) => [
            d,
            sha256(buildJudgeSystem(items, d, sourceDocuments, options.itemOrder)),
          ]),
        ),
        costs: summary,
      },
      null,
      2,
    ) + '\n',
  );

  console.log(
    `judged ${done}/${work.length} (${errored} structured errors, ${callFailed} call_failed not persisted), ` +
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
