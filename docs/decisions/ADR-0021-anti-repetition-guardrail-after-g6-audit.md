# ADR-0021 — Buyer guardrails hardened with an anti-repetition mandate after the G6 pilot audit

Status: Accepted
Date: 2026-08-21

Tags: simulator, buyer, prompt, gate

## Context

The G6 manual audit of all 20 primary-pilot transcripts (235B buyer, run
`20260820T140309Z-sweep`, single rater, open-card via `pnpm audit:g6`)
landed at 4 minor / 0 critical deviations — 20%, inside the published
16–22% band, so the gate is MET and no simulator switch is required. But
the four minors cluster into exactly two mechanisms:

1. **Repetition loops** (2 cases): the buyer re-sent its previous message
   near-verbatim — twice in scn_hing_005.P03, five consecutive turns in
   scn_trap_003.P10. This is the SPASM-style drift/echo failure the Master
   Plan §5.3 catalogue predicts for long conversations, and nothing in
   `BUYER_GUARDRAILS` addressed it.
2. **Fabrication slips** (2 cases): an invented phone number
   (scn_trap_002.P03) and addressing the agent by the buyer's own name
   (scn_budget_003.P01). These violate an instruction that already exists
   ("Never make up or hallucinate information not provided in the scenario
   instructions").

The audit also produced a rater-process finding: both initially-marked
criticals were withdrawn on review — one was the agent's
`escalate_to_human` (the scenario's expected outcome), the other a
scripted opener plus scripted `buyer_disengages` walk-away. The rater had
misread scripted or agent-side endings as buyer deviations.

## Decision

1. **Add one anti-repetition line** to the GharBench-authored "WhatsApp
   register" section of `BUYER_GUARDRAILS` (never re-send a message; if
   the agent offers nothing new, push once in different words, then go
   terse / escalate / disengage per the card). It is deliberately NOT
   added to the τ²-lifted sections, which stay byte-faithful to the
   vendored guidelines; the line is pinned in `tests/buyer.test.ts` like
   the other §3.9 mandates.
2. **No new line for the fabrication slips.** The instruction already
   exists and was violated; restating it dilutes the prompt without
   evidence a restatement helps. If Phase 6 shows fabrication above noise,
   revisit with a targeted mechanism (e.g. reminder-block reinforcement),
   not more prose.
3. **The G6 audit UI shows the termination source and expected outcome
   prominently** (chips + per-row "ended by", scenario reference panel
   with mustHold / walk-away triggers / armed-trap scripts, judge-aligned
   `tN` turn numbers). The same affordances go into the Phase 7 rater
   instructions, since both false criticals came from that misread.

## Consequences

- The buyer prompt sha changes relative to the pilot. The pilot's G6/G8
  verdicts remain valid for the prompt they ran; the Phase 6 main run uses
  the hardened prompt. Manifests record `buyerPromptSha256` per run, so
  the two prompt generations are distinguishable forever.
- The hardening is prophylactic, not gate-forced (the band was met).
  Re-measure at the Phase 6 G6 spot-check: the repetition-loop count on
  the audit sample is the number to watch.
- Human notes and judge evidence now share one turn-numbering scheme
  (`t4` means the same message in both), which Phase 7 adjudication
  depends on.

Linked: ADR-0016 (pilot harness fixes), ADR-0017 (probe semantics),
ADR-0020 (Phase 6–10 scaffolding).
