/**
 * Gate G15: pass^k golden-tested against published tau2-bench v1.0.1 numbers.
 *
 * Ground truth provenance - raw per-trial result files published in
 * sierra-research/tau2-bench at tag v1.0.1 under data/tau2/results/final/:
 *
 *   claude-3-7-sonnet-20250219_retail_default_gpt-4.1-2025-04-14_4trials.json
 *     sha256 ed41dbd18c080154156484e3a0122c095e324a11367a640d88e15956daed7b9d
 *   gpt-4.1-2025-04-14_airline_default_gpt-4.1-2025-04-14_4trials.json
 *     sha256 31d19e79b8ddc5934a60701f913ff5fefb41dee5e68f7b813c26254ab2e2d5c8
 *
 * The per-task success counts below were extracted from those files
 * (2026-08-20) using upstream's own success rule from
 * src/tau2/metrics/agent_metrics.py: success iff |reward - 1| <= 1e-6, and
 * pass_hat_k = comb(c, k) / comb(n, k) averaged over tasks. The expected
 * values are what upstream's estimator yields on upstream's data; this suite
 * pins OUR estimator to them, so a refactor of passk.ts cannot silently
 * change the headline metric.
 *
 * Grading boundary (pinned per the master plan): upstream's July 2026 v1.0.1
 * note - "results produced with tau2-bench < 1.0.1 are not comparable"
 * (banking_knowledge grading fixes). Everything here is v1.0.1.
 */

import { describe, expect, it } from 'vitest';
import { passPowerKCurve, type TaskOutcome } from '../src/metrics/passk.js';

/** Expand a success-count histogram {c: taskCount} into TaskOutcome[] (n=4). */
function fromHistogram(hist: Record<string, number>): TaskOutcome[] {
  const outcomes: TaskOutcome[] = [];
  for (const [c, taskCount] of Object.entries(hist)) {
    for (let i = 0; i < taskCount; i += 1) {
      outcomes.push({ taskId: `t${c}_${i}`, successes: Number(c), trials: 4 });
    }
  }
  return outcomes;
}

const GOLDEN = [
  {
    name: 'claude-3-7-sonnet retail (114 tasks, 4 trials)',
    histogram: { 0: 8, 1: 6, 2: 15, 3: 17, 4: 68 },
    tasks: 114,
    expected: [0.7872807018, 0.6929824561, 0.6337719298, 0.5964912281],
  },
  {
    name: 'gpt-4.1 airline (50 tasks, 4 trials)',
    histogram: { 0: 11, 1: 10, 2: 5, 3: 4, 4: 20 },
    tasks: 50,
    expected: [0.56, 0.4566666667, 0.42, 0.4],
  },
] as const;

describe('G15: pass^k vs published tau2-bench v1.0.1 results', () => {
  for (const golden of GOLDEN) {
    it(`reproduces ${golden.name}`, () => {
      const outcomes = fromHistogram(golden.histogram);
      expect(outcomes).toHaveLength(golden.tasks);

      const curve = passPowerKCurve(outcomes, 4);
      expect(curve).toHaveLength(4);
      for (let k = 1; k <= 4; k += 1) {
        expect(curve[k - 1]!.k).toBe(k);
        expect(curve[k - 1]!.value).toBeCloseTo(golden.expected[k - 1]!, 9);
      }
    });
  }

  it('pass^1 equals the average success rate (the published files are binary-reward)', () => {
    for (const golden of GOLDEN) {
      const curve = passPowerKCurve(fromHistogram(golden.histogram), 1);
      const successes = Object.entries(golden.histogram).reduce(
        (a, [c, n]) => a + Number(c) * n,
        0,
      );
      expect(curve[0]!.value).toBeCloseTo(successes / (golden.tasks * 4), 12);
    }
  });
});
