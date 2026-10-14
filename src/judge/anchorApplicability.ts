/**
 * Which anchored scales a conversation is asked to score (ADR-0037).
 *
 * An anchor with `appliesWithItem` is asked only where the scenario declares
 * that binary item for the same dimension (config-time, Master Plan I4/D2);
 * every other anchor is always asked. This is the single rule the judge
 * prompt, the output parser, the labeler and the scoring code share, so the
 * human and the judges are never asked different questions.
 */

import type { JudgeDimension, JudgeItems } from '../run/judgeItems.js';

type RubricAnchor = JudgeItems['dimensions']['salesEffectiveness']['anchors'][number];

/** The rubric's anchors for a dimension, in rubric order (compliance has none). */
export function rubricAnchors(items: JudgeItems, dimension: JudgeDimension): RubricAnchor[] {
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

export function isAnchorApplicable(
  anchor: { appliesWithItem?: string | undefined },
  applicability: readonly string[],
): boolean {
  return anchor.appliesWithItem === undefined || applicability.includes(anchor.appliesWithItem);
}

/** Anchor ids to ask for this dimension, in rubric order. */
export function applicableAnchorIds(
  items: JudgeItems,
  dimension: JudgeDimension,
  applicability: readonly string[],
): string[] {
  return rubricAnchors(items, dimension)
    .filter((a) => isAnchorApplicable(a, applicability))
    .map((a) => a.id);
}

/** True when some anchor of the dimension is conditional (renders the SE variant). */
export function hasConditionalAnchor(items: JudgeItems, dimension: JudgeDimension): boolean {
  return rubricAnchors(items, dimension).some((a) => a.appliesWithItem !== undefined);
}
