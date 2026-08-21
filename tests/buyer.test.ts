/**
 * Buyer simulator prompt suite: the tau2-lifted guardrails and the per-turn
 * consistency-anchor re-injection (Master Plan 3.9 mandate 3).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUYER_GUARDRAILS, buildBuyerSystemPrompt, toBuyerView } from '../src/simulator/buyer.js';
import { loadFixtures } from '../src/run/smoke.js';
import type { ChatMessage } from '../src/contestants/types.js';

const msg = (role: ChatMessage['role'], content: string): ChatMessage =>
  ({ role, content }) as ChatMessage;

describe('BUYER_GUARDRAILS', () => {
  it('lifts the vendored tau2 lines verbatim', () => {
    const vendored = readFileSync(
      join(import.meta.dirname, '..', 'docs', 'tau2-attribution', 'simulation_guidelines.md'),
      'utf8',
    );
    // Lines that must match upstream word for word (the attribution claim).
    const lifted = [
      'Generate one message at a time, maintaining natural conversation flow.',
      'Strictly follow the scenario instructions you have received.',
      'Disclose information progressively. Wait for the agent to ask for specific information before providing it.',
      "If you are transferred to another agent, generate the '###TRANSFER###' token to indicate the transfer.",
      'Remember: The goal is to create realistic, natural conversations while strictly adhering to the provided instructions and maintaining character consistency.',
    ];
    for (const line of lifted) {
      expect(BUYER_GUARDRAILS).toContain(line);
      expect(vendored).toContain(line);
    }
  });

  it('carries the 3.9 mandates: no volunteering, scripted walk-away, reminder contract', () => {
    expect(BUYER_GUARDRAILS).toContain('Never volunteer your budget ceiling');
    expect(BUYER_GUARDRAILS).toContain('say "not now" and stop');
    expect(BUYER_GUARDRAILS).toContain('never ask another question');
    expect(BUYER_GUARDRAILS).toContain('<simulation-reminder>');
    expect(BUYER_GUARDRAILS).toContain('Never re-send a message you have already sent');
    for (const token of ['###STOP###', '###TRANSFER###', '###OUT-OF-SCOPE###']) {
      expect(BUYER_GUARDRAILS).toContain(token);
    }
  });

  it('is the stable cache prefix of the buyer system prompt', () => {
    const fixtures = loadFixtures();
    const prompt = buildBuyerSystemPrompt(fixtures.persona, fixtures.scenario);
    expect(prompt.startsWith(BUYER_GUARDRAILS)).toBe(true);
  });
});

describe('toBuyerView anchor re-injection', () => {
  const anchors = ['First-time buyer', 'Budget talk stays guarded', 'Deadline is 4 months'];
  const transcript = [
    msg('buyer', 'hi, price for 2bhk?'),
    msg('agent', '2BHK starts at 77L. Shall I share the sheet?'),
    msg('buyer', 'ok send'),
    msg('agent', 'Sent! Anything else?'),
  ];

  it('appends the reminder to the final user message only', () => {
    const view = toBuyerView(transcript, anchors);
    const reminders = view.filter(
      (m) => typeof m.content === 'string' && m.content.includes('<simulation-reminder>'),
    );
    expect(reminders).toHaveLength(1);
    const tail = view[view.length - 1];
    expect(tail?.role).toBe('user');
    expect(tail?.content).toContain('Sent! Anything else?');
    expect(tail?.content).toContain('- Deadline is 4 months');
    // History stays byte-identical to the un-anchored view (cache prefix).
    const plain = toBuyerView(transcript);
    expect(view.slice(0, -1)).toEqual(plain.slice(0, -1));
  });

  it('still injects into the (no reply yet) fallback', () => {
    const view = toBuyerView([msg('buyer', 'hello?')], anchors);
    const tail = view[view.length - 1];
    expect(tail?.role).toBe('user');
    expect(tail?.content).toContain('(no reply yet)');
    expect(tail?.content).toContain('<simulation-reminder>');
  });

  it('omits the block entirely when no anchors are passed', () => {
    const view = toBuyerView(transcript);
    for (const m of view) {
      expect(m.content).not.toContain('<simulation-reminder>');
    }
  });
});
