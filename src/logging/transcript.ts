/**
 * JSONL transcript writer: one line per conversation-run.
 *
 * JSONL rather than a single JSON array so a long sweep is streamable, is
 * greppable with ordinary shell tools, and survives a crash mid-run with every
 * completed conversation intact.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ConversationRecord } from '../engine/orchestrator.js';

export const TRANSCRIPT_FILENAME = 'transcripts.jsonl';

export class TranscriptWriter {
  readonly path: string;
  #count = 0;

  constructor(runDir: string, filename: string = TRANSCRIPT_FILENAME) {
    this.path = join(runDir, filename);
    mkdirSync(dirname(this.path), { recursive: true });
    // Truncate: a run directory belongs to exactly one run.
    writeFileSync(this.path, '', 'utf8');
  }

  append(record: ConversationRecord): void {
    appendFileSync(this.path, `${JSON.stringify(record)}\n`, 'utf8');
    this.#count += 1;
  }

  get count(): number {
    return this.#count;
  }
}

export function readTranscripts(path: string): ConversationRecord[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ConversationRecord);
}
