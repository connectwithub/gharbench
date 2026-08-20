/**
 * Corpus document drift suite.
 *
 * The data-bearing documents in data/corpus/documents/ are generated from the
 * gold DB by src/run/corpusDocs.ts. This suite regenerates them in memory and
 * byte-compares against what is on disk, so a hand edit to a generated file -
 * or a DB edit without `pnpm corpus:docs` - fails the build instead of
 * shipping a document that contradicts the ground truth.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadGoldDb } from '../src/env/db.js';
import { CORPUS_DIR, DOCS_DIR, buildDocs, inr } from '../src/run/corpusDocs.js';

const db = loadGoldDb(join(CORPUS_DIR, 'project.json'));
const docs = buildDocs(db);

describe('generated documents', () => {
  it('generates exactly the expected set', () => {
    expect(Object.keys(docs).sort()).toEqual([
      'agent-policy.md',
      'amenity-list.md',
      'cost-sheet-sample.md',
      'pricesheet-phase1.md',
      'pricesheet-phase2.md',
      'rera-phase1.md',
      'rera-phase2.md',
    ]);
  });

  it('matches the files on disk byte for byte', () => {
    for (const [name, content] of Object.entries(docs)) {
      const onDisk = readFileSync(join(DOCS_DIR, name), 'utf8');
      expect(onDisk, `${name} has drifted - run \`pnpm corpus:docs\``).toBe(content);
    }
  });

  it('marks every generated document as generated and fictional', () => {
    for (const [name, content] of Object.entries(docs)) {
      expect(content, name).toContain('GENERATED');
      expect(content, name).toContain('FICTIONAL');
    }
  });

  it('states the right GST regime per phase in the cost sheet', () => {
    const costSheet = docs['cost-sheet-sample.md'] ?? '';
    // unit_A_0704 is in the ready phase (GST 0), unit_C_0801 under construction (GST 5).
    expect(costSheet).toContain('GST @ 0% on agreement value');
    expect(costSheet).toContain('GST @ 5% on agreement value');
  });
});

describe('asset-to-document mapping', () => {
  const METADATA_ONLY = new Set(['floor_plan', 'video']);

  it('every document-kind asset has a source file matching its URL stem', () => {
    for (const asset of db.assets) {
      if (METADATA_ONLY.has(asset.kind)) continue;
      const stem = asset.url
        .split('/')
        .pop()
        ?.replace(/\.[a-z0-9]+$/, '');
      expect(stem, asset.id).toBeTruthy();
      const docPath = join(DOCS_DIR, `${stem}.md`);
      expect(existsSync(docPath), `${asset.id} -> ${stem}.md missing`).toBe(true);
    }
  });

  it('hand-authored documents are marked fictional too', () => {
    for (const name of [
      'brochure-master.md',
      'spec-sheet.md',
      'approvals-note.md',
      'construction-update-2026q3.md',
    ]) {
      const content = readFileSync(join(DOCS_DIR, name), 'utf8');
      expect(content, name).toContain('FICTIONAL');
      // Hand-authored docs must never claim to be generated.
      expect(content, name).not.toContain('GENERATED');
    }
  });
});

describe('inr formatting', () => {
  it('groups digits the Indian way without locale dependence', () => {
    expect(inr(500)).toBe('Rs 500');
    expect(inr(30000)).toBe('Rs 30,000');
    expect(inr(350000)).toBe('Rs 3,50,000');
    expect(inr(7169000)).toBe('Rs 71,69,000');
    expect(inr(23348000)).toBe('Rs 2,33,48,000');
  });
});
