import { describe, expect, it } from 'vitest';
import {
  logBinomial,
  logGamma,
  passPowerK,
  passPowerKCurve,
  passPowerKForTask,
} from '../src/metrics/passk.js';

describe('logGamma', () => {
  it('matches known factorials', () => {
    // logGamma(n+1) = ln(n!)
    expect(Math.exp(logGamma(1))).toBeCloseTo(1, 10); // 0! = 1
    expect(Math.exp(logGamma(5))).toBeCloseTo(24, 8); // 4! = 24
    expect(Math.exp(logGamma(11))).toBeCloseTo(3_628_800, 3); // 10!
  });

  it('matches gamma(1/2) = sqrt(pi) via the reflection branch', () => {
    expect(Math.exp(logGamma(0.5))).toBeCloseTo(Math.sqrt(Math.PI), 10);
  });
});

describe('logBinomial', () => {
  it('matches hand-computed binomials', () => {
    expect(Math.exp(logBinomial(4, 2))).toBeCloseTo(6, 8);
    expect(Math.exp(logBinomial(10, 3))).toBeCloseTo(120, 6);
    expect(Math.exp(logBinomial(52, 5))).toBeCloseTo(2_598_960, 0);
  });

  it('is 1 at the edges and 0 outside the range', () => {
    expect(logBinomial(7, 0)).toBe(0);
    expect(logBinomial(7, 7)).toBe(0);
    expect(logBinomial(7, 8)).toBe(Number.NEGATIVE_INFINITY);
    expect(logBinomial(7, -1)).toBe(Number.NEGATIVE_INFINITY);
  });

  it('rejects non-integers', () => {
    expect(() => logBinomial(4.5, 2)).toThrow(RangeError);
  });
});

describe('passPowerKForTask - hand-computed cases', () => {
  it('C(2,2)/C(4,2) = 1/6', () => {
    expect(passPowerKForTask(2, 4, 2)).toBeCloseTo(1 / 6, 12);
  });

  it('C(3,1)/C(5,1) = 3/5', () => {
    expect(passPowerKForTask(3, 5, 1)).toBeCloseTo(0.6, 12);
  });

  it('C(4,2)/C(6,2) = 6/15 = 0.4', () => {
    expect(passPowerKForTask(4, 6, 2)).toBeCloseTo(0.4, 12);
  });

  it('C(3,3)/C(4,3) = 1/4', () => {
    expect(passPowerKForTask(3, 4, 3)).toBeCloseTo(0.25, 12);
  });

  it('is exactly 1 when every trial succeeded', () => {
    expect(passPowerKForTask(10, 10, 3)).toBeCloseTo(1, 12);
    expect(passPowerKForTask(5, 5, 5)).toBeCloseTo(1, 12);
  });

  it('is 0 when there are fewer successes than k', () => {
    expect(passPowerKForTask(1, 3, 2)).toBe(0);
    expect(passPowerKForTask(0, 5, 1)).toBe(0);
  });

  it('is monotonically non-increasing in k', () => {
    const values = [1, 2, 3, 4, 5].map((k) => passPowerKForTask(7, 10, k));
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeLessThanOrEqual(values[i - 1]!);
    }
  });

  it('stays numerically sane for large n', () => {
    const value = passPowerKForTask(900, 1000, 5);
    // (900/1000)*(899/999)*(898/998)*(897/997)*(896/996)
    const exact = [0, 1, 2, 3, 4].reduce((acc, i) => acc * ((900 - i) / (1000 - i)), 1);
    expect(value).toBeCloseTo(exact, 10);
  });

  it('rejects undefined regions rather than returning a number', () => {
    expect(() => passPowerKForTask(2, 3, 0)).toThrow(RangeError);
    expect(() => passPowerKForTask(2, 3, 4)).toThrow(/exceeds trials/);
    expect(() => passPowerKForTask(4, 3, 1)).toThrow(RangeError);
    expect(() => passPowerKForTask(0, 0, 1)).toThrow(RangeError);
  });
});

describe('passPowerK - averaged over tasks', () => {
  it('averages per-task estimates with equal weight', () => {
    const result = passPowerK(
      [
        { taskId: 'a', successes: 2, trials: 4 }, // 1/6
        { taskId: 'b', successes: 4, trials: 4 }, // 1
      ],
      2,
    );
    expect(result.value).toBeCloseTo((1 / 6 + 1) / 2, 12);
    expect(result.tasks).toBe(2);
    expect(result.perTask.map((t) => t.taskId)).toEqual(['a', 'b']);
  });

  it('rejects an empty task set', () => {
    expect(() => passPowerK([], 1)).toThrow(RangeError);
  });
});

describe('passPowerKCurve', () => {
  it('stops at the smallest trial count so no task is extrapolated', () => {
    const curve = passPowerKCurve(
      [
        { taskId: 'a', successes: 3, trials: 5 },
        { taskId: 'b', successes: 2, trials: 3 },
      ],
      10,
    );
    expect(curve.map((c) => c.k)).toEqual([1, 2, 3]);
  });

  it('is non-increasing across k', () => {
    const curve = passPowerKCurve([{ taskId: 'a', successes: 7, trials: 10 }], 5);
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]!.value).toBeLessThanOrEqual(curve[i - 1]!.value);
    }
  });
});
