/**
 * Post-run Layer-1 checker (`pnpm checks --run=<runId>`).
 *
 * Loads a run's transcripts, resolves each record's scenario and persona from
 * the authored set, applies the declared-applicable checks and writes
 * runs/<runId>/checks.jsonl plus a summary. Conversations whose scenario is
 * not in the benchmark set (e.g. the Phase 0 mock) are skipped with a notice.
 *
 * Exit code is 0 whenever scoring completed: failed checks are FINDINGS about
 * the contestant, not errors of the harness.
 */

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runChecks } from '../checks/runner.js';
import type { CheckReport } from '../checks/types.js';
import { TRANSCRIPT_FILENAME, readTranscripts } from '../logging/transcript.js';
import { REPO_ROOT, loadScenarioSet } from './scenarioSet.js';

export interface RunCheckSummary {
  runId: string;
  reports: CheckReport[];
  skipped: string[];
}

export function checkRun(runId: string): RunCheckSummary {
  const runDir = join(REPO_ROOT, 'runs', runId);
  const transcriptPath = join(runDir, TRANSCRIPT_FILENAME);
  if (!existsSync(transcriptPath)) {
    throw new Error(`No ${TRANSCRIPT_FILENAME} in runs/${runId}`);
  }

  const set = loadScenarioSet();
  const scenarioById = new Map(set.scenarios.map((s) => [s.scenarioId, s]));

  const reports: CheckReport[] = [];
  const skipped: string[] = [];

  for (const record of readTranscripts(transcriptPath)) {
    const scenario = scenarioById.get(record.scenarioId);
    const persona = scenario ? set.personas.get(scenario.personaId) : undefined;
    if (!scenario || !persona) {
      skipped.push(`${record.conversationId} (scenario not in the benchmark set)`);
      continue;
    }
    reports.push(runChecks({ record, scenario, persona, gold: set.corpus }));
  }

  writeFileSync(
    join(runDir, 'checks.jsonl'),
    reports.map((r) => JSON.stringify(r)).join('\n') + (reports.length > 0 ? '\n' : ''),
  );

  return { runId, reports, skipped };
}

export function latestRunId(): string | undefined {
  const runsDir = join(REPO_ROOT, 'runs');
  if (!existsSync(runsDir)) return undefined;
  return readdirSync(runsDir)
    .filter((d) => existsSync(join(runsDir, d, TRANSCRIPT_FILENAME)))
    .sort()
    .at(-1);
}

function main(): void {
  let runId: string | undefined;
  for (const arg of process.argv.slice(2)) {
    const m = /^--run=(.+)$/.exec(arg);
    if (m) runId = m[1];
  }
  runId ??= latestRunId();
  if (!runId) {
    console.error('No run found. Usage: pnpm checks --run=<runId>');
    process.exitCode = 1;
    return;
  }

  const { reports, skipped } = checkRun(runId);

  console.log(`=== Layer-1 checks: runs/${runId} ===`);
  for (const note of skipped) console.log(`  skipped ${note}`);

  let gated = 0;
  for (const report of reports) {
    const failed = report.results.filter((r) => !r.passed);
    const summary = report.results.map((r) => `${r.id}${r.passed ? '' : ':FAIL'}`).join(' ');
    console.log(`\n${report.conversationId}  ${summary}`);
    for (const f of failed) {
      console.log(`  FAIL ${f.id}${f.cTagged ? ' (C)' : ''}: ${f.reason}`);
      for (const e of f.evidence.slice(0, 3)) console.log(`       - ${e}`);
    }
    if (report.gatesJudging) {
      gated += 1;
      console.log(
        `  HARD-FAIL: ${report.hardFails.join(', ')} -> judge panel skipped, composite 0`,
      );
    }
  }

  const totalChecks = reports.reduce((a, r) => a + r.results.length, 0);
  const totalFails = reports.reduce((a, r) => a + r.results.filter((x) => !x.passed).length, 0);
  console.log(
    `\n${reports.length} conversation(s), ${totalChecks} check evaluations, ${totalFails} fails, ${gated} judge-gated`,
  );
  console.log(`written: runs/${runId}/checks.jsonl`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
