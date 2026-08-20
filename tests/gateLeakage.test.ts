/**
 * G16 leakage audit against a scratch git repository: a clean history passes,
 * a leaked private scenarioId - in the working tree or ONLY in history - is
 * caught, and a tracked private-pool/ file is caught.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { evaluateLeakageGate } from '../src/run/gateLeakage.js';

const IDS = ['scn_priv_zz1.P03', 'scn_priv_zz2.P07'];

function git(dir: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gharbench-g16-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  writeFileSync(
    join(dir, '.gitignore'),
    'private-pool/\ncalibration/\nhuman-validation/\n',
  );
  writeFileSync(join(dir, 'README.md'), 'clean file, only public ids like scn_cold_001\n');
  git(dir, 'add', '.gitignore', 'README.md');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('evaluateLeakageGate', () => {
  it('passes on a clean repo', () => {
    const dir = makeRepo();
    dirs.push(dir);
    const report = evaluateLeakageGate(dir, IDS);
    expect(report.met).toBe(true);
  });

  it('catches a private id in a tracked file', () => {
    const dir = makeRepo();
    dirs.push(dir);
    writeFileSync(join(dir, 'notes.md'), `remember to fix ${IDS[0]} tomorrow\n`);
    git(dir, 'add', 'notes.md');
    git(dir, 'commit', '-q', '-m', 'oops');
    const report = evaluateLeakageGate(dir, IDS);
    expect(report.met).toBe(false);
    expect(report.floors.find((f) => f.name.includes('working tree'))?.met).toBe(false);
  });

  it('catches a leak that only ever existed in history', () => {
    const dir = makeRepo();
    dirs.push(dir);
    writeFileSync(join(dir, 'notes.md'), `contains ${IDS[1]}\n`);
    git(dir, 'add', 'notes.md');
    git(dir, 'commit', '-q', '-m', 'leak');
    git(dir, 'rm', '-q', 'notes.md');
    git(dir, 'commit', '-q', '-m', 'remove leak');
    const report = evaluateLeakageGate(dir, IDS);
    expect(report.floors.find((f) => f.name.includes('working tree'))?.met).toBe(true);
    expect(report.floors.find((f) => f.name.includes('anywhere in history'))?.met).toBe(false);
    expect(report.met).toBe(false);
  });

  it('catches a tracked private-pool file', () => {
    const dir = makeRepo();
    dirs.push(dir);
    mkdirSync(join(dir, 'private-pool'), { recursive: true });
    writeFileSync(join(dir, 'private-pool', 'x.json'), '{}\n');
    git(dir, 'add', '-f', 'private-pool/x.json');
    git(dir, 'commit', '-q', '-m', 'forced add');
    const report = evaluateLeakageGate(dir, IDS);
    expect(report.floors.find((f) => f.name.includes('no tracked files'))?.met).toBe(false);
  });
});
