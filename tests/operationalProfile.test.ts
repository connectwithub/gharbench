/**
 * Operational profile (ADR-0031): reply grouping, the percentile convention,
 * aggregation honesty, and the structural pin that latency never touches a
 * scoring surface.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  operationalProfile,
  replyGroups,
  type ProfileCall,
} from '../src/metrics/operationalProfile.js';

const buyer = (latencyMs = 100): ProfileCall => ({ role: 'buyer', latencyMs });
const agent = (latencyMs: number, outputTokens?: number): ProfileCall => ({
  role: 'contestant',
  latencyMs,
  ...(outputTokens !== undefined ? { outputTokens } : {}),
});

describe('replyGroups', () => {
  it('a reply is the run of contestant calls between two buyer calls', () => {
    // buyer opens, agent does tool loop (2 calls), buyer answers, agent replies once.
    const groups = replyGroups([buyer(), agent(500), agent(700), buyer(), agent(300)]);
    expect(groups).toEqual([
      { latencyMs: 1200, calls: 2 },
      { latencyMs: 300, calls: 1 },
    ]);
  });

  it('a scripted opener means the conversation starts on contestant calls - still reply 1', () => {
    const groups = replyGroups([agent(400), buyer(), agent(250)]);
    expect(groups).toEqual([
      { latencyMs: 400, calls: 1 },
      { latencyMs: 250, calls: 1 },
    ]);
  });

  it('buyer latency never enters a reply, and consecutive buyer calls do not make empty replies', () => {
    const groups = replyGroups([buyer(9999), buyer(9999), agent(100), buyer(9999)]);
    expect(groups).toEqual([{ latencyMs: 100, calls: 1 }]);
  });

  it('unknown roles neither extend nor close a group', () => {
    const judge: ProfileCall = { role: 'judge', latencyMs: 5000 };
    const groups = replyGroups([buyer(), agent(100), judge, agent(200), buyer()]);
    expect(groups).toEqual([{ latencyMs: 300, calls: 2 }]);
  });
});

describe('operationalProfile', () => {
  it('aggregates replies across conversations with the ci.ts order-statistic convention', () => {
    // Reply latencies across both conversations: 100..1000 (10 replies, one call each).
    const conversations = Array.from({ length: 10 }, (_, i) => [buyer(), agent((i + 1) * 100)]);
    const p = operationalProfile(conversations);
    expect(p).not.toBeNull();
    expect(p?.conversations).toBe(10);
    expect(p?.replies).toBe(10);
    // round(0.5 * 9) = 5 -> sorted[5] = 600; round(0.95 * 9) = 9 -> 1000.
    expect(p?.replyLatencyMs.medianMs).toBe(600);
    expect(p?.replyLatencyMs.p95Ms).toBe(1000);
    expect(p?.replyLatencyMs.maxMs).toBe(1000);
    expect(p?.replyLatencyMs.meanMs).toBeCloseTo(550);
    expect(p?.callsPerReply).toEqual({ mean: 1, max: 1 });
  });

  it('tokens/sec uses only contestant calls that reported outputTokens', () => {
    const p = operationalProfile([
      [buyer(), agent(1000, 50), agent(1000), buyer(), agent(500, 25)],
    ]);
    // 75 tokens over 1.5s of latency (the tokenless call is excluded from both sums).
    expect(p?.outputTokensPerSecond).toBeCloseTo(50);
    expect(p?.callLatencyMs.n).toBe(3);
  });

  it('no contestant calls anywhere -> null, never a zero-shaped profile', () => {
    expect(operationalProfile([])).toBeNull();
    expect(operationalProfile([[buyer(), buyer()]])).toBeNull();
  });

  it('a conversation with no contestant calls does not count toward conversations', () => {
    const p = operationalProfile([[buyer()], [buyer(), agent(100)]]);
    expect(p?.conversations).toBe(1);
  });
});

describe('latency never reaches a scoring surface', () => {
  it('composite, pass^k and the judge stack are latency-blind', () => {
    const files = [
      join(import.meta.dirname, '..', 'src', 'metrics', 'composite.ts'),
      join(import.meta.dirname, '..', 'src', 'metrics', 'passk.ts'),
      ...readdirSync(join(import.meta.dirname, '..', 'src', 'judge'))
        .filter((f) => f.endsWith('.ts'))
        .map((f) => join(import.meta.dirname, '..', 'src', 'judge', f)),
    ];
    for (const file of files) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/latenc|operationalProfile/i);
    }
  });
});
