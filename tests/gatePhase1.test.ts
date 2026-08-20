/**
 * The Phase 1 gate evaluator. Assertions here are chosen not to rot as
 * authoring proceeds: integrity must always hold, arithmetic must always
 * reconcile, and the floor list must always cover the I9 targets - but the
 * MET/UNMET status of authoring floors is the gate's own honest output, not
 * something a test should pin.
 */

import { describe, expect, it } from 'vitest';
import { SCENARIO_FAMILIES } from '../src/engine/scenario.js';
import { evaluatePhase1Gate } from '../src/run/gatePhase1.js';
import { loadScenarioSet } from '../src/run/scenarioSet.js';

const report = evaluatePhase1Gate(loadScenarioSet());

describe('phase 1 gate evaluator', () => {
  it('finds zero integrity problems and zero per-scenario issues in the authored set', () => {
    expect(report.problems).toEqual([]);
    expect(report.scenarioIssues).toEqual([]);
  });

  it('counts reconcile', () => {
    const c = report.counts;
    expect(c.publicInstances + c.privateInstances).toBe(c.instances);
    const familySum = Object.values(c.byFamily).reduce((a, n) => a + n, 0);
    expect(familySum).toBe(c.instances);
    expect(c.baseSituations).toBeLessThanOrEqual(c.instances);
    // CI clones have no private pool by design (gitignored, G16); the share
    // is only meaningfully positive where the pool is actually present.
    if (report.privatePoolLoaded) {
      expect(c.privateShare).toBeGreaterThan(0);
    } else {
      expect(c.privateShare).toBe(0);
    }
    expect(c.nonBuyerOutcomeShare).toBeGreaterThan(0);
  });

  it('checks a floor for every family plus the set-level targets', () => {
    const names = report.floors.map((f) => f.name);
    expect(names).toContain('base situations');
    expect(names).toContain('instances');
    expect(names).toContain('hinglish stratum');
    expect(names).toContain('private share');
    for (const family of SCENARIO_FAMILIES) {
      expect(names).toContain(`family ${family}`);
      expect(names).toContain(`family ${family} difficulty spread`);
    }
  });

  it('is not MET while authoring floors are open, and never MET with problems', () => {
    // With 19 of 150-250 instances the gate must be honest about it.
    const anyUnmet = report.floors.some((f) => !f.met);
    expect(report.met).toBe(!anyUnmet && report.problems.length === 0);
  });
});
