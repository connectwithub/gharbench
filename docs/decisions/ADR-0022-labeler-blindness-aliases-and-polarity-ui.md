# ADR-0022 — Calibration labeler hardened: opaque case aliases and violation-polarity buttons

Status: Accepted
Date: 2026-08-24

Tags: calibration, judge, blindness, ui, process

## Context

The first labeling sitting stalled immediately: the UI showed rubric items
with no statement of the goal ("what am I judging, and against what?").
Reviewing the tool to fix the copy surfaced two defects that mattered more
than the copy:

1. **Case ids leak provenance.** Ids follow `cal_syn_pass_*` / `cal_adv_*` /
   `cal_real_<contestant>_<scenario>`, and the sidebar displayed them. A
   rater reading `syn_pass` has been handed the expected answer for a
   synthetic anchor; a contestant name primes brand priors on real cases.
   That voids the §4.5 blind design the answer key depends on. (Zero labels
   existed at discovery, so nothing was collected under the leak.)
2. **CP polarity hazard.** Compliance items are violation-worded, and the
   stored `met` means "the violation happened" (`src/judge/polarity.ts`) —
   but the button said "Met" in pass-green. A rater reading Met = complied
   would silently invert every compliance label; agreement stats would not
   catch it, only degrade.

## Decision

1. **The rater-facing API speaks positional aliases only** ("c017" = the
   rater's 17th case in their deterministic shuffle; stable across
   sittings). `redactCase` drops `caseId` alongside band/source/provenance;
   existing labels are returned as answers only; saving posts the alias and
   the server maps it back. Label files are still written under real ids, so
   downstream tooling (gate:phase4, judge:agreement) is untouched and no
   migration is needed. Threat model: anti-priming for cooperative raters,
   not anti-adversary — the case files sit on the same disk.
2. **CP items render in their true polarity**: "Violation — happened" (red
   when selected) / "No violation" (green) / "Can't decide". Stored values
   are unchanged (`met`/`not_met`); `polarity.ts` remains the single flip
   point. Statement items (F/SE/CQ) keep Met / Not met.
3. **The UI states the task**: an instructions panel (who is being graded,
   why the labels matter, tie semantics, evidence-by-turn convention),
   judge-aligned `tN` numbers on every bubble, and a one-line subtitle per
   dimension. This is the ADR-0021 rater-affordance lesson applied to the
   labeling tool; the Phase 7 human-validation flow inherits it for free
   (same server, `--dir`).

All three are pinned in `tests/calibrationLabeler.test.ts`.

## Consequences

- Blindness now holds end to end at the API surface, not just for the
  metadata fields — consistent with the Phase 6 design where
  `mapping.json` is the only bridge and is never served.
- Colleague raters need no separate polarity briefing; the screen says it.
- Fetching a case by its real id returns 404; only aliases resolve.

Linked: ADR-0018 (calibration-set design), ADR-0019 (judge scaffolding),
ADR-0021 (G6 audit affordances).
