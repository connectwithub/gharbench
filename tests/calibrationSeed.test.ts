/**
 * The synthetic anchors are the judge panel's sensitivity/specificity ruler,
 * so their own ground truth must be provably right: schema-valid, rubric-
 * consistent, and - for known-pass cases - corpus-true to the rupee. A pass
 * anchor with a wrong number would teach the calibration that a correct
 * judge is broken.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SYNTHETIC_CASES } from '../src/run/calibrationSeed.js';
import { calibrationCaseSchema, calibrationExpectedSchema } from '../src/run/calibrationCase.js';
import { binaryItemIds, loadJudgeItems } from '../src/run/judgeItems.js';
import { REPO_ROOT } from '../src/run/scenarioSet.js';

const rubric = binaryItemIds(loadJudgeItems());
const allIds = new Set([
  ...rubric.factuality,
  ...rubric.compliance,
  ...rubric.salesEffectiveness,
  ...rubric.conversationQuality,
]);

interface GoldDb {
  units: Array<{
    id: string;
    carpetAreaSqft: number;
    superBuiltUpAreaSqft?: number;
    priceInr: number;
  }>;
  siteVisitSlots: Array<{ id: string; capacity: number; booked: number }>;
  project: { amenities: string[]; charges: { stampDutyPercent: number } };
}
const gold = JSON.parse(
  readFileSync(join(REPO_ROOT, 'data', 'corpus', 'project.json'), 'utf8'),
) as GoldDb;

describe('synthetic calibration anchors', () => {
  it('every case and sidecar validates, ids are unique, applicability resolves', () => {
    const seen = new Set<string>();
    for (const { case: c, expected } of SYNTHETIC_CASES) {
      expect(calibrationCaseSchema.safeParse(c).success, c.caseId).toBe(true);
      expect(calibrationExpectedSchema.safeParse(expected).success, c.caseId).toBe(true);
      expect(expected.caseId).toBe(c.caseId);
      expect(seen.has(c.caseId)).toBe(false);
      seen.add(c.caseId);
      for (const dim of Object.values(c.judgeApplicability)) {
        for (const id of dim) expect(allIds, `${c.caseId}: ${id}`).toContain(id);
      }
      for (const id of expected.violatedItems) expect(allIds, c.caseId).toContain(id);
    }
  });

  it('known-fail cases seed violations; known-pass cases seed none', () => {
    for (const { case: c, expected } of SYNTHETIC_CASES) {
      if (c.band === 'known_fail') expect(expected.violatedItems.length, c.caseId).toBeGreaterThan(0);
      if (c.band === 'known_pass') expect(expected.violatedItems, c.caseId).toEqual([]);
    }
  });

  it('covers the §4.5 anchor list and both languages', () => {
    const ids = SYNTHETIC_CASES.map((x) => x.case.caseId).join(' ');
    for (const needle of [
      'sbu_as_carpet',
      'assured_returns',
      'reengage_30h',
      'community_steering',
      'implicit_steering',
      'fabricated_amenity',
      'near_miss_slot',
    ]) {
      expect(ids).toContain(needle);
    }
    expect(SYNTHETIC_CASES.some((x) => x.case.language === 'hinglish')).toBe(true);
    expect(SYNTHETIC_CASES.filter((x) => x.case.band === 'known_pass').length).toBeGreaterThanOrEqual(3);
  });

  it('known-pass numbers are corpus-true (unit_A_0201, slot capacities, amenities)', () => {
    const unit = gold.units.find((u) => u.id === 'unit_A_0201')!;
    expect(unit.carpetAreaSqft).toBe(705);
    expect(unit.priceInr).toBe(7_702_000);
    expect(unit.superBuiltUpAreaSqft).toBe(917); // the CP4 case misuses exactly this value

    const fullSlot = gold.siteVisitSlots.find((s) => s.id === 'slot_2026_09_13_1030')!;
    expect(fullSlot.booked).toBe(fullSlot.capacity); // near-miss case depends on it being full
    const openSlot = gold.siteVisitSlots.find((s) => s.id === 'slot_2026_09_05_1030')!;
    expect(openSlot.booked).toBeLessThan(openSlot.capacity);

    // The fabricated amenities must actually be absent from the docs.
    expect(gold.project.amenities).not.toContain('rooftop_infinity_pool');
    expect(gold.project.amenities.join(' ')).not.toMatch(/theatre|theater/);
    expect(gold.project.charges.stampDutyPercent).toBe(6);
  });
});
