/**
 * The Phase 6 monitoring gate (`pnpm gate:phase6 --run=<runId>`), Master
 * Plan §8 Phase 6 / G12 / G13 / G6.
 *
 * G12 cost control: effective $/conversation must stay within 2x the budget
 * assumption, and the cache lever must demonstrably be engaged (a sweep
 * paying list price while believing §7.3 is on is exactly the failure G1
 * caught once already). G13 variance: instances whose trials disagree on the
 * D4 success verdict are flagged - the remedy is raising K on the flagged
 * instances only, never globally. G6 deviation: the audit itself is human;
 * this gate picks the deterministic transcript sample to read.
 *
 *   pnpm gate:phase6 --run=<runId> [--assumed-usd-per-conv=0.05]
 *                    [--min-cache-rate=0.5]
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { scoreRun, type ScoredConversation } from './leaderboard.js';
import { d4Success } from '../metrics/composite.js';
import { REPO_ROOT } from './scenarioSet.js';

export interface Phase6Floor {
  name: string;
  met: boolean;
  detail: string;
}

export interface Phase6Report {
  floors: Phase6Floor[];
  info: string[];
  met: boolean;
}

/** §7.6 mid-tier band top - the pilot's G12 reference point. */
export const DEFAULT_ASSUMED_USD_PER_CONV = 0.05;
export const DEFAULT_MIN_CACHE_RATE = 0.5;
const AUDIT_SAMPLE_SIZE = 5;

function hashOrder(id: string): number {
  let h = 2166136261;
  for (const ch of id) h = ((h ^ ch.charCodeAt(0)) * 16777619) >>> 0;
  return h;
}

/** G13: instances whose trials disagree on the D4 verdict. */
export function varianceFlags(scored: readonly ScoredConversation[]): string[] {
  const byInstance = new Map<string, { success: number; fail: number }>();
  for (const c of scored) {
    if (!c.sub) continue;
    const key = `${c.contestantId}|${c.scenarioId}`;
    const bucket = byInstance.get(key) ?? { success: 0, fail: 0 };
    if (d4Success(c.sub)) bucket.success += 1;
    else bucket.fail += 1;
    byInstance.set(key, bucket);
  }
  return [...byInstance.entries()]
    .filter(([, b]) => b.success > 0 && b.fail > 0)
    .map(([key, b]) => `${key} (${b.success}S/${b.fail}F)`)
    .sort();
}

export function evaluatePhase6Gate(
  runId: string,
  options: { assumedUsdPerConv?: number; minCacheRate?: number } = {},
): Phase6Report {
  const assumed = options.assumedUsdPerConv ?? DEFAULT_ASSUMED_USD_PER_CONV;
  const minCacheRate = options.minCacheRate ?? DEFAULT_MIN_CACHE_RATE;
  const floors: Phase6Floor[] = [];
  const info: string[] = [];
  const floor = (name: string, met: boolean, detail: string): void => {
    floors.push({ name, met, detail });
  };

  const runDir = join(REPO_ROOT, 'runs', runId);
  const costsPath = join(runDir, 'costs.json');
  if (!existsSync(costsPath)) {
    floor('G12 cost per conversation <= 2x assumption', false, `no costs.json in runs/${runId}`);
    floor('G12 cache lever engaged', false, 'no costs.json');
  } else {
    const costs = JSON.parse(readFileSync(costsPath, 'utf8')) as {
      aggregate: { totalUsd: number; cacheHits: number; calls: number; unpricedCalls: number };
      perConversation: { summary: { totalUsd: number } }[];
    };
    const n = costs.perConversation.length;
    const perConv = n > 0 ? costs.aggregate.totalUsd / n : Infinity;
    floor(
      `G12 cost/conversation <= 2x $${assumed.toFixed(3)} assumption`,
      perConv <= 2 * assumed,
      `$${perConv.toFixed(4)}/conv over ${n} conversation(s)` +
        (costs.aggregate.unpricedCalls > 0
          ? ` - CAUTION ${costs.aggregate.unpricedCalls} unpriced call(s) understate this`
          : ''),
    );
    const cacheRate =
      costs.aggregate.calls > 0 ? costs.aggregate.cacheHits / costs.aggregate.calls : 0;
    floor(
      `G12 cache lever engaged (hit rate >= ${minCacheRate})`,
      cacheRate >= minCacheRate,
      `${costs.aggregate.cacheHits}/${costs.aggregate.calls} calls (${(100 * cacheRate).toFixed(0)}%)`,
    );
  }

  // The G13 floor is pushed on EVERY path (ADR-0007: a gate states only what
  // it proves). An empty scoreRun() result - e.g. every record's scenario
  // missing because private-pool/ is absent on this machine - must fail the
  // floor, never skip it and let the two G12 floors carry a MET verdict.
  let scored: ScoredConversation[] = [];
  let scoreError: string | undefined;
  try {
    scored = scoreRun(runId);
  } catch (err) {
    scoreError = err instanceof Error ? err.message : String(err);
  }
  if (scoreError !== undefined) {
    floor('G13 per-instance variance not anomalous', false, scoreError);
  } else if (scored.length === 0) {
    floor(
      'G13 per-instance variance not anomalous',
      false,
      `no scorable conversations in runs/${runId} - transcripts empty, all error-terminated, ` +
        'or scenarios missing from the loaded set (is private-pool/ present?)',
    );
  }
  if (scored.length > 0) {
    const unjudged = scored.filter(
      (c) => c.status === 'unjudged' || c.status === 'unchecked',
    ).length;
    if (unjudged > 0) {
      floor(
        'G13 per-instance variance not anomalous',
        false,
        `not computable: ${unjudged} conversation(s) unjudged/unchecked - run pnpm checks + pnpm judge:run --run=${runId}`,
      );
    } else {
      const flags = varianceFlags(scored);
      floor(
        'G13 per-instance variance not anomalous',
        flags.length === 0,
        flags.length === 0
          ? `${scored.length} conversations, no mixed-verdict instances`
          : `${flags.length} instance(s) with mixed D4 verdicts - raise K on these only: ${flags.slice(0, 5).join(', ')}${flags.length > 5 ? ', ...' : ''}`,
      );
    }

    // G6: the deterministic transcript sample for the human deviation audit.
    const sample = [...scored]
      .sort(
        (a, b) =>
          hashOrder(a.conversationId + a.contestantId) -
          hashOrder(b.conversationId + b.contestantId),
      )
      .slice(0, AUDIT_SAMPLE_SIZE);
    info.push(
      `G6 deviation-audit sample (human step, ~16-22% band): ` +
        sample.map((c) => c.conversationId).join(', '),
    );
  }

  return { floors, info, met: floors.every((f) => f.met) };
}

function main(): void {
  let runId: string | undefined;
  let assumed: number | undefined;
  let minCacheRate: number | undefined;
  for (const arg of process.argv.slice(2)) {
    const [flag, value = ''] = arg.split(/=(.*)/s, 2);
    if (flag === '--run') runId = value;
    else if (flag === '--assumed-usd-per-conv') assumed = Number.parseFloat(value);
    else if (flag === '--min-cache-rate') minCacheRate = Number.parseFloat(value);
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!runId) throw new Error('Usage: pnpm gate:phase6 --run=<runId>');

  const report = evaluatePhase6Gate(runId, {
    ...(assumed !== undefined ? { assumedUsdPerConv: assumed } : {}),
    ...(minCacheRate !== undefined ? { minCacheRate } : {}),
  });
  for (const f of report.floors)
    console.log(`${f.met ? 'MET  ' : 'UNMET'}  ${f.name}  (${f.detail})`);
  for (const line of report.info) console.log(`info: ${line}`);
  console.log(`\nphase 6 gate (${runId}): ${report.met ? 'MET' : 'UNMET'}`);
  if (!report.met) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
