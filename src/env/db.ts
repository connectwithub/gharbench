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

export type UnitType = '1BHK' | '2BHK' | '3BHK' | '4BHK';
export type UnitStatus = 'available' | 'blocked' | 'sold';
export type VisitMode = 'in_person' | 'virtual';
export type AssetKind = 'brochure' | 'floor_plan' | 'price_sheet' | 'video';

export interface Unit {
  id: string;
  tower: string;
  floor: number;
  unitType: UnitType;
  carpetAreaSqft: number;
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

export interface ProjectInfo {
  id: string;
  name: string;
  developer: string;
  city: string;
  state: string;
  locality: string;
  reraId: string;
  status: string;
  possessionQuarter: string;
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
  paymentPlans: PaymentPlan[];
  units: Unit[];
  assets: Asset[];
  siteVisitSlots: SiteVisitSlot[];
  bookings: Booking[];
  escalations: Escalation[];
  qualifications: Qualification[];
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

/** Load the gold (immutable reference) DB from disk. */
export function loadGoldDb(path: string): RealEstateDb {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return parsed as RealEstateDb;
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

  reset(): void {
    this.#currentMs = this.startMs;
  }
}

/** Zero-padded, monotonic, collision-free ids. No `Math.random` anywhere. */
export function sequentialId(prefix: string, existingCount: number): string {
  return `${prefix}_${String(existingCount + 1).padStart(5, '0')}`;
}
