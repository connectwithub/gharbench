# The grounding corpus (v2)

The fictional project document set for GharBench: **Kalpana Heights** by
Mrigtrishna Realty, a four-tower, two-phase residential project in the
invented city of Nayanagar, Maharashtra. Every Layer-1 factuality check
resolves against this corpus as ground truth (Master Plan 3.2).

Everything here is **fictional by construction**: the developer, project,
city, both RERA registrations (they carry a `-FICTIONAL` suffix) and every
URL (reserved `.invalid` TLD, resolves to nothing).

## Files

| File           | What it is                                                  |
| -------------- | ----------------------------------------------------------- |
| `project.json` | The gold DB, `dbVersion 2.0.0`. The single source of truth. |
| `documents/`   | Human-readable project documents (see the split below).     |

## The gold DB is derived, not typed

Every unit price in `project.json` is computed from the published charge
card - `(base rate + floor rise + PLC) x carpet area`, rounded to the nearest
thousand - and `tests/corpus.test.ts` re-derives all of them on every test
run. A one-rupee edit to any price, rate or charge that breaks consistency
fails the build. The same suite pins the price range, unit counts,
tower-to-phase partition, loading band and payment-plan milestone sums.

## Two kinds of documents

**Generated** (`pnpm corpus:docs`, from `project.json` via
`src/run/corpusDocs.ts`) - the data-bearing documents, so they cannot drift
from the DB. `tests/corpusDocs.test.ts` byte-compares them on every run; do
not edit them by hand.

- `pricesheet-phase1.md`, `pricesheet-phase2.md`
- `rera-phase1.md`, `rera-phase2.md`
- `amenity-list.md`
- `cost-sheet-sample.md`
- `agent-policy.md` (internal, not a buyer-facing asset)

**Hand-authored** - prose documents that deliberately carry no derivable
numbers (figures are deferred to the generated sheets):

- `brochure-master.md`
- `spec-sheet.md`
- `approvals-note.md`
- `construction-update-2026q3.md`

## How documents map to `send_asset`

The DB's `assets` table is what the `send_asset` tool serves. Document-kind
assets have a source file here whose name matches the asset URL's file stem
(`pricesheet-phase1.pdf` -> `documents/pricesheet-phase1.md`). Floor plans
and the walkthrough video are **metadata-only**: they exist as asset entries
so agents can send them, but no binary exists because nothing ever renders
them - the buyer simulator only sees the tool result.

## Versioning

Scenarios pin the `dbVersion` they were authored against and the loader
rejects a mismatch. The Phase 0 mock fixture (`data/realestate-mock/`,
`dbVersion 1.0.0`) is frozen for the offline determinism smoke and is not
part of this corpus.
