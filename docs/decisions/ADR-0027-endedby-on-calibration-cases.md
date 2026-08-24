# ADR-0027 — Every calibration case records who ended the conversation

Status: Accepted
Date: 2026-08-24

Tags: calibration, judge, rubric, schema

## Context

A rater hit a transcript that ends with a buyer question and no reply and
could not tell whether the agent went silent or the conversation was closed.
The answer was invisible by construction: an agent flow-ending tool action
(`log_qualification` / `escalate_to_human`) has no text bubble, so in the
buyer-view projection an agent close looks identical to the agent ignoring
the buyer. This is the exact misread behind both false criticals in the G6
pilot audit (ADR-0021) — and it turns out to affect **60 of the 136
calibration cases** (44%): 69 end by buyer stop token, 60 by agent tool
close, 7 by step limit.

## Decision

1. **`CalibrationCase` gains a required `endedBy: 'buyer' | 'agent' |
   'harness'`** (error terminations never become cases). Populated by
   `calibrationBuild` and `humanSample` from the record's
   `terminationReason` via the same mapping the G6 audit uses
   (`terminationSource`, now exported); authored per-seed for the 18
   synthetic cases with values consistent with each ending. The 118
   existing real cases were migrated from their source-run transcripts
   (118/118 matched, 0 problems).
2. **Both raters and judges see it** (ADR-0026 symmetry): the labeler shows
   an "ended by" chip (with a guide bullet: an agent tool-close has no
   bubble — a final buyer message with no visible reply is the agent
   closing the lead, not ignoring it; whether closing there was good
   judgment is still scored); the judge user turn carries `endedBy` in the
   scenario card plus a fixed explainer line, in calibration and run modes
   alike.

## Consequences

- "Did the agent ignore the buyer's last question?" is now decidable:
  ended-by-agent means the reply was a tool action; ended-by-harness means
  the cut-off is the harness's fault, not the agent's; ended-by-buyer means
  the buyer walked. What each implies for CQ3/SE5 remains the rater's call.
- The judge prompt user turn grows slightly; no judgments existed, so
  nothing breaks. Schema is required, so any future case builder that
  forgets the field fails validation loudly.
- Phase 7 samples inherit the field and the chip automatically.

Linked: ADR-0021, ADR-0026.
