# ADR-0030 — SISTER work order: judge-robustness machinery, clustered CIs, canary, release hygiene

Date: 2026-08-28
Status: accepted

## Context

A research pass (claude.ai session "new benchmark params", 2026-08-28) compared
GharBench against best-in-class benchmark practice (SISTER, LitBench,
WritingBench, tau-bench, HAL, PoLL, LiveBench, NeurIPS D&B 2025/2026 rules)
and produced a work order. Its headline: the judge ablations must be wired in
BEFORE the paid Phase 6 run (retrofitting order-robustness after ~5,300 judged
conversations means paying for judging twice), and the cheap release-hygiene
items (CITATION.cff, canary, licence split) close real reviewer expectations
now. Several practices trace to SISTER (github.com/solusops/SISTER), whose
Zenodo records were verified against the live API on 2026-08-28: software
10.5281/zenodo.21951541 and dataset 10.5281/zenodo.21954790, both v0.1.0,
2026-08-15; the dataset record lists Anshuman Singh as sole creator; no
arXiv/venue publication of the SISTER paper exists yet.

## Decision

1. **Item-order ablation, not pairwise order-swap.** GharBench judges grade
   one transcript against a rubric - no A/B pair exists - so MT-Bench's
   response-order swap is adapted to reversing ITEM presentation order:
   `--item-order=reversed` on the judge runner, verdicts in a separate
   `judgments-reversed/` dir, each order its own stable cache prefix, the two
   prompts test-pinned to be line-permutations (no wording delta). Flip rate is
   the metric. Protocol + pre-set thresholds in `docs/judge-protocol.md`.
2. **Ablation machinery built now, run later** (`src/metrics/judgeAblations.ts`,
   pure + tested): order flip rate, self-preference deltas (with the
   `familyOverlap` guard - today's panel is contestant-disjoint by design, so
   deltas report "unmeasurable", never a fake unbiased 0), leave-one-judge-out
   ranking stability, length-bias correlation.
3. **Clustered bootstrap in TS, not the Python bridge** (deviation from the
   work order): `clusteredBootstrapMeanCi` joins the existing seeded
   xorshift32 bootstrap in `src/metrics/ci.ts`, because its consumers
   (composite/leaderboard reports) are TS and the stats-bridge rule is scoped
   to agreement statistics. Fewer than two clusters returns null.
4. **Contamination canary**: optional `canary` field on the scenario schema;
   `pnpm canary:stamp` stamps the BIG-bench sentence with a FRESH GUID (the
   BIG-bench GUID is memorised by frontier models - burned) into all 45
   private-pool files; the GUID lives only in `private-pool/CANARY.md` (+
   gbpriv backup), never tracked. Invariant with teeth: no prompt builder
   reads the field - a canary sent to a provider could enter training and fire
   the recall probe without a real leak (tests/canary.test.ts pins agent,
   buyer and judge surfaces; the private-pool stamp check runs only where the
   pool exists).
5. **Evidence-first audit: recorded as already implemented.** The work order
   flagged SISTER's audit-before-preference as missing; the existing judge is
   quote-then-verdict per item with no holistic preference score, which IS
   that discipline. No redundant second pass built; the paper claims it.
6. **Release hygiene**: CITATION.cff (concept DOI added at Phase 10);
   MIT/CC BY 4.0 code/data licence split (LICENSE-DATA); CHANGELOG.md seeded;
   README Citing section + SISTER attribution.
7. **Paper stubs as markdown, not LaTeX** (deviation): Phase 9 deliberately
   has no paper scaffold, so `paper/` holds only `refs.bib` (verified SISTER
   entries + canonical origins: Zheng/MT-Bench, Wang 2024, Verga/PoLL,
   Panickssery, tau/tau2, BIG-bench, Gebru datasheets, Gwet AC1, Davison &
   Hinkley) and two markdown stubs. The acknowledgment naming Anshuman Singh
   is PERMISSION-GATED - email first, publish the name only on a written yes;
   citing the DOIs needs no permission.
8. **Deferred, pre-registered**: Holm correction, effect-size reporting and
   Gwet AC1 land in the Phase 8 analysis layer; Croissant + RAI metadata,
   datasheet, ethics/annotator-pay reporting and leaderboard ops policy are
   Phase 10 items - Croissant is a NeurIPS D&B submission GATE (mandatory
   since 2025, RAI fields 2026), not a nicety.

## Consequences

Reversed-order and self-preference reporting are now a config flag plus a pure
function over stored verdicts - the Phase 6 budget covers them by emitting
nothing extra. The primary judging path is byte-unchanged (default
itemOrder='original' is test-pinned identical), so existing prompt shas and
any stored verdicts stay valid. The private pool's leak detector exists before
any public data release does. Composite/leaderboard CIs must switch to the
clustered utility when Phase 8 wires reports (naive CIs on K-trial data are
too narrow - that switch is the point). If SISTER publishes to a venue, swap
the @misc citation; if a judge family ever overlaps a contestant family, the
self-preference table and the recusal thresholds in docs/judge-protocol.md
are mandatory.
