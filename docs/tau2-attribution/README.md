# τ²-bench attribution

GharBench's buyer simulator uses the **termination-token protocol** and the
**half-duplex orchestration pattern** introduced by τ-bench and τ²-bench. This
directory records where that came from and vendors the parts we reuse verbatim.

## What is vendored here

| File | Provenance |
| ---- | ---------- |
| `simulation_guidelines.md` | Verbatim copy of `data/tau2/user_simulator/simulation_guidelines.md` |
| `LICENSE` | Verbatim copy of the upstream `LICENSE` (MIT) |

**Source:** <https://github.com/sierra-research/tau2-bench>
**Tag:** `v1.0.1`
**Commit:** `fc0055dc4e0a316c3f83133267fbd6faaa770992`
**Retrieved:** 2026-08-01

Integrity of the vendored copies (verify before trusting them):

```
sha256(simulation_guidelines.md) = 740a29dfa64d7bc08eea3bf7493575b914a63f744acbaf7f199ee07eddaf72d3
sha256(LICENSE)                  = e67c5aa0074dfcaefd3c3a1aedb94cb539234aecd15d5a972574e3200e6252fe
```

**Verified against upstream on 2026-08-20.** Both files were re-fetched from
`raw.githubusercontent.com/sierra-research/tau2-bench/v1.0.1/` and hashed, and
both matched the values above byte for byte. That confirms the upstream *paths*
in the table as well as the copies themselves - until then the hashes only
proved the two local files had not drifted, not that they came from where this
file says they did.

```sh
curl -sL https://raw.githubusercontent.com/sierra-research/tau2-bench/v1.0.1/data/tau2/user_simulator/simulation_guidelines.md | sha256sum
curl -sL https://raw.githubusercontent.com/sierra-research/tau2-bench/v1.0.1/LICENSE | sha256sum
```

Re-run those two commands at freeze, and after any change to the pinned tag.

Upstream is MIT licensed (Copyright (c) 2025 Sierra Research). The licence text
is reproduced in full in `LICENSE`, as the licence requires. Do not edit the two
vendored files: if upstream changes, re-fetch at a new pinned tag and update the
hashes above.

## Papers to cite

- Yao, S. et al. *τ-bench: A Benchmark for Tool-Agent-User Interaction in
  Real-World Domains.* arXiv:2406.12045
- Barres, V. et al. *τ²-bench: Evaluating Conversational Agents in a Dual-Control
  Environment.* arXiv:2506.07982

Any GharBench write-up that reports pass^k, uses the termination tokens, or
describes the half-duplex loop must cite both.

## What GharBench takes, and what it does not

**Taken (verbatim, attributed):** the three termination tokens - `###STOP###`,
`###TRANSFER###`, `###OUT-OF-SCOPE###` - and their semantics, plus the
simulation-guidelines wording vendored above.

**Clean-room reimplementation, not copied code:** `src/engine/orchestrator.ts`
and `src/engine/tokens.ts`. These implement the *pattern* (one party speaks at a
time; the agent may loop against the environment between buyer turns) in
TypeScript against GharBench's own `Contestant` / `Buyer` / `Environment`
interfaces. No upstream Python was translated.

**Not taken:** upstream's domains, tasks, personas, tools, reward model or
leaderboard. GharBench's domain (Indian real-estate lead qualification over
WhatsApp), its 12 personas and its 60-80 scenarios are original work.

## Phase 1 usage

`src/simulator/buyer.ts` currently ships a GharBench-authored guardrail preamble
(`BUYER_GUARDRAILS`), written for a WhatsApp real-estate buyer rather than a
customer-service caller. In Phase 1, replace or merge it with the vendored
`simulation_guidelines.md` text so the buyer simulator's core instructions match
the published benchmark, and keep the attribution above alongside it.
