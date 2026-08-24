# ADR-0024 — Pre-run pipeline hardening: contestant-aware check reports and gate completeness floors

Status: Accepted
Date: 2026-08-24

Tags: evaluation, scoring, gate, checks, process

## Context

Before spending on the paid phases, a high-effort code review of the whole
runbook surface (`src/run`, `src/judge`, `src/metrics`) plus a runtime audit
(every stage command executed offline against empty state and the pilot run)
surfaced ten confirmed defects. The worst: check reports were keyed by
`conversationId` alone, and `conversationId` is only `scenario#trial` —
identical across contestants — so in any multi-contestant sweep every
contestant would have been scored, hard-fail-gated, judged and banded
against the LAST contestant's Layer-1 report. Others in the same class: a
conversation missing from `checks.jsonl` scored programmatically perfect
and could never be gated; a single surviving judge verdict was recorded as
a scored 0.0 composite instead of coverage debt; `--max-usd` parsed to NaN
disabled the budget cap silently; `evidence: "none"` smuggled unevidenced
VIOLATIONs past the quote-then-verdict guard; gate:phase6 could print MET
with its variance floor never evaluated (ADR-0007 violation).

## Decision

1. **Check reports are contestant-aware.** `CheckReport` gains a required
   `contestantId`; the new `src/run/checkReports.ts` `CheckReportIndex` is
   the single reader (judgeRun, leaderboard, calibrationBuild, humanSample),
   normalising `contestant:` prefixes and `@Host` pins. A legacy
   multi-contestant `checks.jsonl` without the field **fails loudly** with
   "regenerate with `pnpm checks --run=<id>`" — mis-attribution is never
   silent. Unambiguous single-contestant legacy files (the pilot) still load.
2. **Coverage debt is always loud.** Leaderboard statuses now include
   `unchecked` (no Layer-1 report) and `unjudged` (no usable panel blend);
   neither is ever folded into a numeric score; the panel minimum is 2
   usable verdicts per dimension. gate:phase6 counts `unchecked` as
   not-computable; gate:phase7 gains a "panel coverage complete" floor so
   G8/G9 denominators include gated conversations.
3. **Every gate floor is pushed on every code path** (a gate that cannot
   fail is an ADR-0007 violation): G13 on the empty-scored path, phase-4
   completeness against the 50-slice denominator for non-self raters,
   matrix floors iterate the full family enum so a zero-instance family
   fails.
4. **Money and evidence guards hardened**: `--max-usd` NaN-validated in
   sweep and judgeRun (with a warning that unpriced judges bill $0 against
   the cap); both attempts of a retried conversation merge into
   `costs.json`; the no-evidence predicate accepts NONE/none/N/A variants
   at both schema and judge sites; seeded-bootstrap divisor and percentile
   indexing corrected in `metrics/ci.ts` (≤1-sample CI shifts, no goldens
   pinned them); the labeler's alias→case map is frozen at startup so a
   concurrent rebuild can never redirect a saved label.

## Consequences

- Multi-contestant sweeps (the whole Phase 6 design) now attribute Layer-1
  results, gating, judgments and bands to the right contestant — this class
  of error would have invalidated the leaderboard invisibly.
- Old multi-contestant runs must re-run `pnpm checks --run=<id>` before
  scoring; the calibration sweeps predate the field and will need that.
- Two review findings are **flagged, not fixed** (measurement design, not
  code): the judge prompt's shape differs visibly between synthetic and
  real calibration cases (no scenario card / "PROGRAMMATIC RESULTS
  unavailable" — a tell on exactly the seeded-recall measurement), and
  conduct-only `judgeApplicability` lists identify 4 of 8 synthetic
  known-fails. Both need a decision before `pnpm judge:calibration` runs.

Linked: ADR-0007, ADR-0016, ADR-0019, ADR-0020, ADR-0022.
