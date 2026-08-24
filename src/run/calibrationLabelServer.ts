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
 *
 * Case ids themselves encode provenance (cal_syn_pass_*, cal_adv_*, and
 * cal_real_<contestant>_<scenario>), so serving them would hand the rater the
 * answer. The API therefore speaks only opaque per-rater aliases ("c017" =
 * the rater's 17th case); real ids exist server-side only, and label files
 * are still written under the real id so downstream tooling is unaffected.
 * (ADR-0022. Threat model: anti-priming for cooperative raters, not
 * anti-adversary - the case files sit on the same disk.)
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
      throw new Error(
        `Rater "${rater}" labels the 50-case slice; run pnpm calibration:slice first.`,
      );
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

/** Positional aliases over the rater's shuffled order - stable across sittings. */
export function aliasCaseIds(order: readonly string[]): {
  toAlias: Map<string, string>;
  toId: Map<string, string>;
} {
  const toAlias = new Map<string, string>();
  const toId = new Map<string, string>();
  order.forEach((id, i) => {
    const alias = `c${String(i + 1).padStart(3, '0')}`;
    toAlias.set(id, alias);
    toId.set(alias, id);
  });
  return { toAlias, toId };
}

/** What the rater may see: no caseId, no band/source/provenance. */
export function redactCase(raw: CalibrationCase): Record<string, unknown> {
  return {
    language: raw.language,
    judgeApplicability: raw.judgeApplicability,
    messages: raw.messages,
  };
}

/**
 * Ground-truth reference for the rater (ADR-0023): the SAME source documents
 * the judges get verbatim in their system block (byte-parity with judgeRun's
 * loadSourceDocuments is test-pinned), plus a digest of the gold DB the
 * agent's tools answered from - units, site-visit slots, agent policy,
 * project facts.
 * Grounding items (F1-F5, several CP) are unanswerable without this; the
 * corpus is identical for every case, so showing it leaks nothing about any
 * case's band, source or provenance.
 */
export function buildReference(): {
  documents: { file: string; text: string }[];
  db: {
    project: unknown;
    agentPolicy: unknown;
    paymentPlans: unknown;
    units: unknown[];
    siteVisitSlots: unknown[];
  };
} {
  const docsDir = join(REPO_ROOT, 'data', 'corpus', 'documents');
  const documents = readdirSync(docsDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => ({ file: f, text: readFileSync(join(docsDir, f), 'utf8').trim() }));
  const gold = JSON.parse(
    readFileSync(join(REPO_ROOT, 'data', 'corpus', 'project.json'), 'utf8'),
  ) as {
    project: unknown;
    agentPolicy: unknown;
    paymentPlans: unknown;
    units: unknown[];
    siteVisitSlots: unknown[];
  };
  return {
    documents,
    db: {
      project: gold.project,
      agentPolicy: gold.agentPolicy,
      paymentPlans: gold.paymentPlans,
      units: gold.units,
      siteVisitSlots: gold.siteVisitSlots,
    },
  };
}

export function startServer(rater: string, baseDir: string = CALIBRATION_DIR): void {
  const casesDir = baseDir === CALIBRATION_DIR ? CASES_DIR : join(baseDir, 'cases');
  const labelsDir = join(baseDir, 'labels', rater);
  mkdirSync(labelsDir, { recursive: true });
  const rubric = loadJudgeItems();
  let reference: ReturnType<typeof buildReference> | undefined;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && url.pathname === '/api/cases') {
      const order = shuffledCaseIds(rater, casesDir);
      const { toAlias } = aliasCaseIds(order);
      const labeled = readdirSync(labelsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => toAlias.get(f.replace(/\.json$/, '')))
        .filter((a): a is string => a !== undefined);
      json(200, { rater, order: order.map((id) => toAlias.get(id)), labeled });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/case/')) {
      const alias = url.pathname.slice('/api/case/'.length);
      const order = shuffledCaseIds(rater, casesDir);
      const caseId = aliasCaseIds(order).toId.get(alias);
      const path = caseId !== undefined ? join(casesDir, `${caseId}.json`) : '';
      if (caseId === undefined || !existsSync(path)) {
        json(404, { error: 'no such case' });
        return;
      }
      const raw = JSON.parse(readFileSync(path, 'utf8')) as CalibrationCase;
      const labelPath = join(labelsDir, `${caseId}.json`);
      // The stored label carries the real caseId; hand back only the answers.
      const existing = existsSync(labelPath)
        ? (JSON.parse(readFileSync(labelPath, 'utf8')) as {
            binary: unknown;
            anchors: unknown;
            note?: unknown;
          })
        : null;
      json(200, {
        alias,
        case: redactCase(raw),
        existingLabel: existing
          ? { binary: existing.binary, anchors: existing.anchors, note: existing.note ?? '' }
          : null,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/rubric') {
      json(200, rubric);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/reference') {
      reference ??= buildReference();
      json(200, reference);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/label') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const posted = JSON.parse(body) as {
            alias?: string;
            binary?: unknown;
            anchors?: unknown;
            note?: string;
          };
          const order = shuffledCaseIds(rater, casesDir);
          const caseId =
            posted.alias !== undefined ? aliasCaseIds(order).toId.get(posted.alias) : undefined;
          if (caseId === undefined) {
            json(400, { error: `unknown case alias ${posted.alias ?? '(none)'}` });
            return;
          }
          // The client never sees the real id; the full label (real caseId,
          // rater, timestamp) is assembled here so the stored file keeps the
          // shape every downstream consumer already expects.
          const parsed = calibrationLabelSchema.safeParse({
            caseId,
            rater,
            labeledAt: new Date().toISOString(),
            binary: posted.binary,
            anchors: posted.anchors,
            ...(posted.note !== undefined && posted.note !== '' ? { note: posted.note } : {}),
          });
          if (!parsed.success) {
            json(400, { error: parsed.error.message });
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
