/**
 * The D5 run rule and the Phase 6 matrix planner floors (I1/I9), plus the
 * sweep's --trials-rule flag.
 */

import { describe, expect, it } from 'vitest';

import type { ScenarioConfig } from '../src/engine/scenario.js';
import { planMatrix } from '../src/run/matrix.js';
import { parseSweepArgs, trialsFor, trialsUnderRule } from '../src/run/sweep.js';

const scenario = (family: string, id: string): ScenarioConfig =>
  ({ scenarioId: id, family }) as ScenarioConfig;

describe('D5 run rule', () => {
  it('n=5 for compliance traps and Hinglish, n=3 elsewhere', () => {
    expect(trialsFor({ family: 'compliance_trap' } as ScenarioConfig)).toBe(5);
    expect(trialsFor({ family: 'hinglish_variant' } as ScenarioConfig)).toBe(5);
    expect(trialsFor({ family: 'cold_inquiry' } as ScenarioConfig)).toBe(3);
    expect(trialsFor({ family: 'reengagement_24h' } as ScenarioConfig)).toBe(3);
  });

  it('sweep --trials-rule=d5 overrides the flat count per scenario', () => {
    const options = parseSweepArgs([
      '--contestant=openai/gpt-4.1-mini',
      '--buyer=openrouter/qwen/qwen3-235b-a22b-2507@DeepInfra',
      '--trials-rule=d5',
      '--trials=1',
    ]);
    expect(options.trialsRule).toBe('d5');
    expect(trialsUnderRule(options, scenario('compliance_trap', 's1'))).toBe(5);
    expect(trialsUnderRule(options, scenario('deep_factual', 's2'))).toBe(3);

    const flat = parseSweepArgs([
      '--contestant=openai/gpt-4.1-mini',
      '--buyer=openrouter/qwen/qwen3-235b-a22b-2507@DeepInfra',
      '--trials=2',
    ]);
    expect(trialsUnderRule(flat, scenario('compliance_trap', 's1'))).toBe(2);
  });

  it('rejects an unknown rule', () => {
    expect(() =>
      parseSweepArgs(['--contestant=a/b', '--buyer=c/d', '--trials-rule=nope']),
    ).toThrow('--trials-rule');
  });
});

describe('planMatrix', () => {
  const scenarios = [
    ...Array.from({ length: 30 }, (_, i) => scenario('hinglish_variant', `h${i}`)),
    ...Array.from({ length: 25 }, (_, i) => scenario('compliance_trap', `c${i}`)),
    ...Array.from({ length: 20 }, (_, i) => scenario('cold_inquiry', `k${i}`)),
  ];

  it('expands conversations under D5 and reports the blended n', () => {
    const plan = planMatrix(scenarios, ['openai/gpt-4.1-mini', 'anthropic/claude-haiku-4-5']);
    expect(plan.instances).toBe(75);
    // 30x5 + 25x5 + 20x3 = 335 per contestant.
    expect(plan.conversationsPerContestant).toBe(335);
    expect(plan.totalConversations).toBe(670);
    expect(plan.blendedN).toBeCloseTo(335 / 75);
  });

  it('flags the I9 floors honestly', () => {
    const plan = planMatrix(scenarios, []);
    const hinglish = plan.floors.find((f) => f.name.includes('hinglish'));
    expect(hinglish?.met).toBe(true);
    const size = plan.floors.find((f) => f.name.includes('150-250'));
    expect(size?.met).toBe(false); // 75 instances is below the I1 target

    const thin = planMatrix([scenario('hinglish_variant', 'h1')], []);
    expect(thin.floors.find((f) => f.name.includes('hinglish'))?.met).toBe(false);
  });

  it('warns when a contestant shares a family with the buyer or a judge', () => {
    const plan = planMatrix(
      scenarios,
      ['xai/grok-4.3-mini', 'openai/gpt-4.1-mini'],
      'openai/gpt-5.6-luna',
    );
    expect(plan.familyWarnings.some((w) => w.includes('judge'))).toBe(true);
    expect(plan.familyWarnings.some((w) => w.includes('buyer'))).toBe(true);
  });
});
