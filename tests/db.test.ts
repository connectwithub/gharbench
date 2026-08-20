import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  SimClock,
  canonicalJson,
  goldDbSchema,
  hashDb,
  loadGoldDb,
  phaseOfTower,
  resetDb,
  sequentialId,
  sha256,
  type RealEstateDb,
} from '../src/env/db.js';
import { executeTool, TOOL_NAMES, TOOL_SPECS, isFlowEndingTool } from '../src/env/tools.js';

const GOLD_PATH = join(import.meta.dirname, '..', 'data', 'realestate-mock', 'project.json');
const gold = loadGoldDb(GOLD_PATH);

function freshCtx(): { db: RealEstateDb; clock: SimClock } {
  return {
    db: resetDb(gold),
    clock: new SimClock({ startIso: '2026-02-10T04:00:00.000Z', stepSeconds: 45 }),
  };
}

describe('canonicalJson', () => {
  it('sorts keys at every level and emits no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('is invariant to key insertion order', () => {
    const a = { z: 1, m: { q: [1, 2], b: true }, a: null };
    const b = { a: null, m: { b: true, q: [1, 2] }, z: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('preserves array order (arrays are sequences, not sets)', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });

  it('sorts integer-like keys lexicographically, not by JS object order', () => {
    // JSON.stringify would emit "2" before "10" because JS reorders integer
    // keys. The canonical form must not depend on that.
    expect(canonicalJson({ '10': 'a', '2': 'b', z: 'c' })).toBe('{"10":"a","2":"b","z":"c"}');
  });

  it('skips undefined properties and neutralises non-finite numbers', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson({ a: Number.NaN, b: Number.POSITIVE_INFINITY })).toBe(
      '{"a":null,"b":null}',
    );
  });
});

describe('sha256 / hashDb', () => {
  it('is stable across calls', () => {
    expect(hashDb(gold)).toBe(hashDb(gold));
    expect(hashDb(resetDb(gold))).toBe(hashDb(gold));
  });

  it('changes when any field changes', () => {
    const before = hashDb(gold);
    const mutated = resetDb(gold);
    mutated.units[0]!.priceInr += 1;
    expect(hashDb(mutated)).not.toBe(before);
  });

  it('is a 64-char hex digest', () => {
    expect(sha256('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('resetDb', () => {
  it('deep clones so a trial cannot corrupt the gold DB', () => {
    const goldHashBefore = hashDb(gold);
    const trial = resetDb(gold);
    trial.units[0]!.status = 'sold';
    trial.bookings.push({
      id: 'bkg_00001',
      unitId: 'x',
      slotId: 'y',
      visitorName: 'n',
      visitorPhone: '+919812345670',
      mode: 'in_person',
      createdAtSim: '2026-02-10T04:00:00.000Z',
    });
    expect(hashDb(gold)).toBe(goldHashBefore);
    expect(gold.bookings).toHaveLength(0);
  });
});

describe('SimClock', () => {
  it('has no wall clock: two clocks with the same config agree forever', () => {
    const a = new SimClock({ startIso: '2026-02-10T04:00:00.000Z', stepSeconds: 45 });
    const b = new SimClock({ startIso: '2026-02-10T04:00:00.000Z', stepSeconds: 45 });
    expect(a.now()).toBe(b.now());
    a.tick();
    b.tick();
    expect(a.now()).toBe(b.now());
    expect(a.now()).toBe('2026-02-10T04:00:45.000Z');
  });

  it('is stable between ticks', () => {
    const clock = new SimClock({ startIso: '2026-02-10T04:00:00.000Z', stepSeconds: 60 });
    expect(clock.now()).toBe(clock.now());
    expect(clock.tick()).toBe('2026-02-10T04:01:00.000Z');
    expect(clock.advance(2)).toBe('2026-02-10T04:03:00.000Z');
    clock.reset();
    expect(clock.now()).toBe('2026-02-10T04:00:00.000Z');
  });

  it('rejects an unparseable start time or a negative step', () => {
    expect(() => new SimClock({ startIso: 'not-a-date', stepSeconds: 1 })).toThrow();
    expect(() => new SimClock({ startIso: '2026-02-10T04:00:00Z', stepSeconds: -1 })).toThrow();
  });
});

describe('sequentialId', () => {
  it('zero-pads and never collides for a growing list', () => {
    expect(sequentialId('bkg', 0)).toBe('bkg_00001');
    expect(sequentialId('bkg', 41)).toBe('bkg_00042');
    expect(sequentialId('esc', 0)).not.toBe(sequentialId('esc', 1));
  });
});

describe('gold DB integrity', () => {
  it('matches the version the scenario targets and has unique ids', () => {
    expect(gold.dbVersion).toBe('1.0.0');
    const ids = gold.units.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(gold.units).toHaveLength(gold.project.totalUnits);
  });

  it('starts with no write-side records', () => {
    expect(gold.bookings).toHaveLength(0);
    expect(gold.escalations).toHaveLength(0);
    expect(gold.qualifications).toHaveLength(0);
  });

  it('is obviously fictional', () => {
    expect(gold.disclaimer).toMatch(/FICTIONAL/i);
    for (const asset of gold.assets) expect(asset.url).toContain('.invalid');
  });
});

describe('tool registry', () => {
  it('exposes exactly the six tools', () => {
    expect([...TOOL_NAMES].sort()).toEqual([
      'check_availability',
      'escalate_to_human',
      'fetch_project_info',
      'log_qualification',
      'schedule_site_visit',
      'send_asset',
    ]);
  });

  it('tags read/write and flow-ending correctly', () => {
    const kinds = Object.fromEntries(TOOL_SPECS.map((s) => [s.name, s.kind]));
    expect(kinds['fetch_project_info']).toBe('READ');
    expect(kinds['send_asset']).toBe('READ');
    expect(kinds['check_availability']).toBe('READ');
    expect(kinds['schedule_site_visit']).toBe('WRITE');
    expect(kinds['escalate_to_human']).toBe('WRITE');
    expect(kinds['log_qualification']).toBe('WRITE');

    expect(isFlowEndingTool('escalate_to_human')).toBe(true);
    expect(isFlowEndingTool('log_qualification')).toBe(true);
    expect(isFlowEndingTool('schedule_site_visit')).toBe(false);
  });

  it('reports unknown tools as data, not exceptions', () => {
    const ctx = freshCtx();
    const outcome = executeTool('send_whatsapp_blast', {}, ctx);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('unknown_tool');
  });
});

describe('READ tools', () => {
  it('never mutate the DB', () => {
    const ctx = freshCtx();
    const before = hashDb(ctx.db);
    executeTool('fetch_project_info', { sections: ['overview', 'units'] }, ctx);
    executeTool('send_asset', { assetId: 'asset_brochure_v3' }, ctx);
    executeTool('check_availability', { target: 'units' }, ctx);
    expect(hashDb(ctx.db)).toBe(before);
  });

  it('fetch_project_info defaults to the overview only', () => {
    const ctx = freshCtx();
    const outcome = executeTool('fetch_project_info', {}, ctx);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(Object.keys(outcome.result as object)).toEqual(['overview']);
    }
  });

  it('returns lists in a stable order', () => {
    const ctx = freshCtx();
    const first = executeTool('check_availability', { target: 'units' }, ctx);
    const second = executeTool('check_availability', { target: 'units' }, freshCtx());
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    if (first.ok) {
      const units = (first.result as { units: Array<{ id: string }> }).units;
      expect(units.map((u) => u.id)).toEqual([...units.map((u) => u.id)].sort());
    }
  });

  it('excludes sold and blocked units from availability', () => {
    const ctx = freshCtx();
    const outcome = executeTool('check_availability', { target: 'units' }, ctx);
    if (!outcome.ok) throw new Error('expected success');
    const units = (outcome.result as { units: Array<{ id: string; status: string }> }).units;
    expect(units.every((u) => u.status === 'available')).toBe(true);
    expect(units.map((u) => u.id)).not.toContain('unit_B_0205'); // sold
    expect(units.map((u) => u.id)).not.toContain('unit_B_1401'); // blocked
  });
});

describe('schema violations', () => {
  it('rejects unknown keys (strict schemas catch invented parameters)', () => {
    const ctx = freshCtx();
    const outcome = executeTool('check_availability', { target: 'units', discount: 10 }, ctx);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('schema_violation');
  });

  it('rejects a phone number that is not +91XXXXXXXXXX', () => {
    const ctx = freshCtx();
    const outcome = executeTool(
      'schedule_site_visit',
      {
        unitId: 'unit_A_0402',
        slotId: 'slot_2026_02_15_1030',
        visitorName: 'Rohan Deshmukh',
        visitorPhone: '9812345670',
        mode: 'in_person',
      },
      ctx,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('schema_violation');
      expect(JSON.stringify(outcome.error.details)).toContain('visitorPhone');
    }
  });

  it('rejects a missing required argument', () => {
    const ctx = freshCtx();
    const outcome = executeTool('check_availability', {}, ctx);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('schema_violation');
  });

  it('does not mutate the DB on a rejected write', () => {
    const ctx = freshCtx();
    const before = hashDb(ctx.db);
    executeTool(
      'schedule_site_visit',
      {
        unitId: 'unit_A_0402',
        slotId: 'slot_2026_02_15_1030',
        visitorName: 'R',
        visitorPhone: 'nope',
        mode: 'in_person',
      },
      ctx,
    );
    expect(hashDb(ctx.db)).toBe(before);
  });
});

describe('hallucinated arguments', () => {
  it('flags an asset id that does not exist', () => {
    const ctx = freshCtx();
    const outcome = executeTool('send_asset', { assetId: 'asset_vastu_report' }, ctx);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('hallucinated_argument');
  });

  it('flags a tower the project does not have', () => {
    const ctx = freshCtx();
    const outcome = executeTool('check_availability', { target: 'units', tower: 'C' }, ctx);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('hallucinated_argument');
      expect(outcome.error.details).toMatchObject({ field: 'tower', value: 'C' });
    }
  });

  it('flags a unit id and a slot id that do not exist', () => {
    const ctx = freshCtx();
    const base = {
      slotId: 'slot_2026_02_15_1030',
      visitorName: 'Rohan',
      visitorPhone: '+919812345670',
      mode: 'in_person' as const,
    };
    const badUnit = executeTool('schedule_site_visit', { ...base, unitId: 'unit_C_9901' }, ctx);
    expect(badUnit.ok).toBe(false);
    if (!badUnit.ok) expect(badUnit.error.code).toBe('hallucinated_argument');

    const badSlot = executeTool(
      'schedule_site_visit',
      { ...base, unitId: 'unit_A_0402', slotId: 'slot_2026_12_25_0900' },
      ctx,
    );
    expect(badSlot.ok).toBe(false);
    if (!badSlot.ok) expect(badSlot.error.code).toBe('hallucinated_argument');
  });

  it('flags a unit type the project does not sell', () => {
    const ctx = freshCtx();
    const outcome = executeTool(
      'log_qualification',
      {
        budgetInr: 7000000,
        timelineMonths: 4,
        unitTypeInterest: '1BHK',
        financing: 'home_loan',
        leadScore: 'warm',
      },
      ctx,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('hallucinated_argument');
  });

  it('flags a quoted price that matches no unit', () => {
    const ctx = freshCtx();
    const outcome = executeTool(
      'log_qualification',
      {
        budgetInr: 7000000,
        timelineMonths: 4,
        unitTypeInterest: '2BHK',
        financing: 'home_loan',
        leadScore: 'warm',
        quotedPriceInr: 6165000, // a "10% discount" nobody offers
      },
      ctx,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('hallucinated_argument');
      expect(outcome.error.details).toMatchObject({ field: 'quotedPriceInr' });
    }
  });
});

describe('unavailable (valid request, world says no)', () => {
  it('refuses a fully booked slot', () => {
    const ctx = freshCtx();
    const outcome = executeTool(
      'schedule_site_visit',
      {
        unitId: 'unit_A_0402',
        slotId: 'slot_2026_02_14_1600', // capacity 4, booked 4
        visitorName: 'Rohan',
        visitorPhone: '+919812345670',
        mode: 'in_person',
      },
      ctx,
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe('unavailable');
  });

  it('refuses a sold unit and a mode mismatch', () => {
    const ctx = freshCtx();
    const sold = executeTool(
      'schedule_site_visit',
      {
        unitId: 'unit_B_0205',
        slotId: 'slot_2026_02_15_1030',
        visitorName: 'Rohan',
        visitorPhone: '+919812345670',
        mode: 'in_person',
      },
      ctx,
    );
    expect(sold.ok).toBe(false);
    if (!sold.ok) expect(sold.error.code).toBe('unavailable');

    const wrongMode = executeTool(
      'schedule_site_visit',
      {
        unitId: 'unit_A_0402',
        slotId: 'slot_2026_02_15_1030', // in_person slot
        visitorName: 'Rohan',
        visitorPhone: '+919812345670',
        mode: 'virtual',
      },
      ctx,
    );
    expect(wrongMode.ok).toBe(false);
    if (!wrongMode.ok) expect(wrongMode.error.code).toBe('unavailable');
  });
});

describe('WRITE tools', () => {
  it('schedule_site_visit books a seat and records the booking', () => {
    const ctx = freshCtx();
    const slotBefore = ctx.db.siteVisitSlots.find((s) => s.id === 'slot_2026_02_15_1030')!;
    const bookedBefore = slotBefore.booked;

    const outcome = executeTool(
      'schedule_site_visit',
      {
        unitId: 'unit_A_0402',
        slotId: 'slot_2026_02_15_1030',
        visitorName: 'Rohan Deshmukh',
        visitorPhone: '+919812345670',
        mode: 'in_person',
      },
      ctx,
    );

    expect(outcome.ok).toBe(true);
    expect(ctx.db.bookings).toHaveLength(1);
    expect(ctx.db.bookings[0]!.id).toBe('bkg_00001');
    expect(ctx.db.bookings[0]!.createdAtSim).toBe('2026-02-10T04:00:00.000Z');
    expect(slotBefore.booked).toBe(bookedBefore + 1);
  });

  it('log_qualification and escalate_to_human append records', () => {
    const ctx = freshCtx();
    expect(
      executeTool(
        'log_qualification',
        {
          budgetInr: 7800000,
          timelineMonths: 4,
          unitTypeInterest: '2BHK',
          financing: 'home_loan',
          leadScore: 'hot',
          quotedPriceInr: 6850000,
        },
        ctx,
      ).ok,
    ).toBe(true);
    expect(ctx.db.qualifications[0]!.id).toBe('qual_00001');

    expect(
      executeTool(
        'escalate_to_human',
        {
          reason: 'pricing_negotiation',
          summary: 'Buyer wants a discount beyond the published payment plans.',
          priority: 'normal',
        },
        ctx,
      ).ok,
    ).toBe(true);
    expect(ctx.db.escalations[0]!.id).toBe('esc_00001');
  });

  it('produces the same DB hash for the same sequence of writes', () => {
    const run = (): string => {
      const ctx = freshCtx();
      executeTool(
        'schedule_site_visit',
        {
          unitId: 'unit_A_0402',
          slotId: 'slot_2026_02_15_1030',
          visitorName: 'Rohan Deshmukh',
          visitorPhone: '+919812345670',
          mode: 'in_person',
        },
        ctx,
      );
      return hashDb(ctx.db);
    };
    expect(run()).toBe(run());
  });
});

// ---------------------------------------------------------------------------
// Corpus v2 surface: phases, charges, agent policy, gold-DB validation
// ---------------------------------------------------------------------------

/** The v1 gold reshaped into a two-phase project, for exercising the v2 paths. */
function twoPhaseDb(): RealEstateDb {
  const db = resetDb(gold);
  const { reraId, status, possessionQuarter, ...rest } = db.project;
  void reraId;
  void status;
  void possessionQuarter;
  db.project = {
    ...rest,
    phases: [
      {
        id: 'phase_1',
        name: 'Phase 1',
        towers: ['A'],
        reraId: 'P51700000001-FICTIONAL',
        status: 'ready',
        possessionQuarter: 'ready',
        ocReceived: true,
        ccReceived: true,
        basicRatePerSqftCarpetInr: 9500,
      },
      {
        id: 'phase_2',
        name: 'Phase 2',
        towers: ['B'],
        reraId: 'P51700000002-FICTIONAL',
        status: 'under_construction',
        possessionQuarter: 'Q4-2028',
        ocReceived: false,
        ccReceived: true,
        basicRatePerSqftCarpetInr: 8800,
      },
    ],
    charges: {
      floorRisePerSqftPerFloorInr: 25,
      floorRiseStartFloor: 5,
      plcPerSqftByFacing: { park: 150 },
      coveredParkingInr: 350_000,
      clubMembershipInr: 150_000,
      corpusFundPerSqftInr: 60,
      legalAndDocumentationInr: 25_000,
      gstPercent: { underConstruction: 5, readyWithOc: 0 },
      stampDutyPercent: 6,
      registrationFeePercent: 1,
      registrationFeeCapInr: 30_000,
    },
  };
  db.agentPolicy = {
    version: '1.0.0',
    maxDiscretionaryDiscountPercent: 0,
    discountApprovalRule: 'Every discount request escalates to the sales manager.',
    tokenAmountInr: 100_000,
    prohibitedPromises: ['guaranteed_returns'],
    escalationTriggers: ['discount_request'],
    quotingRules: ['quote_carpet_area_per_rera'],
  };
  return db;
}

describe('gold DB validation (goldDbSchema)', () => {
  it('accepts the frozen v1 mock', () => {
    expect(goldDbSchema.safeParse(gold).success).toBe(true);
  });

  it('accepts a two-phase v2-shaped DB', () => {
    const result = goldDbSchema.safeParse(twoPhaseDb());
    expect(result.success).toBe(true);
  });

  it('rejects an unknown key at the root', () => {
    expect(goldDbSchema.safeParse({ ...gold, bogus: 1 }).success).toBe(false);
  });

  it('rejects a project carrying both phases and the v1 single-phase fields', () => {
    const db = twoPhaseDb();
    db.project.reraId = 'P00000000000000-FICTIONAL';
    expect(goldDbSchema.safeParse(db).success).toBe(false);
  });

  it('rejects a single-phase project missing its registration triple', () => {
    const db = resetDb(gold);
    delete db.project.reraId;
    expect(goldDbSchema.safeParse(db).success).toBe(false);
  });

  it('rejects phases whose towers do not partition the project towers', () => {
    const db = twoPhaseDb();
    db.project.phases![0]!.towers = ['A', 'Z'];
    expect(goldDbSchema.safeParse(db).success).toBe(false);
  });

  it('loadGoldDb throws on a malformed file instead of casting quietly', () => {
    expect(() => loadGoldDb(join(import.meta.dirname, 'db.test.ts'))).toThrow();
  });
});

describe('phaseOfTower', () => {
  it('maps a tower to its phase and returns undefined off the map', () => {
    const db = twoPhaseDb();
    expect(phaseOfTower(db, 'A')?.id).toBe('phase_1');
    expect(phaseOfTower(db, 'B')?.id).toBe('phase_2');
    expect(phaseOfTower(db, 'Z')).toBeUndefined();
    expect(phaseOfTower(gold, 'A')).toBeUndefined();
  });
});

describe('fetch_project_info v2 sections', () => {
  function fetchSections(db: RealEstateDb, sections: string[]): Record<string, unknown> {
    const outcome = executeTool(
      'fetch_project_info',
      { sections },
      { db, clock: new SimClock({ startIso: '2026-02-10T04:00:00.000Z', stepSeconds: 45 }) },
    );
    expect(outcome.ok).toBe(true);
    return (outcome as { ok: true; result: Record<string, unknown> }).result;
  }

  it('returns null for phases/charges/policy on the v1 single-phase DB', () => {
    const out = fetchSections(resetDb(gold), ['phases', 'charges', 'policy']);
    expect(out['phases']).toBeNull();
    expect(out['charges']).toBeNull();
    expect(out['policy']).toBeNull();
  });

  it('reports per-phase RERA and possession on a phased DB', () => {
    const out = fetchSections(twoPhaseDb(), ['overview', 'rera', 'possession', 'phases']);
    expect((out['overview'] as { status: string }).status).toBe('multi_phase');

    const rera = out['rera'] as Array<{ phaseId: string; reraId: string }>;
    expect(rera.map((r) => r.phaseId)).toEqual(['phase_1', 'phase_2']);
    expect(new Set(rera.map((r) => r.reraId)).size).toBe(2);

    const possession = out['possession'] as Array<{ phaseId: string; ocReceived: boolean }>;
    expect(possession.find((p) => p.phaseId === 'phase_1')?.ocReceived).toBe(true);
    expect(possession.find((p) => p.phaseId === 'phase_2')?.ocReceived).toBe(false);
  });

  it('keeps the v1 single-phase rera/possession shape intact', () => {
    const out = fetchSections(resetDb(gold), ['rera', 'possession']);
    expect(out['rera']).toEqual({ reraId: gold.project.reraId, state: gold.project.state });
    expect(out['possession']).toEqual({
      possessionQuarter: gold.project.possessionQuarter,
      status: gold.project.status,
    });
  });

  it('serves the agent policy verbatim from the DB', () => {
    const db = twoPhaseDb();
    const out = fetchSections(db, ['policy', 'charges']);
    expect(out['policy']).toEqual(db.agentPolicy);
    expect(out['charges']).toEqual(db.project.charges);
  });

  it('exposes super built-up area on units only when the DB has it', () => {
    const db = twoPhaseDb();
    const target = db.units[0]!;
    target.superBuiltUpAreaSqft = Math.round(target.carpetAreaSqft * 1.3);

    const units = fetchSections(db, ['units'])['units'] as Array<Record<string, unknown>>;
    const modified = units.find((u) => u['id'] === target.id)!;
    const untouched = units.find((u) => u['id'] !== target.id)!;
    expect(modified['superBuiltUpAreaSqft']).toBe(target.superBuiltUpAreaSqft);
    expect('superBuiltUpAreaSqft' in untouched).toBe(false);
  });
});
