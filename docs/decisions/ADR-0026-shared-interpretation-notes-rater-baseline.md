# ADR-0026 — Shared rubric interpretation notes; disclosed rater-baseline adjudication

Status: Accepted
Date: 2026-08-24

Tags: calibration, judge, rubric, process

## Context

Labeling the first calibration case surfaced a genuine rubric ambiguity:
how to score SE5 ("secured a concrete next step") when the buyer ends the
conversation. Answering the rater in chat creates guidance the judges never
see — asymmetric information that would skew the G8 human-vs-judge
agreement measurement in an unmeasurable direction. Separately, the rater
asked for feedback on their first saved label to establish a personal
baseline before the remaining 135 — useful for consistency, but
answer-feedback mid-labeling risks contaminating the blind protocol.

## Decision

1. **Interpretation notes live in the rubric file and render to both
   sides.** `data/judge-items.json` (now 1.1.0) gains an
   `interpretationNotes` map — GharBench-authored clarifications, clearly
   separated from the §4.2-verbatim item text. The labeler UI shows a note
   under its item; `buildJudgeSystem` renders the same text in the owning
   dimension's system block. One source, test-pinned on both surfaces.
   First note: SE5's buyer-ended-conversation rule (buyer closing is not
   itself a failure; judge the best step secured or cleanly attempted;
   graceful close of a non-advancing buyer counts; walk-away handling
   quality belongs to SA2).
2. **One disclosed baseline adjudication.** The rater's first saved case
   was reviewed by the harness assistant as a second reader — reading
   formed from the transcript and the gold DB, feedback framed as
   evidence-cited agreement/divergence, generalizable rules extracted. The
   discussion is recorded in `calibration/protocol-notes.md` so Phase 5
   analysis can flag or sensitivity-check that case. No case metadata
   (band/source/provenance) was revealed to the rater; the saved answers
   remain the rater's own, as does any post-discussion revision.

## Consequences

- Future rubric ambiguities get resolved by adding a note to the shared
  map, never by chat-only guidance — the asymmetry hazard is structural
  now.
- The judge system prompt grows slightly; no judgments existed, so no
  prompt-sha continuity is broken. The labeler server must be restarted to
  serve a rubric change (it loads once at startup).
- Exactly one of 136 cases carries an assisted-baseline flag; disclosed,
  bounded, and available to drop in a sensitivity check.

Linked: ADR-0022, ADR-0023, ADR-0025.
