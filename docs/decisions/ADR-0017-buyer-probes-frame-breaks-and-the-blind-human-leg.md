# ADR-0017 — Buyer probes: frame breaks are zero-tolerance, scripted values are sanctioned, the human leg runs blind

Status: Accepted
Date: 2026-08-20
Tags: evaluation, buyer-simulator, gate, process

## Context

Phase 3 validates the buyer simulator — the instrument every agent score
inherits. The Master Plan (§8 Phase 3) names the probes (budget leakage,
premature termination, over-cooperation, walk-away execution, human
"obviously an AI" spot-checks) but not their operational definitions, and the
pilot surfaced three interpretation problems:

1. Some scenarios _script_ the exact hidden ceiling into the authored
   `openingMessage` (scn_budget_006 opens "Our full and final budget is 85
   lakhs"). Counting its restatement as leakage punishes consistency.
2. Every P09 instance expects `qualification_logged`/cold: the _agent_ closing
   the file is the correct outcome, and demanding a buyer-initiated
   `###STOP###` scores the agent's promptness against the buyer.
3. The 32B buyer pasted its private `<simulation-reminder>` block into 16
   replies across 8/20 conversations — caught by human review, not by any
   machine probe. The echoes also polluted the leak counts, because
   consistency anchors contain the very numbers the leak probe hunts ("Never
   reveal the 75L cap").

## Decision

`pnpm probes --run=<runId>` (`src/run/pilotProbes.ts`) implements:

1. **Leakage = a stated hidden reservation value**, extracted with the L1
   machinery (ADR-0015 discipline: explicit context, tolerance-0 at stated
   precision, under-extraction acceptable). Split `volunteered` vs `elicited`
   by whether the preceding agent message asked something money-shaped; the
   ≤5%-of-turns gate is on volunteered. Values the scenario itself scripts
   (openingMessage, buyerReturnMessage) are sanctioned for that conversation.
2. **Walk-away is executed** when a P09 conversation ends with no successful
   booking via the buyer's STOP _or_ a flow-ending tool. Bookings,
   ###TRANSFER### and max_steps grinds are failures.
3. **Frame breaks are their own probe with a zero-tolerance gate.** An echoed
   reminder hands the agent the buyer's hidden brief and voids the
   conversation for agent scoring. Echoed blocks are stripped before leak
   extraction so one failure is not double-counted as another.
4. **The human leg runs blind**: transcripts from both candidate models are
   shuffled with model identity hidden from the rater; the ≤20%
   "obviously an AI" gate is computed per model after decoding. Frame-break
   species that resist zero-false-fire regexes (narrated stage directions
   like "(voice note style)") stay human-detected by design.

## Consequences

- Pilot verdict (2026-08-20, runs 20260820T140309Z / 20260820T130934Z):
  Qwen3-235B passes every gate (1.1% volunteered leakage, 0 premature stops,
  0 over-cooperation, 3/3 ghosts, 0 frame breaks, 0/5 blind flags, realism
  1.8/2) and is the confirmed primary. Qwen3-32B fails frame breaks (16/8),
  premature stops (2) and the blind review (5/5 flagged, 0.2/2) — kept only
  as a disclosed sensitivity slice.
- Human ratings are archived next to the runs (`spotcheck-human.json`), and
  the single-rater pilot protocol is explicitly _not_ the Phase 7 validation
  (three blinded raters, ~200 conversations).
