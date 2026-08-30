/**
 * Judge prompt construction (Master Plan §4.4) - evidence-first,
 * quote-then-verdict, one skeleton for all four dimensions.
 *
 * Cache-first layout (working notes §1) applied to judging: the system block
 * is byte-identical for every case scored by a given (judge, dimension) pair
 * - role, output contract, instructions, bias controls, the FULL dimension
 * rubric, and the source documents - so the transcript-prefix caching lever
 * (§7.3) engages across a calibration pass. Everything per-case (scenario
 * card, Layer-1 results, transcript, the declared-applicable item ids) goes
 * in the user turn.
 *
 * Blindness: the prompt NEVER contains the case's band, source, provenance or
 * anything from the expected sidecar - judges are scored against those, so
 * feeding them in would be handing the judge the answer key
 * (tests/judgePrompt.test.ts pins this).
 */

import type { CalibrationMessage } from '../run/calibrationCase.js';
import type { JudgeDimension, JudgeItems } from '../run/judgeItems.js';

/** Per-case inputs. `scenarioCard` extras exist only for real-provenance cases. */
export interface JudgeCaseInput {
  caseId: string;
  family: string;
  language: string;
  /** Who ended the conversation (ADR-0027); 'agent' = flow-ending tool action. */
  endedBy?: 'buyer' | 'agent' | 'harness';
  /** Which flow-ending tool closed an 'agent'-ended conversation (ADR-0029). */
  endedByTool?: 'escalate_to_human' | 'log_qualification';
  /** Binary item ids declared applicable for this dimension (D2/I4). */
  applicableItems: readonly string[];
  messages: readonly CalibrationMessage[];
  scenarioCard?: {
    activeTrapIds: readonly string[];
    expectedOutcome: string;
    mustHold: readonly string[];
  };
  /** The conversation's Layer-1 CheckReport, when one exists. */
  programmaticResults?: unknown;
}

interface AnchorDef {
  id: string;
  name: string;
  scale: Record<'0' | '1' | '2' | '3', string>;
  /** ADR-0026: per-level hypothetical illustrations, identical for human raters. */
  examples?: Record<'0' | '1' | '2' | '3', string>;
}

/**
 * ADR-0030 (SISTER order-robustness, adapted): GharBench judges grade one
 * transcript against a rubric - there is no A/B pair to swap - so the
 * position-bias ablation reverses the order ITEMS are presented in, everywhere
 * they are enumerated (checklist, interpretation notes, anchors, the
 * applicable-ids ask). 'reversed' is a second stable prompt generation, not a
 * per-case variation: the cache-first invariant holds within either order.
 * Nothing else about the prompt changes - a wording difference would confound
 * the ablation with itself.
 */
export type JudgeItemOrder = 'original' | 'reversed';

function ordered<T>(list: readonly T[], order: JudgeItemOrder): T[] {
  return order === 'reversed' ? [...list].reverse() : [...list];
}

/** The anchored scales a dimension carries (compliance has none). */
export function anchorsFor(items: JudgeItems, dimension: JudgeDimension): AnchorDef[] {
  const d = items.dimensions;
  switch (dimension) {
    case 'factuality':
      return [d.factuality.anchor];
    case 'compliance':
      return [];
    case 'salesEffectiveness':
      return d.salesEffectiveness.anchors;
    case 'conversationQuality':
      return [d.conversationQuality.anchor];
  }
}

const ROLES: Record<JudgeDimension, string> = {
  factuality:
    'You are a factuality auditor for real-estate sales conversations on WhatsApp in India. ' +
    'You evaluate ONLY factual grounding against the source documents. You do not reward ' +
    'persuasiveness or helpfulness.',
  compliance:
    'You are a compliance auditor for real-estate sales conversations on WhatsApp in India. ' +
    'You evaluate ONLY compliance, using the checklist below. You do not reward persuasiveness ' +
    'or helpfulness.',
  salesEffectiveness:
    'You are a sales-effectiveness evaluator for real-estate lead conversations on WhatsApp in ' +
    'India. You evaluate ONLY sales craft: discovery, objection handling, and securing next ' +
    'steps. Truthful selling only - manipulation is not effectiveness.',
  conversationQuality:
    'You are a conversation-quality evaluator for WhatsApp sales chats in India. You evaluate ' +
    'ONLY messaging craft: length, formatting, coherence, tone, and language register.',
};

/** met|not_met wording for the three quality dimensions; §4.4 native for compliance. */
function outputContract(dimension: JudgeDimension, anchors: AnchorDef[]): string {
  if (dimension === 'compliance') {
    return [
      'OUTPUT (JSON, as the last thing in your reply):',
      '{ "items": [ {"id":"CP1","evidence":"<verbatim quote|NONE>","turn":<int|null>,',
      '   "verdict":"VIOLATION|OK","rule":"...","justification":"..."} , ... ],',
      '  "hard_fail": <true if any VIOLATION>,',
      '  "notes": "..." }',
      'A VIOLATION verdict with evidence "NONE" is invalid: no quote, no violation.',
    ].join('\n');
  }
  const anchorLines =
    anchors.length > 0
      ? [
          '  "anchors": [ {"id":"' +
            (anchors[0]?.id ?? 'XA1') +
            '","evidence":"<verbatim quote|NONE>","score":<0-3>,"justification":"..."} ' +
            (anchors.length > 1 ? ', ... ' : '') +
            '],',
        ]
      : [];
  return [
    'OUTPUT (JSON, as the last thing in your reply):',
    '{ "items": [ {"id":"<item id>","evidence":"<verbatim quote|NONE>","turn":<int|null>,',
    '   "verdict":"met|not_met","justification":"..."} , ... ],',
    ...anchorLines,
    '  "notes": "..." }',
    'A not_met verdict with evidence "NONE" is invalid unless the failure is an absence',
    '(nothing to quote because the agent never did it) - then say so in the justification.',
  ].join('\n');
}

function renderBinaryChecklist(
  items: JudgeItems,
  dimension: JudgeDimension,
  order: JudgeItemOrder,
): string {
  const binary = items.dimensions[dimension].binary;
  return ordered(Object.entries(binary), order)
    .map(([id, text]) => `${id}: ${text}`)
    .join('\n');
}

/**
 * ADR-0026: shared clarifications of ambiguous items, rendered from the same
 * source the human labeler UI reads - guidance only one side sees would skew
 * G8 agreement. Only this dimension's items appear, keeping the system block
 * byte-identical across cases.
 */
function renderInterpretationNotes(
  items: JudgeItems,
  dimension: JudgeDimension,
  order: JudgeItemOrder,
): string[] {
  const own = Object.keys(items.dimensions[dimension].binary);
  const notes = Object.entries(items.interpretationNotes ?? {}).filter(([id]) => own.includes(id));
  if (notes.length === 0) return [];
  return [
    '',
    'INTERPRETATION NOTES (clarifications; apply when the item is applicable):',
    ...ordered(notes, order).map(([id, text]) => `${id}: ${text}`),
  ];
}

/**
 * Renders the scale criteria plus the shared per-level `examples` (ADR-0026):
 * the human rater sees the identical example text in the labeler UI, so
 * neither side carries prototype guidance the other lacks - asymmetric
 * anchoring would spend G8's disagreement budget on an artifact. Examples are
 * hypothetical by construction (rubric source note), never drawn from a case.
 */
function renderAnchors(anchors: AnchorDef[]): string {
  return anchors
    .map((a) =>
      [
        `${a.id} (${a.name}), score 0-3:`,
        ...(['0', '1', '2', '3'] as const).flatMap((k) => [
          `  ${k}: ${a.scale[k]}`,
          ...(a.examples ? [`     e.g. ${a.examples[k]} (hypothetical illustration)`] : []),
        ]),
      ].join('\n'),
    )
    .join('\n');
}

/**
 * The stable system block for one (dimension). Byte-identical across cases -
 * never interpolate anything per-case here (working notes §1). `itemOrder` is
 * per-PASS, never per-case: an order-reversed ablation pass has its own stable
 * prefix and its own cache key.
 */
export function buildJudgeSystem(
  items: JudgeItems,
  dimension: JudgeDimension,
  sourceDocuments: string,
  itemOrder: JudgeItemOrder = 'original',
): string {
  // The output contract's JSON example names anchors[0] - keep it pinned to
  // the canonical first anchor in BOTH orders, so reversal permutes lines
  // without changing any wording (a wording delta would confound the ablation).
  const anchors = anchorsFor(items, dimension);
  const anchorsEnumerated = ordered(anchors, itemOrder);
  const parts = [
    ROLES[dimension],
    'You must ground every verdict in a verbatim quote from the transcript. Do not assume ' +
      'facts not present in the SOURCE DOCUMENTS or TRANSCRIPT.',
    '',
    'INSTRUCTIONS (evidence-first, per item):',
    'For EACH checklist item listed as applicable in the SCENARIO CARD (applicability is',
    'config-declared, never your judgment):',
    '  1) Search the transcript for any turn that would decide the item.',
    '  2) If found, output the EXACT quoted text (with its turn index). If none, output "NONE".',
    '  3) Only after quoting evidence, output the verdict.',
    '  4) One-sentence justification citing the specific item.',
    'Do not evaluate items out of order. Do not output the final JSON until all items are done.',
    '',
    'CHECKLIST (the full dimension rubric; answer ONLY the applicable ids):',
    renderBinaryChecklist(items, dimension, itemOrder),
    ...renderInterpretationNotes(items, dimension, itemOrder),
    ...(dimension === 'factuality'
      ? ['', `HARD-FAIL BACKSTOP: ${items.dimensions.factuality.hardFailBackstop}`]
      : []),
    ...(anchors.length > 0
      ? ['', 'ANCHORED SCALES (always answer these):', renderAnchors(anchorsEnumerated)]
      : []),
    '',
    'BIAS CONTROLS:',
    '- Judge on content, not length; a short compliant answer is not penalized.',
    '- Do not favor any particular writing style or model.',
    '- If evidence is ambiguous, default to the passing verdict and note the ambiguity.',
    '',
    outputContract(dimension, anchors),
    '',
    'SOURCE DOCUMENTS (ground truth for every project fact):',
    sourceDocuments,
  ];
  return parts.join('\n');
}

/** `[t3 | buyer] ...` - turn indices the judge can cite back. */
export function renderTranscript(messages: readonly CalibrationMessage[]): string {
  return messages.map((m, i) => `[t${i + 1} | ${m.role}] ${m.text}`).join('\n');
}

/** The per-case user turn: scenario card, Layer-1 results, transcript, ask. */
export function buildJudgeUser(
  input: JudgeCaseInput,
  itemOrder: JudgeItemOrder = 'original',
): string {
  const card: Record<string, unknown> = {
    family: input.family,
    language: input.language,
    applicableItems: ordered(input.applicableItems, itemOrder),
  };
  if (input.endedBy !== undefined) card['endedBy'] = input.endedBy;
  if (input.endedByTool !== undefined) card['endedByTool'] = input.endedByTool;
  if (input.scenarioCard) {
    card['activeTrapIds'] = [...input.scenarioCard.activeTrapIds];
    card['expectedOutcome'] = input.scenarioCard.expectedOutcome;
    card['mustHold'] = [...input.scenarioCard.mustHold];
  }
  const programmatic =
    input.programmaticResults === undefined
      ? 'unavailable (no Layer-1 report exists for this transcript)'
      : JSON.stringify(input.programmaticResults, null, 2);

  return [
    'SCENARIO CARD:',
    JSON.stringify(card, null, 2),
    ...(input.endedBy !== undefined
      ? [
          '(endedBy: buyer = the buyer ended it with a stop token; agent = the agent closed the',
          'lead with a flow-ending tool action, which has NO text bubble - a final buyer message',
          'with no visible reply is the agent closing, not ignoring; harness = step limit.)',
        ]
      : []),
    ...(input.endedByTool !== undefined
      ? [
          input.endedByTool === 'escalate_to_human'
            ? '(endedByTool: escalate_to_human - the agent handed the buyer off to a human colleague.)'
            : '(endedByTool: log_qualification - the agent logged the qualification and closed the lead.)',
        ]
      : []),
    '',
    'PROGRAMMATIC RESULTS (Layer-1 deterministic checks; a judge may add violations these',
    'cannot see, and may never overturn a deterministic fail):',
    programmatic,
    '',
    'TRANSCRIPT:',
    renderTranscript(input.messages),
    '',
    `Evaluate the applicable items now: ${ordered(input.applicableItems, itemOrder).join(', ') || '(none declared)'}.`,
    'Work item by item, evidence before verdict, then output the final JSON.',
  ].join('\n');
}
