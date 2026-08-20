/**
 * Build calibration cases from real sweep output and report the strata
 * (`pnpm calibration:build --run=<runId> [--run=...]`).
 *
 * §4.5(3): real conversations enter the calibration set stratified by a
 * PRELIMINARY band from the deterministic Layer-1 results - hard-fail gated
 * conversations are the known-fail stratum, clean transcripts lean pass,
 * everything else is borderline. The band is a stratification label for
 * sampling and reporting, not ground truth; the human labels are.
 *
 * Every non-error conversation converts (the target set size 100-300 admits
 * the whole 120-conversation calibration sweep plus the synthetic anchors),
 * and the §8 Phase 4 gate arithmetic - floors per family, band spread,
 * label completeness, ties preserved - is checked by `pnpm gate:phase4`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CheckReport } from '../checks/types.js';
import { TRANSCRIPT_FILENAME, readTranscripts } from '../logging/transcript.js';
import {
  CALIBRATION_DIR,
  CASES_DIR,
  calibrationCaseSchema,
  type CalibrationCase,
} from './calibrationCase.js';
import { REPO_ROOT, loadScenarioSet } from './scenarioSet.js';

/** Preliminary §4.5 band from the deterministic check results. */
export function preliminaryBand(report: CheckReport | undefined): CalibrationCase['band'] {
  if (!report) return 'borderline';
  if (report.gatesJudging) return 'known_fail';
  const fails = report.results.filter((r) => !r.passed).length;
  return fails === 0 ? 'known_pass' : 'borderline';
}

export interface BuildSummary {
  written: number;
  skipped: string[];
  byBand: Record<string, number>;
  byFamily: Record<string, number>;
}

export function buildCasesFromRun(runId: string): BuildSummary {
  const runDir = join(REPO_ROOT, 'runs', runId);
  const transcriptPath = join(runDir, TRANSCRIPT_FILENAME);
  if (!existsSync(transcriptPath)) throw new Error(`No ${TRANSCRIPT_FILENAME} in runs/${runId}`);

  const checksPath = join(runDir, 'checks.jsonl');
  const checksByConversation = new Map<string, CheckReport>();
  if (existsSync(checksPath)) {
    for (const line of readFileSync(checksPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const report = JSON.parse(line) as CheckReport;
      checksByConversation.set(report.conversationId, report);
    }
  }

  const manifest = JSON.parse(readFileSync(join(runDir, 'sweep-manifest.json'), 'utf8')) as {
    contestants: Array<{ requestedRef: string }>;
  };

  const set = loadScenarioSet();
  const scenarioById = new Map(set.scenarios.map((s) => [s.scenarioId, s]));

  mkdirSync(CASES_DIR, { recursive: true });
  const summary: BuildSummary = { written: 0, skipped: [], byBand: {}, byFamily: {} };

  for (const record of readTranscripts(transcriptPath)) {
    if (record.terminationReason.kind === 'error') {
      summary.skipped.push(`${record.conversationId} (error termination)`);
      continue;
    }
    const scenario = scenarioById.get(record.scenarioId);
    if (!scenario) {
      summary.skipped.push(`${record.conversationId} (scenario not in set)`);
      continue;
    }

    const messages = record.messages
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({
        role: (m.role === 'system' ? 'system' : m.role) as 'buyer' | 'agent' | 'system',
        text: m.content.trim(),
      }))
      .filter((m) => m.role === 'buyer' || m.role === 'agent' || m.role === 'system');

    const contestantRef =
      manifest.contestants.length === 1
        ? manifest.contestants[0]!.requestedRef
        : record.contestantId;

    // Conversation ids are scenario#trial - IDENTICAL across contestants in
    // a multi-contestant sweep - and carry uppercase persona codes and a
    // #trial suffix (scn_visit_004.P06#0). The case id therefore includes a
    // contestant slug and is sanitised; provenance keeps the originals.
    const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9_.-]/g, '-');
    const contestantSlug = slug(record.contestantId.split('/').pop() ?? record.contestantId);
    const calCase: CalibrationCase = {
      caseId: `cal_real_${contestantSlug}_${slug(record.conversationId)}`,
      source: 'real',
      band: preliminaryBand(checksByConversation.get(record.conversationId)),
      family: scenario.family,
      language: scenario.language,
      provenance: {
        runId,
        conversationId: record.conversationId,
        scenarioId: record.scenarioId,
        contestantRef,
      },
      judgeApplicability: scenario.judgeApplicability,
      messages,
    };

    const parsed = calibrationCaseSchema.safeParse(calCase);
    if (!parsed.success) {
      summary.skipped.push(`${record.conversationId} (schema: ${parsed.error.message.slice(0, 80)})`);
      continue;
    }
    writeFileSync(join(CASES_DIR, `${calCase.caseId}.json`), JSON.stringify(calCase, null, 2) + '\n');
    summary.written += 1;
    summary.byBand[calCase.band] = (summary.byBand[calCase.band] ?? 0) + 1;
    summary.byFamily[calCase.family] = (summary.byFamily[calCase.family] ?? 0) + 1;
  }

  return summary;
}

/** Recompute the manifest over everything currently in calibration/cases. */
export function writeCalibrationManifest(): Record<string, unknown> {
  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'));
  const strata: Record<string, number> = {};
  const byKey = (k: string): void => {
    strata[k] = (strata[k] ?? 0) + 1;
  };
  for (const f of files) {
    const c = JSON.parse(readFileSync(join(CASES_DIR, f), 'utf8')) as CalibrationCase;
    byKey(`source:${c.source}`);
    byKey(`band:${c.band}`);
    byKey(`family:${c.family}`);
    byKey(`language:${c.language}`);
    if (c.provenance) byKey(`contestant:${c.provenance.contestantRef}`);
  }
  const manifest = { totalCases: files.length, strata, updatedAt: new Date().toISOString() };
  writeFileSync(
    join(CALIBRATION_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
  return manifest;
}

function main(): void {
  const runIds = process.argv.filter((a) => a.startsWith('--run=')).map((a) => a.slice(6));
  if (runIds.length === 0) throw new Error('Pass at least one --run=<runId>.');

  for (const runId of runIds) {
    const s = buildCasesFromRun(runId);
    console.log(
      `${runId}: ${s.written} case(s) written, ${s.skipped.length} skipped` +
        ` | bands ${JSON.stringify(s.byBand)}`,
    );
    for (const skip of s.skipped) console.log(`  skipped ${skip}`);
  }
  const manifest = writeCalibrationManifest();
  console.log(`calibration manifest: ${JSON.stringify(manifest['totalCases'])} total cases`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
