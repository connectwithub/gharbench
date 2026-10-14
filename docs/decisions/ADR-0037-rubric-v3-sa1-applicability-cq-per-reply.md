# ADR-0037 — Rubric v3: SA1 asked only where an objection is declared, SalesScore reads applicable anchors, CQ judged reply by reply

Status: Accepted
Date: 2026-10-14
Tags: judge, rubric, calibration, agreement, composite, phase-5

## Context

The rubric v2 re-judge (ADR-0033, ADR-0034) left judge-vs-human agreement
(G8a, kappa vs the self labels) below 0.6 on every dimension:

|        | factuality | compliance | salesEffectiveness | conversationQuality |
| ------ | ---------- | ---------- | ------------------ | ------------------- |
| v2 G8a | 0.413      | 0.464      | 0.446              | 0.154               |

Two anchors collapsed or stayed very low: SA1 (objection handling) fell to
0.053 from 0.246 in the canonical v1 set (ADR-0036), and QA1 was 0.170.
Two offline diagnoses followed.

**SA1.** SA1's text was byte-identical in v1 and v2. The whole drop sat in
the third of conversations where the buyer raised no objection. SA1 had no
not-applicable rule, so every rater invented a default. The human and the
v1 judges scored those conversations 3. The v2 judges scored them 0, after
the surrounding SE notes added "absence is not met" wording. Restoring the
v1 scores on those units alone returns kappa to the v1 level. On
conversations with a real objection, v2 slightly improved.

**conversationQuality.** Most of the v2 gain came from the panel's pass
rates moving toward the human's, not from agreement on individual
conversations. Three things blocked further progress:

- CQ3 asked the judges to catch false "I can't send that" claims, but they
  never see the sendable-asset list.
- The corpus contradicts itself on RERA certificates: the agent policy says
  to escalate RERA documentation, while both certificates are sendable.
- CQ1's chunking rule asked for separate messages, but the harness sends one
  message per turn.

## Decision

1. **SA1 is asked only where the scenario declares SE6** (the scenario arms
   a buyer objection).
   - The rubric carries the rule as data: `appliesWithItem: "SE6"` on SA1.
     `src/judge/anchorApplicability.ts` is the single implementation. The
     judge prompt, the output parser, the labeler and the scoring code all
     use it.
   - The rule is fixed when the scenario is authored (Master Plan I4/D2),
     never decided by a judge.
   - SA1 gains a shared no-objection rule: no objection voiced and none
     dismissed scores 3. Its level 3 now requires a concrete next step (a
     slot, a day or time, a callback with a time, or a named handoff).
   - SE6 gains the matching note.
2. **The SalesScore reading is amended** (judge-protocol section 6, dated
   2026-10-14, before any Phase 6 result).
   - The anchor term is the mean over the sales anchors that apply.
   - The binary fraction alone applies only when no sales anchor applies.
   - The 0.5/0.5 blend and every weight are unchanged.
   - The literal frozen reading is reported as a sensitivity row: any
     inapplicable anchor drops SalesScore to the binary fraction.
   - The new reading applies to verdicts under itemsVersion 3.0.0 or later.
     Earlier runs score exactly as before.
3. **CQ1 is judged by message shape.** Answering the buyer's own
   multi-part question in one message passes. It fails only on an
   email- or document-shaped reply: a salutation or sign-off, headed
   sections, or material the buyer did not ask for.
4. **CQ3 is judged reply by reply.**
   - One failing reply fails CQ3.
   - A claim of "I don't have that" or "I can't send that" is checked
     against the documents and the 17 sendable assets, now listed in the CQ3
     note.
   - Whether a figure or an availability statement is true is F1 and CP3,
     never CQ3.
   - The CQ3 note says it takes precedence over the shared "default to
     passing" bias control. That override lives inside the CQ block, so the
     shared text stays byte-identical.
5. **RERA certificates (owner decision).** Sending a listed RERA certificate
   when the buyer asks for it answers the buyer. The policy's must-escalate
   rule covers legal questions about the documents. This is settled in the
   rubric. The corpus is not edited, because a corpus edit would change
   every dimension's source-document block.
6. **QA1 is scored on every conversation.** It gains English examples,
   observable markers separating 2 from 3, and a note that it scores how the
   agent writes, not whether the content is true.
7. **Scope.** Only the salesEffectiveness and conversationQuality judge
   prompts change. The factuality and compliance prompts are byte-identical
   in both item orders, pinned by test. Their v2 verdicts carry forward
   under judge-protocol section 7 rule 4. The re-judge covers SE and CQ
   only, primary plus the reversed slice.

## Evidence

- SA1 decomposition, on the 98 units shared by v1 and v2:
  - kappa 0.249 under v1, 0.057 under v2;
  - restoring v1 panel scores on the 32 no-objection units alone gives
    0.255;
  - on objection cases, 0.286 under v1 and 0.334 under v2.
- **Judge defaults.** Among scores whose justification said no objection was
  raised, 43 of 68 were 3 under v1 and 53 of 79 were 0 under v2. An
  independent recount found the same direction.
- **The flip is not a selection effect.** Grok had no format errors in
  either version and still flipped its default.
- **SA1 counterfactual.** Applicability plus the no-objection rule, applied
  to the v2 verdicts, gives SA1 about 0.30 on the 61 declared units.
- **CQ counterfactual.** These estimates are optimistic, because the
  categories were assigned by reading the disagreements. Pooled CQ kappa:

  | fixes applied                  | pooled CQ  |
  | ------------------------------ | ---------- |
  | v2 today                       | 0.154      |
  | fact-routing + CQ1             | about 0.27 |
  | + asset list and the RERA rule | about 0.39 |
  | + human re-check               | about 0.47 |

  QA1 is expected to stay around 0.2 to 0.3.

- **Smoke** (5 cases x 2 dimensions x 3 judges, plus 1 reversed case, $0.51):
  0 structured errors. SA1 appeared exactly on the SE6-declared cases, in
  both item orders.
  - Mistral scored QA1 0 twice: once as "not applicable" and once for
    policy-breaking content.
  - QA1's level 0 now says it is never a not-applicable score and never a
    content score. The 18 CQ smoke verdicts were discarded and re-judged.
- **The v3 re-judge, 2026-10-14.** It covered SE and CQ, 119 primary and 50
  reversed per judge, 0 transport failures.
  - Structured errors: Grok 0, Mistral 9 primary + 1 reversed (3.8%),
    Maverick 5.
  - Metered spend was $12.90, and the key's usage rose by $12.9031, so they
    agree to the cent.
  - G8a vs the self labels (labels not yet re-checked under v3):

    |                              | v1 (canonical) | v2    | v3               | within-item null |
    | ---------------------------- | -------------- | ----- | ---------------- | ---------------- |
    | salesEffectiveness           | 0.474          | 0.446 | 0.465            | 0.101            |
    | conversationQuality          | 0.024          | 0.154 | 0.361            | 0.052            |
    | SA1, SE6-declared cases only | 0.242          | 0.153 | 0.417 (62 units) |                  |
    | SA2                          | 0.334          | 0.402 | 0.487            |                  |
    | QA1                          | 0.059          | 0.170 | 0.193            |                  |

  - Factuality (0.413) and compliance (0.464) carry forward from v2.
  - Inter-judge alpha on the anchors is 0.586.
  - Order flips (pooled): SE 0.138, CQ 0.136, anchors 0.238. Every one
    breaches the 0.10 threshold, close to the ~15% same-prompt resample
    noise measured for Maverick.
- **Prompt confinement.** With the v3 text in place, the factuality and
  compliance system prompts hash to their v2 values in both item orders
  (b9980d9d / 97a3a142 and 57915dda / dc292954).

## Consequences

- **I4 trade-off.** An objection a buyer raises unprompted, in a scenario
  that does not declare SE6, is never scored by SA1. That is the cost of
  keeping applicability out of the judges' hands.
- **SA2's weight rises.** Inside SalesScore, SA2 goes from 0.25 to 0.5 on
  scenarios that declare no objection. Disclosed via the amendment and the
  sensitivity row.
- **Human re-check.** SA1 is re-checked on the 65 SE6-declared calibration
  cases, together with the 3 human can't-decide answers there. About 13 CQ
  positions are re-checked too. SA1 answers already given on undeclared
  cases stay on disk unpaired.
- **The bar.** If v3 SA1 or QA1 stays below 0.4, the Master Plan
  "redesign" band applies. The options there are a binary split or a
  programmatic sub-check. The weights still cannot change.
- **Reporting.** The paper reports v1 (canonical), v2 and v3 side by side.
- **Reversible.** Restoring the v2 text and dropping `appliesWithItem`
  returns the v2 prompts exactly. The v2 verdicts are archived in full.
