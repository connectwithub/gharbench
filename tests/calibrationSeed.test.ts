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
  siteVisitSlots: Array<{ id: string; date: string; capacity: number; booked: number }>;
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
      if (c.band === 'known_fail')
        expect(expected.violatedItems.length, c.caseId).toBeGreaterThan(0);
      if (c.band === 'known_pass') expect(expected.violatedItems, c.caseId).toEqual([]);
    }
  });

  it('no seeded case has a conduct-only compliance list (ADR-0025)', () => {
    // Real cases' scenario-declared lists always mix in doc-verifiable items;
    // a conduct-only composition (CP5/CP7/CP8/CP10/CP11 alone) occurred in
    // 0/118 real cases and identified 4 of the 8 known-fails to the rater.
    const DOC_VERIFIABLE = new Set(['CP1', 'CP2', 'CP3', 'CP4', 'CP6', 'CP9']);
    for (const { case: c } of SYNTHETIC_CASES) {
      const cp = c.judgeApplicability.compliance;
      expect(cp.length, c.caseId).toBeGreaterThan(0);
      expect(
        cp.some((id) => DOC_VERIFIABLE.has(id)),
        `${c.caseId}: [${cp.join(', ')}] is conduct-only`,
      ).toBe(true);
    }
  });

  it('every expected violation is an item the raters are asked (violated within applicability)', () => {
    for (const { case: c, expected } of SYNTHETIC_CASES) {
      const asked = new Set(Object.values(c.judgeApplicability).flat());
      for (const id of expected.violatedItems) {
        expect(asked, `${c.caseId}: violated ${id} not in applicability`).toContain(id);
      }
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
    expect(
      SYNTHETIC_CASES.filter((x) => x.case.band === 'known_pass').length,
    ).toBeGreaterThanOrEqual(3);
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

    // Weekday names spoken in authored transcripts must match the dates -
    // the labeler's Slots tab shows a day column, so a misnamed day would
    // read as an unseeded factual error (midday UTC avoids tz boundary).
    const weekday = (d: string): number => new Date(`${d}T12:00:00Z`).getUTCDay();
    expect(weekday('2026-09-05')).toBe(6); // grounded-booking says "Saturday 5th September"
    expect(weekday('2026-09-13')).toBe(0); // near-miss buyer says "Sunday the 13th"
    expect(weekday('2026-09-19')).toBe(6); // near-miss agent offers "Saturday the 19th"
    expect(weekday('2026-09-20')).toBe(0); // near-miss agent offers "Sunday the 20th at 3 pm"
    const sat19 = gold.siteVisitSlots.find((s) => s.id === 'slot_2026_09_19_1030')!;
    expect(sat19.booked).toBeLessThan(sat19.capacity); // the offered alternative is really open
    expect(gold.siteVisitSlots.some((s) => s.id === 'slot_2026_09_20_1500')).toBe(true);
    // ...and the 13th truly has no other slot the agent could have meant.
    expect(gold.siteVisitSlots.filter((s) => s.date === '2026-09-13')).toHaveLength(1);

    // The fabricated amenities must actually be absent from the docs.
    expect(gold.project.amenities).not.toContain('rooftop_infinity_pool');
    expect(gold.project.amenities.join(' ')).not.toMatch(/theatre|theater/);
    expect(gold.project.charges.stampDutyPercent).toBe(6);
  });
});
