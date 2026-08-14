# ADR-0007 — A gate check states only what it proves

Status: Accepted
Date: 2026-08-12
Tags: process, gate

## Context

G1 has two clauses: an end-to-end mock conversation with full logging, **and** a
repeated call that demonstrably bills cached input.

`pnpm smoke` printed `G1 PASSED.` after a run that makes **zero model calls**
and therefore cannot test the second clause. the project working notes opened with "Phase 0
complete". Half a gate read as a whole one, and the remediation column for G1 is
"fix before authoring" — so the mislabel pointed at starting Phase 1 on an
unverified cost assumption.

The cache clause was in fact unmet: no key existed, and the one `smoke-live`
run directory on disk was **empty** — started, then aborted before a single call.

## Decision

A gate check reports only what it exercised, and names what covers the rest.

`pnpm smoke` now prints `G1 OFFLINE HALF PASSED` plus a pointer to
`smoke:live`. It deliberately does **not** say "G1 NOT MET" either — a $0
offline run cannot observe whether some other command proved the cache clause.
Both directions are claims it has no standing to make.

## Evidence

The mislabel survived a full CI pipeline — install, typecheck, lint, test,
offline smoke — because every one of those steps passed. Green checks were
correct; the summary line was not.

## Consequences

Slightly wordier output.

Applies to every future gate. G2-G16 have the same shape: several are partly
programmatic and partly manual, and any check that reports the gate id rather
than the clause will mislead the same way.
