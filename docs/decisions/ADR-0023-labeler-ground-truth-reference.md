# ADR-0023 — The labeler shows the judge's source documents and the gold DB

Status: Accepted
Date: 2026-08-24

Tags: calibration, judge, ui, factuality

## Context

The rater hit a wall on the first factuality item: F1-F5 and several CP
items are judged "against the source documents", but the labeler showed no
documents — and no way to know whether a quoted price, a claimed amenity,
or "the Saturday 10:30 slot is free" was true. Meanwhile the LLM judges
receive the full source-document set verbatim in their system block
(`buildJudgeSystem`: "SOURCE DOCUMENTS (ground truth for every project
fact)"). The human answer key was **less informed than the judges it is
supposed to calibrate** — grounding items were unanswerable except from
memory, which is exactly how wrong ground truth gets minted.

## Decision

1. **`/api/reference` serves the rater the same 11 corpus documents the
   judges get** (byte-parity with `loadSourceDocuments` is test-pinned),
   plus a digest of the gold DB the agent's tools answered from: all 32
   units (carpet vs super-built-up, price, status), the 14 site-visit slots
   (capacity/booked), the agent policy (max discount, token amount,
   prohibited promises) and the project facts. The corpus is identical for
   every case, so this reveals nothing about any case's band, source or
   provenance — blindness is untouched.
2. **The UI renders it as a tabbed "Ground truth" panel** (Units / Slots /
   Policy / Project / Documents) above the transcript, and every
   grounding-dependent item carries a "check:" hint naming the tab or
   document that decides it. Conduct-rule CP items (CP5, CP7, CP8, CP10,
   CP11) are labeled as needing no document.
3. **A caveat rides the Units/Slots tabs**: the DB shown is
   start-of-conversation state; bookings during a conversation legitimately
   change availability and tool calls are invisible in the buyer-view
   transcript, so raters are told to prefer "Can't decide" where the agent
   could have learned different state mid-chat.

## Consequences

- The human key is now at least as informed as the judges — with the DB
  digest, slightly better informed, which is the right direction for an
  answer key: G8 measures whether judges can match humans, not the reverse.
- Layer-1 deterministic checks remain the authority on tool-level
  fabrication; the DB tabs let the human catch what surfaces in prose.
- Phase 7 inherits the panel via `--dir` like everything else in this tool.

Linked: ADR-0018, ADR-0019, ADR-0022.
