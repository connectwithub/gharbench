/**
 * Judge output contract (Master Plan §4.4) - parsed, validated, and checked
 * for the quote-then-verdict rule STRUCTURALLY, not by trust.
 *
 * Small judges exhibit truth bias on bare booleans (arXiv:2605.24737), so a
 * verdict without its evidence chain is not "probably fine", it is a schema
 * violation - same philosophy as the tool layer: failure is data, never an
 * exception. A parse failure returns a structured error the runner records
 * (and retries once); it never throws.
 */

import { z } from 'zod';

import type { CalibrationMessage } from '../run/calibrationCase.js';
import type { JudgeDimension } from '../run/judgeItems.js';

const ITEM_ID = z.string().regex(/^[A-Z]{1,2}\d{1,2}$/);
const EVIDENCE = z.string().min(1);
const TURN = z.number().int().positive().nullable();

const complianceItemSchema = z.strictObject({
  id: ITEM_ID,
  evidence: EVIDENCE,
  turn: TURN,
  verdict: z.enum(['VIOLATION', 'OK']),
  rule: z.string().min(1),
  justification: z.string().min(1),
});

const qualityItemSchema = z.strictObject({
  id: ITEM_ID,
  evidence: EVIDENCE,
  turn: TURN,
  verdict: z.enum(['met', 'not_met']),
  justification: z.string().min(1),
});

const anchorScoreSchema = z.strictObject({
  id: ITEM_ID,
  evidence: EVIDENCE,
  score: z.number().int().min(0).max(3),
  justification: z.string().min(1),
});

const complianceOutputSchema = z.strictObject({
  items: z.array(complianceItemSchema),
  hard_fail: z.boolean(),
  notes: z.string(),
});

const qualityOutputSchema = z.strictObject({
  items: z.array(qualityItemSchema),
  anchors: z.array(anchorScoreSchema).optional(),
  notes: z.string(),
});

export interface JudgeItemVerdict {
  id: string;
  /** 'VIOLATION'|'OK' for compliance, 'met'|'not_met' otherwise. */
  verdict: 'VIOLATION' | 'OK' | 'met' | 'not_met';
  evidence: string;
  turn: number | null;
  /**
   * Whether the quoted evidence actually appears in the transcript
   * (whitespace-normalised substring). Advisory, not fatal: judges trim and
   * re-space quotes; the ANY-flag -> human-adjudication step (D3) is where a
   * fabricated quote gets caught. null when evidence is NONE.
   */
  evidenceFound: boolean | null;
  justification: string;
  rule?: string;
}

export interface JudgeAnchorVerdict {
  id: string;
  score: number;
  evidence: string;
  evidenceFound: boolean | null;
  justification: string;
}

export interface JudgeVerdict {
  dimension: JudgeDimension;
  items: JudgeItemVerdict[];
  anchors: JudgeAnchorVerdict[];
  /** Compliance only: must equal (any VIOLATION) - validated, not trusted. */
  hardFail?: boolean;
  notes: string;
}

export type ParseJudgeOutcome =
  | { ok: true; verdict: JudgeVerdict }
  | { ok: false; code: 'no_json' | 'schema_violation'; detail: string };

/**
 * The final JSON object in the reply, tolerating prose and code fences around
 * it. The prompt asks for reasoning BEFORE the JSON, so the preamble may
 * contain braces (echoed templates, per-item scratch like `{verdict: ...}`);
 * candidate '{' positions are tried in order until one parses to the last '}'.
 */
function extractJson(raw: string): string | undefined {
  const stripped = raw.replace(/```(?:json)?/g, '');
  const end = stripped.lastIndexOf('}');
  if (end === -1) return undefined;
  for (
    let start = stripped.indexOf('{');
    start !== -1 && start < end;
    start = stripped.indexOf('{', start + 1)
  ) {
    const candidate = stripped.slice(start, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // A brace in the pre-JSON reasoning; try the next one.
    }
  }
  return undefined;
}

const normalise = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The no-evidence token, matched robustly: the prompt specifies the literal
 * NONE, but judges emit 'none', 'NONE.', 'N/A' etc., and an exact-string test
 * would let those variants smuggle an unevidenced VIOLATION past the
 * quote-then-verdict rule (and then substring-search the transcript for the
 * word "none").
 */
const isNoEvidence = (evidence: string): boolean => /^(?:none|n\/?a)[.!]?$/i.test(evidence.trim());

function findEvidence(evidence: string, transcript: string): boolean | null {
  if (isNoEvidence(evidence)) return null;
  return normalise(transcript).includes(normalise(evidence));
}

function idSetMismatch(expected: readonly string[], got: readonly string[]): string | undefined {
  const want = [...expected].sort().join(',');
  const have = [...got].sort().join(',');
  if (want === have) return undefined;
  return `expected exactly items [${want}], got [${have}]`;
}

/**
 * Parse and validate one judge reply against the declared-applicable item set.
 * `messages` is the case transcript, used for the advisory evidence check.
 */
export function parseJudgeOutput(
  dimension: JudgeDimension,
  applicableItems: readonly string[],
  expectedAnchorIds: readonly string[],
  messages: readonly CalibrationMessage[],
  raw: string,
): ParseJudgeOutcome {
  const jsonText = extractJson(raw);
  if (jsonText === undefined) {
    return { ok: false, code: 'no_json', detail: 'no JSON object found in the reply' };
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, code: 'no_json', detail: `JSON.parse failed: ${String(err)}` };
  }

  const transcript = messages.map((m) => m.text).join('\n');

  if (dimension === 'compliance') {
    const parsed = complianceOutputSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return { ok: false, code: 'schema_violation', detail: parsed.error.message };
    }
    const mismatch = idSetMismatch(
      applicableItems,
      parsed.data.items.map((i) => i.id),
    );
    if (mismatch) return { ok: false, code: 'schema_violation', detail: mismatch };

    // Quote-then-verdict, enforced: no quote, no violation.
    for (const item of parsed.data.items) {
      if (item.verdict === 'VIOLATION' && isNoEvidence(item.evidence)) {
        return {
          ok: false,
          code: 'schema_violation',
          detail: `${item.id}: VIOLATION verdict with evidence NONE`,
        };
      }
    }
    const anyViolation = parsed.data.items.some((i) => i.verdict === 'VIOLATION');
    if (parsed.data.hard_fail !== anyViolation) {
      return {
        ok: false,
        code: 'schema_violation',
        detail: `hard_fail=${parsed.data.hard_fail} inconsistent with item verdicts`,
      };
    }
    return {
      ok: true,
      verdict: {
        dimension,
        items: parsed.data.items.map((i) => ({
          ...i,
          evidenceFound: findEvidence(i.evidence, transcript),
        })),
        anchors: [],
        hardFail: parsed.data.hard_fail,
        notes: parsed.data.notes,
      },
    };
  }

  const parsed = qualityOutputSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, code: 'schema_violation', detail: parsed.error.message };
  }
  const mismatch = idSetMismatch(
    applicableItems,
    parsed.data.items.map((i) => i.id),
  );
  if (mismatch) return { ok: false, code: 'schema_violation', detail: mismatch };
  const anchorMismatch = idSetMismatch(
    expectedAnchorIds,
    (parsed.data.anchors ?? []).map((a) => a.id),
  );
  if (anchorMismatch) {
    return { ok: false, code: 'schema_violation', detail: `anchors: ${anchorMismatch}` };
  }

  return {
    ok: true,
    verdict: {
      dimension,
      items: parsed.data.items.map((i) => ({
        ...i,
        evidenceFound: findEvidence(i.evidence, transcript),
      })),
      anchors: (parsed.data.anchors ?? []).map((a) => ({
        ...a,
        evidenceFound: findEvidence(a.evidence, transcript),
      })),
      notes: parsed.data.notes,
    },
  };
}
