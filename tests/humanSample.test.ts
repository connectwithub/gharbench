/**
 * The Phase 7 human-validation sample: I9 floors first, deterministic
 * selection, and - the part that protects the protocol - blind case files
 * with the contestant identity confined to mapping.json.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { selectSample, writeSample, type SampleCandidate } from '../src/run/humanSample.js';

const APPLICABILITY = {
  factuality: ['F1'],
  compliance: ['CP5'],
  salesEffectiveness: [],
  conversationQuality: [],
};

function candidate(family: string, i: number): SampleCandidate {
  return {
    runId: 'run1',
    conversationId: `scn_${family}_${i}#0`,
    contestantId: 'anthropic/claude-sonnet-4-6',
    scenarioId: `scn_${family}_${i}`,
    family,
    language: family === 'hinglish_variant' ? 'hinglish' : 'english',
    band: 'borderline',
    endedBy: 'buyer',
    judgeApplicability: APPLICABILITY,
    messages: [
      { role: 'buyer', text: 'hi' },
      { role: 'agent', text: 'hello ji' },
    ],
  };
}

const pool: SampleCandidate[] = [
  ...Array.from({ length: 60 }, (_, i) => candidate('compliance_trap', i)),
  ...Array.from({ length: 60 }, (_, i) => candidate('hinglish_variant', i)),
  ...Array.from({ length: 120 }, (_, i) => candidate('cold_inquiry', i)),
  ...Array.from({ length: 10 }, (_, i) => candidate('deep_factual', i)),
];

describe('selectSample', () => {
  it('fills the n=5 family floors before proportional fill', () => {
    const sample = selectSample(pool, 100);
    const byFamily: Record<string, number> = {};
    for (const c of sample) byFamily[c.family] = (byFamily[c.family] ?? 0) + 1;
    expect(sample).toHaveLength(100);
    expect(byFamily['compliance_trap']).toBeGreaterThanOrEqual(30);
    expect(byFamily['hinglish_variant']).toBeGreaterThanOrEqual(30);
  });

  it('is deterministic', () => {
    const a = selectSample(pool, 50).map((c) => c.conversationId);
    const b = selectSample(pool, 50).map((c) => c.conversationId);
    expect(a).toEqual(b);
  });

  it('caps at the pool when the ask is larger', () => {
    expect(selectSample(pool.slice(0, 7), 200)).toHaveLength(7);
  });
});

describe('writeSample blinding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gharbench-hv-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('case files carry no contestant identity; mapping.json does', () => {
    const sample = selectSample(pool, 5);
    const { written } = writeSample(sample, dir);
    expect(written).toBe(5);

    for (const f of readdirSync(join(dir, 'cases'))) {
      const text = readFileSync(join(dir, 'cases', f), 'utf8');
      expect(text).not.toContain('claude-sonnet');
      expect(text).not.toContain('provenance');
      expect(text).not.toContain('run1');
    }
    const mapping = JSON.parse(readFileSync(join(dir, 'mapping.json'), 'utf8')) as Record<
      string,
      { contestantId: string }
    >;
    expect(Object.keys(mapping)).toHaveLength(5);
    expect(Object.values(mapping)[0]?.contestantId).toBe('anthropic/claude-sonnet-4-6');
  });
});
