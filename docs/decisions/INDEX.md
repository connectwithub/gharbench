# Decision index

Generated from `decisions.jsonl` — do not edit by hand.
Run `node scripts/decisions-index.mjs docs/decisions` after appending an entry.

8 decisions.

## By date

- **ADR-0006** (2026-08-13) — [No provider honours seed; live reproducibility rests elsewhere](ADR-0006-no-provider-honours-seed.md)
- **ADR-0008** (2026-08-13) — [Two decision logs, split by leakage risk](ADR-0008-two-decision-logs-split-by-leakage-risk.md)
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

### `caching`

- ADR-0002 — [Cache-first prompt layout: stable prefix first, variable content last](ADR-0002-cache-first-prompt-layout.md)
- ADR-0003 — [Split "can place a breakpoint" from "reports cache reads"](ADR-0003-split-explicit-caching-from-cache-reporting.md)
- ADR-0004 — [OpenAI needs a stable promptCacheKey, or nothing caches](ADR-0004-openai-requires-stable-prompt-cache-key.md)
- ADR-0005 — [Do not send promptCacheOptions mode:explicit](ADR-0005-do-not-send-prompt-cache-options.md)

### `cost`

- ADR-0002 — [Cache-first prompt layout: stable prefix first, variable content last](ADR-0002-cache-first-prompt-layout.md)
- ADR-0004 — [OpenAI needs a stable promptCacheKey, or nothing caches](ADR-0004-openai-requires-stable-prompt-cache-key.md)

### `determinism`

- ADR-0001 — [The Environment is the only place tools execute](ADR-0001-environment-is-the-only-tool-execution-site.md)
- ADR-0006 — [No provider honours seed; live reproducibility rests elsewhere](ADR-0006-no-provider-honours-seed.md)

### `gate`

- ADR-0003 — [Split "can place a breakpoint" from "reports cache reads"](ADR-0003-split-explicit-caching-from-cache-reporting.md)
- ADR-0007 — [A gate check states only what it proves](ADR-0007-a-gate-check-states-only-what-it-proves.md)

### `process`

- ADR-0007 — [A gate check states only what it proves](ADR-0007-a-gate-check-states-only-what-it-proves.md)
- ADR-0008 — [Two decision logs, split by leakage risk](ADR-0008-two-decision-logs-split-by-leakage-risk.md)

### `provider`

- ADR-0003 — [Split "can place a breakpoint" from "reports cache reads"](ADR-0003-split-explicit-caching-from-cache-reporting.md)
- ADR-0004 — [OpenAI needs a stable promptCacheKey, or nothing caches](ADR-0004-openai-requires-stable-prompt-cache-key.md)
- ADR-0005 — [Do not send promptCacheOptions mode:explicit](ADR-0005-do-not-send-prompt-cache-options.md)
- ADR-0006 — [No provider honours seed; live reproducibility rests elsewhere](ADR-0006-no-provider-honours-seed.md)

### `reproducibility`

- ADR-0006 — [No provider honours seed; live reproducibility rests elsewhere](ADR-0006-no-provider-honours-seed.md)
