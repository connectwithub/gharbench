/**
 * The order-robustness report (`pnpm judge:ablations`, docs/judge-protocol.md
 * section 1). The flip metric itself is covered in judgeAblations.test.ts;
 * what is pinned here is the I/O layer around it - that error verdicts are
 * skipped and counted rather than read as agreement, that an item judged in
 * only one pass is not comparable, that anchors are a separate line from
 * items, and that the pre-registered 0.10 threshold is applied per dimension
 * with a null (never a false) when there is nothing to compare.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  ORDER_FLIP_THRESHOLD,
  assertSharedItemsVersion,
  parseAblationArgs,
  buildOrderFlipReport,
  collectAnchorScores,
  collectItemVerdicts,
  countErrorJudgments,
  loadJudgeDir,
} from '../src/run/judgeAblationsRun.js';
import { judgmentPath, type StoredJudgment } from '../src/run/judgeRun.js';
import type { JudgeDimension } from '../src/run/judgeItems.js';
import type { JudgeItemVerdict, JudgeVerdict } from '../src/judge/schema.js';

const JUDGE = 'openrouter/x-ai/test-judge@xAI';

const root = mkdtempSync(join(tmpdir(), 'gharbench-ablate-'));
const ORIGINAL = join(root, 'judgments');
const REVERSED = join(root, 'judgments-reversed');
afterAll(() => rmSync(root, { recursive: true, force: true }));

function verdict(
  dimension: JudgeDimension,
  items: Record<string, JudgeItemVerdict['verdict']>,
  anchors: Record<string, number> = {},
): JudgeVerdict {
  return {
    dimension,
    items: Object.entries(items).map(([id, v]) => ({
      id,
      verdict: v,
      evidence: 'q',
      turn: null,
      evidenceFound: null,
      justification: 'x',
    })),
    anchors: Object.entries(anchors).map(([id, score]) => ({
      id,
      score,
      evidence: 'q',
      evidenceFound: null,
      justification: 'x',
    })),
    notes: '',
  };
}

function write(
  baseDir: string,
  caseId: string,
  dimension: JudgeDimension,
  outcome: StoredJudgment['outcome'],
): void {
  const stored: StoredJudgment = {
    caseId,
    dimension,
    attempts: 1,
    promptSha: 'deadbeef',
    outcome,
    judgeRef: JUDGE,
    ts: '2026-09-20T00:00:00.000Z',
  };
  const path = judgmentPath(baseDir, JUDGE, caseId, dimension);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(stored, null, 2) + '\n');
}

// --- compliance: 10 comparable items, exactly one flip -> rate 0.10 (the
// pre-registered boundary, inclusive), plus C11 judged in the original pass
// only, which must not count as agreement.
const complianceItems: Record<string, JudgeItemVerdict['verdict']> = {
  CP1: 'OK',
  CP2: 'OK',
  CP3: 'OK',
  CP4: 'OK',
  CP5: 'OK',
  CP6: 'OK',
  CP7: 'OK',
  CP8: 'OK',
  CP9: 'OK',
  CP10: 'OK',
};
write(ORIGINAL, 'cal_1', 'compliance', {
  kind: 'verdict',
  verdict: verdict('compliance', { ...complianceItems, CP11: 'OK' }),
});
write(REVERSED, 'cal_1', 'compliance', {
  kind: 'verdict',
  verdict: verdict('compliance', { ...complianceItems, CP3: 'VIOLATION' }),
});

// --- factuality: 4 comparable, one flip -> 0.25, above the threshold.
write(ORIGINAL, 'cal_1', 'factuality', {
  kind: 'verdict',
  verdict: verdict('factuality', { F1: 'met', F2: 'met', F3: 'met', F4: 'not_met' }),
});
write(REVERSED, 'cal_1', 'factuality', {
  kind: 'verdict',
  verdict: verdict('factuality', { F1: 'met', F2: 'not_met', F3: 'met', F4: 'not_met' }),
});

// --- salesEffectiveness: items stable, one anchor moves 2 -> 3.
write(ORIGINAL, 'cal_1', 'salesEffectiveness', {
  kind: 'verdict',
  verdict: verdict('salesEffectiveness', { SE1: 'met' }, { SA1: 2, SA2: 1 }),
});
write(REVERSED, 'cal_1', 'salesEffectiveness', {
  kind: 'verdict',
  verdict: verdict('salesEffectiveness', { SE1: 'met' }, { SA1: 3, SA2: 1 }),
});

// --- conversationQuality: the original pass errored, so nothing is comparable.
write(ORIGINAL, 'cal_1', 'conversationQuality', {
  kind: 'error',
  code: 'schema_violation',
  detail: 'CQ1: met verdict with evidence NONE',
});
write(REVERSED, 'cal_1', 'conversationQuality', {
  kind: 'verdict',
  verdict: verdict('conversationQuality', { CQ1: 'met' }, { QA1: 2 }),
});

// A verdict directory belonging to no panel judge - reported, never compared.
mkdirSync(join(ORIGINAL, 'some-retired-judge'), { recursive: true });

const report = buildOrderFlipReport(ORIGINAL, REVERSED, [JUDGE]);
const row = report.judges[0];

describe('collectors', () => {
  it('reads item verdicts and skips error outcomes', () => {
    const records = collectItemVerdicts(ORIGINAL, JUDGE);
    expect(records).toHaveLength(11 + 4 + 1); // compliance + factuality + SE
    expect(records.some((r) => r.dimension === 'conversationQuality')).toBe(false);
    expect(records.find((r) => r.itemId === 'CP3')?.verdict).toBe('OK');
  });

  it('counts the error records it skipped', () => {
    expect(countErrorJudgments(loadJudgeDir(ORIGINAL, JUDGE))).toBe(1);
    expect(countErrorJudgments(loadJudgeDir(REVERSED, JUDGE))).toBe(0);
  });

  it('reads anchor scores as stringified verdicts, keyed by anchor id', () => {
    const anchors = collectAnchorScores(ORIGINAL, JUDGE);
    expect(anchors.map((a) => `${a.itemId}=${a.verdict}`).sort()).toEqual(['SA1=2', 'SA2=1']);
  });

  it('returns nothing for a judge with no directory', () => {
    expect(collectItemVerdicts(ORIGINAL, 'openrouter/nobody/none')).toEqual([]);
  });
});

describe('buildOrderFlipReport', () => {
  it('excludes an item judged in only one pass', () => {
    // CP11 exists in the original pass only: 11 items, 10 comparable.
    expect(row?.perDimension['compliance']?.items.comparable).toBe(10);
    expect(row?.flippedItemKeys).toEqual(['cal_1/compliance/CP3', 'cal_1/factuality/F2']);
  });

  it('flags the pre-registered 0.10 threshold per dimension', () => {
    expect(ORDER_FLIP_THRESHOLD).toBe(0.1);
    expect(report.threshold).toBe(0.1);
    const compliance = report.perDimension['compliance'];
    expect(compliance?.items.flipRate).toBeCloseTo(0.1, 10);
    expect(compliance?.withinThreshold).toBe(true); // boundary is inclusive
    const factuality = report.perDimension['factuality'];
    expect(factuality?.items.flipRate).toBeCloseTo(0.25, 10);
    expect(factuality?.withinThreshold).toBe(false);
  });

  it('reports null, never false, when nothing is comparable', () => {
    const cq = report.perDimension['conversationQuality'];
    expect(cq?.items).toMatchObject({ comparable: 0, flips: 0, flipRate: null });
    expect(cq?.withinThreshold).toBeNull();
    expect(report.errors).toEqual({ original: 1, reversed: 0 });
  });

  it('compares anchors separately from items', () => {
    expect(report.perDimension['salesEffectiveness']?.items).toMatchObject({
      comparable: 1,
      flips: 0,
    });
    expect(report.perDimension['salesEffectiveness']?.anchors).toMatchObject({
      comparable: 2,
      flips: 1,
      flipRate: 0.5,
    });
    expect(row?.flippedAnchorKeys).toEqual(['cal_1/salesEffectiveness/SA1']);
    // The anchor flip never leaks into the item totals.
    expect(report.totals.items).toMatchObject({ comparable: 15, flips: 2 });
    expect(report.totals.anchors).toMatchObject({ comparable: 2, flips: 1 });
  });

  it('names verdict directories outside the judge list, but not an archive', () => {
    // A parked pass is not a stray judge, so it is neither compared nor
    // reported as one.
    mkdirSync(join(ORIGINAL, 'archived-rubric-v1'), { recursive: true });
    const withArchive = buildOrderFlipReport(ORIGINAL, REVERSED, [JUDGE]);
    expect(withArchive.unexpectedJudgeDirs).toEqual(['some-retired-judge']);
  });

  it('reports the rubric version behind each pass', () => {
    // Every fixture verdict predates versioning, so both read 'unversioned'.
    expect(report.versions).toEqual({ original: ['unversioned'], reversed: ['unversioned'] });
  });

  it('throws when one judge directory mixes prompts or rubric versions', () => {
    // A flip is only a flip when both verdicts ran the same questionnaire;
    // a mixed directory reports rubric churn as judge instability.
    const mixed = join(root, 'mixed');
    write(mixed, 'cal_9', 'compliance', {
      kind: 'verdict',
      verdict: verdict('compliance', { CP1: 'OK' }),
    });
    const path = judgmentPath(mixed, JUDGE, 'cal_9', 'factuality');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        caseId: 'cal_9',
        dimension: 'compliance', // same dimension, different prompt
        attempts: 1,
        promptSha: 'cafebabe',
        outcome: { kind: 'verdict', verdict: verdict('compliance', { CP1: 'OK' }) },
        judgeRef: JUDGE,
        ts: '2026-09-20T00:00:00.000Z',
      }),
    );
    expect(() => loadJudgeDir(mixed, JUDGE)).toThrow(/mixes 2 judge prompts/);
  });

  it('is empty, not broken, when a pass directory is missing', () => {
    const empty = buildOrderFlipReport(ORIGINAL, join(root, 'nope'), [JUDGE]);
    expect(empty.dirs).toMatchObject({ originalPresent: true, reversedPresent: false });
    expect(empty.totals.items).toMatchObject({ comparable: 0, flipRate: null });
    expect(empty.perDimension['compliance']?.withinThreshold).toBeNull();
  });
});

describe('shared itemsVersion between passes', () => {
  const mk = (
    version: string | undefined,
    dimension: JudgeDimension = 'compliance',
  ): StoredJudgment => ({
    caseId: 'cal_1',
    dimension,
    attempts: 1,
    promptSha: 'x',
    outcome: { kind: 'error', code: 'no_json', detail: 'x' },
    judgeRef: JUDGE,
    ts: 't',
    ...(version === undefined ? {} : { itemsVersion: version }),
  });

  it('passes when both passes share a version, per dimension', () => {
    expect(() => assertSharedItemsVersion(JUDGE, [mk('2.0.0')], [mk('2.0.0')])).not.toThrow();
    expect(() =>
      assertSharedItemsVersion(JUDGE, [mk('2.0.0', 'factuality')], [mk('3.0.0', 'compliance')]),
    ).not.toThrow();
  });

  it('refuses a mismatch, naming judge, dimension and both versions', () => {
    expect(() => assertSharedItemsVersion(JUDGE, [mk('2.0.0')], [mk('3.0.0')])).toThrow(
      /compliance.*2\.0\.0.*3\.0\.0/s,
    );
    expect(() => assertSharedItemsVersion(JUDGE, [mk(undefined)], [mk('3.0.0')])).toThrow(
      /unversioned/,
    );
  });

  it('buildOrderFlipReport refuses when the passes differ in version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gb-abl-ver-'));
    try {
      const o = join(dir, 'judgments');
      const r = join(dir, 'judgments-reversed');
      for (const [d, v] of [
        [o, '2.0.0'],
        [r, '3.0.0'],
      ] as const) {
        const path = judgmentPath(d, JUDGE, 'cal_1', 'compliance');
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(mk(v)));
      }
      expect(() => buildOrderFlipReport(o, r, [JUDGE])).toThrow(/order ablation/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses --base-dir / --out', () => {
    expect(parseAblationArgs(['--base-dir=a', '--out=b'])).toEqual({ baseDir: 'a', outFile: 'b' });
    expect(() => parseAblationArgs(['--x'])).toThrow();
  });
});
