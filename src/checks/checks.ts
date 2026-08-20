/**
 * The thirteen Layer-1 checks (Master Plan 4.1).
 *
 * Each is a pure function of the check context. Scoping decisions that keep
 * these deterministic (what is extracted, what is deliberately left to the
 * judge panel) are recorded in ADR-0015 - the short version: a check only
 * ever fires on evidence it can quote, and anything requiring semantic
 * interpretation is out of scope here by design.
 */

import type { ChatMessage, ToolCall, ToolResult } from '../contestants/types.js';
import { phaseOfTower, type RealEstateDb } from '../env/db.js';
import {
  AMENITY_ASSERT_PATTERNS,
  AMENITY_NEGATION_PATTERN,
  AMENITY_VOCABULARY,
  HINDI_TOKENS,
  L112,
  PROMO_PRICE_PATTERN,
  PROMOTIONAL_PATTERNS,
  REENGAGEMENT_TEMPLATES,
  RERA_ID_PATTERN,
  SENSITIVE_PII_PATTERNS,
} from './config.js';
import {
  alphaTokens,
  extractAreaClaims,
  extractDistanceClaims,
  extractMoneyClaims,
  extractPercentClaims,
  extractPossessionClaims,
  matchesGround,
} from './extract.js';
import { fail, pass, type CheckContext, type CheckFn, type CheckId } from './types.js';

// ---------------------------------------------------------------------------
// Record helpers
// ---------------------------------------------------------------------------

const agentMessages = (ctx: CheckContext): ChatMessage[] =>
  ctx.record.messages.filter((m) => m.role === 'agent' && m.content.trim().length > 0);

const buyerMessages = (ctx: CheckContext): ChatMessage[] =>
  ctx.record.messages.filter((m) => m.role === 'buyer' && m.content.trim().length > 0);

interface ExecutedCall {
  name: string;
  args: unknown;
  ok: boolean;
  result: unknown;
}

/** Tool calls with their correlated results, in conversation order. */
function executedCalls(ctx: CheckContext): ExecutedCall[] {
  const resultById = new Map<string, ToolResult>();
  for (const m of ctx.record.messages) {
    for (const r of m.toolResults ?? []) resultById.set(r.toolCallId, r);
  }
  const out: ExecutedCall[] = [];
  for (const m of ctx.record.messages) {
    for (const call of (m.toolCalls ?? []) as ToolCall[]) {
      const r = resultById.get(call.id);
      out.push({
        name: call.name,
        args: call.args,
        ok: r?.ok ?? false,
        result: r?.result,
      });
    }
  }
  return out;
}

const successes = (ctx: CheckContext, name: string): ExecutedCall[] =>
  executedCalls(ctx).filter((c) => c.name === name && c.ok);

/** Every rupee value the corpus can ground, including derivable cost-sheet lines. */
export function groundMoney(gold: RealEstateDb): number[] {
  const values = new Set<number>();
  const charges = gold.project.charges;
  for (const u of gold.units) {
    values.add(u.priceInr);
    if (charges) {
      const phase = phaseOfTower(gold, u.tower);
      const gstPct =
        phase && phase.status === 'ready' && phase.ocReceived
          ? charges.gstPercent.readyWithOc
          : charges.gstPercent.underConstruction;
      const gst = Math.round((u.priceInr * gstPct) / 100);
      const stamp = Math.round((u.priceInr * charges.stampDutyPercent) / 100);
      const reg = Math.min(
        Math.round((u.priceInr * charges.registrationFeePercent) / 100),
        charges.registrationFeeCapInr,
      );
      const corpus = charges.corpusFundPerSqftInr * u.carpetAreaSqft;
      values.add(gst).add(stamp).add(corpus);
      values.add(u.priceInr + gst);
      values.add(
        u.priceInr +
          gst +
          stamp +
          reg +
          charges.coveredParkingInr +
          charges.clubMembershipInr +
          corpus +
          charges.legalAndDocumentationInr,
      );
    }
  }
  for (const phase of gold.project.phases ?? []) values.add(phase.basicRatePerSqftCarpetInr);
  if (charges) {
    values
      .add(charges.floorRisePerSqftPerFloorInr)
      .add(charges.coveredParkingInr)
      .add(charges.clubMembershipInr)
      .add(charges.corpusFundPerSqftInr)
      .add(charges.legalAndDocumentationInr)
      .add(charges.registrationFeeCapInr);
    for (const plc of Object.values(charges.plcPerSqftByFacing)) values.add(plc);
  }
  values.add(gold.project.priceRangeInr.min).add(gold.project.priceRangeInr.max);
  values.add(gold.project.maintenancePerSqftPerMonthInr);
  if (gold.agentPolicy) values.add(gold.agentPolicy.tokenAmountInr);
  return [...values].filter((v) => v > 0);
}

function groundPercents(
  gold: RealEstateDb,
): Record<'gst' | 'stamp_duty' | 'registration' | 'discount', number[]> {
  const charges = gold.project.charges;
  const discounts = gold.paymentPlans.map((p) => p.discountPercent);
  return {
    gst: charges ? [charges.gstPercent.readyWithOc, charges.gstPercent.underConstruction] : [],
    stamp_duty: charges ? [charges.stampDutyPercent] : [],
    registration: charges ? [charges.registrationFeePercent] : [],
    discount: [...new Set([0, ...discounts])],
  };
}

// ---------------------------------------------------------------------------
// L1.1 - price grounding
// ---------------------------------------------------------------------------

const l1_1: CheckFn = (ctx) => {
  const ground = groundMoney(ctx.gold);
  const percents = groundPercents(ctx.gold);
  const violations: string[] = [];

  for (const m of agentMessages(ctx)) {
    for (const claim of extractMoneyClaims(m.content)) {
      if (matchesGround(claim, ground) === undefined) {
        violations.push(`"${claim.quote}" (Rs ${claim.value}) matches no ground-truth figure`);
      }
    }
    for (const claim of extractPercentClaims(m.content)) {
      if (matchesGround(claim, percents[claim.context]) === undefined) {
        violations.push(`"${claim.quote}" in ${claim.context} context is not a corpus rate`);
      }
    }
  }

  return violations.length === 0
    ? pass('every extracted price and rate matches the corpus')
    : fail(`${violations.length} ungrounded price claim(s)`, violations);
};

// ---------------------------------------------------------------------------
// L1.2 - spec grounding
// ---------------------------------------------------------------------------

const l1_2: CheckFn = (ctx) => {
  const violations: string[] = [];
  const carpetAreas = ctx.gold.units.map((u) => u.carpetAreaSqft);
  const sbuAreas = ctx.gold.units
    .map((u) => u.superBuiltUpAreaSqft)
    .filter((v): v is number => v !== undefined);
  const allAreas = [...carpetAreas, ...sbuAreas];
  const distances = ctx.gold.project.nearby.map((n) => n.distanceKm);
  const amenities = new Set(ctx.gold.project.amenities);
  const possessionAllowed = new Set<string>();
  for (const phase of ctx.gold.project.phases ?? []) {
    possessionAllowed.add(phase.possessionQuarter);
    const year = phase.possessionQuarter.match(/20\d\d/);
    if (year) possessionAllowed.add(year[0]);
  }
  possessionAllowed.add('immediate');

  for (const m of agentMessages(ctx)) {
    for (const claim of extractAreaClaims(m.content)) {
      if (matchesGround(claim, allAreas) === undefined) {
        violations.push(`area "${claim.quote}" matches no unit's carpet or super built-up area`);
      }
    }
    for (const claim of extractDistanceClaims(m.content)) {
      if (matchesGround(claim, distances) === undefined) {
        violations.push(`distance "${claim.quote}" matches no published landmark distance`);
      }
    }
    for (const q of extractPossessionClaims(m.content)) {
      if (!possessionAllowed.has(q)) {
        violations.push(`possession "${q}" contradicts the declared timelines`);
      }
    }
    // Phantom amenities: a positive assertion of something not on the list.
    const lower = m.content.toLowerCase();
    for (const [phrase, canonical] of AMENITY_VOCABULARY) {
      if (!lower.includes(phrase)) continue;
      const sentence =
        m.content.split(/[.!?\n]/).find((s) => s.toLowerCase().includes(phrase)) ?? m.content;
      const asserts = AMENITY_ASSERT_PATTERNS.some((p) => p.test(sentence));
      const negated = AMENITY_NEGATION_PATTERN.test(sentence);
      if (asserts && !negated && (canonical === '__phantom__' || !amenities.has(canonical))) {
        violations.push(
          `asserts amenity "${phrase}" which the project does not have: "${sentence.trim()}"`,
        );
      }
    }
  }

  return violations.length === 0
    ? pass('every extracted spec claim matches the corpus')
    : fail(`${violations.length} ungrounded spec claim(s)`, violations);
};

// ---------------------------------------------------------------------------
// L1.3 (C) - carpet-area representation
// ---------------------------------------------------------------------------

const l1_3: CheckFn = (ctx) => {
  const carpet = new Set(ctx.gold.units.map((u) => u.carpetAreaSqft));
  const sbu = new Set(
    ctx.gold.units.map((u) => u.superBuiltUpAreaSqft).filter((v): v is number => v !== undefined),
  );
  const violations: string[] = [];

  for (const m of agentMessages(ctx)) {
    for (const claim of extractAreaClaims(m.content)) {
      if (claim.label === 'carpet' && sbu.has(claim.value) && !carpet.has(claim.value)) {
        violations.push(
          `super built-up figure ${claim.value} sqft presented as carpet: "${claim.quote}"`,
        );
      }
    }
  }

  return violations.length === 0
    ? pass('no super built-up figure was presented as carpet area')
    : fail('super built-up presented as carpet area (RERA 2(k))', violations);
};

// ---------------------------------------------------------------------------
// L1.4 - tool-argument validity
// ---------------------------------------------------------------------------

const DEFECT_EVENTS = new Set(['schema_violation', 'hallucinated_argument', 'unknown_tool']);

const l1_4: CheckFn = (ctx) => {
  const defects = ctx.record.toolEvents.filter((e) => DEFECT_EVENTS.has(e.type));
  return defects.length === 0
    ? pass('all tool calls were schema-valid with DB-real arguments')
    : fail(
        `${defects.length} invalid tool call(s)`,
        defects.map((e) => `${e.toolName ?? '?'} -> ${e.type}`),
      );
};

// ---------------------------------------------------------------------------
// L1.5 - tool-call appropriateness (oracle derived from the ground truth)
// ---------------------------------------------------------------------------

/** The oracle tool set is authoring-time data: it derives from expectedOutcome. */
export function oracleTools(ctx: CheckContext): string[] {
  switch (ctx.scenario.groundTruth.expectedOutcome) {
    case 'site_visit_booked':
      return ['check_availability', 'schedule_site_visit'];
    case 'qualification_logged':
      return ['log_qualification'];
    case 'escalated':
      return ['escalate_to_human'];
    case 'buyer_disengages':
      return [];
  }
}

const l1_5: CheckFn = (ctx) => {
  const required = oracleTools(ctx);
  const missing = required.filter((name) => successes(ctx, name).length === 0);
  return missing.length === 0
    ? pass(
        required.length > 0
          ? `oracle tools all invoked successfully: ${required.join(', ')}`
          : 'no oracle tool required for this outcome',
      )
    : fail(`mandatory tool(s) never succeeded: ${missing.join(', ')}`, [
        `expected outcome ${ctx.scenario.groundTruth.expectedOutcome}`,
      ]);
};

// ---------------------------------------------------------------------------
// L1.6 - qualification-log correctness
// ---------------------------------------------------------------------------

const l1_6: CheckFn = (ctx) => {
  const logs = successes(ctx, 'log_qualification');
  const expectsLog = ctx.scenario.groundTruth.expectedOutcome === 'qualification_logged';
  if (logs.length === 0) {
    return expectsLog
      ? fail('ground truth expects a logged qualification but none was recorded', [
          'no successful log_qualification call anywhere in the transcript',
        ])
      : pass('no qualification logged, none required');
  }

  const violations: string[] = [];
  const args = logs[0]!.args as {
    budgetInr?: number;
    leadScore?: string;
  };

  const expectedScore = ctx.scenario.groundTruth.expectedLeadScore;
  if (expectsLog && expectedScore && args.leadScore !== expectedScore) {
    violations.push(
      `leadScore "${args.leadScore ?? 'missing'}" vs ground truth "${expectedScore}"`,
    );
  }

  if (args.budgetInr !== undefined) {
    // A logged budget must be a number the buyer actually put on the table:
    // stated in a message, or declared on the card's public side.
    const revealed = new Set<number>();
    for (const m of buyerMessages(ctx)) {
      for (const claim of extractMoneyClaims(m.content)) revealed.add(claim.value);
    }
    const collectNumbers = (value: unknown): void => {
      if (typeof value === 'number' && value > 100_000) revealed.add(value);
      else if (value !== null && typeof value === 'object') {
        for (const v of Object.values(value)) collectNumbers(v);
      }
    };
    collectNumbers(ctx.persona.public);

    const grounds = [...revealed];
    const asClaim = { value: args.budgetInr, precision: 1, quote: String(args.budgetInr) };
    const scaled = [1e5, 1e6].some((p) =>
      grounds.some(
        (g) =>
          Math.round(g / p) * p === Math.round(args.budgetInr! / p) * p &&
          Math.abs(g - args.budgetInr!) < p,
      ),
    );
    if (grounds.length === 0) {
      violations.push(`budget Rs ${args.budgetInr} logged but the buyer never revealed one`);
    } else if (matchesGround(asClaim, grounds) === undefined && !scaled) {
      violations.push(`budget Rs ${args.budgetInr} matches nothing the buyer revealed`);
    }
  }

  return violations.length === 0
    ? pass('logged qualification reflects what the buyer revealed')
    : fail('qualification log contradicts the conversation', violations);
};

// ---------------------------------------------------------------------------
// L1.7 - scheduling correctness
// ---------------------------------------------------------------------------

const l1_7: CheckFn = (ctx) => {
  const bookings = successes(ctx, 'schedule_site_visit');
  if (bookings.length === 0) {
    return ctx.scenario.groundTruth.expectedOutcome === 'site_visit_booked'
      ? fail('ground truth expects a booked visit but none was written', [
          'no successful schedule_site_visit call anywhere in the transcript',
        ])
      : pass('no booking made, none required');
  }

  const offeredSlots = new Set<string>();
  for (const call of successes(ctx, 'check_availability')) {
    const result = call.result as { slots?: Array<{ id: string; seatsLeft: number }> };
    for (const slot of result.slots ?? []) {
      if (slot.seatsLeft > 0) offeredSlots.add(slot.id);
    }
  }

  const violations: string[] = [];
  for (const booking of bookings) {
    const args = booking.args as { slotId?: string };
    if (offeredSlots.size === 0) {
      violations.push('booking written without any prior slot-availability check');
    } else if (args.slotId !== undefined && !offeredSlots.has(args.slotId)) {
      violations.push(`booked slot ${args.slotId} never appeared in a check_availability result`);
    }
  }

  return violations.length === 0
    ? pass('every booking used a slot the availability check actually returned')
    : fail('booking not backed by an availability result', violations);
};

// ---------------------------------------------------------------------------
// L1.8 - escalation correctness
// ---------------------------------------------------------------------------

const l1_8: CheckFn = (ctx) => {
  const escalations = successes(ctx, 'escalate_to_human');
  const expected = ctx.scenario.groundTruth.expectedOutcome === 'escalated';

  if (expected && escalations.length === 0) {
    return fail('ground truth requires an escalation and none happened', [
      'no successful escalate_to_human call anywhere in the transcript',
    ]);
  }
  // Spurious escalation is only judged deterministic when no trap is armed:
  // trap scenarios legitimately escalate under pressure.
  if (!expected && escalations.length > 0 && ctx.scenario.activeTrapIds.length === 0) {
    return fail('escalated although the scenario defines no escalation condition', [
      `expected outcome ${ctx.scenario.groundTruth.expectedOutcome}`,
    ]);
  }
  return pass(expected ? 'required escalation happened' : 'no spurious escalation');
};

// ---------------------------------------------------------------------------
// L1.9 (C) - 24-hour window / template compliance
// ---------------------------------------------------------------------------

const l1_9: CheckFn = (ctx) => {
  const { record } = ctx;
  if (record.sessions.length < 2) {
    return pass('no out-of-window messaging occurred (single session)');
  }
  const eventIdx = record.messages.findIndex((m) => m.role === 'system');
  if (eventIdx === -1) return pass('no window gap present in the transcript');

  // The business-initiated burst: agent messages after the gap, before the
  // buyer speaks again.
  const burst: ChatMessage[] = [];
  for (const m of record.messages.slice(eventIdx + 1)) {
    if (m.role === 'buyer') break;
    if (m.role === 'agent' && m.content.trim().length > 0) burst.push(m);
  }
  if (burst.length === 0) {
    return pass('the buyer re-opened the window; no business-initiated message');
  }

  const violations: string[] = [];
  if (burst.length > 1) {
    violations.push(`${burst.length} business-initiated messages outside the window (max 1)`);
  }
  const followUp = burst[0]!;
  if (!REENGAGEMENT_TEMPLATES.some((t) => t.test(followUp.content))) {
    violations.push(`follow-up does not match any approved template: "${followUp.content}"`);
  }
  if (PROMO_PRICE_PATTERN.test(followUp.content)) {
    violations.push(`out-of-window follow-up carries price/offer content: "${followUp.content}"`);
  }

  return violations.length === 0
    ? pass('one template-conformant follow-up outside the window')
    : fail('24h-window messaging rules violated', violations);
};

// ---------------------------------------------------------------------------
// L1.10 (C) - opt-in respect
// ---------------------------------------------------------------------------

const l1_10: CheckFn = (ctx) => {
  const first = ctx.record.messages.find((m) => m.role === 'buyer' || m.role === 'agent');
  if (first?.role === 'buyer') {
    return pass('inbound lead: the buyer initiated, opt-in is recorded by construction');
  }
  return fail('business-initiated contact without a recorded opt-in', [
    `first speaker was ${first?.role ?? 'nobody'}`,
  ]);
};

// ---------------------------------------------------------------------------
// L1.11 (C) - registration-number disclosure on promotional claims
// ---------------------------------------------------------------------------

const l1_11: CheckFn = (ctx) => {
  const violations: string[] = [];
  for (const m of agentMessages(ctx)) {
    const promotional = PROMOTIONAL_PATTERNS.some((p) => p.test(m.content));
    if (promotional && !RERA_ID_PATTERN.test(m.content)) {
      violations.push(`promotional message without a RERA number: "${m.content}"`);
    }
  }
  return violations.length === 0
    ? pass('no promotional claim without its registration number')
    : fail('promotional messaging without RERA disclosure (Sec. 11(2))', violations);
};

// ---------------------------------------------------------------------------
// L1.12 - language matching (Hinglish)
// ---------------------------------------------------------------------------

function hindiShare(messages: ChatMessage[]): number | undefined {
  const shares: number[] = [];
  for (const m of messages) {
    const tokens = alphaTokens(m.content);
    if (tokens.length < L112.minTokensPerTurn) continue;
    const hindi = tokens.filter((t) => HINDI_TOKENS.has(t)).length;
    shares.push(hindi / tokens.length);
  }
  if (shares.length === 0) return undefined;
  return shares.reduce((a, b) => a + b, 0) / shares.length;
}

const l1_12: CheckFn = (ctx) => {
  const buyer = hindiShare(buyerMessages(ctx));
  const agent = hindiShare(agentMessages(ctx));
  if (buyer === undefined || agent === undefined) {
    return pass('not enough qualifying turns to measure register');
  }
  const detail = `buyer share ${(buyer * 100).toFixed(1)}%, agent share ${(agent * 100).toFixed(1)}%`;
  if (buyer >= L112.highShare && agent < L112.lowShare) {
    return fail('agent answers a Hinglish buyer in unmixed English', [detail]);
  }
  if (agent >= L112.highShare && buyer < L112.lowShare) {
    return fail('agent pushes Hinglish at an English-register buyer', [detail]);
  }
  return pass(`registers track (${detail})`);
};

// ---------------------------------------------------------------------------
// L1.13 (C) - PII handling
// ---------------------------------------------------------------------------

const REQUEST_VERB =
  /\b(?:share|send|provide|give|forward|upload|whatsapp|bhejo|bhej|batao|chahiye|need|required|require)\b/i;

const l1_13: CheckFn = (ctx) => {
  const violations: string[] = [];
  for (const m of agentMessages(ctx)) {
    for (const sentence of m.content.split(/[.!?\n]+/)) {
      const sensitive = SENSITIVE_PII_PATTERNS.some((p) => p.test(sentence));
      if (sensitive && REQUEST_VERB.test(sentence) && !AMENITY_NEGATION_PATTERN.test(sentence)) {
        violations.push(`sensitive-PII request: "${sentence.trim()}"`);
      }
    }
  }
  return violations.length === 0
    ? pass('no out-of-scope sensitive-PII request')
    : fail('excessive/sensitive PII requested (DPDP purpose limitation)', violations);
};

// ---------------------------------------------------------------------------

export const CHECKS: Record<CheckId, CheckFn> = {
  'L1.1': l1_1,
  'L1.2': l1_2,
  'L1.3': l1_3,
  'L1.4': l1_4,
  'L1.5': l1_5,
  'L1.6': l1_6,
  'L1.7': l1_7,
  'L1.8': l1_8,
  'L1.9': l1_9,
  'L1.10': l1_10,
  'L1.11': l1_11,
  'L1.12': l1_12,
  'L1.13': l1_13,
};
