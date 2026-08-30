/**
 * Judge-robustness ablations (ADR-0030): flip rate over an order-reversed
 * pass, self-preference deltas, leave-one-judge-out ranking stability, and
 * length-bias correlation. All pure - the machinery must exist and be pinned
 * BEFORE the paid Phase 6 run emits the verdicts it will consume.
 */

import { describe, expect, it } from 'vitest';

import {
  familyOverlap,
  leaveOneJudgeOut,
  lengthBiasCorrelation,
  orderFlipRate,
  selfPreferenceDeltas,
  type ItemVerdictRecord,
} from '../src/metrics/judgeAblations.js';

describe('orderFlipRate', () => {
  const rec = (caseId: string, itemId: string, verdict: string): ItemVerdictRecord => ({
    caseId,
    dimension: 'compliance',
    itemId,
    verdict,
  });

  it('counts only matched triples and reports every flip', () => {
    const original = [rec('c1', 'CP1', 'OK'), rec('c1', 'CP5', 'VIOLATION'), rec('c2', 'CP1', 'OK')];
    const reversed = [rec('c1', 'CP1', 'VIOLATION'), rec('c1', 'CP5', 'VIOLATION')];
    const report = orderFlipRate(original, reversed);
    // c2/CP1 exists in one pass only: not comparable, not agreement.
    expect(report.comparable).toBe(2);
    expect(report.flips).toBe(1);
    expect(report.flipRate).toBe(0.5);
    expect(report.flippedKeys).toEqual(['c1/compliance/CP1']);
  });

  it('returns null flip rate when nothing is comparable - never a fake 0', () => {
    expect(orderFlipRate([rec('c1', 'CP1', 'OK')], []).flipRate).toBeNull();
  });
});

describe('selfPreferenceDeltas', () => {
  it('reports the same-family minus other-family delta per judge family', () => {
    const rows = [
      { judgeFamily: 'meta', contestantFamily: 'meta', score: 3 },
      { judgeFamily: 'meta', contestantFamily: 'openai', score: 2 },
      { judgeFamily: 'meta', contestantFamily: 'anthropic', score: 2 },
      { judgeFamily: 'xai', contestantFamily: 'openai', score: 2 },
    ];
    const [meta, xai] = selfPreferenceDeltas(rows);
    expect(meta).toEqual({
      judgeFamily: 'meta',
      nSame: 1,
      nOther: 2,
      meanSame: 3,
      meanOther: 2,
      delta: 1,
    });
    // No same-family contestant -> delta is null, not 0: today's panel is
    // family-disjoint by design and must report "unmeasurable", not "unbiased".
    expect(xai?.delta).toBeNull();
    expect(xai?.nSame).toBe(0);
  });
});

describe('familyOverlap', () => {
  it('flags exactly the judge families that also field a contestant', () => {
    expect(familyOverlap(['xai', 'mistral', 'meta'], ['openai', 'anthropic'])).toEqual([]);
    expect(familyOverlap(['xai', 'meta'], ['meta', 'openai', 'meta'])).toEqual(['meta']);
  });
});

describe('leaveOneJudgeOut', () => {
  it('keeps a robust ranking identical under every single-judge drop', () => {
    const rows = [];
    for (const judge of ['j1', 'j2', 'j3']) {
      rows.push({ judge, contestant: 'best', value: 3 });
      rows.push({ judge, contestant: 'mid', value: 2 });
      rows.push({ judge, contestant: 'worst', value: 1 });
    }
    const report = leaveOneJudgeOut(rows);
    expect(report.full).toEqual(['best', 'mid', 'worst']);
    for (const drop of report.drops) {
      expect(drop.identical).toBe(true);
      expect(drop.discordantPairs).toBe(0);
    }
  });

  it('detects a single judge holding up an ordering', () => {
    // j3 alone puts b far above a; dropping j3 swaps the top two.
    const rows = [
      { judge: 'j1', contestant: 'a', value: 2 },
      { judge: 'j1', contestant: 'b', value: 1 },
      { judge: 'j2', contestant: 'a', value: 2 },
      { judge: 'j2', contestant: 'b', value: 1 },
      { judge: 'j3', contestant: 'a', value: 0 },
      { judge: 'j3', contestant: 'b', value: 9 },
    ];
    const report = leaveOneJudgeOut(rows);
    expect(report.full).toEqual(['b', 'a']);
    const j3 = report.drops.find((d) => d.judge === 'j3');
    expect(j3?.ranking).toEqual(['a', 'b']);
    expect(j3?.identical).toBe(false);
    expect(j3?.discordantPairs).toBe(1);
  });

  it('a contestant scored only by the dropped judge is not a rank change', () => {
    const rows = [
      { judge: 'j1', contestant: 'a', value: 2 },
      { judge: 'j1', contestant: 'b', value: 1 },
      { judge: 'j2', contestant: 'a', value: 2 },
      { judge: 'j2', contestant: 'b', value: 1 },
      { judge: 'j2', contestant: 'only-j2', value: 3 },
    ];
    const j2 = leaveOneJudgeOut(rows).drops.find((d) => d.judge === 'j2');
    expect(j2?.ranking).toEqual(['a', 'b']);
    expect(j2?.identical).toBe(true);
  });
});

describe('lengthBiasCorrelation', () => {
  it('finds the monotone relationship and its direction', () => {
    const rows = [
      { score: 0, length: 100 },
      { score: 1, length: 220 },
      { score: 2, length: 300 },
      { score: 3, length: 450 },
    ];
    const report = lengthBiasCorrelation(rows);
    expect(report.n).toBe(4);
    expect(report.spearman).toBeCloseTo(1, 10);
    expect(report.pearson).toBeGreaterThan(0.9);
  });

  it('null under zero variance or n<2 - an unmeasurable bias is not a 0 bias', () => {
    expect(lengthBiasCorrelation([{ score: 1, length: 2 }]).pearson).toBeNull();
    const flat = lengthBiasCorrelation([
      { score: 2, length: 100 },
      { score: 2, length: 900 },
    ]);
    expect(flat.pearson).toBeNull();
    expect(flat.spearman).toBeNull();
  });

  it('handles ties via average ranks', () => {
    const rows = [
      { score: 1, length: 100 },
      { score: 1, length: 200 },
      { score: 2, length: 300 },
    ];
    const report = lengthBiasCorrelation(rows);
    expect(report.spearman).not.toBeNull();
    expect(report.spearman ?? 0).toBeGreaterThan(0);
  });
});
