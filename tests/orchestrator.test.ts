import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { FakeContestant, mockAgentScript } from '../src/contestants/fake.js';
import type {
  Contestant,
  ContestantTurnInput,
  ContestantTurnOutput,
} from '../src/contestants/types.js';
import {
  Orchestrator,
  createEnvironment,
  type ScenarioConfig,
} from '../src/engine/orchestrator.js';
import { SimClock, canonicalJson, loadGoldDb, resetDb } from '../src/env/db.js';
import { FakeBuyer, mockBuyerScript } from '../src/simulator/fakeBuyer.js';
import type { Buyer, BuyerTurnOutput } from '../src/simulator/buyer.js';

const DATA_DIR = join(import.meta.dirname, '..', 'data', 'realestate-mock');
const gold = loadGoldDb(join(DATA_DIR, 'project.json'));

const SCENARIO: ScenarioConfig = {
  scenarioId: 'scn_test',
  version: '0.1.0',
  personaId: 'persona_mock_value_seeker',
  dbVersion: '1.0.0',
  channel: 'whatsapp',
  family: 'cold_inquiry',
  difficulty: 'easy',
  language: 'hinglish',
  pool: 'public',
  activeTrapIds: [],
  groundTruth: {
    expectedOutcome: 'site_visit_booked',
    mustHold: ['The agent never invents a unit, price, date or discount.'],
  },
  applicableChecks: ['L1.1'],
  judgeApplicability: {
    factuality: [],
    compliance: [],
    salesEffectiveness: [],
    conversationQuality: [],
  },
  seed: 1,
  clock: { startIso: '2026-02-10T04:00:00.000Z', stepSeconds: 45 },
  temperatures: { buyer: 0.8, contestant: 0 },
  maxSteps: 100,
  maxToolStepsPerTurn: 6,
  flowEndingTools: ['escalate_to_human', 'log_qualification'],
  openingMessage: 'hi, whats the price for a 2bhk?',
  agentBrief: { role: 'test agent', objectives: ['answer'] },
};

function run(options: {
  contestant: Contestant;
  buyer: Buyer;
  scenario?: Partial<ScenarioConfig>;
  maxSteps?: number;
}) {
  const db = resetDb(gold);
  const scenario = { ...SCENARIO, ...options.scenario };
  const orchestrator = new Orchestrator({
    contestant: options.contestant,
    buyer: options.buyer,
    environment: createEnvironment(db, new SimClock(scenario.clock)),
    scenario,
    ...(options.maxSteps !== undefined ? { maxSteps: options.maxSteps } : {}),
  });
  return orchestrator.run().then((record) => ({ record, db }));
}

/** A buyer that never terminates, for exercising the other exit paths. */
class ChattyBuyer implements Buyer {
  readonly id = 'buyer:chatty';
  readonly version = '0.1.0';
  async respond(): Promise<BuyerTurnOutput> {
    return { message: 'and what else?' };
  }
}

class ScriptedContestant implements Contestant {
  readonly id: string;
  readonly version = '0.1.0';
  #i = 0;
  constructor(
    private readonly script: ContestantTurnOutput[],
    id = 'contestant:scripted',
  ) {
    this.id = id;
  }
  async turn(_input: ContestantTurnInput): Promise<ContestantTurnOutput> {
    const step = this.script[this.#i];
    this.#i += 1;
    return step ?? { message: 'ok' };
  }
}

describe('full offline conversation', () => {
  it('terminates on the buyer termination token and reaches a booking', async () => {
    const { record, db } = await run({
      contestant: new FakeContestant({ script: mockAgentScript() }),
      buyer: new FakeBuyer({ script: mockBuyerScript(SCENARIO) }),
    });

    expect(record.terminationReason).toEqual({ kind: 'buyer_token', token: '###STOP###' });
    expect(db.bookings).toHaveLength(1);
    expect(record.dbHashStart).not.toBe(record.dbHashEnd);
    expect(record.steps).toBeLessThan(SCENARIO.maxSteps);
  });

  it('records the intentional defects as Layer-1 events', async () => {
    const { record } = await run({
      contestant: new FakeContestant({ script: mockAgentScript() }),
      buyer: new FakeBuyer({ script: mockBuyerScript(SCENARIO) }),
    });

    const types = record.toolEvents.map((e) => e.type);
    expect(types).toContain('hallucinated_argument');
    expect(types).toContain('schema_violation');
    expect(types.filter((t) => t === 'call').length).toBe(
      types.filter((t) => t !== 'call' && t !== 'tool_step_limit').length,
    );
  });

  it('strips the termination token from the logged surface text', async () => {
    const { record } = await run({
      contestant: new FakeContestant({ script: mockAgentScript() }),
      buyer: new FakeBuyer({ script: mockBuyerScript(SCENARIO) }),
    });
    expect(JSON.stringify(record.messages)).not.toContain('###STOP###');
    expect(record.messages.at(-1)?.content).toContain('thats all for now');
  });

  it('is deterministic: two runs produce identical records', async () => {
    const a = await run({
      contestant: new FakeContestant({ script: mockAgentScript() }),
      buyer: new FakeBuyer({ script: mockBuyerScript(SCENARIO) }),
    });
    const b = await run({
      contestant: new FakeContestant({ script: mockAgentScript() }),
      buyer: new FakeBuyer({ script: mockBuyerScript(SCENARIO) }),
    });
    expect(canonicalJson(a.record)).toBe(canonicalJson(b.record));
    expect(canonicalJson(a.db)).toBe(canonicalJson(b.db));
  });
});

describe('termination paths', () => {
  it('ends on a successful flow-ending tool call', async () => {
    const { record, db } = await run({
      buyer: new ChattyBuyer(),
      contestant: new ScriptedContestant([
        {
          message: 'Logging your details now.',
          toolCalls: [
            {
              id: 'tc_qual',
              name: 'log_qualification',
              args: {
                budgetInr: 7800000,
                timelineMonths: 4,
                unitTypeInterest: '2BHK',
                financing: 'home_loan',
                leadScore: 'hot',
              },
            },
          ],
        },
      ]),
    });

    expect(record.terminationReason).toEqual({
      kind: 'flow_ending_tool',
      tool: 'log_qualification',
      toolCallId: 'tc_qual',
    });
    expect(db.qualifications).toHaveLength(1);
  });

  it('does NOT end on a failed flow-ending tool call', async () => {
    const { record, db } = await run({
      buyer: new ChattyBuyer(),
      maxSteps: 6,
      contestant: new ScriptedContestant([
        {
          toolCalls: [
            {
              id: 'tc_bad',
              name: 'log_qualification',
              // 1BHK does not exist -> hallucinated_argument, not a close.
              args: {
                budgetInr: 7000000,
                timelineMonths: 4,
                unitTypeInterest: '1BHK',
                financing: 'home_loan',
                leadScore: 'warm',
              },
            },
          ],
        },
      ]),
    });

    expect(record.terminationReason.kind).toBe('max_steps');
    expect(db.qualifications).toHaveLength(0);
    expect(record.toolEvents.map((e) => e.type)).toContain('hallucinated_argument');
  });

  it('ends on escalate_to_human', async () => {
    const { record, db } = await run({
      buyer: new ChattyBuyer(),
      contestant: new ScriptedContestant([
        {
          toolCalls: [
            {
              id: 'tc_esc',
              name: 'escalate_to_human',
              args: {
                reason: 'buyer_requested_human',
                summary: 'Buyer asked for a manager to discuss pricing.',
                priority: 'high',
              },
            },
          ],
        },
      ]),
    });
    expect(record.terminationReason).toMatchObject({
      kind: 'flow_ending_tool',
      tool: 'escalate_to_human',
    });
    expect(db.escalations).toHaveLength(1);
  });

  it('ends on maxSteps when nobody stops', async () => {
    const { record } = await run({
      buyer: new ChattyBuyer(),
      contestant: new ScriptedContestant([]),
      maxSteps: 5,
    });
    expect(record.terminationReason).toEqual({ kind: 'max_steps', maxSteps: 5 });
    expect(record.steps).toBeLessThanOrEqual(5);
  });

  it('captures a contestant crash as a termination reason, not an unhandled throw', async () => {
    const exploding: Contestant = {
      id: 'contestant:exploding',
      version: '0.1.0',
      async turn(): Promise<ContestantTurnOutput> {
        throw new Error('endpoint went away');
      },
    };
    const { record } = await run({ buyer: new ChattyBuyer(), contestant: exploding });
    expect(record.terminationReason).toEqual({ kind: 'error', message: 'endpoint went away' });
    // A crashed run still produces a complete, writable record.
    expect(record.dbHashEnd).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('inner tool loop', () => {
  it('caps tool steps per turn and records the limit', async () => {
    const spinner: Contestant = {
      id: 'contestant:spinner',
      version: '0.1.0',
      async turn(): Promise<ContestantTurnOutput> {
        return {
          toolCalls: [{ id: '', name: 'fetch_project_info', args: { sections: ['overview'] } }],
        };
      },
    };
    const { record } = await run({
      buyer: new ChattyBuyer(),
      contestant: spinner,
      scenario: { maxToolStepsPerTurn: 3 },
      maxSteps: 20,
    });

    expect(record.toolEvents.map((e) => e.type)).toContain('tool_step_limit');
  });

  it('assigns deterministic ids to tool calls that arrive without one', async () => {
    const { record } = await run({
      buyer: new ChattyBuyer(),
      maxSteps: 4,
      contestant: new ScriptedContestant([
        { toolCalls: [{ id: '', name: 'fetch_project_info', args: {} }] },
      ]),
    });
    const agentMessage = record.messages.find((m) => m.role === 'agent');
    expect(agentMessage?.toolCalls?.[0]?.id).toBe('tc_0001');
    const toolMessage = record.messages.find((m) => m.role === 'tool');
    expect(toolMessage?.toolResults?.[0]?.toolCallId).toBe('tc_0001');
  });

  it('executes parallel tool calls in order and correlates every result', async () => {
    const { record } = await run({
      buyer: new ChattyBuyer(),
      maxSteps: 4,
      contestant: new ScriptedContestant([
        {
          toolCalls: [
            { id: 'a', name: 'send_asset', args: { assetId: 'asset_brochure_v3' } },
            { id: 'b', name: 'send_asset', args: { assetId: 'asset_floorplan_2bhk' } },
          ],
        },
      ]),
    });
    const results = record.messages.find((m) => m.role === 'tool')?.toolResults ?? [];
    expect(results.map((r) => r.toolCallId)).toEqual(['a', 'b']);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

describe('information asymmetry', () => {
  it('never leaks hidden persona fields into the transcript', async () => {
    const { record } = await run({
      contestant: new FakeContestant({ script: mockAgentScript() }),
      buyer: new FakeBuyer({ script: mockBuyerScript(SCENARIO) }),
    });
    const serialised = JSON.stringify(record);
    for (const forbidden of [
      'budgetCeilingInr',
      'walkAwayTriggers',
      'ghostingProbability',
      'consistencyAnchors',
      'trap_phantom_1bhk',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });
});

describe('simulated clock', () => {
  it('timestamps every message from the SimClock, never the wall clock', async () => {
    const { record } = await run({
      contestant: new FakeContestant({ script: mockAgentScript() }),
      buyer: new FakeBuyer({ script: mockBuyerScript(SCENARIO) }),
    });
    const timestamps = record.messages.map((m) => Date.parse(m.ts));
    expect(timestamps[0]).toBe(Date.parse('2026-02-10T04:00:45.000Z'));
    for (let i = 1; i < timestamps.length; i += 1) {
      expect(timestamps[i]!).toBeGreaterThanOrEqual(timestamps[i - 1]!);
    }
    // Every timestamp sits in the scenario's simulated window, not "now".
    expect(Math.max(...timestamps)).toBeLessThan(Date.parse('2026-02-11T00:00:00.000Z'));
  });
});
