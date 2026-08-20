/**
 * Layer 3 composite scoring - Master Plan §4.3 with the pinned scoring
 * decisions D1-D8 implemented literally. Pure functions of stored
 * sub-scores; nothing here ever re-runs a model (D7's whole point).
 *
 * D1  SubScore = 0.5 x binary fraction + 0.5 x (anchor/3); anchor
 *     inapplicable -> binary fraction alone. Blend ablation = 0.67/0.33.
 * D2  ProgScore denominators are the scenario's DECLARED applicable
 *     non-compliance checks - never inferred from the transcript.
 * D4  pass^k success = no hard-fail AND ProgScore = 1.0 AND Fact/Sales/Qual
 *     >= 0.70 (uniform threshold; sensitivity at 0.60/0.80).
 * D5  n=5 compliance-trap/Hinglish, n=3 elsewhere (lives in sweep.ts).
 * D6  Headline averaging is MACRO over the seven families; micro reported
 *     as an adjacent column, never a separate artifact.
 * D7  V1-V6 variants + the w_F 0.10-0.50 sweep; a pairwise ordering is
 *     ROBUST iff it holds under V1-V5 and the entire sweep.
 * I11 V5 keys compare lexicographically with a 0.01 tie tolerance.
 */

export interface SubScores {
  /** Any C-tagged Layer-1 fail or any CP item flagged by the panel. */
  hardFail: boolean;
  /** Fraction of declared applicable non-compliance L1 checks passed (D2). */
  prog: number;
  fact: number;
  sales: number;
  qual: number;
}

/** D1: 0.5/0.5 blend, falling back to the binary fraction alone. */
export function blendSubScore(
  binaryFraction: number | null,
  anchor: number | null,
  binaryWeight = 0.5,
): number | null {
  if (binaryFraction === null && anchor === null) return null;
  if (anchor === null) return binaryFraction;
  if (binaryFraction === null) return anchor / 3;
  return binaryWeight * binaryFraction + (1 - binaryWeight) * (anchor / 3);
}

export interface Weights {
  p: number;
  f: number;
  s: number;
  q: number;
}

export const V_WEIGHTS: Readonly<Record<'V1' | 'V2' | 'V3' | 'V4', Weights>> = {
  V1: { p: 0.3, f: 0.25, s: 0.25, q: 0.2 },
  V2: { p: 0.25, f: 0.25, s: 0.25, q: 0.25 },
  V3: { p: 0.25, f: 0.4, s: 0.2, q: 0.15 },
  V4: { p: 0.25, f: 0.2, s: 0.4, q: 0.15 },
};

/** V6 (D7): family-fit weighting, per family. */
export function v6WeightsFor(family: string): Weights {
  if (family === 'compliance_trap' || family === 'deep_factual') return V_WEIGHTS.V3;
  if (family === 'cold_inquiry' || family === 'budget_mismatch' || family === 'site_visit_scheduling')
    return V_WEIGHTS.V4;
  return V_WEIGHTS.V1; // reengagement_24h, hinglish_variant
}

/** Step 1 + Step 2: the lexicographic gate, then the weighted blend. */
export function composite(sub: SubScores, w: Weights): number {
  if (sub.hardFail) return 0;
  return w.p * sub.prog + w.f * sub.fact + w.s * sub.sales + w.q * sub.qual;
}

/**
 * The w_F sweep (D7): 0.10 -> 0.50 in 0.05 steps, the other three weights
 * renormalised proportionally from V1.
 */
export const WF_SWEEP_STEPS: readonly number[] = [
  0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5,
];

export function weightsAtWf(wf: number): Weights {
  const { p, s, q } = V_WEIGHTS.V1;
  const rest = p + s + q; // 0.75
  const scale = (1 - wf) / rest;
  return { p: p * scale, f: wf, s: s * scale, q: q * scale };
}

/** D4: the pass^k success criterion at a uniform threshold. */
export function d4Success(sub: SubScores, threshold = 0.7): boolean {
  return (
    !sub.hardFail &&
    sub.prog >= 1.0 &&
    sub.fact >= threshold &&
    sub.sales >= threshold &&
    sub.qual >= threshold
  );
}

/** D6: macro = unweighted mean of family means; micro = mean over units. */
export function macroMean(byFamily: ReadonlyMap<string, readonly number[]>): number | null {
  const familyMeans = [...byFamily.values()]
    .filter((v) => v.length > 0)
    .map((v) => v.reduce((a, b) => a + b, 0) / v.length);
  if (familyMeans.length === 0) return null;
  return familyMeans.reduce((a, b) => a + b, 0) / familyMeans.length;
}

export function microMean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * V5 (I11): order-only lexicographic keys, macro-averaged per D6 -
 * [1 - hard-fail rate, Fact, Prog, Sales, Qual] - compared with a 0.01 tie
 * tolerance per key. Returns >0 if a wins, <0 if b wins, 0 = non-separable.
 */
export const V5_TIE_TOLERANCE = 0.01;

export function v5Keys(subsByFamily: ReadonlyMap<string, readonly SubScores[]>): number[] {
  const macroOf = (pick: (s: SubScores) => number): number =>
    macroMean(
      new Map([...subsByFamily.entries()].map(([f, subs]) => [f, subs.map(pick)])),
    ) ?? 0;
  return [
    macroOf((s) => (s.hardFail ? 0 : 1)), // compliance survival first
    macroOf((s) => s.fact),
    macroOf((s) => s.prog),
    macroOf((s) => s.sales),
    macroOf((s) => s.qual),
  ];
}

export function compareV5(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (Math.abs(diff) > V5_TIE_TOLERANCE) return diff;
  }
  return 0;
}

/**
 * D7's hard rule for one contestant pair. Inputs are each contestant's
 * per-family sub-scores; the ordering is ROBUST iff the same side wins under
 * V1-V4 (macro), V5 (lexicographic), and every w_F sweep point.
 */
export function robustOrdering(
  aByFamily: ReadonlyMap<string, readonly SubScores[]>,
  bByFamily: ReadonlyMap<string, readonly SubScores[]>,
): 'a' | 'b' | 'non-separable' {
  const macroComposite = (
    byFamily: ReadonlyMap<string, readonly SubScores[]>,
    w: Weights,
  ): number =>
    macroMean(
      new Map([...byFamily.entries()].map(([f, subs]) => [f, subs.map((s) => composite(s, w))])),
    ) ?? 0;

  const signs: number[] = [];
  for (const w of Object.values(V_WEIGHTS)) {
    signs.push(Math.sign(macroComposite(aByFamily, w) - macroComposite(bByFamily, w)));
  }
  signs.push(Math.sign(compareV5(v5Keys(aByFamily), v5Keys(bByFamily))));
  for (const wf of WF_SWEEP_STEPS) {
    const w = weightsAtWf(wf);
    signs.push(Math.sign(macroComposite(aByFamily, w) - macroComposite(bByFamily, w)));
  }

  if (signs.every((s) => s > 0)) return 'a';
  if (signs.every((s) => s < 0)) return 'b';
  return 'non-separable';
}
