# Decision index

Generated from `decisions.jsonl` — do not edit by hand.
Run `node scripts/decisions-index.mjs docs/decisions` after appending an entry.

15 decisions.

## By date

- **ADR-0014** (2026-08-20) — [Personas are public; scenarios are persona-bound instance files split at authoring time](ADR-0014-personas-are-public-scenarios-are-persona-bound-instance-files.md)
- **ADR-0015** (2026-08-20) — [Layer-1 checks fire only on quotable, context-anchored evidence](ADR-0015-checks-fire-only-on-quotable-context-anchored-evidence.md)
- **ADR-0011** (2026-08-14) — [AI SDK v6 surface: five places reality differed from the plan](ADR-0011-ai-sdk-v6-surface-deviations.md)
- **ADR-0012** (2026-08-14) — [Gate sampling params per model instead of discovering the 400 mid-sweep](ADR-0012-gate-sampling-params-per-model.md)
- **ADR-0013** (2026-08-14) — [The price table refuses to invent a number](ADR-0013-the-price-table-refuses-to-invent-a-number.md)
- **ADR-0006** (2026-08-13) — [No provider honours seed; live reproducibility rests elsewhere](ADR-0006-no-provider-honours-seed.md)
- **ADR-0008** (2026-08-13) — [Two decision logs, split by leakage risk](ADR-0008-two-decision-logs-split-by-leakage-risk.md)
- **ADR-0009** (2026-08-13) — [Pin floating model aliases to dated snapshots](ADR-0009-pin-dated-model-snapshots.md)
- **ADR-0010** (2026-08-13) — [No application framework in the harness; NestJS is the product stack](ADR-0010-no-application-framework-in-the-harness.md)
- **ADR-0003** (2026-08-12) — [Split "can place a breakpoint" from "reports cache reads"](ADR-0003-split-explicit-caching-from-cache-reporting.md)
- **ADR-0004** (2026-08-12) — [OpenAI needs a stable promptCacheKey, or nothing caches](ADR-0004-openai-requires-stable-prompt-cache-key.md)
- **ADR-0005** (2026-08-12) — [Do not send promptCacheOptions mode:explicit](ADR-0005-do-not-send-prompt-cache-options.md)
- **ADR-0007** (2026-08-12) — [A gate check states only what it proves](ADR-0007-a-gate-check-states-only-what-it-proves.md)
- **ADR-0001** (2026-08-01) — [The Environment is the only place tools execute](ADR-0001-environment-is-the-only-tool-execution-site.md)
- **ADR-0002** (2026-08-01) — [Cache-first prompt layout: stable prefix first, variable content last](ADR-0002-cache-first-prompt-layout.md)

## By tag

### `architecture`

- ADR-0001 — [The Environment is the only place tools execute](ADR-0001-environment-is-the-only-tool-execution-site.md)
- ADR-0002 — [Cache-first prompt layout: stable prefix first, variable content last](ADR-0002-cache-first-prompt-layout.md)
- ADR-0008 — [Two decision logs, split by leakage risk](ADR-0008-two-decision-logs-split-by-leakage-risk.md)
- ADR-0010 — [No application framework in the harness; NestJS is the product stack](ADR-0010-no-application-framework-in-the-harness.md)
- ADR-0011 — [AI SDK v6 surface: five places reality differed from the plan](ADR-0011-ai-sdk-v6-surface-deviations.md)
- ADR-0014 — [Personas are public; scenarios are persona-bound instance files split at authoring time](ADR-0014-personas-are-public-scenarios-are-persona-bound-instance-files.md)
- ADR-0015 — [Layer-1 checks fire only on quotable, context-anchored evidence](ADR-0015-checks-fire-only-on-quotable-context-anchored-evidence.md)

### `caching`

- ADR-0002 — [Cache-first prompt layout: stable prefix first, variable content last](ADR-0002-cache-first-prompt-layout.md)
- ADR-0003 — [Split "can place a breakpoint" from "reports cache reads"](ADR-0003-split-explicit-caching-from-cache-reporting.md)
- ADR-0004 — [OpenAI needs a stable promptCacheKey, or nothing caches](ADR-0004-openai-requires-stable-prompt-cache-key.md)
- ADR-0005 — [Do not send promptCacheOptions mode:explicit](ADR-0005-do-not-send-prompt-cache-options.md)

### `cost`

- ADR-0002 — [Cache-first prompt layout: stable prefix first, variable content last](ADR-0002-cache-first-prompt-layout.md)
- ADR-0004 — [OpenAI needs a stable promptCacheKey, or nothing caches](ADR-0004-openai-requires-stable-prompt-cache-key.md)
- ADR-0009 — [Pin floating model aliases to dated snapshots](ADR-0009-pin-dated-model-snapshots.md)
- ADR-0012 — [Gate sampling params per model instead of discovering the 400 mid-sweep](ADR-0012-gate-sampling-params-per-model.md)
- ADR-0013 — [The price table refuses to invent a number](ADR-0013-the-price-table-refuses-to-invent-a-number.md)

### `determinism`

- ADR-0001 — [The Environment is the only place tools execute](ADR-0001-environment-is-the-only-tool-execution-site.md)
- ADR-0006 — [No provider honours seed; live reproducibility rests elsewhere](ADR-0006-no-provider-honours-seed.md)
- ADR-0009 — [Pin floating model aliases to dated snapshots](ADR-0009-pin-dated-model-snapshots.md)
- ADR-0014 — [Personas are public; scenarios are persona-bound instance files split at authoring time](ADR-0014-personas-are-public-scenarios-are-persona-bound-instance-files.md)
- ADR-0015 — [Layer-1 checks fire only on quotable, context-anchored evidence](ADR-0015-checks-fire-only-on-quotable-context-anchored-evidence.md)

### `gate`

- ADR-0003 — [Split "can place a breakpoint" from "reports cache reads"](ADR-0003-split-explicit-caching-from-cache-reporting.md)
- ADR-0007 — [A gate check states only what it proves](ADR-0007-a-gate-check-states-only-what-it-proves.md)
- ADR-0015 — [Layer-1 checks fire only on quotable, context-anchored evidence](ADR-0015-checks-fire-only-on-quotable-context-anchored-evidence.md)

### `process`

- ADR-0007 — [A gate check states only what it proves](ADR-0007-a-gate-check-states-only-what-it-proves.md)
- ADR-0008 — [Two decision logs, split by leakage risk](ADR-0008-two-decision-logs-split-by-leakage-risk.md)
- ADR-0010 — [No application framework in the harness; NestJS is the product stack](ADR-0010-no-application-framework-in-the-harness.md)
- ADR-0012 — [Gate sampling params per model instead of discovering the 400 mid-sweep](ADR-0012-gate-sampling-params-per-model.md)
- ADR-0013 — [The price table refuses to invent a number](ADR-0013-the-price-table-refuses-to-invent-a-number.md)
- ADR-0014 — [Personas are public; scenarios are persona-bound instance files split at authoring time](ADR-0014-personas-are-public-scenarios-are-persona-bound-instance-files.md)
- ADR-0015 — [Layer-1 checks fire only on quotable, context-anchored evidence](ADR-0015-checks-fire-only-on-quotable-context-anchored-evidence.md)

### `provider`

- ADR-0003 — [Split "can place a breakpoint" from "reports cache reads"](ADR-0003-split-explicit-caching-from-cache-reporting.md)
- ADR-0004 — [OpenAI needs a stable promptCacheKey, or nothing caches](ADR-0004-openai-requires-stable-prompt-cache-key.md)
- ADR-0005 — [Do not send promptCacheOptions mode:explicit](ADR-0005-do-not-send-prompt-cache-options.md)
- ADR-0006 — [No provider honours seed; live reproducibility rests elsewhere](ADR-0006-no-provider-honours-seed.md)
- ADR-0009 — [Pin floating model aliases to dated snapshots](ADR-0009-pin-dated-model-snapshots.md)
- ADR-0012 — [Gate sampling params per model instead of discovering the 400 mid-sweep](ADR-0012-gate-sampling-params-per-model.md)

### `reproducibility`

- ADR-0006 — [No provider honours seed; live reproducibility rests elsewhere](ADR-0006-no-provider-honours-seed.md)
- ADR-0009 — [Pin floating model aliases to dated snapshots](ADR-0009-pin-dated-model-snapshots.md)
- ADR-0014 — [Personas are public; scenarios are persona-bound instance files split at authoring time](ADR-0014-personas-are-public-scenarios-are-persona-bound-instance-files.md)

### `stack`

- ADR-0010 — [No application framework in the harness; NestJS is the product stack](ADR-0010-no-application-framework-in-the-harness.md)
- ADR-0011 — [AI SDK v6 surface: five places reality differed from the plan](ADR-0011-ai-sdk-v6-surface-deviations.md)

### `telemetry`

- ADR-0013 — [The price table refuses to invent a number](ADR-0013-the-price-table-refuses-to-invent-a-number.md)

### `tooling`

- ADR-0011 — [AI SDK v6 surface: five places reality differed from the plan](ADR-0011-ai-sdk-v6-surface-deviations.md)
