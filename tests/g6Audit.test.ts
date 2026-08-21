/**
 * G6 audit mark contract and gate arithmetic: clean marks carry no tags,
 * deviation marks must name one, and `met` can fail early but only pass
 * when every conversation is audited.
 */

import { describe, expect, it } from 'vitest';

import { g6MarkSchema, summariseG6, type G6Mark } from '../src/run/g6AuditServer.js';

const mark = (verdict: G6Mark['verdict'], deviations: G6Mark['deviations'] = []): G6Mark => ({
  conversationId: 'c',
  verdict,
  deviations,
  note: '',
  auditedAt: '2026-08-21T00:00:00.000Z',
});

describe('g6MarkSchema', () => {
  it('rejects a clean mark with tags and a deviation mark without', () => {
    expect(g6MarkSchema.safeParse(mark('clean', ['frame_break'])).success).toBe(false);
    expect(g6MarkSchema.safeParse(mark('minor')).success).toBe(false);
    expect(g6MarkSchema.safeParse(mark('clean')).success).toBe(true);
    expect(g6MarkSchema.safeParse(mark('critical', ['frame_break'])).success).toBe(true);
  });
});

describe('summariseG6', () => {
  it('ceilings for 20 conversations are 4 deviating / 1 critical', () => {
    const s = summariseG6({}, 20);
    expect(s.deviationCeiling).toBe(4);
    expect(s.criticalCeiling).toBe(1);
    expect(s.met).toBeNull();
  });

  it('a partial audit can fail early but never pass early', () => {
    const failing = summariseG6(
      {
        a: mark('critical', ['frame_break']),
        b: mark('critical', ['frame_break']),
      },
      20,
    );
    expect(failing.met).toBe(false);

    const partial = summariseG6({ a: mark('clean') }, 20);
    expect(partial.met).toBeNull();
  });

  it('passes only when complete and under both ceilings', () => {
    const entries: Record<string, G6Mark> = {};
    for (let i = 0; i < 20; i += 1) entries[`c${i}`] = mark(i < 3 ? 'minor' : 'clean', i < 3 ? ['register_mismatch'] : []);
    const s = summariseG6(entries, 20);
    expect(s.audited).toBe(20);
    expect(s.deviating).toBe(3);
    expect(s.met).toBe(true);
  });
});
