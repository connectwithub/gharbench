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

import {
  aggregateAnchor,
  aggregateBinary,
  anyFlag,
  judgeSlug,
} from '../judge/panel.js';
import { complianceVerdictToPass, expectedToPass, labelToPass, qualityVerdictToPass } from '../judge/polarity.js';
import type { JudgeVerdict } from '../judge/schema.js';
import {
  CALIBRATION_DIR,
  EXPECTED_DIR,
  calibrationExpectedSchema,
  calibrationLabelSchema,
  type CalibrationCase,
  type CalibrationLabel,
} from './calibrationCase.js';
import { SLICE_FILE } from './calibrationSlice.js';
import { JUDGMENTS_DIR, JUDGMENTS_RETEST_DIR, loadCalibrationCases, type StoredJudgment } from './judgeRun.js';
import type { JudgeDimension } from './judgeItems.js';
import { REPO_ROOT } from './scenarioSet.js';

export const AGREEMENT_FILE = join(CALIBRATION_DIR, 'agreement.json');

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

export function loadJudgments(baseDir: string): StoredJudgment[] {
  if (!existsSync(baseDir)) return [];
  const out: StoredJudgment[] = [];
  for (const dir of readdirSync(baseDir, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name === 'meta') continue;
    for (const f of readdirSync(join(baseDir, dir.name))) {
      if (!f.endsWith('.json')) continue;
      out.push(JSON.parse(readFileSync(join(baseDir, dir.name, f), 'utf8')) as StoredJudgment);
    }
  }
  return out;
}

export function loadLabels(rater: string, baseDir: string = CALIBRATION_DIR): Map<string, CalibrationLabel> {
  const dir = join(baseDir, 'labels', rater);
  const out = new Map<string, CalibrationLabel>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const parsed = calibrationLabelSchema.safeParse(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    if (!parsed.success) throw new Error(`${rater}/${f} failed label schema: ${parsed.error.message}`);
    out.set(parsed.data.caseId, parsed.data);
  }
  return out;
}

export function listRaters(baseDir: string = CALIBRATION_DIR): string[] {
  const dir = join(baseDir, 'labels');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
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
export function assembleUnits(
  cases: readonly CalibrationCase[],
  judgments: readonly StoredJudgment[],
  judgeRefs: readonly string[],
): { binaries: BinaryUnit[]; anchors: AnchorUnit[] } {
  const byKey = new Map<string, StoredJudgment>();
  for (const j of judgments) byKey.set(`${judgeSlug(j.judgeRef)}|${j.caseId}|${j.dimension}`, j);

  const verdictFor = (ref: string, caseId: string, dimension: JudgeDimension): JudgeVerdict | null => {
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
export function referenceFromLabels(labels: ReadonlyMap<string, CalibrationLabel>): Map<string, boolean> {
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
export function anchorReference(labels: ReadonlyMap<string, CalibrationLabel>): Map<string, number> {
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

export function pythonBridge(raters: Record<string, (number | null)[]>, level: string): BridgeResult {
  const python = existsSync(VENV_PYTHON) ? VENV_PYTHON : 'python3';
  const stdout = execFileSync(python, [BRIDGE], {
    input: JSON.stringify({ raters, level }),
    encoding: 'utf8',
  });
  return JSON.parse(stdout) as BridgeResult;
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
}

export function compliancePrf(
  cases: readonly CalibrationCase[],
  units: readonly BinaryUnit[],
  expectedByCase: ReadonlyMap<string, readonly string[]>,
): CompliancePrf {
  const bandByCase = new Map(cases.map((c) => [c.caseId, c.band]));
  const confusion: Confusion = { tp: 0, fp: 0, fn: 0, tn: 0 };
  let seededCaught = 0;
  let seededTotal = 0;

  for (const u of units) {
    if (u.dimension !== 'compliance' || u.panelPass === null) continue;
    const violated = expectedByCase.get(u.caseId);
    if (violated === undefined) continue; // no sidecar: real case, no ground truth
    const expectedViolation = !expectedToPass(u.itemId, violated);
    const predictedViolation = !u.panelPass;
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
  const recall = confusion.tp + confusion.fn > 0 ? confusion.tp / (confusion.tp + confusion.fn) : null;
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
    }
  >;
  anchorsG8a: AnchorAgreement[];
  anchorsG8: AnchorAgreement[];
  interJudgeAlphaAnchors: number | null;
  compliancePrf: CompliancePrf;
  retest: Record<string, { units: number; agreementPct: number }>;
}

export function computeAgreement(bridge: BridgeFn = pythonBridge): AgreementReport {
  const cases = loadCalibrationCases();
  const judgments = loadJudgments(JUDGMENTS_DIR);
  const judgeRefs = [...new Set(judgments.map((j) => j.judgeRef))].sort();
  const { binaries, anchors } = assembleUnits(cases, judgments, judgeRefs);

  const selfLabels = loadLabels('self');
  const selfRef = referenceFromLabels(selfLabels);
  const selfAnchorRef = anchorReference(selfLabels);

  const raters = listRaters();
  const sliceIds = existsSync(SLICE_FILE)
    ? new Set<string>((JSON.parse(readFileSync(SLICE_FILE, 'utf8')) as { ids: string[] }).ids)
    : new Set<string>();
  const labelsByRater = new Map(raters.map((r) => [r, loadLabels(r)]));
  const nonSelf = raters.filter((r) => r !== 'self');
  const sliceRef =
    nonSelf.length >= 2 ? adjudicatedReference(labelsByRater, sliceIds) : new Map<string, boolean>();
  const sliceAnchorRef =
    nonSelf.length >= 2
      ? adjudicatedAnchorReference(labelsByRater, sliceIds)
      : new Map<string, number>();

  const expectedByCase = new Map<string, readonly string[]>();
  if (existsSync(EXPECTED_DIR)) {
    for (const f of readdirSync(EXPECTED_DIR)) {
      if (!f.endsWith('.json')) continue;
      const parsed = calibrationExpectedSchema.safeParse(
        JSON.parse(readFileSync(join(EXPECTED_DIR, f), 'utf8')),
      );
      if (parsed.success) expectedByCase.set(parsed.data.caseId, parsed.data.violatedItems);
    }
  }

  const perDimension: AgreementReport['perDimension'] = {};
  for (const dimension of DIMENSIONS) {
    const units = binaries.filter((u) => u.dimension === dimension);
    perDimension[dimension] = {
      g8a: binaryAgreement(units, selfRef, bridge),
      g8: sliceRef.size > 0 ? binaryAgreement(units, sliceRef, bridge) : null,
      interJudgeAlphaBinary: units.length > 0 ? interJudgeAlpha(units, 'binary', bridge) : null,
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
    compliancePrf: compliancePrf(cases, binaries, expectedByCase),
    retest: retestAgreement(judgments, loadJudgments(JUDGMENTS_RETEST_DIR)),
  };
}

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? '-' : n.toFixed(3);
}

function main(): void {
  const report = computeAgreement();
  writeFileSync(AGREEMENT_FILE, JSON.stringify(report, null, 2) + '\n');

  console.log('=== human-judge agreement (Phase 5) ===');
  console.log(
    `${report.counts.cases} cases, ${report.counts.judgments} judgments, ` +
      `${report.counts.selfLabeledCases} self-labeled, slice raters: ` +
      (report.counts.sliceRaters.join(', ') || 'none yet'),
  );
  for (const [dimension, d] of Object.entries(report.perDimension)) {
    console.log(
      `${dimension.padEnd(20)} G8a k=${fmt(d.g8a?.kappa)} (${d.g8a?.units ?? 0}u, raw ${
        d.g8a ? d.g8a.rawAgreementPct.toFixed(1) : '-'
      }%)  G8 k=${fmt(d.g8?.kappa)} (${d.g8?.units ?? 0}u)  inter-judge a=${fmt(d.interJudgeAlphaBinary)}`,
    );
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
    `seeded known-fail recall: ${fmt(prf.recallSeededKnownFails)} over ${prf.seededFailUnits} seeded units`,
  );
  for (const [slug, r] of Object.entries(report.retest)) {
    console.log(`retest ${slug}: ${r.agreementPct.toFixed(1)}% over ${r.units} paired verdicts`);
  }
  console.log(`written: ${AGREEMENT_FILE}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
