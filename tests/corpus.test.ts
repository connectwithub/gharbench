/**
 * Gold DB v2 (data/corpus/project.json) consistency suite.
 *
 * The corpus is Layer-1 ground truth (Master Plan 3.2): a factuality check is
 * only as trustworthy as the document set it resolves against. So nothing in
 * the price sheet is allowed to be a typed-in number that *looks* right --
 * every unit price must re-derive exactly from the published charge card, and
 * every cross-reference (towers to phases, count fields, id uniqueness) must
 * hold by construction.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadGoldDb, phaseOfTower } from '../src/env/db.js';

const CORPUS_PATH = join(import.meta.dirname, '..', 'data', 'corpus', 'project.json');
const db = loadGoldDb(CORPUS_PATH); // loadGoldDb already schema-validates

describe('corpus v2 identity', () => {
  it('is version 2.0.0 and obviously fictional', () => {
    expect(db.dbVersion).toBe('2.0.0');
    expect(db.disclaimer).toMatch(/FICTIONAL/);
    for (const asset of db.assets) expect(asset.url).toContain('.invalid');
    for (const phase of db.project.phases ?? []) expect(phase.reraId).toMatch(/-FICTIONAL$/);
  });

  it('starts with no write-side records', () => {
    expect(db.bookings).toHaveLength(0);
    expect(db.escalations).toHaveLength(0);
    expect(db.qualifications).toHaveLength(0);
  });

  it('has unique ids everywhere', () => {
    for (const list of [db.units, db.assets, db.siteVisitSlots, db.paymentPlans]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('phases', () => {
  it('has two distinctly registered phases, one ready and one under construction', () => {
    const phases = db.project.phases ?? [];
    expect(phases).toHaveLength(2);
    expect(new Set(phases.map((p) => p.reraId)).size).toBe(2);
    expect(phases.map((p) => p.status).sort()).toEqual(['ready', 'under_construction']);
    const ready = phases.find((p) => p.status === 'ready');
    const uc = phases.find((p) => p.status === 'under_construction');
    expect(ready?.ocReceived).toBe(true);
    expect(uc?.ocReceived).toBe(false);
    expect(uc?.ccReceived).toBe(true);
  });

  it('maps every unit tower to exactly one phase', () => {
    for (const unit of db.units) {
      expect(phaseOfTower(db, unit.tower), `tower ${unit.tower}`).toBeDefined();
    }
  });
});

describe('the price sheet is derived, not typed', () => {
  it('re-derives every unit price exactly from the charge card', () => {
    const charges = db.project.charges;
    expect(charges).toBeDefined();
    if (!charges) return;

    for (const unit of db.units) {
      const phase = phaseOfTower(db, unit.tower);
      expect(phase, unit.id).toBeDefined();
      if (!phase) continue;

      const rise =
        Math.max(0, unit.floor - charges.floorRiseStartFloor) * charges.floorRisePerSqftPerFloorInr;
      const plc = charges.plcPerSqftByFacing[unit.facing];
      expect(plc, `facing "${unit.facing}" of ${unit.id} has no published PLC`).toBeDefined();

      const expected =
        Math.round(
          ((phase.basicRatePerSqftCarpetInr + rise + (plc ?? 0)) * unit.carpetAreaSqft) / 1000,
        ) * 1000;
      expect(unit.priceInr, unit.id).toBe(expected);
    }
  });

  it('publishes a price range equal to the actual min/max', () => {
    const prices = db.units.map((u) => u.priceInr);
    expect(db.project.priceRangeInr.min).toBe(Math.min(...prices));
    expect(db.project.priceRangeInr.max).toBe(Math.max(...prices));
  });

  it('counts its own units correctly', () => {
    expect(db.project.totalUnits).toBe(db.units.length);
  });
});

describe('areas and loading', () => {
  it('gives every unit both areas, with disclosed loading in a plausible band', () => {
    for (const unit of db.units) {
      expect(unit.superBuiltUpAreaSqft, unit.id).toBeDefined();
      const loading = (unit.superBuiltUpAreaSqft ?? 0) / unit.carpetAreaSqft;
      expect(loading, unit.id).toBeGreaterThanOrEqual(1.25);
      // >40% loading is the CP4 red-flag threshold; the corpus stays well under it.
      expect(loading, unit.id).toBeLessThanOrEqual(1.35);
    }
  });
});

describe('world texture for scenarios', () => {
  it('has sold and blocked inventory so `unavailable` outcomes are reachable', () => {
    const statuses = new Set(db.units.map((u) => u.status));
    expect(statuses.has('sold')).toBe(true);
    expect(statuses.has('blocked')).toBe(true);
    expect(db.units.filter((u) => u.status === 'available').length).toBeGreaterThanOrEqual(20);
  });

  it('has at least one fully booked site-visit slot and plenty of open ones', () => {
    const full = db.siteVisitSlots.filter((s) => s.booked >= s.capacity);
    const open = db.siteVisitSlots.filter((s) => s.booked < s.capacity);
    expect(full.length).toBeGreaterThanOrEqual(1);
    expect(open.length).toBeGreaterThanOrEqual(10);
    for (const slot of db.siteVisitSlots) expect(slot.booked).toBeLessThanOrEqual(slot.capacity);
  });

  it('covers both visit modes and both phases with inventory', () => {
    expect(new Set(db.siteVisitSlots.map((s) => s.mode))).toEqual(
      new Set(['in_person', 'virtual']),
    );
    for (const phase of db.project.phases ?? []) {
      const phaseUnits = db.units.filter((u) => phase.towers.includes(u.tower));
      expect(phaseUnits.length, phase.id).toBeGreaterThanOrEqual(8);
      expect(
        phaseUnits.some((u) => u.status === 'available'),
        phase.id,
      ).toBe(true);
    }
  });

  it('payment plan milestones each sum to 100 percent', () => {
    for (const plan of db.paymentPlans) {
      const total = plan.milestones.reduce((acc, m) => acc + m.percent, 0);
      expect(total, plan.id).toBe(100);
    }
  });
});

describe('agent policy', () => {
  it('exists and pins zero discretionary discount', () => {
    expect(db.agentPolicy).toBeDefined();
    expect(db.agentPolicy?.maxDiscretionaryDiscountPercent).toBe(0);
    expect(db.agentPolicy?.prohibitedPromises.length).toBeGreaterThanOrEqual(5);
  });
});
