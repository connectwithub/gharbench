/**
 * Agreement assembly and counting: D3 aggregation over stored judgments,
 * 3-rater adjudication with ties preserved, the compliance confusion counts
 * behind the recall >= 0.9 gate, and test-retest pairing. The kappa/alpha
 * numbers themselves come from the Python bridge and are golden-tested in
 * stats-bridge/; here the bridge is faked to verify what gets SENT to it.
 */

import { describe, expect, it } from 'vitest';

import {
  adjudicatedReference,
  assembleUnits,
  binaryAgreement,
  compliancePrf,
  referenceFromLabels,
  retestAgreement,
  type BridgeFn,
} from '../src/run/judgeAgreement.js';
import type { StoredJudgment } from '../src/run/judgeRun.js';
import type { CalibrationCase, CalibrationLabel } from '../src/run/calibrationCase.js';
import type { JudgeVerdict } from '../src/judge/schema.js';
import type { JudgeDimension } from '../src/run/judgeItems.js';

const JUDGES = ['j/a', 'j/b', 'j/c'];

function makeCase(
  caseId: string,
  band: CalibrationCase['band'],
  compliance: string[],
): CalibrationCase {
  return {
    caseId,
    source: 'synthetic',
    band,
    family: 'compliance_trap',
    language: 'english',
    endedBy: 'buyer',
    judgeApplicability: {
      factuality: ['F1'],
      compliance,
      salesEffectiveness: [],
      conversationQuality: [],
    },
    messages: [
      { role: 'buyer', text: 'hi' },
      { role: 'agent', text: 'hello' },
    ],
  };
}

function sj(
  judgeRef: string,
  caseId: string,
  dimension: JudgeDimension,
  itemVerdicts: Record<string, 'VIOLATION' | 'OK' | 'met' | 'not_met'>,
  anchors: Record<string, number> = {},
): StoredJudgment {
  const verdict: JudgeVerdict = {
    dimension,
    items: Object.entries(itemVerdicts).map(([id, v]) => ({
      id,
      verdict: v,
      evidence: 'NONE',
      turn: null,
      evidenceFound: null,
      justification: 'x',
    })),
    anchors: Object.entries(anchors).map(([id, score]) => ({
      id,
      score,
      evidence: 'NONE',
      evidenceFound: null,
      justification: 'x',
    })),
    notes: '',
  };
  if (dimension === 'compliance') {
    verdict.hardFail = Object.values(itemVerdicts).includes('VIOLATION');
  }
  return {
    judgeRef,
    caseId,
    dimension,
    attempts: 1,
    promptSha: 'x',
    ts: '2026-08-20T00:00:00Z',
    outcome: { kind: 'verdict', verdict },
  };
}

describe('assembleUnits', () => {
  const cases = [makeCase('cal_1', 'known_fail', ['CP5'])];

  it('compliance is ANY-flag: one VIOLATION fails the panel', () => {
    const judgments = [
      sj('j/a', 'cal_1', 'compliance', { CP5: 'OK' }),
      sj('j/b', 'cal_1', 'compliance', { CP5: 'OK' }),
      sj('j/c', 'cal_1', 'compliance', { CP5: 'VIOLATION' }),
      sj('j/a', 'cal_1', 'factuality', { F1: 'met' }, { FA1: 2 }),
      sj('j/b', 'cal_1', 'factuality', { F1: 'met' }, { FA1: 3 }),
      sj('j/c', 'cal_1', 'factuality', { F1: 'not_met' }, { FA1: 1 }),
    ];
    const { binaries, anchors } = assembleUnits(cases, judgments, JUDGES);
    const cp5 = binaries.find((u) => u.itemId === 'CP5');
    expect(cp5?.panelPass).toBe(false);
    expect(cp5?.perJudgePass).toEqual([true, true, false]);

    // Quality binaries are 2-of-3 majority; anchors take the median.
    expect(binaries.find((u) => u.itemId === 'F1')?.panelPass).toBe(true);
    expect(anchors.find((a) => a.anchorId === 'FA1')?.panelScore).toBe(2);
  });

  it('a judge with a structured error contributes null, not a vote', () => {
    const errored: StoredJudgment = {
      ...sj('j/c', 'cal_1', 'compliance', { CP5: 'VIOLATION' }),
      outcome: { kind: 'error', code: 'no_json', detail: 'x' },
    };
    const judgments = [
      sj('j/a', 'cal_1', 'compliance', { CP5: 'OK' }),
      sj('j/b', 'cal_1', 'compliance', { CP5: 'OK' }),
      errored,
    ];
    const { binaries } = assembleUnits(cases, judgments, JUDGES);
    const cp5 = binaries.find((u) => u.itemId === 'CP5');
    expect(cp5?.perJudgePass).toEqual([true, true, null]);
    expect(cp5?.panelPass).toBe(true); // ANY-flag over the two valid verdicts
  });
});

function label(
  caseId: string,
  rater: string,
  binary: Record<string, 'met' | 'not_met' | 'tie'>,
): CalibrationLabel {
  return { caseId, rater, labeledAt: '2026-08-20', binary, anchors: {} };
}

describe('human references', () => {
  it('self reference drops ties and applies polarity', () => {
    const labels = new Map([
      ['cal_1', label('cal_1', 'self', { CP5: 'met', F1: 'met', CQ1: 'tie' })],
    ]);
    const ref = referenceFromLabels(labels);
    expect(ref.get('cal_1|CP5')).toBe(false); // CP met = violation happened
    expect(ref.get('cal_1|F1')).toBe(true);
    expect(ref.has('cal_1|CQ1')).toBe(false);
  });

  it('adjudication takes strict majority, drops no-majority units and off-slice cases', () => {
    const byRater = new Map([
      ['self', new Map([['cal_1', label('cal_1', 'self', { CP5: 'met', F1: 'met' })]])],
      ['r1', new Map([['cal_1', label('cal_1', 'r1', { CP5: 'met', F1: 'not_met' })]])],
      ['r2', new Map([['cal_1', label('cal_1', 'r2', { CP5: 'not_met', F1: 'tie' })]])],
      ['r3', new Map([['cal_2', label('cal_2', 'r3', { CP5: 'met' })]])],
    ]);
    const ref = adjudicatedReference(byRater, new Set(['cal_1']));
    expect(ref.get('cal_1|CP5')).toBe(false); // 2 of 3 said violation
    expect(ref.has('cal_1|F1')).toBe(false); // 1-1 after the tie: dropped
    expect(ref.has('cal_2|CP5')).toBe(false); // not in the slice
  });
});

describe('compliancePrf', () => {
  it('counts the confusion over sidecar cases and seeded known-fail recall', () => {
    const cases = [
      makeCase('cal_f', 'known_fail', ['CP5', 'CP6']),
      makeCase('cal_p', 'known_pass', ['CP5']),
      makeCase('cal_r', 'borderline', ['CP5']),
    ];
    const judgments = JUDGES.flatMap((j) => [
      // seeded fail case: CP5 caught, CP6 missed
      sj(j, 'cal_f', 'compliance', { CP5: 'VIOLATION', CP6: 'OK' }),
      // known-pass case: false flag from every judge
      sj(j, 'cal_p', 'compliance', { CP5: 'VIOLATION' }),
      // real case (no sidecar): ignored by PRF entirely
      sj(j, 'cal_r', 'compliance', { CP5: 'VIOLATION' }),
    ]);
    const { binaries } = assembleUnits(cases, judgments, JUDGES);
    const expected = new Map<string, readonly string[]>([
      ['cal_f', ['CP5', 'CP6']],
      ['cal_p', []],
    ]);
    const prf = compliancePrf(cases, binaries, expected);
    expect(prf.confusion).toEqual({ tp: 1, fp: 1, fn: 1, tn: 0 });
    expect(prf.recall).toBeCloseTo(0.5);
    expect(prf.recallSeededKnownFails).toBeCloseTo(0.5);
    expect(prf.seededFailUnits).toBe(2);
  });
});

describe('binaryAgreement', () => {
  it('sends aligned 0/1 rows to the bridge and reports raw agreement', () => {
    const cases = [makeCase('cal_1', 'known_fail', ['CP5', 'CP6'])];
    const judgments = JUDGES.map((j) =>
      sj(j, 'cal_1', 'compliance', { CP5: 'VIOLATION', CP6: 'OK' }),
    );
    const { binaries } = assembleUnits(cases, judgments, JUDGES);
    const reference = new Map([
      ['cal_1|CP5', false],
      ['cal_1|CP6', false],
    ]);
    let sent: Record<string, (number | null)[]> | undefined;
    const bridge: BridgeFn = (raters) => {
      sent = raters;
      return {
        krippendorff_alpha: null,
        cohen_kappa: 0.5,
        weighted_kappa: null,
        spearman: null,
        pearson: null,
      };
    };
    const out = binaryAgreement(binaries, reference, bridge);
    expect(out?.units).toBe(2);
    expect(out?.kappa).toBe(0.5);
    expect(out?.rawAgreementPct).toBe(50); // agree on CP5 (fail), disagree on CP6
    expect(sent).toEqual({ human: [0, 0], panel: [0, 1] });
  });
});

describe('retestAgreement', () => {
  it('pairs verdict files and scores exact-match percent', () => {
    const first = [sj('j/a', 'cal_1', 'compliance', { CP5: 'VIOLATION', CP6: 'OK' })];
    const second = [sj('j/a', 'cal_1', 'compliance', { CP5: 'VIOLATION', CP6: 'VIOLATION' })];
    const out = retestAgreement(first, second);
    expect(out['j-a']).toEqual({ units: 2, agreementPct: 50 });
  });
});
