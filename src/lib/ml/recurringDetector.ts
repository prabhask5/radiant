/**
 * @fileoverview Recurring transaction detection algorithm.
 *
 * Analyzes transaction history to identify recurring charges (subscriptions,
 * rent, utilities, etc.) based on merchant name similarity, exact payment
 * interval matching, and amount consistency.
 *
 * Algorithm:
 * 1. Filter to charges only (no credits/deposits)
 * 2. Group transactions by normalized merchant name
 * 3. Split each merchant group into billing-cycle sub-groups using temporal
 *    alignment (handles multiple subscriptions from the same merchant, e.g.
 *    two Patreon tiers billing on different days, separate Apple subs)
 * 4. For each sub-group with 3+ transactions, check that EVERY interval
 *    between successive transactions matches a known frequency within a
 *    strict tolerance (no statistical averaging — exact match required)
 * 5. Return detections sorted by confidence descending
 */

// =============================================================================
//                              IMPORTS
// =============================================================================

import { debug } from 'stellar-drive/utils';
import type { Transaction } from '$lib/types';
import type { RecurringFrequency, AccountType } from '$lib/types';

// =============================================================================
//                              TYPES
// =============================================================================

/**
 * A detected recurring transaction pattern from ML analysis.
 *
 * @property merchantPattern - Normalized merchant name used for matching
 * @property name - Original merchant name from the most recent transaction
 * @property amount - Most recent amount (absolute value, decimal string)
 * @property frequency - Detected recurrence interval
 * @property confidence - Detection confidence score, 0–1
 * @property transactionIds - IDs of all matched transactions in the group
 * @property lastDate - ISO date string of the most recent transaction
 * @property categoryId - Most common category_id across the group, or null
 * @property accountId - Account ID from the most recent transaction
 */
export interface DetectedRecurring {
  merchantPattern: string;
  name: string;
  amount: string;
  frequency: RecurringFrequency;
  confidence: number;
  transactionIds: string[];
  lastDate: string;
  categoryId: string | null;
  accountId: string;
}

// =============================================================================
//                          HELPER FUNCTIONS
// =============================================================================

/**
 * Normalize a merchant name for grouping.
 *
 * Handles payment processor prefixes, unique transaction IDs, phone numbers,
 * trailing state abbreviations, and noise characters so that merchant
 * variations resolve to the same key.
 *
 * @param name - Raw merchant / counterparty name
 * @returns Normalized merchant key
 *
 * @example
 * ```ts
 * normalizeMerchant('PAYPAL *NETFLIX.COM');                              // => 'netflix'
 * normalizeMerchant('AMAZON PRIME*VY7FF9KK3 Amzn.com/bill');            // => 'amazon prime'
 * normalizeMerchant('GOOGLE *YouTubePremium g.co/helppay#CAP1IVEZHI');  // => 'youtubepremium'
 * normalizeMerchant('OPENAI *CHATGPT SUBSCR 415... CA');                // => 'openai chatgpt subscr'
 * ```
 */
export function normalizeMerchant(name: string): string {
  let s = name.toLowerCase();

  // Strip reference/confirmation codes after # (e.g., "g.co/helppay#CAP1IVEZHI")
  s = s.replace(/#\S*/g, '');

  // Strip URL-like patterns: domain/path billing references
  // (e.g., "amzn.com/billWA6...", "g.co/helppay", "amzn.co.uk/pm")
  s = s.replace(/\b\S+\.\S+\/\S*/g, '');

  // Strip transaction ID suffixes: word*ID (no space before *)
  // e.g., "AMAZON PRIME*VY7FF9KK3" → "AMAZON PRIME"
  s = s.replace(/([a-z])\*[a-z0-9]+/gi, '$1');

  // Replace remaining * (separators like "PAYPAL *NETFLIX") with space
  s = s.replace(/\*/g, ' ');

  // Strip common payment processor prefixes
  s = s.replace(/^(paypal|sq|tst|dd|google|apple pay|vesta)\s+/i, '');

  // Strip phone numbers (10+ digit sequences or formatted)
  s = s.replace(/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/g, '');
  s = s.replace(/\b\d{7,}\b/g, '');

  // Strip remaining digits
  s = s.replace(/[0-9]/g, '');

  // Strip non-alpha except spaces
  s = s.replace(/[^a-z\s]/g, '');

  // Collapse whitespace and trim
  s = s.replace(/\s+/g, ' ').trim();

  // Strip common domain/corporate suffixes
  s = s.replace(/\b(com|net|org|inc|llc|ltd|co)\b/g, '');

  // Strip trailing 2-letter state abbreviations (e.g., " CA", " WA")
  s = s.replace(/\s+[a-z]{2}$/, '');

  // Final cleanup
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

/**
 * Compute the coefficient of variation (CV) for a set of values.
 *
 * CV = standard deviation / mean. A lower CV indicates more consistency.
 * Returns 0 if the mean is 0 to avoid division by zero.
 *
 * @param values - Numeric values to analyze (must have length >= 1)
 * @returns Coefficient of variation (0 = perfectly consistent)
 */
function computeCV(values: number[]): number {
  if (values.length === 0) return 0;

  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (mean === 0) return 0;

  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);

  return stddev / mean;
}

/**
 * Known recurring frequencies with their expected period and strict tolerance.
 *
 * Each interval between successive transactions must fall within ±tolerance
 * of the expected period (or a small multiple for skipped billing cycles).
 */
const FREQUENCY_SPECS: Array<{
  name: RecurringFrequency;
  period: number;
  tolerance: number;
}> = [
  { name: 'weekly', period: 7, tolerance: 2 },
  { name: 'biweekly', period: 14, tolerance: 3 },
  { name: 'monthly', period: 30, tolerance: 5 },
  { name: 'quarterly', period: 90, tolerance: 10 },
  { name: 'yearly', period: 365, tolerance: 15 }
];

/**
 * Check whether EVERY interval in a group matches a given frequency.
 *
 * Each interval must be within a strict tolerance of N × period (N ≥ 1).
 * Tolerance scales with √N so that skipped billing cycles (e.g. a 2-month
 * gap for a monthly subscription) are slightly more forgiving than a
 * single-period gap — accumulated billing jitter is expected.
 *
 * @returns `{ matches, maxDeviation }` — maxDeviation is the worst-case
 *   deviation across all intervals (lower = tighter fit).
 */
function allIntervalsMatch(
  intervals: number[],
  period: number,
  baseTolerance: number
): { matches: boolean; maxDeviation: number } {
  let maxDev = 0;
  for (const interval of intervals) {
    const n = Math.round(interval / period);
    if (n < 1) return { matches: false, maxDeviation: Infinity };
    const expected = n * period;
    // Scale tolerance with √N: 1 period = base, 2 periods = base×1.41, 3 = base×1.73
    const tolerance = baseTolerance * Math.sqrt(n);
    const dev = Math.abs(interval - expected);
    if (dev > tolerance) return { matches: false, maxDeviation: Infinity };
    maxDev = Math.max(maxDev, dev);
  }
  return { matches: true, maxDeviation: maxDev };
}

/**
 * Return the most frequently occurring item in an array.
 *
 * Ties are broken by first occurrence. Returns the first element if all
 * items are equally frequent.
 */
function mostCommon<T>(items: T[]): T {
  const counts = new Map<T, number>();

  for (const item of items) {
    counts.set(item, (counts.get(item) ?? 0) + 1);
  }

  let best = items[0];
  let bestCount = 0;

  for (const [item, count] of counts) {
    if (count > bestCount) {
      best = item;
      bestCount = count;
    }
  }

  return best;
}

/**
 * Generic parent-company / payment-processor counterparty names.
 *
 * When a transaction's `counterparty_name` matches one of these, the
 * description is used instead, since it contains the actual service name
 * (e.g. "GOOGLE *YouTubePremium" instead of just "GOOGLE").
 */
const GENERIC_COUNTERPARTIES = new Set([
  'google',
  'amazon',
  'apple',
  'paypal',
  'square',
  'stripe',
  'venmo',
  'meta',
  'microsoft'
]);

/**
 * Pick the best name for grouping/matching a transaction.
 *
 * Uses `counterparty_name` when it's specific enough, but falls back to
 * `description` when counterparty is a generic parent company (GOOGLE,
 * AMAZON, APPLE, etc.) whose description contains the actual service.
 *
 * @param txn - Transaction to extract the name from
 * @returns The merchant name to normalize, or null if neither field is set
 */
export function getTransactionMerchantName(txn: {
  counterparty_name?: string | null;
  description: string;
}): string | null {
  const rawCounterparty = txn.counterparty_name?.trim();
  if (rawCounterparty && !GENERIC_COUNTERPARTIES.has(rawCounterparty.toLowerCase())) {
    return rawCounterparty;
  }
  return txn.description || null;
}

/** Milliseconds per day. */
const MS_PER_DAY = 86_400_000;

/** Candidate subscription frequencies in days. */
const KNOWN_FREQUENCIES = [7, 14, 30, 90, 365];

/**
 * Check whether an observed interval matches a target frequency.
 *
 * Allows the interval to be a small multiple of the frequency (skipped
 * months) and scales tolerance with `√multiples` so a 2-month gap is
 * slightly more lenient than a single-period gap.
 *
 * @returns `{ fits, deviation }` — deviation is in *days* (lower = better).
 */
function matchesFrequency(daysSince: number, freq: number): { fits: boolean; deviation: number } {
  const multiples = Math.round(daysSince / freq);
  if (multiples < 1) return { fits: false, deviation: Infinity };

  const expected = multiples * freq;
  const tolerance = Math.min(5, freq * 0.2) * Math.sqrt(multiples);
  const deviation = Math.abs(daysSince - expected);

  return { fits: deviation <= tolerance, deviation };
}

/**
 * Split a merchant group into billing-cycle sub-groups.
 *
 * Handles cases where the same merchant covers multiple subscriptions
 * billed on different schedules (e.g. $5 Patreon on the 10th and $15
 * Patreon on the 4th, or separate Apple subscriptions).
 *
 * **Primary signal**: temporal alignment — each transaction is assigned to
 * the cycle whose established frequency it best matches (closest deviation
 * in days). Established cycles (2+ transactions) are strongly preferred
 * over nascent ones.
 *
 * **Secondary signal**: amount similarity — used as a tiebreaker when
 * temporal fit is comparable, and as a hard cap (>50% difference) to
 * prevent wildly different price tiers from merging.
 */
function splitByCycle(group: Transaction[]): Transaction[][] {
  // With ≤ 2 transactions there's nothing meaningful to split.
  if (group.length <= 2) return [group];

  const sorted = [...group].sort((a, b) => a.date.localeCompare(b.date));

  interface Cycle {
    txns: Transaction[];
    lastDate: number;
    frequency: number | null; // null until 2+ transactions establish it
    avgAmount: number;
  }

  const cycles: Cycle[] = [];

  for (const txn of sorted) {
    const txnDate = new Date(txn.date).getTime();
    const txnAmount = Math.abs(parseFloat(txn.amount));

    let bestCycle = -1;
    let bestScore = Infinity;

    for (let c = 0; c < cycles.length; c++) {
      const daysSince = (txnDate - cycles[c].lastDate) / MS_PER_DAY;
      if (daysSince < 3) continue; // skip near-duplicates

      // ── Amount hard cap: reject if amounts differ by > 50% ──────────
      const amountDev =
        cycles[c].avgAmount > 0
          ? Math.abs(txnAmount - cycles[c].avgAmount) / cycles[c].avgAmount
          : 0;
      if (amountDev > 0.5) continue;

      // ── Temporal fit ────────────────────────────────────────────────
      let temporalFit = false;
      let temporalDev = Infinity;

      if (cycles[c].frequency !== null) {
        // Established cycle — check against its frequency
        const result = matchesFrequency(daysSince, cycles[c].frequency!);
        temporalFit = result.fits;
        temporalDev = result.deviation;
      } else {
        // Nascent cycle (1 txn) — try all known frequencies
        for (const freq of KNOWN_FREQUENCIES) {
          const result = matchesFrequency(daysSince, freq);
          if (result.fits && result.deviation < temporalDev) {
            temporalDev = result.deviation;
            temporalFit = true;
          }
        }
      }

      if (!temporalFit) continue;

      // Combined score: temporal (primary) + amount (soft tiebreaker).
      // Nascent cycles get a +5-day penalty so established cycles win ties.
      const nascentPenalty = cycles[c].frequency === null ? 5 : 0;
      const score = temporalDev + amountDev * 2 + nascentPenalty;

      if (score < bestScore) {
        bestScore = score;
        bestCycle = c;
      }
    }

    if (bestCycle >= 0) {
      const cycle = cycles[bestCycle];
      if (cycle.frequency === null) {
        cycle.frequency = (txnDate - cycle.lastDate) / MS_PER_DAY;
      }
      cycle.txns.push(txn);
      cycle.lastDate = txnDate;
      cycle.avgAmount =
        cycle.txns.reduce((s, t) => s + Math.abs(parseFloat(t.amount)), 0) / cycle.txns.length;
    } else {
      // Start a new cycle
      cycles.push({
        txns: [txn],
        lastDate: txnDate,
        frequency: null,
        avgAmount: txnAmount
      });
    }
  }

  // Only return sub-groups with 2+ transactions; fall back to the
  // original group if temporal splitting found nothing useful.
  const result = cycles.filter((c) => c.txns.length >= 2).map((c) => c.txns);
  return result.length > 0 ? result : [group];
}

// =============================================================================
//                        DETECTION ALGORITHM
// =============================================================================

/**
 * Detect recurring transactions from a list of transaction records.
 *
 * Filters to charges only (no credits/deposits), groups by normalized
 * merchant name, then evaluates each group (2+ transactions required) for
 * interval periodicity and amount consistency. Applies a sample-size
 * penalty so 2-transaction groups need stronger signal.
 *
 * @param transactions - Full list of transactions to analyze
 * @param accountTypes - Optional map of account_id → AccountType, used to
 *   correctly identify charges across depository (negative = charge) and
 *   credit (positive = charge) accounts. Without this, falls back to
 *   positive-amount heuristic.
 * @returns Array of detected recurring patterns, sorted by confidence descending
 */
export function detectRecurringTransactions(
  transactions: Transaction[],
  accountTypes?: Map<string, AccountType>
): DetectedRecurring[] {
  debug('log', '[ML:RECURRING] Starting detection on', transactions.length, 'transactions');

  // ── Step 1: Filter to charges only (no credits/deposits) ───────────────
  // Depository accounts: negative amount = withdrawal (charge)
  // Credit card accounts: positive amount = purchase (charge)

  const charges = transactions.filter((t) => {
    if (t.deleted || t.is_excluded) return false;
    const amount = parseFloat(t.amount);
    const acctType = accountTypes?.get(t.account_id);
    if (acctType === 'depository') return amount < 0;
    if (acctType === 'credit') return amount > 0;
    return amount > 0; // fallback without account info
  });

  debug('log', '[ML:RECURRING] Filtered to', charges.length, 'charge transactions');

  // ── Step 2: Group by normalized merchant name ──────────────────────────

  const groups = new Map<string, Transaction[]>();

  for (const txn of charges) {
    const name = getTransactionMerchantName(txn);
    if (!name) continue;

    const key = normalizeMerchant(name);
    if (!key) continue;

    const group = groups.get(key);
    if (group) {
      group.push(txn);
    } else {
      groups.set(key, [txn]);
    }
  }

  debug('log', '[ML:RECURRING] Formed', groups.size, 'merchant groups');

  // ── Step 3: Evaluate each group (with amount sub-grouping) ───────────

  const detections: DetectedRecurring[] = [];

  for (const [pattern, group] of groups) {
    if (group.length < 2) continue;

    // Split into billing-cycle sub-groups (temporal alignment + amount tiebreaker)
    const subGroups = splitByCycle(group);

    for (const subGroup of subGroups) {
      if (subGroup.length < 2) continue;

      // Sort by date ascending
      subGroup.sort((a, b) => a.date.localeCompare(b.date));

      // Compute inter-transaction intervals in days
      const intervals: number[] = [];
      for (let i = 1; i < subGroup.length; i++) {
        const prev = new Date(subGroup[i - 1].date).getTime();
        const curr = new Date(subGroup[i].date).getTime();
        const days = (curr - prev) / (1000 * 60 * 60 * 24);
        intervals.push(days);
      }

      // Require 3+ transactions to avoid false positives from coincidental timing
      if (subGroup.length < 3) continue;

      // ── Exact interval matching ───────────────────────────────────────
      // Try each known frequency: EVERY interval must be within the strict
      // tolerance of N × period (where N ≥ 1). Pick the best-fitting frequency.
      let bestFrequency: RecurringFrequency | null = null;
      let bestMaxDev = Infinity;

      for (const spec of FREQUENCY_SPECS) {
        const result = allIntervalsMatch(intervals, spec.period, spec.tolerance);
        if (result.matches && result.maxDeviation < bestMaxDev) {
          bestFrequency = spec.name;
          bestMaxDev = result.maxDeviation;
        }
      }
      if (!bestFrequency) continue;

      const frequency = bestFrequency;
      const expectedPeriodDays = FREQUENCY_SPECS.find((s) => s.name === frequency)!.period;

      // Recency check: last transaction must be within 2.5× the expected period
      // (stale patterns with no recent activity are not truly "recurring")
      const lastTxnDate = new Date(subGroup[subGroup.length - 1].date).getTime();
      const daysSinceLast = (Date.now() - lastTxnDate) / MS_PER_DAY;
      if (daysSinceLast > expectedPeriodDays * 2.5) continue;

      // Check amount consistency: CV of absolute amounts must be < 0.25
      const amounts = subGroup.map((t) => Math.abs(parseFloat(t.amount)));
      const amountCV = computeCV(amounts);
      if (amountCV >= 0.25) continue;

      // ── Confidence: based on interval tightness + amount consistency + sample size ──
      const tolerance = FREQUENCY_SPECS.find((s) => s.name === frequency)!.tolerance;
      const intervalTightness = 1 - bestMaxDev / tolerance; // 1.0 = perfect, 0.0 = at tolerance edge
      const amountTightness = 1 - amountCV / 0.25;
      const rawConfidence = intervalTightness * 0.5 + amountTightness * 0.5;
      const samplePenalty = Math.min(1, 0.4 + subGroup.length * 0.15);
      const confidence = rawConfidence * samplePenalty;
      if (confidence <= 0.3) continue;

      // Use the most recent transaction for display values
      const mostRecent = subGroup[subGroup.length - 1];
      const categoryIds = subGroup.map((t) => t.category_id);

      // Append billing-day and rounded amount to pattern when merchant has
      // multiple cycles, so each subscription gets a unique key
      // (e.g. "patreon:d4a15", "patreon:d10a5")
      const anchorDay = new Date(mostRecent.date + 'T00:00:00').getDate();
      const meanAmount = amounts.reduce((s, v) => s + v, 0) / amounts.length;
      const subPattern =
        subGroups.length > 1 ? `${pattern}:d${anchorDay}a${Math.round(meanAmount)}` : pattern;

      detections.push({
        merchantPattern: subPattern,
        name: getTransactionMerchantName(mostRecent) ?? mostRecent.description,
        amount: Math.abs(parseFloat(mostRecent.amount)).toFixed(2),
        frequency,
        confidence: Math.round(confidence * 1000) / 1000,
        transactionIds: subGroup.map((t) => t.id),
        lastDate: mostRecent.date,
        categoryId: mostCommon(categoryIds),
        accountId: mostRecent.account_id
      });
    }
  }

  // Sort by confidence descending
  detections.sort((a, b) => b.confidence - a.confidence);

  debug('log', '[ML:RECURRING] Detection complete:', detections.length, 'recurring patterns found');

  return detections;
}
