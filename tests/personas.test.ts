/**
 * The 12 designed personas: every card in data/personas/ must validate, and
 * the design couplings between personas and the v2 corpus must actually hold
 * (who can afford what, and who deliberately cannot). A persona whose budget
 * story silently stops matching the price sheet invalidates every scenario
 * built on it, so these are pinned here rather than trusted.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadGoldDb, phaseOfTower, type RealEstateDb, type Unit } from '../src/env/db.js';
import { loadPersonaCard, type PersonaCard } from '../src/simulator/persona.js';

const PERSONAS_DIR = join(import.meta.dirname, '..', 'data', 'personas');
const CORPUS_PATH = join(import.meta.dirname, '..', 'data', 'corpus', 'project.json');

/** Extend as authoring batches land; the full set is P01..P12. */
const AUTHORED = ['P01', 'P02', 'P07', 'P08'] as const;

const files = readdirSync(PERSONAS_DIR).filter((f) => f.endsWith('.json'));
const cards = new Map<string, PersonaCard>(
  files.map((f) => {
    const card = loadPersonaCard(join(PERSONAS_DIR, f));
    return [f.replace(/\.json$/, ''), card];
  }),
);
const corpus = loadGoldDb(CORPUS_PATH);

const availableUnits = (db: RealEstateDb): Unit[] =>
  db.units.filter((u) => u.status === 'available');
const isReadyPhase = (db: RealEstateDb, u: Unit): boolean =>
  phaseOfTower(db, u.tower)?.status === 'ready';

describe('persona cards', () => {
  it('every authored card validates and matches its filename', () => {
    expect([...cards.keys()].sort()).toEqual([...AUTHORED].sort());
    for (const [stem, card] of cards) {
      expect(card.personaId, stem).toBe(stem);
    }
  });

  it('baseline personas carry no traps; every card scripts disengagement', () => {
    for (const [id, card] of cards) {
      if (['P01', 'P02', 'P07', 'P08'].includes(id)) {
        expect(card.hidden.traps, id).toHaveLength(0);
      }
      expect(card.hidden.behavioralControls.walkAwayTriggers.length, id).toBeGreaterThanOrEqual(1);
      // The 3.9 mandate: disengagement must be a "not now" shape, never a question.
      expect(card.hidden.behavioralControls.disengagementStyle, id).not.toContain('?');
    }
  });

  it('difficulties match the master-plan table', () => {
    const expected: Record<string, PersonaCard['difficulty']> = {
      P01: 'easy',
      P02: 'medium',
      P07: 'medium',
      P08: 'medium',
    };
    for (const [id, difficulty] of Object.entries(expected)) {
      expect(cards.get(id)?.difficulty, id).toBe(difficulty);
    }
  });
});

describe('persona-corpus design couplings', () => {
  it('P01 can afford at least one ready 2BHK within the stretch ceiling', () => {
    const p01 = cards.get('P01');
    expect(p01).toBeDefined();
    const limit = p01?.hidden.economics.walkAwayPointInr ?? 0;
    const options = availableUnits(corpus).filter(
      (u) => u.unitType === '2BHK' && isReadyPhase(corpus, u) && u.priceInr <= limit,
    );
    expect(options.length).toBeGreaterThanOrEqual(1);
  });

  it('P02 can afford a 3BHK within the stretch ceiling', () => {
    const p02 = cards.get('P02');
    const limit = p02?.hidden.economics.walkAwayPointInr ?? 0;
    const options = availableUnits(corpus).filter(
      (u) => u.unitType === '3BHK' && u.priceInr <= limit,
    );
    expect(options.length).toBeGreaterThanOrEqual(1);
  });

  it('P07 has a ready, low-floor 2BHK inside the fixed corpus', () => {
    const p07 = cards.get('P07');
    const limit = p07?.hidden.economics.budgetCeilingInr ?? 0;
    const options = availableUnits(corpus).filter(
      (u) =>
        u.unitType === '2BHK' && isReadyPhase(corpus, u) && u.floor <= 4 && u.priceInr <= limit,
    );
    expect(options.length).toBeGreaterThanOrEqual(1);
  });

  it('P08 is a designed budget mismatch: nothing in the corpus fits', () => {
    const p08 = cards.get('P08');
    const limit = p08?.hidden.economics.budgetCeilingInr ?? 0;
    expect(limit).toBeGreaterThan(0);
    const options = corpus.units.filter((u) => u.priceInr <= limit);
    expect(options).toHaveLength(0);
  });
});
