#!/usr/bin/env node
/**
 * Regenerate INDEX.md for a decision log from its decisions.jsonl.
 *
 *   node scripts/decisions-index.mjs docs/decisions
 *   node scripts/decisions-index.mjs docs/decisions-private
 *
 * INDEX.md is derived and safe to overwrite. decisions.jsonl and the ADR
 * markdown files are append-only and authored by hand.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/decisions-index.mjs <log-dir>');
  process.exit(1);
}

// The private log is gitignored, so it is simply absent in a fresh clone and in
// CI. That is the expected state for anyone but the maintainer - skip it rather
// than failing the command for every contributor.
if (!existsSync(dir)) {
  console.log(`${dir} - not present, skipped`);
  process.exit(0);
}

const jsonlPath = join(dir, 'decisions.jsonl');
if (!existsSync(jsonlPath)) {
  console.error(`${dir} exists but has no decisions.jsonl`);
  process.exit(1);
}

const entries = readFileSync(jsonlPath, 'utf8')
  .split('\n')
  .filter((l) => l.trim().length > 0)
  .map((l, i) => {
    try {
      return JSON.parse(l);
    } catch (e) {
      throw new Error(`${jsonlPath}:${i + 1} is not valid JSON — ${e.message}`);
    }
  });

// Every entry must have a matching ADR file, or the index lies.
const files = new Set(readdirSync(dir).filter((f) => f.startsWith('ADR-') && f.endsWith('.md')));
const missing = entries.filter((e) => ![...files].some((f) => f.startsWith(`${e.id}-`)));
if (missing.length > 0) {
  console.error(`entries with no ADR file: ${missing.map((m) => m.id).join(', ')}`);
  process.exit(1);
}
const orphans = [...files].filter((f) => !entries.some((e) => f.startsWith(`${e.id}-`)));
if (orphans.length > 0) {
  console.error(`ADR files with no jsonl entry: ${orphans.map((o) => basename(o)).join(', ')}`);
  process.exit(1);
}

const fileFor = (id) => [...files].find((f) => f.startsWith(`${id}-`));
const byDate = [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

const tags = new Map();
for (const e of entries) {
  for (const t of e.tags ?? []) {
    if (!tags.has(t)) tags.set(t, []);
    tags.get(t).push(e);
  }
}

const isPrivate = dir.includes('private');
const superseded = (e) => (e.superseded_by ? ` **superseded by ${e.superseded_by}**` : '');

const out = [
  `# Decision index${isPrivate ? ' (private)' : ''}`,
  '',
  `Generated from \`decisions.jsonl\` — do not edit by hand.`,
  `Run \`node scripts/decisions-index.mjs ${dir}\` after appending an entry.`,
  '',
  `${entries.length} decision${entries.length === 1 ? '' : 's'}.`,
  '',
  '## By date',
  '',
  ...(byDate.length === 0
    ? ['_No decisions logged yet._', '']
    : [
        ...byDate.map(
          (e) => `- **${e.id}** (${e.date}) — [${e.title}](${fileFor(e.id)})${superseded(e)}`,
        ),
        '',
      ]),
  '## By tag',
  '',
  ...(tags.size === 0
    ? ['_No tags yet._']
    : [...tags.keys()].sort().flatMap((t) => [
        `### \`${t}\``,
        '',
        ...tags
          .get(t)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map((e) => `- ${e.id} — [${e.title}](${fileFor(e.id)})`),
        '',
      ])),
];

writeFileSync(join(dir, 'INDEX.md'), `${out.join('\n').trimEnd()}\n`, 'utf8');
console.log(`${dir}/INDEX.md — ${entries.length} entries, ${tags.size} tags`);
