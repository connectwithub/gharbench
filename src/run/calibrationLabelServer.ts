/**
 * The calibration labeling tool
 * (`pnpm calibration:label [--rater=name] [--dir=...] [--only=2,5,14]`).
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

import { TOOL_SPECS } from '../env/tools.js';
import { applicableAnchorIds } from '../judge/anchorApplicability.js';
import {
  CALIBRATION_DIR,
  CASES_DIR,
  calibrationLabelSchema,
  type CalibrationCase,
} from './calibrationCase.js';
import { SLICE_FILE } from './calibrationSlice.js';
import { loadJudgeItems, type JudgeItems } from './judgeItems.js';
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
  for (const ch of rater) h = ((h ^ ch.charCodeAt(0)) * 16777619) >>> 0;
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

/**
 * `--only=2,5,14` restricts a sitting to those POSITIONS (re-check mode: an
 * adjudication pass over a handful of cases without scrolling a 119-button
 * sidebar). Positions are the rater's stable handles across sittings, so the
 * filter is applied AFTER aliasing and never renumbers what it shows.
 *
 * Validation is strict and up front - a typo here would silently re-label the
 * wrong case, which is the one failure mode this whole alias scheme exists to
 * prevent. Duplicates collapse, output is ascending.
 */
export function parseOnlyPositions(spec: string, caseCount: number): number[] {
  const parts = spec
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (parts.length === 0) {
    throw new Error('--only needs at least one position, e.g. --only=2,5,14');
  }
  const picked = new Set<number>();
  for (const part of parts) {
    if (!/^[0-9]+$/.test(part)) {
      throw new Error(`--only: "${part}" is not a positive integer (positions are 1-based)`);
    }
    const n = Number(part);
    if (n < 1 || n > caseCount) {
      throw new Error(`--only: position ${n} is out of range (this rater has ${caseCount} cases)`);
    }
    picked.add(n);
  }
  return [...picked].sort((a, b) => a - b);
}

/**
 * The list the rater's sidebar gets: the full aliased order, or - under
 * `--only` - just the named positions, in ascending position order. Pure, so
 * the filter contract is testable without binding a port. `positions` is what
 * the UI prints; it is NOT the array index, which is the whole point.
 */
export function buildServedList(
  order: readonly string[],
  onlySpec?: string,
): {
  positions: number[];
  aliases: string[];
  ids: string[];
  filtered: boolean;
  total: number;
} {
  const positions =
    onlySpec === undefined
      ? order.map((_, i) => i + 1)
      : parseOnlyPositions(onlySpec, order.length);
  const { toAlias } = aliasCaseIds(order);
  const ids = positions.map((p) => order[p - 1] as string);
  return {
    positions,
    aliases: ids.map((id) => toAlias.get(id) as string),
    ids,
    filtered: onlySpec !== undefined,
    total: order.length,
  };
}

/** What the rater may see: no caseId, no band/source/provenance. */
export function redactCase(raw: CalibrationCase): Record<string, unknown> {
  return {
    language: raw.language,
    endedBy: raw.endedBy,
    // ADR-0029: which flow-ending tool closed an agent-ended chat - the two
    // closes read identically in the transcript but mean opposite things.
    ...(raw.endedByTool !== undefined ? { endedByTool: raw.endedByTool } : {}),
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
  /**
   * The agent's COMPLETE tool roster (ADR-0029): "did the agent even have
   * such a facility?" is a ground-truth question - e.g. no tool holds or
   * reserves a unit, and send_asset can only send the listed assets.
   */
  tools: { name: string; kind: string; endsChat: boolean; description: string }[];
  db: {
    project: unknown;
    agentPolicy: unknown;
    paymentPlans: unknown;
    units: unknown[];
    siteVisitSlots: unknown[];
    assets: unknown[];
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
    assets: unknown[];
  };
  return {
    documents,
    tools: TOOL_SPECS.map((t) => ({
      name: t.name,
      kind: t.kind,
      endsChat: t.flowEnding,
      description: t.description,
    })),
    db: {
      project: gold.project,
      agentPolicy: gold.agentPolicy,
      paymentPlans: gold.paymentPlans,
      units: gold.units,
      siteVisitSlots: gold.siteVisitSlots,
      assets: gold.assets,
    },
  };
}

/**
 * Assemble one stored label from a rater's POST. Split out of the handler so
 * the stamping contract is testable without binding a port: the rubric
 * `itemsVersion` is recorded here and nowhere else, and binary answers are
 * filtered to the items this case actually asks (a UI navigation race once
 * left a stale key from the previous case in the posted state, and an un-asked
 * answer must never be stored).
 */
export function buildLabel(opts: {
  caseId: string;
  rater: string;
  rubric: JudgeItems;
  judgeApplicability: CalibrationCase['judgeApplicability'];
  posted: { binary?: unknown; anchors?: unknown; note?: string };
  labeledAt?: string;
}): ReturnType<typeof calibrationLabelSchema.safeParse> {
  const asked = new Set(Object.values(opts.judgeApplicability).flat());
  const binary = Object.fromEntries(
    Object.entries((opts.posted.binary ?? {}) as Record<string, unknown>).filter(([k]) =>
      asked.has(k),
    ),
  );
  // ADR-0026 parity: an anchor is answered only where the judges are asked it
  // (SA1 only on SE6-declared cases). Same rule as the judge parser.
  const askedAnchors = new Set(
    (['factuality', 'salesEffectiveness', 'conversationQuality'] as const).flatMap((d) =>
      applicableAnchorIds(opts.rubric, d, opts.judgeApplicability[d]),
    ),
  );
  const posted = opts.posted.anchors;
  const anchors =
    posted !== null && typeof posted === 'object' && !Array.isArray(posted)
      ? Object.fromEntries(
          Object.entries(posted as Record<string, unknown>).filter(([k]) => askedAnchors.has(k)),
        )
      : posted;
  return calibrationLabelSchema.safeParse({
    caseId: opts.caseId,
    rater: opts.rater,
    labeledAt: opts.labeledAt ?? new Date().toISOString(),
    binary,
    anchors,
    itemsVersion: opts.rubric.version,
    ...(opts.posted.note !== undefined && opts.posted.note !== ''
      ? { note: opts.posted.note }
      : {}),
  });
}

export function startServer(
  rater: string,
  baseDir: string = CALIBRATION_DIR,
  onlySpec?: string,
): void {
  const casesDir = baseDir === CALIBRATION_DIR ? CASES_DIR : join(baseDir, 'cases');
  const labelsDir = join(baseDir, 'labels', rater);
  mkdirSync(labelsDir, { recursive: true });
  const rubric = loadJudgeItems();
  let reference: ReturnType<typeof buildReference> | undefined;

  // Computed ONCE at startup, for two reasons: a missing slice file fails
  // here with its intended message instead of killing the process on the
  // rater's first request; and the alias->id mapping is frozen for the
  // session - recomputing it per request from a live readdirSync means a
  // concurrent calibration:build/slice shifts every position and a POSTed
  // alias silently writes the rater's answers onto a DIFFERENT case.
  const order = shuffledCaseIds(rater, casesDir);
  const { toAlias, toId } = aliasCaseIds(order);

  // Applied AFTER aliasing, so a shown case's position number is exactly what
  // it would be without the flag. Only the SERVED list narrows; the alias->id
  // map above stays the full-set map, which is what keeps positions stable.
  // Throws here (startup) on a bad --only, before a rater can touch anything.
  const view = buildServedList(order, onlySpec);
  const served = new Set(view.aliases);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    try {
      if (req.method === 'GET' && url.pathname === '/api/cases') {
        const labeled = readdirSync(labelsDir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => toAlias.get(f.replace(/\.json$/, '')))
          .filter((a): a is string => a !== undefined && served.has(a));
        json(200, {
          rater,
          order: view.aliases,
          // The true position of each served alias - the UI numbers buttons
          // from this, never from its own array index.
          positions: view.positions,
          labeled,
          filtered: view.filtered,
          total: view.total,
        });
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/case/')) {
        const alias = url.pathname.slice('/api/case/'.length);
        // A position outside --only is indistinguishable from an unknown alias:
        // the UI cannot wander out of the re-check set by guessing a URL.
        const caseId = served.has(alias) ? toId.get(alias) : undefined;
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
          // Parse failures are the client's fault (400); anything after that -
          // e.g. a failed disk write - is the server's (500), and must not be
          // mislabeled 'bad json' while the rater's answers are lost.
          let posted: { alias?: string; binary?: unknown; anchors?: unknown; note?: string };
          try {
            posted = JSON.parse(body) as typeof posted;
          } catch {
            json(400, { error: 'bad json' });
            return;
          }
          try {
            const caseId =
              posted.alias !== undefined && served.has(posted.alias)
                ? toId.get(posted.alias)
                : undefined;
            if (caseId === undefined) {
              json(400, { error: `unknown case alias ${posted.alias ?? '(none)'}` });
              return;
            }
            // The client never sees the real id; the full label (real caseId,
            // rater, timestamp, rubric version) is assembled server-side so
            // the stored file keeps the shape every downstream consumer
            // already expects.
            const caseRaw = JSON.parse(
              readFileSync(join(casesDir, `${caseId}.json`), 'utf8'),
            ) as CalibrationCase;
            const parsed = buildLabel({
              caseId,
              rater,
              rubric,
              judgeApplicability: caseRaw.judgeApplicability,
              posted,
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
          } catch (err) {
            json(500, { error: err instanceof Error ? err.message : String(err) });
          }
        });
        return;
      }

      // default: the UI
      const html = readFileSync(join(REPO_ROOT, 'src', 'run', 'calibrationLabel.html'), 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      // A sync throw here would otherwise take down the whole labeler
      // mid-session (node treats it as an uncaughtException).
      json(500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.listen(PORT, '127.0.0.1', () => {
    const filter = view.filtered
      ? ` — re-check mode: positions ${view.positions.join(', ')} (${view.positions.length} of ${view.total})`
      : '';
    console.log(`calibration labeler for rater "${rater}" on http://localhost:${PORT}${filter}`);
  });
}

function main(): void {
  const rater = process.argv.find((a) => a.startsWith('--rater='))?.slice(8) ?? 'self';
  const dir = process.argv.find((a) => a.startsWith('--dir='))?.slice(6);
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  startServer(rater, dir ? join(REPO_ROOT, dir) : CALIBRATION_DIR, only);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
