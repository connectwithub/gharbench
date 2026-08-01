import { describe, expect, it } from 'vitest';
import {
  TERMINATION_TOKENS,
  isTerminationToken,
  scanTerminationTokens,
} from '../src/engine/tokens.js';

describe('scanTerminationTokens', () => {
  it('returns no token for an ordinary message', () => {
    const scan = scanTerminationTokens('sounds good, send me the brochure');
    expect(scan.token).toBeNull();
    expect(scan.text).toBe('sounds good, send me the brochure');
  });

  it('detects each token and strips it from the surface text', () => {
    for (const token of TERMINATION_TOKENS) {
      const scan = scanTerminationTokens(`thanks, thats all ${token}`);
      expect(scan.token).toBe(token);
      expect(scan.text).toBe('thanks, thats all');
      expect(scan.text).not.toContain('#');
    }
  });

  it('matches a token anywhere in the message, not just at the end', () => {
    expect(scanTerminationTokens('###STOP### ok bye').token).toBe('###STOP###');
    expect(scanTerminationTokens('please ###TRANSFER### me to a manager').token).toBe(
      '###TRANSFER###',
    );
    expect(scanTerminationTokens('please ###TRANSFER### me to a manager').text).toBe(
      'please me to a manager',
    );
  });

  it('reports the first token by position when several appear', () => {
    const scan = scanTerminationTokens('a ###TRANSFER### b ###STOP### c');
    expect(scan.token).toBe('###TRANSFER###');
    expect(scan.text).toBe('a b c');
  });

  it('is case-sensitive: near-misses are not termination', () => {
    for (const near of ['###stop###', '## STOP ##', '#STOP#', 'STOP']) {
      expect(scanTerminationTokens(`bye ${near}`).token).toBeNull();
    }
  });

  it('strips every occurrence of every token once one is found', () => {
    const scan = scanTerminationTokens('###STOP### x ###STOP### y ###OUT-OF-SCOPE###');
    expect(scan.token).toBe('###STOP###');
    expect(scan.text).toBe('x y');
  });

  it('leaves a message that is only a token with empty text', () => {
    const scan = scanTerminationTokens('###STOP###');
    expect(scan.token).toBe('###STOP###');
    expect(scan.text).toBe('');
  });

  it('preserves line structure while tidying the gap a token leaves', () => {
    const scan = scanTerminationTokens('line one\nline two ###STOP###');
    expect(scan.text).toBe('line one\nline two');
  });
});

describe('isTerminationToken', () => {
  it('accepts exactly the three tokens', () => {
    for (const token of TERMINATION_TOKENS) expect(isTerminationToken(token)).toBe(true);
    expect(isTerminationToken('###HALT###')).toBe(false);
    expect(isTerminationToken('')).toBe(false);
  });
});
