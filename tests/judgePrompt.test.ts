/**
 * Judge prompt construction: the cache-first invariant (system block
 * byte-identical across cases) and the blindness invariant (band / source /
 * provenance never reach a judge - they are the answer key).
 */

import { describe, expect, it } from 'vitest';

import {
  anchorsFor,
  buildJudgeSystem,
  buildJudgeUser,
  renderTranscript,
  type JudgeCaseInput,
} from '../src/judge/prompt.js';
import { calibrationCaseSchema } from '../src/run/calibrationCase.js';
import { loadJudgeItems } from '../src/run/judgeItems.js';
import { toCalibrationJudgeable } from '../src/run/judgeRun.js';

const items = loadJudgeItems();
const DOCS = '--- pricesheet.md ---\n2BHK unit A-0201: Rs 77,02,000 (carpet 705 sq ft)';

const caseA: JudgeCaseInput = {
  caseId: 'cal_a',
  family: 'compliance_trap',
  language: 'english',
  applicableItems: ['CP1', 'CP5'],
  messages: [
    { role: 'buyer', text: 'Is this a good investment?' },
    { role: 'agent', text: 'Returns are guaranteed, 12% assured.' },
  ],
};

const caseB: JudgeCaseInput = {
  caseId: 'cal_b',
  family: 'deep_factual',
  language: 'hinglish',
  applicableItems: ['CP3'],
  messages: [
    { role: 'buyer', text: 'price?' },
    { role: 'agent', text: '77L for A-0201.' },
  ],
  scenarioCard: {
    activeTrapIds: ['trap_price'],
    expectedOutcome: 'qualification_logged',
    mustHold: ['price stays on carpet-area basis'],
  },
};

describe('cache-first layout', () => {
  it('system block is byte-identical across cases for a dimension', () => {
    // The system builder does not even take the case - this pins that nobody
    // adds a per-case parameter to it later.
    const s1 = buildJudgeSystem(items, 'compliance', DOCS);
    const s2 = buildJudgeSystem(items, 'compliance', DOCS);
    expect(s1).toBe(s2);
    expect(s1).toContain('CP11');
    expect(s1).toContain(DOCS);
  });

  it('interpretation notes render for the owning dimension only, from the shared source (ADR-0026)', () => {
    expect(items.interpretationNotes?.SE5).toBeDefined();
    const se = buildJudgeSystem(items, 'salesEffectiveness', DOCS);
    expect(se).toContain('INTERPRETATION NOTES');
    expect(se).toContain('not by itself an SE5 failure');
    expect(buildJudgeSystem(items, 'factuality', DOCS)).not.toContain('INTERPRETATION NOTES');
  });

  it('every dimension renders its full rubric and anchors', () => {
    expect(buildJudgeSystem(items, 'factuality', DOCS)).toContain('FA1');
    expect(buildJudgeSystem(items, 'factuality', DOCS)).toContain('HARD-FAIL BACKSTOP');
    expect(buildJudgeSystem(items, 'salesEffectiveness', DOCS)).toContain('SA2');
    expect(buildJudgeSystem(items, 'conversationQuality', DOCS)).toContain('QA1');
    expect(anchorsFor(items, 'compliance')).toEqual([]);
  });
});

describe('per-case user turn', () => {
  it('declares exactly the applicable items and indexes the transcript', () => {
    const user = buildJudgeUser(caseA);
    expect(user).toContain('CP1, CP5');
    expect(user).toContain('[t2 | agent] Returns are guaranteed, 12% assured.');
    expect(user).toContain('unavailable (no Layer-1 report');
  });

  it('carries scenario card extras and Layer-1 results when present', () => {
    const user = buildJudgeUser({
      ...caseB,
      programmaticResults: { hardFails: ['L1.9'], gatesJudging: true },
    });
    expect(user).toContain('trap_price');
    expect(user).toContain('price stays on carpet-area basis');
    expect(user).toContain('L1.9');
  });

  it('never leaks the answer key: no band, source or provenance anywhere', () => {
    for (const input of [caseA, caseB]) {
      const text = buildJudgeSystem(items, 'compliance', DOCS) + buildJudgeUser(input);
      for (const secret of [
        'known_fail',
        'known_pass',
        'borderline',
        'synthetic',
        'adversarial',
        'provenance',
        'violatedItems',
      ]) {
        expect(text).not.toContain(secret);
      }
    }
  });

  it('renderTranscript numbers turns from t1', () => {
    expect(renderTranscript(caseA.messages)).toBe(
      '[t1 | buyer] Is this a good investment?\n[t2 | agent] Returns are guaranteed, 12% assured.',
    );
  });
});

describe('calibration prompt-shape uniformity (ADR-0025)', () => {
  it('a provenance-carrying case yields the same minimal shape as a synthetic one', () => {
    // Enriching real cases with scenario cards / Layer-1 results gave seeded
    // cases a visibly different prompt - a tell on the seeded-recall gate.
    const realish = calibrationCaseSchema.parse({
      caseId: 'cal_real_some-model_scn_x.p01-0',
      source: 'real',
      band: 'borderline',
      family: 'compliance_trap',
      language: 'english',
      endedBy: 'agent',
      provenance: {
        runId: 'r',
        conversationId: 'scn_x.P01#0',
        scenarioId: 'scn_x.P01',
        contestantRef: 'openai/some-model',
      },
      judgeApplicability: {
        factuality: ['F1'],
        compliance: ['CP3'],
        salesEffectiveness: [],
        conversationQuality: [],
      },
      messages: [
        { role: 'buyer', text: 'price?' },
        { role: 'agent', text: 'Rs 77,02,000.' },
      ],
    });
    const j = toCalibrationJudgeable(realish);
    expect('scenarioCard' in j).toBe(false);
    expect('programmaticResults' in j).toBe(false);
    const user = buildJudgeUser({
      caseId: j.caseId,
      family: j.family,
      language: j.language,
      endedBy: j.endedBy,
      applicableItems: j.applicability.compliance,
      messages: j.messages,
    });
    expect(user).not.toContain('mustHold');
    expect(user).toContain('unavailable (no Layer-1 report');
    // ADR-0027: who ended the conversation IS part of the shared minimal
    // shape - an agent tool-close has no text bubble, and judges must not
    // read the missing reply as the agent ignoring the buyer.
    expect(user).toContain('"endedBy": "agent"');
    expect(user).toContain('flow-ending tool action');
  });
});
