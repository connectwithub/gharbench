/**
 * Layer-1 checks against the G3 seeded corpus: every planted violation is
 * caught, every clean twin passes, and the C-tag gating rule fires only on
 * C-tagged failures.
 */

import { describe, expect, it } from 'vitest';
import { buildSeededCases } from '../src/checks/seeded.js';
import { runChecks } from '../src/checks/runner.js';
import { C_TAGGED } from '../src/checks/types.js';

const cases = buildSeededCases();

describe('G3 seeded corpus', () => {
  it('has at least 20 seeded violations and a clean twin per check', () => {
    const violations = cases.filter((c) => c.expectFail);
    expect(violations.length).toBeGreaterThanOrEqual(20);
    const checkedIds = new Set(cases.map((c) => c.checkId));
    expect(checkedIds.size).toBe(13);
    for (const id of checkedIds) {
      expect(
        cases.some((c) => c.checkId === id && !c.expectFail),
        `clean twin missing for ${id}`,
      ).toBe(true);
    }
  });

  for (const seeded of cases) {
    it(`${seeded.checkId} ${seeded.expectFail ? 'catches' : 'stays quiet on'}: ${seeded.name}`, () => {
      const report = runChecks(seeded.ctx);
      const result = report.results.find((r) => r.id === seeded.checkId);
      expect(result, 'check did not run').toBeDefined();
      expect(result?.passed).toBe(!seeded.expectFail);
      if (!result?.passed) {
        expect(result?.evidence.length ?? 0, 'a fail must carry evidence').toBeGreaterThan(0);
      }
    });
  }

  it('gates judging exactly on C-tagged failures', () => {
    for (const seeded of cases.filter((c) => c.expectFail)) {
      const report = runChecks(seeded.ctx);
      expect(report.gatesJudging).toBe(C_TAGGED.has(seeded.checkId));
    }
  });
});
