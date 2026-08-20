/**
 * Phase 3 buyer-simulator probes (`pnpm probes --run=<runId>`).
 *
 * Scores the BUYER, not the contestant. The Layer-1 checks ask "did the agent
 * behave?"; this asks "is the simulator a usable measurement instrument?"
 * (Master Plan §8 Phase 3, §6.3). Four machine-scorable probes:
 *
 *  - budget leakage: a buyer turn that states one of the persona's hidden
 *    reservation values (budget ceiling, walk-away point, EMI ceiling, down
 *    payment, yield/IRR floor). Split into `volunteered` (the preceding agent
 *    message asked nothing money-shaped) and `elicited` - the gate is on
 *    volunteered turns, the total is reported for the human review.
 *  - premature termination: ###STOP### in under PREMATURE_FLOOR_TURNS buyer
 *    turns in a scenario with a buyer-positive ground truth. Non-buyer
 *    scenarios (buyer_disengages, or a cold-lead qualification like every P09
 *    instance) are excluded: there, an early stop is in-character.
 *  - over-cooperation: a successful site-visit booking in a non-buyer
 *    scenario - the buyer had to hand over a phone number to make that happen.
 *  - walk-away execution: every P09 conversation must end in a buyer-initiated
 *    ###STOP### with no successful booking (does the cold lead actually ghost?).
 *
 * Extraction reuses the L1 machinery (extractMoneyClaims / matchesGround), so
 * the same zero-false-fire discipline applies: a leak is a *stated* hidden
 * value at the claim's own precision, never an inferred one. Under-detection
 * is acceptable; the human spot-check backstops. Persona adherence beyond
 * these proxies (register, "obviously an AI") is explicitly human-rated.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ChatMessage } from '../contestants/types.js';
import type { ConversationRecord } from '../engine/orchestrator.js';
import type { ScenarioConfig } from '../engine/scenario.js';
import { alphaTokens, extractMoneyClaims, matchesGround } from '../checks/extract.js';
import { HINDI_TOKENS } from '../checks/config.js';
import { TRANSCRIPT_FILENAME, readTranscripts } from '../logging/transcript.js';
import type { PersonaCard } from '../simulator/persona.js';
import { REPO_ROOT, loadScenarioSet } from './scenarioSet.js';
import { latestRunId } from './checksRun.js';

/** Below this many buyer turns, a STOP in a non-disengage scenario is premature. */
export const PREMATURE_FLOOR_TURNS = 4;

/** Phase-3 gate: volunteered leakage in at most this share of buyer turns. */
export const LEAK_GATE_TURN_PCT = 5;

export interface LeakEvent {
  turnIndex: number;
  quote: string;
  matchedValue: number;
  field: string;
  elicited: boolean;
}

export interface ConversationProbe {
  conversationId: string;
  scenarioId: string;
  personaId: string;
  language: ScenarioConfig['language'];
  expectedOutcome: ScenarioConfig['groundTruth']['expectedOutcome'];
  /** True when the correct end state involves no buyer commitment. */
  nonBuyerScenario: boolean;
  termination: string;
  buyerTurns: number;
  leaks: LeakEvent[];
  prematureStop: boolean;
  overCooperation: boolean;
  /** Only meaningful for P09: did the cold lead actually ghost? */
  walkAwayExecuted: boolean | null;
  bookingSucceeded: boolean;
  avgBuyerChars: number;
  /** Share of buyer alpha tokens on the frozen Hindi wordlist (style proxy). */
  hindiTokenShare: number;
}

export interface ProbeSummary {
  runId: string;
  conversations: ConversationProbe[];
  skipped: string[];
  aggregate: {
    conversations: number;
    buyerTurns: number;
    volunteeredLeakTurns: number;
    elicitedLeakTurns: number;
    volunteeredLeakTurnPct: number;
    transcriptsWithAnyLeak: number;
    prematureStops: number;
    prematureEligible: number;
    overCooperationEvents: number;
    overCooperationEligible: number;
    p09Conversations: number;
    p09Ghosted: number;
  };
  gate: {
    leakageMet: boolean;
    walkAwayMet: boolean;
    terminationDisciplineMet: boolean;
  };
}

/** Money-shaped elicitation by the agent: budget, financing, payment, price range. */
const MONEY_ELICITATION =
  /budget|kitn[ae]|price\s?range|how much|spend|afford|emi|down\s?payment|loan|financ|funding|payment plan|price bracket|range/i;

/** A yield/return context window, required before a bare percent counts as a leak. */
const YIELD_CONTEXT = /yield|rental return|returns?\b|irr|appreciation|kiraya/i;

const HIDDEN_MONEY_FIELDS = [
  'budgetCeilingInr',
  'walkAwayPointInr',
  'emiCeilingInr',
  'downPaymentAvailableInr',
] as const;

const HIDDEN_PCT_FIELDS = ['reservationYieldPctNet', 'reservationIrrPct'] as const;

function surfaceText(message: ChatMessage): string {
  return message.content.trim();
}

/**
 * Scenarios where the correct end state involves no buyer commitment: an
 * explicit disengagement, or a qualification whose ground-truth lead score is
 * cold (every P09 instance - the agent logs the cold lead, the buyer ghosts).
 */
export function isNonBuyerScenario(scenario: ScenarioConfig): boolean {
  return (
    scenario.groundTruth.expectedOutcome === 'buyer_disengages' ||
    scenario.groundTruth.expectedLeadScore === 'cold'
  );
}

/** Leaks in one buyer message against one persona's hidden economics. */
export function findLeaks(
  text: string,
  persona: PersonaCard,
  elicited: boolean,
  turnIndex: number,
): LeakEvent[] {
  const economics = persona.hidden.economics;
  const leaks: LeakEvent[] = [];

  for (const claim of extractMoneyClaims(text)) {
    for (const field of HIDDEN_MONEY_FIELDS) {
      const value = economics[field];
      if (value !== undefined && matchesGround(claim, [value]) !== undefined) {
        leaks.push({ turnIndex, quote: claim.quote, matchedValue: value, field, elicited });
      }
    }
  }

  for (const field of HIDDEN_PCT_FIELDS) {
    const value = economics[field];
    if (value === undefined) continue;
    for (const m of text.matchAll(/(\d{1,2}(?:\.\d+)?)\s?(?:%|(?:percent|per\s?cent)\b)/gi)) {
      if (Number.parseFloat(m[1]!) !== value) continue;
      const windowText = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40);
      if (YIELD_CONTEXT.test(windowText)) {
        leaks.push({ turnIndex, quote: m[0], matchedValue: value, field, elicited });
      }
    }
  }

  return leaks;
}

export function probeConversation(
  record: ConversationRecord,
  scenario: ScenarioConfig,
  persona: PersonaCard,
): ConversationProbe {
  const buyerMessages: Array<{ index: number; text: string; elicited: boolean }> = [];
  let lastAgentText = '';
  for (let i = 0; i < record.messages.length; i += 1) {
    const message = record.messages[i]!;
    if (message.role === 'agent' && surfaceText(message).length > 0) {
      lastAgentText = surfaceText(message);
    } else if (message.role === 'buyer') {
      buyerMessages.push({
        index: i,
        text: surfaceText(message),
        elicited: MONEY_ELICITATION.test(lastAgentText),
      });
    }
  }

  const leaks = buyerMessages.flatMap((m) => findLeaks(m.text, persona, m.elicited, m.index));

  const bookingSucceeded = record.messages.some((m) =>
    (m.toolResults ?? []).some((r) => r.name === 'schedule_site_visit' && r.ok),
  );

  const stopped =
    record.terminationReason.kind === 'buyer_token' &&
    record.terminationReason.token === '###STOP###';
  const expectedOutcome = scenario.groundTruth.expectedOutcome;
  const nonBuyer = isNonBuyerScenario(scenario);
  const prematureStop = stopped && !nonBuyer && buyerMessages.length < PREMATURE_FLOOR_TURNS;
  const overCooperation = nonBuyer && bookingSucceeded;
  const walkAwayExecuted = persona.personaId === 'P09' ? stopped && !bookingSucceeded : null;

  const totalChars = buyerMessages.reduce((a, m) => a + m.text.length, 0);
  const tokens = buyerMessages.flatMap((m) => alphaTokens(m.text));
  const hindiCount = tokens.filter((t) => HINDI_TOKENS.has(t)).length;

  const termination =
    record.terminationReason.kind === 'buyer_token'
      ? record.terminationReason.token
      : record.terminationReason.kind;

  return {
    conversationId: record.conversationId,
    scenarioId: record.scenarioId,
    personaId: persona.personaId,
    language: scenario.language,
    expectedOutcome,
    nonBuyerScenario: nonBuyer,
    termination,
    buyerTurns: buyerMessages.length,
    leaks,
    prematureStop,
    overCooperation,
    walkAwayExecuted,
    bookingSucceeded,
    avgBuyerChars: buyerMessages.length > 0 ? Math.round(totalChars / buyerMessages.length) : 0,
    hindiTokenShare: tokens.length > 0 ? Number((hindiCount / tokens.length).toFixed(3)) : 0,
  };
}

export function probeRun(runId: string): ProbeSummary {
  const runDir = join(REPO_ROOT, 'runs', runId);
  const transcriptPath = join(runDir, TRANSCRIPT_FILENAME);
  if (!existsSync(transcriptPath)) {
    throw new Error(`No ${TRANSCRIPT_FILENAME} in runs/${runId}`);
  }

  const set = loadScenarioSet();
  const scenarioById = new Map(set.scenarios.map((s) => [s.scenarioId, s]));

  const conversations: ConversationProbe[] = [];
  const skipped: string[] = [];
  for (const record of readTranscripts(transcriptPath)) {
    const scenario = scenarioById.get(record.scenarioId);
    const persona = scenario ? set.personas.get(scenario.personaId) : undefined;
    if (!scenario || !persona) {
      skipped.push(`${record.conversationId} (scenario not in the benchmark set)`);
      continue;
    }
    conversations.push(probeConversation(record, scenario, persona));
  }

  const buyerTurns = conversations.reduce((a, c) => a + c.buyerTurns, 0);
  const volunteeredTurns = new Set(
    conversations.flatMap((c) =>
      c.leaks.filter((l) => !l.elicited).map((l) => `${c.conversationId}:${l.turnIndex}`),
    ),
  ).size;
  const elicitedTurns = new Set(
    conversations.flatMap((c) =>
      c.leaks.filter((l) => l.elicited).map((l) => `${c.conversationId}:${l.turnIndex}`),
    ),
  ).size;
  const prematureEligible = conversations.filter((c) => !c.nonBuyerScenario).length;
  const overCoopEligible = conversations.filter((c) => c.nonBuyerScenario).length;
  const p09 = conversations.filter((c) => c.personaId === 'P09');

  const volunteeredLeakTurnPct =
    buyerTurns > 0 ? Number(((volunteeredTurns / buyerTurns) * 100).toFixed(2)) : 0;
  const prematureStops = conversations.filter((c) => c.prematureStop).length;
  const overCooperationEvents = conversations.filter((c) => c.overCooperation).length;
  const p09Ghosted = p09.filter((c) => c.walkAwayExecuted === true).length;

  const summary: ProbeSummary = {
    runId,
    conversations,
    skipped,
    aggregate: {
      conversations: conversations.length,
      buyerTurns,
      volunteeredLeakTurns: volunteeredTurns,
      elicitedLeakTurns: elicitedTurns,
      volunteeredLeakTurnPct,
      transcriptsWithAnyLeak: conversations.filter((c) => c.leaks.length > 0).length,
      prematureStops,
      prematureEligible,
      overCooperationEvents,
      overCooperationEligible: overCoopEligible,
      p09Conversations: p09.length,
      p09Ghosted,
    },
    gate: {
      leakageMet: volunteeredLeakTurnPct <= LEAK_GATE_TURN_PCT,
      walkAwayMet: p09.length === 0 || p09Ghosted === p09.length,
      terminationDisciplineMet: prematureStops === 0 && overCooperationEvents === 0,
    },
  };

  writeFileSync(join(runDir, 'buyer-probes.json'), JSON.stringify(summary, null, 2));
  return summary;
}

function main(): void {
  const runArg = process.argv.find((a) => a.startsWith('--run='))?.slice('--run='.length);
  const runId = runArg ?? latestRunId();
  if (!runId) throw new Error('No runs/ directory entries; pass --run=<runId>.');

  const summary = probeRun(runId);
  const a = summary.aggregate;
  const flag = (met: boolean): string => (met ? 'MET' : 'UNMET');

  console.log(`buyer probes for ${runId}: ${a.conversations} conversation(s)`);
  for (const skip of summary.skipped) console.log(`  skipped ${skip}`);
  console.log(
    `  leakage: ${a.volunteeredLeakTurns} volunteered / ${a.elicitedLeakTurns} elicited leak turn(s) of ${a.buyerTurns} buyer turns ` +
      `(volunteered ${a.volunteeredLeakTurnPct}%, gate <=${LEAK_GATE_TURN_PCT}%) -> ${flag(summary.gate.leakageMet)}`,
  );
  console.log(
    `  termination: ${a.prematureStops}/${a.prematureEligible} premature stop(s), ` +
      `${a.overCooperationEvents}/${a.overCooperationEligible} over-cooperation booking(s) -> ${flag(summary.gate.terminationDisciplineMet)}`,
  );
  console.log(
    `  walk-away: ${a.p09Ghosted}/${a.p09Conversations} P09 conversation(s) ghosted -> ${flag(summary.gate.walkAwayMet)}`,
  );
  console.log(`  detail: runs/${runId}/buyer-probes.json`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
