/**
 * The machine-readable judge rubric (Master Plan §4.2), loaded and validated.
 *
 * Scenario configs declare binary-item applicability per dimension (D2/I4);
 * the anchored 0-3 scales are cross-family and apply by default. This module
 * is the single source the calibration labeler (Phase 4) and the judge
 * prompts (Phase 5) both read, so the human labels and the judge questions
 * can never drift apart.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { REPO_ROOT } from './scenarioSet.js';

const anchorSchema = z.strictObject({
  id: z.string().regex(/^[A-Z]{1,2}\d{1,2}$/),
  name: z.string().min(1),
  scale: z.strictObject({ 0: z.string(), 1: z.string(), 2: z.string(), 3: z.string() }),
});

const binaryMap = z.record(z.string().regex(/^[A-Z]{1,2}\d{1,2}$/), z.string().min(1));

export const judgeItemsSchema = z.strictObject({
  version: z.string().min(1),
  source: z.string().min(1),
  dimensions: z.strictObject({
    factuality: z.strictObject({
      name: z.string(),
      aggregation: z.string(),
      binary: binaryMap,
      anchor: anchorSchema,
      hardFailBackstop: z.string(),
    }),
    compliance: z.strictObject({
      name: z.string(),
      aggregation: z.string(),
      evidenceRule: z.string(),
      binary: binaryMap,
    }),
    salesEffectiveness: z.strictObject({
      name: z.string(),
      aggregation: z.string(),
      binary: binaryMap,
      anchors: z.array(anchorSchema).min(1),
    }),
    conversationQuality: z.strictObject({
      name: z.string(),
      aggregation: z.string(),
      binary: binaryMap,
      anchor: anchorSchema,
    }),
  }),
});

export type JudgeItems = z.infer<typeof judgeItemsSchema>;
export type JudgeDimension = keyof JudgeItems['dimensions'];

export function loadJudgeItems(): JudgeItems {
  const raw: unknown = JSON.parse(
    readFileSync(join(REPO_ROOT, 'data', 'judge-items.json'), 'utf8'),
  );
  const parsed = judgeItemsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`data/judge-items.json failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Every binary item id, per dimension - what scenario configs may declare. */
export function binaryItemIds(items: JudgeItems): Record<JudgeDimension, ReadonlySet<string>> {
  const d = items.dimensions;
  return {
    factuality: new Set(Object.keys(d.factuality.binary)),
    compliance: new Set(Object.keys(d.compliance.binary)),
    salesEffectiveness: new Set(Object.keys(d.salesEffectiveness.binary)),
    conversationQuality: new Set(Object.keys(d.conversationQuality.binary)),
  };
}
