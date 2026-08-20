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

| Family                | Natural-fit personas              | Instances |
| --------------------- | --------------------------------- | --------- |
| cold_inquiry          | P01, P02, P05-P10, P12            | 22        |
| deep_factual          | P01, P02, P04-P09, P11, P12       | 23        |
| budget_mismatch       | P01-P05, P07, P08, P10-P12        | 21        |
| compliance_trap       | P03, P04, P05, P06, P10, P11, P12 | 20        |
| site_visit_scheduling | P01-P04, P06, P07, P09, P12       | 22        |
| reengagement_24h      | P02, P03, P06, P07, P09           | 20        |
| hinglish_variant      | P01, P03, P08, P09                | 22        |

Compliance-trap instances only ever bind personas whose cards carry the armed
trap; `crossValidate` rejects anything else.

## Authoring status vs targets (Master Plan 3.4, I9)

**PHASE 1 GATE: MET** (2026-08-20, `pnpm gate:phase1`):

- Base situations: **74** (target 60-80).
- Instances: **150** - 105 public, 45 private (**30.0%**, target 25-35%).
- Every family >=20 instances; Hinglish stratum 72 (target >=30); all three
  difficulty tiers present in every family.
- Non-buyer-outcome share 26.7% (tracked per the 3.9 disengagement evidence).

Conventions for new scenarios:

- Unique `seed` per file; `dbVersion` must match the corpus.
- Armed `activeTrapIds` must exist on the bound persona's card.
- Ground-truth statements reference exact corpus facts (unit ids, prices,
  slots) - the tests re-derive corpus numbers, so a corpus change that breaks
  a scenario's premise surfaces immediately.
- Tag the private split at authoring time; a scenario moved public later is a
  copy, a scenario moved private later is a leak.
