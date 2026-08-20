/**
 * Scenario configuration (Master Plan 3.4, and the Phase 1 gate).
 *
 * The Phase 1 gate requires every scenario to declare a deterministic
 * ground-truth outcome, at least one applicable Layer-1 check, and its
 * judge-item applicability sets (decisions D2/I4). Those are REQUIRED fields
 * here, not conventions: a scenario that cannot state what should happen and
 * how it will be checked fails at load, before it can burn a single token.
 */

import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** The seven scenario families of Master Plan 3.4. */
export const SCENARIO_FAMILIES = [
  'cold_inquiry',
  'deep_factual',
  'budget_mismatch',
  'compliance_trap',
  'site_visit_scheduling',
  'reengagement_24h',
  'hinglish_variant',
] as const;
export type ScenarioFamily = (typeof SCENARIO_FAMILIES)[number];

/** L1.1 - L1.13 (Master Plan 4.1). Phase 2 implements them; scenarios declare them now. */
const L1_CHECK_ID = z.string().regex(/^L1\.(1[0-3]|[1-9])$/, 'check ids look like L1.1 .. L1.13');

/** Judge item ids (Master Plan 4.2), e.g. CP5, F3, S1, Q2. Phase 2 pins the exact sets. */
const JUDGE_ITEM_ID = z.string().regex(/^[A-Z]{1,2}\d{1,2}$/, 'judge item ids look like CP5 / F3');

const groundTruthSchema = z.strictObject({
  /** The single deterministic outcome a correct agent reaches. */
  expectedOutcome: z.enum([
    'site_visit_booked',
    'qualification_logged',
    'escalated',
    'buyer_disengages',
  ]),
  /** Required when the outcome is a logged qualification. */
  expectedLeadScore: z.enum(['hot', 'warm', 'cold']).optional(),
  /** Per-scenario truth statements the checks and judges hold the agent to. */
  mustHold: z.array(z.string().min(1)).min(1),
});

/**
 * The 24-hour re-engagement flow (family 6): one conversation, two sessions,
 * with the sim clock advanced across the gap. Session 2 may be opened by the
 * agent (the re-engagement being tested) or by the buyer returning.
 */
const secondSessionSchema = z.strictObject({
  gapSeconds: z.number().int().positive(),
  opener: z.enum(['buyer', 'agent']),
  /** Required when opener=buyer: what the returning buyer says. */
  buyerReturnMessage: z.string().min(1).optional(),
  maxSteps: z.number().int().positive(),
});

export const scenarioConfigSchema = z
  .strictObject({
    scenarioId: z.string().min(1),
    version: z.string().min(1),
    note: z.string().optional(),
    personaId: z.string().min(1),
    dbVersion: z.string().min(1),
    channel: z.string().min(1),
    family: z.enum(SCENARIO_FAMILIES),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    language: z.enum(['english', 'hinglish']),
    /** G16: the stratified ~30% private pool is tagged at authoring time. */
    pool: z.enum(['public', 'private']),
    /** For hinglish_variant scenarios derived from a base scenario. */
    variantOf: z.string().min(1).optional(),
    /** Persona trap ids armed in this scenario (subset of the card's traps). */
    activeTrapIds: z.array(z.string().min(1)),
    groundTruth: groundTruthSchema,
    /** Phase 1 gate: at least one applicable programmatic check. */
    applicableChecks: z.array(L1_CHECK_ID).min(1),
    /** D2/I4: per-judge item applicability, declared per scenario. */
    judgeApplicability: z.strictObject({
      factuality: z.array(JUDGE_ITEM_ID),
      compliance: z.array(JUDGE_ITEM_ID),
      salesEffectiveness: z.array(JUDGE_ITEM_ID),
      conversationQuality: z.array(JUDGE_ITEM_ID),
    }),
    seed: z.number().int(),
    clock: z.strictObject({ startIso: z.string().min(1), stepSeconds: z.number().nonnegative() }),
    temperatures: z.strictObject({ buyer: z.number(), contestant: z.number() }),
    maxSteps: z.number().int().positive(),
    maxToolStepsPerTurn: z.number().int().positive(),
    flowEndingTools: z.array(z.string().min(1)),
    openingMessage: z.string().min(1),
    secondSession: secondSessionSchema.optional(),
    agentBrief: z.strictObject({ role: z.string().min(1), objectives: z.array(z.string()).min(1) }),
  })
  .superRefine((s, ctx) => {
    if (s.family === 'reengagement_24h' && s.secondSession === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['secondSession'],
        message: 'reengagement_24h scenarios must define the second session',
      });
    }
    if (s.family === 'compliance_trap' && s.activeTrapIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['activeTrapIds'],
        message: 'compliance_trap scenarios must arm at least one persona trap',
      });
    }
    if (s.family === 'hinglish_variant' && s.language !== 'hinglish') {
      ctx.addIssue({
        code: 'custom',
        path: ['language'],
        message: 'hinglish_variant scenarios must set language=hinglish',
      });
    }
    if (
      s.groundTruth.expectedOutcome === 'qualification_logged' &&
      !s.groundTruth.expectedLeadScore
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['groundTruth', 'expectedLeadScore'],
        message: 'a logged-qualification outcome must state the expected lead score',
      });
    }
    if (s.secondSession?.opener === 'buyer' && !s.secondSession.buyerReturnMessage) {
      ctx.addIssue({
        code: 'custom',
        path: ['secondSession', 'buyerReturnMessage'],
        message: 'a buyer-opened second session must provide the return message',
      });
    }
  });

export type ScenarioConfig = z.infer<typeof scenarioConfigSchema>;

/** Load and validate one scenario config; malformed configs crash at load. */
export function loadScenarioConfig(path: string): ScenarioConfig {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const result = scenarioConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Scenario config at ${path} failed validation:\n${issues}`);
  }
  return result.data;
}
