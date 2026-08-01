/**
 * Model price table, USD per 1,000,000 tokens.
 *
 * ============================================================================
 * RE-VERIFY AT FREEZE. Vendor pricing moves without notice and a stale number
 * here silently corrupts every published cost figure. Before cutting a
 * benchmark release: re-check every entry against the vendor's live pricing
 * page, bump `lastVerified`, and flip anything you could not confirm to
 * `confidence: 'unverified'`.
 * ============================================================================
 *
 * Entries marked `unverified` are placeholders that exist to demonstrate the
 * table shape for non-Anthropic providers. `estimateCostUsd` never invents a
 * number: an unknown model yields `usd: null, priced: false`, and the run's
 * cost report counts it under `unpricedCalls` rather than quietly reporting $0.
 */

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Cost of reading a cached prompt prefix. Anthropic: ~0.1x input. */
  cacheReadPerMTok?: number;
  /** Cost of writing a cache entry. Anthropic 5m TTL: 1.25x input. */
  cacheWritePerMTok?: number;
  source: string;
  lastVerified: string;
  confidence: 'verified' | 'unverified';
}

export const PRICES: Readonly<Record<string, ModelPrice>> = {
  // --- Anthropic -----------------------------------------------------------
  'claude-fable-5': {
    inputPerMTok: 10,
    outputPerMTok: 50,
    cacheReadPerMTok: 1,
    cacheWritePerMTok: 12.5,
    source: 'anthropic pricing',
    lastVerified: '2026-06-24',
    confidence: 'verified',
  },
  'claude-opus-5': {
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    source: 'anthropic pricing',
    lastVerified: '2026-06-24',
    confidence: 'verified',
  },
  'claude-opus-4-8': {
    inputPerMTok: 5,
    outputPerMTok: 25,
    cacheReadPerMTok: 0.5,
    cacheWritePerMTok: 6.25,
    source: 'anthropic pricing',
    lastVerified: '2026-06-24',
    confidence: 'verified',
  },
  'claude-sonnet-5': {
    // Introductory rate $2/$10 applies through 2026-08-31; list is $3/$15.
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
    source: 'anthropic pricing (list rate, not the intro rate)',
    lastVerified: '2026-06-24',
    confidence: 'verified',
  },
  'claude-sonnet-4-6': {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadPerMTok: 0.3,
    cacheWritePerMTok: 3.75,
    source: 'anthropic pricing',
    lastVerified: '2026-06-24',
    confidence: 'verified',
  },
  'claude-haiku-4-5': {
    inputPerMTok: 1,
    outputPerMTok: 5,
    cacheReadPerMTok: 0.1,
    cacheWritePerMTok: 1.25,
    source: 'anthropic pricing',
    lastVerified: '2026-06-24',
    confidence: 'verified',
  },

  // --- Placeholders: shape only, DO NOT publish a cost using these ---------
  'gpt-4.1-mini': {
    inputPerMTok: 0.4,
    outputPerMTok: 1.6,
    cacheReadPerMTok: 0.1,
    source: 'PLACEHOLDER - verify against openai pricing before use',
    lastVerified: 'never',
    confidence: 'unverified',
  },
  'gemini-2.5-flash': {
    inputPerMTok: 0.3,
    outputPerMTok: 2.5,
    source: 'PLACEHOLDER - verify against google pricing before use',
    lastVerified: 'never',
    confidence: 'unverified',
  },
};

export function priceFor(modelId: string): ModelPrice | undefined {
  return PRICES[modelId];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface PricedUsage {
  usd: number | null;
  priced: boolean;
  confidence: ModelPrice['confidence'] | 'unknown';
}

/**
 * Cost of one call. `inputTokens` is the *uncached* remainder: cached reads and
 * writes are billed at their own rates and must not be double counted.
 */
export function estimateCostUsd(modelId: string, usage: TokenUsage): PricedUsage {
  const price = PRICES[modelId];
  if (!price) return { usd: null, priced: false, confidence: 'unknown' };

  const perMTok = (tokens: number, rate: number | undefined, fallback: number): number =>
    (tokens / 1_000_000) * (rate ?? fallback);

  const usd =
    perMTok(usage.inputTokens, price.inputPerMTok, price.inputPerMTok) +
    perMTok(usage.outputTokens, price.outputPerMTok, price.outputPerMTok) +
    perMTok(usage.cacheReadTokens, price.cacheReadPerMTok, price.inputPerMTok) +
    perMTok(usage.cacheWriteTokens, price.cacheWritePerMTok, price.inputPerMTok);

  return { usd, priced: true, confidence: price.confidence };
}
