/**
 * @fileoverview Rule-based transaction categorization (Layer 1).
 *
 * Instant, zero-overhead categorization using two strategies:
 * 1. Teller category mapping — if the transaction has a teller_category field,
 *    match it to a default category via the teller_categories array.
 * 2. Keyword dictionary — 200+ merchant name keywords mapped to category keys
 *    via case-insensitive substring matching.
 *
 * Handles ~70% of transactions with zero latency.
 */

import { TELLER_TO_CATEGORY } from '$lib/categories';
import { debug } from 'stellar-drive/utils';

// =============================================================================
//                          TYPES
// =============================================================================

/** Result of a successful rule-based categorization. */
export interface RuleLookupResult {
  categoryKey: string;
  confidence: number;
}

// =============================================================================
//                     KEYWORD → CATEGORY MAP
// =============================================================================

/**
 * Map of lowercase merchant keywords to category keys.
 * A match occurs when any keyword is found as a substring of the
 * lowercased transaction description.
 */
const KEYWORD_MAP: [string, string][] = [
  // ── Groceries ──────────────────────────────────────────────────────────
  ['walmart', 'groceries'],
  ['kroger', 'groceries'],
  ['safeway', 'groceries'],
  ['whole foods', 'groceries'],
  ['trader joe', 'groceries'],
  ['costco', 'groceries'],
  ['aldi', 'groceries'],
  ['publix', 'groceries'],
  ['heb', 'groceries'],
  ['wegmans', 'groceries'],
  ['piggly wiggly', 'groceries'],
  ['food lion', 'groceries'],
  ['stop and shop', 'groceries'],
  ['stop & shop', 'groceries'],
  ['giant', 'groceries'],
  ['meijer', 'groceries'],
  ['sprouts', 'groceries'],
  ['albertsons', 'groceries'],
  ['grocery outlet', 'groceries'],
  ['food depot', 'groceries'],
  ['winco', 'groceries'],
  ['food 4 less', 'groceries'],
  ['save-a-lot', 'groceries'],
  ['shoprite', 'groceries'],

  // ── Coffee ─────────────────────────────────────────────────────────────
  ['starbucks', 'coffee'],
  ['dunkin', 'coffee'],
  ['peet', 'coffee'],
  ['dutch bros', 'coffee'],
  ['tim horton', 'coffee'],
  ['blue bottle', 'coffee'],
  ['philz', 'coffee'],
  ['caribou coffee', 'coffee'],

  // ── Fast Food ──────────────────────────────────────────────────────────
  ['mcdonald', 'fast-food'],
  ['burger king', 'fast-food'],
  ['wendy', 'fast-food'],
  ['taco bell', 'fast-food'],
  ['chick-fil-a', 'fast-food'],
  ['popeyes', 'fast-food'],
  ['subway', 'fast-food'],
  ['five guys', 'fast-food'],
  ['in-n-out', 'fast-food'],
  ['chipotle', 'fast-food'],
  ['panda express', 'fast-food'],
  ['jack in the box', 'fast-food'],
  ['sonic drive', 'fast-food'],
  ['arby', 'fast-food'],
  ['dairy queen', 'fast-food'],
  ['whataburger', 'fast-food'],
  ['wingstop', 'fast-food'],
  ['domino', 'fast-food'],
  ['pizza hut', 'fast-food'],
  ['papa john', 'fast-food'],
  ['little caesars', 'fast-food'],
  ['jersey mike', 'fast-food'],
  ['jimmy john', 'fast-food'],
  ['firehouse sub', 'fast-food'],

  // ── Dining ─────────────────────────────────────────────────────────────
  ['cheesecake factory', 'dining'],
  ['olive garden', 'dining'],
  ['applebee', 'dining'],
  ['chili', 'dining'],
  ['ihop', 'dining'],
  ['denny', 'dining'],
  ['waffle house', 'dining'],
  ['panera', 'dining'],
  ['sweetgreen', 'dining'],
  ['shake shack', 'dining'],
  ['noodles', 'dining'],
  ['outback', 'dining'],
  ['red lobster', 'dining'],
  ['cracker barrel', 'dining'],
  ['texas roadhouse', 'dining'],
  ['buffalo wild wings', 'dining'],
  ['red robin', 'dining'],

  // ── Gas/Fuel ───────────────────────────────────────────────────────────
  ['shell oil', 'gas-fuel'],
  ['shell ', 'gas-fuel'],
  ['chevron', 'gas-fuel'],
  ['exxon', 'gas-fuel'],
  ['bp ', 'gas-fuel'],
  ['mobil', 'gas-fuel'],
  ['arco', 'gas-fuel'],
  ['valero', 'gas-fuel'],
  ['sunoco', 'gas-fuel'],
  ['marathon', 'gas-fuel'],
  ['phillips 66', 'gas-fuel'],
  ['speedway', 'gas-fuel'],
  ['wawa', 'gas-fuel'],
  ['sheetz', 'gas-fuel'],
  ['circle k', 'gas-fuel'],
  ['pilot', 'gas-fuel'],
  ['racetrac', 'gas-fuel'],
  ['quiktrip', 'gas-fuel'],
  ['casey', 'gas-fuel'],
  ['7-eleven', 'gas-fuel'],

  // ── Rideshare ──────────────────────────────────────────────────────────
  ['uber', 'rideshare'],
  ['lyft', 'rideshare'],

  // ── Public Transit ─────────────────────────────────────────────────────
  ['metro', 'public-transit'],
  ['mta', 'public-transit'],
  ['bart', 'public-transit'],
  ['caltrain', 'public-transit'],
  ['amtrak', 'public-transit'],

  // ── Streaming ──────────────────────────────────────────────────────────
  ['netflix', 'streaming'],
  ['hulu', 'streaming'],
  ['disney+', 'streaming'],
  ['disney plus', 'streaming'],
  ['hbo max', 'streaming'],
  ['hbo ', 'streaming'],
  ['paramount+', 'streaming'],
  ['paramount plus', 'streaming'],
  ['peacock', 'streaming'],
  ['apple tv', 'streaming'],
  ['youtube premium', 'streaming'],
  ['crunchyroll', 'streaming'],
  ['amazon prime video', 'streaming'],
  ['openai', 'streaming'],
  ['chatgpt', 'streaming'],

  // ── Music ──────────────────────────────────────────────────────────────
  ['spotify', 'music'],
  ['apple music', 'music'],
  ['tidal', 'music'],
  ['pandora', 'music'],
  ['youtube music', 'music'],
  ['soundcloud', 'music'],

  // ── Gaming ─────────────────────────────────────────────────────────────
  ['steam', 'gaming'],
  ['playstation', 'gaming'],
  ['xbox', 'gaming'],
  ['nintendo', 'gaming'],
  ['epic games', 'gaming'],
  ['roblox', 'gaming'],

  // ── Shopping ───────────────────────────────────────────────────────────
  ['amazon', 'shopping'],
  ['target', 'shopping'],
  ['best buy', 'shopping'],
  ['home depot', 'shopping'],
  ['lowes', 'shopping'],
  ["lowe's", 'shopping'],
  ['ikea', 'shopping'],
  ['wayfair', 'shopping'],
  ['etsy', 'shopping'],
  ['ebay', 'shopping'],
  ['nordstrom', 'shopping'],
  ['macys', 'shopping'],
  ["macy's", 'shopping'],
  ['tj maxx', 'shopping'],
  ['ross', 'shopping'],
  ['marshalls', 'shopping'],
  ['old navy', 'shopping'],
  ['gap ', 'shopping'],
  ['h&m', 'shopping'],
  ['zara', 'shopping'],
  ['sephora', 'shopping'],
  ['ulta', 'shopping'],
  ['bath & body', 'shopping'],
  ['bed bath', 'shopping'],
  ['dollar tree', 'shopping'],
  ['dollar general', 'shopping'],
  ['five below', 'shopping'],
  ['michaels', 'shopping'],
  ['hobby lobby', 'shopping'],

  // ── Electronics ────────────────────────────────────────────────────────
  ['apple store', 'electronics'],
  ['microsoft', 'electronics'],
  ['newegg', 'electronics'],
  ['b&h photo', 'electronics'],

  // ── Entertainment ──────────────────────────────────────────────────────
  ['amc theatre', 'entertainment'],
  ['amc theater', 'entertainment'],
  ['regal cinema', 'entertainment'],
  ['cinemark', 'entertainment'],
  ['ticketmaster', 'entertainment'],
  ['stubhub', 'entertainment'],
  ['fandango', 'entertainment'],
  ['dave & buster', 'entertainment'],
  ['topgolf', 'entertainment'],
  ['bowlero', 'entertainment'],

  // ── Gym/Fitness ────────────────────────────────────────────────────────
  ['planet fitness', 'gym-fitness'],
  ['equinox', 'gym-fitness'],
  ['la fitness', 'gym-fitness'],
  ['24 hour fitness', 'gym-fitness'],
  ['anytime fitness', 'gym-fitness'],
  ['orangetheory', 'gym-fitness'],
  ['crossfit', 'gym-fitness'],
  ['peloton', 'gym-fitness'],
  ['gold gym', 'gym-fitness'],
  ['ymca', 'gym-fitness'],

  // ── Rent ───────────────────────────────────────────────────────────────
  ['rent payment', 'rent'],
  ['avalon', 'rent'],
  ['equity residential', 'rent'],
  ['greystar', 'rent'],
  ['camden', 'rent'],
  ['essex', 'rent'],

  // ── Utilities ──────────────────────────────────────────────────────────
  ['pg&e', 'utilities'],
  ['con edison', 'utilities'],
  ['duke energy', 'utilities'],
  ['southern company', 'utilities'],
  ['xcel', 'utilities'],
  ['at&t', 'utilities'],
  ['verizon', 'utilities'],
  ['t-mobile', 'utilities'],
  ['comcast', 'utilities'],
  ['xfinity', 'utilities'],
  ['spectrum', 'utilities'],
  ['cox comm', 'utilities'],
  ['centurylink', 'utilities'],

  // ── Health/Pharmacy ────────────────────────────────────────────────────
  ['kaiser', 'health-insurance'],
  ['aetna', 'health-insurance'],
  ['cigna', 'health-insurance'],
  ['united health', 'health-insurance'],
  ['blue cross', 'health-insurance'],
  ['cvs pharmacy', 'pharmacy'],
  ['cvs', 'pharmacy'],
  ['walgreens', 'pharmacy'],
  ['rite aid', 'pharmacy'],

  // ── Insurance ──────────────────────────────────────────────────────────
  ['geico', 'car-insurance'],
  ['state farm', 'car-insurance'],
  ['progressive', 'car-insurance'],
  ['allstate', 'car-insurance'],
  ['usaa', 'car-insurance'],
  ['liberty mutual', 'car-insurance'],
  ['farmers insurance', 'car-insurance'],

  // ── Travel ─────────────────────────────────────────────────────────────
  ['airbnb', 'travel'],
  ['booking.com', 'travel'],
  ['expedia', 'travel'],
  ['hotels.com', 'travel'],
  ['marriott', 'travel'],
  ['hilton', 'travel'],
  ['hyatt', 'travel'],
  ['southwest', 'travel'],
  ['delta air', 'travel'],
  ['american airlines', 'travel'],
  ['united airlines', 'travel'],
  ['jetblue', 'travel'],
  ['frontier airlines', 'travel'],
  ['spirit airlines', 'travel'],

  // ── Pet Care ───────────────────────────────────────────────────────────
  ['petco', 'pet-care'],
  ['petsmart', 'pet-care'],
  ['chewy', 'pet-care'],

  // ── Childcare ──────────────────────────────────────────────────────────
  ['kindercare', 'childcare'],
  ['bright horizons', 'childcare'],

  // ── Charity ────────────────────────────────────────────────────────────
  ['united way', 'charity'],
  ['red cross', 'charity'],
  ['salvation army', 'charity'],
  ['gofundme', 'charity'],

  // ── Books/Education ────────────────────────────────────────────────────
  ['udemy', 'books-education'],
  ['coursera', 'books-education'],
  ['kindle', 'books-education'],
  ['audible', 'books-education'],
  ['barnes & noble', 'books-education'],

  // ── Personal Care ──────────────────────────────────────────────────────
  ['great clips', 'personal-care'],
  ['supercuts', 'personal-care'],
  ['sport clips', 'personal-care'],
  ['drybar', 'personal-care'],

  // ── Transfers ──────────────────────────────────────────────────────────
  ['venmo', 'transfer'],
  ['zelle', 'transfer'],
  ['paypal', 'transfer'],
  ['cash app', 'transfer'],

  // ── Credit Card Payments ───────────────────────────────────────────────
  ['payment thank you', 'credit-card-payment'],
  ['online payment', 'credit-card-payment'],
  ['autopay', 'credit-card-payment'],
  ['payment received', 'credit-card-payment']
];

// =============================================================================
//                          LOOKUP FUNCTION
// =============================================================================

/**
 * Attempt to categorize a transaction via rules.
 *
 * Tries Teller category mapping first (confidence 1.0), then falls back to
 * keyword substring matching (confidence 0.9).
 *
 * @param description - The transaction description / merchant name
 * @param tellerCategory - Optional Teller API category label
 * @returns Categorization result, or `null` if no rule matched
 *
 * @example
 * ```ts
 * ruleLookup('WHOLE FOODS MARKET #10432');
 * // → { categoryKey: 'groceries', confidence: 0.9 }
 *
 * ruleLookup('Some merchant', 'dining');
 * // → { categoryKey: 'dining', confidence: 1.0 }
 * ```
 */
export function ruleLookup(description: string, tellerCategory?: string): RuleLookupResult | null {
  // Layer 1a: Teller category mapping
  if (tellerCategory) {
    const key = TELLER_TO_CATEGORY.get(tellerCategory);
    if (key) {
      debug('log', '[ML:CATEGORIZE] Rule match via Teller category', { tellerCategory, key });
      return { categoryKey: key, confidence: 1.0 };
    }
  }

  // Layer 1b: Keyword substring matching
  const lower = description.toLowerCase();
  for (const [keyword, categoryKey] of KEYWORD_MAP) {
    if (lower.includes(keyword)) {
      debug('log', '[ML:CATEGORIZE] Rule match via keyword', { keyword, categoryKey });
      return { categoryKey, confidence: 0.9 };
    }
  }

  return null;
}
