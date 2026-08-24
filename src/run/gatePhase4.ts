/**
 * The Phase 4 gate (`pnpm gate:phase4`), Master Plan §8: "balanced
 * difficulty; every case labeled; low-consensus cases preserved as ties, not
 * forced." Like gate:phase1, it reports its floors honestly - label
 * completeness is UNMET until the labeling work is actually done, and that
 * is the gate doing its job, not a bug.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CALIBRATION_DIR,
  CASES_DIR,
  calibrationCaseSchema,
  calibrationLabelSchema,
  type CalibrationCase,
} from './calibrationCase.js';
import { SLICE_FILE } from './calibrationSlice.js';

export interface Phase4Floor {
  name: string;
  met: boolean;
  detail: string;
}

export interface Phase4Report {
  floors: Phase4Floor[];
  met: boolean;
  counts: {
    cases: number;
    labeled: number;
    tieLabels: number;
    byFamily: Record<string, number>;
    byBand: Record<string, number>;
  };
}

const FAMILIES = [
  'cold_inquiry',
  'deep_factual',
  'budget_mismatch',
  'compliance_trap',
  'site_visit_scheduling',
  'reengagement_24h',
  'hinglish_variant',
] as const;

export function evaluatePhase4Gate(rater = 'self'): Phase4Report {
  const caseFiles = existsSync(CASES_DIR)
    ? readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'))
    : [];
  const cases: CalibrationCase[] = caseFiles.map((f) => {
    const parsed = calibrationCaseSchema.safeParse(
      JSON.parse(readFileSync(join(CASES_DIR, f), 'utf8')),
    );
    if (!parsed.success) throw new Error(`${f} failed case schema: ${parsed.error.message}`);
    return parsed.data;
  });

  const labelsDir = join(CALIBRATION_DIR, 'labels', rater);
  const labelFiles = existsSync(labelsDir)
    ? readdirSync(labelsDir).filter((f) => f.endsWith('.json'))
    : [];
  let tieLabels = 0;
  const labeledIds = new Set<string>();
  for (const f of labelFiles) {
    const parsed = calibrationLabelSchema.safeParse(
      JSON.parse(readFileSync(join(labelsDir, f), 'utf8')),
    );
    if (!parsed.success) throw new Error(`${f} failed label schema: ${parsed.error.message}`);
    labeledIds.add(parsed.data.caseId);
    const binaryTies = Object.values(parsed.data.binary).filter((v) => v === 'tie').length;
    const anchorTies = Object.values(parsed.data.anchors).filter((v) => v === -1).length;
    tieLabels += binaryTies + anchorTies;
  }

  const byFamily: Record<string, number> = {};
  const byBand: Record<string, number> = {};
  for (const c of cases) {
    byFamily[c.family] = (byFamily[c.family] ?? 0) + 1;
    byBand[c.band] = (byBand[c.band] ?? 0) + 1;
  }

  const floors: Phase4Floor[] = [];
  const floor = (name: string, met: boolean, detail: string): void => {
    floors.push({ name, met, detail });
  };

  floor('set size 100-300', cases.length >= 100 && cases.length <= 300, `${cases.length} cases`);
  for (const family of FAMILIES) {
    const n = byFamily[family] ?? 0;
    floor(`family ${family} >= 10`, n >= 10, `${n} cases`);
  }
  floor(
    'all three bands populated',
    (byBand['known_fail'] ?? 0) > 0 &&
      (byBand['borderline'] ?? 0) > 0 &&
      (byBand['known_pass'] ?? 0) > 0,
    JSON.stringify(byBand),
  );
  // Non-author raters are served ONLY the 50-case slice by the labeler
  // (calibrationLabelServer, §4.5/I6), so their completeness floor must use
  // the slice as its denominator - against the full set it would sit
  // permanently UNMET at 50/136 with all assigned work done.
  let expected = cases;
  let scope = 'case';
  if (rater !== 'self' && existsSync(SLICE_FILE)) {
    const allowed = new Set(
      (JSON.parse(readFileSync(SLICE_FILE, 'utf8')) as { ids: string[] }).ids,
    );
    expected = cases.filter((c) => allowed.has(c.caseId));
    scope = 'slice case';
  }
  const unlabeled = expected.filter((c) => !labeledIds.has(c.caseId)).length;
  floor(
    `every ${scope} labeled by "${rater}"`,
    expected.length > 0 && unlabeled === 0,
    `${expected.length - unlabeled}/${expected.length} labeled`,
  );

  return {
    floors,
    met: floors.every((f) => f.met),
    counts: { cases: cases.length, labeled: labeledIds.size, tieLabels, byFamily, byBand },
  };
}

function main(): void {
  const rater = process.argv.find((a) => a.startsWith('--rater='))?.slice(8) ?? 'self';
  const report = evaluatePhase4Gate(rater);
  for (const f of report.floors) {
    console.log(`${f.met ? 'MET  ' : 'UNMET'}  ${f.name}  (${f.detail})`);
  }
  console.log(
    `\nties preserved so far: ${report.counts.tieLabels} (ties are data, not indecision - §4.5)`,
  );
  console.log(`phase 4 gate: ${report.met ? 'MET' : 'UNMET'}`);
  if (!report.met) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
