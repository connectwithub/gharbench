# Judge robustness protocol (ADR-0030)

Pre-registered BEFORE the paid Phase 6 run, so every ablation reads verdicts
the main pass already emits and none requires judging twice. Sources: SISTER
(Zenodo 10.5281/zenodo.21951541 / 21954790) for the reversed-order and
audit-discipline practices; Zheng et al. 2023 (MT-Bench) and Wang et al. 2024
for position bias; Panickssery et al. 2024 for self-preference; Verga et al.
2024 (PoLL) for panel robustness; `paper/refs.bib` has the full entries.

## 1. Order robustness (position bias, adapted)

GharBench judges grade ONE transcript against a rubric - there is no A/B pair
to swap, so MT-Bench's response-order swap does not apply literally. The
analog is **item-presentation order**: `--item-order=reversed` on
`pnpm judge:calibration` / `pnpm judge:run` re-emits every judgment with the
checklist, interpretation notes, anchors and the applicable-ids ask presented
in reversed order, and NOTHING else changed (test-pinned: the two prompts are
line-permutations of each other). Verdicts land in `judgments-reversed/`
alongside the primary `judgments/`; each order is its own stable cache prefix.

- **Metric**: per-item flip rate (`orderFlipRate` in
  `src/metrics/judgeAblations.ts`) - the share of (case, dimension, item)
  triples where the same judge changes verdict under reversal.
- **Where it runs**: the calibration slice at Phase 5 (cheap, certifies the
  panel before the main run) and a deterministic ~10% subsample at Phase 6.
- **Pre-set threshold**: flip rate ≤ 0.10 per dimension. Above it, the
  dimension's rubric is revised and re-validated before headline claims; the
  flip rate is reported in the paper either way.

## 2. Self-preference

The panel is family-disjoint from every contestant AND the buyer by design
(`src/judge/panel.ts`), so today every same-family cell is empty - the table
must say "unmeasurable by construction", never "unbiased".
`familyOverlap()` is the guard: run it against the contestant lineup before
every judged sweep; a non-empty overlap (e.g. a Llama-family contestant
meeting the Maverick judge) makes the `selfPreferenceDeltas()` table
mandatory in the report.

- **Pre-set threshold**: if a judge's same-family delta exceeds **0.25 on the
  0-3 anchor scale** (or flips any binary item rate by >10 points), that judge
  is recused or down-weighted for that family, and the change is documented in
  the run's meta.

## 3. Leave-one-judge-out

`leaveOneJudgeOut()` recomputes the contestant ranking dropping each panelist
in turn. Report the three drop-rankings next to the full-panel ranking with
discordant-pair counts. A ranking that survives every drop is the claim "no
single judge is holding up the leaderboard"; one that does not survive names
exactly which comparisons are judge-fragile (mark those pairs non-ROBUST in
the D7 sense).

## 4. Length bias

`lengthBiasCorrelation()` - Pearson + Spearman of judge score vs total agent
output length, per dimension, over the judged run. Report the correlations;
if |rho| > 0.4 on SE or CQ, publish the length-controlled companion ranking
(scores residualised on length, or a length-stratified table) alongside raw.

## 5. Evidence-first audit (status: already implemented)

SISTER's "audit every atomic constraint before a preference" is the existing
GharBench judge contract, not a gap: quote-then-verdict per item is a schema
rule (a VIOLATION with evidence NONE is a schema_violation with one retry;
`src/judge/prompt.ts`, `src/judge/schema.ts`), items are answered in checklist
order before the final JSON, and there is no holistic preference score
anywhere. The paper claims this explicitly and credits the convergent design.

## 6. Statistical reporting plan (locked before the main run)

- **CIs**: scenario-clustered bootstrap (`clusteredBootstrapMeanCi`,
  `src/metrics/ci.ts` - trials within a scenario are correlated; naive CIs are
  too narrow) for composite and per-dimension means; Wilson for proportions;
  both seeded/deterministic.
- **Effect sizes**: every headline pairwise comparison carries the score delta
  with its clustered-bootstrap CI, not a bare p-value.
- **Multiple comparisons**: Holm correction across the contestant x dimension
  grid of headline tests, named in the paper (implemented at Phase 8 in the
  analysis layer).
- **Agreement on rare events**: compliance hard-fails are low-prevalence, so
  kappa is unstable there - the compliance dimension additionally reports
  Gwet's AC1 plus raw base rates (stats-bridge, Phase 7/8; agreement stats
  stay in Python per repo convention).
- **Pre-registration**: composite weights (§4.3), the ablation set above and
  these thresholds are fixed as of 2026-08-28 - post-hoc weight tuning is out.

## Runbook

```sh
# Phase 5 (calibration certification):
pnpm judge:calibration --cases=slice                      # primary
pnpm judge:calibration --cases=slice --item-order=reversed
# -> orderFlipRate over the two judgment dirs

# Phase 6 (main run): primary pass as planned, then
pnpm judge:run --run=<runId> --item-order=reversed --case=<...10% sample...>

# Before any judged sweep:
# familyOverlap(JUDGE_PANEL families, contestant families) must be [] or the
# self-preference table is mandatory.
```
