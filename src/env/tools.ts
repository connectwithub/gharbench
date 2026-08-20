/**
 * The six environment tools.
 *
 * Every tool is a pure function of (db, args, clock). No wall clock, no
 * `Math.random`, and every returned list is sorted by a stable key so two runs
 * of the same scenario produce byte-identical transcripts.
 *
 * Failure is data, not control flow. A bad call never throws: it returns a
 * structured `ToolError` whose `code` is exactly the Layer-1 event the Phase 2
 * checks will consume.
 *
 *   schema_violation      - args failed the Zod schema (wrong type, unknown key,
 *                           missing required field, bad phone format...)
 *   hallucinated_argument - args were well-formed but named something that does
 *                           not exist in the DB (unit id, tower, price, unit type)
 *   unavailable           - args were valid and real, but the world said no
 *                           (slot full, unit already sold, mode mismatch).
 *                           This is a legitimate business outcome, NOT a defect.
 */

import { z } from 'zod';
import {
  sequentialId,
  type Asset,
  type RealEstateDb,
  type SimClock,
  type SiteVisitSlot,
  type Unit,
  type UnitType,
} from './db.js';

export type ToolKind = 'READ' | 'WRITE';

export type ToolErrorCode =
  'schema_violation' | 'hallucinated_argument' | 'unavailable' | 'unknown_tool';

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: ToolError };

export interface ToolContext {
  db: RealEstateDb;
  clock: SimClock;
}

const ok = (result: unknown): ToolOutcome => ({ ok: true, result });
const fail = (
  code: ToolErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ToolOutcome => ({ ok: false, error: details ? { code, message, details } : { code, message } });

const UNIT_TYPE = z.enum(['1BHK', '2BHK', '3BHK', '4BHK']);
const VISIT_MODE = z.enum(['in_person', 'virtual']);

/** Indian mobile in E.164. Deliberately strict so bad numbers land as schema_violation. */
const PHONE = z
  .string()
  .regex(/^\+91[6-9][0-9]{9}$/, 'phone must be E.164 Indian mobile, e.g. +919876543210');

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const fetchProjectInfoSchema = z.strictObject({
  sections: z
    .array(
      z.enum([
        'overview',
        'units',
        'amenities',
        'payment_plans',
        'possession',
        'nearby',
        'rera',
        'phases',
        'charges',
        'policy',
      ]),
    )
    .min(1)
    .optional()
    .describe('Which sections to return. Omit for the overview only.'),
});

export const sendAssetSchema = z.strictObject({
  assetId: z.string().min(1).describe('Id of an asset that exists in the project library.'),
  note: z.string().max(300).optional().describe('Short covering message sent with the file.'),
});

export const checkAvailabilitySchema = z.strictObject({
  target: z
    .enum(['units', 'site_visit_slots'])
    .describe('Whether to check inventory or site-visit slots.'),
  unitType: UNIT_TYPE.optional(),
  maxPriceInr: z.number().int().positive().optional(),
  tower: z.string().min(1).optional().describe('Tower label, must be a tower of this project.'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional()
    .describe('Only for target=site_visit_slots.'),
  mode: VISIT_MODE.optional().describe('Only for target=site_visit_slots.'),
});

export const scheduleSiteVisitSchema = z.strictObject({
  unitId: z.string().min(1),
  slotId: z.string().min(1),
  visitorName: z.string().min(1).max(120),
  visitorPhone: PHONE,
  mode: VISIT_MODE,
});

export const escalateToHumanSchema = z.strictObject({
  reason: z.enum([
    'pricing_negotiation',
    'legal_or_rera_query',
    'complaint',
    'out_of_scope',
    'buyer_requested_human',
  ]),
  summary: z.string().min(10).max(1000),
  priority: z.enum(['low', 'normal', 'high']),
});

export const logQualificationSchema = z.strictObject({
  budgetInr: z.number().int().positive().max(1_000_000_000),
  timelineMonths: z.number().int().min(0).max(120),
  unitTypeInterest: UNIT_TYPE,
  financing: z.enum(['home_loan', 'self_funded', 'undecided']),
  leadScore: z.enum(['hot', 'warm', 'cold']),
  quotedPriceInr: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('If a price was quoted to the buyer, it must match a real unit price.'),
  notes: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Stable ordering helpers
// ---------------------------------------------------------------------------

const byId = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const sortedById = <T extends { id: string }>(items: readonly T[]): T[] => [...items].sort(byId);

const publicUnit = (u: Unit) => ({
  id: u.id,
  tower: u.tower,
  floor: u.floor,
  unitType: u.unitType,
  carpetAreaSqft: u.carpetAreaSqft,
  // Both areas are exposed so loading % is derivable fact, not agent guesswork.
  ...(u.superBuiltUpAreaSqft !== undefined ? { superBuiltUpAreaSqft: u.superBuiltUpAreaSqft } : {}),
  facing: u.facing,
  priceInr: u.priceInr,
  status: u.status,
});

const publicSlot = (s: SiteVisitSlot) => ({
  id: s.id,
  date: s.date,
  time: s.time,
  mode: s.mode,
  seatsLeft: Math.max(0, s.capacity - s.booked),
});

const publicAsset = (a: Asset) => ({
  id: a.id,
  kind: a.kind,
  name: a.name,
  url: a.url,
  sizeKb: a.sizeKb,
});

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

const SECTION_ORDER = [
  'overview',
  'phases',
  'possession',
  'rera',
  'units',
  'charges',
  'amenities',
  'payment_plans',
  'nearby',
  'policy',
] as const;

const publicPhase = (ph: NonNullable<RealEstateDb['project']['phases']>[number]) => ({
  id: ph.id,
  name: ph.name,
  towers: [...ph.towers].sort(),
  reraId: ph.reraId,
  status: ph.status,
  possessionQuarter: ph.possessionQuarter,
  ocReceived: ph.ocReceived,
  ccReceived: ph.ccReceived,
  basicRatePerSqftCarpetInr: ph.basicRatePerSqftCarpetInr,
});

function fetchProjectInfo(
  args: z.infer<typeof fetchProjectInfoSchema>,
  { db }: ToolContext,
): ToolOutcome {
  const requested = new Set(args.sections ?? ['overview']);
  const p = db.project;
  const phases = p.phases ? sortedById(p.phases) : undefined;
  const out: Record<string, unknown> = {};

  for (const section of SECTION_ORDER) {
    if (!requested.has(section)) continue;
    switch (section) {
      case 'overview':
        out['overview'] = {
          projectId: p.id,
          name: p.name,
          developer: p.developer,
          city: p.city,
          locality: p.locality,
          // Multi-phase projects have per-phase statuses; say so instead of
          // picking one and inviting the agent to over-generalise it.
          status: phases ? 'multi_phase' : p.status,
          towers: [...p.towers].sort(),
          totalUnits: p.totalUnits,
          priceRangeInr: p.priceRangeInr,
          maintenancePerSqftPerMonthInr: p.maintenancePerSqftPerMonthInr,
        };
        break;
      case 'phases':
        out['phases'] = phases ? phases.map(publicPhase) : null;
        break;
      case 'possession':
        out['possession'] = phases
          ? phases.map((ph) => ({
              phaseId: ph.id,
              towers: [...ph.towers].sort(),
              status: ph.status,
              possessionQuarter: ph.possessionQuarter,
              ocReceived: ph.ocReceived,
            }))
          : { possessionQuarter: p.possessionQuarter, status: p.status };
        break;
      case 'rera':
        out['rera'] = phases
          ? phases.map((ph) => ({
              phaseId: ph.id,
              towers: [...ph.towers].sort(),
              reraId: ph.reraId,
              state: p.state,
            }))
          : { reraId: p.reraId, state: p.state };
        break;
      case 'units':
        out['units'] = sortedById(db.units).map(publicUnit);
        break;
      case 'charges':
        out['charges'] = p.charges ?? null;
        break;
      case 'amenities':
        out['amenities'] = [...p.amenities].sort();
        break;
      case 'payment_plans':
        out['paymentPlans'] = sortedById(db.paymentPlans);
        break;
      case 'nearby':
        out['nearby'] = [...p.nearby].sort((a, b) => (a.name < b.name ? -1 : 1));
        break;
      case 'policy':
        out['policy'] = db.agentPolicy ?? null;
        break;
    }
  }

  return ok(out);
}

function sendAsset(args: z.infer<typeof sendAssetSchema>, ctx: ToolContext): ToolOutcome {
  const asset = ctx.db.assets.find((a) => a.id === args.assetId);
  if (!asset) {
    return fail('hallucinated_argument', `No asset with id "${args.assetId}" exists.`, {
      field: 'assetId',
      value: args.assetId,
      known: sortedById(ctx.db.assets).map((a) => a.id),
    });
  }
  return ok({
    sent: true,
    asset: publicAsset(asset),
    note: args.note ?? null,
    sentAtSim: ctx.clock.now(),
  });
}

function checkAvailability(
  args: z.infer<typeof checkAvailabilitySchema>,
  { db }: ToolContext,
): ToolOutcome {
  if (args.tower !== undefined && !db.project.towers.includes(args.tower)) {
    return fail('hallucinated_argument', `Tower "${args.tower}" is not part of this project.`, {
      field: 'tower',
      value: args.tower,
      known: [...db.project.towers].sort(),
    });
  }

  if (args.target === 'units') {
    const matches = sortedById(db.units).filter((u) => {
      if (u.status !== 'available') return false;
      if (args.unitType !== undefined && u.unitType !== args.unitType) return false;
      if (args.maxPriceInr !== undefined && u.priceInr > args.maxPriceInr) return false;
      if (args.tower !== undefined && u.tower !== args.tower) return false;
      return true;
    });
    return ok({ target: 'units', matchCount: matches.length, units: matches.map(publicUnit) });
  }

  const matches = sortedById(db.siteVisitSlots).filter((s) => {
    if (s.booked >= s.capacity) return false;
    if (args.date !== undefined && s.date !== args.date) return false;
    if (args.mode !== undefined && s.mode !== args.mode) return false;
    return true;
  });
  return ok({
    target: 'site_visit_slots',
    matchCount: matches.length,
    slots: matches.map(publicSlot),
  });
}

function scheduleSiteVisit(
  args: z.infer<typeof scheduleSiteVisitSchema>,
  ctx: ToolContext,
): ToolOutcome {
  const { db, clock } = ctx;

  const unit = db.units.find((u) => u.id === args.unitId);
  if (!unit) {
    return fail('hallucinated_argument', `No unit with id "${args.unitId}" exists.`, {
      field: 'unitId',
      value: args.unitId,
      known: sortedById(db.units).map((u) => u.id),
    });
  }

  const slot = db.siteVisitSlots.find((s) => s.id === args.slotId);
  if (!slot) {
    return fail('hallucinated_argument', `No site-visit slot with id "${args.slotId}" exists.`, {
      field: 'slotId',
      value: args.slotId,
      known: sortedById(db.siteVisitSlots).map((s) => s.id),
    });
  }

  if (unit.status !== 'available') {
    return fail('unavailable', `Unit ${unit.id} is ${unit.status} and cannot be viewed for sale.`, {
      unitId: unit.id,
      status: unit.status,
    });
  }
  if (slot.mode !== args.mode) {
    return fail('unavailable', `Slot ${slot.id} is a ${slot.mode} slot, not ${args.mode}.`, {
      slotId: slot.id,
      slotMode: slot.mode,
      requestedMode: args.mode,
    });
  }
  if (slot.booked >= slot.capacity) {
    return fail('unavailable', `Slot ${slot.id} is fully booked.`, {
      slotId: slot.id,
      capacity: slot.capacity,
    });
  }

  slot.booked += 1;
  const booking = {
    id: sequentialId('bkg', db.bookings.length),
    unitId: unit.id,
    slotId: slot.id,
    visitorName: args.visitorName,
    visitorPhone: args.visitorPhone,
    mode: args.mode,
    createdAtSim: clock.now(),
  };
  db.bookings.push(booking);

  return ok({
    booked: true,
    booking,
    slot: publicSlot(slot),
    unit: publicUnit(unit),
  });
}

function escalateToHuman(
  args: z.infer<typeof escalateToHumanSchema>,
  ctx: ToolContext,
): ToolOutcome {
  const escalation = {
    id: sequentialId('esc', ctx.db.escalations.length),
    reason: args.reason,
    summary: args.summary,
    priority: args.priority,
    createdAtSim: ctx.clock.now(),
  };
  ctx.db.escalations.push(escalation);
  return ok({ escalated: true, escalation });
}

function logQualification(
  args: z.infer<typeof logQualificationSchema>,
  ctx: ToolContext,
): ToolOutcome {
  const { db } = ctx;

  const availableTypes = [...new Set(db.units.map((u) => u.unitType))].sort() as UnitType[];
  if (!availableTypes.includes(args.unitTypeInterest)) {
    return fail(
      'hallucinated_argument',
      `This project has no ${args.unitTypeInterest} inventory.`,
      { field: 'unitTypeInterest', value: args.unitTypeInterest, known: availableTypes },
    );
  }

  if (args.quotedPriceInr !== undefined) {
    const realPrices = [...new Set(db.units.map((u) => u.priceInr))].sort((a, b) => a - b);
    if (!realPrices.includes(args.quotedPriceInr)) {
      return fail(
        'hallucinated_argument',
        `Quoted price ${args.quotedPriceInr} does not match any unit in the project.`,
        { field: 'quotedPriceInr', value: args.quotedPriceInr, known: realPrices },
      );
    }
  }

  const qualification = {
    id: sequentialId('qual', db.qualifications.length),
    budgetInr: args.budgetInr,
    timelineMonths: args.timelineMonths,
    unitTypeInterest: args.unitTypeInterest,
    financing: args.financing,
    leadScore: args.leadScore,
    ...(args.quotedPriceInr !== undefined ? { quotedPriceInr: args.quotedPriceInr } : {}),
    ...(args.notes !== undefined ? { notes: args.notes } : {}),
    createdAtSim: ctx.clock.now(),
  };
  db.qualifications.push(qualification);
  return ok({ logged: true, qualification });
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface ToolSpec {
  name: string;
  kind: ToolKind;
  /** A successful call ends the conversation flow (per scenario config). */
  flowEnding: boolean;
  description: string;
  schema: z.ZodType;
  run: (args: never, ctx: ToolContext) => ToolOutcome;
}

export const TOOL_SPECS = [
  {
    name: 'fetch_project_info',
    kind: 'READ',
    flowEnding: false,
    description:
      'Read project facts: overview, phases, possession, RERA registration, unit inventory, charges, amenities, payment plans, nearby landmarks, and the agent policy. This is the only source of truth about the project.',
    schema: fetchProjectInfoSchema,
    run: fetchProjectInfo as ToolSpec['run'],
  },
  {
    name: 'send_asset',
    kind: 'READ',
    flowEnding: false,
    description:
      'Send the buyer a file from the project library (brochure, floor plan, price sheet, walkthrough video). The asset id must exist.',
    schema: sendAssetSchema,
    run: sendAsset as ToolSpec['run'],
  },
  {
    name: 'check_availability',
    kind: 'READ',
    flowEnding: false,
    description:
      'Check what is currently available: either unsold units (optionally filtered by type, price ceiling or tower) or site-visit slots with seats left.',
    schema: checkAvailabilitySchema,
    run: checkAvailability as ToolSpec['run'],
  },
  {
    name: 'schedule_site_visit',
    kind: 'WRITE',
    flowEnding: false,
    description:
      'Book a site visit for a specific available unit in a specific slot. Both ids must exist and the slot must have seats left.',
    schema: scheduleSiteVisitSchema,
    run: scheduleSiteVisit as ToolSpec['run'],
  },
  {
    name: 'escalate_to_human',
    kind: 'WRITE',
    flowEnding: true,
    description: 'Hand the conversation to a human sales manager. Ends the automated conversation.',
    schema: escalateToHumanSchema,
    run: escalateToHuman as ToolSpec['run'],
  },
  {
    name: 'log_qualification',
    kind: 'WRITE',
    flowEnding: true,
    description:
      'Record the qualified lead (budget, timeline, unit type, financing, score). Ends the automated conversation.',
    schema: logQualificationSchema,
    run: logQualification as ToolSpec['run'],
  },
] as const satisfies readonly ToolSpec[];

export type ToolName = (typeof TOOL_SPECS)[number]['name'];

export const TOOL_NAMES: readonly ToolName[] = TOOL_SPECS.map((t) => t.name);

const SPEC_BY_NAME = new Map<string, ToolSpec>(TOOL_SPECS.map((t) => [t.name, t as ToolSpec]));

export function getToolSpec(name: string): ToolSpec | undefined {
  return SPEC_BY_NAME.get(name);
}

export function isFlowEndingTool(name: string): boolean {
  return SPEC_BY_NAME.get(name)?.flowEnding ?? false;
}

/**
 * Validate then execute. Never throws for caller error; a thrown exception from
 * a tool body is itself converted into a structured error so one bad tool can
 * never take down a sweep.
 */
export function executeTool(name: string, rawArgs: unknown, ctx: ToolContext): ToolOutcome {
  const spec = SPEC_BY_NAME.get(name);
  if (!spec) {
    return fail('unknown_tool', `No tool named "${name}".`, {
      value: name,
      known: [...TOOL_NAMES],
    });
  }

  const parsed = spec.schema.safeParse(rawArgs);
  if (!parsed.success) {
    return fail('schema_violation', `Arguments for "${name}" failed validation.`, {
      tool: name,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        code: i.code,
        message: i.message,
      })),
    });
  }

  try {
    return spec.run(parsed.data as never, ctx);
  } catch (cause) {
    return fail('unavailable', `Tool "${name}" failed to execute.`, {
      tool: name,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
