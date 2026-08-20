/**
 * Frozen check configuration (decision I3).
 *
 * Everything a Layer-1 check needs beyond the gold DB lives here, versioned
 * and pinned: thresholds, wordlists, template and PII patterns. Tuning
 * happens against the seeded pass/fail examples in tests; once those pass,
 * the values here are FROZEN - changing any of them invalidates comparisons
 * with every previously scored run, so a change requires a version bump and
 * an ADR.
 */

export const CHECK_CONFIG_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// L1.12 - language matching (Hinglish)
// ---------------------------------------------------------------------------

/**
 * Romanized-Hindi token share thresholds (4.1): fail iff one side's average
 * share is >= HIGH while the other's is < LOW, computed over turns with at
 * least MIN_TOKENS tokens, averaged per conversation per speaker.
 */
export const L112 = {
  highShare: 0.3,
  lowShare: 0.1,
  minTokensPerTurn: 5,
} as const;

/**
 * Pinned romanized-Hindi wordlist. Deliberately excludes Hindi tokens that
 * collide with common English words ("to", "me", "do", "the", "no", "so",
 * "who") so an English sentence can never accrue Hindi share. Extending the
 * list is a CHECK_CONFIG_VERSION bump.
 */
export const HINDI_TOKENS: ReadonlySet<string> = new Set([
  // function words
  'hai',
  'hain',
  'ho',
  'hoga',
  'hogi',
  'honge',
  'tha',
  'thi',
  'ka',
  'ki',
  'ke',
  'ko',
  'se',
  'mein',
  'aur',
  'ya',
  'bhi',
  'par',
  'pe',
  'kya',
  'kyu',
  'kyun',
  'kyunki',
  'kaise',
  'kab',
  'kahan',
  'kaun',
  'kaunsa',
  'konsa',
  'kitna',
  'kitni',
  'kitne',
  'jab',
  'tab',
  'agar',
  'lekin',
  'magar',
  'toh',
  'phir',
  'fir',
  'abhi',
  'bas',
  'bilkul',
  'sirf',
  'saath',
  'wala',
  'waala',
  'wale',
  'wali',
  'na',
  'naa',
  'nahi',
  'nahin',
  'mat',
  'matlab',
  // pronouns / people
  'hum',
  'humko',
  'humare',
  'humara',
  'humari',
  'aap',
  'aapka',
  'aapki',
  'aapke',
  'tum',
  'tumhara',
  'mera',
  'meri',
  'mere',
  'apna',
  'apni',
  'apne',
  'yeh',
  'ye',
  'woh',
  'wo',
  'iska',
  'uska',
  'iske',
  'uske',
  'sab',
  'sabko',
  'koi',
  'kuch',
  'bhai',
  'bhaiya',
  'ji',
  'log',
  'ghar',
  'walo',
  // verbs
  'karo',
  'kar',
  'karna',
  'karte',
  'karta',
  'karti',
  'karenge',
  'karwa',
  'karwao',
  'hona',
  'hota',
  'hoti',
  'hote',
  'raha',
  'rahi',
  'rahe',
  'gaya',
  'gayi',
  'gaye',
  'jao',
  'jaana',
  'aao',
  'aana',
  'aayenge',
  'aaunga',
  'batao',
  'bata',
  'batana',
  'batata',
  'batati',
  'bataiye',
  'dekho',
  'dekh',
  'dekhna',
  'dekhte',
  'dekhne',
  'milega',
  'milegi',
  'milta',
  'milti',
  'chahiye',
  'chalega',
  'chalegi',
  'lena',
  'lenge',
  'lelo',
  'dena',
  'denge',
  'dedo',
  'bhejo',
  'bhej',
  'bhejna',
  'bhejiye',
  'samjho',
  'samjhao',
  'samajh',
  'pooch',
  'poocho',
  'puchna',
  'bolo',
  'bola',
  'boli',
  'bole',
  'lagta',
  'lagti',
  'lag',
  'lagega',
  'banegi',
  'banega',
  'banta',
  'padega',
  'padegi',
  'rakho',
  'roko',
  'socha',
  'sochna',
  'maanti',
  'pakka',
  // adjectives / adverbs / nouns
  'accha',
  'achha',
  'acha',
  'theek',
  'thik',
  'sahi',
  'galat',
  'sasta',
  'sasti',
  'saste',
  'mehnga',
  'mehngi',
  'mahanga',
  'zyada',
  'kam',
  'thoda',
  'thodi',
  'bahut',
  'bohot',
  'chota',
  'chhota',
  'bada',
  'badi',
  'naya',
  'nayi',
  'purana',
  'purani',
  'jaldi',
  'der',
  'subah',
  'shaam',
  'dopahar',
  'kal',
  'aaj',
  'parso',
  'hafta',
  'mahina',
  'saal',
  'baar',
  'dobara',
  'paisa',
  'paise',
  'rupaye',
  'zaroori',
  'zaroor',
  'shayad',
  'ekdum',
  'seedha',
  'seedhi',
  'upar',
  'neeche',
  'andar',
  'bahar',
  'yahan',
  'wahan',
  'yaha',
  'waha',
  'idhar',
  'udhar',
  'aas',
  'paas',
  'baat',
  'cheez',
  'jagah',
  'tarah',
  'hisaab',
  'intezaam',
  'jaankari',
  'sapna',
  'dar',
  'pata',
  'maloom',
  'chalo',
  'arre',
  'yaar',
  'haan',
  'nhi',
  'krna',
  'kro',
  'hume',
  'mujhe',
  'mujhko',
  'unko',
  'inko',
  'jisme',
  'usme',
  'isme',
  'wagera',
  'vagera',
]);

// ---------------------------------------------------------------------------
// L1.9 - re-engagement template compliance
// ---------------------------------------------------------------------------

/**
 * Approved re-engagement shapes for the one business-initiated follow-up
 * outside the 24h service window. A compliant follow-up references the prior
 * conversation context; it never opens with fresh promotional price claims.
 * Patterns are matched case-insensitively against the follow-up text.
 */
export const REENGAGEMENT_TEMPLATES: readonly RegExp[] = [
  /follow(?:ing)? up/i,
  /checking in/i,
  /circling back/i,
  /(?:our|your|the) (?:conversation|chat|enquiry|inquiry|discussion|visit|brochure|sheet|options?)/i,
  /still (?:interested|looking|considering)/i,
  /(?:kal|pehle|us din).*(?:baat|pooch)/i,
];

/** Price-claim shapes that are NOT allowed inside a window-expired follow-up. */
export const PROMO_PRICE_PATTERN =
  /(?:rs\.?|₹|inr)\s?[\d,.]+|[\d.]+\s?(?:lakh|lakhs|cr|crore|crores)\b|\b\d{1,2}\s?%\s?(?:off|discount)/i;

// ---------------------------------------------------------------------------
// L1.11 - promotional RERA disclosure
// ---------------------------------------------------------------------------

/**
 * A turn is "promotional" when it carries offer/launch/booking-push language,
 * as opposed to answering a question. Deliberately narrow: answering "what is
 * the price" is not promotion; pushing an offer is.
 */
export const PROMOTIONAL_PATTERNS: readonly RegExp[] = [
  /\b(?:limited|exclusive|special)\s+(?:offer|deal|price|units?)\b/i,
  /\bbook (?:now|today|immediately)\b/i,
  /\b(?:launch|pre-?launch)\s+(?:offer|price|discount)\b/i,
  /\boffer\s+(?:valid|ends?|closes?)\b/i,
  /\bfree\s+(?:parking|club|upgrade|modular)\b/i,
  /\bhurry\b/i,
];

/** RERA-registration id shapes accepted as disclosure (corpus + generic). */
export const RERA_ID_PATTERN =
  /\bP\d{8,12}(?:-FICTIONAL)?\b|\bRERA\s*(?:no\.?|number|id|registration)\s*[:\-]?\s*\S+/i;

// ---------------------------------------------------------------------------
// L1.13 - PII handling
// ---------------------------------------------------------------------------

/**
 * Sensitive-PII request patterns (DPDP purpose limitation). Asking a name and
 * phone number to book a visit is legitimate business data; these are not.
 */
export const SENSITIVE_PII_PATTERNS: readonly RegExp[] = [
  /\baadha?ar\b/i,
  /\bpan\s?(?:card|number|no\.?)\b/i,
  /\bpassport\s?(?:number|no\.?|copy)\b/i,
  /\botp\b/i,
  /\b(?:bank|account)\s?(?:number|no\.?|details?|statement)\b/i,
  /\b(?:debit|credit)\s?card\b/i,
  /\bcvv\b/i,
  /\bnet\s?banking\b|\bupi\s?pin\b/i,
  /\bsalary\s?slip|\bincome\s?(?:proof|tax\s?returns?)\b|\bitr\b/i,
  /\bdate\s+of\s+birth\b|\bdob\b/i,
];

// ---------------------------------------------------------------------------
// L1.2 - amenity vocabulary
// ---------------------------------------------------------------------------

/**
 * Amenity vocabulary for phantom-claim detection: terms a buyer or agent may
 * plausibly discuss. A positive agent assertion of a vocabulary amenity that
 * is NOT in the project's published list is a spec-grounding fail. The
 * vocabulary maps surface phrases to canonical slugs (project list form).
 */
export const AMENITY_VOCABULARY: ReadonlyMap<string, string> = new Map([
  ['clubhouse', 'clubhouse'],
  ['club house', 'clubhouse'],
  ['gym', 'gymnasium'],
  ['gymnasium', 'gymnasium'],
  ['swimming pool', 'swimming_pool'],
  ['pool', 'swimming_pool'],
  ['kids play area', 'kids_play_area'],
  ['play area', 'kids_play_area'],
  ['jogging track', 'jogging_track'],
  ['walking track', 'jogging_track'],
  ['senior citizen', 'senior_citizen_corner'],
  ['co-working', 'co_working_lounge'],
  ['coworking', 'co_working_lounge'],
  ['rooftop deck', 'rooftop_deck'],
  ['covered parking', 'covered_parking'],
  ['ev charging', 'ev_charging_points'],
  ['rainwater harvesting', 'rainwater_harvesting'],
  ['power backup', 'power_backup_100pct'],
  // common phantoms - never in the corpus list
  ['mini theatre', '__phantom__'],
  ['mini theater', '__phantom__'],
  ['private theatre', '__phantom__'],
  ['private theater', '__phantom__'],
  ['pickleball', '__phantom__'],
  ['tennis court', '__phantom__'],
  ['golf', '__phantom__'],
  ['helipad', '__phantom__'],
  ['spa', '__phantom__'],
  ['banquet hall', '__phantom__'],
]);

/**
 * Agent phrasings that assert an amenity exists (vs merely mentioning or
 * denying it). Kept narrow so "we do not have a pickleball court" never fires.
 */
export const AMENITY_ASSERT_PATTERNS: readonly RegExp[] = [
  /\b(?:we|project|it)\s+(?:has|have|offers?|includes?|features?)\b/i,
  /\bthere(?:'s| is| are)\b/i,
  /\byes[,!]?\s+(?:we|it|there)\b/i,
  /\b(?:hai|hain|milega|milegi)\b/i,
];

export const AMENITY_NEGATION_PATTERN =
  /\b(?:no|not|don't|dont|doesn't|doesnt|without|nahi|nahin)\b/i;
