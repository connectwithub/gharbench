# ADR-0005 — Do not send promptCacheOptions mode:explicit

Status: Accepted
Date: 2026-08-12
Tags: caching, provider

## Context

`@ai-sdk/openai` exposes `promptCacheOptions: { mode: 'explicit' | 'implicit',
ttl: '30m' }` on both the chat and responses option schemas. If it worked, OpenAI
caching would become deterministic the way Anthropic's is, and an OpenAI miss
would be as unambiguous a signal as an Anthropic one.

## Decision

Do not send `prompt_cache_options`. Re-check per model before assuming a newer
contestant supports it.

## Evidence

`gpt-4.1-mini`, via `https://api.openai.com/v1/responses`:

```
400 invalid_request_error
"prompt_cache_options is not supported on this model"
param: prompt_cache_options
```

## Consequences

OpenAI caching stays best-effort, which is why the automatic probe regime
retries and reports a miss as `INCONCLUSIVE` rather than as a proven defect.

The general lesson is worth more than the specific flag: **the SDK's type
surface is not evidence that a model accepts a field.** The option typechecked
cleanly and failed at the API. Anything newly discovered in an SDK type
definition needs one real call before it is relied on.
