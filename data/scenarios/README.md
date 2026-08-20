# Scenarios - public split

One JSON file per **persona-bound scenario instance**, named `<baseId>.<personaId>.json`
and validated by `scenarioConfigSchema` (`src/engine/scenario.ts`). The base id
(`scn_cold_001`) identifies the situation; the suffix binds the persona whose
ground truth the file states exactly. The held-out ~30% lives in
`private-pool/scenarios/` and never enters git (G16).

Every file declares the Phase 1 gate fields: a deterministic ground-truth
outcome, `mustHold` truth statements, the applicable L1 check ids, and the
per-judge item applicability sets. `pnpm gate:phase1` machine-checks the whole
set; `tests/scenarioSet.test.ts` cross-validates references on every test run.

## Family x persona eligibility (Master Plan 3.7 bundles)

| Family                | Natural-fit personas    | Authored instances           |
| --------------------- | ----------------------- | ---------------------------- |
| cold_inquiry          | P01, P02, P09, P08      | P01, P09 (+P02 private)      |
| deep_factual          | P02, P06, P11, P12      | P12, P06, P02 (+P12 private) |
| budget_mismatch       | P04, P08, P05, P03      | P08, P04                     |
| compliance_trap       | P03, P04, P05, P10, P11 | P11, P03, P10 (+P05 private) |
| site_visit_scheduling | P01, P03, P06, P07      | P01, P07 (+P06 private)      |
| reengagement_24h      | P06, P09, P03           | P09 (+P06 private)           |
| hinglish_variant      | P01, P03, P08, P09      | P08                          |

## Authoring status vs targets (Master Plan 3.4, I9)

- Base situations: **14 of 60-80** (across both splits).
- Instances: **19 of ~150-250** (14 public, 5 private = 26% private vs ~30% target).
- I9 floors (**instances** per family, counted at sampling time): >=20 per
  family, >=30 Hinglish - not yet met; `pnpm gate:phase1` reports the live
  numbers.

Conventions for new scenarios:

- Unique `seed` per file; `dbVersion` must match the corpus.
- Armed `activeTrapIds` must exist on the bound persona's card.
- Ground-truth statements reference exact corpus facts (unit ids, prices,
  slots) - the tests re-derive corpus numbers, so a corpus change that breaks
  a scenario's premise surfaces immediately.
- Tag the private split at authoring time; a scenario moved public later is a
  copy, a scenario moved private later is a leak.
