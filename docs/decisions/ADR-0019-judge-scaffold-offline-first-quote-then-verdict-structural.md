# ADR-0019 — Judge scaffolding: offline-first, quote-then-verdict enforced structurally, polarity normalised once

Status: Accepted
Date: 2026-08-20
Tags: evaluation, judge-panel, architecture, process

## Context

Phase 5 (Master Plan §8) runs the §6.4 cross-family panel (Grok 4.3 / Mistral
Large 3 / Llama 4 Maverick) over the stored calibration set and gates on
human–judge agreement (G8/G8a), inter-judge α, and compliance recall on
seeded fails. The scaffolding was built before the human labels exist, which
forced several design decisions:

1. The §4.4 prompt template and §4.2 rubric leave the output contract, retry
   behaviour and item polarity to the implementer.
2. Small judges exhibit truth bias on bare booleans (arXiv:2605.24737) — the
   quote-then-verdict chain is the mitigation, but only if it cannot be
   skipped.
3. The rubric's binary items are worded in two polarities: CP items describe a
   violation condition ("super-built-up presented as carpet"), F/SE/CQ items a
   good criterion ("all claims supported"). Humans label the item text
   (met/not_met); compliance judges answer VIOLATION/OK. A polarity mistake
   would not crash anything — it would silently invert every kappa.
4. The judge model ids have never been called live, and two of three have no
   researched price.

## Decision

- **Everything runs offline for $0 until the panel is deliberately fired.**
  The model call sits behind a one-function seam (`JudgeCallFn`); prompts,
  parsing, retry, aggregation, matrices and gates are all pure and tested.
  `pnpm judge:calibration --dry-run` prices a pass without an API call.
- **Quote-then-verdict is a schema rule, not a hope.** A compliance VIOLATION
  with evidence `NONE` is a `schema_violation`; the item set must match the
  declared-applicable ids exactly; `hard_fail` must equal the item verdicts.
  One retry with the validation error appended; a second failure is stored as
  a structured error (failure is data). Evidence is additionally checked
  verbatim against the transcript — advisory only, adjudication catches
  fabricated quotes (D3).
- **Polarity is normalised in exactly one module** (`src/judge/polarity.ts`):
  everything — labels, judge verdicts, expected sidecars — converges on one
  boolean ("pass") before any statistic is computed.
- **Cache-first applies to judging**: the system block (role, rubric, bias
  controls, output contract, all ~18KB of corpus documents) is byte-identical
  per (judge, dimension) across every case; the per-case material rides in
  the user turn. The prompt is blind to band/source/provenance (test-pinned) —
  those are the answer key.
- **Agreement statistics are never reimplemented in TS.** Matrices are
  assembled in TS; κ / weighted-κ / α / ρ come from stats-bridge (the
  existing reference-implementation rule). Ties drop units; slice
  adjudication needs a strict majority. P/R/F1 is counting, computed in TS.
- **Panel refs are declared but unpinned.** `JUDGE_PANEL` carries the §6.4
  lineup with a RE-VERIFY marker; ids, dated snapshots (ADR-0009) and prices
  (ADR-0013 — only Grok has a researched, unverified figure; the other two are
  deliberately absent) are confirmed at the Phase-5 cache smoke
  (`pnpm smoke:live --model=<judge-ref> --force-cache-check`) before any paid
  pass. Maverick routes via OpenRouter with the ADR-0016 @Host pin. Batch-API
  billing is deferred: the panel runs interactive-with-cache first; batch is
  adopted only if the measured cost demands it.

## Consequences

- Phase 5's remaining machine work when labels arrive is: verify the three
  refs/prices at smoke, run `judge:calibration` (est. list-price low tens of
  dollars before caching, inside the §8 $30–80 envelope), then
  `judge:agreement` and `gate:phase5`.
- Verdict files are per-(judge, case, dimension) and resumable like labels;
  `--retest` writes a parallel store for test–retest self-consistency.
- The gate reports honest UNMET floors today (no judgments, no labels, no
  slice raters) — same discipline as gates 1 and 4 (ADR-0007).
- Judgments live under `calibration/` and inherit its gitignore: they are
  derived from the answer-key store and leak case content.

Linked: ADR-0002 (cache-first), ADR-0007 (gates state what they prove),
ADR-0009 (pins), ADR-0013 (price table), ADR-0016 (OpenRouter pinning).
