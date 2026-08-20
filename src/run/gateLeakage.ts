/**
 * The G16 private-pool leakage audit (`pnpm gate:leakage`), Master Plan §8
 * Phase 10 / G16 - the tau-bench "$1,000 lesson" applied to our own pool.
 *
 * A benchmark whose held-out set has leaked cannot be un-leaked. This gate
 * proves, mechanically, that no private scenario ever entered version
 * control: the private-pool/ path has no tracked files and no history, and
 * no private scenarioId string appears in ANY tracked file at ANY commit in
 * the repository's history. Run it before every release and before the
 * leaderboard launch; on a hit, rotate the leaked scenario out of the pool
 * and re-audit.
 *
 * The id-string scan is the tripwire, not the whole audit: the release
 * checklist still reviews few-shot files and published prompts by hand.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { REPO_ROOT, PRIVATE_SCENARIOS_DIR } from './scenarioSet.js';

export interface LeakageFloor {
  name: string;
  met: boolean;
  detail: string;
}

export interface LeakageReport {
  floors: LeakageFloor[];
  met: boolean;
}

function git(repoDir: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    // git grep exits 1 on "no matches" - that is the PASSING case.
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) return e.stdout ?? '';
    throw err;
  }
}

export function privateScenarioIds(scenariosDir: string = PRIVATE_SCENARIOS_DIR): string[] {
  if (!existsSync(scenariosDir)) return [];
  return readdirSync(scenariosDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const parsed = JSON.parse(readFileSync(join(scenariosDir, f), 'utf8')) as { scenarioId?: string };
      return parsed.scenarioId ?? f.replace(/\.json$/, '');
    })
    .sort();
}

export function evaluateLeakageGate(
  repoDir: string = REPO_ROOT,
  ids: readonly string[] = privateScenarioIds(),
): LeakageReport {
  const floors: LeakageFloor[] = [];
  const floor = (name: string, met: boolean, detail: string): void => {
    floors.push({ name, met, detail });
  };

  floor(
    'private pool present to audit',
    ids.length > 0,
    ids.length > 0 ? `${ids.length} private scenario id(s)` : 'private-pool/scenarios missing on this machine',
  );

  // 1. The path itself: never tracked, no history.
  const tracked = git(repoDir, ['ls-files', '--', 'private-pool']).trim();
  floor('private-pool/ has no tracked files', tracked === '', tracked === '' ? 'clean' : tracked.split('\n').slice(0, 3).join(', '));
  const history = git(repoDir, ['log', '--all', '--oneline', '--', 'private-pool/']).trim();
  floor('private-pool/ has no git history', history === '', history === '' ? 'clean' : history.split('\n').slice(0, 3).join('; '));

  // 2. No private id in any tracked file today.
  if (ids.length > 0) {
    const grepArgs = ['grep', '-l', '--fixed-strings'];
    for (const id of ids) grepArgs.push('-e', id);
    const now = git(repoDir, [...grepArgs]).trim();
    floor(
      'no private scenarioId in the working tree (tracked files)',
      now === '',
      now === '' ? `all ${ids.length} ids clean` : `HIT: ${now.split('\n').slice(0, 5).join(', ')}`,
    );

    // 3. ...nor at any commit in history.
    const revs = git(repoDir, ['rev-list', '--all']).trim().split('\n').filter(Boolean);
    let hits = '';
    if (revs.length > 0) {
      hits = git(repoDir, [...grepArgs, ...revs]).trim();
    }
    floor(
      `no private scenarioId anywhere in history (${revs.length} commit(s))`,
      hits === '',
      hits === '' ? `all ${ids.length} ids clean across history` : `HIT: ${hits.split('\n').slice(0, 5).join(', ')}`,
    );
  }

  // 4. Defense in depth: the ignore entries that keep it this way.
  const gitignorePath = join(repoDir, '.gitignore');
  const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  for (const entry of ['private-pool/', 'calibration/', 'human-validation/']) {
    floor(`.gitignore covers ${entry}`, gitignore.includes(entry), gitignore.includes(entry) ? 'present' : 'MISSING');
  }

  return { floors, met: floors.every((f) => f.met) };
}

function main(): void {
  const report = evaluateLeakageGate();
  for (const f of report.floors) console.log(`${f.met ? 'MET  ' : 'UNMET'}  ${f.name}  (${f.detail})`);
  console.log(`\nG16 leakage audit: ${report.met ? 'MET' : 'UNMET'}`);
  if (!report.met) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
