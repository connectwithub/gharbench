/**
 * Operational profile: descriptive latency/throughput telemetry per contestant
 * (ADR-0031). Explicitly NOT a scored metric - reply latency measures the
 * provider's serving stack (route, region, load, cache state) on the run date,
 * not the model checkpoint, so it never enters the composite, a ranking, or a
 * gate. It exists because WhatsApp delivers messages whole (no streaming):
 * full-response latency here IS the wait a lead experiences, which makes it
 * decision-relevant for anyone deploying an agent, and worth publishing beside
 * $/conv as long as it is labeled as serving telemetry.
 *
 * Pure functions over the per-call records that sweep persists into
 * costs.json. A "reply" is one buyer-visible agent turn: the run of
 * consecutive contestant calls between two buyer calls (the inner tool loop
 * makes one model call per tool step, and the buyer sees nothing until the
 * run ends). Grouping therefore needs no engine plumbing - the meter's
 * chronological call order already carries the turn boundaries.
 */

/** The slice of a persisted call record the profile consumes. */
export interface ProfileCall {
  role: string;
  latencyMs: number;
  outputTokens?: number | undefined;
}

export interface LatencyStats {
  n: number;
  medianMs: number;
  p95Ms: number;
  meanMs: number;
  maxMs: number;
}

export interface OperationalProfile {
  conversations: number;
  replies: number;
  /** Wall-clock per buyer-visible reply (all tool-loop calls summed). */
  replyLatencyMs: LatencyStats;
  /** Wall-clock per individual contestant model call. */
  callLatencyMs: LatencyStats;
  callsPerReply: { mean: number; max: number };
  /**
   * Output tokens per second across contestant calls that reported
   * outputTokens; a serving-throughput proxy (includes network + queueing).
   */
  outputTokensPerSecond: number | null;
}

/** One buyer-visible reply: summed latency + how many tool-loop calls it took. */
export interface ReplyGroup {
  latencyMs: number;
  calls: number;
}

/**
 * Split a conversation's chronological call sequence into buyer-visible
 * replies. Contestant calls accumulate; a buyer call closes the open group.
 * Other roles (judge calls never appear in sweep costs, but be safe) neither
 * extend nor close a group. A scripted buyer opener makes no model call, so a
 * conversation legitimately starts with contestant calls - that run is the
 * first reply.
 */
export function replyGroups(calls: readonly ProfileCall[]): ReplyGroup[] {
  const groups: ReplyGroup[] = [];
  let current: ReplyGroup | null = null;
  for (const call of calls) {
    if (call.role === 'contestant') {
      current ??= { latencyMs: 0, calls: 0 };
      current.latencyMs += call.latencyMs;
      current.calls += 1;
    } else if (call.role === 'buyer' && current !== null) {
      groups.push(current);
      current = null;
    }
  }
  if (current !== null) groups.push(current);
  return groups;
}

/**
 * Order statistic at round(q*(n-1)) over the sorted values - the same
 * convention as the bootstrap CIs in ci.ts, so p50/p95 here and percentiles
 * there mean the same thing.
 */
function orderStat(sorted: readonly number[], q: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx] ?? 0;
}

function latencyStats(values: readonly number[]): LatencyStats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    medianMs: orderStat(sorted, 0.5),
    p95Ms: orderStat(sorted, 0.95),
    meanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

/**
 * Aggregate one contestant's conversations into its operational profile.
 * Returns null when no conversation carries a contestant call (e.g. every
 * costs.json predates per-call records) - absence stays loud, never a fake 0.
 */
export function operationalProfile(
  conversations: readonly (readonly ProfileCall[])[],
): OperationalProfile | null {
  const groups: ReplyGroup[] = [];
  let conversationsWithCalls = 0;
  const contestantCalls: ProfileCall[] = [];
  for (const calls of conversations) {
    const convGroups = replyGroups(calls);
    if (convGroups.length > 0) conversationsWithCalls += 1;
    groups.push(...convGroups);
    for (const c of calls) if (c.role === 'contestant') contestantCalls.push(c);
  }

  const reply = latencyStats(groups.map((g) => g.latencyMs));
  const call = latencyStats(contestantCalls.map((c) => c.latencyMs));
  if (reply === null || call === null) return null;

  let tokenSum = 0;
  let tokenLatencyMs = 0;
  for (const c of contestantCalls) {
    if (c.outputTokens === undefined) continue;
    tokenSum += c.outputTokens;
    tokenLatencyMs += c.latencyMs;
  }

  return {
    conversations: conversationsWithCalls,
    replies: groups.length,
    replyLatencyMs: reply,
    callLatencyMs: call,
    callsPerReply: {
      mean: groups.reduce((a, g) => a + g.calls, 0) / groups.length,
      max: groups.reduce((a, g) => Math.max(a, g.calls), 0),
    },
    outputTokensPerSecond: tokenLatencyMs > 0 ? (tokenSum / tokenLatencyMs) * 1000 : null,
  };
}
