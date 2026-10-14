/**
 * Persist decision for judge verdict files. A transport failure must stay
 * retryable on resume; judge-format errors are data (ADR-0019) and are kept.
 */

import { describe, expect, it } from 'vitest';

import type { JudgeCaseResult } from '../src/judge/judge.js';
import { shouldPersistJudgment } from '../src/run/judgeRun.js';

type Outcome = JudgeCaseResult['outcome'];

describe('shouldPersistJudgment', () => {
  it('does not persist a call_failed transport error', () => {
    expect(shouldPersistJudgment({ kind: 'error', code: 'call_failed', detail: 'x' })).toBe(false);
  });

  it('persists a verdict', () => {
    expect(shouldPersistJudgment({ kind: 'verdict', verdict: {} } as unknown as Outcome)).toBe(
      true,
    );
  });

  it.each(['no_json', 'schema_violation'] as const)('persists a %s error', (code) => {
    expect(shouldPersistJudgment({ kind: 'error', code, detail: 'x' })).toBe(true);
  });
});
