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
- **Amendment, 2026-10-14 (ADR-0037), recorded before any Phase 6 result.**
  SA1 now applies only where the scenario declares SE6, a config-time rule
  (I4). The amendment fixes how SalesScore reads that. Its anchor term is
  the mean over the sales anchors that apply to the conversation. Where SA1
  does not apply, SA2 alone forms the anchor term. The binary fraction
  alone is used only when no sales anchor applies. The 0.5/0.5 blend and
  every weight are unchanged.

  The literal frozen reading is reported as a sensitivity row beside the D1
  blend ablation. That reading is: any config-flagged inapplicable anchor
  makes SalesScore fall back to the binary fraction alone. Under the
  amendment, SA2's effective weight inside SalesScore rises from 0.25 to
  0.5 on scenarios that declare no objection. The paper states that shift.

## 7. Rubric revision log

Pre-registration freezes the composite weights (§4.3), the ablation set in
sections 1-4 and their thresholds. It does **not** freeze item wording: a
rubric that no two raters read the same way is a measurement fault, and
Master Plan §8/§11 pre-commit the response to one - rewrite the item text
below kappa 0.6, redesign the dimension below 0.4, and publish no score until
the floor is met.

**v2, 2026-09-21 (ADR-0033).** Trigger: the 2026-09-20 calibration pass put
G8a below 0.6 on every dimension (factuality 0.345, compliance 0.454,
salesEffectiveness 0.454, conversationQuality -0.003). Item wording was
clarified; weights, the ablation set and the thresholds were not touched.

Correction, 2026-10-14 (ADR-0036): the canonical v1 verdict set is the
2026-09-20 snapshot in the private overlay repo. It reproduces
conversationQuality at 0.024. The -0.003 above traces to no committed
agreement file.

**v3, 2026-10-14 (ADR-0037).**

_Trigger._ The v2 re-judge left G8a below 0.6 on every dimension:

|     | factuality | compliance | salesEffectiveness | conversationQuality | SA1   | QA1   |
| --- | ---------- | ---------- | ------------------ | ------------------- | ----- | ----- |
| G8a | 0.413      | 0.464      | 0.446              | 0.154               | 0.053 | 0.170 |

The pooled anchor order-flip rate was 0.280, again above 0.10.

_Diagnoses._

- SA1: the whole drop came from conversations with no buyer objection.
  There is no not-applicable rule, so raters invented a default. Judges
  moved that default from 3 to 0 once the surrounding SE notes changed.
- conversationQuality: CQ3 asked judges for checks they could not make, and
  CQ1 asked for a message shape the harness cannot produce.

_Changes._

- SA1 is asked only where the scenario declares SE6 (config-time). It has a
  shared no-objection rule and a concrete-next-step level 3, and SE6 has a
  matching note.
- CQ1 is judged by message shape.
- CQ3 is judged reply by reply against the documents and the sendable list.
  Whether a figure is true belongs to F1 and CP3, not CQ3.
- QA1 is always scored, with observable markers separating 2 from 3.

_Scope._ Only the salesEffectiveness and conversationQuality prompts
changed. The factuality and compliance prompts are byte-identical, pinned
by test, and their v2 verdicts carry forward under rule 4. The SalesScore
reading change is the section 6 amendment.

_Result, 2026-10-14._ These are the SE and CQ re-judge numbers, against
self labels not yet re-checked under v3:

|                     | v3 G8a | within-item null |
| ------------------- | ------ | ---------------- |
| salesEffectiveness  | 0.465  | 0.101            |
| conversationQuality | 0.361  | 0.052            |

Anchors (weighted kappa):

| anchor                  | v3                                            |
| ----------------------- | --------------------------------------------- |
| SA1, SE6-declared cases | 0.417 (v1 0.242, v2 0.153 on the same subset) |
| SA2                     | 0.487                                         |
| QA1                     | 0.193                                         |

Inter-judge alpha on the anchors is 0.586. Every dimension is still below
0.6. The pooled order-flip rates (SE 0.138, CQ 0.136, anchors 0.238) all
breach the 0.10 threshold, and the paper reports them as a breach.

Rules that hold for this and every future revision:

1. Every revision bumps the `version` field in `data/judge-items.json`. Each
   verdict, meta file and label file records the `itemsVersion` it was
   produced under, and the agreement readers refuse to mix two versions or
   two prompt hashes inside one (judge, dimension) pair.
2. Verdicts from the prior version are archived to a **sibling** folder
   (`calibration/archive/v<n>-<date>/`), never left inside
   `calibration/judgments/`, which the readers would otherwise load as an
   extra judge.
3. The paper reports every version's kappa set side by side (v1 canonical
   per ADR-0036, v2, v3, ...), with the trigger and the wording changes.
   Reporting only the revised number would make the published figure a
   best-of over rubric drafts, which is precisely what pre-registration
   exists to prevent.
4. Carry-forward (added 2026-10-14). A prior-version verdict may stay in
   `calibration/judgments/` only when its `promptSha` equals the current
   builder's `promptSha` for that dimension and item order. That equality
   must be proven by test, and the readers enforce it. Otherwise rule 2
   applies.

**Disclosed breach.** The anchor exact-score order-flip rate in the 2026-09-20
pass was 0.254, above the 0.10 threshold set in section 1, driven by SA2 and
QA1. QA1's text is left **unchanged** in v2 pending CQ1 and CQ3
re-validation: QA1 scores the register of replies whose content CQ1 and CQ3
now judge differently, so re-anchoring it before those settle would tune two
coupled items against a single run. The breach is reported in the paper
whatever the v2 re-run shows.

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
