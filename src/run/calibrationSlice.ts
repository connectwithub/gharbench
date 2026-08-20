/**
 * Select the 50-case rater slice (`pnpm calibration:slice`), Master Plan
 * §4.5 / I6: the two non-author raters label a stratified 50-case subset of
 * the calibration set; Phase 5 reports judge kappa against the 3-rater
 * adjudicated slice (gate G8) alongside kappa vs the full-set self-labels
 * (provisional G8a).
 *
 * Stratification: every known-fail anchor is included (the slice must be
 * able to measure compliance recall), then proportional fill across family x
 * band with a deterministic hash order so the selection is reproducible from
 * the case ids alone - no RNG, no wall clock. Oversampling of compliance
 * traps and Hinglish arrives naturally: those strata are already
 * over-represented in the set (I9), and proportional fill preserves that.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CALIBRATION_DIR, CASES_DIR, type CalibrationCase } from './calibrationCase.js';

export const SLICE_SIZE = 50;
export const SLICE_FILE = join(CALIBRATION_DIR, 'slice-50.json');

function hashOrder(id: string): number {
  let h = 2166136261;
  for (const ch of id) h = ((h ^ ch.charCodeAt(0)) * 16777619) >>> 0;
  return h;
}

export function selectSlice(): { ids: string[]; strata: Record<string, number> } {
  const cases: CalibrationCase[] = readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(CASES_DIR, f), 'utf8')) as CalibrationCase);

  const picked = new Set<string>();
  // Every known-fail case goes in: the compliance-recall measurement (G8's
  // hardest requirement) cannot afford to subsample its rarest class.
  for (const c of cases) if (c.band === 'known_fail') picked.add(c.caseId);

  // Proportional fill over family x band, deterministic order within strata.
  const strata = new Map<string, CalibrationCase[]>();
  for (const c of cases) {
    if (picked.has(c.caseId)) continue;
    const key = `${c.family}|${c.band}`;
    const bucket = strata.get(key) ?? [];
    bucket.push(c);
    strata.set(key, bucket);
  }
  for (const bucket of strata.values()) {
    bucket.sort((x, y) => hashOrder(x.caseId) - hashOrder(y.caseId));
  }
  // Round-robin across strata (largest first) until the slice is full.
  const keys = [...strata.keys()].sort(
    (a, b) => strata.get(b)!.length - strata.get(a)!.length || (a < b ? -1 : 1),
  );
  let added = true;
  while (picked.size < SLICE_SIZE && added) {
    added = false;
    for (const key of keys) {
      if (picked.size >= SLICE_SIZE) break;
      const next = strata.get(key)!.shift();
      if (next) {
        picked.add(next.caseId);
        added = true;
      }
    }
  }

  const byStratum: Record<string, number> = {};
  for (const c of cases) {
    if (!picked.has(c.caseId)) continue;
    byStratum[`${c.family}|${c.band}`] = (byStratum[`${c.family}|${c.band}`] ?? 0) + 1;
  }
  return { ids: [...picked].sort(), strata: byStratum };
}

export function writeSlice(): { ids: string[]; strata: Record<string, number> } {
  const slice = selectSlice();
  writeFileSync(
    SLICE_FILE,
    JSON.stringify({ size: slice.ids.length, ids: slice.ids, strata: slice.strata }, null, 2) +
      '\n',
  );
  return slice;
}

function main(): void {
  const slice = writeSlice();
  console.log(`rater slice: ${slice.ids.length} cases -> calibration/slice-50.json`);
  for (const [k, v] of Object.entries(slice.strata).sort()) console.log(`  ${k}: ${v}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
