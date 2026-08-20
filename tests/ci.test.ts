/**
 * Wilson and bootstrap confidence intervals. The Wilson goldens are the
 * exact closed-form x=0 / x=n cases (centre = half-width there, so the
 * interval is [0, z^2/(n+z^2)] and its mirror) - derivable by hand, not
 * copied from a table.
 */

import { describe, expect, it } from 'vitest';

import { bootstrapMeanCi, wilsonInterval, xorshift32 } from '../src/metrics/ci.js';

describe('wilsonInterval', () => {
  it('x=0: exactly [0, z^2/(n+z^2)]', () => {
    const z = 1.96;
    const { lower, upper } = wilsonInterval(0, 10, z);
    expect(lower).toBe(0);
    expect(upper).toBeCloseTo((z * z) / (10 + z * z), 10);
  });

  it('x=n mirrors x=0', () => {
    const a = wilsonInterval(0, 10);
    const b = wilsonInterval(10, 10);
    expect(b.upper).toBe(1);
    expect(b.lower).toBeCloseTo(1 - a.upper, 10);
  });

  it('brackets the point estimate and stays in [0,1]', () => {
    const { lower, upper } = wilsonInterval(8, 10);
    expect(lower).toBeGreaterThan(0);
    expect(lower).toBeLessThan(0.8);
    expect(upper).toBeGreaterThan(0.8);
    expect(upper).toBeLessThan(1);
  });

  it('n=0 degenerates to [0,1]', () => {
    expect(wilsonInterval(0, 0)).toEqual({ lower: 0, upper: 1 });
  });
});

describe('bootstrapMeanCi', () => {
  it('is deterministic: same seed, same interval', () => {
    const values = [0.2, 0.4, 0.6, 0.8, 0.5, 0.7];
    expect(bootstrapMeanCi(values)).toEqual(bootstrapMeanCi(values));
  });

  it('brackets the mean', () => {
    const values = [0.2, 0.4, 0.6, 0.8, 0.5, 0.7];
    const ci = bootstrapMeanCi(values);
    expect(ci).not.toBeNull();
    if (ci) {
      expect(ci.lower).toBeLessThanOrEqual(ci.mean);
      expect(ci.upper).toBeGreaterThanOrEqual(ci.mean);
    }
    expect(bootstrapMeanCi([])).toBeNull();
  });

  it('xorshift32 emits stable values in [0,1)', () => {
    const rand = xorshift32(42);
    const seq = [rand(), rand(), rand()];
    const again = xorshift32(42);
    expect([again(), again(), again()]).toEqual(seq);
    for (const v of seq) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
