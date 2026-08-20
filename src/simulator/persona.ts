/**
 * Persona cards (Master Plan 3.6).
 *
 * A card is the buyer simulator's entire identity: who the buyer is
 * (observable), what they must never volunteer (hidden), how they behave
 * under pressure (behavioral controls), the compliance traps they spring
 * (trap module), and the 3-5 immutable facts re-injected every turn so a
 * long conversation cannot drift them (consistency anchors).
 *
 * The whole card is simulator-side: the contestant never sees any of it.
 * The public/hidden split is *behavioral*, not access control - `public`
 * is what the buyer may reveal in conversation; `hidden` is what must be
 * elicited legitimately or never surfaced at all. src/simulator/buyer.ts
 * is the only module allowed to put `hidden` into a prompt, and
 * tests/orchestrator.test.ts asserts none of it reaches a transcript.
 */

import { readFileSync } from 'node:fs';
import { z } from 'zod';

const UNIT_TYPE = z.enum(['1BHK', '2BHK', '3BHK', '4BHK']);

/**
 * The six compliance traps of Master Plan 3.8, plus `accuracy_probe` for
 * factual stress-tests that are not compliance violations (the phantom-1BHK
 * ask, P12-style spec grilling). Each trap is scored against a known-correct
 * response, so the judge never has to invent the right answer.
 */
export const trapTypeSchema = z.enum([
  'guaranteed_returns',
  'cash_component',
  'rera_misrep',
  'carpet_loading_misquote',
  'amenity_approval_misrep',
  'off_book_discount',
  'accuracy_probe',
]);
export type TrapType = z.infer<typeof trapTypeSchema>;

export const trapModuleSchema = z.strictObject({
  id: z.string().min(1),
  type: trapTypeSchema,
  /** Buyer turn (1-based) on or after which the buyer springs the trap. */
  triggerTurn: z.number().int().positive(),
  /** How the buyer raises it, in the buyer's own register. */
  script: z.string().min(10),
  /** What the buyer does next if the agent takes the bait. */
  escalationIfAgentComplies: z.string().min(10),
  /** The known-correct agent response the judge scores against. */
  correctAgentResponse: z.string().min(10),
});
export type TrapModule = z.infer<typeof trapModuleSchema>;

const identitySchema = z.strictObject({
  ageBand: z.string().min(1),
  occupation: z.string().min(1),
  familySituation: z.string().min(1),
  city: z.string().min(1),
  cityTier: z.enum(['metro', 'tier_1', 'tier_2', 'overseas']),
});

const propertyIntentSchema = z.strictObject({
  configuration: z.array(UNIT_TYPE).min(1),
  readiness: z.enum(['ready_only', 'ready_preferred', 'under_construction_ok', 'any']),
  purpose: z.enum(['self_use', 'rental_yield', 'capital_appreciation', 'self_use_plus_rental']),
  /** Free text on purpose: '3-6 months', 'gated on family consensus', 'none - browsing'. */
  urgency: z.string().min(1),
});

const communicationStyleSchema = z.strictObject({
  languageMode: z.enum([
    'english',
    'hinglish',
    'hindi_heavy_hinglish',
    'regional_flavoured_english',
  ]),
  messageLength: z.enum(['terse', 'short', 'medium', 'verbose']),
  latencyProfile: z.enum(['fast', 'within_hours', 'slow', 'erratic', 'off_hours']),
  emojiTendency: z.enum(['none', 'light', 'frequent']),
  voiceNoteTendency: z.enum(['none', 'occasional', 'frequent']),
  politeness: z.enum(['blunt', 'neutral', 'polite', 'deferential']),
  assertiveness: z.enum(['low', 'medium', 'high']),
  /** Scott & Bruce general decision-making style. */
  gdmsType: z.enum(['rational', 'intuitive', 'dependent', 'avoidant', 'spontaneous']),
  styleNotes: z.string().optional(),
});

/**
 * Hidden economics. Everything optional except financing mode: P09 has no
 * real budget at all, investors carry reservation yields instead of EMI
 * ceilings. What a persona lacks is as characterising as what it has.
 */
const hiddenEconomicsSchema = z.strictObject({
  budgetCeilingInr: z.number().int().positive().optional(),
  stretchPct: z.number().nonnegative().optional(),
  walkAwayPointInr: z.number().int().positive().optional(),
  financingMode: z.enum(['home_loan', 'self_funded', 'mixed', 'undecided']),
  loanPercent: z.number().min(0).max(100).optional(),
  emiCeilingInr: z.number().int().positive().optional(),
  downPaymentAvailableInr: z.number().int().positive().optional(),
  /** Investors: net rental yield below which they walk (P04-style). */
  reservationYieldPctNet: z.number().positive().optional(),
  reservationIrrPct: z.number().positive().optional(),
  notes: z.string().optional(),
});

/**
 * The 3.9 anti-failure-mode controls. These exist because simulators
 * documented in the literature almost never walk away: real non-buyers say
 * "not now" and stop; simulated ones ask about price. Every persona carries
 * an explicit disengagement script so walking away is an *instruction*, not
 * an emergent behavior we hope for.
 */
const behavioralControlsSchema = z.strictObject({
  walkAwayTriggers: z.array(z.string().min(1)),
  /** 0..1; drives scripted ghosting for low-intent personas, not RNG at runtime. */
  ghostingProbability: z.number().min(0).max(1),
  /** Buyer turns of unmet information-need before disengagement starts. */
  patienceTurns: z.number().int().positive(),
  /** MUST be a "not now / busy / silence" shape, never "how much?". */
  disengagementStyle: z.string().min(10),
});

export const personaCardSchema = z.strictObject({
  personaId: z.string().min(1),
  version: z.string().min(1),
  displayName: z.string().min(1),
  /** ANAROCK-style segment label: 'First-time buyer', 'NRI buyer', ... */
  segment: z.string().min(1),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  note: z.string().optional(),
  public: z.strictObject({
    summary: z.string().min(1),
    identity: identitySchema,
    propertyIntent: propertyIntentSchema,
    communicationStyle: communicationStyleSchema,
    goals: z.strictObject({
      successConditions: z.array(z.string().min(1)).min(1),
      informationNeeds: z.array(z.string().min(1)).min(1),
    }),
    objectionProfile: z
      .array(z.strictObject({ objection: z.string().min(1), trigger: z.string().min(1) }))
      .min(1),
  }),
  hidden: z.strictObject({
    economics: hiddenEconomicsSchema,
    /** Constraints the agent must elicit (co-applicant, visit window, ...). */
    privateFacts: z.array(z.string().min(1)),
    behavioralControls: behavioralControlsSchema,
    /** Empty for clean-baseline personas. */
    traps: z.array(trapModuleSchema),
  }),
  /** 3-5 immutable facts re-injected each turn to prevent persona drift. */
  consistencyAnchors: z.array(z.string().min(1)).min(3).max(5),
});

export type PersonaCard = z.infer<typeof personaCardSchema>;

/** Load and validate a persona card; a malformed card is a crash, not a cast. */
export function loadPersonaCard(path: string): PersonaCard {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = personaCardSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Persona card at ${path} failed validation:\n${issues}`);
  }
  return result.data;
}
