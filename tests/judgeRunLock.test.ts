/**
 * Judge-runner hardening (ADR-0036): one writer per (judge, verdict dir), and
 * meta pass files that concurrent per-judge passes can never overwrite. Both
 * defects were found on the 2026-09-20 pass - a stray process kept rewriting
 * one judge's verdicts, and three per-judge passes started in the same second
 * shared one meta filename.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { JUDGE_PANEL } from '../src/judge/panel.js';
import {
  JUDGMENTS_DIR,
  JUDGMENTS_RETEST_DIR,
  JUDGMENTS_REVERSED_DIR,
  acquireJudgeLocks,
  judgeLockPath,
  metaPassFilename,
  verdictBaseDir,
  writeMetaPass,
} from '../src/run/judgeRun.js';
import { REPO_ROOT } from '../src/run/scenarioSet.js';

const GROK = 'openrouter/x-ai/grok-4.3@xAI';
const MISTRAL = 'openrouter/mistralai/mistral-medium-3-5@Mistral';
const MAVERICK = 'openrouter/meta-llama/llama-4-maverick@Novita';

/** A pid that existed and has exited: a child we already waited for. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '']);
  if (child.pid === undefined) throw new Error('could not spawn a probe child');
  return child.pid;
}

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'gharbench-judgelock-'));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('judge lock', () => {
  it('lives in meta/, is never a .json file and never a directory at the base root', () => {
    const path = judgeLockPath(base, GROK);
    expect(path).toBe(join(base, 'meta', 'openrouter-x-ai-grok-4.3-xai.lock'));
    expect(path.endsWith('.json')).toBe(false);

    const locks = acquireJudgeLocks(base, [GROK], ['--judge=' + GROK]);
    // Only meta/ exists at the root, and the verdict readers already skip it.
    expect(readdirSync(base)).toEqual(['meta']);
    const holder = JSON.parse(readFileSync(path, 'utf8')) as {
      pid: number;
      ts: string;
      argv: string[];
    };
    expect(holder.pid).toBe(process.pid);
    expect(holder.argv).toEqual(['--judge=' + GROK]);
    expect(Number.isNaN(Date.parse(holder.ts))).toBe(false);
    locks.release();
    expect(existsSync(path)).toBe(false);
  });

  it('refuses a second writer on the same judge and dir, naming the live pid', () => {
    const first = acquireJudgeLocks(base, [GROK], []);
    expect(() => acquireJudgeLocks(base, [GROK], [])).toThrow(
      new RegExp(`held by running pid ${process.pid}`),
    );
    // The refusal took nothing: the first holder's lock is intact.
    expect(existsSync(judgeLockPath(base, GROK))).toBe(true);
    first.release();
    // Released: the next pass may write.
    const again = acquireJudgeLocks(base, [GROK], []);
    again.release();
  });

  it('a different judge, or the same judge in another verdict dir, is not blocked', () => {
    const grok = acquireJudgeLocks(base, [GROK], []);
    const mistral = acquireJudgeLocks(base, [MISTRAL], []);
    const otherDir = acquireJudgeLocks(join(base, 'reversed'), [GROK], []);
    for (const l of [grok, mistral, otherDir]) l.release();
  });

  it('a stale lock (dead pid) is refused with a delete-it-yourself message, never stolen', () => {
    const path = judgeLockPath(base, GROK);
    mkdirSync(join(base, 'meta'), { recursive: true });
    const stale = JSON.stringify({ pid: deadPid(), ts: '2026-09-20T10:00:00.000Z', argv: [] });
    writeFileSync(path, stale);
    expect(() => acquireJudgeLocks(base, [GROK], [])).toThrow(
      /stale judge lock: .* is not running.*delete the lock file by hand/s,
    );
    expect(readFileSync(path, 'utf8')).toBe(stale);
  });

  it('an unreadable lock is also refused as stale, untouched', () => {
    const path = judgeLockPath(base, GROK);
    mkdirSync(join(base, 'meta'), { recursive: true });
    writeFileSync(path, 'not json');
    expect(() => acquireJudgeLocks(base, [GROK], [])).toThrow(/has no readable pid/);
    expect(readFileSync(path, 'utf8')).toBe('not json');
  });

  it('multi-judge passes lock in sorted order and release everything on a refusal', () => {
    const all = acquireJudgeLocks(base, [MISTRAL, GROK, MAVERICK, GROK], []);
    expect(all.paths).toEqual([...all.paths].sort());
    expect(all.paths).toHaveLength(3); // the duplicate --judge is one lock
    all.release();

    // Hold the LAST lock in sorted order; a multi pass takes the first ones,
    // hits it, and must hand the ones it took back.
    const sorted = [GROK, MISTRAL, MAVERICK].map((r) => judgeLockPath(base, r)).sort();
    const lastRef = [GROK, MISTRAL, MAVERICK].find(
      (r) => judgeLockPath(base, r) === sorted[sorted.length - 1],
    );
    if (lastRef === undefined) throw new Error('unreachable');
    const holder = acquireJudgeLocks(base, [lastRef], []);
    expect(() => acquireJudgeLocks(base, [GROK, MISTRAL, MAVERICK], [])).toThrow(/held by/);
    for (const p of sorted.slice(0, -1)) expect(existsSync(p)).toBe(false);
    holder.release();
  });

  it('release is idempotent and never removes a lock another process now holds', () => {
    const locks = acquireJudgeLocks(base, [GROK], []);
    const path = judgeLockPath(base, GROK);
    // Simulate the file being replaced by another holder after we took it.
    const foreign = JSON.stringify({ pid: deadPid(), ts: 'x', argv: [] });
    writeFileSync(path, foreign);
    locks.release();
    expect(readFileSync(path, 'utf8')).toBe(foreign);
    locks.release();
  });
});

describe('meta pass filename', () => {
  const STAMP = '20261014T120000Z';

  it('three per-judge passes started in the same second get distinct names', () => {
    const names = JUDGE_PANEL.map((j) => metaPassFilename(STAMP, [j.ref], 'original'));
    expect(new Set(names).size).toBe(3);
    expect(names[0]).toBe(`${STAMP}-openrouter-x-ai-grok-4.3-xai-pass.json`);
  });

  it('names the order and collapses a multi-judge pass to "multi"', () => {
    expect(metaPassFilename(STAMP, [GROK], 'reversed')).toBe(
      `${STAMP}-openrouter-x-ai-grok-4.3-xai-reversed-pass.json`,
    );
    expect(metaPassFilename(STAMP, [GROK, MISTRAL], 'original')).toBe(`${STAMP}-multi-pass.json`);
    expect(metaPassFilename(STAMP, [GROK, GROK], 'original')).toBe(
      metaPassFilename(STAMP, [GROK], 'original'),
    );
  });

  it('writeMetaPass never overwrites: a taken name falls back to a pid-suffixed one', () => {
    const metaDir = join(base, 'meta');
    const first = writeMetaPass(metaDir, STAMP, [GROK, MISTRAL], 'original', '{"a":1}\n');
    const second = writeMetaPass(metaDir, STAMP, [GROK, MAVERICK], 'original', '{"b":2}\n');
    expect(first).not.toBe(second);
    expect(second).toBe(join(metaDir, `${STAMP}-multi-${process.pid}-pass.json`));
    expect(readFileSync(first, 'utf8')).toBe('{"a":1}\n');
    expect(readFileSync(second, 'utf8')).toBe('{"b":2}\n');
  });
});

describe('verdict base dir (every dir the lock must cover)', () => {
  it('maps calibration primary, reversed, retest and run-mode dirs', () => {
    expect(verdictBaseDir({ retest: false, itemOrder: 'original' })).toBe(JUDGMENTS_DIR);
    expect(verdictBaseDir({ retest: false, itemOrder: 'reversed' })).toBe(JUDGMENTS_REVERSED_DIR);
    expect(verdictBaseDir({ retest: true, itemOrder: 'original' })).toBe(JUDGMENTS_RETEST_DIR);
    expect(verdictBaseDir({ runId: 'r1', retest: false, itemOrder: 'original' })).toBe(
      join(REPO_ROOT, 'runs', 'r1', 'judgments'),
    );
    expect(verdictBaseDir({ runId: 'r1', retest: false, itemOrder: 'reversed' })).toBe(
      join(REPO_ROOT, 'runs', 'r1', 'judgments-reversed'),
    );
  });
});
