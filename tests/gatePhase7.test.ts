/**
 * Phase 7 gate primitives: the human-human alpha matrix (ties = missing,
 * polarity normalised) and the judgment re-keying that aligns run verdicts
 * with the blind hv case ids.
 */

import { describe, expect, it } from 'vitest';

import { humanHumanAlpha } from '../src/run/gatePhase7.js';
import type { BridgeFn } from '../src/run/judgeAgreement.js';
import type { CalibrationCase, CalibrationLabel } from '../src/run/calibrationCase.js';

const hvCase = (caseId: string): CalibrationCase => ({
  caseId,
  source: 'real',
  band: 'borderline',
  family: 'compliance_trap',
  language: 'english',
  judgeApplicability: {
    factuality: ['F1'],
    compliance: ['CP5'],
    salesEffectiveness: [],
    conversationQuality: [],
  },
  messages: [
    { role: 'buyer', text: 'hi' },
    { role: 'agent', text: 'hello' },
  ],
});

const label = (
  caseId: string,
  rater: string,
  binary: Record<string, 'met' | 'not_met' | 'tie'>,
): CalibrationLabel => ({ caseId, rater, labeledAt: 'x', binary, anchors: {} });

describe('humanHumanAlpha', () => {
  it('builds aligned rows with polarity applied and ties as missing', () => {
    const cases = [hvCase('cal_hv_0001')];
    const labels = new Map([
      // CP5 met = violation -> fail(0); F1 met -> pass(1).
      ['r1', new Map([['cal_hv_0001', label('cal_hv_0001', 'r1', { CP5: 'met', F1: 'met' })]])],
      ['r2', new Map([['cal_hv_0001', label('cal_hv_0001', 'r2', { CP5: 'not_met', F1: 'tie' })]])],
    ]);
    let sent: Record<string, (number | null)[]> | undefined;
    const bridge: BridgeFn = (raters) => {
      sent = raters;
      return {
        krippendorff_alpha: 0.7,
        cohen_kappa: null,
        weighted_kappa: null,
        spearman: null,
        pearson: null,
      };
    };
    const { alpha, units } = humanHumanAlpha(cases, labels, bridge);
    expect(alpha).toBe(0.7);
    // Unit order: F1 (factuality) then CP5 (compliance) per DIMENSIONS order.
    expect(sent).toEqual({
      r1: [1, 0],
      r2: [null, 1],
    });
    // Only CP5 has >=2 non-missing raters.
    expect(units).toBe(1);
  });

  it('reports not-computable with fewer than two raters', () => {
    const bridge: BridgeFn = () => {
      throw new Error('must not be called');
    };
    const { alpha } = humanHumanAlpha([hvCase('cal_hv_0001')], new Map(), bridge);
    expect(alpha).toBeNull();
  });
});
