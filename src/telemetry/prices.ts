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

import { aliasForSnapshot } from '../providers/registry.js';

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

  // --- OpenRouter-hosted buyer simulators (Phase 3 pilot) ------------------
  // Keyed on the full nested id because that is what `resolveModel` returns as
  // `modelId` for the openrouter provider. Verified against the live
  // openrouter.ai/api/v1/models endpoint. Caveat: OpenRouter routes across
  // upstream hosts and the listed figure is its default routing price - a
  // specific request may land on a pricier host. Good enough for pilot cost
  // reporting; re-verify (and consider pinning a host) at freeze.
  'qwen/qwen3-235b-a22b-2507': {
    inputPerMTok: 0.09,
    outputPerMTok: 0.55,
    source: 'openrouter.ai/api/v1/models (default routing price)',
    lastVerified: '2026-08-20',
    confidence: 'verified',
  },
  'qwen/qwen3-32b': {
    inputPerMTok: 0.08,
    outputPerMTok: 0.28,
    source: 'openrouter.ai/api/v1/models (default routing price)',
    lastVerified: '2026-08-20',
    confidence: 'verified',
  },

  // --- Phase 4 contestants (OpenAI GPT-5.6 tier names per Master Plan §7.2,
  // researched 2026-07-30). Marked unverified until the freeze re-check; the
  // ids exist on the account (models API, 2026-08-20) but publish no dated
  // snapshot yet, so runs record them as unpinned.
  'gpt-5.6-terra': {
    inputPerMTok: 2.5,
    outputPerMTok: 15,
    source: 'Master Plan §7.2 pricing snapshot 2026-07-30 - verify at freeze',
    lastVerified: 'never',
    confidence: 'unverified',
  },
  'gpt-5.6-luna': {
    inputPerMTok: 1,
    outputPerMTok: 6,
    source: 'Master Plan §7.2 pricing snapshot 2026-07-30 - verify at freeze',
    lastVerified: 'never',
    confidence: 'unverified',
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

/**
 * Price for a model id, accepting either a floating alias or the dated snapshot
 * it pins to. Runs send the snapshot (see MODEL_PINS), but pricing is the same
 * model, so the table stays keyed on the readable alias rather than duplicating
 * every row. A snapshot with no alias still misses, which is correct - an
 * unknown model must increment `unpricedCalls`, never quietly cost $0.
 */
export function priceFor(modelId: string): ModelPrice | undefined {
  const direct = PRICES[modelId];
  if (direct) return direct;
  const alias = aliasForSnapshot(modelId);
  return alias ? PRICES[alias] : undefined;
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
  const price = priceFor(modelId);
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
