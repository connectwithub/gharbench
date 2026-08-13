# ADR-0001 — The Environment is the only place tools execute

Status: Accepted
Date: 2026-08-01
Tags: architecture, determinism

## Context

The AI SDK executes tools itself when a tool is declared with an `execute`
function. That puts execution inside the contestant, where the harness cannot
see it — and a contestant is exactly the thing under test.

Three capabilities depend on the harness owning execution:

- **DB hashing.** `dbHashStart` / `dbHashEnd` only mean something if every
  mutation went through one place.
- **Layer-1 events.** The Phase-2 checks consume structured tool events. They
  cannot exist if the tool ran inside someone else's loop.
- **Endpoint parity.** A contestant reached over HTTPS physically cannot run our
  tools. If the local path did, the two contestant kinds would be scored on
  different mechanics.

## Decision

Contestants return tool **calls** and never execute them. Tools are declared
without `execute`, which makes the SDK surface the call and hand back control,
and `stopWhen: stepCountIs(1)` makes the boundary explicit. The Environment is
the single execution site.

## Evidence

`tests/orchestrator.test.ts` and `tests/httpEndpoint.test.ts` exercise both
contestant kinds against the same Environment. The offline smoke reports
`dbHashStart != dbHashEnd` with 9 tool calls and 1 booking.

## Consequences

`ToolLoopAgent` is used as a single-step agent rather than an autonomous loop,
which looks like under-using the SDK and is not.

If anyone ever adds `execute` to a tool for convenience, DB hashing, the
Layer-1 event path and HTTP-endpoint parity all break at once, silently — the
run still completes and the numbers still look plausible.
