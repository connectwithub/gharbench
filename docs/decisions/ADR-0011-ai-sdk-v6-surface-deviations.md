# ADR-0011 — AI SDK v6 surface: five places reality differed from the plan

Status: Accepted
Date: 2026-08-14
Tags: stack, tooling, architecture

## Context

The plan named `ToolLoopAgent`, `stopWhen`, `stepCountIs` and `tool()`. All
exist in `ai@6.0.239`. Five details differ from what the plan assumed, and the
dangerous property they share is that most would surface as _wrong behaviour_,
not as a type error or a crash.

## Decision

Record the deviations rather than rediscovering them:

1. **`inputSchema`, not `parameters`.** `tool({ description, inputSchema })`.

2. **Tools are declared without `execute`.** That makes the SDK surface the tool
   call and hand back control instead of running it, which is what keeps the
   Environment the single execution site ([ADR-0001](ADR-0001-environment-is-the-only-tool-execution-site.md)).
   `stopWhen: stepCountIs(1)` makes the boundary explicit. Consequence:
   `ToolLoopAgent` is used as a **single-step** agent here, which looks like
   under-using the SDK and is deliberate.

3. **Cache tokens are provider-agnostic in v6.** They come from
   `usage.inputTokenDetails.{cacheReadTokens, cacheWriteTokens, noCacheTokens}`
   with no provider-metadata digging. `normaliseUsage()` subtracts cached reads
   and writes back out of `inputTokens` so nothing is billed twice. This is why
   the cache probe needed no per-provider parsing when it was extended beyond
   Anthropic ([ADR-0003](ADR-0003-split-explicit-caching-from-cache-reporting.md)).

4. **Anthropic `cacheControl` is a call-level option**
   (`providerOptions.anthropic.cacheControl`) - automatic breakpoint placement
   on the last cacheable block, not a per-message breakpoint.

5. **Tool-result parts use `output: { type: 'json' | 'error-json', value }`.**
   The `error-json` variant is what lets a structured tool failure travel back
   to the model as data rather than as a thrown exception.

6. **The six `ZodObject` schemas infer to `never` as a union**, so
   `buildToolSet()` widens `spec.schema` to `z.ZodType<Record<string, unknown>>`
   at the `tool()` call. The runtime value is correct; only the inference
   needed help.

## Evidence

`src/contestants/providerModel.ts`: `inputSchema` at the `tool()` call,
`stopWhen: stepCountIs(1)`, and the `{ type: 'json' | 'error-json', value }`
result shape. `src/telemetry/cost.ts`: `normaliseUsage()` reads
`inputTokenDetails` with zero provider branching.

## Consequences

An SDK upgrade should re-check all six. Items 2 and 3 are the ones that would
do real damage: adding `execute` back would silently break DB hashing, the
Layer-1 event path and HTTP-endpoint parity at once, and a change to the usage
shape would make every cache measurement read zero while the runs still
completed.
