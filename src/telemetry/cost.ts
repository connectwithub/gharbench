/**
 * Per-call token / dollar / cache accounting.
 *
 * Every model call in the harness goes through `meterCall`, so a run's cost
 * report is a byproduct of running rather than something anyone has to
 * remember to instrument.
 *
 * `latencyMs` is the one place a wall clock is legitimate: it measures the
 * vendor, not the simulation. It is therefore excluded from any determinism
 * comparison (see `dbHashStart`/`dbHashEnd` and the transcript, which are not).
 */

import { estimateCostUsd, priceFor, type TokenUsage } from './prices.js';

export type CallRole = 'buyer' | 'contestant' | 'judge';

export interface ModelCallMeta {
  role: CallRole;
  modelId: string;
  provider: string;
  /** Simulated-clock timestamp, so the record stays reproducible. */
  ts: string;
}

export interface ModelCallRecord extends ModelCallMeta, TokenUsage {
  totalTokens: number;
  latencyMs: number;
  usd: number | null;
  priced: boolean;
  priceConfidence: 'verified' | 'unverified' | 'unknown';
  /** True when the provider reported a non-zero cached-prefix read. */
  cacheHit: boolean;
}

export interface CostSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalUsd: number;
  unpricedCalls: number;
  cacheHits: number;
  latencyMsTotal: number;
  byModel: Record<
    string,
    {
      calls: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      usd: number;
      unpricedCalls: number;
      cacheHits: number;
    }
  >;
}

/** Shape of an AI SDK v6 `usage` object, narrowed to what we bill on. */
export interface SdkUsageLike {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?:
    | {
        noCacheTokens?: number | undefined;
        cacheReadTokens?: number | undefined;
        cacheWriteTokens?: number | undefined;
      }
    | undefined;
}

/**
 * Normalise AI SDK usage into billable buckets.
 *
 * The SDK reports `inputTokens` as the full prompt size and breaks the cached
 * portion out in `inputTokenDetails`. Billing needs the *uncached* remainder,
 * so cached reads and writes are subtracted out rather than counted twice.
 */
export function normaliseUsage(usage: SdkUsageLike | undefined): TokenUsage {
  const details = usage?.inputTokenDetails;
  const cacheReadTokens = details?.cacheReadTokens ?? 0;
  const cacheWriteTokens = details?.cacheWriteTokens ?? 0;
  const reportedInput = usage?.inputTokens ?? 0;
  const uncached =
    details?.noCacheTokens ?? Math.max(0, reportedInput - cacheReadTokens - cacheWriteTokens);

  return {
    inputTokens: uncached,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens,
    cacheWriteTokens,
  };
}

export class CostMeter {
  readonly #records: ModelCallRecord[] = [];

  record(meta: ModelCallMeta, usage: TokenUsage, latencyMs: number): ModelCallRecord {
    const { usd, priced, confidence } = estimateCostUsd(meta.modelId, usage);
    const record: ModelCallRecord = {
      ...meta,
      ...usage,
      totalTokens:
        usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
      latencyMs,
      usd,
      priced,
      priceConfidence: confidence,
      cacheHit: usage.cacheReadTokens > 0,
    };
    this.#records.push(record);
    return record;
  }

  get records(): readonly ModelCallRecord[] {
    return this.#records;
  }

  summary(): CostSummary {
    const summary: CostSummary = {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      totalUsd: 0,
      unpricedCalls: 0,
      cacheHits: 0,
      latencyMsTotal: 0,
      byModel: {},
    };

    for (const r of this.#records) {
      summary.calls += 1;
      summary.inputTokens += r.inputTokens;
      summary.outputTokens += r.outputTokens;
      summary.cacheReadTokens += r.cacheReadTokens;
      summary.cacheWriteTokens += r.cacheWriteTokens;
      summary.totalTokens += r.totalTokens;
      summary.totalUsd += r.usd ?? 0;
      summary.latencyMsTotal += r.latencyMs;
      if (!r.priced) summary.unpricedCalls += 1;
      if (r.cacheHit) summary.cacheHits += 1;

      const bucket = (summary.byModel[r.modelId] ??= {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        usd: 0,
        unpricedCalls: 0,
        cacheHits: 0,
      });
      bucket.calls += 1;
      bucket.inputTokens += r.inputTokens;
      bucket.outputTokens += r.outputTokens;
      bucket.cacheReadTokens += r.cacheReadTokens;
      bucket.cacheWriteTokens += r.cacheWriteTokens;
      bucket.usd += r.usd ?? 0;
      if (!r.priced) bucket.unpricedCalls += 1;
      if (r.cacheHit) bucket.cacheHits += 1;
    }

    return summary;
  }

  merge(other: CostMeter): void {
    this.#records.push(...other.records);
  }
}

/**
 * Wrap a model call: time it, pull usage off the result, record it.
 * `extract` isolates the SDK-shaped access so a non-AI-SDK contestant
 * (e.g. an HTTP endpoint reporting its own usage) can use the same meter.
 */
export async function meterCall<T>(
  meter: CostMeter,
  meta: ModelCallMeta,
  call: () => Promise<T>,
  extract: (result: T) => SdkUsageLike | undefined,
): Promise<{ result: T; record: ModelCallRecord }> {
  const started = performance.now();
  const result = await call();
  const latencyMs = performance.now() - started;
  const record = meter.record(meta, normaliseUsage(extract(result)), latencyMs);
  return { result, record };
}

export function isPriceKnown(modelId: string): boolean {
  return priceFor(modelId) !== undefined;
}
