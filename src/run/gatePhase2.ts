/**
 * Gate G3 (`pnpm gate:phase2`): the Layer-1 checks must catch 100% of the
 * seeded violations and fire zero times on the known-clean twins.
 *
 * A missed violation means a check is blind; a false fire means a check
 * punishes correct behaviour - both are defects in the checks, not findings
 * about any agent, and either fails this gate.
 */

import { pathToFileURL } from 'node:url';

import { runChecks } from '../checks/runner.js';
import { buildSeededCases } from '../checks/seeded.js';

export interface G3Report {
  violations: number;
  caught: number;
  cleans: number;
  falseFires: number;
  misses: string[];
  fires: string[];
  met: boolean;
}

export function evaluateG3(): G3Report {
  const cases = buildSeededCases();
  const misses: string[] = [];
  const fires: string[] = [];
  let violations = 0;
  let caught = 0;
  let cleans = 0;

  for (const seeded of cases) {
    const report = runChecks(seeded.ctx);
    const result = report.results.find((r) => r.id === seeded.checkId);
    const failed = result !== undefined && !result.passed;

    if (seeded.expectFail) {
      violations += 1;
      if (failed) caught += 1;
      else misses.push(`${seeded.checkId} missed: ${seeded.name}`);
    } else {
      cleans += 1;
      if (failed) fires.push(`${seeded.checkId} false fire on: ${seeded.name} (${result?.reason})`);
    }
  }

  return {
    violations,
    caught,
    cleans,
    falseFires: fires.length,
    misses,
    fires,
    met: misses.length === 0 && fires.length === 0,
  };
}

function main(): void {
  const g3 = evaluateG3();
  console.log('=== Gate G3: seeded-violation detection ===');
  console.log(`seeded violations caught: ${g3.caught}/${g3.violations}`);
  console.log(`false fires on clean twins: ${g3.falseFires}/${g3.cleans}`);
  for (const m of g3.misses) console.log(`  MISS  ${m}`);
  for (const f of g3.fires) console.log(`  FIRE  ${f}`);
  console.log(g3.met ? '\nGATE G3: MET' : '\nGATE G3: NOT MET');
  process.exitCode = g3.met ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
