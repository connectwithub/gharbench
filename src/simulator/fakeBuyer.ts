/**
 * Deterministic offline buyer.
 *
 * Plays a fixed script so `pnpm smoke` exercises the real orchestrator, the
 * real environment and the real logging path with no API key and no cost. It
 * is a stand-in for `ModelBuyer`, not a simplification of it: same interface,
 * same half-duplex contract, same termination-token protocol.
 */

import type { ScenarioConfig } from '../engine/orchestrator.js';
import type { Buyer, BuyerTurnOutput } from './buyer.js';

export interface FakeBuyerOptions {
  script: readonly string[];
  id?: string;
  version?: string;
}

export class FakeBuyer implements Buyer {
  readonly id: string;
  readonly version: string;
  readonly #script: readonly string[];
  #index = 0;

  constructor(options: FakeBuyerOptions) {
    this.#script = options.script;
    this.id = options.id ?? 'buyer:fake';
    this.version = options.version ?? '0.1.0';
  }

  async respond(): Promise<BuyerTurnOutput> {
    const line = this.#script[this.#index];
    this.#index += 1;
    // Running off the end of the script must terminate rather than loop: a
    // silent restart would produce an infinite conversation.
    return { message: line ?? '###STOP###' };
  }

  get turnsPlayed(): number {
    return this.#index;
  }
}

/**
 * The Phase 0 script: seven buyer turns, ending in ###STOP###.
 *
 * It probes price first, pushes back once, asks for collateral, asks for a
 * configuration the project does not sell (the 1BHK trap), checks possession
 * and RERA, then books a visit. Enough shape to make every tool reachable.
 */
export function mockBuyerScript(scenario: ScenarioConfig): string[] {
  return [
    scenario.openingMessage,
    '68.5L is a bit above what i had in mind tbh. anything cheaper in 2bhk?',
    'ok. can you send the floor plan and the brochure?',
    'thanks. do you have a 1bhk also?',
    'got it. and possession date? is it rera registered?',
    'fine, book me a site visit on 15th feb morning. Rohan Deshmukh, 9812345670',
    'perfect, thanks. thats all for now ###STOP###',
  ];
}
