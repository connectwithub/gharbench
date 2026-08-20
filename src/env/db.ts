/**
 * Versioned JSON environment database.
 *
 * Three invariants this module exists to protect:
 *  1. Every trial starts from a byte-identical clone of the gold DB.
 *  2. DB state is summarisable as a deterministic SHA-256 over canonical JSON,
 *     so a trial's start/end hashes are comparable across machines and runs.
 *  3. There is no wall clock anywhere. Time comes from an injected `SimClock`
 *     seeded from the scenario, so replaying a scenario a year from now
 *     produces the same timestamps.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

export type UnitType = '1BHK' | '2BHK' | '3BHK' | '4BHK';
export type UnitStatus = 'available' | 'blocked' | 'sold';
export type VisitMode = 'in_person' | 'virtual';
export type AssetKind =
  | 'brochure'
  | 'floor_plan'
  | 'price_sheet'
  | 'video'
  | 'spec_sheet'
  | 'amenity_list'
  | 'rera_certificate'
  | 'approvals_note'
  | 'cost_sheet_sample'
  | 'possession_update';

export interface Unit {
  id: string;
  tower: string;
  floor: number;
  unitType: UnitType;
  carpetAreaSqft: number;
  /**
   * Corpus v2+: super built-up area, so loading % is derivable ground truth
   * ((sbu - carpet) / carpet) rather than an untestable claim in prose.
   * Absent in the frozen v1 mock fixture.
   */
  superBuiltUpAreaSqft?: number;
  facing: string;
  priceInr: number;
  status: UnitStatus;
}

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  url: string;
  sizeKb: number;
}

export interface SiteVisitSlot {
  id: string;
  date: string;
  time: string;
  mode: VisitMode;
  capacity: number;
  booked: number;
}

export interface PaymentPlan {
  id: string;
  name: string;
  bookingPercent: number;
  discountPercent: number;
  milestones: Array<{ label: string; percent: number }>;
}

export type PhaseStatus = 'ready' | 'under_construction';

/**
 * One RERA-registered phase of the project. Indian phased projects register
 * each phase separately, so RERA id, status and possession are per-phase facts
 * -- an agent quoting phase-1's RERA id or OC status for a phase-2 unit is
 * making a checkable misrepresentation, which is exactly what several
 * compliance traps probe.
 */
export interface ProjectPhase {
  id: string;
  name: string;
  towers: string[];
  reraId: string;
  status: PhaseStatus;
  possessionQuarter: string;
  /** Occupancy certificate received (ready phases only, in practice). */
  ocReceived: boolean;
  /** Commencement certificate received. */
  ccReceived: boolean;
  /** Base rate the price sheet is keyed to, per sqft of RERA carpet area. */
  basicRatePerSqftCarpetInr: number;
}

/**
 * The published charge card. Unit prices in the gold DB must be derivable
 * from these numbers plus the unit's own carpet area / floor / facing, so a
 * consistency test can prove the price sheet has no invented figures.
 */
export interface ProjectCharges {
  /** Added per sqft carpet for every floor above `floorRiseStartFloor`. */
  floorRisePerSqftPerFloorInr: number;
  floorRiseStartFloor: number;
  /** Preferential-location charge per sqft carpet, keyed by unit facing. */
  plcPerSqftByFacing: Record<string, number>;
  coveredParkingInr: number;
  clubMembershipInr: number;
  corpusFundPerSqftInr: number;
  legalAndDocumentationInr: number;
  /** GST is a per-phase fact: charged on under-construction, nil on ready-with-OC. */
  gstPercent: { underConstruction: number; readyWithOc: number };
  stampDutyPercent: number;
  registrationFeePercent: number;
  registrationFeeCapInr: number;
}

/**
 * What the selling agent may and may not do. Part of the hashed gold DB
 * because it is the ground truth the off-book-discount and escalation checks
 * resolve against -- a policy that lived in a prompt could drift per run.
 */
export interface AgentPolicy {
  version: string;
  /** Discounts the agent may offer unaided. 0 means every discount ask escalates. */
  maxDiscretionaryDiscountPercent: number;
  discountApprovalRule: string;
  tokenAmountInr: number;
  prohibitedPromises: string[];
  escalationTriggers: string[];
  quotingRules: string[];
}

export interface ProjectInfo {
  id: string;
  name: string;
  developer: string;
  city: string;
  state: string;
  locality: string;
  /** v1 single-phase shape. Corpus v2+ moves these three onto `phases`. */
  reraId?: string;
  status?: string;
  possessionQuarter?: string;
  /** Corpus v2+: per-phase registration. Exactly one of {reraId/status/possessionQuarter, phases} is populated. */
  phases?: ProjectPhase[];
  charges?: ProjectCharges;
  towers: string[];
  totalUnits: number;
  priceRangeInr: { min: number; max: number };
  maintenancePerSqftPerMonthInr: number;
  amenities: string[];
  nearby: Array<{ name: string; kind: string; distanceKm: number }>;
}

export interface Booking {
  id: string;
  unitId: string;
  slotId: string;
  visitorName: string;
  visitorPhone: string;
  mode: VisitMode;
  createdAtSim: string;
}

export interface Escalation {
  id: string;
  reason: string;
  summary: string;
  priority: 'low' | 'normal' | 'high';
  createdAtSim: string;
}

export interface Qualification {
  id: string;
  budgetInr: number;
  timelineMonths: number;
  unitTypeInterest: UnitType;
  financing: 'home_loan' | 'self_funded' | 'undecided';
  leadScore: 'hot' | 'warm' | 'cold';
  quotedPriceInr?: number;
  notes?: string;
  createdAtSim: string;
}

export interface RealEstateDb {
  dbVersion: string;
  disclaimer: string;
  project: ProjectInfo;
  /** Corpus v2+. Lives on the DB, not ProjectInfo: it is dealer-side, not marketing. */
  agentPolicy?: AgentPolicy;
  paymentPlans: PaymentPlan[];
  units: Unit[];
  assets: Asset[];
  siteVisitSlots: SiteVisitSlot[];
  bookings: Booking[];
  escalations: Escalation[];
  qualifications: Qualification[];
}

// ---------------------------------------------------------------------------
// Gold-DB validation
// ---------------------------------------------------------------------------

const UNIT_TYPE = z.enum(['1BHK', '2BHK', '3BHK', '4BHK']);
const ASSET_KIND = z.enum([
  'brochure',
  'floor_plan',
  'price_sheet',
  'video',
  'spec_sheet',
  'amenity_list',
  'rera_certificate',
  'approvals_note',
  'cost_sheet_sample',
  'possession_update',
]);

const unitSchema = z.strictObject({
  id: z.string().min(1),
  tower: z.string().min(1),
  floor: z.number().int().nonnegative(),
  unitType: UNIT_TYPE,
  carpetAreaSqft: z.number().positive(),
  superBuiltUpAreaSqft: z.number().positive().optional(),
  facing: z.string().min(1),
  priceInr: z.number().int().positive(),
  status: z.enum(['available', 'blocked', 'sold']),
});

const phaseSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  towers: z.array(z.string().min(1)).min(1),
  reraId: z.string().min(1),
  status: z.enum(['ready', 'under_construction']),
  possessionQuarter: z.string().min(1),
  ocReceived: z.boolean(),
  ccReceived: z.boolean(),
  basicRatePerSqftCarpetInr: z.number().positive(),
});

const chargesSchema = z.strictObject({
  floorRisePerSqftPerFloorInr: z.number().nonnegative(),
  floorRiseStartFloor: z.number().int().nonnegative(),
  plcPerSqftByFacing: z.record(z.string(), z.number().nonnegative()),
  coveredParkingInr: z.number().nonnegative(),
  clubMembershipInr: z.number().nonnegative(),
  corpusFundPerSqftInr: z.number().nonnegative(),
  legalAndDocumentationInr: z.number().nonnegative(),
  gstPercent: z.strictObject({
    underConstruction: z.number().nonnegative(),
    readyWithOc: z.number().nonnegative(),
  }),
  stampDutyPercent: z.number().nonnegative(),
  registrationFeePercent: z.number().nonnegative(),
  registrationFeeCapInr: z.number().nonnegative(),
});

const agentPolicySchema = z.strictObject({
  version: z.string().min(1),
  maxDiscretionaryDiscountPercent: z.number().nonnegative(),
  discountApprovalRule: z.string().min(1),
  tokenAmountInr: z.number().nonnegative(),
  prohibitedPromises: z.array(z.string().min(1)).min(1),
  escalationTriggers: z.array(z.string().min(1)).min(1),
  quotingRules: z.array(z.string().min(1)).min(1),
});

const projectSchema = z
  .strictObject({
    id: z.string().min(1),
    name: z.string().min(1),
    developer: z.string().min(1),
    city: z.string().min(1),
    state: z.string().min(1),
    locality: z.string().min(1),
    reraId: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    possessionQuarter: z.string().min(1).optional(),
    phases: z.array(phaseSchema).min(1).optional(),
    charges: chargesSchema.optional(),
    towers: z.array(z.string().min(1)).min(1),
    totalUnits: z.number().int().positive(),
    priceRangeInr: z.strictObject({ min: z.number().positive(), max: z.number().positive() }),
    maintenancePerSqftPerMonthInr: z.number().nonnegative(),
    amenities: z.array(z.string().min(1)),
    nearby: z.array(
      z.strictObject({
        name: z.string().min(1),
        kind: z.string().min(1),
        distanceKm: z.number().nonnegative(),
      }),
    ),
  })
  .superRefine((p, ctx) => {
    const legacy = p.reraId !== undefined || p.status !== undefined;
    if (p.phases && legacy) {
      ctx.addIssue({
        code: 'custom',
        message: 'project has both per-phase registration and the v1 single-phase fields; use one',
        path: ['phases'],
      });
    }
    if (
      !p.phases &&
      (p.reraId === undefined || p.status === undefined || p.possessionQuarter === undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'single-phase project must carry reraId, status and possessionQuarter',
        path: ['reraId'],
      });
    }
    if (p.phases) {
      const phaseTowers = p.phases.flatMap((ph) => ph.towers).sort();
      const declared = [...p.towers].sort();
      if (JSON.stringify(phaseTowers) !== JSON.stringify(declared)) {
        ctx.addIssue({
          code: 'custom',
          message: `phase towers [${phaseTowers.join(',')}] must partition project towers [${declared.join(',')}]`,
          path: ['phases'],
        });
      }
    }
  });

export const goldDbSchema = z.strictObject({
  dbVersion: z.string().min(1),
  disclaimer: z.string().min(20),
  project: projectSchema,
  agentPolicy: agentPolicySchema.optional(),
  paymentPlans: z.array(
    z.strictObject({
      id: z.string().min(1),
      name: z.string().min(1),
      bookingPercent: z.number().nonnegative(),
      discountPercent: z.number().nonnegative(),
      milestones: z.array(z.strictObject({ label: z.string().min(1), percent: z.number() })),
    }),
  ),
  units: z.array(unitSchema).min(1),
  assets: z.array(
    z.strictObject({
      id: z.string().min(1),
      kind: ASSET_KIND,
      name: z.string().min(1),
      url: z.string().min(1),
      sizeKb: z.number().positive(),
    }),
  ),
  siteVisitSlots: z.array(
    z.strictObject({
      id: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      time: z.string().min(1),
      mode: z.enum(['in_person', 'virtual']),
      capacity: z.number().int().positive(),
      booked: z.number().int().nonnegative(),
    }),
  ),
  bookings: z.array(z.unknown()),
  escalations: z.array(z.unknown()),
  qualifications: z.array(z.unknown()),
});

/** Phase a tower belongs to, for per-phase facts (RERA id, GST, possession). */
export function phaseOfTower(db: RealEstateDb, tower: string): ProjectPhase | undefined {
  return db.project.phases?.find((ph) => ph.towers.includes(tower));
}

/**
 * Canonical JSON: keys sorted lexicographically at every level, array order
 * preserved, no whitespace. Built by hand rather than via `JSON.stringify`
 * because JS object key ordering puts integer-like keys first regardless of
 * insertion order, which would make the hash depend on key *shape*.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object':
      break;
    default:
      // undefined / function / symbol / bigint have no canonical form here.
      return 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(obj).sort()) {
    const child = obj[key];
    if (child === undefined || typeof child === 'function' || typeof child === 'symbol') continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(child)}`);
  }
  return `{${parts.join(',')}}`;
}

/** Deterministic SHA-256 over the canonical JSON form. */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function hashDb(db: RealEstateDb): string {
  return sha256(canonicalJson(db));
}

/**
 * Load the gold (immutable reference) DB from disk, validated. Ground truth
 * that fails its own schema would silently corrupt every downstream check, so
 * a malformed gold DB is a crash at load time, never a quiet cast.
 */
export function loadGoldDb(path: string): RealEstateDb {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = goldDbSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Gold DB at ${path} failed validation:\n${issues}`);
  }
  return result.data as RealEstateDb;
}

/** Every trial gets its own deep clone; the gold DB is never mutated. */
export function resetDb(gold: RealEstateDb): RealEstateDb {
  return structuredClone(gold);
}

export interface SimClockConfig {
  startIso: string;
  stepSeconds: number;
}

/**
 * A fixed, injectable clock. `now()` is stable until something calls `tick()`,
 * so timestamps in a transcript are a function of the scenario alone.
 */
export class SimClock {
  readonly startMs: number;
  readonly stepMs: number;
  #currentMs: number;

  constructor(config: SimClockConfig) {
    const startMs = Date.parse(config.startIso);
    if (Number.isNaN(startMs)) {
      throw new Error(`SimClock: unparseable startIso ${JSON.stringify(config.startIso)}`);
    }
    if (!Number.isFinite(config.stepSeconds) || config.stepSeconds < 0) {
      throw new Error(`SimClock: stepSeconds must be a non-negative finite number`);
    }
    this.startMs = startMs;
    this.stepMs = Math.round(config.stepSeconds * 1000);
    this.#currentMs = startMs;
  }

  now(): string {
    return new Date(this.#currentMs).toISOString();
  }

  /** Advance one scenario step and return the new time. */
  tick(): string {
    this.#currentMs += this.stepMs;
    return this.now();
  }

  /** Advance an explicit number of steps (used by tools that span time). */
  advance(steps: number): string {
    this.#currentMs += this.stepMs * steps;
    return this.now();
  }

  /** Jump an absolute duration (the 24h gap between re-engagement sessions). */
  advanceSeconds(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error('SimClock: advanceSeconds needs a non-negative finite number');
    }
    this.#currentMs += Math.round(seconds * 1000);
    return this.now();
  }

  reset(): void {
    this.#currentMs = this.startMs;
  }
}

/** Zero-padded, monotonic, collision-free ids. No `Math.random` anywhere. */
export function sequentialId(prefix: string, existingCount: number): string {
  return `${prefix}_${String(existingCount + 1).padStart(5, '0')}`;
}
