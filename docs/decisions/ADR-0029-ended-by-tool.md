# ADR-0029 — Agent-ended cases carry the closing tool; the answer key shows the agent's full capability surface

Status: Accepted
Date: 2026-08-27

Tags: calibration, judge, labeler, blindness, rubric

## Context

ADR-0027 put `endedBy` on every case so a tool-close (which has no text
bubble) is not misread as the agent ignoring the buyer. But "agent" was
still ambiguous between two closes that mean opposite things:
`log_qualification` (lead logged and closed) vs `escalate_to_human`
(handed to a human colleague). SE5 counts an accepted handoff as a
concrete next step; CP10 requires escalation for out-of-scope advice — a
rater or judge who cannot tell which close happened is guessing on both.

Separately, a rater labeling a real case hit two questions the reference
panel could not answer: "the agent says it _held two units for viewing_ —
does such a facility even exist?" and "it says it _shared additional NOCs_
— shared what, exactly?" Tool calls are invisible in the transcript by
design (buyer view), so the only honest way to judge such claims is
against what is _possible_: the tool roster and the sendable-asset list —
neither of which was on screen.

## Decision

1. **`endedByTool` on every agent-ended case** — required exactly when
   `endedBy === 'agent'` (schema-enforced via superRefine), derived from
   the last successful flow-ending tool result in the transcript
   (`closingTool` in calibrationBuild, shared by calibrationBuild,
   judgeRun run-mode, and humanSample). Shown to raters (chip: "escalated
   to human" / "logged & closed the lead") and judges (scenario-card field
   plus a one-line explainer) alike — same symmetry as ADR-0027.
   Backfilled across all 119 cases: 53 agent-ended (44 escalate, 6 log
   from real sweeps; 3 authored log_qualification seeds). Not tool-trace
   enrichment: ADR-0025's exclusion of Layer-1/mid-conversation tool data
   stands — the closing action is termination metadata, present uniformly
   on every agent-ended case whatever its source.
2. **The reference panel shows the agent's complete capability surface**
   (ADR-0023 extension): the six-tool roster (READ/WRITE, which two end
   the chat, descriptions from TOOL_SPECS so it cannot drift) and the
   17-asset sendable list, with the operative rules stated inline — no
   hold/reserve facility exists; `send_asset` can send exactly the listed
   assets; a claimed action with no possible tool behind it is
   unsupported. Environment ground truth, identical for every case: no
   blindness impact. The human key remains at-least-as-informed as the
   judges (the ADR-0023 posture); judges continue to judge fabricated
   claims against the SOURCE DOCUMENTS (e.g. the approvals note's "any
   approval not listed here is not held").

## Consequences

- Mid-conversation tool truth (was a booking really made?) remains
  Layer-1's job (L1 checks, deterministic); raters/judges keep the
  start-of-conversation caveat and the tie option for state that can
  legitimately change mid-chat. Slot _existence_ and facility _existence_
  cannot change mid-chat and need no tie.
- Distribution note for the paper: 44 of 50 real agent closes in the
  calibration set are escalations, not logged qualifications.
- Case files changed by exactly one added line each (verified against the
  private repo diff); ids, messages and applicability untouched, so the
  10 existing labels and the rater's alias order are unaffected.

Linked: ADR-0023, ADR-0025, ADR-0026, ADR-0027.
