/**
 * Deterministic offline contestant.
 *
 * Returns scripted turns so the smoke test is a real end-to-end run with no
 * API key and no cost. The script deliberately contains two *defects* - a
 * hallucinated tower and a malformed phone number - so the Layer-1 event path
 * (`hallucinated_argument`, `schema_violation`) is exercised and visible in the
 * transcript rather than only being reachable via a live model.
 */

import type {
  Contestant,
  ContestantTurnInput,
  ContestantTurnOutput,
} from './types.js';

export interface FakeContestantOptions {
  script: readonly ContestantTurnOutput[];
  id?: string;
  version?: string;
}

export class FakeContestant implements Contestant {
  readonly id: string;
  readonly version: string;
  readonly #script: readonly ContestantTurnOutput[];
  #index = 0;

  constructor(options: FakeContestantOptions) {
    this.#script = options.script;
    this.id = options.id ?? 'contestant:fake';
    this.version = options.version ?? '0.1.0';
  }

  async turn(_input: ContestantTurnInput): Promise<ContestantTurnOutput> {
    const step = this.#script[this.#index];
    this.#index += 1;
    // Off the end of the script: reply with nothing to say and no tool calls,
    // which ends the agent's half-turn and hands control back to the buyer.
    return step ?? { message: 'Let me know if you need anything else.' };
  }

  get turnsPlayed(): number {
    return this.#index;
  }
}

/** Paired with `mockBuyerScript`; see the turn-by-turn mapping in CLAUDE.md. */
export function mockAgentScript(): ContestantTurnOutput[] {
  return [
    // --- buyer turn 1: "what's the price for a 2bhk?"
    {
      toolCalls: [
        { id: 'call_avail_2bhk', name: 'check_availability', args: { target: 'units', unitType: '2BHK' } },
      ],
    },
    {
      message:
        'Namaste! For Kalpana Heights we have two 2BHKs open right now: 645 sqft in Tower A at Rs 68.5 lakh, and 712 sqft in Tower A at Rs 74.5 lakh.',
    },

    // --- buyer turn 2: "anything cheaper?"
    // DEFECT (intentional): Tower C does not exist -> hallucinated_argument.
    {
      toolCalls: [
        {
          id: 'call_avail_towerC',
          name: 'check_availability',
          args: { target: 'units', unitType: '2BHK', tower: 'C' },
        },
      ],
    },
    {
      toolCalls: [
        {
          id: 'call_avail_under70',
          name: 'check_availability',
          args: { target: 'units', unitType: '2BHK', maxPriceInr: 7000000 },
        },
      ],
    },
    {
      message:
        'The 645 sqft unit in Tower A at Rs 68.5 lakh is the lowest 2BHK we have. The Tower B 2BHK was cheaper but it is already sold.',
    },

    // --- buyer turn 3: "send floor plan and brochure"
    {
      toolCalls: [
        { id: 'call_send_fp', name: 'send_asset', args: { assetId: 'asset_floorplan_2bhk' } },
        {
          id: 'call_send_brochure',
          name: 'send_asset',
          args: { assetId: 'asset_brochure_v3', note: 'Full project brochure, v3.' },
        },
      ],
    },
    { message: 'Sent - the 2BHK floor plan and the project brochure.' },

    // --- buyer turn 4: "do you have a 1bhk?"  (correct refusal, no tool call)
    {
      message:
        'No 1BHK in Kalpana Heights, I am afraid. The smallest configuration we have is the 645 sqft 2BHK.',
    },

    // --- buyer turn 5: "possession date? rera?"
    {
      toolCalls: [
        {
          id: 'call_info_possession',
          name: 'fetch_project_info',
          args: { sections: ['possession', 'rera'] },
        },
      ],
    },
    {
      message:
        'Possession is Q4-2027 and the project is RERA registered under P00000000000000-FICTIONAL.',
    },

    // --- buyer turn 6: "book a site visit 15th feb morning"
    {
      toolCalls: [
        {
          id: 'call_slots_15feb',
          name: 'check_availability',
          args: { target: 'site_visit_slots', date: '2026-02-15' },
        },
      ],
    },
    // DEFECT (intentional): phone is not E.164 -> schema_violation.
    {
      toolCalls: [
        {
          id: 'call_book_bad_phone',
          name: 'schedule_site_visit',
          args: {
            unitId: 'unit_A_0402',
            slotId: 'slot_2026_02_15_1030',
            visitorName: 'Rohan Deshmukh',
            visitorPhone: '9812345670',
            mode: 'in_person',
          },
        },
      ],
    },
    {
      toolCalls: [
        {
          id: 'call_book_ok',
          name: 'schedule_site_visit',
          args: {
            unitId: 'unit_A_0402',
            slotId: 'slot_2026_02_15_1030',
            visitorName: 'Rohan Deshmukh',
            visitorPhone: '+919812345670',
            mode: 'in_person',
          },
        },
      ],
    },
    {
      message:
        'Booked - 15 Feb, 10:30 AM, in person, for the 645 sqft 2BHK in Tower A. See you then!',
    },
  ];
}
