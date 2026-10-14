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
/**
 * Tolerant numeric coercion for fields whose MEANING is unambiguous when a
 * judge formats them as text: a turn written "t4" or "4" is turn 4, a score
 * written "2" is 2. Observed live 2026-09-20 (ADR-0032 addendum): Maverick
 * emitted numeric strings on ~4% of calls and lost the verdict to a type
 * error, which is a formatting failure, not a judgment failure. Anything
 * that is not a plain integer after coercion still fails as before.
 */
const coerceInt = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  const m = /^\s*t?(-?\d+)\s*$/i.exec(v);
  return m ? Number(m[1]) : v;
};
const TURN = z.preprocess(coerceInt, z.number().int().positive().nullable());
const SCORE = z.preprocess(coerceInt, z.number().int().min(0).max(3));

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

// `turn` is accepted and ignored on anchors: judges mirror the item shape and
// add it (11% of Mistral Medium 3.5 replies, 2026-09-20). It carries no
// meaning for a whole-conversation score, so tolerating it is not a
// contract change; every other unknown key still fails strict parsing.
const anchorScoreSchema = z.strictObject({
  id: ITEM_ID,
  evidence: EVIDENCE,
  score: SCORE,
  turn: TURN.optional(),
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
  /**
   * Advisory sub-signal of `evidenceFound === false`: the "quote" reads like
   * meta-commentary about the conversation ("The entire conversation flow")
   * rather than a mangled quotation of it - too short to locate, or sharing no
   * word of length >=4 with the transcript. ADR-0019 keeps the evidence check
   * advisory only (adjudication catches fabricated quotes), so this NEVER
   * turns into a schema_violation or a retry; it is a counter for the paper's
   * judge-format analysis. Optional because verdicts written before rubric v2
   * carry no such field - `parseJudgeOutput` always sets it.
   */
  evidenceMeta?: boolean;
  justification: string;
  rule?: string;
}

export interface JudgeAnchorVerdict {
  id: string;
  score: number;
  evidence: string;
  evidenceFound: boolean | null;
  /** See `JudgeItemVerdict.evidenceMeta` - advisory, never fatal. */
  evidenceMeta?: boolean;
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

/**
 * Evidence grounding is a substring test after normalisation. Two things a
 * judge does to a verbatim quote must not count against it (measured
 * 2026-09-20, ADR-0032 addendum: 640 of Grok's 659 "not found" quotes were
 * exact lines carrying the transcript's own `[tN | role]` prefix):
 *   - an attribution wrapper copied from the rendered transcript
 *     (`[t4 | agent] ...`, `t4: ...`) or surrounding quote marks;
 *   - typographic glyphs (curly quotes, en/em dashes, non-breaking spaces)
 *     that a model normalises one way and the transcript another.
 * Paraphrase, truncation with ellipsis and meta-commentary still fail, which
 * is the point of the metric.
 */
const unifyGlyphs = (s: string): string =>
  s
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u00a0/g, ' ');
const stripAttribution = (s: string): string =>
  s
    .trim()
    .replace(/^\[t\d+\s*\|\s*[a-z]+\]\s*/i, '')
    .replace(/^t\d+\s*[:|]\s*/i, '')
    .replace(/^["'\u2018\u2019\u201c\u201d]+|["'\u2018\u2019\u201c\u201d]+$/g, '');
const normalise = (s: string): string => unifyGlyphs(s).replace(/\s+/g, ' ').trim().toLowerCase();

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
  const needle = normalise(stripAttribution(evidence));
  if (needle.length === 0) return false;
  return normalise(transcript).includes(needle);
}

/** Alphanumeric words long enough to be a content word rather than glue. */
const contentTokens = (normalised: string): string[] => normalised.match(/[a-z0-9]{4,}/g) ?? [];

/**
 * Distinguishes the two ways a quote fails to ground, because they mean
 * opposite things about the judge: a near-miss (re-spaced, truncated, slightly
 * paraphrased) still points AT a real line, while meta-commentary points at
 * nothing and the verdict behind it rests on no quotation at all. Soft flag by
 * construction - see `JudgeItemVerdict.evidenceMeta`.
 */
function isEvidenceMeta(evidence: string, transcript: string, found: boolean | null): boolean {
  if (found !== false) return false;
  const needle = normalise(stripAttribution(evidence));
  if (needle.length < 12) return true;
  const haystack = new Set(contentTokens(normalise(transcript)));
  return !contentTokens(needle).some((t) => haystack.has(t));
}

/** Both advisory evidence signals for one quote, computed once. */
function evidenceFlags(
  evidence: string,
  transcript: string,
): { evidenceFound: boolean | null; evidenceMeta: boolean } {
  const evidenceFound = findEvidence(evidence, transcript);
  return { evidenceFound, evidenceMeta: isEvidenceMeta(evidence, transcript, evidenceFound) };
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
          ...evidenceFlags(i.evidence, transcript),
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
        ...evidenceFlags(i.evidence, transcript),
      })),
      anchors: (parsed.data.anchors ?? []).map(({ turn: _ignoredTurn, ...a }) => ({
        ...a,
        ...evidenceFlags(a.evidence, transcript),
      })),
      notes: parsed.data.notes,
    },
  };
}
