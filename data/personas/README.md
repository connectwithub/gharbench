# The 12 buyer personas

Machine-readable persona cards (Master Plan 3.5-3.6), one JSON file per
persona, validated against `personaCardSchema` in `src/simulator/persona.ts`.
`tests/personas.test.ts` validates every card and pins the design couplings
between personas and the corpus (who can afford what, and who deliberately
cannot).

These cards are **public by design** - the persona table is the paper's
centerpiece. The `hidden` blocks are hidden _from the contestant at runtime_
(they live only in the buyer simulator's context), not from readers of the
benchmark. What stays out of the public repo is the private scenario pool,
not the personas.

## Authoring status

| ID  | Persona                                | Difficulty | Status   |
| --- | -------------------------------------- | ---------- | -------- |
| P01 | Rohit & Sneha (first-time)             | easy       | authored |
| P02 | Anjali (single woman)                  | medium     | authored |
| P03 | Suresh (upgrader, joint family)        | hard       | pending  |
| P04 | Vikram (yield investor)                | hard       | pending  |
| P05 | Deepak (appreciation speculator)       | hard       | pending  |
| P06 | Priya (NRI, US)                        | hard       | pending  |
| P07 | Mr. & Mrs. Iyer (retirement)           | medium     | authored |
| P08 | Farhan (affordable, Tier-2)            | medium     | authored |
| P09 | Karan (window-shopper)                 | hard       | pending  |
| P10 | "Rajesh" (broker posing as buyer)      | hard       | pending  |
| P11 | Mrs. Kapoor (compliance stress-tester) | hard       | pending  |
| P12 | Arjun (deep-factual grinder)           | hard       | pending  |

Authoring order follows the master plan's time-squeeze priority: the four
baseline personas first (P01, P02, P07, P08), then the four hard/adversarial
ones with the widest scenario coverage (P03, P04, P06, P11), then the rest.

## Conventions

- Budget bands follow ANAROCK segmentation; per-persona ceilings are reasoned
  archetypes calibrated to distribution-level data (RBI LTV caps, FOIR-based
  EMI ceilings). Flag them as illustrative in the paper.
- Every card scripts its own disengagement (`behavioralControls`): walking
  away is an instruction, not an emergent hope. See the simulator
  failure-mode mandates in Master Plan 3.9 for why this is load-bearing.
- Traps are typed against the Master Plan 3.8 taxonomy and carry the
  known-correct agent response, so judges score against ground truth.
- Bump a card's `version` on any behavioral change; run manifests record
  persona versions, and a result produced against persona 1.0.0 is not
  comparable to one against 1.1.0.
