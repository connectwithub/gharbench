/**
 * Layer-1 check engine types (Master Plan 4.1).
 *
 * Every check is a pure function of (record, scenario, persona, gold DB) -
 * deterministic, offline, and ~10,000x cheaper than a judge call. Checks
 * return evidence with every verdict; a fail without a quotable reason is a
 * bug in the check, not a finding about the agent.
 */

import type { ConversationRecord } from '../engine/orchestrator.js';
import type { ScenarioConfig } from '../engine/scenario.js';
import type { RealEstateDb } from '../env/db.js';
import type { PersonaCard } from '../simulator/persona.js';

export type CheckId =
  | 'L1.1'
  | 'L1.2'
  | 'L1.3'
  | 'L1.4'
  | 'L1.5'
  | 'L1.6'
  | 'L1.7'
  | 'L1.8'
  | 'L1.9'
  | 'L1.10'
  | 'L1.11'
  | 'L1.12'
  | 'L1.13';

/** C-tagged checks feed the compliance hard-fail gate (4.1). */
export const C_TAGGED: ReadonlySet<CheckId> = new Set(['L1.3', 'L1.9', 'L1.10', 'L1.11', 'L1.13']);

export interface CheckContext {
  record: ConversationRecord;
  scenario: ScenarioConfig;
  persona: PersonaCard;
  gold: RealEstateDb;
}

export interface CheckResult {
  id: CheckId;
  /** True when the conversation satisfies the check. */
  passed: boolean;
  cTagged: boolean;
  /** One-line verdict rationale, always present. */
  reason: string;
  /** Verbatim quotes / event references backing the verdict. */
  evidence: string[];
}

export interface CheckReport {
  conversationId: string;
  /**
   * The transcript record's contestantId. Conversation ids are only
   * scenario#trial - identical across contestants in a multi-contestant
   * sweep - so a report is unambiguous only with this field. Optional for
   * checks.jsonl files written before it existed; readers fall back to
   * conversationId alone when it is unique in the file.
   */
  contestantId?: string;
  scenarioId: string;
  runIndex: number;
  /** Results for exactly the scenario's declared-applicable checks (D2). */
  results: CheckResult[];
  /** Failed C-tagged check ids. Non-empty means the judge panel is skipped. */
  hardFails: CheckId[];
  /** The 4.1 gating rule: composite is zero, judging spend is saved. */
  gatesJudging: boolean;
}

export type CheckFn = (ctx: CheckContext) => Omit<CheckResult, 'id' | 'cTagged'>;

export const pass = (reason: string, evidence: string[] = []) => ({
  passed: true,
  reason,
  evidence,
});

export const fail = (reason: string, evidence: string[] = []) => ({
  passed: false,
  reason,
  evidence,
});
