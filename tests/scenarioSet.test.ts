/**
 * The authored scenario set: every file validates, cross-references hold
 * (personas exist, armed traps exist on the card, dbVersion matches the
 * corpus), and the public split never contains a private-tagged scenario.
 */

import { describe, expect, it } from 'vitest';
import {
  PUBLIC_SCENARIOS_DIR,
  baseScenarioId,
  crossValidate,
  loadScenarioDir,
  loadScenarioSet,
} from '../src/run/scenarioSet.js';

const set = loadScenarioSet();

describe('scenario set', () => {
  it('loads the public split and validates every file', () => {
    const publicScenarios = loadScenarioDir(PUBLIC_SCENARIOS_DIR);
    expect(publicScenarios.length).toBeGreaterThanOrEqual(14);
    for (const s of publicScenarios) {
      expect(s.pool, s.scenarioId).toBe('public');
    }
  });

  it('cross-validates with zero problems', () => {
    expect(crossValidate(set)).toEqual([]);
  });

  it('private-tagged scenarios never sit in the public directory', () => {
    // The inverse (public-tagged in the private dir) is a mislabel too, but
    // only this direction leaks the held-out pool (G16).
    for (const s of loadScenarioDir(PUBLIC_SCENARIOS_DIR)) {
      expect(s.pool).not.toBe('private');
    }
  });

  it('covers all seven families across the loaded set', () => {
    const families = new Set(set.scenarios.map((s) => s.family));
    expect(families.size).toBe(7);
  });

  it('every scenario id encodes its persona binding', () => {
    for (const s of set.scenarios) {
      expect(s.scenarioId.endsWith(`.${s.personaId}`), s.scenarioId).toBe(true);
      expect(baseScenarioId(s.scenarioId)).not.toContain(`.${s.personaId}`);
    }
  });

  it('re-engagement scenarios carry their second session; nothing else does', () => {
    for (const s of set.scenarios) {
      if (s.family === 'reengagement_24h') {
        expect(s.secondSession, s.scenarioId).toBeDefined();
      } else {
        expect(s.secondSession, s.scenarioId).toBeUndefined();
      }
    }
  });

  it('compliance-trap and probe scenarios only arm traps their persona carries', () => {
    // crossValidate covers this; here we additionally require every armed
    // trap-carrying scenario to declare a compliance judge set or L1.8/L1.13.
    for (const s of set.scenarios) {
      if (s.family !== 'compliance_trap') continue;
      const hasComplianceCoverage =
        s.judgeApplicability.compliance.length > 0 ||
        s.applicableChecks.some((c) => ['L1.3', 'L1.8', 'L1.11', 'L1.13'].includes(c));
      expect(hasComplianceCoverage, s.scenarioId).toBe(true);
    }
  });
});
