/**
 * pass^k - the unbiased "all k independent trials succeed" estimator.
 *
 * For a task with `c` successes out of `n` trials, the probability that a
 * uniformly random size-k subset of those trials is all-success is
 *
 *     pass^k = C(c, k) / C(n, k)
 *
 * which is an unbiased estimate of P(k independent attempts all succeed).
 * The benchmark statistic is this quantity averaged over tasks.
 *
 * Note this is pass^k (reliability: succeed every time), not pass@k
 * (best-of-k: succeed at least once). They move in opposite directions, and a
 * sales agent is judged on the former - a bot that closes 1 lead in 5 is not
 * "80% good", it is unshippable.
 *
 * Computed through log-binomials so large n does not overflow.
 *
 * TODO(G15): golden-test these values against the published tau^2-bench v1.0.1
 * numbers once the reference task set is vendored, so a refactor here cannot
 * silently change the headline metric.
 */

/** Lanczos approximation, g=7, n=9. Accurate to ~1e-13 relative for our range. */
const LANCZOS_G = 7;
const LANCZOS_COEFFS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
] as const;

export function logGamma(x: number): number {
  if (!Number.isFinite(x)) throw new RangeError(`logGamma: x must be finite, got ${x}`);
  if (x < 0.5) {
    // Reflection formula keeps the approximation in its accurate region.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }

  const z = x - 1;
  let a = 0;
  for (const [i, coeff] of LANCZOS_COEFFS.entries()) {
    a = i === 0 ? coeff : a + coeff / (z + i);
  }
  const t = z + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** log C(n, k). */
export function logBinomial(n: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k)) {
    throw new RangeError(`logBinomial: n and k must be integers, got n=${n}, k=${k}`);
  }
  if (k < 0 || k > n) return Number.NEGATIVE_INFINITY; // C(n,k) = 0
  if (k === 0 || k === n) return 0;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/**
 * pass^k for a single task: C(c, k) / C(n, k).
 *
 * `k > n` is undefined rather than zero - you cannot estimate 5-trial
 * reliability from 3 trials - so it throws instead of returning a number a
 * caller might average into a headline figure.
 */
export function passPowerKForTask(successes: number, trials: number, k: number): number {
  if (!Number.isInteger(successes) || !Number.isInteger(trials) || !Number.isInteger(k)) {
    throw new RangeError('passPowerKForTask: successes, trials and k must be integers');
  }
  if (trials <= 0) throw new RangeError('passPowerKForTask: trials must be positive');
  if (successes < 0 || successes > trials) {
    throw new RangeError(`passPowerKForTask: successes ${successes} outside [0, ${trials}]`);
  }
  if (k < 1) throw new RangeError('passPowerKForTask: k must be at least 1');
  if (k > trials) {
    throw new RangeError(
      `passPowerKForTask: k=${k} exceeds trials=${trials}; pass^k is undefined there`,
    );
  }

  if (successes < k) return 0;

  const value = Math.exp(logBinomial(successes, k) - logBinomial(trials, k));
  // Clamp the last ulp of floating-point error; this is a probability.
  return Math.min(1, Math.max(0, value));
}

export interface TaskOutcome {
  taskId: string;
  successes: number;
  trials: number;
}

export interface PassPowerKResult {
  k: number;
  /** Mean of the per-task estimates. */
  value: number;
  tasks: number;
  perTask: Array<{ taskId: string; value: number; successes: number; trials: number }>;
}

/** pass^k averaged over tasks, weighting every task equally. */
export function passPowerK(outcomes: readonly TaskOutcome[], k: number): PassPowerKResult {
  if (outcomes.length === 0) {
    throw new RangeError('passPowerK: need at least one task');
  }

  const perTask = outcomes.map((o) => ({
    taskId: o.taskId,
    successes: o.successes,
    trials: o.trials,
    value: passPowerKForTask(o.successes, o.trials, k),
  }));

  const value = perTask.reduce((sum, t) => sum + t.value, 0) / perTask.length;
  return { k, value, tasks: perTask.length, perTask };
}

/** The pass^k curve for k = 1..maxK, the usual way this metric is reported. */
export function passPowerKCurve(
  outcomes: readonly TaskOutcome[],
  maxK: number,
): PassPowerKResult[] {
  const feasible = Math.min(maxK, ...outcomes.map((o) => o.trials));
  const curve: PassPowerKResult[] = [];
  for (let k = 1; k <= feasible; k += 1) curve.push(passPowerK(outcomes, k));
  return curve;
}
