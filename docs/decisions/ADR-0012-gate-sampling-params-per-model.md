# ADR-0012 — Gate sampling params per model instead of discovering the 400 mid-sweep

Status: Accepted
Date: 2026-08-14
Tags: provider, cost, process

## Context

Newer Anthropic models reject `temperature` / `top_p` / `top_k` outright with
HTTP 400 rather than ignoring them.

For a single call that is a clear error message. For a sweep it is worse than it
looks: the failure lands on turn one of every conversation using that model,
after fixtures are loaded and other calls have already been paid for, and it
looks like a harness bug rather than a provider constraint.

## Decision

Ask before setting. `supportsSamplingParams(ref)` is checked in the contestant
and the buyer simulator, and the parameters are omitted for models that reject
them, rather than sent and allowed to fail.

## Evidence

`REJECTS_SAMPLING_PARAMS` in `src/providers/registry.ts` matches the affected
Anthropic families, anchored so a dated snapshot of the same model still matches
(`claude-opus-5` and `claude-opus-5-20260101` both resolve the same way - which
matters now that aliases are pinned, [ADR-0009](ADR-0009-pin-dated-model-snapshots.md)).
Covered by `tests/registry.test.ts`.

## Consequences

Affected models run at provider defaults. **Temperature is therefore not a
controlled variable for them**, which any write-up reporting per-model
temperatures needs to say rather than implying a uniform setting.

The list is hand-maintained and will go stale as families change. It fails safe
in one direction only: a model wrongly listed as rejecting loses temperature
control silently, while a model wrongly listed as accepting fails loudly with a 400. Prefer adding to the list when unsure.
