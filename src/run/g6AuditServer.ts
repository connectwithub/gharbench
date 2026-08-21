/**
 * The G6 simulator-deviation audit tool (`pnpm audit:g6 --run=<runId>`).
 *
 * Serves every conversation of a sweep run next to the exact buyer system
 * prompt it ran with (rebuilt via buildBuyerSystemPrompt - the manifest's
 * buyerPromptSha256 pins that this reconstruction is what was sent), so the
 * auditor judges the buyer against its instructions, not against taste.
 * Unlike the calibration labeler this is deliberately NOT blind: G6 is
 * "instruction-deviation <= the published 16-22% band" (Master Plan G6,
 * AURA / tau^2 audits), and deviation is only observable with the card open.
 *
 * Marks are saved per conversation into runs/<runId>/g6-audit.json, so the
 * audit can span sessions. The file lives in runs/ (gitignored) like
 * spotcheck-human.json.
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { z } from 'zod';

import type { ConversationRecord } from '../engine/orchestrator.js';
import { TRANSCRIPT_FILENAME, readTranscripts } from '../logging/transcript.js';
import { buildBuyerSystemPrompt } from '../simulator/buyer.js';
import { REPO_ROOT, loadScenarioSet } from './scenarioSet.js';

const PORT = 4175;

/** τ²-telecom hardened error band ceiling: 22% of conversations may deviate. */
export const G6_BAND_PCT = 22;
/** τ²-telecom hardened critical band: 6%. */
export const G6_CRITICAL_BAND_PCT = 6;

export const G6_DEVIATION_TAGS = [
  'frame_break',
  'persona_contradiction',
  'volunteered_hidden_info',
  'ignored_walkaway',
  'premature_stop',
  'over_cooperation',
  'non_sequitur',
  'register_mismatch',
  'scenario_instruction_missed',
  'other',
] as const;

export const g6MarkSchema = z
  .strictObject({
    conversationId: z.string().min(1),
    verdict: z.enum(['clean', 'minor', 'critical']),
    deviations: z.array(z.enum(G6_DEVIATION_TAGS)),
    note: z.string(),
    auditedAt: z.string().min(1),
  })
  .superRefine((m, ctx) => {
    if (m.verdict === 'clean' && m.deviations.length > 0) {
      ctx.addIssue({ code: 'custom', path: ['deviations'], message: 'clean verdicts carry no deviation tags' });
    }
    if (m.verdict !== 'clean' && m.deviations.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['deviations'], message: 'a deviation verdict must name at least one tag' });
    }
  });

export type G6Mark = z.infer<typeof g6MarkSchema>;

export interface G6AuditFile {
  runId: string;
  protocol: string;
  band: string;
  entries: Record<string, G6Mark>;
}

export interface G6Summary {
  total: number;
  audited: number;
  deviating: number;
  critical: number;
  deviationCeiling: number;
  criticalCeiling: number;
  met: boolean | null;
}

/**
 * Gate arithmetic. `met` is null until every conversation is audited - a
 * partial audit can already be failing, but it can never be passing.
 */
export function summariseG6(entries: Record<string, G6Mark>, total: number): G6Summary {
  const marks = Object.values(entries);
  const deviating = marks.filter((m) => m.verdict !== 'clean').length;
  const critical = marks.filter((m) => m.verdict === 'critical').length;
  const deviationCeiling = Math.floor((total * G6_BAND_PCT) / 100);
  const criticalCeiling = Math.floor((total * G6_CRITICAL_BAND_PCT) / 100);
  const failing = deviating > deviationCeiling || critical > criticalCeiling;
  return {
    total,
    audited: marks.length,
    deviating,
    critical,
    deviationCeiling,
    criticalCeiling,
    met: failing ? false : marks.length === total ? true : null,
  };
}

function auditPath(runDir: string): string {
  return join(runDir, 'g6-audit.json');
}

function loadAudit(runDir: string, runId: string): G6AuditFile {
  const path = auditPath(runDir);
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as G6AuditFile;
  return {
    runId,
    protocol:
      'G6 instruction-deviation manual audit: every conversation judged against its reconstructed buyer system prompt; single rater (project owner)',
    band: `deviation <= ${G6_BAND_PCT}% of conversations, critical <= ${G6_CRITICAL_BAND_PCT}% (AURA / tau^2 published band)`,
    entries: {},
  };
}

interface ServedConversation {
  conversationId: string;
  scenarioId: string;
  personaId: string;
  family: string;
  language: string;
  terminationReason: unknown;
  openingMessage: string;
  activeTrapIds: string[];
  buyerSystemPrompt: string;
  messages: { role: string; content: string; toolName?: string }[];
}

function serveConversation(record: ConversationRecord): ServedConversation {
  const set = cachedSet();
  const scenario = set.scenarios.find((s) => s.scenarioId === record.scenarioId);
  if (!scenario) throw new Error(`scenario ${record.scenarioId} not found`);
  const persona = set.personas.get(scenario.personaId);
  if (!persona) throw new Error(`persona ${scenario.personaId} not found`);
  // Tool-role surfaces are empty in the transcript; the call names live in
  // toolEvents in emission order, so pair them up positionally.
  const callNames = record.toolEvents.filter((e) => e.type === 'call').map((e) => e.toolName);
  let toolIdx = 0;
  const messages = record.messages.map((m) => {
    if (m.role === 'tool') {
      const toolName = callNames[toolIdx] ?? 'tool';
      toolIdx += 1;
      return { role: m.role, content: '', toolName };
    }
    return { role: m.role, content: m.content };
  });
  return {
    conversationId: record.conversationId,
    scenarioId: record.scenarioId,
    personaId: scenario.personaId,
    family: scenario.family,
    language: scenario.language,
    terminationReason: record.terminationReason,
    openingMessage: scenario.openingMessage,
    activeTrapIds: scenario.activeTrapIds,
    buyerSystemPrompt: buildBuyerSystemPrompt(persona, scenario),
    messages,
  };
}

let setCache: ReturnType<typeof loadScenarioSet> | undefined;
function cachedSet(): ReturnType<typeof loadScenarioSet> {
  setCache ??= loadScenarioSet({ includePrivate: existsSync(join(REPO_ROOT, 'private-pool', 'scenarios')) });
  return setCache;
}

export function startG6Server(runId: string): void {
  const runDir = join(REPO_ROOT, 'runs', runId);
  const transcriptPath = join(runDir, TRANSCRIPT_FILENAME);
  if (!existsSync(transcriptPath)) {
    throw new Error(`no ${TRANSCRIPT_FILENAME} in runs/${runId}`);
  }
  const records = readTranscripts(transcriptPath);
  const byId = new Map(records.map((r) => [r.conversationId, r]));

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && url.pathname === '/api/conversations') {
      const audit = loadAudit(runDir, runId);
      const list = records
        .map((r) => ({
          conversationId: r.conversationId,
          scenarioId: r.scenarioId,
          turns: r.messages.filter((m) => m.role === 'buyer').length,
          mark: audit.entries[r.conversationId] ?? null,
        }))
        .sort((a, b) => (a.scenarioId < b.scenarioId ? -1 : a.scenarioId > b.scenarioId ? 1 : 0));
      json(200, { runId, list, summary: summariseG6(audit.entries, records.length) });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/conversation/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/conversation/'.length));
      const record = byId.get(id);
      if (!record) {
        json(404, { error: 'no such conversation' });
        return;
      }
      json(200, serveConversation(record));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/mark') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const parsed = g6MarkSchema.safeParse(JSON.parse(body));
          if (!parsed.success) {
            json(400, { error: parsed.error.message });
            return;
          }
          if (!byId.has(parsed.data.conversationId)) {
            json(400, { error: `unknown conversation ${parsed.data.conversationId}` });
            return;
          }
          const audit = loadAudit(runDir, runId);
          audit.entries[parsed.data.conversationId] = parsed.data;
          writeFileSync(auditPath(runDir), JSON.stringify(audit, null, 2) + '\n');
          json(200, { ok: true, summary: summariseG6(audit.entries, records.length) });
        } catch {
          json(400, { error: 'bad json' });
        }
      });
      return;
    }

    const html = readFileSync(join(REPO_ROOT, 'src', 'run', 'g6Audit.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`G6 audit for run ${runId}: http://localhost:${PORT} (${records.length} conversations)`);
  });
}

function main(): void {
  const runId = process.argv.find((a) => a.startsWith('--run='))?.slice(6);
  if (!runId) {
    console.error('usage: pnpm audit:g6 --run=<runId>');
    process.exit(1);
  }
  startG6Server(runId);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
