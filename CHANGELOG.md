# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow package.json. Zenodo mints one DOI per released version plus a concept
DOI (ADR-0030) - every entry here is what a version DOI points at.

## [Unreleased]

### Added

- Rubric v3 (`data/judge-items.json` 3.0.0, ADR-0037):
  - SA1 carries `appliesWithItem: "SE6"`, so it is asked only where the
    scenario declares an objection. The rule is config-time and
    implemented once, in `src/judge/anchorApplicability.ts`; the judge
    prompt, parser, labeler and scoring all use it.
  - SA1 gets a shared no-objection rule and a concrete-next-step level 3,
    and SE6 gets a matching note.
  - CQ1 is judged by message shape.
  - CQ3 is judged reply by reply against the documents and a listed
    sendable-asset roster. Truth of figures goes to F1/CP3. A sent RERA
    certificate counts as an answer.
  - QA1 is always scored, with observable markers between levels 2 and 3.
  - Only the salesEffectiveness and conversationQuality prompts change. The
    factuality and compliance prompts are byte-identical in both item
    orders, pinned by a golden-sha test.
- `judge:agreement --base-dir --out --declared-only --permutations`:
  - any archived snapshot is recomputed without touching the live
    `agreement.json`;
  - per-item kappa and a within-item permutation null are reported beside
    pooled G8a;
  - a carry-forward guard (judge-protocol section 7 rule 4) admits a
    prior-version verdict only when its promptSha equals the current
    builder's.
  - `judge:ablations` gains `--base-dir` and refuses mismatched rubric
    versions between the original and reversed passes.
- Judge runner lock: one writer per judge verdict directory
  (`<baseDir>/meta/<slug>.lock`). Meta pass files are named per judge, so
  concurrent passes no longer overwrite each other's records (ADR-0036).
- Canonical v1 verdict set: the 2026-09-20 private-repo snapshot, extracted
  to the calibration archive. Every v1 figure is recomputed from it
  (ADR-0036).

- `pnpm judge:ablations`: order-robustness flip-rate report over
  `calibration/judgments` vs `calibration/judgments-reversed` (protocol
  section 1, threshold 0.10 per dimension), written to
  `calibration/ablations/order-flip.json`.
- `modelFamily(ref)` in the provider registry: the §6.1 family-separation
  rule now compares model families (vendor of a gateway-routed id), not
  serving providers; `pnpm matrix` warnings use it.
- Judge order-robustness machinery: `--item-order=reversed` ablation pass,
  flip-rate / self-preference / leave-one-judge-out / length-bias metrics
  (`src/metrics/judgeAblations.ts`), protocol in `docs/judge-protocol.md`
  (ADR-0030, after SISTER).
- Scenario-clustered bootstrap CIs (`clusteredBootstrapMeanCi`).
- Contamination canary stamped across the private pool (`pnpm canary:stamp`).
- Release hygiene: `CITATION.cff`, code/data licence split (`LICENSE` MIT +
  `LICENSE-DATA` CC BY 4.0), this changelog, paper citation stubs (`paper/`).
- `endedBy`/`endedByTool` on calibration cases, shown to raters and judges
  (ADR-0027..0029).
- Operational profile: sweeps persist per-call latency telemetry, and the
  leaderboard reports per-reply p50/p95, calls/reply and tok/s as descriptive
  serving data - never scored, never ranked, latency-blindness of the scoring
  stack test-pinned (ADR-0031).
- `itemsVersion` stamped on every judge verdict, every judging meta pass file
  and every human label file, plus a loud guard in the agreement and ablation
  readers: one `promptSha` and one `itemsVersion` per (judge, dimension) or
  the read throws, `archived*` subfolders are skipped, and a label-versus-
  judgment version mismatch is warned and recorded in `agreement.json`
  (ADR-0033).
- `evidenceMeta`, an advisory flag beside `evidenceFound` for a quote that is
  unlocatable and either under 12 characters or sharing no 4-character token
  with the transcript. Advisory by design, never a schema violation, since
  adjudication is the backstop (ADR-0019). Structured judge errors now also
  store the raw judge reply, truncated at 20k characters (ADR-0033).
- 8 public `hinglish_variant` instances: four new persona pairings on
  existing situations (`scn_hing_001.P01`, `005.P09`, `007.P01`, `008.P01`)
  and four new situations (`scn_hing_009` to `012`). They raise the family to
  30, the matrix planner's I9 family floor, and add the family's first
  escalated outcomes (a price-cut ask, a request for a human), a cash trap
  armed in Hinglish, and an unnamed-competitor comparison. Instances go from
  150 to 158 and situations from 74 to 78; the held-out share is 28.5%.
  `gate:phase1` and `matrix` are MET.

### Changed

- SalesScore's anchor term is the mean over the sales anchors that apply.
  The binary fraction alone is used only when none applies. This is a dated
  pre-registration amendment (judge-protocol section 6, ADR-0037) and
  affects v3 verdicts only; the literal frozen reading is reported as a
  sensitivity row.
- The calibration labeler shows SA1 under the same applicability rule and
  renders the judges' "(hypothetical illustration)" suffix on examples.
- Judge rubric v2 (`data/judge-items.json` 1.3.0 -> 2.0.0, ADR-0033): no item
  added, removed or renumbered, but F1 and CP3 now cover mis-computed totals,
  CP9 mirrors the deterministic check L1.9, SE1/SE2 require asked-and-answered
  or volunteered-and-confirmed, SE5 keeps a sharpened secured/attempted pair
  (superseding ADR-0026's wording), CQ1 becomes a chunking rule with no length
  threshold, and CQ3 gets positive failure criteria led by capability denial.
  FA1 and SA2 change in scale and example text, SA2 gaining level-1 examples
  no judge ever used.
- Shared judge output contract gains constant format rules (each item id once,
  only the shown keys, a mandatory anchors block with exactly the listed ids
  and no `turn` key). The v2 prompt hash differs from v1, so v1 verdicts are
  archived to `calibration/archive/v1-2026-09-20/` rather than left where the
  readers would ingest them as a fourth judge (ADR-0033).
- Seeded calibration sidecars gain a precision-only `alsoCovered` list, for
  the three seeds whose seeded line also satisfies a second item's text; a
  judge flag on an `alsoCovered` item is no longer a false positive, and
  `violatedItems` remains the sole G9 recall authority (ADR-0025, ADR-0033).
- Judge panel serving ids verified live and routed through OpenRouter with
  @Host pins (ADR-0032): Grok 4.3 via xAI, Llama 4 Maverick via DeepInfra,
  and the Mistral slot resolved to Mistral Medium 3.5 under the Master Plan
  §6.4 I7 rule (Mistral Large 3 has no reachable endpoint; named reserve).
  Verified prices added for all three (`src/telemetry/prices.ts`).
- Llama 4 Maverick judge re-pinned from DeepInfra to Novita (fp8, $0.27 /
  $0.85 per MTok) after DeepInfra was delisted for the model on OpenRouter.
  The whole Maverick v2 calibration pass was rerun on Novita, so every
  Maverick verdict comes from one host (ADR-0034).

### Fixed

- Judge output parser tolerates a `turn` key on anchor entries and integer
  strings in numeric fields (format artefacts seen live; prompt unchanged).
- Evidence grounding (`evidenceFound`) strips a copied `[tN | role]` /
  `tN:` attribution wrapper and unifies typographic glyphs before the
  substring test; Grok's "unlocatable quote" rate was 78% and is 24% after
  the fix, Maverick 47% to 30%, Mistral unchanged at 10%.
- `listRaters` skips `archived-*` label folders; the Phase-5 gate had
  counted the ADR-0028 purge archive as a colleague rater.
- The judge runner no longer writes a verdict file for a transport failure
  (`call_failed`). The next resume retries it, and the meta pass counts it
  separately as `callFailed`. Before, a provider outage left error verdicts
  that every later resume skipped (ADR-0034).
- The buyer simulator now sees only the trap modules a scenario arms in
  `activeTrapIds`. Before, it got every trap on the persona card, so 33 of the
  113 public scenarios could spring a trap they never armed. A correct
  escalation in reply then ended the chat short of the expected outcome.
  Three author notes that named the trap mechanism are removed from P03 and
  P11 (both now 1.1.0). Apart from those two cards, fully-armed and trap-free
  scenarios render byte-identical buyer prompts (ADR-0035).

## [0.1.0] - unreleased baseline (2026-08-28 state)

Phases 0-3 complete and gated: deterministic TS harness (orchestrator, six
tools, telemetry, $0 offline smoke), corpus v2, 12 personas, 150 scenario
instances (105 public / 45 held-out private), Layer-1 checks L1.1-L1.13
(G3: 20/20 seeded violations caught, 0 false fires), buyer-simulator pilot
(Qwen3-235B primary; G6 deviation audit MET), calibration set built (119
cases), judge panel + Phase 5-8 scaffolding executable end to end with honest
UNMET gates. No public release yet - 0.1.0 is tagged at the first Zenodo
deposit.
