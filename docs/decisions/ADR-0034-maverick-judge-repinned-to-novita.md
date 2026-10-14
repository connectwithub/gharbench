# ADR-0034 — Maverick judge re-pinned from DeepInfra to Novita after DeepInfra was delisted; transport failures are no longer persisted as verdicts

Status: Accepted
Date: 2026-10-14
Tags: judge, providers, pinning, pricing, reproducibility, phase-5

## Context

ADR-0032 pinned the third panel judge to `openrouter/meta-llama/llama-4-maverick@DeepInfra`
(fp8, $0.20 / $0.80 per MTok). The rubric v2 calibration pass (ADR-0033)
stopped on 2026-09-21 with 325 of 476 Maverick primary verdicts written and
none of the 200 reversed-order verdicts. When the pass was resumed on
2026-10-14 every Maverick call failed before billing:

> No endpoints found for meta-llama/llama-4-maverick. Every candidate endpoint
> was removed during routing: Filter by Fallback removed digitalocean,
> novita/fp8, parasail/fp8, google-vertex/us-east5.

DeepInfra no longer serves the model on OpenRouter, and the ADR-0016 pin sends
`allow_fallbacks: false`, so routing had nowhere to go. That is the pin working
as designed: it refused to substitute a host silently.

A second defect surfaced with it. The judge runner persisted a transport
failure (`outcome.code: "call_failed"`) as a verdict file, exactly like a
judge-format error. 351 such files were written in thirteen seconds (151
primary, 200 reversed). The runner's resume rule skips any (judge, case, dimension)
that already has a file, so a resume would never have retried them, and the
agreement reader would have scored them as 351 judge errors.

## Decision

1. The Maverick slot is re-pinned to `openrouter/meta-llama/llama-4-maverick@Novita`.
   Of the four remaining endpoints, Novita is the closest match to the
   DeepInfra serving it replaces: fp8 like DeepInfra, 1M context like
   DeepInfra, no cache-read pricing, $0.27 / $0.85 per MTok. The model and its
   family (`meta`) are unchanged, so the 6.1 separation rule is unaffected.
2. The whole Maverick v2 pass is rerun on Novita (476 primary + 200 reversed)
   rather than finishing the missing 151 + 200 there, so every Maverick v2
   verdict comes from one host (ADR-0016: routing is not behaviour-neutral).
   The 325 partial DeepInfra v2 verdicts are archived to
   `calibration/archive/v2-maverick-deepinfra-partial-2026-09-21/`, outside the
   readers' path. The 351 transport-failure files are kept as evidence in
   `calibration/archive/v2-call-failed-2026-10-14/`.
3. The runner no longer writes a verdict file for a `call_failed` outcome. It
   counts it in a separate `callFailed` figure in the meta pass and the
   summary line, and the next resume retries it. `no_json` and
   `schema_violation` stay persisted: they are judge behaviour and part of
   the result (ADR-0019). `errored` now means persisted judge-format errors
   only. The rule covers calibration and run mode alike.
4. The price row for `meta-llama/llama-4-maverick` moves to Novita's live
   price, verified 2026-10-14. It is keyed by model, so it changed before the
   first Novita call; otherwise `--max-usd` would have metered at DeepInfra
   rates without a warning.

ADR-0032 stands for Grok and Mistral. Its Maverick host line is replaced
by this ADR. ADR-0032 is not edited and carries no `superseded_by`, because
that would mark the whole panel decision as reversed.

## Evidence

- Pre-run balance (OpenRouter `/api/v1/credits`, `/api/v1/key`, 2026-10-14):
  total credits $120, total usage $66.65, key usage $57.17.
- Live endpoints `/api/v1/models/meta-llama/llama-4-maverick/endpoints`
  (2026-10-14): DigitalOcean (quantisation unknown, $0.188 / $0.652), Novita fp8
  ($0.27 / $0.85, 1M ctx, max output 8192), Parasail fp8 ($0.35 / $1.00,
  cache read $0.17), Google Vertex us-east5 (unknown, $0.35 / $1.15). No DeepInfra.
- Failed resume: 151 + 200 outcomes, all `call_failed`, $0.0000 across 0
  calls; meta files moved to the archive with the verdicts.
- Novita probe, one calibration case: 4 of 4 verdicts parsed, $0.0094.
- Novita full pass: primary 476/476 (4 structured errors, 0 call_failed),
  $1.40 metered across 498 calls; reversed slice 200/200 (1 structured
  error), $0.56 across 208 calls. Novita reported cached input on 295 of the
  498 primary calls but publishes no cache-read price, so the meter bills
  those tokens at the input rate (`prices.ts` falls back to it). The meter
  can overstate here but never understate.
- Grok and Mistral, resumed on their unchanged pins in the same session:
  Grok primary 200 calls $1.87, reversed 200 $1.98, 0 structured errors;
  Mistral primary 250 $6.52 (17 structured errors), reversed 200 $4.81 (16).
  No call_failed file was written by any judge.
- Usage reconciliation: the OpenRouter key's usage rose by $17.1478 over the
  session (before $57.1687, after $74.3165), and the metered judge spend
  sums to $17.1478. They match to the cent, so every billed call was
  metered.
- Found during the reconciliation: two per-judge processes that start in
  the same second write the same meta pass file name
  (`<startTs>-pass.json`), so the later one overwrites the earlier record.
  Grok's primary record replaced Mistral's. Mistral's figures above come
  from its run log. Follow-up: include the judge slug in the meta file name.

## Consequences

- The v1 vs v2 Maverick agreement comparison now changes two variables at
  once: the rubric (ADR-0033) and the serving host (DeepInfra fp8 to Novita
  fp8). The paper's side-by-side must say so for the Maverick column. Grok
  and Mistral are single-variable.
- A third-party delisting can recur for any pinned host. The pin keeps
  failing loudly rather than silently substituting a host, which is the
  intended behaviour. Re-check the endpoints of every panel model before each
  paid pass, not only at Phase 5 start.
- A run that hits a provider outage now leaves gaps that a resume fills,
  instead of permanent error verdicts. One edge case: when a first-attempt
  schema violation is followed by a retry that fails in transport, the
  outcome is `call_failed` (`judge.ts` retry path). That case is not
  persisted, and the next resume judges it afresh, so judge-format errors
  are slightly undercounted when transport failures and format errors hit
  the same item. The undercount is accepted.
- Reversible: point the panel ref back at any host with a fresh full pass.
  The archived DeepInfra partial set is not mixable with Novita verdicts.
