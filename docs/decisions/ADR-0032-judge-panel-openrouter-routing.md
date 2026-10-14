# ADR-0032 — Judge panel serving ids verified; all three judges route through OpenRouter, Mistral slot resolves to Medium 3.5

Status: Accepted
Date: 2026-09-20
Tags: judge, providers, pricing, pinning, phase-5

## Context

ADR-0019 declared the §6.4 panel (Grok 4.3 / Mistral Large 3 / Llama 4
Maverick) as best-guess refs with a RE-VERIFY marker, to be confirmed at the
Phase-5 smoke before any paid pass. The human answer key is complete
(119/119 labeled, `gate:phase4` MET on every floor), so the paid pass is
next and the refs had to be resolved.

What the account actually has: `.env` carries OPENAI, ANTHROPIC, GOOGLE and
OPENROUTER keys. `XAI_API_KEY`, `MISTRAL_API_KEY` and `DEEPINFRA_API_KEY` are
present but blank, so `xai/grok-4.3` and `mistral/mistral-large-3` cannot be
called as declared. OpenRouter is funded ($70 loaded, $9.41 used before this
work) and its models API publishes per-endpoint prices, which makes it the
one gateway on which a judge price can be verified rather than researched.

The Master Plan already anticipated the Mistral question. §6.4, I7 rule:
"Large 3 if the $0.50/$1.50 price confirms, else Medium 3.5 — decided and
pinned in the manifest at Phase-5 start; the other becomes a named reserve."

## Decision

1. All three judges route through OpenRouter with the ADR-0016 `@Host` pin,
   so the upstream serving host is fixed and named:
   - `openrouter/x-ai/grok-4.3@xAI` (family xai)
   - `openrouter/mistralai/mistral-medium-3-5@Mistral` (family mistral)
   - `openrouter/meta-llama/llama-4-maverick@DeepInfra` (family meta)
2. The Mistral slot resolves to **Mistral Medium 3.5** under the I7 rule.
   Mistral Large 3 (`mistralai/mistral-large-2512`) lists zero endpoints on
   OpenRouter and its $0.50/$1.50 price could not be confirmed at La
   Plateforme (no key). Large 3 is the named reserve: if a Mistral key is
   funded later, `pnpm judge:calibration --judge=mistral/mistral-large-3`
   adds it as a fourth resumable verdict store without touching the other
   three.
3. Prices for the three are recorded as `verified` in `src/telemetry/prices.ts`,
   keyed on the OpenRouter nested id and taken from the PINNED host's
   endpoint entry, not the default-routing price.
4. Gateway ids are not `MODEL_PINS` candidates (ADR-0009 pins only direct
   providers). The pin evidence is the upstream dated model name each host
   reports, recorded below and in the panel file comment.
5. The §6.1 family-separation check in `pnpm matrix` compares model
   families, not serving providers. A new `modelFamily(ref)` in the registry
   maps a gateway-routed id to its vendor family (`x-ai` → xai, `mistralai`
   → mistral, `meta-llama` → meta, `qwen` → qwen, `moonshotai` → moonshot);
   the planner uses `PanelJudge.family` for judges. Before this, the
   Maverick judge counted as family "openrouter", so a `deepinfra/meta-llama/...`
   contestant would never have tripped the warning.

## Evidence

- Direct provider auth, 2026-09-20: `GET api.x.ai/v1/models` → 401
  `unauthenticated:bad-credentials`; `GET api.mistral.ai/v1/models` → 401
  `Invalid API Key`. Both keys are empty strings in `.env`.
- OpenRouter endpoint listings, 2026-09-20 (`/api/v1/models/<id>/endpoints`):
  - `x-ai/grok-4.3`: host xAI, upstream `x-ai/grok-4.3-20260430`,
    $1.25 in / $2.50 out / $0.20 cached input per MTok (two further xAI
    endpoints at 2× are the long-context tier; judge prompts are ~7.5k
    tokens). Matches the §6.4 researched figure exactly.
  - `mistralai/mistral-medium-3-5`: host Mistral, upstream
    `mistralai/mistral-medium-3.5-20260430`, $1.50 / $7.50, no cache-read
    price, seed and temperature supported.
  - `mistralai/mistral-large-2512`: HTTP 200, zero endpoints. Only a `:batch`
    variant of Large 2512 is listed at all.
  - `meta-llama/llama-4-maverick`: DeepInfra fp8, $0.20 / $0.80, 1M context,
    seed supported.
- Host pins honoured, 2026-09-20, one 5-token chat call each with
  `provider: { order: [pin], allow_fallbacks: false }`: responses report
  `provider: xAI`, `provider: Mistral`, `provider: DeepInfra` respectively.
  Grok's usage for a one-line prompt was 199 prompt / 102 completion tokens:
  it is a reasoning model and reasoning bills as output.
- `pnpm judge:calibration --dry-run` after the change: 1,428 calls,
  Grok ~$5.08, Mistral Medium 3.5 ~$8.24, Maverick ~$1.00, **$14.32 list
  upper bound** with all three priced (was $5.08 + two UNPRICED).
- Tests: `modelFamily` pinned in `tests/registry.test.ts`; the matrix
  family-warning test passes again with family semantics (418/418).
- Smoke runs, 2026-09-20 (`pnpm smoke:live --model=<ref> --force-cache-check`,
  the judge model plays both agent and buyer, all calls priced,
  `unpricedCalls: 0` in every costs.json):
  - Grok 4.3 via xAI, run `20260920T103339Z-smoke-live`: 25 calls, 125,697
    tokens, $0.098; conversation cache 25/25 calls hit; probe call 2 read
    30,784 tokens at the cache-read rate. CACHE HIT.
  - Mistral Medium 3.5 via Mistral, run `20260920T103533Z-smoke-live`:
    29 calls, 135,681 tokens, $0.210; conversation cache 21/29; probe call 2
    read 33,920 cached tokens. CACHE HIT.
  - Maverick via DeepInfra, run `20260920T103649Z-smoke-live`: 15 calls,
    148,625 tokens, $0.030; the conversation reported 3/15 cache hits (7,664
    cached-read tokens) but the byte-identical probe read 0 after 4 calls:
    INCONCLUSIVE under the automatic regime (ADR-0003), not a proven defect.
    At $0.20 per MTok input the judge slot costs about $1 uncached, so the
    pass proceeds; re-probe before Phase 6 and treat the Maverick cache-hit
    figure in any cost report as unverified.

- Parser tolerance, added mid-pass 2026-09-20 after the first ~750 verdicts:
  judges mirrored the item shape and put a `turn` key on anchor entries
  (Mistral Medium 3.5 on ~11% of replies, Grok on ~2%), and Maverick sent
  numeric strings ("2", "t4") for `score`/`turn` on ~4%. Both failed strict
  parsing twice (the retry echoes the zod error, which the models did not act
  on) and were stored as `schema_violation`. `src/judge/schema.ts` now
  accepts and drops `turn` on anchors and coerces integer strings in
  numeric fields; every other unknown key and any non-integer text still
  fails (test-pinned). The prompt is byte-identical, so the cache prefix and
  the blindness tests are untouched. Error records caused only by these two
  artefacts are deleted and re-judged; genuine failures (no JSON, anchors
  omitted, duplicated items) stay as structured errors in the gate count.

- Evidence grounding, 2026-09-20: 640 of Grok's 659 `evidenceFound=false`
  quotes were verbatim transcript lines carrying the rendered `[tN | role]`
  prefix. `findEvidence` now strips that wrapper and unifies quote glyphs;
  recomputed over the stored verdicts the unlocatable rate is Grok 24%
  (was 78%), Maverick 30% (was 47%), Mistral 10% (unchanged). The residual
  is multi-segment and truncated quotes plus Maverick's meta-commentary
  strings, which is what the metric is meant to catch.
- Spend attribution, 2026-09-20: harness-metered $27.2 judging + $0.34
  smokes; six probe calls priced exactly against OpenRouter's per-call
  `usage.cost` (ratio 1.00 for all three models). The key's daily usage
  nonetheless rose $42.90 -> $47.18 in a window with no harness calls, so
  the key is shared with another consumer; the residual over the metered
  figure is external usage, not a metering defect. The harness needs a
  dedicated key before any $/conversation claim (G12).

## Consequences

- The paper's judge table names Mistral Medium 3.5, not Large 3, with the
  I7 rule as the reason. The reserve is recorded here so the swap is
  auditable and reversible.
- All judge traffic depends on one gateway account. The `@Host` pin removes
  the routing non-determinism ADR-0016 measured, but OpenRouter's usage
  reporting for cache reads on these hosts is whatever the smoke shows;
  `reportsCacheReads: true` on the openrouter provider is the pilot's
  finding, re-checked here.
- Undoing this means funding direct xAI and Mistral accounts and restoring
  the direct refs; the verdict stores are keyed by judge slug, so a direct
  run lands in a separate directory and nothing already judged is lost.
