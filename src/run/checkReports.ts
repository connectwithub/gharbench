/**
 * Contestant-aware reader for a run's checks.jsonl.
 *
 * Conversation ids are only `scenario#trial` - IDENTICAL across contestants
 * in a multi-contestant sweep - so keying reports by conversationId alone
 * silently hands one contestant's programmatic results (and hard-fail gate!)
 * to every other contestant in the run. Reports written since the fix carry
 * `contestantId`; lookups here prefer the (contestant, conversation) key and
 * fall back to conversationId only when it is unique in the file. An
 * ambiguous legacy file (duplicate conversationIds, no contestantId) fails
 * loudly instead of scoring the wrong model: regenerate it with
 * `pnpm checks --run=<runId>`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CheckReport } from '../checks/types.js';

/**
 * Contestant ids appear in three spellings that all name the same model run:
 * the transcript's `contestant:<provider>/<model>`, a sweep's requested ref
 * `<provider>/<model>[@HostPin]`, and the bare ref. Strip the role prefix and
 * the routing pin so any spelling keys the same report.
 */
const normaliseContestant = (id: string): string =>
  id.replace(/^contestant:/, '').replace(/@[^/@]+$/, '');

export interface CheckReportIndex {
  /** Number of reports in the file. */
  size: number;
  /** Lookup by (contestantId, conversationId); throws on an ambiguous legacy file. */
  get(contestantId: string, conversationId: string): CheckReport | undefined;
}

export function readCheckReports(runDir: string): CheckReportIndex {
  const byKey = new Map<string, CheckReport>();
  const byConversation = new Map<string, CheckReport>();
  const ambiguous = new Set<string>();
  let size = 0;
  const path = join(runDir, 'checks.jsonl');
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const report = JSON.parse(line) as CheckReport;
      size += 1;
      if (report.contestantId !== undefined) {
        byKey.set(`${normaliseContestant(report.contestantId)}|${report.conversationId}`, report);
      }
      if (byConversation.has(report.conversationId)) ambiguous.add(report.conversationId);
      byConversation.set(report.conversationId, report);
    }
  }
  return {
    size,
    get(contestantId: string, conversationId: string): CheckReport | undefined {
      const keyed = byKey.get(`${normaliseContestant(contestantId)}|${conversationId}`);
      if (keyed !== undefined) return keyed;
      if (ambiguous.has(conversationId)) {
        throw new Error(
          `${path} has multiple reports for ${conversationId} and none matches contestant ` +
            `"${contestantId}" - a multi-contestant run needs per-contestant reports; ` +
            `regenerate with pnpm checks --run=<runId>.`,
        );
      }
      return byConversation.get(conversationId);
    },
  };
}
