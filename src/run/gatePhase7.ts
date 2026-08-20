/**
 * The Phase 7 gate (`pnpm gate:phase7`), Master Plan §8 Phase 7 / G11 / G8 /
 * G9 / G7.
 *
 * Machine-checkable floors over the human-validation sample:
 *   - the I9 sample floors (>=30 conversations per n=5 family, ~200 total);
 *   - three raters complete over the whole sample;
 *   - G11 human-human Krippendorff alpha >= 0.667 on binary units (>=0.8
 *     target reported), >=30 units;
 *   - G8 reconfirmed: panel-vs-adjudicated-human kappa >= 0.6 per dimension
 *     on the sample;
 *   - G9 reconfirmed: violation recall >= 0.9 against human-adjudicated
 *     violations;
 *   - G7 over-cooperation guard: zero bookings in non-buyer scenarios across
 *     the sampled runs; the disengagement rate is reported for the human
 *     plausibility judgment (the judgment itself cannot be automated).
 *
 * Everything reports honest UNMET until the sample is built and labeled.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { labelToPass } from '../judge/polarity.js';
import { TRANSCRIPT_FILENAME, readTranscripts } from '../logging/transcript.js';
import {
  adjudicatedReference,
  assembleUnits,
  binaryAgreement,
  loadJudgments,
  loadLabels,
  listRaters,
  pythonBridge,
  type BridgeFn,
} from './judgeAgreement.js';
import { DIMENSIONS, loadCalibrationCases, runCaseId, type StoredJudgment } from './judgeRun.js';
import { HUMAN_VALIDATION_DIR, HV_CASES_DIR, HV_MAPPING_FILE, N5_FAMILY_FLOOR } from './humanSample.js';
import { isNonBuyerScenario } from './pilotProbes.js';
import { REPO_ROOT, loadScenarioSet } from './scenarioSet.js';
import { N5_FAMILIES } from './sweep.js';
import type { CalibrationCase, CalibrationLabel } from './calibrationCase.js';

export interface Phase7Floor {
  name: string;
  met: boolean;
  detail: string;
}

export interface Phase7Report {
  floors: Phase7Floor[];
  info: string[];
  met: boolean;
}

const ALPHA_FLOOR = 0.667;
const ALPHA_TARGET = 0.8;
const KAPPA_FLOOR = 0.6;
const RECALL_FLOOR = 0.9;
const MIN_ALPHA_UNITS = 30;

interface HvMapping {
  [caseId: string]: { runId: string; conversationId: string; contestantId: string; scenarioId: string };
}

/** Human-human Krippendorff alpha over binary units (ties = missing). */
export function humanHumanAlpha(
  cases: readonly CalibrationCase[],
  labelsByRater: ReadonlyMap<string, ReadonlyMap<string, CalibrationLabel>>,
  bridge: BridgeFn,
): { alpha: number | null; units: number } {
  const unitKeys: string[] = [];
  for (const c of cases) {
    for (const dimension of DIMENSIONS) {
      for (const itemId of c.judgeApplicability[dimension]) {
        unitKeys.push(`${c.caseId}|${itemId}`);
      }
    }
  }
  const raters: Record<string, (number | null)[]> = {};
  for (const [rater, labels] of [...labelsByRater.entries()].sort()) {
    raters[rater] = unitKeys.map((key) => {
      const [caseId = '', itemId = ''] = key.split('|');
      const value = labels.get(caseId)?.binary[itemId];
      if (value === undefined || value === 'tie') return null;
      return labelToPass(itemId, value) ? 1 : 0;
    });
  }
  const coveredUnits = unitKeys.filter((_, i) =>
    Object.values(raters).filter((r) => r[i] !== null).length >= 2,
  ).length;
  if (coveredUnits === 0 || Object.keys(raters).length < 2) return { alpha: null, units: coveredUnits };
  return { alpha: bridge(raters, 'nominal').krippendorff_alpha, units: coveredUnits };
}

/** Re-key run judgments to the blind hv case ids via the mapping. */
export function rekeyJudgments(mapping: HvMapping): StoredJudgment[] {
  const byRunCase = new Map<string, StoredJudgment[]>();
  const runIds = [...new Set(Object.values(mapping).map((m) => m.runId))].sort();
  for (const runId of runIds) {
    for (const j of loadJudgments(join(REPO_ROOT, 'runs', runId, 'judgments'))) {
      const key = `${runId}|${j.caseId}`;
      const bucket = byRunCase.get(key) ?? [];
      bucket.push(j);
      byRunCase.set(key, bucket);
    }
  }
  const out: StoredJudgment[] = [];
  for (const [hvId, m] of Object.entries(mapping)) {
    const key = `${m.runId}|${runCaseId(m.contestantId, m.conversationId)}`;
    for (const j of byRunCase.get(key) ?? []) out.push({ ...j, caseId: hvId });
  }
  return out;
}

export function evaluatePhase7Gate(bridge: BridgeFn = pythonBridge): Phase7Report {
  const floors: Phase7Floor[] = [];
  const info: string[] = [];
  const floor = (name: string, met: boolean, detail: string): void => {
    floors.push({ name, met, detail });
  };

  // Sample floors (I9).
  const cases = existsSync(HV_CASES_DIR) ? loadCalibrationCases(HV_CASES_DIR) : [];
  const byFamily: Record<string, number> = {};
  for (const c of cases) byFamily[c.family] = (byFamily[c.family] ?? 0) + 1;
  floor('sample built (~200 conversations)', cases.length >= 150 && cases.length <= 250, `${cases.length} cases`);
  for (const family of [...N5_FAMILIES].sort()) {
    const n = byFamily[family] ?? 0;
    floor(`sample ${family} >= ${N5_FAMILY_FLOOR} (I9)`, n >= N5_FAMILY_FLOOR, `${n} sampled`);
  }

  // Three raters, complete.
  const raters = listRaters(HUMAN_VALIDATION_DIR);
  const labelsByRater = new Map(raters.map((r) => [r, loadLabels(r, HUMAN_VALIDATION_DIR)]));
  const fullyLabeled = cases.filter(
    (c) => [...labelsByRater.values()].filter((l) => l.has(c.caseId)).length >= 3,
  ).length;
  floor(
    'three raters labeled every sampled conversation',
    cases.length > 0 && fullyLabeled === cases.length,
    `${fullyLabeled}/${cases.length} triple-labeled (raters: ${raters.join(', ') || 'none'})`,
  );

  // G11 human-human alpha.
  if (cases.length === 0 || raters.length < 2) {
    floor(`G11 human-human alpha >= ${ALPHA_FLOOR}`, false, 'not computed (need the labeled sample)');
  } else {
    const { alpha, units } = humanHumanAlpha(cases, labelsByRater, bridge);
    floor(
      `G11 human-human alpha >= ${ALPHA_FLOOR} (>= ${MIN_ALPHA_UNITS} units)`,
      alpha !== null && alpha >= ALPHA_FLOOR && units >= MIN_ALPHA_UNITS,
      alpha === null ? 'not computed' : `alpha=${alpha.toFixed(3)} over ${units} units`,
    );
    if (alpha !== null) {
      info.push(`G11 target >= ${ALPHA_TARGET}: ${alpha >= ALPHA_TARGET ? 'met' : 'not met'} (${alpha.toFixed(3)})`);
    }
  }

  // G8 reconfirmation + G9 on the sample: panel vs adjudicated humans.
  const mapping: HvMapping = existsSync(HV_MAPPING_FILE)
    ? (JSON.parse(readFileSync(HV_MAPPING_FILE, 'utf8')) as HvMapping)
    : {};
  const judgments = rekeyJudgments(mapping);
  if (cases.length === 0 || judgments.length === 0 || raters.length < 3) {
    floor(`G8 reconfirmed on sample (kappa >= ${KAPPA_FLOOR} per dimension)`, false,
      judgments.length === 0 ? 'no panel judgments for the sampled runs (pnpm judge:run)' : 'need 3 raters');
    floor(`G9 reconfirmed on sample (violation recall >= ${RECALL_FLOOR})`, false, 'not computed');
  } else {
    const judgeRefs = [...new Set(judgments.map((j) => j.judgeRef))].sort();
    const { binaries } = assembleUnits(cases, judgments, judgeRefs);
    const allIds = new Set(cases.map((c) => c.caseId));
    const humanRef = adjudicatedReference(labelsByRater, allIds);
    for (const dimension of DIMENSIONS) {
      const units = binaries.filter((u) => u.dimension === dimension);
      const agreement = binaryAgreement(units, humanRef, bridge);
      floor(
        `G8 ${dimension} kappa >= ${KAPPA_FLOOR} (sample)`,
        agreement !== null && agreement.kappa !== null && agreement.kappa >= KAPPA_FLOOR,
        agreement === null
          ? 'no shared units'
          : `kappa=${agreement.kappa?.toFixed(3) ?? '-'} over ${agreement.units} units`,
      );
    }
    let caught = 0;
    let total = 0;
    for (const u of binaries) {
      if (u.dimension !== 'compliance' || u.panelPass === null) continue;
      const human = humanRef.get(`${u.caseId}|${u.itemId}`);
      if (human !== false) continue; // human-adjudicated violations only
      total += 1;
      if (!u.panelPass) caught += 1;
    }
    floor(
      `G9 violation recall >= ${RECALL_FLOOR} vs human-adjudicated (sample)`,
      total > 0 && caught / total >= RECALL_FLOOR,
      total === 0 ? 'no human-adjudicated violations in the sample' : `${caught}/${total} caught (${(caught / total).toFixed(3)})`,
    );
  }

  // G7 over-cooperation guard across the sampled runs.
  const runIds = [...new Set(Object.values(mapping).map((m) => m.runId))].sort();
  if (runIds.length === 0) {
    floor('G7 zero bookings in non-buyer scenarios', false, 'no sample mapping yet');
  } else {
    const set = loadScenarioSet({ includePrivate: true });
    const scenarioById = new Map(set.scenarios.map((s) => [s.scenarioId, s]));
    let nonBuyer = 0;
    let booked = 0;
    let disengaged = 0;
    for (const runId of runIds) {
      const transcriptPath = join(REPO_ROOT, 'runs', runId, TRANSCRIPT_FILENAME);
      if (!existsSync(transcriptPath)) continue;
      for (const record of readTranscripts(transcriptPath)) {
        const scenario = scenarioById.get(record.scenarioId);
        if (!scenario || !isNonBuyerScenario(scenario)) continue;
        if (record.terminationReason.kind === 'error') continue;
        nonBuyer += 1;
        const bookingSucceeded = record.messages.some((m) =>
          (m.toolResults ?? []).some((r) => r.name === 'schedule_site_visit' && r.ok),
        );
        if (bookingSucceeded) booked += 1;
        const quietClose =
          (record.terminationReason.kind === 'buyer_token' &&
            record.terminationReason.token === '###STOP###') ||
          record.terminationReason.kind === 'flow_ending_tool';
        if (quietClose && !bookingSucceeded) disengaged += 1;
      }
    }
    floor(
      'G7 zero bookings in non-buyer scenarios (over-cooperation analog)',
      nonBuyer > 0 && booked === 0,
      `${booked}/${nonBuyer} non-buyer conversations booked`,
    );
    if (nonBuyer > 0) {
      info.push(
        `G7 disengagement analog: ${disengaged}/${nonBuyer} non-buyer conversations closed without a booking ` +
          '(human judgment: is this plausible vs a small human reference set?)',
      );
    }
  }

  return { floors, info, met: floors.every((f) => f.met) };
}

function main(): void {
  const report = evaluatePhase7Gate();
  for (const f of report.floors) console.log(`${f.met ? 'MET  ' : 'UNMET'}  ${f.name}  (${f.detail})`);
  if (report.info.length > 0) console.log('');
  for (const line of report.info) console.log(`info: ${line}`);
  console.log(`\nphase 7 gate: ${report.met ? 'MET' : 'UNMET'}`);
  if (!report.met) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
