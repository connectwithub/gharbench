/**
 * The calibration case: one transcript a human labels against the judge
 * rubric (Master Plan §4.5). Cases live in calibration/ (gitignored - the
 * labels are the answer key judge validation is scored against; see
 * .gitignore rationale). Reference labels and seeded expectations are
 * sidecars, never fields of the case itself, so the labeling UI can show a
 * case without showing the answer.
 */

import { z } from 'zod';
import { join } from 'node:path';
import { REPO_ROOT } from './scenarioSet.js';

export const CALIBRATION_DIR = join(REPO_ROOT, 'calibration');
export const CASES_DIR = join(CALIBRATION_DIR, 'cases');
export const EXPECTED_DIR = join(CALIBRATION_DIR, 'expected');
export const LABELS_SELF_DIR = join(CALIBRATION_DIR, 'labels', 'self');

const JUDGE_ITEM_ID = z.string().regex(/^[A-Z]{1,2}\d{1,2}$/);

export const calibrationMessageSchema = z.strictObject({
  role: z.enum(['buyer', 'agent', 'system']),
  text: z.string().min(1),
});

export const calibrationCaseSchema = z
  .strictObject({
    caseId: z.string().regex(/^cal_[a-z0-9_.-]+$/),
    /** Where the transcript came from. */
    source: z.enum(['synthetic', 'real', 'adversarial']),
    /** §4.5 stratification band. Synthetic anchors pin the extremes. */
    band: z.enum(['known_fail', 'borderline', 'known_pass']),
    family: z.enum([
      'cold_inquiry',
      'deep_factual',
      'budget_mismatch',
      'compliance_trap',
      'site_visit_scheduling',
      'reengagement_24h',
      'hinglish_variant',
    ]),
    language: z.enum(['english', 'hinglish']),
    /**
     * Who ended the conversation. 'agent' means a flow-ending tool action
     * (log_qualification / escalate_to_human), which has NO text bubble - so a
     * final buyer message with no visible reply is the agent closing the lead,
     * not ignoring the buyer. Both raters and judges see this (ADR-0027);
     * error terminations never become cases.
     */
    endedBy: z.enum(['buyer', 'agent', 'harness']),
    /**
     * The flow-ending tool behind an 'agent' close (ADR-0029), present exactly
     * when endedBy === 'agent'. The two closes read identically in the
     * transcript (neither has a bubble) but mean opposite things for e.g.
     * SE5/CP10: log_qualification = the agent logged the lead and closed;
     * escalate_to_human = the agent handed the buyer to a human colleague.
     * Both raters and judges see it.
     */
    endedByTool: z.enum(['escalate_to_human', 'log_qualification']).optional(),
    /** For real cases: the scenario instance and run they were sampled from. */
    provenance: z
      .strictObject({
        runId: z.string(),
        conversationId: z.string(),
        scenarioId: z.string(),
        contestantRef: z.string(),
      })
      .optional(),
    /** The binary items the labeler (and later the judges) must answer. */
    judgeApplicability: z.strictObject({
      factuality: z.array(JUDGE_ITEM_ID),
      compliance: z.array(JUDGE_ITEM_ID),
      salesEffectiveness: z.array(JUDGE_ITEM_ID),
      conversationQuality: z.array(JUDGE_ITEM_ID),
    }),
    messages: z.array(calibrationMessageSchema).min(2),
  })
  .superRefine((c, ctx) => {
    if ((c.endedBy === 'agent') !== (c.endedByTool !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: "endedByTool must be present exactly when endedBy === 'agent' (ADR-0029)",
      });
    }
  });

export type CalibrationCase = z.infer<typeof calibrationCaseSchema>;
export type CalibrationMessage = z.infer<typeof calibrationMessageSchema>;

/**
 * The seeded ground truth for synthetic/adversarial cases: which items the
 * authored transcript violates (or that it violates none). Used to measure
 * judge sensitivity/specificity at the extremes - never shown in the
 * labeling UI.
 */
export const calibrationExpectedSchema = z.strictObject({
  caseId: z.string(),
  violatedItems: z.array(JUDGE_ITEM_ID),
  /**
   * Items whose TEXT also covers the seeded violation (one act, two item
   * wordings - e.g. an under-declared price is CP11 and equally a misleading
   * price statement, CP3). Precision-only: these are NOT scored for recall,
   * `violatedItems` stays the sole authority there (ADR-0025), but a judge
   * that flags one is right, not wrong, so `compliancePrf` excludes the flag
   * from the false-positive count instead of penalising the panel for the
   * key being under-specified.
   */
  alsoCovered: z.array(JUDGE_ITEM_ID).optional(),
  notes: z.string().min(1),
});

export type CalibrationExpected = z.infer<typeof calibrationExpectedSchema>;

/** One human's labels for one case. Ties are first-class (§4.5: never force). */
export const calibrationLabelSchema = z.strictObject({
  caseId: z.string(),
  rater: z.string().min(1),
  labeledAt: z.string().min(1),
  /** Binary items: met / not_met / tie (cannot decide). Keyed by item id. */
  binary: z.record(JUDGE_ITEM_ID, z.enum(['met', 'not_met', 'tie'])),
  /** Anchored 0-3 scales, keyed by anchor id (FA1, SA1, SA2, QA1); -1 = tie. */
  anchors: z.record(JUDGE_ITEM_ID, z.number().int().min(-1).max(3)),
  note: z.string().optional(),
  /**
   * `data/judge-items.json` `version` the rater answered under. Optional so
   * labels saved before rubric v2 still load: a human label is an answer to a
   * specific questionnaire, and comparing it against verdicts produced under a
   * different one is the silent way an agreement statistic goes wrong.
   */
  itemsVersion: z.string().min(1).optional(),
});

export type CalibrationLabel = z.infer<typeof calibrationLabelSchema>;
