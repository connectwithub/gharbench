/**
 * Persona-card schema suite (Master Plan 3.6).
 *
 * The card is the buyer simulator's entire identity, so a malformed card is a
 * validity bug in the benchmark itself: a missing walk-away trigger silently
 * recreates the over-cooperative simulator the design mandates exist to kill.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  loadPersonaCard,
  personaCardSchema,
  trapTypeSchema,
  type PersonaCard,
} from '../src/simulator/persona.js';
import { buildBuyerSystemPrompt } from '../src/simulator/buyer.js';
import { loadFixtures } from '../src/run/smoke.js';

const MOCK_PATH = join(import.meta.dirname, '..', 'data', 'realestate-mock', 'persona.json');
const mock = loadPersonaCard(MOCK_PATH);

/** Deep-cloned mock as a mutable starting point for negative cases. */
const variant = (): PersonaCard => structuredClone(mock);

describe('persona card schema', () => {
  it('accepts the mock fixture', () => {
    expect(personaCardSchema.safeParse(mock).success).toBe(true);
  });

  it('rejects unknown keys at every level', () => {
    expect(personaCardSchema.safeParse({ ...mock, bogus: 1 }).success).toBe(false);

    const withHiddenExtra = variant() as unknown as Record<string, Record<string, unknown>>;
    withHiddenExtra['hidden'] = { ...withHiddenExtra['hidden'], leak: 'x' };
    expect(personaCardSchema.safeParse(withHiddenExtra).success).toBe(false);
  });

  it('requires 3-5 consistency anchors', () => {
    const tooFew = variant();
    tooFew.consistencyAnchors = ['only', 'two'];
    expect(personaCardSchema.safeParse(tooFew).success).toBe(false);

    const tooMany = variant();
    tooMany.consistencyAnchors = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
    expect(personaCardSchema.safeParse(tooMany).success).toBe(false);
  });

  it('requires a full behavioral-control block', () => {
    const card = variant() as unknown as {
      hidden: { behavioralControls: Record<string, unknown> };
    };
    delete card.hidden.behavioralControls['disengagementStyle'];
    expect(personaCardSchema.safeParse(card).success).toBe(false);
  });

  it('pins trap types to the taxonomy', () => {
    expect(trapTypeSchema.options).toEqual([
      'guaranteed_returns',
      'cash_component',
      'rera_misrep',
      'carpet_loading_misquote',
      'amenity_approval_misrep',
      'off_book_discount',
      'accuracy_probe',
    ]);

    const card = variant();
    const trap = card.hidden.traps[0];
    expect(trap).toBeDefined();
    (trap as unknown as Record<string, unknown>)['type'] = 'bribery';
    expect(personaCardSchema.safeParse(card).success).toBe(false);
  });

  it('allows a clean-baseline persona: no traps, optional economics', () => {
    const card = variant();
    card.hidden.traps = [];
    delete card.hidden.economics.budgetCeilingInr;
    expect(personaCardSchema.safeParse(card).success).toBe(true);
  });

  it('loadPersonaCard throws a labelled error on a malformed file', () => {
    expect(() => loadPersonaCard(join(import.meta.dirname, 'persona.test.ts'))).toThrow();
  });
});

describe('persona card in the buyer prompt', () => {
  it('serialises hidden fields and anchors into the buyer system prompt only', () => {
    const fixtures = loadFixtures();
    const prompt = buildBuyerSystemPrompt(fixtures.persona, fixtures.scenario);
    // The simulator gets everything...
    expect(prompt).toContain('budgetCeilingInr');
    expect(prompt).toContain('consistencyAnchors');
    expect(prompt).toContain('trap_phantom_1bhk');
    // ...and the transcript-side guarantee is asserted in orchestrator.test.ts.
  });
});
