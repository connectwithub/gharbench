# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow package.json. Zenodo mints one DOI per released version plus a concept
DOI (ADR-0030) - every entry here is what a version DOI points at.

## [Unreleased]

### Added

- Judge order-robustness machinery: `--item-order=reversed` ablation pass,
  flip-rate / self-preference / leave-one-judge-out / length-bias metrics
  (`src/metrics/judgeAblations.ts`), protocol in `docs/judge-protocol.md`
  (ADR-0030, after SISTER).
- Scenario-clustered bootstrap CIs (`clusteredBootstrapMeanCi`).
- Contamination canary stamped across the private pool (`pnpm canary:stamp`).
- Release hygiene: `CITATION.cff`, code/data licence split (`LICENSE` MIT +
  `LICENSE-DATA` CC BY 4.0), this changelog, paper citation stubs (`paper/`).
- `endedBy`/`endedByTool` on calibration cases, shown to raters and judges
  (ADR-0027..0029).

## [0.1.0] - unreleased baseline (2026-08-28 state)

Phases 0-3 complete and gated: deterministic TS harness (orchestrator, six
tools, telemetry, $0 offline smoke), corpus v2, 12 personas, 150 scenario
instances (105 public / 45 held-out private), Layer-1 checks L1.1-L1.13
(G3: 20/20 seeded violations caught, 0 false fires), buyer-simulator pilot
(Qwen3-235B primary; G6 deviation audit MET), calibration set built (119
cases), judge panel + Phase 5-8 scaffolding executable end to end with honest
UNMET gates. No public release yet - 0.1.0 is tagged at the first Zenodo
deposit.
