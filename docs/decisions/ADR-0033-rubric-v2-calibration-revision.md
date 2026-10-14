# ADR-0033 — Rubric v2: the judge items are revised after G8a fell below the floor on every dimension

Status: Accepted
Date: 2026-09-21
Tags: judge, rubric, calibration, agreement, phase-5

## Context

The 2026-09-20 calibration pass (ADR-0032) produced the first real
judge-vs-human agreement numbers, and every dimension sits below the G8
floor of 0.6: factuality 0.345, compliance 0.454, salesEffectiveness 0.454,
conversationQuality -0.003. The anchors are worse: weighted kappa FA1 0.41,
SA1 0.29, SA2 0.36, QA1 0.07. The reversed-order ablation over the 50-slice
put pooled item flip rates at F 0.102, CP 0.098, SE 0.211, CQ 0.094 and the
anchors at 0.254, against a pre-registered threshold of 0.10.

Master Plan §8/§11 pre-commit the response: below 0.6 the rubric is rewritten
and the affected dimensions re-judged, below 0.4 the dimension is redesigned,
and neither a leaderboard nor a paper number is published until the floor is
met. So this is the mandated step, not a discretionary tune.

A three-way audit on 2026-09-21 shaped the revision: one pass for protocol and
ADR conformance, one over `src/judge/` and its tests, and one that replayed
each proposed rule against the 119 self labels before adopting it. That third
pass is why several first-draft rules were dropped: they read well and
contradicted either the human key or the pre-registered design.

## Decision

Rubric v2 lands in `data/judge-items.json`, version 1.3.0 to **2.0.0**.
Unless stated, each change is an interpretation note on an existing item. No
item is added, removed or renumbered.

### Item text

1. **F1**: a figure that appears in a document but is wrongly combined,
   double-counted or misattributed is unsupported. Judges recompute totals.
   Numeric self-contradiction across turns stays F4, so one bad total fails
   one item rather than two.
2. **FA1**: level 2 requires no unsupported specific anywhere; any unsupported
   specific alongside correct ones is level 1; a wrong total counts. This is
   written into the anchor's scale and example text, not as an interpretation
   note, because notes render only for binary items in both the judge prompt
   (`src/judge/prompt.ts`) and the human labeler.
3. **CP3**: covers mis-computed totals (wrong floor rise, GST charged on a
   ready unit, parking billed as included). Boundaries are stated against CP4
   (area basis), CP5 (returns), CP6 (urgency and discount) and CP11 (cash);
   one line may violate several items. Widening a hard-fail item after seeing
   disagreements is disclosed as such, and seeded recall is recomputed rather
   than carried over.
4. **CP9**: mirrors the deterministic check L1.9 exactly. A buyer message
   re-opens the window; without one, at most one template-shaped
   re-engagement follow-up carrying no price or offer content is allowed, and
   a free-form follow-up or a second one is a violation. The opt-in and
   impersonation limbs are unchanged. In run mode an L1.9 hard-fail already
   gates the conversation out of judging (§4.1), so the note mostly bites in
   calibration.
5. **SE1/SE2**: met when the item was asked AND answered or explicitly
   refused on the transcript, OR volunteered and explicitly confirmed back.
   The confirmed-back limb is kept deliberately. The first draft dropped it,
   which made the items unwinnable whenever a persona volunteers its budget
   unprompted, i.e. a buyer-dependent denominator, the exact pathology D2
   forbids. Replay: zero self labels move.
6. **SE4**: a volunteered requirement counts only when it is confirmed back or
   used to filter or recommend, and the judge quotes that turn.
7. **SE5**: two branches, both sharpened. SECURED is a booked visit, a
   callback with an agreed time, an accepted handoff, or a qualification
   logged at close. ATTEMPTED is one of those four proposed concretely and
   then declined or left. A vague proposal is not met. The first draft deleted
   the attempted branch; the label replay showed that contradicts the human
   key (6 of 16 buyer-ended no-next-step cases are labeled met, and up to 21
   of 45 met labels rest on an attempt), reverses ADR-0026, and makes every
   scripted walk-away scenario unwinnable. **This ADR supersedes ADR-0026's
   SE5 wording and keeps its principle.**
8. **SA2**: level semantics unchanged; the examples for levels 1 and 2 are
   extended, because no judge used level 1 at all while the human used it on
   11 of 119. Two alternatives were rejected: dropping SA2 (SalesScore is
   pre-registered as the mean of two anchors, and the G7 walk-away guard
   depends on it), and re-anchoring it as "2 by default without resistance"
   (36 of 73 human threes sit on no-resistance cases, and the change would
   move every composite by about 0.08).
9. **CQ1**: a chunking rule, not a word count. Length alone never fails a
   reply; a single long reply to a multi-part question is met; formatting is
   CQ2 and register is QA1. A numeric threshold was rejected on the data: the
   human failed 1 of 48, the best-fitting threshold agreed with the human 75%
   of the time against 98% for "never fail on length", and it contradicts both
   the prompt's own "judge on content, not length" bias control and the
   pre-registered length-bias check.
10. **CQ3**: positive failure criteria in order. Capability denial first (26
    of the human's 42 CQ3 failures: the agent denies, defers or escalates what
    its own documents or tools could answer), then a direct question left
    unanswered in the reply to it (that single reply, not two), answering a
    question nobody asked or ignoring a stated constraint, non-numeric
    contradiction of an earlier turn, and a tool close that routes away an
    answerable question. ADR-0029's exclusions stand: a tool close after a
    proper text reply is not a CQ3 failure, and a missing courtesy line is
    QA1. One self label (a text-free close marked CQ3 not_met) is routed to
    human re-check instead of being legislated away.

### Machinery

11. **Shared output contract** gains constant format lines: each item id
    appears exactly once, only the shown keys are emitted, and the anchors
    block is mandatory with exactly the listed ids and no `turn` key. This is
    prompt-side mitigation of Mistral's 22% error and 57% retry rate; the
    parser already rejected those shapes, so nothing becomes more permissive.
    The prompt hash changes, and v1 verdicts are archived to a sibling folder
    `calibration/archive/v1-2026-09-20/`, never left inside
    `calibration/judgments/`, which the readers would ingest as a fourth
    judge.
12. **Versioning**: every verdict, every meta pass file and every human label
    file now carries `itemsVersion`. Agreement, ablation and gate readers
    throw on a mixed `promptSha` or `itemsVersion` within one (judge,
    dimension) pair and skip `archived*` subfolders. A label-versus-judgment
    version mismatch is a printed warning, recorded in `agreement.json`.
13. **Evidence**: a new advisory `evidenceMeta` flag sits beside
    `evidenceFound`, raised when a quote is unlocatable AND is either shorter
    than 12 characters or shares no 4-character-or-longer token with the
    transcript. It is **not** a schema violation: ADR-0019 keeps the verbatim
    check advisory with adjudication as the backstop, and a hard reject would
    drop violations before mandatory adjudication and depress G9 recall. The
    raw judge reply is now stored on structured errors, truncated at 20k chars.
14. **Seeded sidecars**: `violatedItems` remains the sole G9 recall authority
    (the ADR-0025 clause is untouched). A new `alsoCovered` list is
    precision-only: a judge flag on an item listed there is not counted as a
    false positive. Three seeds needed it because a second item's text also
    applies to the seeded line. Fixed in the generator, not by hand.
15. **Human side**: labels are not re-done wholesale, because under v2 the
    clarifications move zero labels by replay. The human re-checks about 27
    positions (the buyer-ended SE5 cases, one CP9, one CQ3) under the v2 text
    before the new agreement run, and the pre-recheck folder is copied to
    `calibration/labels/archived-self-v1-2026-09-20/`, which `listRaters`
    skips.

### Not changed

Composite weights (§4.3), D1/D4/D7, the ablation set and its thresholds, QA1's
text, panel composition, and the `judgeApplicability` of any case.

## Evidence

- Agreement, 2026-09-20 pass (kappa from stats-bridge, 119 cases x 4
  dimensions x 3 judges, 1,428 primary verdicts): F 0.345, CP 0.454, SE 0.454,
  CQ -0.003; anchors FA1 0.41, SA1 0.29, SA2 0.36, QA1 0.07. Panel balanced
  accuracy on CQ is 0.51, which is chance.
- Order ablation, 600 reversed verdicts on the 50-slice: pooled flips F 0.102,
  CP 0.098, SE 0.211, CQ 0.094; anchors 0.254 on exact score. SE5 26% and SE4
  24% are the concentration.
- Directionality: CQ3 disagreements are lenient in every instance (panel
  passes CQ3 on 99% of units, the human on 57%), CQ1 disagreements strict in
  every instance (human passes 98%, panel 56%), F1 disagreements 31 of 34
  lenient. The panel missed all 9 human-flagged CP3 violations that turn on
  price arithmetic.
- Replay against the 119 self labels, 2026-09-21: SE1/SE2 as written move zero
  labels; the first-draft SE5 (secured only) contradicts 6 of 16 buyer-ended
  no-next-step labels and up to 21 of 45 met labels; a CQ1 word threshold
  agrees 75% against 98% for no threshold; SA2 re-anchoring would shift every
  composite by about 0.08.
- Judge format: structured errors in the primary pass were Grok 2, Mistral 81,
  Maverick 26 (113, 7.9%), plus 42 reversed. Mistral's are omitted anchor
  blocks and duplicated item entries, which the v2 format lines address, and
  it supplied 15 of the 20 single-judge ANY-flag false positives.
- Seeded sidecars: of the 7 compliance false positives against the human key,
  4 are sidecar under-specification and 3 are judge error. Seeded known-fail
  recall was 1.0 and is recomputed under v2 because CP3 widened.

## Consequences

- All four dimensions are re-judged, at about the cost of the first pass
  (roughly $25-30 metered), and only once a dedicated OpenRouter key is in
  place: ADR-0032 established the current key is shared and its spend is not
  attributable (G12). The reversed-order pass on the 50-slice is re-run, and
  agreement, seeded recall and flip rates are all recomputed. No v1 number
  carries forward.
- The paper reports v1 and v2 kappa side by side plus the anchor flip-rate
  breach, so the published figure is never best-of. The protocol file records
  this rule (`docs/judge-protocol.md` section 7).
- Colleague raters receive the 50-slice under v2 text only, so the 3-rater
  adjudication that G8 proper needs is not split across two rubrics.
- Widening CP3 after seeing disagreements is a disclosed post-hoc change to a
  hard-fail item. It is defensible only because it is disclosed, seeded recall
  is recomputed, and the composite weights it feeds were frozen on 2026-08-28.
- Re-running `pnpm checks` on the calibration sweeps (ADR-0024) is still
  outstanding and still blocks Phase 6.
- Reversible: v1 verdicts and the pre-recheck labels are archived, the rubric
  file is versioned, and the readers refuse to mix versions, so reverting is
  restoring one file and one folder.
