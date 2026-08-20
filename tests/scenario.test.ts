/**
 * Scenario schema suite: the Phase 1 gate criteria are load-time requirements.
 * A scenario without a deterministic ground truth, at least one applicable
 * check, and declared judge sets cannot be loaded at all.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  SCENARIO_FAMILIES,
  loadScenarioConfig,
  scenarioConfigSchema,
  type ScenarioConfig,
} from '../src/engine/scenario.js';

const MOCK_PATH = join(import.meta.dirname, '..', 'data', 'realestate-mock', 'scenario.json');
const mock = loadScenarioConfig(MOCK_PATH);

const variant = (): ScenarioConfig => structuredClone(mock);

describe('scenario schema', () => {
  it('accepts the upgraded mock fixture', () => {
    expect(scenarioConfigSchema.safeParse(mock).success).toBe(true);
    expect(mock.family).toBe('cold_inquiry');
    expect(mock.pool).toBe('public');
  });

  it('pins the seven families', () => {
    expect(SCENARIO_FAMILIES).toHaveLength(7);
  });

  it('rejects unknown keys', () => {
    expect(scenarioConfigSchema.safeParse({ ...mock, bogus: 1 }).success).toBe(false);
  });

  it('requires at least one applicable Layer-1 check, with valid ids', () => {
    const none = variant();
    none.applicableChecks = [];
    expect(scenarioConfigSchema.safeParse(none).success).toBe(false);

    const badId = variant();
    badId.applicableChecks = ['L1.14'];
    expect(scenarioConfigSchema.safeParse(badId).success).toBe(false);

    const goodId = variant();
    goodId.applicableChecks = ['L1.13'];
    expect(scenarioConfigSchema.safeParse(goodId).success).toBe(true);
  });

  it('requires a ground truth with at least one mustHold statement', () => {
    const s = variant();
    s.groundTruth.mustHold = [];
    expect(scenarioConfigSchema.safeParse(s).success).toBe(false);
  });

  it('a logged-qualification outcome must state the expected lead score', () => {
    const s = variant();
    s.groundTruth.expectedOutcome = 'qualification_logged';
    delete s.groundTruth.expectedLeadScore;
    expect(scenarioConfigSchema.safeParse(s).success).toBe(false);

    s.groundTruth.expectedLeadScore = 'cold';
    expect(scenarioConfigSchema.safeParse(s).success).toBe(true);
  });

  it('reengagement scenarios must define the second session', () => {
    const s = variant();
    s.family = 'reengagement_24h';
    expect(scenarioConfigSchema.safeParse(s).success).toBe(false);

    s.secondSession = { gapSeconds: 86_400, opener: 'agent', maxSteps: 20 };
    expect(scenarioConfigSchema.safeParse(s).success).toBe(true);
  });

  it('a buyer-opened second session needs the return message', () => {
    const s = variant();
    s.family = 'reengagement_24h';
    s.secondSession = { gapSeconds: 86_400, opener: 'buyer', maxSteps: 20 };
    expect(scenarioConfigSchema.safeParse(s).success).toBe(false);

    s.secondSession.buyerReturnMessage = 'hi, was thinking about that 2bhk again';
    expect(scenarioConfigSchema.safeParse(s).success).toBe(true);
  });

  it('compliance-trap scenarios must arm at least one trap', () => {
    const s = variant();
    s.family = 'compliance_trap';
    s.activeTrapIds = [];
    expect(scenarioConfigSchema.safeParse(s).success).toBe(false);
  });

  it('hinglish variants must be in hinglish', () => {
    const s = variant();
    s.family = 'hinglish_variant';
    s.language = 'english';
    expect(scenarioConfigSchema.safeParse(s).success).toBe(false);
  });

  it('loadScenarioConfig throws a labelled error on a malformed file', () => {
    expect(() => loadScenarioConfig(join(import.meta.dirname, 'scenario.test.ts'))).toThrow();
  });
});
