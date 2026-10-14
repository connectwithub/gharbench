# ADR-0035 — The buyer simulator sees only the trap modules a scenario arms

Status: Accepted
Date: 2026-10-14
Tags: simulator, scenarios, traps, checks, reproducibility

## Context

A scenario arms traps through `activeTrapIds`, which the schema defines as
"Persona trap ids armed in this scenario (subset of the card's traps)"
(`src/engine/scenario.ts`). Everything downstream assumes that an unarmed
trap stays silent. Rule 5 of ADR-0015 has L1.8 fire only in trap-free
scenarios. The G6 audit view lists only armed traps. Ground truth (`mustHold`,
expected outcome, judge applicability) is written for the armed set alone.

The buyer did not follow that rule. `buildBuyerSystemPrompt`
(`src/simulator/buyer.ts`) serialised `persona.hidden` whole, every trap
module included, and nothing on the buyer side read `activeTrapIds`. A
persona whose card carries a trap could therefore spring it, on its scripted
trigger turn, in a scenario that never armed it.

The cost falls on correct agents. The right answer to a sprung trap is often
an escalation, and `escalate_to_human` ends the flow. When the scenario
expects a site visit or a logged qualification, a correct escalation then
misses the expected tool calls. It fails L1.5 (oracle tools) or L1.6 (no
qualification logged) and loses programmatic score for doing the right
thing. No judge item covers the unarmed trap, so the judges cannot credit
the correct response either. An agent that gives in to the unarmed trap
instead can draw a C-tagged hard fail or a judge CP flag. The
leaderboard's hard-fail-by-trap table then files that under "(no-trap)",
because the scenario armed nothing.

Two author notes made it worse. P03's and P11's economics notes, and one of
P11's private facts, named the trap mechanism outright ("which is exactly what
the cash-component trap draws on", "the engine of the cash-component trap",
"every trap demands a written commitment"). That text reached the buyer in
every scenario, armed or not.

## Decision

1. `buildBuyerSystemPrompt` renders `hidden.traps` filtered to
   `activeTrapIds`. Every other card field renders as before. The spread
   keeps the key order of the hidden block, so a scenario that arms all of
   its card's traps, or binds a trap-free persona, renders byte-identical
   text (same buyer prompt sha).
2. The three author-note clauses are removed and the character facts behind
   them are kept. P03 and P11 move from 1.0.0 to 1.1.0, following the
   persona README's bump-on-behaviour-change rule.
3. The fix covers trap MODULES, the scripted, turn-triggered springs. It
   does not cover character pressure that resembles a trap, and that
   pressure stays by design. Some character fields still motivate trap-like
   asks: objection profiles, private facts, and consistency anchors (which
   are re-sent every turn). This applies chiefly to P11, the compliance
   stress-tester, and to a lesser degree P03 and P12. A real buyer with that
   background may raise these on their own. That is realism, not a scripted
   trap, and the scenario's ground truth has to tolerate it.
4. Opening messages are scenario data and are not filtered. Two exposed
   openers carry unarmed-trap material verbatim: scn_deep_005.P11 asks about
   amenities the project does not have, and scn_budget_005.P11 asks for a
   value guarantee. They are deliberate scenario content.
5. Tests pin the behaviour over every public scenario: armed ids present,
   unarmed ids and scripts absent, no "trap" text outside the rendered trap
   array, byte-identity for fully-armed and trap-free scenarios.

## Evidence

- Public exposure before the fix: 33 of 113 public scenarios bind a persona
  with at least one unarmed trap (P03, P04, P06, P10, P11, P12, all seven
  families); 26 of the 33 arm no trap at all. 20 of the 33 expect a site
  visit (17) or a logged qualification (3). Of those 20, 11 apply L1.5 and 2
  apply L1.6.
- No current scenario can trip L1.8's spurious-escalation branch. All 6
  exposed scenarios that list L1.8 either arm a trap or expect an
  escalation. The measured harm therefore runs through L1.5 and L1.6, not
  L1.8.
- Rendering simulated over the 113 public scenarios: the filter alone
  changes exactly the 33 exposed prompts and leaves the other 80
  byte-identical. The P03/P11 text edits alone change all 22 P03 and P11
  prompts. Together, 37 prompts change. The offline-smoke fixture arms both
  of its traps, and its buyer prompt sha is unchanged.
- The 7 exposed public compliance_trap scenarios each arm exactly one trap,
  and their `mustHold` covers only that trap. No public scenario relied on
  an unarmed trap firing.
- P12 carries one carpet-loading module and one accuracy-probe module. Both
  are filtered in its four trap-free scenarios, as intended.
- The P11 private fact is reworded, not just trimmed: "every trap demands a
  written commitment" became "she demands a written commitment on every
  claim". That is consistent with her existing "everything in writing"
  anchor, and the 1.1.0 bump covers it.

## Consequences

- The buyer prompt sha changes for 37 public scenarios: the 33 exposed ones
  plus the fully-armed P03 and P11 scenarios, whose card text changed. This
  is pre-Phase 6, like ADR-0021 and ADR-0028. The comparability key is the
  per-scenario `buyerPromptSha256` recorded in every sweep manifest. P04,
  P06, P10 and P12 change behaviour in their unarmed scenarios without a
  card bump, because their cards did not change.
- The Phase 3 pilot and the calibration sweeps were generated under the old
  behaviour, and their transcripts stand as recorded. When `pnpm checks` is
  re-run on them (the ADR-0024 follow-up), an L1.5 or L1.6 miss after a
  correct escalation in reply to an unarmed trap is a known artefact of that
  data.
- The G6 audit server rebuilds the buyer prompt from current code, so for
  runs made before this change it no longer shows the exact prompt that was
  sent. The recorded sha is the reference for those runs.
- Character pressure means unarmed scenarios can still see trap-like asks
  from P11 and P03. The Phase 6 G6 spot-check should count those springs,
  separately from asks that a scripted opener carries. If
  they are material, the fix is a persona revision with its own ADR, not a
  wider filter.
- Reversible by dropping the filter. The persona text change is independent
  and should stay.
