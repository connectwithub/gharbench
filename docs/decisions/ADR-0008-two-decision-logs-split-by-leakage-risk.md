# ADR-0008 — Two decision logs, split by leakage risk

Status: Accepted
Date: 2026-08-13
Tags: process, architecture

## Context

Decisions were accumulating in `CLAUDE.md` under "API-surface deviations and
decisions". Two problems:

1. `CLAUDE.md` is a working guide. It gets rewritten as the project moves, so
   the reasoning behind a superseded decision is lost exactly when someone is
   about to re-derive it.
2. A benchmark cannot publish every decision it makes. Persona design, trap
   construction, rubric internals and scoring thresholds are the things a
   contestant would tune against.

## Decision

An append-only ADR log, in two parallel halves:

- `docs/decisions/` — **public**, committed, ids `ADR-NNNN`
- `docs/decisions-private/` — **gitignored**, ids `ADR-PNNNN`

The test for which: _would a contestant who read this be able to score better
without being a better sales agent?_ If yes, private. When unsure, private —
moving an entry public later is a copy-paste, moving it private later is a
history rewrite.

**Reference direction is one-way.** A private ADR may cite a public one. A public
ADR may never cite a private one — not its content and not its id, because an id
in a public file advertises that a hidden decision exists and titles leak more
than people expect.

Each ADR carries an **Evidence** section, which is an addition to the standard
shape and the reason this log is worth keeping for a benchmark.

## Evidence

The decisions seeded into this log at creation were all recoverable only from
this session's transcript or from prose buried in `CLAUDE.md` — including
ADR-0004, where the reasoning ("layout was right, routing was wrong") is the part
that matters and the part a diff does not show.

## Consequences

Two places to look, and a rule to apply every time.

`CLAUDE.md` becomes a guide that points at the log rather than a growing
decision record. The existing deviations section stays for now; entries migrate
as they are touched, rather than in one bulk rewrite that would lose the dates.

`INDEX.md` is generated and the build fails on any mismatch between
`decisions.jsonl` and the ADR files, so the index cannot silently drift.
