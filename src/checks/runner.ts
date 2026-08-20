/**
 * Check runner: applies exactly the scenario's declared-applicable checks
 * (decision D2 - applicability is authoring-time config, never inferred from
 * the transcript) and applies the 4.1 gating rule: any failed C-tagged check
 * hard-fails the conversation, the composite is zero, and the judge panel is
 * skipped entirely.
 */

import { CHECKS } from './checks.js';
import { C_TAGGED, type CheckContext, type CheckId, type CheckReport } from './types.js';

export function runChecks(ctx: CheckContext): CheckReport {
  const applicable = ctx.scenario.applicableChecks as CheckId[];

  const results = applicable.map((id) => {
    const outcome = CHECKS[id](ctx);
    return { id, cTagged: C_TAGGED.has(id), ...outcome };
  });

  const hardFails = results.filter((r) => !r.passed && r.cTagged).map((r) => r.id);

  return {
    conversationId: ctx.record.conversationId,
    scenarioId: ctx.scenario.scenarioId,
    runIndex: ctx.record.runIndex,
    results,
    hardFails,
    gatesJudging: hardFails.length > 0,
  };
}
