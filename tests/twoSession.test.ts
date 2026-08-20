/**
 * The 24-hour re-engagement flow (Master Plan 3.4 family 6, 5.2): one
 * conversation, two sessions, sim clock jumped across the gap, and the
 * environment event visible to the agent but never to the buyer.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { FakeContestant } from '../src/contestants/fake.js';
import type { ContestantTurnOutput } from '../src/contestants/types.js';
import {
  Orchestrator,
  createEnvironment,
  type ScenarioConfig,
} from '../src/engine/orchestrator.js';
import { SimClock, loadGoldDb, resetDb } from '../src/env/db.js';
import { toBuyerView } from '../src/simulator/buyer.js';
import { FakeBuyer } from '../src/simulator/fakeBuyer.js';
import { toModelMessages } from '../src/contestants/providerModel.js';

const DATA_DIR = join(import.meta.dirname, '..', 'data', 'realestate-mock');
const gold = loadGoldDb(join(DATA_DIR, 'project.json'));

const BASE: ScenarioConfig = {
  scenarioId: 'scn_test_reengage',
  version: '0.1.0',
  personaId: 'persona_mock_value_seeker',
  dbVersion: '1.0.0',
  channel: 'whatsapp',
  family: 'reengagement_24h',
  difficulty: 'medium',
  language: 'english',
  pool: 'public',
  activeTrapIds: [],
  groundTruth: {
    expectedOutcome: 'qualification_logged',
    expectedLeadScore: 'warm',
    mustHold: ['The agent re-engages exactly once within the messaging window.'],
  },
  applicableChecks: ['L1.1'],
  judgeApplicability: {
    factuality: [],
    compliance: [],
    salesEffectiveness: [],
    conversationQuality: [],
  },
  seed: 7,
  clock: { startIso: '2026-09-01T04:00:00.000Z', stepSeconds: 45 },
  temperatures: { buyer: 0.8, contestant: 0 },
  maxSteps: 20,
  maxToolStepsPerTurn: 4,
  flowEndingTools: ['escalate_to_human', 'log_qualification'],
  openingMessage: 'hi, price for a 2bhk?',
  secondSession: { gapSeconds: 86_400, opener: 'agent', maxSteps: 10 },
  agentBrief: { role: 'test agent', objectives: ['answer'] },
};

const say = (message: string): ContestantTurnOutput => ({ message });

function run(scenario: ScenarioConfig, buyerScript: string[], agentScript: ContestantTurnOutput[]) {
  const db = resetDb(gold);
  const orchestrator = new Orchestrator({
    contestant: new FakeContestant({ script: agentScript }),
    buyer: new FakeBuyer({ script: buyerScript }),
    environment: createEnvironment(db, new SimClock(scenario.clock)),
    scenario,
  });
  return orchestrator.run();
}

describe('two-session re-engagement flow', () => {
  it('agent-opener: gap event, clock jump, agent speaks first in session 2', async () => {
    const record = await run(
      BASE,
      [
        'hi, price for a 2bhk?',
        'hmm ok, let me think about it ###STOP###',
        'ok yes, im interested. share details ###STOP###',
      ],
      [
        say('2BHK starts at 68.5L. Shall I share options?'),
        say('Hi! Following up on the 2BHK - a park-facing unit just opened up. Interested?'),
      ],
    );

    expect(record.sessions).toHaveLength(2);
    expect(record.sessions[0]?.endReason).toEqual({ kind: 'buyer_token', token: '###STOP###' });
    expect(record.terminationReason).toEqual({ kind: 'buyer_token', token: '###STOP###' });
    expect(record.steps).toBe(record.sessions.reduce((acc, s) => acc + s.steps, 0));

    // The gap event exists, once, and the clock jumped at least 24h over it.
    const events = record.messages.filter((m) => m.role === 'system');
    expect(events).toHaveLength(1);
    expect(events[0]?.content).toContain('24 hours');
    const eventIdx = record.messages.findIndex((m) => m.role === 'system');
    const before = Date.parse(record.messages[eventIdx - 1]?.ts ?? '');
    const after = Date.parse(record.messages[eventIdx]?.ts ?? '');
    expect(after - before).toBeGreaterThanOrEqual(86_400_000);

    // Session 2 starts with the agent: the message after the event is agent-role.
    expect(record.messages[eventIdx + 1]?.role).toBe('agent');
    expect(record.messages[eventIdx + 1]?.content).toContain('Following up');
  });

  it('the gap event reaches the contestant but never the buyer', async () => {
    const record = await run(
      BASE,
      ['hi, price for a 2bhk?', 'not now, thanks ###STOP###', 'ok bye ###STOP###'],
      [say('Sure - 2BHK starts at 68.5L.'), say('Just checking in about the 2BHK!')],
    );

    const buyerView = toBuyerView(record.messages);
    for (const m of buyerView) {
      expect(m.content).not.toContain('hours have passed');
      expect(m.content).not.toContain('Re-engage');
    }

    const agentView = toModelMessages(record.messages);
    const eventMsgs = agentView.filter(
      (m) => typeof m.content === 'string' && m.content.includes('[system event]'),
    );
    expect(eventMsgs).toHaveLength(1);
    expect(eventMsgs[0]?.content).toContain('Re-engage the lead');
  });

  it('buyer-opener: the scripted return message is injected verbatim', async () => {
    const scenario: ScenarioConfig = {
      ...BASE,
      secondSession: {
        gapSeconds: 86_400,
        opener: 'buyer',
        buyerReturnMessage: 'hey, was thinking about that 2bhk again. still available?',
        maxSteps: 10,
      },
    };
    const record = await run(
      scenario,
      ['hi, price for a 2bhk?', 'ok let me think ###STOP###', 'great, thanks ###STOP###'],
      [say('2BHK starts at 68.5L.'), say('Yes! Two units still available.')],
    );

    expect(record.sessions).toHaveLength(2);
    const eventIdx = record.messages.findIndex((m) => m.role === 'system');
    const returned = record.messages[eventIdx + 1];
    expect(returned?.role).toBe('buyer');
    expect(returned?.content).toBe('hey, was thinking about that 2bhk again. still available?');
    // And the agent answers it next.
    expect(record.messages[eventIdx + 2]?.role).toBe('agent');
  });

  it('a flow-ending tool in session 1 pre-empts session 2', async () => {
    const record = await run(
      BASE,
      ['hi, need a human please'],
      [
        {
          message: 'Connecting you now.',
          toolCalls: [
            {
              id: '',
              name: 'escalate_to_human',
              args: {
                reason: 'buyer_requested_human',
                summary: 'Buyer asked for a human on the first message.',
                priority: 'normal',
              },
            },
          ],
        },
      ],
    );

    expect(record.sessions).toHaveLength(1);
    expect(record.terminationReason.kind).toBe('flow_ending_tool');
    expect(record.messages.filter((m) => m.role === 'system')).toHaveLength(0);
  });

  it('single-session scenarios record exactly one session, unchanged', async () => {
    const { secondSession, ...rest } = BASE;
    void secondSession;
    const scenario = { ...rest, family: 'cold_inquiry' } as ScenarioConfig;
    const record = await run(
      scenario,
      ['hi, price for a 2bhk?', 'thanks, bye ###STOP###'],
      [say('68.5L onwards.')],
    );
    expect(record.sessions).toHaveLength(1);
    expect(record.sessions[0]?.endReason).toEqual(record.terminationReason);
    expect(record.messages.filter((m) => m.role === 'system')).toHaveLength(0);
  });
});
