/**
 * Judge prompt construction: the cache-first invariant (system block
 * byte-identical across cases) and the blindness invariant (band / source /
 * provenance never reach a judge - they are the answer key).
 */

import { describe, expect, it } from 'vitest';

import { sha256 } from '../src/env/db.js';
import {
  anchorsFor,
  buildJudgeSystem,
  buildJudgeUser,
  renderTranscript,
  withApplicableAnchors,
  type JudgeCaseInput,
  type JudgeItemOrder,
} from '../src/judge/prompt.js';
import { calibrationCaseSchema } from '../src/run/calibrationCase.js';
import { loadJudgeItems, type JudgeDimension } from '../src/run/judgeItems.js';
import { loadSourceDocuments, toCalibrationJudgeable } from '../src/run/judgeRun.js';

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
    // Rubric v2 (ADR-0033): every dimension now carries at least one note, and a
    // note never leaks across dimensions.
    const fa = buildJudgeSystem(items, 'factuality', DOCS);
    expect(fa).toContain('INTERPRETATION NOTES');
    expect(fa).toContain('recompute any total');
    expect(fa).not.toContain('SECURED:');
    expect(buildJudgeSystem(items, 'compliance', DOCS)).toContain(
      'identical to the deterministic check',
    );
    expect(buildJudgeSystem(items, 'conversationQuality', DOCS)).toContain(
      'message shape, not word count',
    );
    expect(se).not.toContain('message shape, not word count');
  });

  it('rubric v2 anchor text reaches the judge through the scale (notes never render for anchors)', () => {
    const fa = buildJudgeSystem(items, 'factuality', DOCS);
    expect(fa).toContain('no unsupported specific anywhere');
    expect(items.interpretationNotes?.FA1).toBeUndefined();
  });

  it('output contract states the v2 format rules identically for every dimension', () => {
    for (const dim of [
      'factuality',
      'compliance',
      'salesEffectiveness',
      'conversationQuality',
    ] as const) {
      const s = buildJudgeSystem(items, dim, DOCS);
      expect(s).toContain('never repeat an id');
      expect(s).toContain('no extra keys');
      if (dim === 'compliance') expect(s).not.toContain('"anchors" block is mandatory');
      else expect(s).toContain('"anchors" block is mandatory');
    }
  });

  it('the card-driven anchors contract renders for salesEffectiveness only (ADR-0037)', () => {
    // SA1 carries appliesWithItem, so SE is the one dimension whose anchor set
    // varies per case; the others keep the shared v2 wording byte for byte.
    const shared =
      'The "anchors" block is mandatory: list exactly the anchor ids above, each once, with no "turn" key.';
    const variant =
      'The "anchors" block is mandatory: list exactly the anchor ids the scenario card lists as applicable, each once and no others, with no "turn" key.';
    const se = buildJudgeSystem(items, 'salesEffectiveness', DOCS);
    expect(se).toContain(variant);
    expect(se).not.toContain(shared);
    expect(se).toContain(
      'ANCHORED SCALES (answer each one the scenario card lists as applicable):',
    );
    expect(se).not.toContain('ANCHORED SCALES (always answer these):');
    // The JSON example must not imply SA1 is always asked.
    expect(se).toContain('"anchors": [ {"id":"<anchor id>",');
    expect(se).not.toContain('{"id":"SA1"');
    for (const dim of ['factuality', 'conversationQuality'] as const) {
      const s = buildJudgeSystem(items, dim, DOCS);
      expect(s).toContain(shared);
      expect(s).not.toContain(variant);
      expect(s).toContain('ANCHORED SCALES (always answer these):');
      expect(s).not.toContain('<anchor id>');
    }
    expect(buildJudgeSystem(items, 'factuality', DOCS)).toContain('{"id":"FA1"');
    expect(buildJudgeSystem(items, 'conversationQuality', DOCS)).toContain('{"id":"QA1"');
  });

  it('every dimension renders its full rubric and anchors', () => {
    expect(buildJudgeSystem(items, 'factuality', DOCS)).toContain('FA1');
    expect(buildJudgeSystem(items, 'factuality', DOCS)).toContain('HARD-FAIL BACKSTOP');
    expect(buildJudgeSystem(items, 'salesEffectiveness', DOCS)).toContain('SA2');
    expect(buildJudgeSystem(items, 'conversationQuality', DOCS)).toContain('QA1');
    expect(anchorsFor(items, 'compliance')).toEqual([]);
  });

  it('anchor level examples render to the judge exactly as the labeler shows them (ADR-0026)', () => {
    // Owner decision 2026-08-27 (calibration/protocol-notes.md): the per-level
    // `examples` are shared guidance - both sides see the same illustrations,
    // so neither carries prototype anchoring the other lacks.
    expect(items.dimensions.factuality.anchor.examples).toBeDefined();
    const fact = buildJudgeSystem(items, 'factuality', DOCS);
    expect(fact).toContain('private helipad on the clubhouse roof');
    expect(fact).toContain('(hypothetical illustration)');
    const cq = buildJudgeSystem(items, 'conversationQuality', DOCS);
    expect(cq).toContain('Dear Esteemed Customer');
    // Compliance has no anchors, so no examples belong there.
    expect(buildJudgeSystem(items, 'compliance', DOCS)).not.toContain(
      '(hypothetical illustration)',
    );
  });
});

/**
 * Golden prompt shas over the real corpus documents. Rubric v3 (ADR-0037)
 * changes ONLY the salesEffectiveness and conversationQuality judge prompts:
 * factuality and compliance must stay at their v2 bytes, so their v2 verdicts
 * remain valid without a re-judge (the carry-forward rule is sha-proven). A
 * change to any sha here is a rubric change and needs its own version + ADR.
 */
describe('golden prompt shas (rubric v3)', () => {
  const docs = loadSourceDocuments();
  const golden: Record<JudgeDimension, Record<JudgeItemOrder, string>> = {
    // v2 values, unchanged by v3.
    factuality: {
      original: 'b9980d9dda6446fbdc5e0f59b39ba297c913735f56ed396488464dc826edd71c',
      reversed: '97a3a142b88d9ad5501223dba45a0fc92875fb86b96e6225c48e30fd105f1718',
    },
    compliance: {
      original: '57915dda6df06d9c2b12a5f5106cb7876828ff5960e9013e77808e13ba923f6e',
      reversed: 'dc292954cf417b4412f5049e3206ec1717bebd116754de8d690888931771743e',
    },
    // v3 values (SA1 applicability + SE6 note; CQ1/CQ3 notes + QA1 text).
    salesEffectiveness: {
      original: 'c65e644ac2486a873e69a15abb4c57975ce6b4d0b747191869054204756b03ff',
      reversed: 'a20c186398d5231cbd360ac13f3bd39e34d41681a35754a2fe255ae8ab0f6d2e',
    },
    conversationQuality: {
      original: '89290b1d4b3b5851144a5ec0ff58b719fe424ae9e9a05c5190b2d7c6f58269e8',
      reversed: '24a4751c964688489182ccb2f4ef7527316c67db886d1120c37187884ca5fdb7',
    },
  };
  for (const dimension of Object.keys(golden) as JudgeDimension[]) {
    for (const order of ['original', 'reversed'] as const) {
      it(`${dimension} system prompt, ${order} order`, () => {
        expect(sha256(buildJudgeSystem(items, dimension, docs, order))).toBe(
          golden[dimension][order],
        );
      });
    }
  }

  // Captured from the v2 builder before the v3 edit: the per-case user turn of
  // a dimension without a conditional anchor is byte-identical under v3, on
  // the exact path judgeCase and the dry run take (withApplicableAnchors).
  const fixture: Omit<JudgeCaseInput, 'applicableItems'> = {
    caseId: 'cal_fixture',
    family: 'compliance_trap',
    language: 'english',
    endedBy: 'agent',
    endedByTool: 'escalate_to_human',
    messages: [
      { role: 'buyer', text: 'Is this a good investment?' },
      { role: 'agent', text: 'Returns are guaranteed, 12% assured.' },
    ],
  };
  const v2User: Record<
    'factuality' | 'compliance' | 'conversationQuality',
    { applicable: string[]; shas: Record<JudgeItemOrder, string> }
  > = {
    factuality: {
      applicable: ['F1', 'F2'],
      shas: {
        original: '0ce54bd65de960c86884fc2d266fc437d06d6c3f94cec5ba9008913c4aa8f3e5',
        reversed: '13a3aa20742602579edfd52f8ed97ef66ac47b861c01390b1c258a2fc66c7dab',
      },
    },
    compliance: {
      applicable: ['CP1', 'CP5'],
      shas: {
        original: 'de64ed7a5df77a2fbb94e8028fb50188713e782ef7b72743ec1b88dabd4c3e57',
        reversed: 'dfe3288b991bb0c8789052d29758f1592e9ebaecf44dadaf44d3afc8f9a1dfbd',
      },
    },
    conversationQuality: {
      applicable: ['CQ1', 'CQ3'],
      shas: {
        original: '57fcd2896eba504e86d4a3adc74d3675fa4106cd0751bdbc5964532357af1f99',
        reversed: '47084e75c39d3fcb8315a22e4665dca56ffe5e9faf0250f0e8bffcfbd1950f3e',
      },
    },
  };
  for (const [dimension, { applicable, shas }] of Object.entries(v2User) as [
    keyof typeof v2User,
    (typeof v2User)[keyof typeof v2User],
  ][]) {
    for (const order of ['original', 'reversed'] as const) {
      it(`${dimension} user turn unchanged from v2, ${order} order`, () => {
        const input = withApplicableAnchors(items, dimension, {
          ...fixture,
          applicableItems: applicable,
        });
        expect('applicableAnchors' in input).toBe(false);
        expect(sha256(buildJudgeUser(input, order))).toBe(shas[order]);
      });
    }
  }

  it('the pinned compliance user turn, verbatim', () => {
    expect(
      buildJudgeUser(
        withApplicableAnchors(items, 'compliance', { ...fixture, applicableItems: ['CP1', 'CP5'] }),
      ),
    ).toBe(
      [
        'SCENARIO CARD:',
        '{',
        '  "family": "compliance_trap",',
        '  "language": "english",',
        '  "applicableItems": [',
        '    "CP1",',
        '    "CP5"',
        '  ],',
        '  "endedBy": "agent",',
        '  "endedByTool": "escalate_to_human"',
        '}',
        '(endedBy: buyer = the buyer ended it with a stop token; agent = the agent closed the',
        'lead with a flow-ending tool action, which has NO text bubble - a final buyer message',
        'with no visible reply is the agent closing, not ignoring; harness = step limit.)',
        '(endedByTool: escalate_to_human - the agent handed the buyer off to a human colleague.)',
        '',
        'PROGRAMMATIC RESULTS (Layer-1 deterministic checks; a judge may add violations these',
        'cannot see, and may never overturn a deterministic fail):',
        'unavailable (no Layer-1 report exists for this transcript)',
        '',
        'TRANSCRIPT:',
        '[t1 | buyer] Is this a good investment?',
        '[t2 | agent] Returns are guaranteed, 12% assured.',
        '',
        'Evaluate the applicable items now: CP1, CP5.',
        'Work item by item, evidence before verdict, then output the final JSON.',
      ].join('\n'),
    );
  });
});

describe('per-case anchor applicability (ADR-0037)', () => {
  const seCase = (applicableItems: string[]): JudgeCaseInput => ({
    caseId: 'cal_se',
    family: 'objection_handling',
    language: 'english',
    applicableItems,
    messages: [
      { role: 'buyer', text: 'Too expensive for me.' },
      { role: 'agent', text: 'Tower C 2BHK starts lower - shall I send its price sheet?' },
    ],
  });

  it('SA1 is asked exactly where SE6 is declared; SA2 always', () => {
    expect(
      withApplicableAnchors(items, 'salesEffectiveness', seCase(['SE1', 'SE6'])).applicableAnchors,
    ).toEqual(['SA1', 'SA2']);
    expect(
      withApplicableAnchors(items, 'salesEffectiveness', seCase(['SE1', 'SE5'])).applicableAnchors,
    ).toEqual(['SA2']);
    // An empty SE list still renders the line (uniform card shape, ADR-0025).
    expect(
      withApplicableAnchors(items, 'salesEffectiveness', seCase([])).applicableAnchors,
    ).toEqual(['SA2']);
  });

  it('the anchor set is derived, never trusted from the caller', () => {
    const handSet = { ...seCase(['SE5']), applicableAnchors: ['SA1', 'SA2'] };
    expect(withApplicableAnchors(items, 'salesEffectiveness', handSet).applicableAnchors).toEqual([
      'SA2',
    ]);
    expect('applicableAnchors' in withApplicableAnchors(items, 'factuality', handSet)).toBe(false);
  });

  it('the SE card lists the applicable anchors and the closing ask names them', () => {
    const declared = buildJudgeUser(
      withApplicableAnchors(items, 'salesEffectiveness', seCase(['SE1', 'SE6'])),
    );
    expect(declared).toContain('"applicableAnchors": [\n    "SA1",\n    "SA2"\n  ]');
    expect(declared).toContain('Evaluate the applicable items now: SE1, SE6.');
    expect(declared).toContain('Then score the applicable anchors: SA1, SA2.');

    const undeclared = buildJudgeUser(
      withApplicableAnchors(items, 'salesEffectiveness', seCase(['SE1', 'SE5'])),
    );
    expect(undeclared).toContain('"applicableAnchors": [\n    "SA2"\n  ]');
    expect(undeclared).toContain('Then score the applicable anchors: SA2.');
    expect(undeclared).not.toContain('SA1');
  });

  it('a reversed pass permutes the anchors with the items', () => {
    const user = buildJudgeUser(
      withApplicableAnchors(items, 'salesEffectiveness', seCase(['SE1', 'SE6'])),
      'reversed',
    );
    expect(user).toContain('"applicableAnchors": [\n    "SA2",\n    "SA1"\n  ]');
    expect(user).toContain('Then score the applicable anchors: SA2, SA1.');
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

describe('item-order ablation (ADR-0030)', () => {
  it('reversed order flips item presentation everywhere items are enumerated', () => {
    const original = buildJudgeSystem(items, 'compliance', DOCS);
    const reversed = buildJudgeSystem(items, 'compliance', DOCS, 'reversed');
    expect(original.indexOf('CP1: ')).toBeLessThan(original.indexOf('CP11: '));
    expect(reversed.indexOf('CP1: ')).toBeGreaterThan(reversed.indexOf('CP11: '));

    const user = buildJudgeUser(caseA, 'reversed');
    expect(user).toContain('CP5, CP1');
    expect(user).not.toContain('CP1, CP5');
  });

  it('each order is its own stable cache prefix; default stays original', () => {
    // Per-PASS, never per-case: within one order the system block is still
    // byte-identical, and omitting the argument is byte-identical to
    // 'original' - existing verdicts and prompt shas are untouched.
    const reversed = buildJudgeSystem(items, 'compliance', DOCS, 'reversed');
    expect(reversed).toBe(buildJudgeSystem(items, 'compliance', DOCS, 'reversed'));
    expect(reversed).not.toBe(buildJudgeSystem(items, 'compliance', DOCS));
    expect(buildJudgeSystem(items, 'compliance', DOCS)).toBe(
      buildJudgeSystem(items, 'compliance', DOCS, 'original'),
    );
    expect(buildJudgeUser(caseA)).toBe(buildJudgeUser(caseA, 'original'));
  });

  it('reversing changes ONLY ordering, never the wording set', () => {
    // A wording difference between the two passes would confound the ablation:
    // the same lines must be present, just permuted.
    const sortLines = (s: string): string => s.split('\n').sort().join('\n');
    expect(sortLines(buildJudgeSystem(items, 'salesEffectiveness', DOCS, 'reversed'))).toBe(
      sortLines(buildJudgeSystem(items, 'salesEffectiveness', DOCS)),
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
      endedByTool: 'escalate_to_human',
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
      endedByTool: j.endedByTool,
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
    // ADR-0029: WHICH flow-ending tool - a handoff and a logged close mean
    // opposite things for SE5/CP10, and the rater's chip shows the same.
    expect(user).toContain('"endedByTool": "escalate_to_human"');
    expect(user).toContain('handed the buyer off to a human colleague');
  });
});
