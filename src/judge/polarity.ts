/**
 * Item polarity normalisation - the one place where "met" is turned into
 * "good" or "bad".
 *
 * The rubric's binary items are worded in two polarities. CP items describe a
 * VIOLATION CONDITION ("Super-built-up presented as carpet area"), so a
 * labeler clicking "Met" is saying the violation happened. F/SE/CQ items
 * describe a good criterion ("All project claims supported by source docs"),
 * so "Met" is the pass. The judge output mirrors §4.4: compliance verdicts
 * are VIOLATION|OK, the other dimensions met|not_met.
 *
 * Agreement statistics compare humans to judges on the SAME scale, so both
 * sides normalise through this module to a single boolean: `pass` = the
 * conversation is good on this item. A polarity mistake here would not crash
 * anything - it would silently invert every kappa - which is why this lives
 * in one file with pointed tests rather than inline at each call site.
 */

/** CP items are violation-worded; everything else is criterion-worded. */
export function isViolationWorded(itemId: string): boolean {
  return itemId.startsWith('CP');
}

/** A human label ('met' | 'not_met') -> pass. Ties never reach this. */
export function labelToPass(itemId: string, label: 'met' | 'not_met'): boolean {
  return isViolationWorded(itemId) ? label === 'not_met' : label === 'met';
}

/** A compliance judge verdict -> pass. */
export function complianceVerdictToPass(verdict: 'VIOLATION' | 'OK'): boolean {
  return verdict === 'OK';
}

/** A quality-dimension judge verdict -> pass. */
export function qualityVerdictToPass(verdict: 'met' | 'not_met'): boolean {
  return verdict === 'met';
}

/** An expected-sidecar entry -> pass (violatedItems lists the fails). */
export function expectedToPass(itemId: string, violatedItems: readonly string[]): boolean {
  return !violatedItems.includes(itemId);
}
