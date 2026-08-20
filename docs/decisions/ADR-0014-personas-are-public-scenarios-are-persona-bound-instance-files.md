# ADR-0014 — Personas are public; scenarios are persona-bound instance files split at authoring time

Status: Accepted
Date: 2026-08-20
Tags: architecture, process, determinism, reproducibility

## Context

Phase 1 turns the engine into a benchmark: 12 personas, 60–80 scenario
situations, ~150–250 persona×scenario instances, and a held-out private pool
(G16). Three shape questions had to be settled before authoring:

1. Are personas (with their hidden budgets and traps) public or private?
2. Is an "instance" produced by crossing personas × scenarios at runtime, or
   authored explicitly?
3. When is the public/private split decided?

## Decision

**Personas are public.** The persona table is the paper's centerpiece; hidden
fields are hidden *from the contestant at runtime* (they exist only in the
buyer simulator's context), not from readers. What must stay private is the
held-out scenario pool, not the cast.

**Instances are authored files, not runtime crossings.** Each scenario file is
one persona-bound instance, named `<baseId>.<personaId>.json`, stating that
pairing's exact ground truth (a P08 budget-mismatch ends in an honest cold
log; a P01 version of the same situation ends in a booking). A runtime
crossing cannot state per-pair ground truth, and the Phase 1 gate requires it.

**The split is tagged at authoring time** via a required `pool` field, with
private instances written directly into `private-pool/scenarios/` (gitignored
since Phase 0). The loader treats the private directory as optional so a
fresh public clone runs everything public without it.

The sampling procedure is deliberate authoring against floors enforced in code
(`pnpm gate:phase1`): ≥20 instances per family, ≥30 Hinglish, 60–80 base
situations, 150–250 instances, 25–35% private share, every difficulty tier in
every family. "Sampled properly" is a build outcome, not a claim.

## Evidence

The gate run on the 19-instance seed set (2026-08-20) reports referential
integrity OK, private share 26.3% (in band), non-buyer-outcome share 36.8%,
and every volume floor honestly UNMET — the remaining authoring work is a
number in a report, not a feeling.

## Consequences

More files than a crossing matrix, and adding a persona to a situation means
authoring its ground truth rather than flipping a matrix cell — that is the
point. Moving a scenario public later is a copy; moving one private later is
a history rewrite, so when in doubt scenarios are authored private. The
persona cards' publicness means a contestant *could* memorise archetypes; the
private pool's unseen situations are the contamination control, which is
exactly the LiveBench-style argument the paper makes.
