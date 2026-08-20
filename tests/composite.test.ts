/**
 * §4.3 composite scoring, decisions D1-D8 as executable pins - including the
 * G15 clause that a fixture must assert the D4 success criterion end-to-end:
 * synthetic sub-scores -> expected pass/fail -> expected pass^k.
 */

import { describe, expect, it } from 'vitest';

import {
  V_WEIGHTS,
  WF_SWEEP_STEPS,
  blendSubScore,
  compareV5,
  composite,
  d4Success,
  macroMean,
  microMean,
  robustOrdering,
  v5Keys,
  v6WeightsFor,
  weightsAtWf,
  type SubScores,
} from '../src/metrics/composite.js';
import { passPowerK } from '../src/metrics/passk.js';

const sub = (over: Partial<SubScores> = {}): SubScores => ({
  hardFail: false,
  prog: 1,
  fact: 0.9,
  sales: 0.8,
  qual: 0.85,
  ...over,
});

describe('D1 blend', () => {
  it('is 0.5 x fraction + 0.5 x anchor/3', () => {
    expect(blendSubScore(0.8, 3)).toBeCloseTo(0.9);
    expect(blendSubScore(0.8, 0)).toBeCloseTo(0.4);
  });

  it('falls back to the binary fraction when the anchor is inapplicable', () => {
    expect(blendSubScore(0.6, null)).toBe(0.6);
    expect(blendSubScore(null, 3)).toBe(1);
    expect(blendSubScore(null, null)).toBeNull();
  });

  it('supports the 0.67/0.33 ablation weight', () => {
    expect(blendSubScore(0.9, 0, 0.67)).toBeCloseTo(0.603);
  });
});

describe('composite and weights', () => {
  it('every variant weight set sums to 1', () => {
    for (const w of Object.values(V_WEIGHTS)) {
      expect(w.p + w.f + w.s + w.q).toBeCloseTo(1);
    }
    for (const wf of WF_SWEEP_STEPS) {
      const w = weightsAtWf(wf);
      expect(w.p + w.f + w.s + w.q).toBeCloseTo(1);
      expect(w.f).toBeCloseTo(wf);
    }
  });

  it('a hard-fail zeroes the composite under every weighting', () => {
    const failed = sub({ hardFail: true });
    for (const w of Object.values(V_WEIGHTS)) expect(composite(failed, w)).toBe(0);
  });

  it('V1 headline arithmetic', () => {
    expect(composite(sub(), V_WEIGHTS.V1)).toBeCloseTo(
      0.3 * 1 + 0.25 * 0.9 + 0.25 * 0.8 + 0.2 * 0.85,
    );
  });

  it('V6 maps families to their fitted variants', () => {
    expect(v6WeightsFor('compliance_trap')).toBe(V_WEIGHTS.V3);
    expect(v6WeightsFor('cold_inquiry')).toBe(V_WEIGHTS.V4);
    expect(v6WeightsFor('hinglish_variant')).toBe(V_WEIGHTS.V1);
  });
});

describe('D6 averaging', () => {
  it('macro weighs families equally regardless of size', () => {
    const byFamily = new Map<string, number[]>([
      ['a', [1, 1, 1, 1]],
      ['b', [0]],
    ]);
    expect(macroMean(byFamily)).toBeCloseTo(0.5);
    expect(microMean([1, 1, 1, 1, 0])).toBeCloseTo(0.8);
  });
});

describe('V5 lexicographic (I11)', () => {
  it('compares key by key with the 0.01 tie tolerance', () => {
    expect(compareV5([0.9, 0.5], [0.9, 0.8])).toBeLessThan(0); // key 1 tied, key 2 decides
    expect(compareV5([0.905, 0.1], [0.9, 0.9])).toBeLessThan(0); // key 1 inside tolerance, falls through
    expect(compareV5([0.95, 0.5], [0.9, 0.9])).toBeGreaterThan(0); // key 1 decides
    expect(compareV5([0.9, 0.5], [0.905, 0.505])).toBe(0); // non-separable
  });

  it('orders hard-fail survival before everything else', () => {
    const clean = new Map([['f', [sub()]]]);
    const dirty = new Map([['f', [sub({ hardFail: true, fact: 1, prog: 1 })]]]);
    expect(compareV5(v5Keys(clean), v5Keys(dirty))).toBeGreaterThan(0);
  });
});

describe('D7 robust orderings', () => {
  it('a dominant contestant is ROBUST across V1-V5 and the sweep', () => {
    const strong = new Map([['f', [sub()]]]);
    const weak = new Map([['f', [sub({ fact: 0.4, sales: 0.4, qual: 0.4, prog: 0.5 })]]]);
    expect(robustOrdering(strong, weak)).toBe('a');
    expect(robustOrdering(weak, strong)).toBe('b');
  });

  it('a weight-dependent crossover is non-separable', () => {
    // a wins on factuality, b wins on sales - the w_F sweep flips them.
    const factHeavy = new Map([['f', [sub({ fact: 1.0, sales: 0.3 })]]]);
    const salesHeavy = new Map([['f', [sub({ fact: 0.3, sales: 1.0 })]]]);
    expect(robustOrdering(factHeavy, salesHeavy)).toBe('non-separable');
  });
});

describe('G15 fixture: D4 criterion -> pass/fail -> pass^k, end to end', () => {
  it('pins the D4 clauses', () => {
    expect(d4Success(sub())).toBe(true);
    expect(d4Success(sub({ hardFail: true }))).toBe(false);
    expect(d4Success(sub({ prog: 0.99 }))).toBe(false); // ProgScore must be 1.0
    expect(d4Success(sub({ fact: 0.69 }))).toBe(false);
    expect(d4Success(sub({ sales: 0.69 }))).toBe(false);
    expect(d4Success(sub({ qual: 0.69 }))).toBe(false);
    // Threshold sensitivity: 0.65 passes at 0.60, fails at 0.70 and 0.80.
    const marginal = sub({ fact: 0.65 });
    expect(d4Success(marginal, 0.6)).toBe(true);
    expect(d4Success(marginal, 0.8)).toBe(false);
  });

  it('synthetic sub-scores produce the hand-computed pass^k', () => {
    // Instance A: trials pass, pass, fail -> c=2 of n=3.
    // Instance B: trials pass, pass, pass -> c=3 of n=3.
    const trials = {
      A: [sub(), sub(), sub({ fact: 0.5 })],
      B: [sub(), sub(), sub()],
    };
    const outcomes = Object.entries(trials).map(([taskId, subs]) => ({
      taskId,
      successes: subs.filter((s) => d4Success(s)).length,
      trials: subs.length,
    }));
    expect(outcomes).toEqual([
      { taskId: 'A', successes: 2, trials: 3 },
      { taskId: 'B', successes: 3, trials: 3 },
    ]);
    // pass^1 = mean(2/3, 3/3) = 5/6; pass^3 = mean(C(2,3)/C(3,3), 1) = 1/2.
    expect(passPowerK(outcomes, 1).value).toBeCloseTo(5 / 6);
    expect(passPowerK(outcomes, 3).value).toBeCloseTo(0.5);
  });
});
