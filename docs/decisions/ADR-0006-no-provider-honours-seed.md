# ADR-0006 — No provider honours seed; live reproducibility rests elsewhere

Status: Accepted
Date: 2026-08-13
Tags: determinism, reproducibility, provider

## Context

`scenario.seed` is passed to every model call and recorded in the run manifest,
which reads like a reproducibility guarantee. It is not one.

Every provider SDK in the lineup drops the parameter and emits
`{ type: 'unsupported', feature: 'seed' }`:

| provider  | location                                        |
| --------- | ----------------------------------------------- |
| Anthropic | `@ai-sdk/anthropic` `index.mjs:3474`            |
| OpenAI    | `@ai-sdk/openai`, both chat and responses paths |
| Google    | `@ai-sdk/google`                                |

A live run emits one such warning per call and then samples freely.

Worth knowing separately: even where seeds _are_ accepted they were never a hard
guarantee — batching and GPU floating-point ordering make inference
non-bit-reproducible regardless.

## Decision

Keep passing and recording the seed — it costs nothing and providers may add
support. But **never state that live runs are reproducible because of it.**

Live reproducibility rests on: the pinned model version, the recorded prompt
hashes, the gold-DB hash, and published per-run transcripts.

## Evidence

Two live runs of the same scenario on the same model (`gpt-4.1-mini`, same
fixtures, same seed) diverged: 23 steps ending on a buyer token vs 18 ending on
a flow-ending tool.

## Consequences

Only the offline smoke is byte-reproducible, and it is the only thing that
should ever be described that way.

**K — trials per scenario — is the real lever** against sampling variance, which
is what pass^k already exists to measure. Per-scenario variance monitoring
becomes more important, not less.

Follow-on, not yet done: contestant refs should pin **dated model snapshots**
(`gpt-4.1-mini-2025-04-14`) rather than floating aliases. With no seed to hold
sampling steady, a silent provider-side model update is the most likely way to
invalidate a scored run with no signal that anything changed.
