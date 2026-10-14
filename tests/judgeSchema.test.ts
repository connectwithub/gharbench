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
    const out = parseJudgeOutput(
      'compliance',
      ['CP5'],
      [],
      messages,
      complianceReply({ evidence: 'Totally invented quote.' }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.verdict.items[0]?.evidenceFound).toBe(false);
  });

  it('rejects VIOLATION with evidence NONE: no quote, no violation', () => {
    const out = parseJudgeOutput(
      'compliance',
      ['CP5'],
      [],
      messages,
      complianceReply({ evidence: 'NONE' }),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.detail).toContain('VIOLATION verdict with evidence NONE');
  });

  it('rejects hard_fail inconsistent with the item verdicts', () => {
    const out = parseJudgeOutput(
      'compliance',
      ['CP5'],
      [],
      messages,
      complianceReply({ verdict: 'OK', hardFail: true }),
    );
    expect(out.ok).toBe(false);
  });

  it('rejects answering the wrong item set (bare-boolean drift)', () => {
    const out = parseJudgeOutput('compliance', ['CP5', 'CP6'], [], messages, complianceReply());
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.detail).toContain('expected exactly items');
  });

  it('rejects a reply with no JSON', () => {
    const out = parseJudgeOutput(
      'compliance',
      ['CP5'],
      [],
      messages,
      'Everything looks compliant to me!',
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('no_json');
  });

  it('quality dimensions require their anchors', () => {
    const noAnchors = JSON.stringify({
      items: [
        { id: 'F1', evidence: 'NONE', turn: null, verdict: 'met', justification: 'grounded' },
      ],
      notes: '',
    });
    const out = parseJudgeOutput('factuality', ['F1'], ['FA1'], messages, noAnchors);
    expect(out.ok).toBe(false);

    const withAnchors = JSON.stringify({
      items: [
        { id: 'F1', evidence: 'NONE', turn: null, verdict: 'met', justification: 'grounded' },
      ],
      anchors: [{ id: 'FA1', evidence: 'NONE', score: 2, justification: 'sticks to docs' }],
      notes: '',
    });
    expect(parseJudgeOutput('factuality', ['F1'], ['FA1'], messages, withAnchors).ok).toBe(true);
  });

  it('tolerates an extra turn on anchors and numeric strings for turn and score', () => {
    const reply = JSON.stringify({
      items: [{ id: 'F1', evidence: 'NONE', turn: 't2', verdict: 'met', justification: 'ok' }],
      anchors: [{ id: 'FA1', evidence: 'NONE', score: '2', turn: 2, justification: 'x' }],
      notes: '',
    });
    const out = parseJudgeOutput('factuality', ['F1'], ['FA1'], messages, reply);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.verdict.items[0]?.turn).toBe(2);
      expect(out.verdict.anchors[0]?.score).toBe(2);
      expect(Object.keys(out.verdict.anchors[0] ?? {})).not.toContain('turn');
    }
  });

  it('still rejects any other unknown key and non-numeric text in numeric fields', () => {
    const unknownKey = JSON.stringify({
      items: [{ id: 'F1', evidence: 'NONE', turn: null, verdict: 'met', justification: 'ok' }],
      anchors: [{ id: 'FA1', evidence: 'NONE', score: 2, confidence: 0.9, justification: 'x' }],
      notes: '',
    });
    expect(parseJudgeOutput('factuality', ['F1'], ['FA1'], messages, unknownKey).ok).toBe(false);
    const badScore = JSON.stringify({
      items: [{ id: 'F1', evidence: 'NONE', turn: null, verdict: 'met', justification: 'ok' }],
      anchors: [{ id: 'FA1', evidence: 'NONE', score: 'two', justification: 'x' }],
      notes: '',
    });
    expect(parseJudgeOutput('factuality', ['F1'], ['FA1'], messages, badScore).ok).toBe(false);
  });

  it('grounds a verbatim quote despite an attribution wrapper or typographic glyphs', () => {
    const curly: CalibrationMessage[] = [
      { role: 'buyer', text: 'Kya yeh east-facing hai?' },
      { role: 'agent', text: 'It\u2019s not east-facing \u2014 the unit faces the park.' },
    ];
    const reply = (evidence: string): string =>
      JSON.stringify({
        items: [
          {
            id: 'F1',
            evidence,
            turn: 2,
            verdict: 'not_met',
            justification: 'fabricated orientation',
          },
        ],
        anchors: [{ id: 'FA1', evidence: 'NONE', score: 1, justification: 'x' }],
        notes: '',
      });
    const found = (evidence: string): boolean | null => {
      const out = parseJudgeOutput('factuality', ['F1'], ['FA1'], curly, reply(evidence));
      if (!out.ok) throw new Error(out.detail);
      return out.verdict.items[0]?.evidenceFound ?? null;
    };
    expect(found('[t2 | agent] It\u2019s not east-facing \u2014 the unit faces the park.')).toBe(
      true,
    );
    expect(found("t2: \u201cIt's not east-facing - the unit faces the park.\u201d")).toBe(true);
    expect(found('The agent fabricates the orientation')).toBe(false);
    expect(found('[t2 | agent]')).toBe(false);
  });

  it('separates unlocatable meta-commentary from a near-miss quote (advisory only)', () => {
    // Both are evidenceFound=false, but they mean opposite things about the
    // judge: a near-miss still points AT a line, meta-commentary points at
    // nothing. Neither may become a schema_violation (ADR-0019).
    const flags = (evidence: string): { found: boolean | null; meta: boolean | undefined } => {
      const out = parseJudgeOutput(
        'compliance',
        ['CP5'],
        [],
        messages,
        complianceReply(evidence === 'NONE' ? { evidence, verdict: 'OK' } : { evidence }),
      );
      if (!out.ok) throw new Error(out.detail);
      const item = out.verdict.items[0];
      return { found: item?.evidenceFound ?? null, meta: item?.evidenceMeta };
    };

    expect(flags('The entire conversation flow')).toEqual({ found: false, meta: true });
    expect(flags('Returns are guaranteed, 12% assured.')).toEqual({ found: true, meta: false });
    expect(flags('[t2 | agent] Returns are guaranteed, 12% assured.')).toEqual({
      found: true,
      meta: false,
    });
    expect(flags('NONE')).toEqual({ found: null, meta: false });
    // Too short to locate at all.
    expect(flags('no quote')).toEqual({ found: false, meta: true });
    // A near-miss paraphrase shares content words, so it is NOT meta.
    expect(flags('the agent guaranteed returns of 12 percent')).toEqual({
      found: false,
      meta: false,
    });
  });

  it('flags meta-commentary on anchors too', () => {
    const reply = JSON.stringify({
      items: [{ id: 'F1', evidence: 'NONE', turn: null, verdict: 'met', justification: 'ok' }],
      anchors: [
        {
          id: 'FA1',
          evidence: 'Overall the conversation stayed accurate',
          score: 2,
          justification: 'x',
        },
      ],
      notes: '',
    });
    const out = parseJudgeOutput('factuality', ['F1'], ['FA1'], messages, reply);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.verdict.anchors[0]?.evidenceFound).toBe(false);
      expect(out.verdict.anchors[0]?.evidenceMeta).toBe(true);
      expect(out.verdict.items[0]?.evidenceMeta).toBe(false);
    }
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

  it('a structured error carries the last reply, truncated', async () => {
    // The zod detail alone cannot say whether the judge emitted prose, a
    // duplicated item block, or nothing - keep the reply itself (ADR-0032).
    const second = await judgeCase({
      call: (_system, user) =>
        Promise.resolve(user.includes('previous reply was invalid') ? 'RETRY PROSE' : 'FIRST'),
      items,
      dimension: 'compliance',
      input,
      sourceDocuments: 'docs',
    });
    expect(second.outcome.kind === 'error' && second.outcome.raw).toBe('RETRY PROSE');

    const long = 'x'.repeat(20_050);
    const truncated = await judgeCase({
      call: () => Promise.resolve(long),
      items,
      dimension: 'compliance',
      input,
      sourceDocuments: 'docs',
    });
    if (truncated.outcome.kind !== 'error') throw new Error('expected an error outcome');
    expect(truncated.outcome.raw).toHaveLength(20_000 + '…[truncated 50 chars]'.length);
    expect(truncated.outcome.raw?.endsWith('…[truncated 50 chars]')).toBe(true);
  });

  it('omits raw when no reply ever arrived', async () => {
    const result = await judgeCase({
      call: () => Promise.reject(new Error('ECONNRESET')),
      items,
      dimension: 'compliance',
      input,
      sourceDocuments: 'docs',
    });
    expect(result.outcome.kind === 'error' && result.outcome.raw).toBeUndefined();
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

/**
 * ADR-0037: the anchors a case must answer are config-derived per case. SA1
 * is expected only where SE6 is declared, so an SA1 score on an undeclared
 * case is rejected exactly like a missing SA2 - and the judge is told which
 * set to answer on the scenario card.
 */
describe('judgeCase per-case anchor set (salesEffectiveness)', () => {
  const seInput = (applicableItems: string[]): JudgeCaseInput => ({
    caseId: 'cal_se',
    family: 'objection_handling',
    language: 'english',
    applicableItems,
    messages,
  });
  const seReply = (itemIds: string[], anchorIds: string[]): string =>
    JSON.stringify({
      items: itemIds.map((id) => ({
        id,
        evidence: 'NONE',
        turn: null,
        verdict: 'met',
        justification: 'ok',
      })),
      anchors: anchorIds.map((id) => ({ id, evidence: 'NONE', score: 2, justification: 'ok' })),
      notes: '',
    });

  it('an SE6-declared case expects SA1 and SA2', async () => {
    const users: string[] = [];
    const ok = await judgeCase({
      call: (_s, user) => {
        users.push(user);
        return Promise.resolve(seReply(['SE5', 'SE6'], ['SA1', 'SA2']));
      },
      items,
      dimension: 'salesEffectiveness',
      input: seInput(['SE5', 'SE6']),
      sourceDocuments: 'docs',
    });
    expect(ok.outcome.kind).toBe('verdict');
    expect(users[0]).toContain('Then score the applicable anchors: SA1, SA2.');

    const missingSa1 = await judgeCase({
      call: () => Promise.resolve(seReply(['SE5', 'SE6'], ['SA2'])),
      items,
      dimension: 'salesEffectiveness',
      input: seInput(['SE5', 'SE6']),
      sourceDocuments: 'docs',
    });
    expect(missingSa1.outcome.kind).toBe('error');
    if (missingSa1.outcome.kind === 'error') {
      expect(missingSa1.outcome.detail).toContain('anchors: expected exactly items [SA1,SA2]');
    }
  });

  it('an undeclared case expects SA2 only and rejects an unasked SA1', async () => {
    const ok = await judgeCase({
      call: () => Promise.resolve(seReply(['SE5'], ['SA2'])),
      items,
      dimension: 'salesEffectiveness',
      input: seInput(['SE5']),
      sourceDocuments: 'docs',
    });
    expect(ok.outcome.kind).toBe('verdict');
    if (ok.outcome.kind === 'verdict') {
      expect(ok.outcome.verdict.anchors.map((a) => a.id)).toEqual(['SA2']);
    }

    const users: string[] = [];
    const extra = await judgeCase({
      call: (_s, user) => {
        users.push(user);
        return Promise.resolve(seReply(['SE5'], ['SA1', 'SA2']));
      },
      items,
      dimension: 'salesEffectiveness',
      input: seInput(['SE5']),
      sourceDocuments: 'docs',
    });
    expect(extra.outcome.kind).toBe('error');
    if (extra.outcome.kind === 'error') {
      expect(extra.outcome.detail).toContain('anchors: expected exactly items [SA2]');
    }
    expect(users[0]).not.toContain('SA1');
  });

  it('dimensions without a conditional anchor keep the full anchor set', async () => {
    const result = await judgeCase({
      call: () =>
        Promise.resolve(
          JSON.stringify({
            items: [{ id: 'F1', evidence: 'NONE', turn: null, verdict: 'met', justification: 'x' }],
            anchors: [{ id: 'FA1', evidence: 'NONE', score: 3, justification: 'x' }],
            notes: '',
          }),
        ),
      items,
      dimension: 'factuality',
      input: { ...seInput(['F1']), family: 'deep_factual' },
      sourceDocuments: 'docs',
    });
    expect(result.outcome.kind).toBe('verdict');
  });
});
