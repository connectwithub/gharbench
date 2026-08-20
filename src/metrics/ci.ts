/**
 * Confidence intervals for the report tables (Master Plan §4.3 "bootstrap or
 * Wilson confidence intervals").
 *
 * Wilson is a closed formula, golden-tested against its exact x=0 / x=n
 * derivations. The bootstrap uses a SEEDED xorshift32 - the repo's
 * no-Math.random rule exists so results are reproducible, and a seeded
 * resampler satisfies the reason for the rule, not just its letter: the same
 * inputs always produce the same interval.
 */

/** Wilson score interval for a binomial proportion (z=1.96 -> 95%). */
export function wilsonInterval(
  successes: number,
  trials: number,
  z = 1.96,
): { lower: number; upper: number } {
  if (trials === 0) return { lower: 0, upper: 1 };
  const p = successes / trials;
  const z2 = z * z;
  const denom = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denom;
  const half = (z * Math.sqrt((p * (1 - p) + z2 / (4 * trials)) / trials)) / denom;
  return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

/** Deterministic PRNG: xorshift32, never Math.random. */
export function xorshift32(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

/**
 * Percentile bootstrap CI for the mean. Same seed + same values -> the same
 * interval, always.
 */
export function bootstrapMeanCi(
  values: readonly number[],
  options: { seed?: number; resamples?: number; level?: number } = {},
): { lower: number; upper: number; mean: number } | null {
  if (values.length === 0) return null;
  const { seed = 20260820, resamples = 2000, level = 0.95 } = options;
  const rand = xorshift32(seed);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  const means: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) {
      sum += values[Math.floor(rand() * values.length)] ?? 0;
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  const alpha = (1 - level) / 2;
  const at = (q: number): number =>
    means[Math.min(means.length - 1, Math.max(0, Math.floor(q * means.length)))] ?? mean;
  return { lower: at(alpha), upper: at(1 - alpha), mean };
}
