# ADR-0009 — Pin floating model aliases to dated snapshots

Status: Accepted
Date: 2026-08-13
Tags: reproducibility, provider, determinism, cost

## Context

Follow-on from [ADR-0006](ADR-0006-no-provider-honours-seed.md): no provider
honours `seed`, so sampling variance is already uncontrolled. That makes a
second, quieter source of drift the dominant reproducibility risk.

A floating alias like `gpt-4.1-mini` is a pointer. A provider can repoint it at
a new model with no announcement and nothing in the response to indicate it
happened. For a sweep that runs over hours or days, the failure mode is that the
first half and the second half ran against different models, the manifest
records `gpt-4.1-mini` for both, and every number still looks plausible.

Nothing in the harness would catch it. There is no fingerprint to compare and no
seed whose behaviour would change.

## Decision

Resolve floating aliases to dated snapshots at `parseModelRef`, before the model
is constructed. The run sends the snapshot; the manifest records both the
snapshot (`ref`, `modelId`) and what was asked for (`requestedRef`), plus a
`versionPinned` boolean per model.

Every entry in `MODEL_PINS` is copied from the installed provider SDK's own
model-id union, never from memory. An alias with no verified dated snapshot is
**deliberately absent rather than guessed**, and the run prints a warning saying
the result cannot be shown to have used one model version throughout.

Pinning applies only to the three direct providers. An OpenAI-compatible gateway
routes by its own rules, so substituting an id there would imply a guarantee that
cannot be made.

## Evidence

Verified live, not inferred from the type union:

| requested                    | sent                        | priced                    |
| ---------------------------- | --------------------------- | ------------------------- |
| `openai/gpt-4.1-mini`        | `gpt-4.1-mini-2025-04-14`   | $0.0004, priced           |
| `anthropic/claude-haiku-4-5` | `claude-haiku-4-5-20251001` | $0.0027, priced           |
| `google/gemini-2.5-flash`    | unchanged                   | warns: not version-pinned |

Google publishes no dated GA snapshot for `gemini-2.5-flash`. The `-preview-`
ids in its SDK union are different models, not pins, so it stays unpinned —
inventing one would be a false reproducibility claim, which is worse than an
honest warning. `claude-opus-5`, `claude-sonnet-5` and `claude-fable-5` are
absent for the same reason.

`priceFor()` now falls back from a snapshot to its alias. Without that, pinning
would have silently turned every priced call into an `unpricedCalls` entry —
the table is keyed on readable aliases and the run had started sending dated
ids. Caught by a regression test rather than by a $0 cost report.

## Consequences

`ModelRef` carries `requestedModelId`, `requestedRef` and `pinned` alongside the
resolved id, so a manifest states what was asked for _and_ what ran.

A result that claims reproducibility needs `versionPinned: true` on every model
in its manifest. Google is currently the gap in the lineup.

`MODEL_PINS` is a dated table and goes stale exactly like the price table.
**Re-verify at freeze**, from the SDK unions or vendor docs, not from memory.
