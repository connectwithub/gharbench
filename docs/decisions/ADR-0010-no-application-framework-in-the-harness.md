# ADR-0010 — No application framework in the harness; NestJS is the product stack

Status: Accepted
Date: 2026-08-13
Tags: stack, architecture, process

## Context

"Aren't we using NestJS?" is a reasonable question with a scattered answer, so
it is worth pinning once.

NestJS appears three times in the planning material, never as the harness stack:

1. The 2026-07-30 harness-architecture report advised against a bespoke
   TypeScript harness and said to reserve "TypeScript/NestJS for the
   scenario-authoring UI, the document store, and an optional transcript
   viewer". **That recommendation was overturned** on 2026-07-31 (Master Plan
   §5.1) in favour of TypeScript Option B.
2. Master Plan §407, as part of the _rationale_ for choosing TypeScript: "the
   future WhatsApp product is a Node/NestJS stack", and the engine, simulator,
   tool layer and scorers double as that product's regression suite.
3. Master Plan §861, the productization path: wrap the harness in an API and
   dashboard, a decision §5 partly anticipated.

So NestJS is the **product's** stack. The harness being TypeScript is what lets
one engine serve the benchmark, the audits and the product without a rewrite —
which was an argument _for_ TypeScript, not for a framework inside the harness.

## Decision

The harness has **no application framework**. It is a library plus two CLI entry
points (`pnpm smoke`, `pnpm smoke:live`). Dependencies stay limited to the AI
SDK, Zod, dotenv and the concurrency helpers.

NestJS enters only if and when the API + dashboard (§861) is built. That service
consumes this engine as a library; it does not absorb or replace it.

## Evidence

The harness exposes no HTTP surface and serves no requests. `HttpEndpointContestant`
is a _client_ of the §5.3 adapter contract — it calls someone else's endpoint,
it does not host one. There is nothing for dependency injection, decorators or a
module system to do.

Phase 0's §8 deliverables name no web framework.

## Consequences

A server framework stays out of the dependency graph of an artifact whose whole
value is being auditable and reproducible. Fewer moving parts between a
scenario and a score.

When the product API is built, the boundary is already the right shape: the
NestJS service imports the engine, and `HttpEndpointContestant` shows what a
client bot must implement to be scored.

If anyone proposes adding a framework to this repo, the question to ask is
whether the harness has started serving requests. If it has not, the answer is
no.
