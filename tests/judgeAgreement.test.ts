/**
 * Agreement assembly and counting: D3 aggregation over stored judgments,
 * 3-rater adjudication with ties preserved, the compliance confusion counts
 * behind the recall >= 0.9 gate, and test-retest pairing. The kappa/alpha
 * numbers themselves come from the Python bridge and are golden-tested in
 * stats-bridge/; here the bridge is faked to verify what gets SENT to it.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  adjudicatedReference,
  assembleUnits,
  binaryAgreement,
  compliancePrf,
  itemsVersionsOf,
  listRaters,
  loadJudgments,
  referenceFromLabels,
  retestAgreement,
  versionWarnings,
  versionsFromLabels,
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

describe('compliancePrf alsoCovered', () => {
  it('a flag on a second item wording is neither TP nor FP, and recall is untouched', () => {
    // cal_f seeds CP11; CP3's text ("misleading price statement") covers the
    // same line, so a judge flagging CP3 caught the seeded act under another
    // name. Counting that as a false positive would measure the sidecar's
    // under-specification as judge error (ADR-0025 keeps violatedItems the
    // sole recall authority, hence the unchanged denominator).
    const cases = [
      makeCase('cal_f', 'known_fail', ['CP3', 'CP11']),
      makeCase('cal_p', 'known_pass', ['CP3']),
    ];
    const judgments = JUDGES.flatMap((j) => [
      sj(j, 'cal_f', 'compliance', { CP3: 'VIOLATION', CP11: 'VIOLATION' }),
      sj(j, 'cal_p', 'compliance', { CP3: 'VIOLATION' }), // a real false positive
    ]);
    const { binaries } = assembleUnits(cases, judgments, JUDGES);
    const expected = new Map<string, readonly string[]>([
      ['cal_f', ['CP11']],
      ['cal_p', []],
    ]);

    const without = compliancePrf(cases, binaries, expected);
    expect(without.confusion).toEqual({ tp: 1, fp: 2, fn: 0, tn: 0 });
    expect(without.alsoCoveredFlags).toBe(0);

    const with_ = compliancePrf(cases, binaries, expected, new Map([['cal_f', ['CP3']]]));
    expect(with_.confusion).toEqual({ tp: 1, fp: 1, fn: 0, tn: 0 });
    expect(with_.alsoCoveredFlags).toBe(1);
    expect(with_.precision).toBeCloseTo(0.5); // was 1/3
    expect(with_.recall).toBe(without.recall); // denominator unchanged
    expect(with_.recallSeededKnownFails).toBe(without.recallSeededKnownFails);
    expect(with_.seededFailUnits).toBe(without.seededFailUnits);
  });
});

describe('loadJudgments rubric guards', () => {
  function writeVerdict(
    base: string,
    judgeDir: string,
    caseId: string,
    dimension: JudgeDimension,
    extra: Partial<StoredJudgment>,
  ): void {
    const stored: StoredJudgment = {
      ...sj(`j/${judgeDir}`, caseId, dimension, { CP5: 'OK' }),
      ...extra,
    };
    mkdirSync(join(base, judgeDir), { recursive: true });
    writeFileSync(join(base, judgeDir, `${caseId}.${dimension}.json`), JSON.stringify(stored));
  }

  function fixture(fn: (base: string) => void): string {
    const base = mkdtempSync(join(tmpdir(), 'gb-judgments-'));
    fn(base);
    return base;
  }

  it('throws when one (judge, dimension) mixes prompt shas', () => {
    const base = fixture((b) => {
      writeVerdict(b, 'a', 'cal_1', 'compliance', { promptSha: 'sha_old' });
      writeVerdict(b, 'a', 'cal_2', 'compliance', { promptSha: 'sha_new' });
    });
    try {
      expect(() => loadJudgments(base)).toThrow(/judge j\/a, dimension compliance/);
      expect(() => loadJudgments(base)).toThrow(/sha_new, sha_old/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('throws when one (judge, dimension) mixes rubric versions', () => {
    const base = fixture((b) => {
      writeVerdict(b, 'a', 'cal_1', 'compliance', {}); // no itemsVersion
      writeVerdict(b, 'a', 'cal_2', 'compliance', { itemsVersion: '2.0.0' });
    });
    try {
      expect(() => loadJudgments(base)).toThrow(/itemsVersion 2\.0\.0, unversioned/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('allows different shas across judges and across dimensions', () => {
    const base = fixture((b) => {
      writeVerdict(b, 'a', 'cal_1', 'compliance', { promptSha: 's1', itemsVersion: '2.0.0' });
      writeVerdict(b, 'a', 'cal_1', 'factuality', { promptSha: 's2', itemsVersion: '2.0.0' });
      writeVerdict(b, 'c', 'cal_1', 'compliance', { promptSha: 's3', itemsVersion: '2.0.0' });
    });
    try {
      expect(loadJudgments(base)).toHaveLength(3);
      expect(itemsVersionsOf(loadJudgments(base))).toEqual(['2.0.0']);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('never ingests an archived-* directory as a judge', () => {
    const base = fixture((b) => {
      writeVerdict(b, 'a', 'cal_1', 'compliance', { promptSha: 's1', itemsVersion: '2.0.0' });
      // The superseded pass parked next to the live one: same judge, old
      // rubric. Ingesting it would both mix versions and double-count.
      writeVerdict(b, 'archived-v1', 'cal_1', 'compliance', { promptSha: 's0' });
      mkdirSync(join(b, 'meta'), { recursive: true });
    });
    try {
      const loaded = loadJudgments(base);
      expect(loaded).toHaveLength(1);
      expect(itemsVersionsOf(loaded)).toEqual(['2.0.0']);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('rubric version reporting', () => {
  it('reads label versions, defaulting an unversioned label to "unversioned"', () => {
    const labels = new Map([
      ['cal_1', { ...label('cal_1', 'self', { F1: 'met' }), itemsVersion: '2.0.0' }],
      ['cal_2', label('cal_2', 'self', { F1: 'met' })],
    ]);
    expect(versionsFromLabels(labels)).toEqual(['2.0.0', 'unversioned']);
  });

  it('warns (never throws) when a rater answered a different rubric', () => {
    const warnings = versionWarnings({
      judgments: ['2.0.0'],
      labels: { self: ['2.0.0'], colleague_a: ['1.0.0'], colleague_b: [] },
    });
    expect(warnings).toHaveLength(1); // self matches; the empty set is silent
    expect(warnings[0]).toContain('labels/colleague_a');
    expect(warnings[0]).toContain('[1.0.0]');
    expect(warnings[0]).toContain('[2.0.0]');
    expect(versionWarnings({ judgments: ['2.0.0'], labels: { self: ['2.0.0'] } })).toEqual([]);
  });
});

describe('listRaters', () => {
  it('lists rater folders and skips archived-* folders', () => {
    const base = mkdtempSync(join(tmpdir(), 'gb-raters-'));
    try {
      for (const d of ['self', 'rater_b', 'archived-purged'])
        mkdirSync(join(base, 'labels', d), { recursive: true });
      expect(listRaters(base)).toEqual(['rater_b', 'self']);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
