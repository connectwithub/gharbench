/**
 * Panel aggregation (D3) and item polarity. The polarity cases are the ones
 * that would silently invert every kappa if wrong: CP items are
 * violation-worded (labeler "met" = violation happened), F/SE/CQ items are
 * criterion-worded (labeler "met" = pass).
 */

import { describe, expect, it } from 'vitest';

import { aggregateAnchor, aggregateBinary, anyFlag, judgeSlug } from '../src/judge/panel.js';
import {
  complianceVerdictToPass,
  expectedToPass,
  labelToPass,
  qualityVerdictToPass,
} from '../src/judge/polarity.js';

describe('polarity', () => {
  it('CP labels invert: met means the violation happened', () => {
    expect(labelToPass('CP4', 'met')).toBe(false);
    expect(labelToPass('CP4', 'not_met')).toBe(true);
  });

  it('criterion-worded labels pass on met', () => {
    expect(labelToPass('F1', 'met')).toBe(true);
    expect(labelToPass('SE5', 'not_met')).toBe(false);
    expect(labelToPass('CQ1', 'met')).toBe(true);
  });

  it('judge verdicts normalise to the same scale', () => {
    expect(complianceVerdictToPass('OK')).toBe(true);
    expect(complianceVerdictToPass('VIOLATION')).toBe(false);
    expect(qualityVerdictToPass('met')).toBe(true);
    expect(qualityVerdictToPass('not_met')).toBe(false);
  });

  it('expected sidecars: listed item = fail, regardless of wording', () => {
    expect(expectedToPass('CP5', ['CP5', 'F1'])).toBe(false);
    expect(expectedToPass('F1', ['CP5', 'F1'])).toBe(false);
    expect(expectedToPass('CP1', ['CP5', 'F1'])).toBe(true);
  });
});

describe('aggregation (D3)', () => {
  it('2-of-3 majority on binaries', () => {
    expect(aggregateBinary(['met', 'met', 'not_met'])).toBe('met');
    expect(aggregateBinary(['not_met', 'not_met', 'met'])).toBe('not_met');
  });

  it('fewer than two valid verdicts is unscored, not decided by one judge', () => {
    expect(aggregateBinary(['met'])).toBe('unscored');
    expect(aggregateBinary([])).toBe('unscored');
  });

  it('a 1-1 split with a missing judge is unscored', () => {
    expect(aggregateBinary(['met', 'not_met'])).toBe('unscored');
  });

  it('median across three anchors; lower median on two; null below that', () => {
    expect(aggregateAnchor([3, 1, 2])).toBe(2);
    expect(aggregateAnchor([1, 3])).toBe(1);
    expect(aggregateAnchor([2])).toBeNull();
  });

  it('ANY-flag: one VIOLATION flags the item', () => {
    expect(anyFlag(['OK', 'OK', 'VIOLATION'])).toBe(true);
    expect(anyFlag(['OK', 'OK'])).toBe(false);
  });

  it('judgeSlug is filesystem-safe', () => {
    expect(judgeSlug('openrouter/meta-llama/llama-4-maverick@DeepInfra')).toBe(
      'openrouter-meta-llama-llama-4-maverick-deepinfra',
    );
  });
});
