# ADR-0013 — The price table refuses to invent a number

Status: Accepted
Date: 2026-08-14
Tags: cost, telemetry, process

## Context

The cost model is a headline claim in the paper, and the cheapest way to corrupt
it is a missing price that quietly evaluates to zero. An unpriced sweep would
then look _cheap_ rather than _unmeasured_, and nothing in the output would say
which.

## Decision

The table never invents a number:

- An unknown model yields `{ usd: null, priced: false }` and increments
  `unpricedCalls`. It never contributes `$0` to a total.
- Every entry carries `confidence: 'verified' | 'unverified'` and a
  `lastVerified` date. Rates that could not be confirmed are explicit
  placeholders, marked as such, rather than plausible-looking guesses.
- `RE-VERIFY AT FREEZE` is marked in the source. Vendor pricing moves without
  notice.

## Evidence

A live run routed through OpenRouter, for which the table has no entry at all,
reported:

```
cost   5 calls, 64668 tokens, $0.0000 (5 unpriced)
```

The `$0.0000` is present but so is `(5 unpriced)`, so the figure cannot be read
as "this was free". That is the mechanism working.

By contrast the Anthropic G1 run reported `unpricedCalls: 0` with
`priceConfidence: verified` across all 28 calls, so its $0.1139 is a real
number. The `gpt-4.1-mini` figures from the same period rest on an
`unverified` placeholder rate and should not be quoted as measured cost.

## Consequences

A run can legitimately report token counts without dollars. That is the honest
outcome and downstream reporting must handle `usd: null` rather than coercing
it to zero.

The same discipline was later applied to model version pinning
([ADR-0009](ADR-0009-pin-dated-model-snapshots.md)): an alias with no published
dated snapshot is left unpinned and warned about, not guessed at.
