/**
 * The L1.12 threshold tuning set (Master Plan Phase 2, decision I3): 20
 * seeded Hinglish pass/fail examples. The thresholds in src/checks/config.ts
 * were tuned until this suite passed and are FROZEN; any threshold or
 * wordlist change must keep all 20 verdicts intact or bump
 * CHECK_CONFIG_VERSION with an ADR.
 */

import { describe, expect, it } from 'vitest';
import { l112Verdict, type L112Verdict } from '../src/checks/checks.js';

interface TuningExample {
  name: string;
  buyer: string[];
  agent: string[];
  expected: L112Verdict;
}

const EXAMPLES: TuningExample[] = [
  // ---- 10 PASS examples ---------------------------------------------------
  {
    name: 'both sides natural hinglish',
    buyer: ['bhaiya 2bhk ka price kya hai aur possession kab milega'],
    agent: ['2bhk ka price 76 lakh se start hota hai bhaiya, ready wale me possession abhi milega'],
    expected: 'pass',
  },
  {
    name: 'both sides formal english',
    buyer: ['Hello, could you share the price of a two bedroom unit and the possession timeline?'],
    agent: [
      'Certainly - ready units start at Rs 76,14,000 and possession is immediate for Phase 1.',
    ],
    expected: 'pass',
  },
  {
    name: 'buyer hinglish, agent code-mixes enough',
    buyer: ['bhai budget thoda tight hai, sabse sasta wala batao na'],
    agent: [
      'bilkul bhai, sabse sasta 2bhk Tower C mein hai, 66.43 lakh ka - under construction hai par',
    ],
    expected: 'pass',
  },
  {
    name: 'light buyer mixing does not trigger the gate',
    buyer: ['ok thik hai, please send the brochure and price list for the 2bhk options'],
    agent: ['Sending both right away - the brochure and the Phase 1 price sheet.'],
    expected: 'pass',
  },
  {
    name: 'short buyer turns are excluded from measurement',
    buyer: ['ok', 'haan', 'thik'],
    agent: ['The 2BHK price sheet is attached, and Saturday morning slots are open for a visit.'],
    expected: 'pass',
  },
  {
    name: 'agent mirrors a mid-mix buyer with mid-mix replies',
    buyer: ['humko 3bhk chahiye tha lekin budget 1.1 cr tak hi hai, kya options milenge'],
    agent: ['1.1 cr mein Tower D ke under-construction 3bhk aa jayenge, ready wale thode upar hai'],
    expected: 'pass',
  },
  {
    name: 'english buyer with an occasional hindi word from the agent',
    buyer: ['I would like the complete cost sheet with every charge itemised, please.'],
    agent: [
      'Sure - sharing the complete cost sheet now, bilkul itemised with GST and stamp duty separate.',
    ],
    expected: 'pass',
  },
  {
    name: 'hinglish buyer, agent above the low bar',
    buyer: ['yaar parking aur club ka charge alag se lagta hai kya, total kitna padega'],
    agent: [
      'haan, parking Rs 3,50,000 aur club Rs 1,75,000 alag hai. Total I will send in the cost sheet.',
    ],
    expected: 'pass',
  },
  {
    name: 'both quiet registers, numbers-heavy exchange',
    buyer: ['Unit A-0704 - final figure including all charges and taxes?'],
    agent: [
      'Rs 77,90,000 agreement value, zero GST as it is ready with OC, plus the fixed charges on the sheet.',
    ],
    expected: 'pass',
  },
  {
    name: 'single qualifying turn each, matched hinglish',
    buyer: ['site visit sunday ko ho sakta hai kya, family ke saath aayenge hum log'],
    agent: ['haan bilkul, sunday 10:30 ka slot available hai, family ke liye seats bhi hai'],
    expected: 'pass',
  },

  // ---- 10 FAIL examples ---------------------------------------------------
  {
    name: 'formal english wall at a heavy hinglish buyer',
    buyer: ['bhaiya ye flat ka rate kitna hai aur emi kaise banegi humari'],
    agent: [
      'The apartment is competitively priced and the equated monthly installment depends on the financing institution you select.',
    ],
    expected: 'english_at_hinglish_buyer',
  },
  {
    name: 'legalese at a hindi-first buyer',
    buyer: ['sir humko samajh nahi aaya, carpet area kya hota hai simple me batao na'],
    agent: [
      'Carpet area denotes the net usable floor area as defined under Section 2(k) of the applicable regulatory statute.',
    ],
    expected: 'english_at_hinglish_buyer',
  },
  {
    name: 'sustained english despite repeated hinglish turns',
    buyer: [
      'accha ye batao possession kab milega pakka',
      'aur maintenance kitna dena hoga har mahine ka',
    ],
    agent: [
      'Possession for the ready phase is immediate upon registration completion.',
      'The maintenance charge is five rupees per square foot of super built-up area per month.',
    ],
    expected: 'english_at_hinglish_buyer',
  },
  {
    name: 'templated english pitch at a casual hinglish browser',
    buyer: ['bas aise hi dekh rahe the, sasta wala kaunsa hai aapke yahan'],
    agent: [
      'Thank you for your valuable enquiry. Our residential offerings begin at attractive price points with world class amenities.',
    ],
    expected: 'english_at_hinglish_buyer',
  },
  {
    name: 'english continues even after buyer switches fully to hindi',
    buyer: ['hum hindi me baat kare to theek rahega, english thodi kamzor hai humari'],
    agent: [
      'Absolutely, please proceed. The project offers two configurations with flexible payment plans.',
    ],
    expected: 'english_at_hinglish_buyer',
  },
  {
    name: 'forced hinglish at a formal english buyer',
    buyer: [
      'Kindly restrict this conversation to English. What is the exact carpet area of the Tower D 3BHK?',
    ],
    agent: ['arre sir tension kyu lete ho, 3bhk ekdum badhiya hai, aap bas dekhne aa jao pehle'],
    expected: 'hinglish_at_english_buyer',
  },
  {
    name: 'slangy hinglish at an NRI english register',
    buyer: [
      'I am writing from the US regarding due diligence on the Phase 2 registration documents.',
    ],
    agent: [
      'bhai sab documents ekdum sahi hai, aap bilkul chinta mat karo, sab set karwa denge hum',
    ],
    expected: 'hinglish_at_english_buyer',
  },
  {
    name: 'hinglish pressure tactics at a precise english buyer',
    buyer: ['Please quote the list price of unit B-0801 and nothing else.'],
    agent: [
      'sir seedha batau, abhi book kar lo warna nikal jayega, itna accha unit roz roz nahi aata',
    ],
    expected: 'hinglish_at_english_buyer',
  },
  {
    name: 'two hinglish walls at a consistently english senior buyer',
    buyer: [
      'We are retired persons and would appreciate clear written details, please.',
      'Kindly confirm whether the ready building has its occupancy certificate.',
    ],
    agent: [
      'uncle ji aap fikar mat karo, sab kagaz ekdum theek hai humare paas',
      'haan haan certificate wagera sab hai, aap bas aa jao dekhne, baaki hum sambhal lenge',
    ],
    expected: 'hinglish_at_english_buyer',
  },
  {
    name: 'aggressive hinglish close at an english-only investor',
    buyer: ['Send the rental yield assumptions in writing. Numbers only, no sales language.'],
    agent: [
      'boss itna sochoge to deal haath se jayegi, paisa lagao aur befikar ho jao, kirayedaar hum dhundh denge',
    ],
    expected: 'hinglish_at_english_buyer',
  },
];

describe('L1.12 frozen-threshold tuning set (I3)', () => {
  it('has exactly 20 examples, 10 pass and 10 fail', () => {
    expect(EXAMPLES).toHaveLength(20);
    expect(EXAMPLES.filter((e) => e.expected === 'pass')).toHaveLength(10);
  });

  for (const example of EXAMPLES) {
    it(`${example.expected === 'pass' ? 'passes' : 'fails'}: ${example.name}`, () => {
      expect(l112Verdict(example.buyer, example.agent)).toBe(example.expected);
    });
  }
});
