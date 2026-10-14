# ADR-0036 — Canonical v1 verdict set; a stray judge process explains the 2026-09-20 spend gap; the runner locks verdict dirs

Status: Accepted
Date: 2026-10-14
Tags: judge, calibration, reproducibility, provenance, harness, phase-5

## Context

judge-protocol section 7 rule 3 requires the paper to report the v1 kappa
set beside every later one. A diagnosis of the SA1 anchor on 2026-10-14
found that the v1 verdicts on disk do not match the published v1 numbers.

On 2026-09-20 a three-judge calibration pass started at 10:38Z and was
never stopped. It kept running after the v1 agreement run (11:06Z) and
rewrote verdict files until 11:28Z:

- all 476 Maverick primary files;
- 79 Mistral primary files, 48 of them in the 55 seconds between the
  agreement run and the next private-repo commit.

Its meta file records 1,928 calls and $19.60 metered. That spend is not in
the $27.2 the working notes reported for the day. The 2026-09-20 dashboard
residual ($42.90 vs $27.5 metered) had stayed unexplained, and this pass is
its likely source.

The 2026-09-21 archive (`calibration/archive/v1-2026-09-20/`) was taken
after those rewrites, so it is not the published v1 state. The closest
surviving copy is the private overlay-repo commit `79921bd` (11:07:22Z).
It predates every stray Maverick write. It still carries the 48 Mistral
files changed after the agreement run, so its agreement-time form is lost
for those files.

The same session also showed a second concurrency defect. Two per-judge
processes that start in the same second write the same meta file name, and
one overwrites the other's record (ADR-0034).

## Decision

1. **Canonical v1.** The canonical v1 verdict set is the private overlay-repo
   commit `79921bd`. It is extracted read-only to
   `calibration/archive/v1-canonical-79921bd/`: judgments, reversed
   judgments, self labels, cases, slice-50, expected sidecars, and that
   commit's agreement and order-flip files. Every v1 figure in the paper is
   computed from it with `judge:agreement --base-dir`. The figures quoted
   on 2026-09-20 are superseded where they differ, and the differences are
   disclosed.
2. **The older archive is kept, not canonical.** `calibration/archive/v1-2026-09-20/`
   stays as a record of the post-stray state.
3. **The runner takes a lock.** It holds a per-(judge, verdict directory)
   lock at `<baseDir>/meta/<judgeSlug>.lock`, created exclusively and
   released after the meta write or on SIGINT/SIGTERM. A live lock is
   refused. A stale lock is reported, never taken over silently.
4. **Meta pass files are named per judge:**
   `<ts>-<judgeSlug or multi>[-reversed]-pass.json`.

## Evidence

- File mtimes, stored `ts` fields and the private repo history all match
  the stray-pass timeline. Its meta file has 1,423 judged and 159 errored.
- **Recompute vs the committed v1 file.** `judge:agreement --base-dir`
  recomputes v1 from the `79921bd` extract. The canonical figures are the
  recomputed ones.

  The committed file was written at 11:06Z. The verdicts in the snapshot
  include the 48 Mistral files changed before the 11:07Z commit. That
  explains the small drifts below.

  | figure                  | committed file    | recompute (canonical) |
  | ----------------------- | ----------------- | --------------------- |
  | G8a factuality          | 0.327             | 0.327                 |
  | G8a compliance          | 0.463             | 0.455                 |
  | G8a salesEffectiveness  | 0.460 (216 units) | 0.474 (212 units)     |
  | G8a conversationQuality | 0.024             | 0.024                 |
  | SA1                     | 0.287             | 0.246                 |
  | QA1                     | 0.079             | 0.059                 |
  | compliance precision    | 0.70              | 0.70                  |

  The conversationQuality "-0.003" quoted in the working notes, ADR-0033
  and judge-protocol traces to no committed file. Every v1 reconstruction
  of SA1 lands between 0.25 and 0.29.

- **Free test-retest.** The stray rewrite resampled Maverick with the same
  prompt and host. 19 of 83 paired SA1 scores differ (23%), and the
  weighted kappa between the two runs is 0.847.
- **Second collision.** On 2026-10-14 Grok's primary meta replaced
  Mistral's, which had the same start second (ADR-0034).

## Consequences

- v1 numbers in the paper may differ slightly from the ones quoted on
  2026-09-20. They are computed from one declared set and the differences
  are listed.
- A crashed or killed pass now leaves a lock that a person must clear. That
  friction is accepted, because a silent second writer corrupts a verdict
  set.
- Reversible: delete the lock code. The canonical v1 choice is a reporting
  decision and does not change any verdict.
