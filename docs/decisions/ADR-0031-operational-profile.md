# ADR-0031 — Operational profile: latency published as serving telemetry, never scored

Status: Accepted
Date: 2026-08-30

Tags: telemetry, metrics, leaderboard, reporting

## Context

A vendor choosing an agent model cares how long a lead waits for a reply,
not only how well the agent sells. On WhatsApp that wait is unusually well
defined: messages arrive whole (no streaming), so the full-response wall
clock of an agent turn IS the user experience. The harness has always
timed every call (`latencyMs` in `src/telemetry/cost.ts`), but sweep's
costs.json persisted only per-conversation `CostSummary` aggregates, whose
`latencyMsTotal` mixes buyer-simulator and contestant calls — contestant
latency could not be recovered from a finished run.

The tension: latency measures the provider's serving stack (route, region,
load, cache state) on the run date, not the model checkpoint. It is not
reproducible from model pins, varies between reruns, and this repo's own
determinism notes exclude it from every comparison for exactly that
reason. Folding it into the composite, a ranking, or a gate would import a
vendor-controlled, unreproducible number into the benchmark's headline
claims — the same failure mode the price table's `unverified` discipline
exists to prevent.

## Decision

Publish latency as a **descriptive operational profile**, structurally
separated from scoring:

1. **Sweep persists per-call telemetry.** Each costs.json
   `perConversation` entry gains an ordered `calls` array
   (`role, modelId, latencyMs, outputTokens, cacheHit`). Order carries the
   reply boundaries for free: one `contestant.turn()` is one model call
   (`stopWhen: stepCountIs(1)`), and the orchestrator drives the inner
   tool loop, so a buyer-visible reply is exactly the run of consecutive
   contestant calls between two buyer calls. No engine plumbing, no new
   fields on `ModelCallMeta`. On an infra retry the surviving attempt's
   calls are persisted (the profile describes the conversation that
   produced the data) while the merged summary keeps billing honest.
2. **`src/metrics/operationalProfile.ts` is pure.** `replyGroups()` splits
   the sequence on buyer calls (a scripted opener legitimately starts a
   conversation on contestant calls — that run is reply 1; unknown roles
   neither extend nor close a group). `operationalProfile()` reports
   per-reply and per-call p50/p95/mean/max (the ci.ts
   `round(q*(n-1))` order-statistic convention, so percentiles mean the
   same thing everywhere), calls/reply, and output tokens/second as a
   throughput proxy. No contestant calls → `null`, never a zero-shaped
   profile.
3. **The leaderboard prints it as a separate section** and embeds
   `OPERATIONAL_PROFILE_NOTE` verbatim in the JSON, so the caveat travels
   with the numbers wherever the file goes: descriptive serving telemetry,
   excluded from the composite and every ranking, interactive
   (non-batch) calls only, dated by the run. Runs whose costs.json
   predates the `calls` array (the pilot) print
   "latency telemetry unavailable" — absence stays loud.
4. **Latency-blindness is test-pinned.**
   `tests/operationalProfile.test.ts` scans `composite.ts`, `passk.ts` and
   the whole judge stack for any latency reference; the pin fails the
   moment someone wires the profile into a scoring surface.

## Consequences

- Vendors get the deployment-relevant axis (reply p50/p95, tok/s) beside
  $/conv on the cost frontier, clearly labeled as measured-on-date serving
  data.
- The paper may describe the profile only as telemetry; any latency claim
  must carry the run date and provider routing (the `@Host` pin), and no
  latency figure may appear in a ranking sentence.
- If a future run uses batch billing (deferred by ADR-0019), its latency
  is meaningless as UX data — the profile must be suppressed or labeled
  for that run before anyone reads it.
- Existing runs are not migrated; their profiles read as unavailable.
