/**
 * Leaderboard assembly primitives: panel aggregation per conversation x
 * dimension, the D1 re-blend, and the G13 variance flags.
 */

import { describe, expect, it } from 'vitest';

import { applicableAnchorIds } from '../src/judge/anchorApplicability.js';
import type { JudgeVerdict } from '../src/judge/schema.js';
import { varianceFlags } from '../src/run/gatePhase6.js';
import {
  applicableVerdict,
  literalD1Sub,
  panelDimension,
  reblend,
  type ScoredConversation,
} from '../src/run/leaderboard.js';
import { loadJudgeItems } from '../src/run/judgeItems.js';
import { appliesAnchorRule, blendSubScore, type SubScores } from '../src/metrics/composite.js';

function verdict(
  items: Record<string, 'VIOLATION' | 'OK' | 'met' | 'not_met'>,
  anchors: Record<string, number> = {},
): JudgeVerdict {
  return {
    dimension: 'factuality',
    items: Object.entries(items).map(([id, v]) => ({
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
}

describe('panelDimension', () => {
  it('majority per item; unscored items leave the denominator', () => {
    const verdicts = [
      verdict({ F1: 'met', F2: 'met' }),
      verdict({ F1: 'met', F2: 'not_met' }),
      verdict({ F1: 'not_met', F2: 'not_met' }),
    ];
    const out = panelDimension(verdicts, 'factuality', ['F1', 'F2', 'F5']);
    // F1 met (2-1), F2 not_met (1-2), F5 answered by nobody -> dropped.
    expect(out.fraction).toBeCloseTo(0.5);
  });

  it('sales anchor is the mean of the two per-anchor medians', () => {
    const verdicts = [
      verdict({}, { SA1: 3, SA2: 1 }),
      verdict({}, { SA1: 2, SA2: 1 }),
      verdict({}, { SA1: 2, SA2: 3 }),
    ];
    const out = panelDimension(verdicts, 'salesEffectiveness', []);
    // medians: SA1=2, SA2=1 -> mean 1.5
    expect(out.anchor).toBeCloseTo(1.5);
  });

  it('compliance is ANY-flag and contributes no fraction', () => {
    const verdicts = [
      verdict({ CP5: 'OK' }),
      verdict({ CP5: 'OK' }),
      verdict({ CP5: 'VIOLATION' }),
    ];
    const out = panelDimension(verdicts, 'compliance', ['CP5']);
    expect(out.flagged).toBe(true);
    expect(out.fraction).toBeNull();
  });
});

describe('ADR-0037 sales anchor under the amended D1', () => {
  const rubric = loadJudgeItems();
  const salesVerdict = (scores: Record<string, number>): JudgeVerdict => verdict({}, scores);

  it('an SE6-undeclared v3 conversation averages SA2 alone (SA1 filtered at the verdict)', () => {
    const applicable = new Set(applicableAnchorIds(rubric, 'salesEffectiveness', ['SE5']));
    const verdicts = [
      applicableVerdict(salesVerdict({ SA1: 3, SA2: 2 }), applicable),
      applicableVerdict(salesVerdict({ SA1: 0, SA2: 2 }), applicable),
    ];
    const out = panelDimension(verdicts, 'salesEffectiveness', []);
    expect(out.anchor).toBe(2);
    expect(blendSubScore(0.5, out.anchor)).toBeCloseTo(0.5 * 0.5 + 0.5 * (2 / 3));
  });

  it('no sales anchor applies -> the binary fraction alone', () => {
    const applicable = new Set(applicableAnchorIds(rubric, 'salesEffectiveness', []));
    const verdicts = [
      applicableVerdict(salesVerdict({ SA1: 3 }), applicable),
      applicableVerdict(salesVerdict({ SA1: 1 }), applicable),
    ];
    const out = panelDimension(verdicts, 'salesEffectiveness', []);
    expect(out.anchor).toBeNull();
    expect(blendSubScore(0.5, out.anchor)).toBe(0.5);
  });

  it('pre-3.0.0 verdicts are not filtered: SA1 still averages in, exactly as before', () => {
    expect(appliesAnchorRule('2.0.0')).toBe(false);
    const verdicts = [salesVerdict({ SA1: 3, SA2: 1 }), salesVerdict({ SA1: 3, SA2: 1 })];
    const out = panelDimension(verdicts, 'salesEffectiveness', []);
    expect(out.anchor).toBe(2); // mean of the medians 3 and 1
  });
});

describe('literal frozen-D1 sensitivity', () => {
  const conv = (sales: NonNullable<ScoredConversation['dims']>['sales']): ScoredConversation => ({
    runId: 'r',
    conversationId: 'c',
    contestantId: 'm',
    scenarioId: 's',
    family: 'deep_factual',
    language: 'english',
    activeTrapIds: [],
    status: 'scored',
    sub: { hardFail: false, prog: 1, fact: 0.9, sales: 0.5, qual: 0.5 },
    dims: {
      fact: { fraction: 0.8, anchor: 3 },
      sales,
      qual: { fraction: 0.5, anchor: 1.5 },
    },
    hardFailSources: [],
  });

  it('an inapplicable sales anchor scores the binary fraction alone under the literal reading', () => {
    const c = conv({ fraction: 0.5, anchor: 2, anchorInapplicable: true });
    expect(literalD1Sub(c)?.sales).toBe(0.5);
    // The headline (amended) reading keeps the anchor term from SA2.
    expect(reblend(c, 0.5)?.sales).toBeCloseTo(0.5 * 0.5 + 0.5 * (2 / 3));
  });

  it('an applicable sales anchor is blended identically under both readings', () => {
    const c = conv({ fraction: 0.5, anchor: 2 });
    expect(literalD1Sub(c)?.sales).toBeCloseTo(0.5 * 0.5 + 0.5 * (2 / 3));
  });

  it('gated conversations stay composite-0 under the literal reading too', () => {
    const c: ScoredConversation = {
      ...conv({ fraction: null, anchor: null }),
      status: 'gated',
      sub: { hardFail: true, prog: 0.5, fact: 0, sales: 0, qual: 0 },
      dims: null,
    };
    expect(literalD1Sub(c)).toEqual(c.sub);
  });
});

describe('reblend (D1 ablation)', () => {
  const conv = (sub: SubScores, dims: ScoredConversation['dims']): ScoredConversation => ({
    runId: 'r',
    conversationId: 'c',
    contestantId: 'm',
    scenarioId: 's',
    family: 'deep_factual',
    language: 'english',
    activeTrapIds: [],
    status: 'scored',
    sub,
    dims,
    hardFailSources: [],
  });

  it('recomputes sub-scores at the 0.67/0.33 blend', () => {
    const c = conv(
      { hardFail: false, prog: 1, fact: 0.9, sales: 0.5, qual: 0.5 },
      {
        fact: { fraction: 0.8, anchor: 3 },
        sales: { fraction: 0.5, anchor: null },
        qual: { fraction: null, anchor: 1.5 },
      },
    );
    const re = reblend(c, 0.67);
    expect(re?.fact).toBeCloseTo(0.67 * 0.8 + 0.33 * 1);
    expect(re?.sales).toBe(0.5); // anchor-less: fraction alone under any blend
    expect(re?.qual).toBeCloseTo(0.5); // fraction-less: anchor/3 under any blend
  });

  it('gated conversations stay composite-0 under any blend', () => {
    const c = conv({ hardFail: true, prog: 0.5, fact: 0, sales: 0, qual: 0 }, null);
    expect(reblend(c, 0.67)).toEqual(c.sub);
  });
});

describe('G13 varianceFlags', () => {
  const conv = (scenarioId: string, success: boolean): ScoredConversation => ({
    runId: 'r',
    conversationId: `${scenarioId}#${success ? 's' : 'f'}`,
    contestantId: 'm',
    scenarioId,
    family: 'deep_factual',
    language: 'english',
    activeTrapIds: [],
    status: 'scored',
    sub: success
      ? { hardFail: false, prog: 1, fact: 0.9, sales: 0.9, qual: 0.9 }
      : { hardFail: true, prog: 1, fact: 0, sales: 0, qual: 0 },
    dims: null,
    hardFailSources: [],
  });

  it('flags only instances whose trials disagree on the D4 verdict', () => {
    const scored = [
      conv('stable_pass', true),
      conv('stable_pass', true),
      conv('stable_fail', false),
      conv('stable_fail', false),
      conv('mixed', true),
      conv('mixed', false),
    ];
    const flags = varianceFlags(scored);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('mixed');
  });
});
