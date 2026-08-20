/**
 * The Phase 5 gate (`pnpm gate:phase5`), Master Plan §8 Phase 5:
 *   (a) G8 - kappa >= 0.6 on EVERY dimension against the 3-rater 50-case
 *       slice (>= 0.7 aspiration on compliance, reported not gated), with
 *       G8a (vs full-set self-labels) reported alongside as provisional;
 *   (b) inter-judge alpha >= 0.5 on the subjective anchors;
 *   (c) compliance recall >= 0.9 on seeded known-fails.
 *
 * Like gate:phase1/phase4 it reports floors honestly: with no labels or no
 * judgments yet, everything is UNMET with the reason - that is the gate doing
 * its job. It reads calibration/agreement.json (run `pnpm judge:agreement`
 * first) plus the filesystem for the completeness prerequisites.
 */

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { JUDGE_PANEL } from '../judge/panel.js';
import { AGREEMENT_FILE, loadJudgments, type AgreementReport } from './judgeAgreement.js';
import { DIMENSIONS, JUDGMENTS_DIR, judgmentPath, loadCalibrationCases } from './judgeRun.js';
import { CASES_DIR } from './calibrationCase.js';

export interface Phase5Floor {
  name: string;
  met: boolean;
  detail: string;
}

export interface Phase5Report {
  floors: Phase5Floor[];
  info: string[];
  met: boolean;
}

const KAPPA_FLOOR = 0.6;
const COMPLIANCE_KAPPA_ASPIRATION = 0.7;
const ANCHOR_ALPHA_FLOOR = 0.5;
const SEEDED_RECALL_FLOOR = 0.9;

export function evaluatePhase5Gate(): Phase5Report {
  const floors: Phase5Floor[] = [];
  const info: string[] = [];
  const floor = (name: string, met: boolean, detail: string): void => {
    floors.push({ name, met, detail });
  };

  // Prerequisite: every case x dimension x panel judge has a parsed verdict.
  const cases = existsSync(CASES_DIR) ? loadCalibrationCases() : [];
  const expected = cases.length * DIMENSIONS.length * JUDGE_PANEL.length;
  let present = 0;
  for (const judge of JUDGE_PANEL) {
    for (const c of cases) {
      for (const dimension of DIMENSIONS) {
        if (existsSync(judgmentPath(JUDGMENTS_DIR, judge.ref, c.caseId, dimension))) present += 1;
      }
    }
  }
  const errored = loadJudgments(JUDGMENTS_DIR).filter((j) => j.outcome.kind === 'error').length;
  floor(
    'panel judgments complete (case x dimension x 3 judges)',
    expected > 0 && present === expected && errored === 0,
    `${present}/${expected} present, ${errored} structured errors`,
  );

  if (!existsSync(AGREEMENT_FILE)) {
    floor('G8 kappa >= 0.6 every dimension (vs 3-rater slice)', false, 'no agreement.json - run pnpm judge:agreement');
    floor('inter-judge alpha >= 0.5 on anchors', false, 'no agreement.json');
    floor('compliance recall >= 0.9 on seeded known-fails', false, 'no agreement.json');
    return { floors, info, met: false };
  }

  const report = JSON.parse(readFileSync(AGREEMENT_FILE, 'utf8')) as AgreementReport;

  for (const dimension of DIMENSIONS) {
    const d = report.perDimension[dimension];
    const kappa = d?.g8?.kappa ?? null;
    floor(
      `G8 ${dimension} kappa >= ${KAPPA_FLOOR} (vs 3-rater slice)`,
      kappa !== null && kappa >= KAPPA_FLOOR,
      kappa === null
        ? `not computed (slice raters: ${report.counts.sliceRaters.join(', ') || 'none'})`
        : `kappa=${kappa.toFixed(3)} over ${d?.g8?.units ?? 0} units`,
    );
    const g8a = d?.g8a?.kappa ?? null;
    info.push(
      `G8a (provisional, vs self) ${dimension}: ` +
        (g8a === null ? 'not computed' : `kappa=${g8a.toFixed(3)} over ${d?.g8a?.units ?? 0} units`),
    );
  }
  for (const a of report.anchorsG8) {
    floor(
      `G8 anchor ${a.anchorId} weighted-kappa >= ${KAPPA_FLOOR} (vs 3-rater slice)`,
      a.weightedKappa !== null && a.weightedKappa >= KAPPA_FLOOR,
      a.weightedKappa === null ? 'not computed' : `wk=${a.weightedKappa.toFixed(3)} over ${a.units} units`,
    );
  }
  if (report.anchorsG8.length === 0) {
    floor('G8 anchors weighted-kappa >= 0.6 (vs 3-rater slice)', false, 'no adjudicated slice anchors yet');
  }

  const complianceKappa = report.perDimension['compliance']?.g8?.kappa ?? null;
  info.push(
    `compliance kappa aspiration >= ${COMPLIANCE_KAPPA_ASPIRATION}: ` +
      (complianceKappa === null
        ? 'not computed'
        : `${complianceKappa >= COMPLIANCE_KAPPA_ASPIRATION ? 'met' : 'not met'} (${complianceKappa.toFixed(3)})`),
  );

  const alpha = report.interJudgeAlphaAnchors;
  floor(
    `inter-judge alpha >= ${ANCHOR_ALPHA_FLOOR} on subjective anchors`,
    alpha !== null && alpha >= ANCHOR_ALPHA_FLOOR,
    alpha === null ? 'not computed' : `alpha=${alpha.toFixed(3)}`,
  );
  if (alpha !== null && alpha > 0.95) {
    info.push('inter-judge alpha very high: the panel may add little independent signal (§4.5)');
  }

  const recall = report.compliancePrf.recallSeededKnownFails;
  floor(
    `compliance recall >= ${SEEDED_RECALL_FLOOR} on seeded known-fails`,
    recall !== null && recall >= SEEDED_RECALL_FLOOR,
    recall === null
      ? 'not computed (no seeded compliance units judged yet)'
      : `recall=${recall.toFixed(3)} over ${report.compliancePrf.seededFailUnits} seeded units`,
  );

  for (const [slug, r] of Object.entries(report.retest)) {
    info.push(`test-retest ${slug}: ${r.agreementPct.toFixed(1)}% over ${r.units} paired verdicts`);
  }

  return { floors, info, met: floors.every((f) => f.met) };
}

function main(): void {
  const report = evaluatePhase5Gate();
  for (const f of report.floors) console.log(`${f.met ? 'MET  ' : 'UNMET'}  ${f.name}  (${f.detail})`);
  if (report.info.length > 0) console.log('');
  for (const line of report.info) console.log(`info: ${line}`);
  console.log(`\nphase 5 gate: ${report.met ? 'MET' : 'UNMET'}`);
  if (!report.met) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
