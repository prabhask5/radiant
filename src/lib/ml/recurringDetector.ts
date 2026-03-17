/**
 * @fileoverview Recurring transaction detection algorithm.
 *
 * Analyzes transaction history to identify recurring charges (subscriptions,
 * rent, utilities, etc.) based on merchant name similarity, payment interval
 * periodicity, and amount consistency.
 *
 * Algorithm:
 * 1. Group transactions by normalized merchant name
 * 2. For each group with 3+ transactions, compute interval periodicity and
 *    amount consistency via coefficient of variation (CV)
 * 3. Return detections above 0.6 confidence threshold
 */

// =============================================================================
//                              IMPORTS
// =============================================================================

import { debug } from 'stellar-drive/utils';
import type { Transaction } from '$lib/types';
import type { RecurringFrequency } from '$lib/types';

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
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'yearly';
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
 * Lowercases, strips digits and special characters, and trims whitespace
 * so that minor variations (e.g. "Netflix #1234" vs "NETFLIX") resolve
 * to the same key.
 *
 * @param name - Raw merchant / counterparty name
 * @returns Normalized merchant key
 *
 * @example
 * ```ts
 * normalizeMerchant('NETFLIX #1234');  // => 'netflix'
 * normalizeMerchant('Spotify USA');    // => 'spotify usa'
 * ```
 */
function normalizeMerchant(name: string): string {
  return name
    .toLowerCase()
    .replace(/[0-9]/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute the coefficient of variation (CV) for a set of values.
 *
 * CV = standard deviation / mean. A lower CV indicates more consistency.
 * Returns 0 if the mean is 0 to avoid division by zero.
 *
 * @param values - Numeric values to analyze (must have length >= 1)
 * @returns Coefficient of variation (0 = perfectly consistent)
 *
 * @example
 * ```ts
 * computeCV([30, 31, 29, 30]);  // => ~0.027
 * computeCV([10, 10, 10]);      // => 0
 * ```
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
 * Map a mean inter-transaction interval (in days) to a recurrence frequency.
 *
 * Uses range-based classification:
 * - 5–9 days → weekly
 * - 11–18 days → biweekly
 * - 25–40 days → monthly
 * - 340–400 days → yearly
 *
 * @param meanInterval - Average number of days between consecutive transactions
 * @returns The classified frequency, or null if no range matches
 *
 * @example
 * ```ts
 * classifyFrequency(7.2);   // => 'weekly'
 * classifyFrequency(30.5);  // => 'monthly'
 * classifyFrequency(100);   // => null
 * ```
 */
function classifyFrequency(meanInterval: number): RecurringFrequency | null {
  if (meanInterval >= 5 && meanInterval <= 9) return 'weekly';
  if (meanInterval >= 11 && meanInterval <= 18) return 'biweekly';
  if (meanInterval >= 25 && meanInterval <= 40) return 'monthly';
  if (meanInterval >= 340 && meanInterval <= 400) return 'yearly';
  return null;
}

/**
 * Return the most frequently occurring item in an array.
 *
 * Ties are broken by first occurrence. Returns the first element if all
 * items are equally frequent.
 *
 * @param items - Non-empty array of items to analyze
 * @returns The most common item
 *
 * @example
 * ```ts
 * mostCommon(['a', 'b', 'a', 'c']);  // => 'a'
 * mostCommon([null, null, 'x']);      // => null
 * ```
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

// =============================================================================
//                        DETECTION ALGORITHM
// =============================================================================

/**
 * Detect recurring transactions from a list of transaction records.
 *
 * Groups transactions by normalized merchant name, then evaluates each group
 * (3+ transactions required) for interval periodicity and amount consistency
 * using coefficient of variation. Returns detections with confidence > 0.6.
 *
 * @param transactions - Full list of transactions to analyze
 * @returns Array of detected recurring patterns, sorted by confidence descending
 *
 * @example
 * ```ts
 * const detections = detectRecurringTransactions(allTransactions);
 * for (const d of detections) {
 *   console.log(`${d.name} — ${d.frequency} — $${d.amount} (${d.confidence})`);
 * }
 * ```
 */
export function detectRecurringTransactions(transactions: Transaction[]): DetectedRecurring[] {
  debug('log', '[ML:RECURRING] Starting detection on', transactions.length, 'transactions');

  // ── Step 1: Group by normalized merchant name ──────────────────────────

  const groups = new Map<string, Transaction[]>();

  for (const txn of transactions) {
    const name = txn.counterparty_name || txn.description;
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

  // ── Step 2: Evaluate each group ───────────────────────────────────────

  const detections: DetectedRecurring[] = [];

  for (const [pattern, group] of groups) {
    // Need at least 3 transactions to establish a pattern
    if (group.length < 3) continue;

    // Sort by date ascending
    group.sort((a, b) => a.date.localeCompare(b.date));

    // Compute inter-transaction intervals in days
    const intervals: number[] = [];
    for (let i = 1; i < group.length; i++) {
      const prev = new Date(group[i - 1].date).getTime();
      const curr = new Date(group[i].date).getTime();
      const days = (curr - prev) / (1000 * 60 * 60 * 24);
      intervals.push(days);
    }

    // Check periodicity: CV of intervals must be < 0.3
    const intervalCV = computeCV(intervals);
    if (intervalCV >= 0.3) continue;

    // Classify frequency from mean interval
    const meanInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    const frequency = classifyFrequency(meanInterval);
    if (!frequency) continue;

    // Check amount consistency: CV of absolute amounts must be < 0.15
    const amounts = group.map((t) => Math.abs(parseFloat(t.amount)));
    const amountCV = computeCV(amounts);
    if (amountCV >= 0.15) continue;

    // ── Step 3: Compute confidence and filter ─────────────────────────

    const confidence = 1 - (intervalCV * 0.5 + amountCV * 0.5);
    if (confidence <= 0.6) continue;

    // Use the most recent transaction for display values
    const mostRecent = group[group.length - 1];
    const categoryIds = group.map((t) => t.category_id);

    detections.push({
      merchantPattern: pattern,
      name: mostRecent.counterparty_name || mostRecent.description,
      amount: Math.abs(parseFloat(mostRecent.amount)).toFixed(2),
      frequency,
      confidence: Math.round(confidence * 1000) / 1000,
      transactionIds: group.map((t) => t.id),
      lastDate: mostRecent.date,
      categoryId: mostCommon(categoryIds),
      accountId: mostRecent.account_id
    });
  }

  // Sort by confidence descending
  detections.sort((a, b) => b.confidence - a.confidence);

  debug('log', '[ML:RECURRING] Detection complete:', detections.length, 'recurring patterns found');

  return detections;
}
