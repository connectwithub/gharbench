/**
 * The Phase 7 human-validation sample (`pnpm sample:human --run=<runId>
 * [--run=...]`), Master Plan §8 Phase 7 / I9 / G11.
 *
 * Selects the ~200-conversation stratified sample from main-run output:
 * floors first (>=30 conversations from EACH n=5 family - compliance traps
 * and Hinglish - regardless of percentage, I9), then proportional
 * round-robin fill across the remaining families. Deterministic by
 * construction (hash order, no RNG), so the same runs always yield the same
 * sample.
 *
 * Blinding: the sampled case files carry NO contestant identity and no
 * provenance - raters must not know which model produced a transcript. The
 * caseId -> conversation mapping lives in human-validation/mapping.json,
 * which stays out of the raters' hands (the whole directory is gitignored;
 * the labeling server never serves it).
 *
 * Raters label with the existing tool:
 *   pnpm calibration:label --rater=<name> --dir=human-validation
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { TRANSCRIPT_FILENAME, readTranscripts } from '../logging/transcript.js';
import { calibrationCaseSchema, type CalibrationCase } from './calibrationCase.js';
import { preliminaryBand, projectMessages } from './calibrationBuild.js';
import { terminationSource } from './g6AuditServer.js';
import { readCheckReports } from './checkReports.js';
import { REPO_ROOT, loadScenarioSet } from './scenarioSet.js';
import { N5_FAMILIES } from './sweep.js';

export const HUMAN_VALIDATION_DIR = join(REPO_ROOT, 'human-validation');
export const HV_CASES_DIR = join(HUMAN_VALIDATION_DIR, 'cases');
export const HV_MAPPING_FILE = join(HUMAN_VALIDATION_DIR, 'mapping.json');

export const DEFAULT_SAMPLE_SIZE = 200;
/** I9: absolute floor per n=5 family, regardless of percentage. */
export const N5_FAMILY_FLOOR = 30;

function hashOrder(id: string): number {
  let h = 2166136261;
  for (const ch of id) h = ((h ^ ch.charCodeAt(0)) * 16777619) >>> 0;
  return h;
}

export interface SampleCandidate {
  runId: string;
  conversationId: string;
  contestantId: string;
  scenarioId: string;
  family: string;
  language: string;
  band: CalibrationCase['band'];
  endedBy: CalibrationCase['endedBy'];
  judgeApplicability: CalibrationCase['judgeApplicability'];
  messages: CalibrationCase['messages'];
}

/**
 * I9-floored stratified selection: fill each n=5 family to its floor first,
 * then round-robin the remaining slots across every family, largest
 * remaining stratum first, hash-ordered within a stratum.
 */
export function selectSample(
  candidates: readonly SampleCandidate[],
  size: number,
): SampleCandidate[] {
  const key = (c: SampleCandidate): string => `${c.runId}|${c.contestantId}|${c.conversationId}`;
  const byFamily = new Map<string, SampleCandidate[]>();
  for (const c of candidates) {
    const bucket = byFamily.get(c.family) ?? [];
    bucket.push(c);
    byFamily.set(c.family, bucket);
  }
  for (const bucket of byFamily.values()) {
    bucket.sort((a, b) => hashOrder(key(a)) - hashOrder(key(b)) || (key(a) < key(b) ? -1 : 1));
  }

  const picked: SampleCandidate[] = [];
  const taken = new Map<string, number>();
  const take = (family: string): boolean => {
    const bucket = byFamily.get(family);
    const next = bucket?.shift();
    if (!next) return false;
    picked.push(next);
    taken.set(family, (taken.get(family) ?? 0) + 1);
    return true;
  };

  // Floors first: the two n=5 families each get their 30 before anything else.
  for (const family of [...N5_FAMILIES].sort()) {
    while ((taken.get(family) ?? 0) < N5_FAMILY_FLOOR && picked.length < size && take(family));
  }
  // Proportional fill: round-robin, largest remaining stratum first.
  const order = [...byFamily.keys()].sort(
    (a, b) => (byFamily.get(b)?.length ?? 0) - (byFamily.get(a)?.length ?? 0) || (a < b ? -1 : 1),
  );
  let added = true;
  while (picked.length < size && added) {
    added = false;
    for (const family of order) {
      if (picked.length >= size) break;
      if (take(family)) added = true;
    }
  }
  return picked;
}

export function collectCandidates(runIds: readonly string[]): SampleCandidate[] {
  const set = loadScenarioSet({ includePrivate: true });
  const scenarioById = new Map(set.scenarios.map((s) => [s.scenarioId, s]));
  const out: SampleCandidate[] = [];
  for (const runId of runIds) {
    const runDir = join(REPO_ROOT, 'runs', runId);
    const transcriptPath = join(runDir, TRANSCRIPT_FILENAME);
    if (!existsSync(transcriptPath)) throw new Error(`No ${TRANSCRIPT_FILENAME} in runs/${runId}`);
    const checks = readCheckReports(runDir);
    for (const record of readTranscripts(transcriptPath)) {
      const endedBy = terminationSource(record.terminationReason);
      if (endedBy === 'error') continue;
      const scenario = scenarioById.get(record.scenarioId);
      if (!scenario) continue;
      out.push({
        runId,
        conversationId: record.conversationId,
        contestantId: record.contestantId,
        scenarioId: record.scenarioId,
        family: scenario.family,
        language: scenario.language,
        band: preliminaryBand(checks.get(record.contestantId, record.conversationId)),
        endedBy,
        judgeApplicability: scenario.judgeApplicability,
        messages: projectMessages(record),
      });
    }
  }
  return out;
}

export function writeSample(
  sample: readonly SampleCandidate[],
  baseDir: string = HUMAN_VALIDATION_DIR,
): { written: number; byFamily: Record<string, number> } {
  const casesDir = join(baseDir, 'cases');
  mkdirSync(casesDir, { recursive: true });
  const mapping: Record<string, unknown> = {};
  const byFamily: Record<string, number> = {};
  sample.forEach((c, i) => {
    // Blind id: sequence number only. The mapping file is the only bridge
    // back to run/contestant, and it is never served to a rater.
    const caseId = `cal_hv_${String(i + 1).padStart(4, '0')}`;
    const hvCase: CalibrationCase = {
      caseId,
      source: 'real',
      band: c.band,
      family: c.family as CalibrationCase['family'],
      language: c.language as CalibrationCase['language'],
      endedBy: c.endedBy,
      judgeApplicability: c.judgeApplicability,
      messages: c.messages,
    };
    const parsed = calibrationCaseSchema.safeParse(hvCase);
    if (!parsed.success) throw new Error(`${caseId} failed case schema: ${parsed.error.message}`);
    writeFileSync(join(casesDir, `${caseId}.json`), JSON.stringify(hvCase, null, 2) + '\n');
    mapping[caseId] = {
      runId: c.runId,
      conversationId: c.conversationId,
      contestantId: c.contestantId,
      scenarioId: c.scenarioId,
    };
    byFamily[c.family] = (byFamily[c.family] ?? 0) + 1;
  });
  writeFileSync(join(baseDir, 'mapping.json'), JSON.stringify(mapping, null, 2) + '\n');
  return { written: sample.length, byFamily };
}

function main(): void {
  const runIds = process.argv.filter((a) => a.startsWith('--run=')).map((a) => a.slice(6));
  const sizeArg = process.argv.find((a) => a.startsWith('--size='))?.slice(7);
  const size = sizeArg ? Number.parseInt(sizeArg, 10) : DEFAULT_SAMPLE_SIZE;
  if (runIds.length === 0) throw new Error('Pass at least one --run=<runId>.');

  const candidates = collectCandidates(runIds);
  const sample = selectSample(candidates, size);
  const { written, byFamily } = writeSample(sample);

  console.log(
    `human-validation sample: ${written} conversation(s) from ${candidates.length} candidates`,
  );
  for (const [family, n] of Object.entries(byFamily).sort()) {
    const isN5 = N5_FAMILIES.has(family);
    console.log(
      `  ${family.padEnd(22)} ${String(n).padStart(3)}` +
        (isN5 ? ` (floor ${N5_FAMILY_FLOOR}: ${n >= N5_FAMILY_FLOOR ? 'MET' : 'UNMET'})` : ''),
    );
  }
  console.log(
    `\nraters label with: pnpm calibration:label --rater=<name> --dir=human-validation` +
      `\ncases: ${HV_CASES_DIR}\nmapping (never show a rater): ${HV_MAPPING_FILE}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
