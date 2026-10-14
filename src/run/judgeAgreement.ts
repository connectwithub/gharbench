/**
 * Human-judge agreement (`pnpm judge:agreement`) - the numbers the Phase 5
 * gates read (Master Plan §4.5, §8 Phase 5).
 *
 * Matrix assembly, polarity normalisation, adjudication and the P/R/F1
 * counting live here in TS (they are bookkeeping); every agreement STATISTIC
 * (kappa, weighted kappa, Krippendorff's alpha, Spearman) comes from the
 * stats-bridge reference implementation - the repo rule is that agreement
 * math is never reimplemented in TypeScript (stats-bridge/agreement.py).
 *
 * Two reference tracks per §4.5/I6:
 *   G8a (provisional): panel vs the author's full-set self-labels.
 *   G8  (the gate):    panel vs the 3-rater adjudicated 50-case slice.
 * Ties are first-class: a human 'tie' (or -1 anchor) drops the unit from the
 * matrix rather than being forced, and adjudication requires a strict
 * majority of non-tie votes.
 *
 * Output: calibration/agreement.json + a console table.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isAnchorApplicable, rubricAnchors } from '../judge/anchorApplicability.js';
import { aggregateAnchor, aggregateBinary, anyFlag, judgeSlug } from '../judge/panel.js';
import { buildJudgeSystem, type JudgeItemOrder } from '../judge/prompt.js';
import {
  complianceVerdictToPass,
  expectedToPass,
  labelToPass,
  qualityVerdictToPass,
} from '../judge/polarity.js';
import type { JudgeVerdict } from '../judge/schema.js';
import {
  CALIBRATION_DIR,
  CASES_DIR,
  EXPECTED_DIR,
  calibrationExpectedSchema,
  calibrationLabelSchema,
  type CalibrationCase,
  type CalibrationLabel,
} from './calibrationCase.js';
import { SLICE_FILE } from './calibrationSlice.js';
import {
  JUDGMENTS_DIR,
  JUDGMENTS_RETEST_DIR,
  JUDGMENTS_REVERSED_DIR,
  loadCalibrationCases,
  loadSourceDocuments,
  type StoredJudgment,
} from './judgeRun.js';
import { loadJudgeItems, type JudgeDimension, type JudgeItems } from './judgeItems.js';
import { sha256 } from '../env/db.js';
import { xorshift32 } from '../metrics/ci.js';
import { REPO_ROOT } from './scenarioSet.js';

export const AGREEMENT_FILE = join(CALIBRATION_DIR, 'agreement.json');

/** Default permutation count for the within-item null (0 disables it). */
export const DEFAULT_PERMUTATIONS = 200;
/** Fixed so the null is reproducible; per-dimension seeds offset from it. */
export const PERMUTATION_SEED = 20261014;

/**
 * Every filesystem location computeAgreement reads or writes, derived from one
 * base directory. No base dir = today's live calibration paths exactly, and
 * the carry-forward guard is ON; a base dir is a historical snapshot (an
 * archive), read self-consistently with the guard OFF.
 */
export interface AgreementPaths {
  baseDir: string;
  casesDir: string;
  judgmentsDir: string;
  reversedDir: string;
  retestDir: string;
  sliceFile: string;
  expectedDir: string;
  outFile: string;
  /** True for a --base-dir snapshot: no comparison against the current builder. */
  historical: boolean;
}

export function agreementPaths(baseDir?: string, outFile?: string): AgreementPaths {
  if (baseDir === undefined) {
    return {
      baseDir: CALIBRATION_DIR,
      casesDir: CASES_DIR,
      judgmentsDir: JUDGMENTS_DIR,
      reversedDir: JUDGMENTS_REVERSED_DIR,
      retestDir: JUDGMENTS_RETEST_DIR,
      sliceFile: SLICE_FILE,
      expectedDir: EXPECTED_DIR,
      outFile: outFile ?? AGREEMENT_FILE,
      historical: false,
    };
  }
  return {
    baseDir,
    casesDir: join(baseDir, 'cases'),
    judgmentsDir: join(baseDir, 'judgments'),
    reversedDir: join(baseDir, 'judgments-reversed'),
    retestDir: join(baseDir, 'judgments-retest'),
    sliceFile: join(baseDir, 'slice-50.json'),
    expectedDir: join(baseDir, 'expected'),
    outFile: outFile ?? join(baseDir, 'agreement.json'),
    historical: true,
  };
}

const DIMENSIONS: readonly JudgeDimension[] = [
  'factuality',
  'compliance',
  'salesEffectiveness',
  'conversationQuality',
];

const ANCHOR_DIMENSION: Record<string, JudgeDimension> = {
  FA1: 'factuality',
  SA1: 'salesEffectiveness',
  SA2: 'salesEffectiveness',
  QA1: 'conversationQuality',
};

// ---------------------------------------------------------------- loading --

/** `itemsVersion` is absent on verdicts written before the rubric was versioned. */
export const UNVERSIONED = 'unversioned';

/** Distinct rubric versions in a verdict set, sorted. */
export function itemsVersionsOf(judgments: readonly StoredJudgment[]): string[] {
  return [...new Set(judgments.map((j) => j.itemsVersion ?? UNVERSIONED))].sort();
}

/**
 * One prompt and one rubric version per (judge, dimension) in a verdict
 * directory - the loudest place to catch a mixed pass. A rubric revision
 * archives the superseded verdicts to a SIBLING folder; if one is left behind
 * (or re-judging half a dimension is interrupted), kappa silently averages two
 * different questionnaires and nothing in the numbers shows it. Throwing here
 * costs a re-run; not throwing costs the measurement.
 */
export function assertUniformRubric(baseDir: string, judgments: readonly StoredJudgment[]): void {
  const seen = new Map<string, { shas: Set<string>; versions: Set<string> }>();
  for (const j of judgments) {
    const key = `${j.judgeRef}|${j.dimension}`;
    const entry = seen.get(key) ?? { shas: new Set<string>(), versions: new Set<string>() };
    entry.shas.add(j.promptSha);
    entry.versions.add(j.itemsVersion ?? UNVERSIONED);
    seen.set(key, entry);
  }
  for (const [key, entry] of [...seen.entries()].sort()) {
    const [judge = '?', dimension = '?'] = key.split('|');
    const where = `${baseDir}: judge ${judge}, dimension ${dimension}`;
    if (entry.shas.size > 1) {
      throw new Error(
        `${where} mixes ${entry.shas.size} judge prompts (promptSha ${[...entry.shas].sort().join(', ')}) - ` +
          'one pass per verdict directory; archive the superseded verdicts to a sibling folder',
      );
    }
    if (entry.versions.size > 1) {
      throw new Error(
        `${where} mixes rubric versions (itemsVersion ${[...entry.versions].sort().join(', ')}) - ` +
          'one rubric per verdict directory; archive the superseded verdicts to a sibling folder',
      );
    }
  }
}

/** Throws if a verdict may not be read alongside the CURRENT rubric. */
export type CarryForwardGuard = (j: StoredJudgment) => void;

/**
 * Carry-forward guard (docs/judge-protocol.md section 7): a verdict written
 * under an OLDER rubric version may stay in a live verdict directory only if
 * its promptSha equals the sha the current builder produces for the same
 * (dimension, item order). That is sha-proven equivalence: the judge saw the
 * exact bytes it would see today, so nothing was carried over on trust.
 *
 * Applies to the LIVE calibration directory only. A `--base-dir` snapshot
 * (an archive) is a closed historical set; it is checked for internal
 * uniformity by assertUniformRubric and never against today's builder.
 */
export function carryForwardGuard(
  itemOrder: JudgeItemOrder,
  items: JudgeItems = loadJudgeItems(),
  sourceDocuments: string = loadSourceDocuments(),
): CarryForwardGuard {
  const shas = new Map<JudgeDimension, string>();
  const currentSha = (d: JudgeDimension): string => {
    let sha = shas.get(d);
    if (sha === undefined) {
      sha = sha256(buildJudgeSystem(items, d, sourceDocuments, itemOrder));
      shas.set(d, sha);
    }
    return sha;
  };
  return (j) => {
    const version = j.itemsVersion ?? UNVERSIONED;
    if (version === items.version) return;
    const current = currentSha(j.dimension);
    if (j.promptSha !== current) {
      throw new Error(
        `carry-forward guard: judge ${j.judgeRef}, dimension ${j.dimension} (${itemOrder} order): ` +
          `verdict ${j.caseId} is itemsVersion ${version} with promptSha ${j.promptSha}, but the ` +
          `current rubric ${items.version} builds ${current} - only sha-identical prior verdicts ` +
          'may stay in the live directory; archive or re-judge it',
      );
    }
  };
}

export function loadJudgments(baseDir: string, guard?: CarryForwardGuard): StoredJudgment[] {
  if (!existsSync(baseDir)) return [];
  const out: StoredJudgment[] = [];
  for (const dir of readdirSync(baseDir, { withFileTypes: true })) {
    // `archived-*` holds a superseded pass parked next to the live one; it is
    // not a judge (same rule as listRaters below).
    if (!dir.isDirectory() || dir.name === 'meta' || dir.name.startsWith('archived')) continue;
    for (const f of readdirSync(join(baseDir, dir.name))) {
      if (!f.endsWith('.json')) continue;
      out.push(JSON.parse(readFileSync(join(baseDir, dir.name, f), 'utf8')) as StoredJudgment);
    }
  }
  assertUniformRubric(baseDir, out);
  if (guard) for (const j of out) guard(j);
  return out;
}

export function loadLabels(
  rater: string,
  baseDir: string = CALIBRATION_DIR,
): Map<string, CalibrationLabel> {
  const dir = join(baseDir, 'labels', rater);
  const out = new Map<string, CalibrationLabel>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const parsed = calibrationLabelSchema.safeParse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    if (!parsed.success)
      throw new Error(`${rater}/${f} failed label schema: ${parsed.error.message}`);
    out.set(parsed.data.caseId, parsed.data);
  }
  return out;
}

/** Distinct rubric versions a rater answered under, sorted. */
export function versionsFromLabels(labels: ReadonlyMap<string, CalibrationLabel>): string[] {
  return [...new Set([...labels.values()].map((l) => l.itemsVersion ?? UNVERSIONED))].sort();
}

/** Rubric versions seen in the verdicts, in the reversed pass, and per rater. */
export interface AgreementVersions {
  judgments: string[];
  judgmentsReversed?: string[];
  labels: Record<string, string[]>;
}

/**
 * A rater who answered questionnaire v1 and a panel judged under v2 are not
 * measuring the same thing, but the kappa still computes - so this is a
 * printed WARNING rather than a throw: the run is usable (the labeler may
 * simply predate versioning), the interpretation is not automatic.
 */
export function versionWarnings(versions: AgreementVersions): string[] {
  const judged = versions.judgments.join(', ') || 'none';
  const out: string[] = [];
  for (const [rater, seen] of Object.entries(versions.labels).sort()) {
    if (seen.length === 0) continue;
    const same =
      seen.length === versions.judgments.length &&
      seen.every((v, i) => v === versions.judgments[i]);
    if (!same) {
      out.push(
        `labels/${rater} answered rubric [${seen.join(', ')}] but the judgments are [${judged}] - ` +
          'the agreement numbers below compare two rubric versions',
      );
    }
  }
  return out;
}

/**
 * Rater directories under calibration/labels. `archived-*` folders hold
 * labels retired by a purge (ADR-0028) and are not raters: without this
 * filter the Phase-5 gate reported "slice raters: archived-purged" and
 * counted a retired label file as a colleague rater (observed 2026-09-20).
 */
export function listRaters(baseDir: string = CALIBRATION_DIR): string[] {
  const dir = join(baseDir, 'labels');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('archived'))
    .map((d) => d.name)
    .sort();
}

// ------------------------------------------------------- panel aggregation --

/** One judge's pass verdict on one binary item, or null if unusable. */
function judgeItemPass(v: JudgeVerdict, dimension: JudgeDimension, itemId: string): boolean | null {
  const item = v.items.find((i) => i.id === itemId);
  if (!item) return null;
  if (dimension === 'compliance') {
    return item.verdict === 'VIOLATION' || item.verdict === 'OK'
      ? complianceVerdictToPass(item.verdict)
      : null;
  }
  return item.verdict === 'met' || item.verdict === 'not_met'
    ? qualityVerdictToPass(item.verdict)
    : null;
}

export interface BinaryUnit {
  caseId: string;
  dimension: JudgeDimension;
  itemId: string;
  /** Per panel judge (ref order as passed), null = no usable verdict. */
  perJudgePass: (boolean | null)[];
  /** D3 aggregation: ANY-flag (compliance) / 2-of-3 majority (others). */
  panelPass: boolean | null;
}

export interface AnchorUnit {
  caseId: string;
  dimension: JudgeDimension;
  anchorId: string;
  perJudgeScore: (number | null)[];
  /** Median across the panel (lower-median on two judges). */
  panelScore: number | null;
}

/**
 * Assemble per-(case,item) units from stored judgments. `judgeRefs` fixes the
 * rater order so inter-judge matrices line up across units.
 */
export interface AssembleOptions {
  /**
   * Opt-in subset for apples-to-apples tables: an anchor with `appliesWithItem`
   * (SA1 with SE6) is kept only for cases whose applicability declares that
   * item. Default off - anchor units stay verdict-driven.
   */
  declaredOnly?: boolean;
  items?: JudgeItems;
}

export function assembleUnits(
  cases: readonly CalibrationCase[],
  judgments: readonly StoredJudgment[],
  judgeRefs: readonly string[],
  options: AssembleOptions = {},
): { binaries: BinaryUnit[]; anchors: AnchorUnit[] } {
  const conditional = new Map<JudgeDimension, Map<string, string>>();
  if (options.declaredOnly) {
    const items = options.items ?? loadJudgeItems();
    for (const dimension of DIMENSIONS) {
      const m = new Map<string, string>();
      for (const a of rubricAnchors(items, dimension)) {
        if (a.appliesWithItem !== undefined) m.set(a.id, a.appliesWithItem);
      }
      conditional.set(dimension, m);
    }
  }
  const byKey = new Map<string, StoredJudgment>();
  for (const j of judgments) byKey.set(`${judgeSlug(j.judgeRef)}|${j.caseId}|${j.dimension}`, j);

  const verdictFor = (
    ref: string,
    caseId: string,
    dimension: JudgeDimension,
  ): JudgeVerdict | null => {
    const stored = byKey.get(`${judgeSlug(ref)}|${caseId}|${dimension}`);
    return stored && stored.outcome.kind === 'verdict' ? stored.outcome.verdict : null;
  };

  const binaries: BinaryUnit[] = [];
  const anchors: AnchorUnit[] = [];

  for (const c of cases) {
    for (const dimension of DIMENSIONS) {
      const verdicts = judgeRefs.map((ref) => verdictFor(ref, c.caseId, dimension));
      for (const itemId of c.judgeApplicability[dimension]) {
        const perJudgePass = verdicts.map((v) => (v ? judgeItemPass(v, dimension, itemId) : null));
        const valid = perJudgePass.filter((p): p is boolean => p !== null);
        let panelPass: boolean | null;
        if (valid.length === 0) {
          panelPass = null;
        } else if (dimension === 'compliance') {
          panelPass = !anyFlag(valid.map((p) => (p ? 'OK' : 'VIOLATION')));
        } else {
          const majority = aggregateBinary(valid.map((p) => (p ? 'met' : 'not_met')));
          panelPass = majority === 'unscored' ? null : majority === 'met';
        }
        binaries.push({ caseId: c.caseId, dimension, itemId, perJudgePass, panelPass });
      }
      // Anchors ride on the dimension's verdicts, independent of applicability.
      const anchorIds = new Set<string>();
      for (const v of verdicts) for (const a of v?.anchors ?? []) anchorIds.add(a.id);
      for (const anchorId of [...anchorIds].sort()) {
        const gate = conditional.get(dimension)?.get(anchorId);
        if (
          gate !== undefined &&
          !isAnchorApplicable({ appliesWithItem: gate }, c.judgeApplicability[dimension])
        ) {
          continue;
        }
        const perJudgeScore = verdicts.map(
          (v) => v?.anchors.find((a) => a.id === anchorId)?.score ?? null,
        );
        const valid = perJudgeScore.filter((s): s is number => s !== null);
        anchors.push({
          caseId: c.caseId,
          dimension,
          anchorId,
          perJudgeScore,
          panelScore: aggregateAnchor(valid),
        });
      }
    }
  }
  return { binaries, anchors };
}

// -------------------------------------------------------- human reference --

/** Self labels -> pass per (caseId,itemId); ties dropped. */
export function referenceFromLabels(
  labels: ReadonlyMap<string, CalibrationLabel>,
): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const [caseId, label] of labels) {
    for (const [itemId, value] of Object.entries(label.binary)) {
      if (value === 'tie') continue;
      out.set(`${caseId}|${itemId}`, labelToPass(itemId, value));
    }
  }
  return out;
}

/**
 * 3-rater adjudication on the slice: strict majority of non-tie votes per
 * (case,item); no majority -> unit dropped (ties preserved, §4.5).
 */
export function adjudicatedReference(
  labelsByRater: ReadonlyMap<string, ReadonlyMap<string, CalibrationLabel>>,
  sliceIds: ReadonlySet<string>,
): Map<string, boolean> {
  const votes = new Map<string, boolean[]>();
  for (const labels of labelsByRater.values()) {
    for (const [caseId, label] of labels) {
      if (!sliceIds.has(caseId)) continue;
      for (const [itemId, value] of Object.entries(label.binary)) {
        if (value === 'tie') continue;
        const key = `${caseId}|${itemId}`;
        const bucket = votes.get(key) ?? [];
        bucket.push(labelToPass(itemId, value));
        votes.set(key, bucket);
      }
    }
  }
  const out = new Map<string, boolean>();
  for (const [key, bucket] of votes) {
    const pass = bucket.filter(Boolean).length;
    const fail = bucket.length - pass;
    if (pass > fail) out.set(key, true);
    else if (fail > pass) out.set(key, false);
    // pass === fail: no majority, dropped.
  }
  return out;
}

/** Self anchor scores per (caseId,anchorId); -1 (tie) dropped. */
export function anchorReference(
  labels: ReadonlyMap<string, CalibrationLabel>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [caseId, label] of labels) {
    for (const [anchorId, score] of Object.entries(label.anchors)) {
      if (score === -1) continue;
      out.set(`${caseId}|${anchorId}`, score);
    }
  }
  return out;
}

/**
 * 3-rater anchor adjudication on the slice: median of the non-tie scores
 * (same lower-median rule as the panel), needing at least two votes.
 */
export function adjudicatedAnchorReference(
  labelsByRater: ReadonlyMap<string, ReadonlyMap<string, CalibrationLabel>>,
  sliceIds: ReadonlySet<string>,
): Map<string, number> {
  const votes = new Map<string, number[]>();
  for (const labels of labelsByRater.values()) {
    for (const [caseId, label] of labels) {
      if (!sliceIds.has(caseId)) continue;
      for (const [anchorId, score] of Object.entries(label.anchors)) {
        if (score === -1) continue;
        const key = `${caseId}|${anchorId}`;
        const bucket = votes.get(key) ?? [];
        bucket.push(score);
        votes.set(key, bucket);
      }
    }
  }
  const out = new Map<string, number>();
  for (const [key, bucket] of votes) {
    const median = aggregateAnchor(bucket);
    if (median !== null) out.set(key, median);
  }
  return out;
}

// ------------------------------------------------------------- statistics --

interface BridgeResult {
  krippendorff_alpha: number | null;
  cohen_kappa: number | null;
  weighted_kappa: number | null;
  spearman: number | null;
  pearson: number | null;
}

const BRIDGE = join(REPO_ROOT, 'stats-bridge', 'agreement.py');
const VENV_PYTHON = join(REPO_ROOT, 'stats-bridge', '.venv', 'bin', 'python');

export type BridgeFn = (raters: Record<string, (number | null)[]>, level: string) => BridgeResult;

export function pythonBridge(
  raters: Record<string, (number | null)[]>,
  level: string,
): BridgeResult {
  const python = existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';
  const stdout = execFileSync(python, [BRIDGE], {
    input: JSON.stringify({ raters, level }),
    encoding: 'utf8',
  });
  // Python's json emits bare NaN for undefined statistics (a constant column,
  // routine per item); read it as null = "not defined", never as a number.
  return JSON.parse(stdout.replace(/\bNaN\b/g, 'null')) as BridgeResult;
}

export interface BinaryAgreement {
  units: number;
  kappa: number | null;
  /** Raw percent agreement, reported alongside (chance-corrected metrics deflate under skew). */
  rawAgreementPct: number;
}

/** Human-vs-panel on shared units; kappa from the bridge, raw % in TS. */
export function binaryAgreement(
  units: readonly BinaryUnit[],
  reference: ReadonlyMap<string, boolean>,
  bridge: BridgeFn,
): BinaryAgreement | null {
  const human: number[] = [];
  const panel: number[] = [];
  for (const u of units) {
    const ref = reference.get(`${u.caseId}|${u.itemId}`);
    if (ref === undefined || u.panelPass === null) continue;
    human.push(ref ? 1 : 0);
    panel.push(u.panelPass ? 1 : 0);
  }
  if (human.length === 0) return null;
  const agree = human.filter((h, i) => h === panel[i]).length;
  const stats = bridge({ human, panel }, 'nominal');
  return {
    units: human.length,
    kappa: stats.cohen_kappa,
    rawAgreementPct: (100 * agree) / human.length,
  };
}

/** Per-item kappa (human vs panel), items sorted; same units rule as binaryAgreement. */
export function perItemAgreement(
  units: readonly BinaryUnit[],
  reference: ReadonlyMap<string, boolean>,
  bridge: BridgeFn,
): Record<string, BinaryAgreement> {
  const byItem = new Map<string, BinaryUnit[]>();
  for (const u of units) {
    const bucket = byItem.get(u.itemId) ?? [];
    bucket.push(u);
    byItem.set(u.itemId, bucket);
  }
  // The bridge's alpha raises on a single-valued domain, which is routine per
  // item (everyone passes CP5); kappa is undefined there, so answer null
  // without calling it. Raw agreement still reads.
  const guarded: BridgeFn = (raters, level) => {
    const constant = Object.values(raters).some((col) => new Set(col).size < 2);
    return constant
      ? {
          krippendorff_alpha: null,
          cohen_kappa: null,
          weighted_kappa: null,
          spearman: null,
          pearson: null,
        }
      : bridge(raters, level);
  };
  const out: Record<string, BinaryAgreement> = {};
  for (const [itemId, bucket] of [...byItem.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const agreement = binaryAgreement(bucket, reference, guarded);
    if (agreement) out[itemId] = agreement;
  }
  return out;
}

export interface PermutationNull {
  permutations: number;
  seed: number;
  /** Pooled observed kappa, repeated here so the null reads next to it. */
  observedKappa: number | null;
  /** Mean of the pooled kappa over permutations with a defined kappa. */
  nullMeanKappa: number | null;
  nullMinKappa: number | null;
  nullMaxKappa: number | null;
  /** Permutations whose kappa was undefined (constant column) and are excluded. */
  undefinedPermutations: number;
}

/**
 * Within-item permutation null for the pooled kappa. Pooled kappa over several
 * items can be positive purely because items differ in pass rate (a judge and a
 * human who both pass 95% of one item and 40% of another "agree" without ever
 * agreeing on a case). Shuffling the panel verdicts across cases WITHIN each
 * item keeps every item's pass rate and destroys all case-level agreement, so
 * the null mean is the kappa that item-rate structure alone produces. Seeded
 * xorshift32 (no Math.random); kappa from the bridge as always.
 */
export function withinItemPermutationNull(
  units: readonly BinaryUnit[],
  reference: ReadonlyMap<string, boolean>,
  bridge: BridgeFn,
  permutations: number,
  seed: number,
): PermutationNull {
  const byItem = new Map<string, { human: number[]; panel: number[] }>();
  for (const u of units) {
    const ref = reference.get(`${u.caseId}|${u.itemId}`);
    if (ref === undefined || u.panelPass === null) continue;
    const bucket = byItem.get(u.itemId) ?? { human: [], panel: [] };
    bucket.human.push(ref ? 1 : 0);
    bucket.panel.push(u.panelPass ? 1 : 0);
    byItem.set(u.itemId, bucket);
  }
  const items = [...byItem.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v);
  const human = items.flatMap((i) => i.human);
  const observedKappa =
    human.length === 0
      ? null
      : bridge({ human, panel: items.flatMap((i) => i.panel) }, 'nominal').cohen_kappa;
  const rand = xorshift32(seed);
  const kappas: number[] = [];
  let undefinedPermutations = 0;
  if (human.length > 0) {
    for (let p = 0; p < permutations; p += 1) {
      const panel: number[] = [];
      for (const item of items) {
        const shuffled = [...item.panel];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          const j = Math.floor(rand() * (i + 1));
          const tmp = shuffled[i] as number;
          shuffled[i] = shuffled[j] as number;
          shuffled[j] = tmp;
        }
        panel.push(...shuffled);
      }
      const k = bridge({ human, panel }, 'nominal').cohen_kappa;
      if (k === null || Number.isNaN(k)) undefinedPermutations += 1;
      else kappas.push(k);
    }
  }
  return {
    permutations,
    seed,
    observedKappa,
    nullMeanKappa: kappas.length > 0 ? kappas.reduce((a, b) => a + b, 0) / kappas.length : null,
    nullMinKappa: kappas.length > 0 ? Math.min(...kappas) : null,
    nullMaxKappa: kappas.length > 0 ? Math.max(...kappas) : null,
    undefinedPermutations,
  };
}

export interface AnchorAgreement {
  anchorId: string;
  dimension: JudgeDimension;
  units: number;
  weightedKappa: number | null;
  spearman: number | null;
}

export function anchorAgreement(
  units: readonly AnchorUnit[],
  reference: ReadonlyMap<string, number>,
  bridge: BridgeFn,
): AnchorAgreement[] {
  const byAnchor = new Map<string, { human: number[]; panel: number[] }>();
  for (const u of units) {
    const ref = reference.get(`${u.caseId}|${u.anchorId}`);
    if (ref === undefined || u.panelScore === null) continue;
    const bucket = byAnchor.get(u.anchorId) ?? { human: [], panel: [] };
    bucket.human.push(ref);
    bucket.panel.push(u.panelScore);
    byAnchor.set(u.anchorId, bucket);
  }
  return [...byAnchor.entries()].sort().map(([anchorId, { human, panel }]) => {
    const stats = bridge({ human, panel }, 'ordinal');
    return {
      anchorId,
      dimension: ANCHOR_DIMENSION[anchorId] ?? 'conversationQuality',
      units: human.length,
      weightedKappa: stats.weighted_kappa,
      spearman: stats.spearman,
    };
  });
}

/** Krippendorff's alpha across the three judges (correlated-error check). */
export function interJudgeAlpha(
  units: readonly (BinaryUnit | AnchorUnit)[],
  kind: 'binary' | 'anchor',
  bridge: BridgeFn,
): number | null {
  const raters: Record<string, (number | null)[]> = {};
  const width = units[0]
    ? 'perJudgePass' in units[0]
      ? units[0].perJudgePass.length
      : units[0].perJudgeScore.length
    : 0;
  if (width === 0) return null;
  for (let j = 0; j < width; j += 1) {
    raters[`judge${j}`] = units.map((u) =>
      'perJudgePass' in u
        ? u.perJudgePass[j] === null || u.perJudgePass[j] === undefined
          ? null
          : u.perJudgePass[j]
            ? 1
            : 0
        : (u.perJudgeScore[j] ?? null),
    );
  }
  const usable = units.length > 0 && Object.values(raters).some((r) => r.some((v) => v !== null));
  if (!usable) return null;
  return bridge(raters, kind === 'binary' ? 'nominal' : 'ordinal').krippendorff_alpha;
}

// -------------------------------------------------------------- P/R/F1 -----

export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export interface CompliancePrf {
  /** Positive class = violation, over sidecar-covered CP units. */
  confusion: Confusion;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  /** The G8 clause (c) number: recall restricted to known_fail-band cases. */
  recallSeededKnownFails: number | null;
  seededFailUnits: number;
  /**
   * Flags excluded as neither TP nor FP because the sidecar lists the item in
   * `alsoCovered`: the judge caught the seeded act under a second item wording.
   * Recall is untouched - `violatedItems` is still the whole denominator.
   */
  alsoCoveredFlags: number;
}

export function compliancePrf(
  cases: readonly CalibrationCase[],
  units: readonly BinaryUnit[],
  expectedByCase: ReadonlyMap<string, readonly string[]>,
  alsoCoveredByCase: ReadonlyMap<string, readonly string[]> = new Map(),
): CompliancePrf {
  const bandByCase = new Map(cases.map((c) => [c.caseId, c.band]));
  const confusion: Confusion = { tp: 0, fp: 0, fn: 0, tn: 0 };
  let seededCaught = 0;
  let seededTotal = 0;
  let alsoCoveredFlags = 0;

  for (const u of units) {
    if (u.dimension !== 'compliance' || u.panelPass === null) continue;
    const violated = expectedByCase.get(u.caseId);
    if (violated === undefined) continue; // no sidecar: real case, no ground truth
    const expectedViolation = !expectedToPass(u.itemId, violated);
    const predictedViolation = !u.panelPass;
    if (
      !expectedViolation &&
      predictedViolation &&
      (alsoCoveredByCase.get(u.caseId) ?? []).includes(u.itemId)
    ) {
      alsoCoveredFlags += 1;
      continue; // under-specified key, not a judge error
    }
    if (expectedViolation && predictedViolation) confusion.tp += 1;
    else if (!expectedViolation && predictedViolation) confusion.fp += 1;
    else if (expectedViolation && !predictedViolation) confusion.fn += 1;
    else confusion.tn += 1;
    if (expectedViolation && bandByCase.get(u.caseId) === 'known_fail') {
      seededTotal += 1;
      if (predictedViolation) seededCaught += 1;
    }
  }

  const precision =
    confusion.tp + confusion.fp > 0 ? confusion.tp / (confusion.tp + confusion.fp) : null;
  const recall =
    confusion.tp + confusion.fn > 0 ? confusion.tp / (confusion.tp + confusion.fn) : null;
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null;
  return {
    confusion,
    precision,
    recall,
    f1,
    recallSeededKnownFails: seededTotal > 0 ? seededCaught / seededTotal : null,
    seededFailUnits: seededTotal,
    alsoCoveredFlags,
  };
}

// -------------------------------------------------------------- retest -----

/** Percent of identical (item verdict / anchor score) pairs across the two passes. */
export function retestAgreement(
  first: readonly StoredJudgment[],
  second: readonly StoredJudgment[],
): Record<string, { units: number; agreementPct: number }> {
  const byKey = new Map<string, StoredJudgment>();
  for (const j of second) byKey.set(`${judgeSlug(j.judgeRef)}|${j.caseId}|${j.dimension}`, j);

  const perJudge = new Map<string, { same: number; total: number }>();
  for (const a of first) {
    if (a.outcome.kind !== 'verdict') continue;
    const b = byKey.get(`${judgeSlug(a.judgeRef)}|${a.caseId}|${a.dimension}`);
    if (!b || b.outcome.kind !== 'verdict') continue;
    const slug = judgeSlug(a.judgeRef);
    const counts = perJudge.get(slug) ?? { same: 0, total: 0 };
    for (const item of a.outcome.verdict.items) {
      const other = b.outcome.verdict.items.find((i) => i.id === item.id);
      if (!other) continue;
      counts.total += 1;
      if (other.verdict === item.verdict) counts.same += 1;
    }
    for (const anchor of a.outcome.verdict.anchors) {
      const other = b.outcome.verdict.anchors.find((x) => x.id === anchor.id);
      if (!other) continue;
      counts.total += 1;
      if (other.score === anchor.score) counts.same += 1;
    }
    perJudge.set(slug, counts);
  }

  return Object.fromEntries(
    [...perJudge.entries()].map(([slug, c]) => [
      slug,
      { units: c.total, agreementPct: c.total > 0 ? (100 * c.same) / c.total : 0 },
    ]),
  );
}

// ------------------------------------------------------------------ main ---

export interface AgreementReport {
  generatedAt: string;
  counts: {
    cases: number;
    judgments: number;
    selfLabeledCases: number;
    sliceRaters: string[];
  };
  perDimension: Record<
    string,
    {
      g8a: BinaryAgreement | null;
      g8: BinaryAgreement | null;
      interJudgeAlphaBinary: number | null;
      /** Per-item G8a kappa (human self vs panel), items sorted. */
      perItemG8a?: Record<string, BinaryAgreement>;
      /** Within-item permutation null for the pooled G8a kappa. */
      permutationNullG8a?: PermutationNull | null;
    }
  >;
  anchorsG8a: AnchorAgreement[];
  anchorsG8: AnchorAgreement[];
  interJudgeAlphaAnchors: number | null;
  compliancePrf: CompliancePrf;
  retest: Record<string, { units: number; agreementPct: number }>;
  /** Which rubric the verdicts and the human labels were produced under. */
  versions: AgreementVersions;
  /** Non-fatal version mismatches; printed as WARNING lines by main(). */
  versionWarnings: string[];
  /** How this report was produced; absent in files written before v3. */
  options?: {
    baseDir: string;
    historical: boolean;
    declaredOnly: boolean;
    permutations: number;
  };
}

export interface ComputeAgreementOptions {
  baseDir?: string;
  outFile?: string;
  declaredOnly?: boolean;
  permutations?: number;
}

export function computeAgreement(
  bridge: BridgeFn = pythonBridge,
  options: ComputeAgreementOptions = {},
): AgreementReport {
  const paths = agreementPaths(options.baseDir, options.outFile);
  const permutations = options.permutations ?? DEFAULT_PERMUTATIONS;
  const declaredOnly = options.declaredOnly ?? false;
  const cases = loadCalibrationCases(paths.casesDir);
  const guarded = !paths.historical;
  const items = loadJudgeItems();
  const sourceDocuments = guarded ? loadSourceDocuments() : '';
  const judgments = loadJudgments(
    paths.judgmentsDir,
    guarded ? carryForwardGuard('original', items, sourceDocuments) : undefined,
  );
  const judgeRefs = [...new Set(judgments.map((j) => j.judgeRef))].sort();
  const { binaries, anchors } = assembleUnits(cases, judgments, judgeRefs, {
    declaredOnly,
    items,
  });

  const selfLabels = loadLabels('self', paths.baseDir);
  const selfRef = referenceFromLabels(selfLabels);
  const selfAnchorRef = anchorReference(selfLabels);

  const raters = listRaters(paths.baseDir);
  const sliceIds = existsSync(paths.sliceFile)
    ? new Set<string>((JSON.parse(readFileSync(paths.sliceFile, 'utf8')) as { ids: string[] }).ids)
    : new Set<string>();
  const labelsByRater = new Map(raters.map((r) => [r, loadLabels(r, paths.baseDir)]));
  const nonSelf = raters.filter((r) => r !== 'self');
  const sliceRef =
    nonSelf.length >= 2
      ? adjudicatedReference(labelsByRater, sliceIds)
      : new Map<string, boolean>();
  const sliceAnchorRef =
    nonSelf.length >= 2
      ? adjudicatedAnchorReference(labelsByRater, sliceIds)
      : new Map<string, number>();

  const expectedByCase = new Map<string, readonly string[]>();
  const alsoCoveredByCase = new Map<string, readonly string[]>();
  if (existsSync(paths.expectedDir)) {
    for (const f of readdirSync(paths.expectedDir)) {
      if (!f.endsWith('.json')) continue;
      const parsed = calibrationExpectedSchema.safeParse(
        JSON.parse(readFileSync(join(paths.expectedDir, f), 'utf8')),
      );
      if (parsed.success) {
        expectedByCase.set(parsed.data.caseId, parsed.data.violatedItems);
        if (parsed.data.alsoCovered)
          alsoCoveredByCase.set(parsed.data.caseId, parsed.data.alsoCovered);
      }
    }
  }

  const versions: AgreementVersions = {
    judgments: itemsVersionsOf(judgments),
    labels: Object.fromEntries([...labelsByRater].map(([r, l]) => [r, versionsFromLabels(l)])),
  };
  if (existsSync(paths.reversedDir)) {
    versions.judgmentsReversed = itemsVersionsOf(
      loadJudgments(
        paths.reversedDir,
        guarded ? carryForwardGuard('reversed', items, sourceDocuments) : undefined,
      ),
    );
  }

  const perDimension: AgreementReport['perDimension'] = {};
  for (const dimension of DIMENSIONS) {
    const units = binaries.filter((u) => u.dimension === dimension);
    perDimension[dimension] = {
      g8a: binaryAgreement(units, selfRef, bridge),
      g8: sliceRef.size > 0 ? binaryAgreement(units, sliceRef, bridge) : null,
      interJudgeAlphaBinary: units.length > 0 ? interJudgeAlpha(units, 'binary', bridge) : null,
      perItemG8a: perItemAgreement(units, selfRef, bridge),
      permutationNullG8a:
        permutations > 0
          ? withinItemPermutationNull(
              units,
              selfRef,
              bridge,
              permutations,
              PERMUTATION_SEED + DIMENSIONS.indexOf(dimension),
            )
          : null,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      cases: cases.length,
      judgments: judgments.length,
      selfLabeledCases: selfLabels.size,
      sliceRaters: nonSelf,
    },
    perDimension,
    anchorsG8a: anchorAgreement(anchors, selfAnchorRef, bridge),
    anchorsG8: sliceAnchorRef.size > 0 ? anchorAgreement(anchors, sliceAnchorRef, bridge) : [],
    interJudgeAlphaAnchors: anchors.length > 0 ? interJudgeAlpha(anchors, 'anchor', bridge) : null,
    compliancePrf: compliancePrf(cases, binaries, expectedByCase, alsoCoveredByCase),
    retest: retestAgreement(judgments, loadJudgments(paths.retestDir)),
    versions,
    versionWarnings: versionWarnings(versions),
    options: {
      baseDir: paths.baseDir,
      historical: paths.historical,
      declaredOnly,
      permutations,
    },
  };
}

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? '-' : n.toFixed(3);
}

export interface AgreementCli {
  baseDir?: string;
  outFile?: string;
  declaredOnly: boolean;
  permutations: number;
}

export function parseAgreementArgs(argv: readonly string[]): AgreementCli {
  const cli: AgreementCli = { declaredOnly: false, permutations: DEFAULT_PERMUTATIONS };
  for (const arg of argv) {
    if (arg === '--declared-only') cli.declaredOnly = true;
    else if (arg.startsWith('--base-dir=')) cli.baseDir = arg.slice('--base-dir='.length);
    else if (arg.startsWith('--out=')) cli.outFile = arg.slice('--out='.length);
    else if (arg.startsWith('--permutations=')) {
      const n = Number(arg.slice('--permutations='.length));
      if (!Number.isInteger(n) || n < 0) throw new Error(`bad ${arg}: want an integer >= 0`);
      cli.permutations = n;
    } else throw new Error(`unknown argument ${arg}`);
  }
  return cli;
}

function main(): void {
  const cli = parseAgreementArgs(process.argv.slice(2));
  const paths = agreementPaths(cli.baseDir, cli.outFile);
  const report = computeAgreement(pythonBridge, {
    ...(cli.baseDir !== undefined ? { baseDir: cli.baseDir } : {}),
    ...(cli.outFile !== undefined ? { outFile: cli.outFile } : {}),
    declaredOnly: cli.declaredOnly,
    permutations: cli.permutations,
  });
  writeFileSync(paths.outFile, JSON.stringify(report, null, 2) + '\n');

  console.log('=== human-judge agreement (Phase 5) ===');
  console.log(
    `${report.counts.cases} cases, ${report.counts.judgments} judgments, ` +
      `${report.counts.selfLabeledCases} self-labeled, slice raters: ` +
      (report.counts.sliceRaters.join(', ') || 'none yet'),
  );
  console.log(
    `rubric: judgments [${report.versions.judgments.join(', ') || 'none'}]` +
      (report.versions.judgmentsReversed
        ? `, reversed [${report.versions.judgmentsReversed.join(', ')}]`
        : '') +
      `, labels ${
        Object.entries(report.versions.labels)
          .map(([r, v]) => `${r} [${v.join(', ') || 'none'}]`)
          .join(' ') || 'none'
      }`,
  );
  for (const w of report.versionWarnings) console.log(`WARNING: ${w}`);
  for (const [dimension, d] of Object.entries(report.perDimension)) {
    console.log(
      `${dimension.padEnd(20)} G8a k=${fmt(d.g8a?.kappa)} (${d.g8a?.units ?? 0}u, raw ${
        d.g8a ? d.g8a.rawAgreementPct.toFixed(1) : '-'
      }%)  G8 k=${fmt(d.g8?.kappa)} (${d.g8?.units ?? 0}u)  inter-judge a=${fmt(d.interJudgeAlphaBinary)}` +
        (d.permutationNullG8a
          ? `  within-item null k=${fmt(d.permutationNullG8a.nullMeanKappa)} (${d.permutationNullG8a.permutations} perms)`
          : ''),
    );
    for (const [itemId, a] of Object.entries(d.perItemG8a ?? {})) {
      console.log(
        `    ${itemId.padEnd(6)} k=${fmt(a.kappa)} (${a.units}u, raw ${a.rawAgreementPct.toFixed(1)}%)`,
      );
    }
  }
  for (const a of report.anchorsG8a) {
    console.log(
      `anchor ${a.anchorId} (${a.dimension})  weighted-k=${fmt(a.weightedKappa)}  rho=${fmt(a.spearman)}  (${a.units}u)`,
    );
  }
  const prf = report.compliancePrf;
  console.log(
    `compliance P/R/F1 (violation class): P=${fmt(prf.precision)} R=${fmt(prf.recall)} F1=${fmt(prf.f1)} ` +
      `confusion tp=${prf.confusion.tp} fp=${prf.confusion.fp} fn=${prf.confusion.fn} tn=${prf.confusion.tn}`,
  );
  console.log(
    `seeded known-fail recall: ${fmt(prf.recallSeededKnownFails)} over ${prf.seededFailUnits} seeded units` +
      ` (${prf.alsoCoveredFlags} flags excluded as alsoCovered)`,
  );
  for (const [slug, r] of Object.entries(report.retest)) {
    console.log(`retest ${slug}: ${r.agreementPct.toFixed(1)}% over ${r.units} paired verdicts`);
  }
  console.log(`written: ${paths.outFile}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
