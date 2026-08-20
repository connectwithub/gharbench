/**
 * The Phase 1 gate, as a machine check (`pnpm gate:phase1`).
 *
 * Master Plan section 8: every scenario has a deterministic ground-truth
 * outcome, at least one applicable programmatic check, and declared L1
 * check-id and judge-item applicability sets (D2/I4). Most of that is
 * enforced at load by the scenario schema; this tool checks what a schema
 * cannot: referential integrity across the set, the stratification and
 * authoring floors (3.4, 3.7, I9), and the public/private split (G16).
 *
 * The sampling procedure this enforces is deliberate authoring against
 * declared floors and balance rules - not convenience sampling. The floors
 * live here, in code, so "sampled properly" is a build outcome rather than a
 * claim (Bean et al. 2025).
 */

import { pathToFileURL } from 'node:url';

import { SCENARIO_FAMILIES, type ScenarioFamily } from '../engine/scenario.js';
import { baseScenarioId, crossValidate, loadScenarioSet, type ScenarioSet } from './scenarioSet.js';

export interface Floor {
  name: string;
  target: string;
  actual: number | string;
  met: boolean;
}

export interface GateReport {
  /** Referential-integrity problems; any entry is a hard failure. */
  problems: string[];
  /** Per-scenario gate issues a schema cannot see. */
  scenarioIssues: string[];
  counts: {
    instances: number;
    baseSituations: number;
    publicInstances: number;
    privateInstances: number;
    privateShare: number;
    byFamily: Record<ScenarioFamily, number>;
    hinglishInstances: number;
    /** Outcome stratum: does the ground truth end in a non-buyer close? */
    nonBuyerOutcomeShare: number;
  };
  floors: Floor[];
  privatePoolLoaded: boolean;
  met: boolean;
}

const NON_BUYER_OUTCOMES = new Set(['buyer_disengages']);

export function evaluatePhase1Gate(set: ScenarioSet): GateReport {
  const problems = crossValidate(set);
  const scenarioIssues: string[] = [];

  const byFamily = Object.fromEntries(SCENARIO_FAMILIES.map((f) => [f, 0])) as Record<
    ScenarioFamily,
    number
  >;
  const bases = new Set<string>();
  let privateInstances = 0;
  let hinglishInstances = 0;
  let nonBuyer = 0;

  for (const s of set.scenarios) {
    byFamily[s.family] += 1;
    bases.add(baseScenarioId(s.scenarioId));
    if (s.pool === 'private') privateInstances += 1;
    if (s.language === 'hinglish') hinglishInstances += 1;
    const coldClose =
      s.groundTruth.expectedOutcome === 'qualification_logged' &&
      s.groundTruth.expectedLeadScore === 'cold';
    if (NON_BUYER_OUTCOMES.has(s.groundTruth.expectedOutcome) || coldClose) nonBuyer += 1;

    const judgeItems =
      s.judgeApplicability.factuality.length +
      s.judgeApplicability.compliance.length +
      s.judgeApplicability.salesEffectiveness.length +
      s.judgeApplicability.conversationQuality.length;
    if (judgeItems === 0) {
      scenarioIssues.push(`${s.scenarioId}: declares no judge items in any dimension`);
    }
  }

  const instances = set.scenarios.length;
  const privateShare = instances === 0 ? 0 : privateInstances / instances;

  const floors: Floor[] = [
    {
      name: 'base situations',
      target: '60-80',
      actual: bases.size,
      met: bases.size >= 60 && bases.size <= 80,
    },
    {
      name: 'instances',
      target: '150-250',
      actual: instances,
      met: instances >= 150 && instances <= 250,
    },
    ...SCENARIO_FAMILIES.map((f) => ({
      name: `family ${f}`,
      target: '>=20 instances (I9)',
      actual: byFamily[f],
      met: byFamily[f] >= 20,
    })),
    {
      name: 'hinglish stratum',
      target: '>=30 instances (I9)',
      actual: hinglishInstances,
      met: hinglishInstances >= 30,
    },
    {
      name: 'private share',
      target: '25-35% (G16, section 3.4)',
      actual: `${(privateShare * 100).toFixed(1)}%`,
      met: privateShare >= 0.25 && privateShare <= 0.35,
    },
    // Balance rule (a): every difficulty tier appears in every family.
    ...SCENARIO_FAMILIES.map((f) => {
      const tiers = new Set(set.scenarios.filter((s) => s.family === f).map((s) => s.difficulty));
      return {
        name: `family ${f} difficulty spread`,
        target: 'all 3 tiers present',
        actual: [...tiers].sort().join(',') || 'none',
        met: tiers.size === 3,
      };
    }),
  ];

  const met = problems.length === 0 && scenarioIssues.length === 0 && floors.every((f) => f.met);

  return {
    problems,
    scenarioIssues,
    counts: {
      instances,
      baseSituations: bases.size,
      publicInstances: instances - privateInstances,
      privateInstances,
      privateShare,
      byFamily,
      hinglishInstances,
      nonBuyerOutcomeShare: instances === 0 ? 0 : nonBuyer / instances,
    },
    floors,
    privatePoolLoaded: set.privatePoolLoaded,
    met,
  };
}

function main(): void {
  const set = loadScenarioSet();
  const report = evaluatePhase1Gate(set);

  console.log('=== Phase 1 gate ===');
  console.log(
    `scenario set: ${report.counts.instances} instances / ${report.counts.baseSituations} base situations ` +
      `(${report.counts.publicInstances} public, ${report.counts.privateInstances} private` +
      `${report.privatePoolLoaded ? '' : '; PRIVATE POOL NOT PRESENT ON THIS MACHINE'})`,
  );

  if (report.problems.length > 0) {
    console.log('\nReferential-integrity problems (hard failures):');
    for (const p of report.problems) console.log(`  FAIL ${p}`);
  } else {
    console.log('referential integrity: OK (personas, traps, seeds, dbVersion, id bindings)');
  }

  if (report.scenarioIssues.length > 0) {
    console.log('\nPer-scenario issues:');
    for (const p of report.scenarioIssues) console.log(`  FAIL ${p}`);
  }

  console.log('\nStratification:');
  for (const family of SCENARIO_FAMILIES) {
    console.log(`  ${family.padEnd(22)} ${report.counts.byFamily[family]}`);
  }
  console.log(
    `  non-buyer-outcome share ${(report.counts.nonBuyerOutcomeShare * 100).toFixed(1)}% (tracked per 3.9; report in the paper)`,
  );

  console.log('\nFloors and balance rules:');
  for (const floor of report.floors) {
    console.log(
      `  ${floor.met ? 'MET ' : 'UNMET'}  ${floor.name}: ${String(floor.actual)} (target ${floor.target})`,
    );
  }

  console.log(
    report.met
      ? '\nPHASE 1 GATE: MET'
      : '\nPHASE 1 GATE: NOT MET (unmet floors above are the remaining authoring work; integrity problems, if any, are defects)',
  );
  process.exitCode = report.met ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
