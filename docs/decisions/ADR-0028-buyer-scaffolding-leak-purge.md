# ADR-0028 — Buyer scaffolding leaks: 17 calibration cases purged, leak screen added, buyer prompt hardened

Status: Accepted
Date: 2026-08-24

Tags: calibration, simulator, buyer, blindness, gate

## Context

A rater found `<simulation-reminder>` text inside a buyer message. Scanning
all 136 calibration cases: **17 real cases (38 buyer messages) contain a
reminder-style block the buyer model wrote itself** — not an echo of the
harness-injected block (whose body is the consistency anchors) but a
self-authored imitation of the scaffolding format carrying the buyer's
HIDDEN brief verbatim: "Hidden budget ceiling: 75L", stretch rules,
walk-away triggers. The agent read those turns, so every subsequent agent
behavior is contaminated — the conversation is void for agent scoring, the
same verdict the Phase 3 pilot passed on the 32B's reminder echoes.

Why it survived: the frame-break probe (zero tolerance) was only ever run
on the pilot runs, where the 235B scored 0/20. The calibration sweeps
(20260820T152958Z + top-ups, same 235B buyer) were never probed, and
`calibration:build` had no screen. Leak rate there: 17/135 conversations
(~13%) — the pilot's clean 20 was evidently favourable sampling.

## Decision

1. **Purged the 17 cases** (calibration set: 136 → 119; the phase-4 size
   floor is 100–300 and every family/band floor still passes). One already-
   saved rater label belonged to a purged case; it is archived under
   `calibration/labels/archived-purged/`, not counted, not deleted.
2. **Every case builder screens for leaks** (`buyerLeakMarker` in
   calibrationBuild, wired into calibrationBuild AND humanSample):
   reminder tags, card vocabulary ("hidden budget", "walk-away trigger",
   "stretch possible", "consistency anchor"), stop-token text (engine
   strips real ones, so in-text occurrence = leak), `<scenario>`, and the
   "(no reply yet)" filler. Validated 0 false positives over the surviving
   119; test-pinned.
3. **Buyer prompt hardened** (GharBench-authored Private-reminders
   section): "Never write such a block yourself - no bracketed notes,
   reminders, tags or meta-comments... Your reply is only the WhatsApp
   message text." Test-pinned; buyer prompt sha changes again (still
   pre-Phase 6, so no run continuity breaks).
4. **Runbook rule: every sweep runs `pnpm probes` before anything consumes
   it** — calibration builds, judging, sampling. The pilot proved the probe
   works; this incident proves skipping it is how contamination gets in.

## Consequences

- The 50-slice contained 7 purged cases and was regenerated; colleague
  raters had not started.
- Rater case numbering shifts (aliases are positional over the surviving
  set).
- The 235B buyer's leak propensity is now a documented, paper-worthy
  finding: 0/20 on the pilot slice vs ~13% on the calibration sweeps.
  Re-measure after the prompt hardening at the Phase 6 G6 spot-check; if
  the rate stays material, the simulator decision may need revisiting with
  a bigger audit sample.
- A future calibration top-up sweep (fresh conversations under the hardened
  prompt) can restore n toward 136 if Phase 5 statistics want it; 119 is
  gate-legal today.

Linked: ADR-0016, ADR-0017, ADR-0021, ADR-0022, ADR-0025.
