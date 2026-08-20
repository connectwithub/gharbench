# ADR-0016 — OpenRouter routing is not behaviour-neutral: pin the host, use the chat surface

Status: Accepted
Date: 2026-08-20
Tags: providers, reproducibility, harness

## Context

The Phase 3 pilot routed the Qwen buyer models through OpenRouter, which
load-balances each request across upstream hosts (`qwen/qwen3-32b`: DeepInfra,
Nebius, SiliconFlow, Groq — different prices, different quantisations,
different capabilities). Two failures surfaced that a manifest recording only
`openrouter/qwen/qwen3-32b` cannot explain:

1. **Capability divergence.** Groq rejects any conversation that ends after an
   assistant message ("does not support assistant message prefill") — which
   every buyer-opener scenario produces, since the buyer's scripted opening is
   an assistant turn in its own view. Unpinned, 14/20 conversations died on
   whichever requests landed on Groq; the rest happened to route elsewhere.
2. **Translation-layer instability.** The AI SDK's default surface for
   `createOpenAI` is the Responses API, which OpenRouter serves through a
   translation layer with its own per-endpoint capability pre-flight. Batches
   of well-formed requests 400'd, then passed unchanged 15 minutes later as
   endpoint metadata shifted — and a thinking model's text came back empty
   through the translation while `/chat/completions` returned it intact.

The `:provider` model-id suffix is not a fix: OpenRouter accepts
`qwen/qwen3-32b:deepinfra` silently and routes to Nebius anyway (measured).

## Decision

1. **`@Host` ref suffix pins the upstream provider.**
   `openrouter/qwen/qwen3-32b@DeepInfra` injects OpenRouter's documented
   routing-preference field (`provider: { order: [host], allow_fallbacks:
false }`) through a custom fetch in the registry. The price-table /
   manifest `modelId` stays bare; the manifest records `routingPin`
   separately, so a scored run names the host it actually ran on.
2. **OpenAI-compatible gateways use `.chat()`, not the default Responses
   callable.** Chat completions is the surface these gateways natively serve;
   the Responses translation adds an unstable layer with no compensating
   benefit here.
3. **Sweeps retry an infra-errored conversation once from a fresh clone.**
   Provider/network errors are casualties, not data; both attempts' costs are
   counted and the manifest records `retriedConversations`.

## Consequences

- Comparative runs (the Phase 3 pilot pair) hold host and surface constant,
  so probe deltas measure the model, not the router.
- A pinned host that is down fails loudly instead of silently routing to a
  host with different behaviour — the correct trade for scored runs.
- The `reportsCacheReads: true` measurement for OpenRouter predates the chat
  switch; re-verify with `--force-cache-check` before relying on buyer-side
  cache figures there.
