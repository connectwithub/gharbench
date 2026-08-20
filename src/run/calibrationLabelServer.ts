/**
 * The calibration labeling tool (`pnpm calibration:label [--rater=name]`).
 *
 * Serves the case transcripts with the judge rubric as the question set and
 * writes one label file per case to calibration/labels/<rater>/. Labels are
 * saved per case (not one big submit), so a 148-case labeling effort can
 * span sessions.
 *
 * Blindness: the API redacts `band`, `source`, `provenance` and the expected
 * sidecars - the rater sees a transcript and questions, never where the case
 * came from or what it was seeded to violate. Case order is shuffled
 * deterministically from the rater name so synthetic anchors interleave with
 * real output invisibly.
 */

import { createServer } from 'node:http';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  CALIBRATION_DIR,
  CASES_DIR,
  calibrationLabelSchema,
  type CalibrationCase,
} from './calibrationCase.js';
import { SLICE_FILE } from './calibrationSlice.js';
import { loadJudgeItems } from './judgeItems.js';
import { REPO_ROOT } from './scenarioSet.js';

const PORT = 4174;

/**
 * Deterministic shuffle keyed on the rater, so resume order is stable.
 * In calibration mode, non-author raters (anyone but "self") label only the
 * 50-case slice (§4.5 / I6) - run `pnpm calibration:slice` first. In any
 * other store (--dir, e.g. the Phase 7 human-validation sample) every rater
 * sees the full case set: the Phase 7 protocol is three raters over the
 * whole sample.
 */
function shuffledCaseIds(rater: string, casesDir: string): string[] {
  let ids = readdirSync(casesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
  if (rater !== 'self' && casesDir === CASES_DIR) {
    if (!existsSync(SLICE_FILE)) {
      throw new Error(`Rater "${rater}" labels the 50-case slice; run pnpm calibration:slice first.`);
    }
    const slice = JSON.parse(readFileSync(SLICE_FILE, 'utf8')) as { ids: string[] };
    const allowed = new Set(slice.ids);
    ids = ids.filter((id) => allowed.has(id));
  }
  let h = 2166136261;
  for (const ch of rater) h = (h ^ ch.charCodeAt(0)) * 16777619;
  const keyed = ids.map((id) => {
    let k = h >>> 0;
    for (const ch of id) k = ((k ^ ch.charCodeAt(0)) * 16777619) >>> 0;
    return { id, k };
  });
  keyed.sort((x, y) => x.k - y.k || (x.id < y.id ? -1 : 1));
  return keyed.map((x) => x.id);
}

function redactCase(raw: CalibrationCase): Record<string, unknown> {
  return {
    caseId: raw.caseId,
    language: raw.language,
    judgeApplicability: raw.judgeApplicability,
    messages: raw.messages,
  };
}

export function startServer(rater: string, baseDir: string = CALIBRATION_DIR): void {
  const casesDir = baseDir === CALIBRATION_DIR ? CASES_DIR : join(baseDir, 'cases');
  const labelsDir = join(baseDir, 'labels', rater);
  mkdirSync(labelsDir, { recursive: true });
  const rubric = loadJudgeItems();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && url.pathname === '/api/cases') {
      const order = shuffledCaseIds(rater, casesDir);
      const labeled = new Set(
        readdirSync(labelsDir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.replace(/\.json$/, '')),
      );
      json(200, { rater, order, labeled: [...labeled] });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/case/')) {
      const caseId = url.pathname.slice('/api/case/'.length);
      const path = join(casesDir, `${caseId}.json`);
      if (!existsSync(path) || !/^cal_[a-z0-9_.-]+$/.test(caseId)) {
        json(404, { error: 'no such case' });
        return;
      }
      const raw = JSON.parse(readFileSync(path, 'utf8')) as CalibrationCase;
      const labelPath = join(labelsDir, `${caseId}.json`);
      const existing = existsSync(labelPath)
        ? (JSON.parse(readFileSync(labelPath, 'utf8')) as unknown)
        : null;
      json(200, { case: redactCase(raw), existingLabel: existing });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/rubric') {
      json(200, rubric);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/label') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const parsed = calibrationLabelSchema.safeParse(JSON.parse(body));
          if (!parsed.success) {
            json(400, { error: parsed.error.message });
            return;
          }
          if (parsed.data.rater !== rater) {
            json(400, { error: `label rater ${parsed.data.rater} != server rater ${rater}` });
            return;
          }
          writeFileSync(
            join(labelsDir, `${parsed.data.caseId}.json`),
            JSON.stringify(parsed.data, null, 2) + '\n',
          );
          json(200, { ok: true });
        } catch {
          json(400, { error: 'bad json' });
        }
      });
      return;
    }

    // default: the UI
    const html = readFileSync(join(REPO_ROOT, 'src', 'run', 'calibrationLabel.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`calibration labeler for rater "${rater}" on http://localhost:${PORT}`);
  });
}

function main(): void {
  const rater = process.argv.find((a) => a.startsWith('--rater='))?.slice(8) ?? 'self';
  const dir = process.argv.find((a) => a.startsWith('--dir='))?.slice(6);
  startServer(rater, dir ? join(REPO_ROOT, dir) : CALIBRATION_DIR);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
