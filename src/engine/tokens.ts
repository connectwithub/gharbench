/**
 * Termination tokens emitted by the buyer simulator.
 *
 * Exact strings, matched anywhere in the buyer's message. The token is stripped
 * from the logged surface text (a human reading the transcript should see a
 * natural conversation) but recorded as the structured termination reason.
 *
 * TODO(attribution): the buyer-simulator *guidelines text* that instructs a
 * model when to emit these tokens is to be lifted verbatim from
 * sierra-research/tau2-bench (pin a tag >= v1.0.1) in Phase 1, with attribution
 * to Yao et al. (arXiv:2406.12045) and Barres et al. (arXiv:2506.07982).
 * If a vendored copy exists it lives under docs/tau2-attribution/. The token
 * strings and the orchestrator below are a clean-room reimplementation of the
 * tau^2-bench half-duplex pattern, not a copy of its code.
 */

export const TERMINATION_TOKENS = ['###STOP###', '###TRANSFER###', '###OUT-OF-SCOPE###'] as const;

export type TerminationToken = (typeof TERMINATION_TOKENS)[number];

export interface TokenScan {
  /** First token present in the raw message, by character position. */
  token: TerminationToken | null;
  /** Surface text with every token occurrence removed and whitespace tidied. */
  text: string;
}

/**
 * Scan a raw buyer message for termination tokens.
 *
 * Matching is exact-substring and case-sensitive: a buyer who merely *talks
 * about* stopping has not terminated, only one who emits the literal token.
 */
export function scanTerminationTokens(raw: string): TokenScan {
  let firstToken: TerminationToken | null = null;
  let firstIndex = Number.POSITIVE_INFINITY;

  for (const token of TERMINATION_TOKENS) {
    const index = raw.indexOf(token);
    if (index !== -1 && index < firstIndex) {
      firstIndex = index;
      firstToken = token;
    }
  }

  let text = raw;
  if (firstToken !== null) {
    for (const token of TERMINATION_TOKENS) {
      text = text.split(token).join('');
    }
  }

  return { token: firstToken, text: tidy(text) };
}

/** Collapse the whitespace a stripped token leaves behind, without reflowing. */
function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trimEnd())
    .join('\n')
    .trim();
}

export function isTerminationToken(value: string): value is TerminationToken {
  return (TERMINATION_TOKENS as readonly string[]).includes(value);
}
