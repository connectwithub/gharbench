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

function renderBinaryChecklist(items: JudgeItems, dimension: JudgeDimension): string {
  const binary = items.dimensions[dimension].binary;
  return Object.entries(binary)
    .map(([id, text]) => `${id}: ${text}`)
    .join('\n');
}

function renderAnchors(anchors: AnchorDef[]): string {
  return anchors
    .map((a) =>
      [
        `${a.id} (${a.name}), score 0-3:`,
        ...(['0', '1', '2', '3'] as const).map((k) => `  ${k}: ${a.scale[k]}`),
      ].join('\n'),
    )
    .join('\n');
}

/**
 * The stable system block for one (dimension). Byte-identical across cases -
 * never interpolate anything per-case here (working notes §1).
 */
export function buildJudgeSystem(
  items: JudgeItems,
  dimension: JudgeDimension,
  sourceDocuments: string,
): string {
  const anchors = anchorsFor(items, dimension);
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
    renderBinaryChecklist(items, dimension),
    ...(dimension === 'factuality'
      ? ['', `HARD-FAIL BACKSTOP: ${items.dimensions.factuality.hardFailBackstop}`]
      : []),
    ...(anchors.length > 0 ? ['', 'ANCHORED SCALES (always answer these):', renderAnchors(anchors)] : []),
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
export function buildJudgeUser(input: JudgeCaseInput): string {
  const card: Record<string, unknown> = {
    family: input.family,
    language: input.language,
    applicableItems: [...input.applicableItems],
  };
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
    '',
    'PROGRAMMATIC RESULTS (Layer-1 deterministic checks; a judge may add violations these',
    'cannot see, and may never overturn a deterministic fail):',
    programmatic,
    '',
    'TRANSCRIPT:',
    renderTranscript(input.messages),
    '',
    `Evaluate the applicable items now: ${input.applicableItems.join(', ') || '(none declared)'}.`,
    'Work item by item, evidence before verdict, then output the final JSON.',
  ].join('\n');
}
