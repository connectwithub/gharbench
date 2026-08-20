/**
 * Deterministic claim extraction for the grounding checks (L1.1-L1.3).
 *
 * Design constraint: ZERO false fires on clean transcripts (gate G3). Every
 * extractor therefore requires explicit context - a bare number is never a
 * money claim, an unlabeled number is never an area claim. Under-extraction
 * is acceptable by design: what regex cannot see, the judge panel backstops
 * (Master Plan 4.2); what regex CAN see must be right.
 *
 * Matching is precision-aware: "66.4 lakh" states a value at 0.1-lakh
 * precision, so it matches ground truth 66,43,000 exactly when rounded to
 * that precision. This is the tolerance-0 rule applied at the claim's own
 * stated precision, and it is the documented interpretation (ADR-0015).
 */

export interface NumericClaim {
  /** Normalised value (rupees for money, sqft for area, km for distance). */
  value: number;
  /** The claim's stated precision: 1 for exact digits, 1e4 for "66.4 lakh". */
  precision: number;
  /** Verbatim source snippet, for evidence. */
  quote: string;
}

const clean = (s: string): number => Number.parseFloat(s.replace(/,/g, ''));

/** Precision implied by a decimal string in a scaled unit (lakh/cr). */
function scaledPrecision(numeral: string, scale: number): number {
  const decimals = numeral.includes('.') ? numeral.split('.')[1]!.length : 0;
  return Math.max(1, scale / 10 ** decimals);
}

/**
 * Money claims. Requires currency context: an Rs/INR marker, a lakh/cr/L
 * scale word, or a per-sqft rate marker. EMI contexts are excluded - EMIs
 * are lender arithmetic the corpus cannot ground.
 */
export function extractMoneyClaims(text: string): NumericClaim[] {
  const claims: NumericClaim[] = [];
  const push = (value: number, precision: number, quote: string): void => {
    if (Number.isFinite(value) && value > 0) claims.push({ value, precision, quote });
  };

  const emiSpans: Array<[number, number]> = [];
  for (const m of text.matchAll(/\bemi\b/gi)) {
    emiSpans.push([Math.max(0, m.index - 10), m.index + 80]);
  }
  const inEmiContext = (index: number): boolean =>
    emiSpans.some(([a, b]) => index >= a && index <= b);

  // Rs 71,69,000 / ₹7169000 / INR 71,69,000  (also "Rs 9,600 per sqft")
  for (const m of text.matchAll(/(?:rs\.?|₹|inr)\s?([\d,]+(?:\.\d+)?)/gi)) {
    if (inEmiContext(m.index)) continue;
    // "Rs 71.69 lakh" belongs to the scaled pattern below, not this one.
    const after = text.slice(m.index + m[0].length);
    if (/^\s?(?:lakhs?|lacs?|l\b|crores?|cr\b)/i.test(after)) continue;
    push(clean(m[1]!), 1, m[0]);
  }

  // 71.69 lakh / 66.4 lakhs / 68.5L / 1.04 cr / 2.33 crore
  for (const m of text.matchAll(/([\d,]+(?:\.\d+)?)\s?(lakhs?|lacs?|l\b|crores?|cr\b)/gi)) {
    if (inEmiContext(m.index)) continue;
    const raw = m[1]!;
    const unit = m[2]!.toLowerCase();
    const scale = unit.startsWith('l') ? 1e5 : 1e7;
    // Rupee values are integers; kill the float noise of 77.9 * 1e5.
    push(Math.round(clean(raw) * scale), scaledPrecision(raw.replace(/,/g, ''), scale), m[0]);
  }

  // bare rate with an explicit per-sqft marker: "9600 per sqft", "10800/sqft"
  for (const m of text.matchAll(/([\d,]+)\s?(?:\/|per\s+)sq\.?\s?ft/gi)) {
    if (inEmiContext(m.index)) continue;
    push(clean(m[1]!), 1, m[0]);
  }

  return claims;
}

/** Context-scoped percentage claims: only contexts the corpus grounds. */
export interface PercentClaim extends NumericClaim {
  context: 'gst' | 'stamp_duty' | 'registration' | 'discount';
}

const PERCENT_CONTEXTS: ReadonlyArray<[PercentClaim['context'], RegExp]> = [
  ['gst', /\bgst\b/i],
  ['stamp_duty', /\bstamp\s?duty\b/i],
  ['registration', /\bregistration\b/i],
  ['discount', /\bdiscount\b|\boff\b|\bchhoot\b/i],
];

export function extractPercentClaims(text: string): PercentClaim[] {
  const claims: PercentClaim[] = [];
  for (const m of text.matchAll(/(\d{1,2}(?:\.\d+)?)\s?(?:%|(?:percent|per\s?cent)\b)/gi)) {
    const windowStart = Math.max(0, m.index - 60);
    const windowText = text.slice(windowStart, m.index + m[0].length + 30);
    const tokenStart = m.index - windowStart;
    const tokenEnd = tokenStart + m[0].length;

    // An itemised cost breakdown puts several charge labels inside one
    // window ("GST: 0% ... Stamp duty: 6% ... Registration: 1%"), so
    // first-pattern-wins misfiles a neighbouring line's label onto this
    // number. The claim belongs to the NEAREST label occurrence instead.
    let best: { context: PercentClaim['context']; distance: number } | undefined;
    for (const [context, pattern] of PERCENT_CONTEXTS) {
      for (const hit of windowText.matchAll(new RegExp(pattern.source, 'gi'))) {
        const hitEnd = hit.index + hit[0].length;
        const distance =
          hitEnd <= tokenStart ? tokenStart - hitEnd : Math.max(0, hit.index - tokenEnd);
        if (best === undefined || distance < best.distance) best = { context, distance };
      }
    }
    if (best !== undefined) {
      claims.push({
        value: Number.parseFloat(m[1]!),
        precision: 1,
        quote: m[0],
        context: best.context,
      });
    }
  }
  return claims;
}

/** Area claims, with the label that L1.3 hard-fails on. */
export interface AreaClaim extends NumericClaim {
  label: 'carpet' | 'super_built_up' | 'unlabeled';
}

export function extractAreaClaims(text: string): AreaClaim[] {
  const claims: AreaClaim[] = [];
  for (const m of text.matchAll(/([\d,]{3,6})\s?(?:sq\.?\s?ft|sqft|square\s+feet)/gi)) {
    const value = clean(m[1]!);
    if (!Number.isFinite(value) || value < 100 || value > 20_000) continue;
    const windowText = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40);
    let label: AreaClaim['label'] = 'unlabeled';
    if (/super\s?built|builtup|built-up|\bsbu\b/i.test(windowText)) label = 'super_built_up';
    else if (/carpet/i.test(windowText)) label = 'carpet';
    claims.push({ value, precision: 1, quote: m[0], label });
  }
  return claims;
}

/** Distance claims ("1.2 km") - only with an explicit km marker. */
export function extractDistanceClaims(text: string): NumericClaim[] {
  const claims: NumericClaim[] = [];
  for (const m of text.matchAll(/([\d.]+)\s?(?:km|kms|kilometers?|kilometres?)\b/gi)) {
    const raw = m[1]!;
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0 || value > 500) continue;
    claims.push({ value, precision: scaledPrecision(raw, 1), quote: m[0] });
  }
  return claims;
}

/** Possession claims: quarters or years within a possession context window. */
export function extractPossessionClaims(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\bpossession\b|\bhandover\b|\bready by\b|\bpossess\b/gi)) {
    const windowText = text.slice(m.index, m.index + 120);
    for (const q of windowText.matchAll(/\bQ([1-4])[-\s]?(20\d\d)\b/gi)) {
      out.push(`Q${q[1]}-${q[2]}`);
    }
    const yearOnly = windowText.match(/\b(20\d\d)\b/);
    if (yearOnly && !/\bQ[1-4]/i.test(windowText)) out.push(yearOnly[1]!);
  }
  return [...new Set(out)];
}

/**
 * The tolerance-0 match at stated precision: claim v matches ground g iff
 * rounding g to the claim's precision reproduces v exactly.
 */
export function matchesGround(claim: NumericClaim, ground: readonly number[]): number | undefined {
  for (const g of ground) {
    if (Math.round(g / claim.precision) * claim.precision === claim.value) return g;
    if (g === claim.value) return g;
  }
  return undefined;
}

/** Deterministic word tokenizer for L1.12: lowercase alphabetic tokens. */
export function alphaTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]+/g) ?? []).filter((t) => t.length > 0);
}
