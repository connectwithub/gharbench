# ADR-0025 — Calibration judging: uniform prompt shape and no conduct-only item lists

Status: Accepted
Date: 2026-08-24

Tags: calibration, judge, blindness, prompt

## Context

Two flagged findings from the ADR-0024 review, both making seeded cases
distinguishable exactly where judge sensitivity is measured:

1. **Prompt shape**: calibration judging enriched real-provenance cases with
   a scenario card (mustHold, expectedOutcome, traps) and Layer-1 results,
   while the 18 seeded cases got neither — every seeded prompt visibly read
   "no scenario card + PROGRAMMATIC RESULTS unavailable", a 100%-accurate
   tell on the seeded-recall (G9-analog) measurement.
2. **Item-list composition**: 4 of 8 synthetic known-fails carried
   conduct-only compliance lists (CP5 / CP7 / CP8 / CP10+CP11 alone) — a
   composition occurring in 0 of the 118 real cases, visible to both the
   human rater and the judge.

## Decision

1. **One uniform minimal prompt shape for every calibration case**
   (`toCalibrationJudgeable` in judgeRun): no scenario card, no Layer-1
   results, regardless of provenance. Chosen over the alternative
   (fabricating cards + Layer-1 stubs for seeded cases) because it requires
   no fabricated deterministic-check output, and because it matches the
   human labeler's information set — transcript, rubric, source documents —
   which is the right basis for a G8 human-vs-judge agreement comparison.
   Run-mode judging keeps card + Layer-1: every run conversation has both,
   so that shape is uniform too, and richer context at deployment can only
   help. Calibration therefore validates judges at their conservative lower
   bound.
2. **No seeded case may carry a conduct-only compliance list.** Every seed's
   list now includes at least one doc-verifiable item (CP1–CP4, CP6, CP9),
   drawn to resemble real compositions (e.g. no_rera is now CP1+CP3, a
   composition 4 real cases share). Added items are expected-pass —
   `violatedItems` is unchanged and remains the authority. Both rules are
   test-pinned (calibrationSeed + judgePrompt tests).

## Consequences

- Cases regenerated (`pnpm calibration:seed`); ids unchanged, slice-50
  intact, expected sidecars consistent, 0 labels existed — nothing
  invalidated. Verified post-change: 0 conduct-only lists across all 136
  cases.
- Judges answer a few more items on 7 seeded cases (specificity data on
  real-looking pass items — a small bonus, slight cost increase).
- **Honest residual**: CP7 and CP8 still occur only in seeded cases — no
  calibration-sweep scenario armed steering/PII traps. Judges are stateless
  per call, so a single prompt no longer carries a usable tell; but an
  item-level correlation exists in the corpus. If Phase 6 scenarios with
  armed CP7/CP8 traps enter a future calibration refresh, it disappears.
- The dry-run cost estimate rises marginally with the longer item lists.

Linked: ADR-0018, ADR-0019, ADR-0024.
