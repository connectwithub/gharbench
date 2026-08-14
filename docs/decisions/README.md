# Decision log

Append-only project memory. Every decision that future work should not have to
re-derive lives here, one ADR per decision — **not** in the project working notes, which is a
working guide and gets rewritten. An ADR is never rewritten.

## Files

| file                 | what it is                                  |
| -------------------- | ------------------------------------------- |
| `ADR-NNNN-<slug>.md` | one decision, authored by hand, append-only |
| `decisions.jsonl`    | one JSON line per ADR — the queryable index |
| `INDEX.md`           | **generated**; do not edit                  |

```sh
pnpm decisions:index      # rebuild INDEX.md for both logs
```

The index build fails if an ADR file has no `decisions.jsonl` entry or vice
versa, so the two cannot silently drift.

## Two logs, and the rule for choosing

There are two parallel logs. This one is **public** and committed. The other,
`docs/decisions-private/`, is **gitignored and must stay that way**.

|           | `docs/decisions/` (this one) | `docs/decisions-private/`                |
| --------- | ---------------------------- | ---------------------------------------- |
| id prefix | `ADR-NNNN`                   | `ADR-PNNNN`                              |
| in git    | yes                          | **never**                                |
| holds     | how the harness is built     | anything a contestant could tune against |

**Public** — stack and architecture, API-surface deviations, caching and cost
mechanics, determinism, tooling, conventions, process. Anything that helps a
reader understand or reproduce the harness.

**Private** — buyer-persona design and hidden fields, scenario taxonomy
specifics, compliance-trap construction, judge-rubric internals, scoring
thresholds and weights, calibration-set composition, anything about the held-out
pool, and commercial or funding strategy.

The test is the one from G16: _would a contestant who read this be able to score
better without being a better sales agent?_ If yes, it is private. When genuinely
unsure, put it in the private log — moving an entry public later is a copy-paste,
moving it private later is a history rewrite, and a leaked benchmark cannot be
un-leaked.

### Reference direction is one-way

A **private ADR may cite a public one**. A **public ADR must never cite a private
one** — not its content, and not its id. A private-log id in a public file
tells a reader a hidden decision exists and roughly where it sits, and titles leak
more than people expect. Public ADRs stand alone.

## Adding one

1. Pick the log using the rule above.
2. Next id = highest existing + 1, in that log.
3. Write `ADR-NNNN-<slug>.md` using the template below.
4. Append one line to that log's `decisions.jsonl`.
5. Run `pnpm decisions:index`.

Never edit an accepted ADR. To reverse one, write a new ADR and set the old
entry's `superseded_by` (and its `Status:` line) to point at it. The wrong turn
is part of the record — a log that hides its reversals cannot be trusted to
tell you what was already tried.

```markdown
# ADR-NNNN — <title>

Status: Accepted
Date: YYYY-MM-DD
Tags: tag-one, tag-two

## Context

Why the decision was needed. What was observed.

## Decision

What was decided, stated so someone can act on it.

## Evidence

Measured numbers, run ids, error text. Omit only if genuinely none exist.

## Consequences

The trade-off accepted, and what breaks if this is undone.
```

The **Evidence** section is an addition to the standard ADR shape and it is the
point of this log for a benchmark project. "We set `cacheControl`" is not
evidence; "call 1 wrote 33,337 tokens and call 2 read 33,337 in run
`20260813T091118Z-smoke-live`" is. A decision recorded without its evidence
cannot be re-checked when a provider changes under you.

## Tags in use

`stack`, `architecture`, `caching`, `cost`, `determinism`, `provider`,
`telemetry`, `tooling`, `process`, `gate`, `attribution`, `reproducibility`

Reuse the exact spelling — a tag spelled two ways is invisible to a search.
