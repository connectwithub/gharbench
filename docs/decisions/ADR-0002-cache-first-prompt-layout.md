# ADR-0002 — Cache-first prompt layout: stable prefix first, variable content last

Status: Accepted
Date: 2026-08-01
Tags: caching, cost, architecture

## Context

Prompt caching is a **prefix match**. One changed byte anywhere in the prefix
invalidates everything after it. For a benchmark that will run tens of thousands
of conversations, the difference between a cached and an uncached prefix is most
of the bill.

## Decision

Every prompt is assembled stable-prefix-first:

```
system / policy  ->  tool schemas  ->  docs  ->  conversation so far  ->  this turn
```

Concretely:

- `BUYER_GUARDRAILS` and the persona card are built once per conversation and
  never interpolated with anything per-turn.
- The agent system prompt and tool set are built once in the constructor;
  `buildToolSet()` iterates `TOOL_SPECS` in declaration order so the
  serialised tool block is byte-stable.
- **Never** put a timestamp, UUID, turn counter or session id in a system
  prompt. Per-turn context goes in the message list.

## Evidence

`pnpm smoke:live` proves the layout rather than asserting it: it makes
byte-identical calls and reports the second call's cache-read tokens. See
ADR-0004 for the measured numbers — and for the discovery that a correct layout
is necessary but not sufficient.

## Consequences

Anything genuinely per-turn has to go in the message list, which is slightly
less convenient than string interpolation and is the whole point.

Prompt hashes go in the run manifest, so a prefix that starts drifting is
detectable after the fact rather than only visible as a cost increase.
