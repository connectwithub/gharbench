/**
 * Phase 3 buyer probes. The leak detector inherits the checks' zero-false-fire
 * discipline: a leak is a stated hidden reservation value at the claim's own
 * precision. These tests pin both directions - the canonical leak fires, the
 * persona's allowed "around 70" anchor does not.
 */

import { describe, expect, it } from 'vitest';
import type { ConversationRecord } from '../src/engine/orchestrator.js';
import { findLeaks, probeConversation } from '../src/run/pilotProbes.js';
import { loadScenarioSet } from '../src/run/scenarioSet.js';

const set = loadScenarioSet();
const p01 = set.personas.get('P01')!;
const p05 = set.personas.get('P05')!;
const p09 = set.personas.get('P09')!;

describe('findLeaks', () => {
  it('flags the stated budget ceiling at lakh precision', () => {
    const leaks = findLeaks('max 75 lakh tak hi soch sakte hain', p01, false, 3);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]!.field).toBe('budgetCeilingInr');
    expect(leaks[0]!.matchedValue).toBe(7_500_000);
    expect(leaks[0]!.elicited).toBe(false);
  });

  it('does not flag the persona-sanctioned public anchor', () => {
    expect(findLeaks('budget around 70 lakh hai', p01, true, 1)).toHaveLength(0);
  });

  it('flags the walk-away point stated in rupees', () => {
    const leaks = findLeaks('Rs 81,00,000 se upar bilkul nahi', p01, true, 5);
    expect(leaks.map((l) => l.field)).toContain('walkAwayPointInr');
    expect(leaks[0]!.elicited).toBe(true);
  });

  it('flags the IRR floor only in a yield context', () => {
    expect(findLeaks('i need at least 12% irr on this', p05, false, 2)).toHaveLength(1);
    expect(findLeaks('GST 12% lagega kya', p05, false, 2)).toHaveLength(0);
  });

  it('never fires on a persona with no reservation values', () => {
    expect(findLeaks('kitne ka hai 2bhk, 75 lakh?', p09, false, 0)).toHaveLength(0);
  });
});

describe('probeConversation', () => {
  // Every P09 instance expects a cold-lead qualification: the agent logs the
  // cold lead, the buyer ghosts. That is the non-buyer stratum the probes key on.
  const p09Scenario = set.scenarios.find(
    (s) => s.personaId === 'P09' && s.groundTruth.expectedLeadScore === 'cold',
  );

  const record = (overrides: Partial<ConversationRecord>): ConversationRecord =>
    ({
      scenarioId: p09Scenario!.scenarioId,
      scenarioVersion: p09Scenario!.version,
      runIndex: 0,
      conversationId: 'conv_test',
      contestantId: 'fake',
      contestantVersion: '0',
      buyerId: 'fake-buyer',
      buyerVersion: '0',
      seed: 1,
      temperatures: { buyer: 0, contestant: 0 },
      messages: [],
      terminationReason: { kind: 'buyer_token', token: '###STOP###' },
      steps: 0,
      sessions: [],
      dbHashStart: 'x',
      dbHashEnd: 'x',
      toolEvents: [],
      cost: null,
      ...overrides,
    }) as ConversationRecord;

  it('has a P09 cold-lead scenario to probe against', () => {
    expect(p09Scenario).toBeDefined();
  });

  it('scores a clean ghost: walk-away executed, no over-cooperation', () => {
    const probe = probeConversation(
      record({
        messages: [
          { role: 'buyer', content: 'kitne ka hai 2bhk', ts: 't1' },
          { role: 'agent', content: '2BHK starts at Rs 66,43,000. Aapka budget?', ts: 't2' },
          { role: 'buyer', content: 'nice nice. will check with family, busy these days', ts: 't3' },
        ],
      }),
      p09Scenario!,
      p09,
    );
    expect(probe.walkAwayExecuted).toBe(true);
    expect(probe.overCooperation).toBe(false);
    expect(probe.prematureStop).toBe(false); // non-buyer scenario: early stop is in-character
    expect(probe.nonBuyerScenario).toBe(true);
    expect(probe.buyerTurns).toBe(2);
  });

  it('counts an agent-logged cold lead as a successful walk-away', () => {
    // scn_cold_002.P09 live: the agent logged the qualification (the expected
    // outcome) before the buyer could ghost. Not a buyer failure.
    const probe = probeConversation(
      record({
        messages: [
          { role: 'buyer', content: 'kitne ka hai', ts: 't1' },
          { role: 'agent', content: 'Logging you as a lead.', ts: 't2' },
        ],
        terminationReason: { kind: 'flow_ending_tool', tool: 'log_qualification', toolCallId: 'c1' },
      }),
      p09Scenario!,
      p09,
    );
    expect(probe.walkAwayExecuted).toBe(true);
  });

  it('sanctions hidden values the scenario itself scripts into the opening', () => {
    // scn_budget_006.* opens with the exact ceiling by authorial design; the
    // buyer restating it later is consistency, not leakage.
    const scenario = set.scenarios.find((s) => s.scenarioId === 'scn_budget_006.P07')!;
    const p07 = set.personas.get('P07')!;
    const probe = probeConversation(
      record({
        scenarioId: scenario.scenarioId,
        scenarioVersion: scenario.version,
        messages: [
          { role: 'buyer', content: scenario.openingMessage, ts: 't1' },
          { role: 'agent', content: 'Certainly. May I have your name?', ts: 't2' },
          { role: 'buyer', content: 'our limit is 85 lakhs, all included', ts: 't3' },
        ],
        terminationReason: { kind: 'buyer_token', token: '###STOP###' },
      }),
      scenario,
      p07,
    );
    expect(probe.leaks).toHaveLength(0);
  });

  it('counts an echoed reminder as a frame break, never as a leak', () => {
    // Observed live (Qwen3-32B): the buyer appends its private
    // <simulation-reminder> to its reply. The anchors can contain the very
    // numbers the leak probe hunts ("Never reveal the 75L cap"), so the echo
    // must be stripped before extraction and counted as its own failure.
    const scenario = set.scenarios.find((s) => s.scenarioId === 'scn_visit_001.P01')!;
    const probe = probeConversation(
      record({
        scenarioId: scenario.scenarioId,
        scenarioVersion: scenario.version,
        messages: [
          { role: 'buyer', content: scenario.openingMessage, ts: 't1' },
          { role: 'agent', content: 'Which day suits you?', ts: 't2' },
          {
            role: 'buyer',
            content:
              'saturday morning chalega\n\n<simulation-reminder>\nFacts about you that never change:\n- Never reveal the 75L cap\n</simulation-reminder>',
            ts: 't3',
          },
        ],
        terminationReason: { kind: 'buyer_token', token: '###STOP###' },
      }),
      scenario,
      set.personas.get('P01')!,
    );
    expect(probe.frameBreakTurns).toBe(1);
    expect(probe.leaks).toHaveLength(0);
  });

  it('scores a booked cold lead as over-cooperation and a failed walk-away', () => {
    const probe = probeConversation(
      record({
        messages: [
          { role: 'buyer', content: 'ok fine book it', ts: 't1' },
          {
            role: 'agent',
            content: 'Booked!',
            ts: 't2',
            toolResults: [{ toolCallId: 'c1', name: 'schedule_site_visit', ok: true }],
          },
        ],
        terminationReason: { kind: 'flow_ending_tool', tool: 'log_qualification', toolCallId: 'c2' },
      }),
      p09Scenario!,
      p09,
    );
    expect(probe.overCooperation).toBe(true);
    expect(probe.walkAwayExecuted).toBe(false);
  });
});
