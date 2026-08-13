# ADR-0003 — Split "can place a breakpoint" from "reports cache reads"

Status: Accepted
Date: 2026-08-12
Tags: caching, provider, gate

## Context

`ProviderSpec` had a single `supportsExplicitCaching` flag, and the cache
probe used it to decide whether to run at all. That conflated two different
questions:

1. _Can the caller place a cache breakpoint?_ — Anthropic yes, everyone else no.
2. _Can we measure whether a repeat call billed cached input?_ — most of the
   lineup, yes.

The consequence was that `smoke:live` silently skipped the cache check on
every provider that caches **automatically** — OpenAI and Google — and printed
"no explicit cache-breakpoint control" as though that meant "no caching". That
contradicted the cost model, which budgets OpenAI caching and counts it as
stacking with batch.

"No knob" had been treated as "no caching".

## Decision

Two flags on `ProviderSpec`:

- `supportsExplicitCaching` — can the caller place a breakpoint. Anthropic
  only. Drives **nothing** except whether `providerOptions.anthropic.cacheControl`
  is sent.
- `reportsCacheReads` — do we expect `usage.inputTokenDetails.cacheReadTokens`
  to be populated. Drives whether the probe runs.

`reportsCacheReads: false` means **unverified, not absent**. `--force-cache-check`
probes anyway; the flag flips once a real run reports.

## Evidence

`normaliseUsage()` was already provider-agnostic — it reads
`inputTokenDetails.cacheReadTokens` with no provider branching — so no parsing
code was needed. Only the early return was wrong.

Flags flipped on measurement, not assumption:

| provider                     | measured           | flag              |
| ---------------------------- | ------------------ | ----------------- |
| `google/gemini-2.5-flash`    | call 3 read 34,789 | confirmed `true`  |
| `openrouter -> gpt-4.1-mini` | call 2 read 30,464 | `false` -> `true` |

The OpenRouter result also settled that cache accounting survives the
`createOpenAI({ baseURL })` mapping, which had been an open question.

## Consequences

The probe now runs against far more of the lineup, which is the point.

Splitting the flag is what exposed ADR-0004 — the flag was a labelling bug, and
fixing it revealed a real one underneath.
