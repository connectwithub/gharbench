/**
 * Judge order-robustness report (`pnpm judge:ablations`) - section 1 of
 * docs/judge-protocol.md, which is the pre-registration: the metric, the
 * threshold and the "report it either way" rule were fixed BEFORE the paid
 * pass, so nothing here is tuned after seeing the numbers.
 *
 * It compares the primary judging pass (calibration/judgments) against the
 * reversed-item-order pass (calibration/judgments-reversed, produced by
 * `pnpm judge:calibration --item-order=reversed`) and reports how often the
 * SAME judge changed its mind about the SAME (case, dimension, item) when the
 * rubric was presented back-to-front. Anchors ride along as a secondary line:
 * the same flip metric applies with the 0-3 score compared as a string.
 *
 * This is a REPORT, not a gate. It always exits 0 - the protocol says the
 * flip rate is published whatever it says, and a rate above the threshold
 * means "revise the rubric before headline claims", which is a human decision,
 * not a build failure.
 *
 * The metric itself lives in src/metrics/judgeAblations.ts (pure, unit-tested);
 * this file is only the I/O and the table.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { JUDGE_PANEL, judgeSlug } from '../judge/panel.js';
import { orderFlipRate, type ItemVerdictRecord } from '../metrics/judgeAblations.js';
import { CALIBRATION_DIR } from './calibrationCase.js';
import { assertUniformRubric, itemsVersionsOf } from './judgeAgreement.js';
import {
  DIMENSIONS,
  JUDGMENTS_DIR,
  JUDGMENTS_REVERSED_DIR,
  type StoredJudgment,
} from './judgeRun.js';

export const ABLATIONS_DIR = join(CALIBRATION_DIR, 'ablations');
export const ORDER_FLIP_FILE = join(ABLATIONS_DIR, 'order-flip.json');

/**
 * Pre-registered in docs/judge-protocol.md section 1: "Pre-set threshold: flip
 * rate <= 0.10 per dimension." Changing this number changes the
 * pre-registration, so it changes the protocol document first.
 */
export const ORDER_FLIP_THRESHOLD = 0.1;

// ---------------------------------------------------------------- loading --

/**
 * One judge's verdict files from one pass. `loadJudgments()` in
 * judgeAgreement.ts walks every judge's directory at once, which is the wrong
 * shape here: the ablation is per judge (a flip is only a flip when the same
 * judge produced both verdicts), and the directory name is already the slug
 * `judgmentPath()` writes to.
 */
export function loadJudgeDir(baseDir: string, judgeRef: string): StoredJudgment[] {
  const dir = join(baseDir, judgeSlug(judgeRef));
  if (!existsSync(dir)) return [];
  const judgments = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as StoredJudgment);
  // A flip is only a flip when both passes ran the same rubric under the same
  // prompt; a mixed directory would report rubric churn as judge instability.
  assertUniformRubric(dir, judgments);
  return judgments;
}

/** Item verdicts from already-loaded judgments; error outcomes have none. */
export function itemVerdictsFrom(judgments: readonly StoredJudgment[]): ItemVerdictRecord[] {
  const out: ItemVerdictRecord[] = [];
  for (const j of judgments) {
    if (j.outcome.kind !== 'verdict') continue;
    for (const item of j.outcome.verdict.items) {
      out.push({
        caseId: j.caseId,
        dimension: j.dimension,
        itemId: item.id,
        verdict: item.verdict,
      });
    }
  }
  return out;
}

/**
 * Anchor scores in the same record shape, so the one flip metric covers them
 * too: the 0-3 score is stringified and compared exactly (a 2 -> 3 move under
 * reversal is a flip, same as met -> not_met).
 */
export function anchorScoresFrom(judgments: readonly StoredJudgment[]): ItemVerdictRecord[] {
  const out: ItemVerdictRecord[] = [];
  for (const j of judgments) {
    if (j.outcome.kind !== 'verdict') continue;
    for (const anchor of j.outcome.verdict.anchors) {
      out.push({
        caseId: j.caseId,
        dimension: j.dimension,
        itemId: anchor.id,
        verdict: String(anchor.score),
      });
    }
  }
  return out;
}

/** Structured-error verdict files: never comparable, always counted. */
export function countErrorJudgments(judgments: readonly StoredJudgment[]): number {
  return judgments.filter((j) => j.outcome.kind === 'error').length;
}

export function collectItemVerdicts(baseDir: string, judgeRef: string): ItemVerdictRecord[] {
  return itemVerdictsFrom(loadJudgeDir(baseDir, judgeRef));
}

export function collectAnchorScores(baseDir: string, judgeRef: string): ItemVerdictRecord[] {
  return anchorScoresFrom(loadJudgeDir(baseDir, judgeRef));
}

// ----------------------------------------------------------------- report --

export interface FlipCounts {
  comparable: number;
  flips: number;
  /** null when nothing is comparable - never a fake 0. */
  flipRate: number | null;
}

export interface JudgeFlipRow {
  judgeRef: string;
  slug: string;
  /** Item flips per dimension, plus the anchor flips carried on that dimension. */
  perDimension: Record<string, { items: FlipCounts; anchors: FlipCounts }>;
  totals: { items: FlipCounts; anchors: FlipCounts };
  /** `caseId/dimension/itemId` of every flip, sorted - the audit trail. */
  flippedItemKeys: string[];
  flippedAnchorKeys: string[];
  /** Verdict files skipped because the judge returned a structured error. */
  errors: { original: number; reversed: number };
}

export interface OrderFlipAblationReport {
  generatedAt: string;
  /** docs/judge-protocol.md section 1, pre-registered. */
  threshold: number;
  dirs: {
    original: string;
    reversed: string;
    originalPresent: boolean;
    reversedPresent: boolean;
  };
  judges: JudgeFlipRow[];
  /** Pooled across judges; `withinThreshold` is the section-1 reporting line. */
  perDimension: Record<
    string,
    { items: FlipCounts; anchors: FlipCounts; withinThreshold: boolean | null }
  >;
  totals: { items: FlipCounts; anchors: FlipCounts };
  errors: { original: number; reversed: number };
  /**
   * Verdict directories that belong to no judge in `judges` - loud rather than
   * silently dropped, since a slug cannot be reversed back into a model ref.
   * `archived-*` is excluded: a parked pass is not a stray judge.
   */
  unexpectedJudgeDirs: string[];
  /** Rubric versions behind each pass; two different ones make flips unreadable. */
  versions: { original: string[]; reversed: string[] };
}

const EMPTY: FlipCounts = { comparable: 0, flips: 0, flipRate: null };

function pool(rows: readonly FlipCounts[]): FlipCounts {
  const comparable = rows.reduce((a, r) => a + r.comparable, 0);
  const flips = rows.reduce((a, r) => a + r.flips, 0);
  return { comparable, flips, flipRate: comparable === 0 ? null : flips / comparable };
}

/** null (not false) when there is nothing to judge the threshold against. */
export function withinThreshold(flipRate: number | null): boolean | null {
  return flipRate === null ? null : flipRate <= ORDER_FLIP_THRESHOLD;
}

function compare(
  original: readonly ItemVerdictRecord[],
  reversed: readonly ItemVerdictRecord[],
): { counts: FlipCounts; flippedKeys: string[] } {
  const r = orderFlipRate(original, reversed);
  return {
    counts: { comparable: r.comparable, flips: r.flips, flipRate: r.flipRate },
    flippedKeys: r.flippedKeys,
  };
}

function unexpectedDirs(baseDir: string, expected: ReadonlySet<string>): string[] {
  if (!existsSync(baseDir)) return [];
  return readdirSync(baseDir, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() &&
        d.name !== 'meta' &&
        !d.name.startsWith('archived') &&
        !expected.has(d.name),
    )
    .map((d) => d.name)
    .sort();
}

export function buildOrderFlipReport(
  originalDir: string,
  reversedDir: string,
  judges: readonly string[] = JUDGE_PANEL.map((j) => j.ref),
): OrderFlipAblationReport {
  const allOriginal: StoredJudgment[] = [];
  const allReversed: StoredJudgment[] = [];
  const rows: JudgeFlipRow[] = judges.map((judgeRef) => {
    const original = loadJudgeDir(originalDir, judgeRef);
    const reversed = loadJudgeDir(reversedDir, judgeRef);
    allOriginal.push(...original);
    allReversed.push(...reversed);
    const origItems = itemVerdictsFrom(original);
    const revItems = itemVerdictsFrom(reversed);
    const origAnchors = anchorScoresFrom(original);
    const revAnchors = anchorScoresFrom(reversed);

    const perDimension: JudgeFlipRow['perDimension'] = {};
    for (const dimension of DIMENSIONS) {
      const byDim = (rs: readonly ItemVerdictRecord[]): ItemVerdictRecord[] =>
        rs.filter((r) => r.dimension === dimension);
      perDimension[dimension] = {
        items: compare(byDim(origItems), byDim(revItems)).counts,
        anchors: compare(byDim(origAnchors), byDim(revAnchors)).counts,
      };
    }

    const items = compare(origItems, revItems);
    const anchors = compare(origAnchors, revAnchors);
    return {
      judgeRef,
      slug: judgeSlug(judgeRef),
      perDimension,
      totals: { items: items.counts, anchors: anchors.counts },
      flippedItemKeys: items.flippedKeys,
      flippedAnchorKeys: anchors.flippedKeys,
      errors: {
        original: countErrorJudgments(original),
        reversed: countErrorJudgments(reversed),
      },
    };
  });

  const perDimension: OrderFlipAblationReport['perDimension'] = {};
  for (const dimension of DIMENSIONS) {
    const items = pool(rows.map((r) => r.perDimension[dimension]?.items ?? EMPTY));
    const anchors = pool(rows.map((r) => r.perDimension[dimension]?.anchors ?? EMPTY));
    perDimension[dimension] = { items, anchors, withinThreshold: withinThreshold(items.flipRate) };
  }

  const expectedSlugs = new Set(judges.map((ref) => judgeSlug(ref)));
  return {
    generatedAt: new Date().toISOString(),
    threshold: ORDER_FLIP_THRESHOLD,
    dirs: {
      original: originalDir,
      reversed: reversedDir,
      originalPresent: existsSync(originalDir),
      reversedPresent: existsSync(reversedDir),
    },
    judges: rows,
    perDimension,
    totals: {
      items: pool(rows.map((r) => r.totals.items)),
      anchors: pool(rows.map((r) => r.totals.anchors)),
    },
    errors: {
      original: rows.reduce((a, r) => a + r.errors.original, 0),
      reversed: rows.reduce((a, r) => a + r.errors.reversed, 0),
    },
    unexpectedJudgeDirs: [
      ...new Set([
        ...unexpectedDirs(originalDir, expectedSlugs),
        ...unexpectedDirs(reversedDir, expectedSlugs),
      ]),
    ].sort(),
    versions: { original: itemsVersionsOf(allOriginal), reversed: itemsVersionsOf(allReversed) },
  };
}

// ------------------------------------------------------------------ main ---

const rate = (r: number | null): string => (r === null ? '    -' : r.toFixed(3));
const ok = (r: number | null): string => {
  const w = withinThreshold(r);
  return w === null ? '-' : w ? 'yes' : 'NO';
};

function line(who: string, what: string, c: FlipCounts): string {
  return (
    `${who.padEnd(34)}${what.padEnd(22)}${String(c.comparable).padStart(10)}` +
    `${String(c.flips).padStart(7)}${rate(c.flipRate).padStart(8)}${ok(c.flipRate).padStart(8)}`
  );
}

function main(): void {
  const report = buildOrderFlipReport(JUDGMENTS_DIR, JUDGMENTS_REVERSED_DIR);
  mkdirSync(ABLATIONS_DIR, { recursive: true });
  writeFileSync(ORDER_FLIP_FILE, JSON.stringify(report, null, 2) + '\n');

  console.log('=== judge order robustness (docs/judge-protocol.md section 1) ===');
  console.log(
    `threshold: flip rate <= ${ORDER_FLIP_THRESHOLD.toFixed(2)} per dimension (report, not a gate)`,
  );

  if (!report.dirs.originalPresent || !report.dirs.reversedPresent) {
    if (!report.dirs.originalPresent) {
      console.log(`missing ${report.dirs.original} - run \`pnpm judge:calibration\` first`);
    }
    if (!report.dirs.reversedPresent) {
      console.log(
        `missing ${report.dirs.reversed} - run \`pnpm judge:calibration --item-order=reversed\` first`,
      );
    }
    console.log(`nothing to compare; empty report written: ${ORDER_FLIP_FILE}`);
    return;
  }

  console.log(
    `${'judge'.padEnd(34)}${'dimension'.padEnd(22)}${'comparable'.padStart(10)}` +
      `${'flips'.padStart(7)}${'rate'.padStart(8)}${'<=thr'.padStart(8)}`,
  );
  for (const row of report.judges) {
    for (const dimension of DIMENSIONS) {
      console.log(line(row.slug, dimension, row.perDimension[dimension]?.items ?? EMPTY));
    }
    console.log(line(row.slug, 'anchors (all dims)', row.totals.anchors));
  }

  console.log('');
  for (const dimension of DIMENSIONS) {
    console.log(line('POOLED', dimension, report.perDimension[dimension]?.items ?? EMPTY));
  }
  console.log(line('POOLED', 'items (all dims)', report.totals.items));
  console.log(line('POOLED', 'anchors (all dims)', report.totals.anchors));

  console.log(
    `error verdicts skipped: ${report.errors.original} original, ${report.errors.reversed} reversed`,
  );
  console.log(
    `rubric versions: original [${report.versions.original.join(', ') || 'none'}], ` +
      `reversed [${report.versions.reversed.join(', ') || 'none'}]`,
  );
  if (report.unexpectedJudgeDirs.length > 0) {
    console.log(
      `verdict dirs outside the panel (not compared): ${report.unexpectedJudgeDirs.join(', ')}`,
    );
  }
  console.log(`written: ${ORDER_FLIP_FILE}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
