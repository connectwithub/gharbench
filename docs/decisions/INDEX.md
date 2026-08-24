# Decision index

Generated from `decisions.jsonl` — do not edit by hand.
Run `node scripts/decisions-index.mjs docs/decisions` after appending an entry.

27 decisions.

## By date

- **ADR-0022** (2026-08-24) — [Calibration labeler hardened: opaque case aliases and violation-polarity buttons](ADR-0022-labeler-blindness-aliases-and-polarity-ui.md)
- **ADR-0023** (2026-08-24) — [The labeler shows the judge's source documents and the gold DB](ADR-0023-labeler-ground-truth-reference.md)
- **ADR-0024** (2026-08-24) — [Pre-run pipeline hardening: contestant-aware check reports and gate completeness floors](ADR-0024-prerun-pipeline-hardening.md)
- **ADR-0025** (2026-08-24) — [Calibration judging: uniform prompt shape and no conduct-only item lists](ADR-0025-calibration-blindness-uniform-prompt.md)
- **ADR-0026** (2026-08-24) — [Shared rubric interpretation notes; disclosed rater-baseline adjudication](ADR-0026-shared-interpretation-notes-rater-baseline.md)
- **ADR-0027** (2026-08-24) — [Every calibration case records who ended the conversation](ADR-0027-endedby-on-calibration-cases.md)
- **ADR-0028** (2026-08-24) — [Buyer scaffolding leaks: 17 calibration cases purged, leak screen added, buyer prompt hardened](ADR-0028-buyer-scaffolding-leak-purge.md)
- **ADR-0021** (2026-08-21) — [Buyer guardrails hardened with an anti-repetition mandate after the G6 pilot audit](ADR-0021-anti-repetition-guardrail-after-g6-audit.md)
- **ADR-0014** (2026-08-20) — [Personas are public; scenarios are persona-bound instance files split at authoring time](ADR-0014-personas-are-public-scenarios-are-persona-bound-instance-files.md)
- **ADR-0015** (2026-08-20) — [Layer-1 checks fire only on quotable, context-anchored evidence](ADR-0015-checks-fire-only-on-quotable-context-anchored-evidence.md)
- **ADR-0016** (2026-08-20) — [OpenRouter routing is not behaviour-neutral: pin the host, use the chat surface](ADR-0016-openrouter-routing-is-not-behaviour-neutral.md)
- **ADR-0017** (2026-08-20) — [Buyer probes: frame breaks are zero-tolerance, scripted values are sanctioned, the human leg runs blind](ADR-0017-buyer-probes-frame-breaks-and-the-blind-human-leg.md)
- **ADR-0019** (2026-08-20) — [Judge scaffolding: offline-first, quote-then-verdict enforced structurally, polarity normalised once](ADR-0019-judge-scaffold-offline-first-quote-then-verdict-structural.md)
- **ADR-0020** (2026-08-20) — [Phases 6-10 scaffolded machine-first: every gate is code before any run is paid for](ADR-0020-phase6-10-scaffolding-machine-side-complete.md)
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
- ADR-0019 — [Judge scaffolding: offline-first, quote-then-verdict enforced structurally, polarity normalised once](ADR-0019-judge-scaffold-offline-first-quote-then-verdict-structural.md)
- ADR-0020 — [Phases 6-10 scaffolded machine-first: every gate is code before any run is paid for](ADR-0020-phase6-10-scaffolding-machine-side-complete.md)

### `blindness`

- ADR-0022 — [Calibration labeler hardened: opaque case aliases and violation-polarity buttons](ADR-0022-labeler-blindness-aliases-and-polarity-ui.md)
- ADR-0025 — [Calibration judging: uniform prompt shape and no conduct-only item lists](ADR-0025-calibration-blindness-uniform-prompt.md)
- ADR-0028 — [Buyer scaffolding leaks: 17 calibration cases purged, leak screen added, buyer prompt hardened](ADR-0028-buyer-scaffolding-leak-purge.md)

### `buyer`

- ADR-0021 — [Buyer guardrails hardened with an anti-repetition mandate after the G6 pilot audit](ADR-0021-anti-repetition-guardrail-after-g6-audit.md)
- ADR-0028 — [Buyer scaffolding leaks: 17 calibration cases purged, leak screen added, buyer prompt hardened](ADR-0028-buyer-scaffolding-leak-purge.md)

### `buyer-simulator`

- ADR-0017 — [Buyer probes: frame breaks are zero-tolerance, scripted values are sanctioned, the human leg runs blind](ADR-0017-buyer-probes-frame-breaks-and-the-blind-human-leg.md)

### `caching`

- ADR-0002 — [Cache-first prompt layout: stable prefix first, variable content last](ADR-0002-cache-first-prompt-layout.md)
- ADR-0003 — [Split "can place a breakpoint" from "reports cache reads"](ADR-0003-split-explicit-caching-from-cache-reporting.md)
- ADR-0004 — [OpenAI needs a stable promptCacheKey, or nothing caches](ADR-0004-openai-requires-stable-prompt-cache-key.md)
- ADR-0005 — [Do not send promptCacheOptions mode:explicit](ADR-0005-do-not-send-prompt-cache-options.md)

### `calibration`

- ADR-0022 — [Calibration labeler hardened: opaque case aliases and violation-polarity buttons](ADR-0022-labeler-blindness-aliases-and-polarity-ui.md)
- ADR-0023 — [The labeler shows the judge's source documents and the gold DB](ADR-0023-labeler-ground-truth-reference.md)
- ADR-0025 — [Calibration judging: uniform prompt shape and no conduct-only item lists](ADR-0025-calibration-blindness-uniform-prompt.md)
- ADR-0026 — [Shared rubric interpretation notes; disclosed rater-baseline adjudication](ADR-0026-shared-interpretation-notes-rater-baseline.md)
- ADR-0027 — [Every calibration case records who ended the conversation](ADR-0027-endedby-on-calibration-cases.md)
- ADR-0028 — [Buyer scaffolding leaks: 17 calibration cases purged, leak screen added, buyer prompt hardened](ADR-0028-buyer-scaffolding-leak-purge.md)

### `checks`

- ADR-0024 — [Pre-run pipeline hardening: contestant-aware check reports and gate completeness floors](ADR-0024-prerun-pipeline-hardening.md)

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

### `evaluation`

- ADR-0017 — [Buyer probes: frame breaks are zero-tolerance, scripted values are sanctioned, the human leg runs blind](ADR-0017-buyer-probes-frame-breaks-and-the-blind-human-leg.md)
- ADR-0019 — [Judge scaffolding: offline-first, quote-then-verdict enforced structurally, polarity normalised once](ADR-0019-judge-scaffold-offline-first-quote-then-verdict-structural.md)
- ADR-0020 — [Phases 6-10 scaffolded machine-first: every gate is code before any run is paid for](ADR-0020-phase6-10-scaffolding-machine-side-complete.md)
- ADR-0024 — [Pre-run pipeline hardening: contestant-aware check reports and gate completeness floors](ADR-0024-prerun-pipeline-hardening.md)

### `factuality`

- ADR-0023 — [The labeler shows the judge's source documents and the gold DB](ADR-0023-labeler-ground-truth-reference.md)

### `gate`

- ADR-0003 — [Split "can place a breakpoint" from "reports cache reads"](ADR-0003-split-explicit-caching-from-cache-reporting.md)
- ADR-0007 — [A gate check states only what it proves](ADR-0007-a-gate-check-states-only-what-it-proves.md)
- ADR-0015 — [Layer-1 checks fire only on quotable, context-anchored evidence](ADR-0015-checks-fire-only-on-quotable-context-anchored-evidence.md)
- ADR-0017 — [Buyer probes: frame breaks are zero-tolerance, scripted values are sanctioned, the human leg runs blind](ADR-0017-buyer-probes-frame-breaks-and-the-blind-human-leg.md)
- ADR-0020 — [Phases 6-10 scaffolded machine-first: every gate is code before any run is paid for](ADR-0020-phase6-10-scaffolding-machine-side-complete.md)
- ADR-0021 — [Buyer guardrails hardened with an anti-repetition mandate after the G6 pilot audit](ADR-0021-anti-repetition-guardrail-after-g6-audit.md)
- ADR-0024 — [Pre-run pipeline hardening: contestant-aware check reports and gate completeness floors](ADR-0024-prerun-pipeline-hardening.md)
- ADR-0028 — [Buyer scaffolding leaks: 17 calibration cases purged, leak screen added, buyer prompt hardened](ADR-0028-buyer-scaffolding-leak-purge.md)

### `harness`

- ADR-0016 — [OpenRouter routing is not behaviour-neutral: pin the host, use the chat surface](ADR-0016-openrouter-routing-is-not-behaviour-neutral.md)

### `judge`

- ADR-0022 — [Calibration labeler hardened: opaque case aliases and violation-polarity buttons](ADR-0022-labeler-blindness-aliases-and-polarity-ui.md)
- ADR-0023 — [The labeler shows the judge's source documents and the gold DB](ADR-0023-labeler-ground-truth-reference.md)
- ADR-0025 — [Calibration judging: uniform prompt shape and no conduct-only item lists](ADR-0025-calibration-blindness-uniform-prompt.md)
- ADR-0026 — [Shared rubric interpretation notes; disclosed rater-baseline adjudication](ADR-0026-shared-interpretation-notes-rater-baseline.md)
- ADR-0027 — [Every calibration case records who ended the conversation](ADR-0027-endedby-on-calibration-cases.md)

### `judge-panel`

- ADR-0019 — [Judge scaffolding: offline-first, quote-then-verdict enforced structurally, polarity normalised once](ADR-0019-judge-scaffold-offline-first-quote-then-verdict-structural.md)

### `process`

- ADR-0007 — [A gate check states only what it proves](ADR-0007-a-gate-check-states-only-what-it-proves.md)
- ADR-0008 — [Two decision logs, split by leakage risk](ADR-0008-two-decision-logs-split-by-leakage-risk.md)
- ADR-0010 — [No application framework in the harness; NestJS is the product stack](ADR-0010-no-application-framework-in-the-harness.md)
- ADR-0012 — [Gate sampling params per model instead of discovering the 400 mid-sweep](ADR-0012-gate-sampling-params-per-model.md)
- ADR-0013 — [The price table refuses to invent a number](ADR-0013-the-price-table-refuses-to-invent-a-number.md)
- ADR-0014 — [Personas are public; scenarios are persona-bound instance files split at authoring time](ADR-0014-personas-are-public-scenarios-are-persona-bound-instance-files.md)
- ADR-0015 — [Layer-1 checks fire only on quotable, context-anchored evidence](ADR-0015-checks-fire-only-on-quotable-context-anchored-evidence.md)
- ADR-0017 — [Buyer probes: frame breaks are zero-tolerance, scripted values are sanctioned, the human leg runs blind](ADR-0017-buyer-probes-frame-breaks-and-the-blind-human-leg.md)
- ADR-0019 — [Judge scaffolding: offline-first, quote-then-verdict enforced structurally, polarity normalised once](ADR-0019-judge-scaffold-offline-first-quote-then-verdict-structural.md)
- ADR-0020 — [Phases 6-10 scaffolded machine-first: every gate is code before any run is paid for](ADR-0020-phase6-10-scaffolding-machine-side-complete.md)
- ADR-0022 — [Calibration labeler hardened: opaque case aliases and violation-polarity buttons](ADR-0022-labeler-blindness-aliases-and-polarity-ui.md)
- ADR-0024 — [Pre-run pipeline hardening: contestant-aware check reports and gate completeness floors](ADR-0024-prerun-pipeline-hardening.md)
- ADR-0026 — [Shared rubric interpretation notes; disclosed rater-baseline adjudication](ADR-0026-shared-interpretation-notes-rater-baseline.md)

### `prompt`

- ADR-0021 — [Buyer guardrails hardened with an anti-repetition mandate after the G6 pilot audit](ADR-0021-anti-repetition-guardrail-after-g6-audit.md)
- ADR-0025 — [Calibration judging: uniform prompt shape and no conduct-only item lists](ADR-0025-calibration-blindness-uniform-prompt.md)

### `provider`

- ADR-0003 — [Split "can place a breakpoint" from "reports cache reads"](ADR-0003-split-explicit-caching-from-cache-reporting.md)
- ADR-0004 — [OpenAI needs a stable promptCacheKey, or nothing caches](ADR-0004-openai-requires-stable-prompt-cache-key.md)
- ADR-0005 — [Do not send promptCacheOptions mode:explicit](ADR-0005-do-not-send-prompt-cache-options.md)
- ADR-0006 — [No provider honours seed; live reproducibility rests elsewhere](ADR-0006-no-provider-honours-seed.md)
- ADR-0009 — [Pin floating model aliases to dated snapshots](ADR-0009-pin-dated-model-snapshots.md)
- ADR-0012 — [Gate sampling params per model instead of discovering the 400 mid-sweep](ADR-0012-gate-sampling-params-per-model.md)

### `providers`

- ADR-0016 — [OpenRouter routing is not behaviour-neutral: pin the host, use the chat surface](ADR-0016-openrouter-routing-is-not-behaviour-neutral.md)

### `reproducibility`

- ADR-0006 — [No provider honours seed; live reproducibility rests elsewhere](ADR-0006-no-provider-honours-seed.md)
- ADR-0009 — [Pin floating model aliases to dated snapshots](ADR-0009-pin-dated-model-snapshots.md)
- ADR-0014 — [Personas are public; scenarios are persona-bound instance files split at authoring time](ADR-0014-personas-are-public-scenarios-are-persona-bound-instance-files.md)
- ADR-0016 — [OpenRouter routing is not behaviour-neutral: pin the host, use the chat surface](ADR-0016-openrouter-routing-is-not-behaviour-neutral.md)

### `rubric`

- ADR-0026 — [Shared rubric interpretation notes; disclosed rater-baseline adjudication](ADR-0026-shared-interpretation-notes-rater-baseline.md)
- ADR-0027 — [Every calibration case records who ended the conversation](ADR-0027-endedby-on-calibration-cases.md)

### `schema`

- ADR-0027 — [Every calibration case records who ended the conversation](ADR-0027-endedby-on-calibration-cases.md)

### `scoring`

- ADR-0020 — [Phases 6-10 scaffolded machine-first: every gate is code before any run is paid for](ADR-0020-phase6-10-scaffolding-machine-side-complete.md)
- ADR-0024 — [Pre-run pipeline hardening: contestant-aware check reports and gate completeness floors](ADR-0024-prerun-pipeline-hardening.md)

### `simulator`

- ADR-0021 — [Buyer guardrails hardened with an anti-repetition mandate after the G6 pilot audit](ADR-0021-anti-repetition-guardrail-after-g6-audit.md)
- ADR-0028 — [Buyer scaffolding leaks: 17 calibration cases purged, leak screen added, buyer prompt hardened](ADR-0028-buyer-scaffolding-leak-purge.md)

### `stack`

- ADR-0010 — [No application framework in the harness; NestJS is the product stack](ADR-0010-no-application-framework-in-the-harness.md)
- ADR-0011 — [AI SDK v6 surface: five places reality differed from the plan](ADR-0011-ai-sdk-v6-surface-deviations.md)

### `telemetry`

- ADR-0013 — [The price table refuses to invent a number](ADR-0013-the-price-table-refuses-to-invent-a-number.md)

### `tooling`

- ADR-0011 — [AI SDK v6 surface: five places reality differed from the plan](ADR-0011-ai-sdk-v6-surface-deviations.md)

### `ui`

- ADR-0022 — [Calibration labeler hardened: opaque case aliases and violation-polarity buttons](ADR-0022-labeler-blindness-aliases-and-polarity-ui.md)
- ADR-0023 — [The labeler shows the judge's source documents and the gold DB](ADR-0023-labeler-ground-truth-reference.md)
