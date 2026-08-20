/**
 * Sweep-runner plumbing that must not cost money to test: argument parsing,
 * scenario selection, and the resolveModel description used in the manifest.
 * Live sweeps are exercised by hand (`pnpm sweep ... --dry-run` first).
 */

import { describe, expect, it } from 'vitest';
import { parseSweepArgs, selectScenarios } from '../src/run/sweep.js';
import { loadScenarioSet } from '../src/run/scenarioSet.js';

const set = loadScenarioSet();

describe('parseSweepArgs', () => {
  it('parses a full argument set', () => {
    const options = parseSweepArgs([
      '--contestant=anthropic/claude-haiku-4-5',
      '--contestant=openai/gpt-4.1-mini',
      '--buyer=openai/gpt-4.1-mini',
      '--scenarios=scn_cold_001.P01,scn_visit_001.P01',
      '--trials=3',
      '--concurrency=2',
      '--max-usd=5',
      '--dry-run',
    ]);
    expect(options.contestants).toHaveLength(2);
    expect(options.buyer).toBe('openai/gpt-4.1-mini');
    expect(options.scenarios).toEqual(['scn_cold_001.P01', 'scn_visit_001.P01']);
    expect(options.trials).toBe(3);
    expect(options.concurrency).toBe(2);
    expect(options.maxUsd).toBe(5);
    expect(options.dryRun).toBe(true);
  });

  it('requires a contestant and a buyer', () => {
    expect(() => parseSweepArgs(['--buyer=x/y'])).toThrow(/contestant/);
    expect(() => parseSweepArgs(['--contestant=x/y'])).toThrow(/buyer/);
  });

  it('rejects unknown flags instead of silently ignoring them', () => {
    expect(() => parseSweepArgs(['--contestant=x/y', '--buyer=a/b', '--trails=3'])).toThrow(
      /Unknown sweep argument/,
    );
  });
});

describe('selectScenarios', () => {
  it('public excludes the private pool; all includes it when present', () => {
    const publicOnly = selectScenarios(set, 'public');
    expect(publicOnly.every((s) => s.pool === 'public')).toBe(true);

    const all = selectScenarios(set, 'all');
    expect(all.length).toBeGreaterThanOrEqual(publicOnly.length);
  });

  it('resolves explicit ids and rejects unknown ones', () => {
    const picked = selectScenarios(set, ['scn_cold_001.P01']);
    expect(picked.map((s) => s.scenarioId)).toEqual(['scn_cold_001.P01']);
    expect(() => selectScenarios(set, ['scn_nope_999.P01'])).toThrow(/Unknown scenario ids/);
  });
});
