# ADR-0004 — OpenAI needs a stable promptCacheKey, or nothing caches

Status: Accepted
Date: 2026-08-12
Tags: caching, cost, provider

## Context

With the probe finally running against OpenAI (ADR-0003), four byte-identical
30,641-token calls read **zero** cached tokens — while the conversation in the
same run cached once. A 3.1k prefix cached; a 30.6k prefix never did.

The prefix layout (ADR-0002) was not the problem. The requests were being
**routed to different backends**, so there was no shared cache to hit.

## Decision

Send a stable `promptCacheKey` for `kind === 'openai'`, derived from the
system-prompt hash — never from anything per-turn — and truncated to OpenAI's
64-character limit inside the helper.

All cache wiring lives in one function, `cacheCallOptions()`, used by the probe
**and** by the contestant and buyer paths.

## Evidence

Four variants, two calls each, on `gpt-4.1-mini`:

| variant          | call 2              | result  |
| ---------------- | ------------------- | ------- |
| baseline         | `read=0`            | miss    |
| `promptCacheKey` | `in=177 read=30464` | **hit** |

Across a full conversation, contestant cache hits went from **1/19 calls (2,688
tokens)** to **10/19 (48,640 tokens)**.

An 80-character key (`gharbench-agent-<sha256>`) returns HTTP 400
`Invalid 'prompt_cache_key': string too long`. Hence truncation in the helper
rather than at each call site.

## Consequences

Restricted to `kind === 'openai'`: the OpenAI-_compatible_ endpoints reject
unknown request fields, and a 400 mid-sweep is worse than an uncached call.

The single-helper rule is load-bearing. Fixing only the probe would have turned
G1 green while every real sweep kept paying list price — the exact failure the
gate exists to catch.

If this is ever reverted, nothing breaks loudly. The bill roughly doubles and
the cache-hit telemetry quietly reports near-zero.
