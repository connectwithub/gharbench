# ADR-0020 — Phases 6–10 scaffolded machine-first: every gate is code before any run is paid for

Status: Accepted
Date: 2026-08-20
Tags: evaluation, scoring, gate, architecture, process

## Context

After the Phase 5 judge scaffold (ADR-0019), the remaining phases split
cleanly into machine work (run rules, judging runs, composite scoring,
monitoring gates, sampling, the leakage audit) and human work (labeling,
rater recruitment, deviation audits, paper writing). Building all machine
parts now — before any main-run spend — means every §11 gate exists as an
executable check with honest UNMET floors, and the paid phases become "run
the command" rather than "write the tooling under cost pressure". Decisions
made along the way:

1. **D5 lives in the sweep, not a new runner.** `--trials-rule=d5` gives
   per-family n=5/n=3; `pnpm matrix` is a pure planner/pre-flight (I1/I9
   floors, §6.1 family separation vs buyer AND judges, list-price estimate)
   that never spends money.
2. **I9's Hinglish floor is read as the FAMILY floor (≥30 hinglish_variant
   instances), not the language stratum.** Master Plan §3.4 calls Hinglish
   "an n=5 family", D5 keys on family, and Phase 7 samples ≥30 per n=5
   family — the family reading is the consistent one. `gate:phase1` used the
   softer language-stratum reading (§ the 150-instance set has 22
   hinglish_variant instances but 75 hinglish-language ones), so the matrix
   planner reports this floor honestly UNMET: +8 hinglish_variant instances
   need authoring before the paper matrix.
3. **Judging runs reuses the calibration judging machinery** (one
   `Judgeable` shape, two loaders). The §4.1 gating rule is enforced at load:
   hard-fail-gated conversations never reach a judge (measured on the pilot:
   1/20 gated, its judging cost saved).
4. **§4.3 is implemented literally as pure functions** (D1 blend + 0.67/0.33
   ablation, D2 declared denominators, V1–V6, w_F sweep with proportional
   renormalisation, V5 with the I11 0.01 tolerance, D4 with threshold
   sensitivity, D6 macro/micro, D7 ROBUST vs non-separable). The G15 clause —
   synthetic sub-scores → expected pass/fail → expected pass^k — is a CI
   fixture.
5. **Agreement statistics stay in stats-bridge; counting stays in TS.**
   Wilson is closed-form (golden-tested against its exact x=0/x=n
   derivations); the bootstrap uses a seeded xorshift32 — the no-Math.random
   rule's purpose is reproducibility, and a seeded resampler satisfies the
   purpose, not just the letter.
6. **Phase 7 reuses the Phase 4 labeling stack.** The ~200-conversation
   sample is written as blind calibration-shaped cases (`cal_hv_NNNN`, no
   contestant identity, no provenance); mapping.json is the only bridge back
   and is never served. The label server gained `--dir=`; the 50-case slice
   restriction stays calibration-only (Phase 7 is three raters over the whole
   sample). `human-validation/` is gitignored with the same G16 reasoning as
   calibration/.
7. **G16 is a mechanical audit, not a checklist item.** `pnpm gate:leakage`
   proves no private-pool path was ever tracked and no private scenarioId
   appears in any tracked file at any commit (first real audit, 2026-08-20:
   45 ids × 58 commits, clean). The id scan is the tripwire; the release
   checklist still reviews few-shot files and prompts by hand.
8. **Phase 9 gets no scaffold.** It is paper writing; the §9.2 outline lives
   in the Master Plan and the analysis artifacts are the leaderboard JSON.

## Consequences

- The paid path to the paper is now: author +8 Hinglish instances → verify
  judge refs/prices at smoke → `sweep --trials-rule=d5` per contestant →
  `judge:run` → `gate:phase6` → `leaderboard` → `sample:human` → three raters
  label → `gate:phase7` → `gate:leakage` before release.
- The leaderboard refuses to hide missing coverage: non-gated conversations
  without judgments are counted as coverage debt, never silently scored.
- G13 variance flags name the instances to raise K on — the remedy is
  per-instance, never global.

Linked: ADR-0007 (gates state what they prove), ADR-0013 (price table),
ADR-0016 (routing pins), ADR-0019 (judge scaffold).
