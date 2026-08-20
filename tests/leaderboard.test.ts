/**
 * Leaderboard assembly primitives: panel aggregation per conversation x
 * dimension, the D1 re-blend, and the G13 variance flags.
 */

import { describe, expect, it } from 'vitest';

import type { JudgeVerdict } from '../src/judge/schema.js';
import { varianceFlags } from '../src/run/gatePhase6.js';
import { panelDimension, reblend, type ScoredConversation } from '../src/run/leaderboard.js';
import type { SubScores } from '../src/metrics/composite.js';

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
