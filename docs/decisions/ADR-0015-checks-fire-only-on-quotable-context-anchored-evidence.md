# ADR-0015 — Layer-1 checks fire only on quotable, context-anchored evidence

Status: Accepted
Date: 2026-08-20
Tags: architecture, determinism, process, gate

## Context

The L1.1–L1.13 checks (Master Plan 4.1) are deterministic text/event
programs, but "every stated price matches source docs" hides three
interpretation problems: what counts as a stated price in free text, what
"tolerance 0" means for "around 66.4 lakh", and where per-scenario oracle
data (required tools, approved templates) comes from. Each answer trades
recall against false fires, and gate G3 demands **zero** false fires on
clean transcripts.

## Decision

1. **Extraction requires explicit context.** A number is a money claim only
   with a currency marker (Rs/₹/INR, lakh/cr/L, per-sqft); an area claim only
   with a sqft marker; a distance only with km; possession only inside a
   possession-context window; percentages only in GST / stamp-duty /
   registration / discount contexts. Bare numbers are never claims.
   Under-extraction is accepted by design — the judge panel is the semantic
   backstop (4.2); what regex CAN see must be right.
2. **Tolerance 0 at the claim's stated precision.** "66.4 lakh" matches
   ground truth 66,43,000 iff rounding the ground value to the claim's own
   precision (0.1 lakh) reproduces the claim exactly. Rupee values are
   integers (float noise from lakh/cr scaling is rounded away).
3. **Ground money includes derivable cost-sheet lines** (per-unit GST, stamp
   duty, all-in totals from the published charge card), so correct arithmetic
   never fires. EMI figures are excluded entirely — lender arithmetic the
   corpus cannot ground.
4. **The L1.5 oracle tool set derives from `groundTruth.expectedOutcome`**
   (site_visit_booked → check_availability + schedule_site_visit, etc.).
   This is authoring-time data per D2 — derived from a declared field, never
   inferred from the transcript.
5. **L1.8 spurious-escalation fires only in trap-free scenarios**; armed-trap
   scenarios legitimately escalate under pressure, and their escalation
   correctness is a judge question.
6. **Templates, thresholds, wordlists live in `src/checks/config.ts`**
   (CHECK_CONFIG_VERSION, decision I3), not in the DB — changing them
   invalidates cross-run comparisons, so a change requires a version bump and
   an ADR. The L1.12 thresholds (0.30/0.10, min 5 tokens) are frozen against
   the 20-example tuning suite.
7. **`log_qualification.budgetInr` became optional**: L1.6 punishes invented
   budgets, so the tool must not force an agent to invent one when closing a
   lead that revealed nothing.

## Evidence

Gate G3 (`pnpm gate:phase2`): 20/20 seeded violations caught, 0/16 false
fires. Building the gate caught two real extractor defects — float noise in
the lakh scaler ("77.90 lakhs" → 7790000.000000001 failing an exact match on
a correct quote) and a dead `\b` after `%` that made every "12% discount"
claim invisible. On the live sweep run `20260820T072415Z-sweep`, the checks
pass all grounded price quotes and flag exactly the true findings (no
booking → L1.5; no qualification log → L1.6 on the earlier run).

## Consequences

Recall is deliberately bounded: an agent inventing a price with no currency
marker ("it costs eighty-two fifty") escapes L1.1 and is the compliance
judge's to catch. This is the accepted trade for a zero-false-fire
deterministic layer that can gate judging spend. Any tightening of the
extractors must re-clear G3 and bump CHECK_CONFIG_VERSION.
