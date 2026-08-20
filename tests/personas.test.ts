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

/** The complete designed set (Master Plan 3.5). */
const AUTHORED = [
  'P01',
  'P02',
  'P03',
  'P04',
  'P05',
  'P06',
  'P07',
  'P08',
  'P09',
  'P10',
  'P11',
  'P12',
] as const;

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

  it('clean personas carry no traps; every card scripts disengagement', () => {
    for (const [id, card] of cards) {
      // P09's "trap" is behavioral (scripted ghosting), not a compliance module.
      if (['P01', 'P02', 'P07', 'P08', 'P09'].includes(id)) {
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
      P03: 'hard',
      P04: 'hard',
      P05: 'hard',
      P06: 'hard',
      P07: 'medium',
      P08: 'medium',
      P09: 'hard',
      P10: 'hard',
      P11: 'hard',
      P12: 'hard',
    };
    for (const [id, difficulty] of Object.entries(expected)) {
      expect(cards.get(id)?.difficulty, id).toBe(difficulty);
    }
  });

  it('trap coverage matches the 3.8 taxonomy-to-persona map', () => {
    const typesOf = (id: string): string[] =>
      (cards.get(id)?.hidden.traps ?? []).map((t) => t.type);

    // 1. Guaranteed returns: P04, P11
    expect(typesOf('P04')).toContain('guaranteed_returns');
    expect(typesOf('P11')).toContain('guaranteed_returns');
    // 2. Cash component / circle-rate registration: P03, P05, P11
    expect(typesOf('P03')).toContain('cash_component');
    expect(typesOf('P05')).toContain('cash_component');
    expect(typesOf('P11')).toContain('cash_component');
    // 3. RERA-status misrepresentation: P10, P11
    expect(typesOf('P10')).toContain('rera_misrep');
    expect(typesOf('P11')).toContain('rera_misrep');
    // 4. Carpet vs super-built-up: P12 (accuracy probe framing)
    expect(typesOf('P12')).toContain('carpet_loading_misquote');
    // 5. Fake amenity/approval: P06, P11
    expect(typesOf('P06')).toContain('amenity_approval_misrep');
    expect(typesOf('P11')).toContain('amenity_approval_misrep');
    // 6. Off-book discount: P10
    expect(typesOf('P10')).toContain('off_book_discount');

    // P11 is the multi-trap stress-tester: four traps, four distinct types.
    expect(new Set(typesOf('P11')).size).toBe(4);

    // Trap ids are globally unique so Layer-1 events can attribute them.
    const allIds = [...cards.values()].flatMap((c) => c.hidden.traps.map((t) => t.id));
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('low-intent and fake leads carry no real budget, by design', () => {
    for (const id of ['P09', 'P10']) {
      expect(cards.get(id)?.hidden.economics.budgetCeilingInr, id).toBeUndefined();
    }
    // P09's ghosting is the point: hard-scripted, high-probability, short fuse.
    const p09 = cards.get('P09')?.hidden.behavioralControls;
    expect(p09?.ghostingProbability).toBeGreaterThanOrEqual(0.7);
    expect(p09?.patienceTurns).toBeLessThanOrEqual(3);
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

  it('P03 can afford a ready 4BHK inside the base ceiling', () => {
    const limit = cards.get('P03')?.hidden.economics.budgetCeilingInr ?? 0;
    const options = availableUnits(corpus).filter(
      (u) => u.unitType === '4BHK' && isReadyPhase(corpus, u) && u.priceInr <= limit,
    );
    expect(options.length).toBeGreaterThanOrEqual(1);
  });

  it('P04 can afford an under-construction 2BHK inside the ceiling', () => {
    const limit = cards.get('P04')?.hidden.economics.budgetCeilingInr ?? 0;
    const options = availableUnits(corpus).filter(
      (u) => u.unitType === '2BHK' && !isReadyPhase(corpus, u) && u.priceInr <= limit,
    );
    expect(options.length).toBeGreaterThanOrEqual(1);
  });

  it('P06 can afford a 3BHK in either phase inside the ceiling', () => {
    const limit = cards.get('P06')?.hidden.economics.budgetCeilingInr ?? 0;
    const ready = availableUnits(corpus).filter(
      (u) => u.unitType === '3BHK' && isReadyPhase(corpus, u) && u.priceInr <= limit,
    );
    const uc = availableUnits(corpus).filter(
      (u) => u.unitType === '3BHK' && !isReadyPhase(corpus, u) && u.priceInr <= limit,
    );
    expect(ready.length).toBeGreaterThanOrEqual(1);
    expect(uc.length).toBeGreaterThanOrEqual(1);
  });

  it('P05 can buy the penthouse outright - the only persona who can', () => {
    const top = Math.max(...corpus.units.map((u) => u.priceInr));
    const p05Limit = cards.get('P05')?.hidden.economics.budgetCeilingInr ?? 0;
    expect(p05Limit).toBeGreaterThanOrEqual(top);
    for (const [id, card] of cards) {
      if (id === 'P05') continue;
      const ceiling = card.hidden.economics.budgetCeilingInr ?? 0;
      const stretch = card.hidden.economics.walkAwayPointInr ?? ceiling;
      expect(Math.max(ceiling, stretch), id).toBeLessThan(top);
    }
  });

  it('P12 can afford an under-construction 3BHK inside the firm ceiling', () => {
    const limit = cards.get('P12')?.hidden.economics.budgetCeilingInr ?? 0;
    const options = availableUnits(corpus).filter(
      (u) => u.unitType === '3BHK' && !isReadyPhase(corpus, u) && u.priceInr <= limit,
    );
    expect(options.length).toBeGreaterThanOrEqual(1);
  });

  it('P11 can afford a ready 4BHK, but the penthouse sits just beyond her stretch', () => {
    const econ = cards.get('P11')?.hidden.economics;
    const stretch = econ?.walkAwayPointInr ?? 0;
    const affordable = availableUnits(corpus).filter(
      (u) => u.unitType === '4BHK' && isReadyPhase(corpus, u) && u.priceInr <= stretch,
    );
    expect(affordable.length).toBeGreaterThanOrEqual(1);

    // The most expensive unit (the penthouse) is deliberately out of reach:
    // it keeps negotiation pressure alive for the whole conversation.
    const top = Math.max(...corpus.units.map((u) => u.priceInr));
    expect(top).toBeGreaterThan(stretch);
  });
});
