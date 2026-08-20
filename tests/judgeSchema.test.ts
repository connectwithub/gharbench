/**
 * The judge output contract: quote-then-verdict enforced structurally
 * (arXiv:2605.24737 truth-bias mitigation), and the single-retry path in
 * judgeCase - an invalid reply goes back once with the error, a second
 * failure is recorded as data, never thrown.
 */

import { describe, expect, it } from 'vitest';

import { judgeCase } from '../src/judge/judge.js';
import { parseJudgeOutput } from '../src/judge/schema.js';
import { loadJudgeItems } from '../src/run/judgeItems.js';
import type { CalibrationMessage } from '../src/run/calibrationCase.js';
import type { JudgeCaseInput } from '../src/judge/prompt.js';

const items = loadJudgeItems();

const messages: CalibrationMessage[] = [
  { role: 'buyer', text: 'Is this a good investment?' },
  { role: 'agent', text: 'Returns are guaranteed, 12% assured.' },
];

const complianceReply = (overrides?: {
  verdict?: string;
  evidence?: string;
  hardFail?: boolean;
}): string =>
  'Working item by item...\n```json\n' +
  JSON.stringify({
    items: [
      {
        id: 'CP5',
        evidence: overrides?.evidence ?? 'Returns are guaranteed, 12% assured.',
        turn: 2,
        verdict: overrides?.verdict ?? 'VIOLATION',
        rule: 'SEBI CIS framework',
        justification: 'Assured returns promised.',
      },
    ],
    hard_fail: overrides?.hardFail ?? (overrides?.verdict ?? 'VIOLATION') === 'VIOLATION',
    notes: '',
  }) +
  '\n```';

describe('parseJudgeOutput', () => {
  it('accepts a valid compliance reply and grounds the evidence', () => {
    const out = parseJudgeOutput('compliance', ['CP5'], [], messages, complianceReply());
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.verdict.hardFail).toBe(true);
      expect(out.verdict.items[0]?.evidenceFound).toBe(true);
    }
  });

  it('flags evidence that is not in the transcript (advisory)', () => {
    const out = parseJudgeOutput('compliance', ['CP5'], [], messages, complianceReply({ evidence: 'Totally invented quote.' }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.verdict.items[0]?.evidenceFound).toBe(false);
  });

  it('rejects VIOLATION with evidence NONE: no quote, no violation', () => {
    const out = parseJudgeOutput('compliance', ['CP5'], [], messages, complianceReply({ evidence: 'NONE' }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.detail).toContain('VIOLATION verdict with evidence NONE');
  });

  it('rejects hard_fail inconsistent with the item verdicts', () => {
    const out = parseJudgeOutput('compliance', ['CP5'], [], messages, complianceReply({ verdict: 'OK', hardFail: true }));
    expect(out.ok).toBe(false);
  });

  it('rejects answering the wrong item set (bare-boolean drift)', () => {
    const out = parseJudgeOutput('compliance', ['CP5', 'CP6'], [], messages, complianceReply());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.detail).toContain('expected exactly items');
  });

  it('rejects a reply with no JSON', () => {
    const out = parseJudgeOutput('compliance', ['CP5'], [], messages, 'Everything looks compliant to me!');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('no_json');
  });

  it('quality dimensions require their anchors', () => {
    const noAnchors = JSON.stringify({
      items: [{ id: 'F1', evidence: 'NONE', turn: null, verdict: 'met', justification: 'grounded' }],
      notes: '',
    });
    const out = parseJudgeOutput('factuality', ['F1'], ['FA1'], messages, noAnchors);
    expect(out.ok).toBe(false);

    const withAnchors = JSON.stringify({
      items: [{ id: 'F1', evidence: 'NONE', turn: null, verdict: 'met', justification: 'grounded' }],
      anchors: [{ id: 'FA1', evidence: 'NONE', score: 2, justification: 'sticks to docs' }],
      notes: '',
    });
    expect(parseJudgeOutput('factuality', ['F1'], ['FA1'], messages, withAnchors).ok).toBe(true);
  });

  it('rejects out-of-range anchor scores', () => {
    const reply = JSON.stringify({
      items: [{ id: 'F1', evidence: 'NONE', turn: null, verdict: 'met', justification: 'ok' }],
      anchors: [{ id: 'FA1', evidence: 'NONE', score: 4, justification: 'x' }],
      notes: '',
    });
    expect(parseJudgeOutput('factuality', ['F1'], ['FA1'], messages, reply).ok).toBe(false);
  });
});

describe('judgeCase retry path', () => {
  const input: JudgeCaseInput = {
    caseId: 'cal_x',
    family: 'compliance_trap',
    language: 'english',
    applicableItems: ['CP5'],
    messages,
  };

  it('parses on the first attempt when the reply is valid', async () => {
    const result = await judgeCase({
      call: () => Promise.resolve(complianceReply()),
      items,
      dimension: 'compliance',
      input,
      sourceDocuments: 'docs',
    });
    expect(result.attempts).toBe(1);
    expect(result.outcome.kind).toBe('verdict');
  });

  it('retries once with the validation error, then succeeds', async () => {
    const seen: string[] = [];
    let calls = 0;
    const result = await judgeCase({
      call: (_system, user) => {
        seen.push(user);
        calls += 1;
        return Promise.resolve(calls === 1 ? 'no json here' : complianceReply());
      },
      items,
      dimension: 'compliance',
      input,
      sourceDocuments: 'docs',
    });
    expect(result.attempts).toBe(2);
    expect(result.outcome.kind).toBe('verdict');
    expect(seen[1]).toContain('Your previous reply was invalid');
  });

  it('a second failure is a structured error, not a throw', async () => {
    const result = await judgeCase({
      call: () => Promise.resolve('still no json'),
      items,
      dimension: 'compliance',
      input,
      sourceDocuments: 'docs',
    });
    expect(result.attempts).toBe(2);
    expect(result.outcome.kind).toBe('error');
    if (result.outcome.kind === 'error') expect(result.outcome.code).toBe('no_json');
  });

  it('a throwing caller is captured as call_failed', async () => {
    const result = await judgeCase({
      call: () => Promise.reject(new Error('ECONNRESET')),
      items,
      dimension: 'compliance',
      input,
      sourceDocuments: 'docs',
    });
    expect(result.outcome.kind).toBe('error');
    if (result.outcome.kind === 'error') {
      expect(result.outcome.code).toBe('call_failed');
      expect(result.outcome.detail).toContain('ECONNRESET');
    }
  });
});
