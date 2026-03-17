/**
 * @fileoverview Recurring transaction sync layer.
 *
 * Runs after transactionsStore.load(), compares ML detections against
 * existing recurring_transactions entries, creates new auto-detected
 * entries, and marks matching transactions as is_recurring = true.
 */

// =============================================================================
//                              IMPORTS
// =============================================================================

import { engineGetAll, engineBatchWrite } from 'stellar-drive/data';
import type { BatchOperation } from 'stellar-drive/data';
import { generateId, debug } from 'stellar-drive/utils';
import type { Transaction, RecurringTransaction } from '$lib/types';
import { detectRecurringTransactions } from './recurringDetector';

// =============================================================================
//                          FREQUENCY INTERVALS
// =============================================================================

/** Number of days to add for each frequency when computing `next_date`. */
const FREQUENCY_DAYS: Record<string, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  yearly: 365
};

// =============================================================================
//                          HELPER FUNCTIONS
// =============================================================================

/**
 * Compute the next expected date by adding the frequency interval to a date.
 *
 * @param lastDate - ISO date string of the most recent occurrence
 * @param frequency - Recurrence frequency
 * @returns ISO date string (YYYY-MM-DD) of the next expected date
 *
 * @example
 * ```ts
 * computeNextDate('2026-03-01', 'monthly');  // => '2026-03-31'
 * computeNextDate('2026-03-10', 'weekly');   // => '2026-03-17'
 * ```
 */
function computeNextDate(lastDate: string, frequency: string): string {
  const date = new Date(lastDate);
  date.setDate(date.getDate() + (FREQUENCY_DAYS[frequency] ?? 30));

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

// =============================================================================
//                           SYNC FUNCTION
// =============================================================================

/**
 * Sync ML-detected recurring patterns with the recurring_transactions store.
 *
 * Loads all transactions and existing recurring_transactions, runs the
 * detection algorithm, then creates new entries for unmatched detections
 * and updates existing entries when newer data is available. All matched
 * transactions are marked with `is_recurring = true`.
 *
 * @returns Resolves when sync is complete
 *
 * @example
 * ```ts
 * // Call after loading transactions
 * await transactionsStore.load();
 * await syncRecurringDetections();
 * ```
 */
export async function syncRecurringDetections(): Promise<void> {
  debug('log', '[ML:RECURRING] Starting recurring sync...');

  // ── Step 1: Load data ─────────────────────────────────────────────────

  const transactions = (await engineGetAll('transactions')) as unknown as Transaction[];
  const existingRecurring = (await engineGetAll(
    'recurring_transactions'
  )) as unknown as RecurringTransaction[];

  debug(
    'log',
    '[ML:RECURRING] Loaded',
    transactions.length,
    'transactions,',
    existingRecurring.length,
    'existing recurring entries'
  );

  // ── Step 2: Run detection ─────────────────────────────────────────────

  const detections = detectRecurringTransactions(transactions);

  if (detections.length === 0) {
    debug('log', '[ML:RECURRING] No recurring patterns detected');
    return;
  }

  // Build a lookup of existing recurring entries by merchant_pattern
  const existingByPattern = new Map<string, RecurringTransaction>();
  for (const rec of existingRecurring) {
    if (rec.merchant_pattern) {
      existingByPattern.set(rec.merchant_pattern, rec);
    }
  }

  // ── Step 3: Create or update recurring entries ─────────────────────────

  const batchOps: BatchOperation[] = [];
  const allMatchedTxnIds: string[] = [];

  for (const detection of detections) {
    allMatchedTxnIds.push(...detection.transactionIds);

    const existing = existingByPattern.get(detection.merchantPattern);

    if (!existing) {
      // Create new auto-detected recurring entry
      const id = generateId();
      const nextDate = computeNextDate(detection.lastDate, detection.frequency);

      batchOps.push({
        type: 'create',
        table: 'recurring_transactions',
        data: {
          id,
          name: detection.name,
          amount: detection.amount,
          category_id: detection.categoryId,
          frequency: detection.frequency,
          source: 'auto-detected',
          status: 'active',
          account_id: detection.accountId,
          merchant_pattern: detection.merchantPattern,
          last_detected_date: detection.lastDate,
          next_date: nextDate
        }
      });

      debug(
        'log',
        '[ML:RECURRING] New detection:',
        detection.name,
        detection.frequency,
        '$' + detection.amount
      );
    } else {
      // Update existing entry if detection has newer data
      const existingLastDate = existing.last_detected_date ?? '';

      if (detection.lastDate > existingLastDate) {
        const nextDate = computeNextDate(detection.lastDate, detection.frequency);

        batchOps.push({
          type: 'update',
          table: 'recurring_transactions',
          id: existing.id,
          fields: {
            last_detected_date: detection.lastDate,
            next_date: nextDate
          }
        });

        debug(
          'log',
          '[ML:RECURRING] Updated:',
          existing.name,
          'last_detected_date →',
          detection.lastDate
        );
      }
    }
  }

  // ── Step 4: Write recurring entry changes ─────────────────────────────

  if (batchOps.length > 0) {
    await engineBatchWrite(batchOps);
    debug('log', '[ML:RECURRING] Wrote', batchOps.length, 'recurring entry operations');
  }

  // ── Step 5: Mark matched transactions as is_recurring ─────────────────

  // Deduplicate transaction IDs
  const uniqueTxnIds = [...new Set(allMatchedTxnIds)];

  // Only update transactions that aren't already marked
  const txnById = new Map(transactions.map((t) => [t.id, t]));
  const toMark = uniqueTxnIds.filter((id) => {
    const txn = txnById.get(id);
    return txn && !txn.is_recurring;
  });

  if (toMark.length > 0) {
    const markOps: BatchOperation[] = toMark.map((id) => ({
      type: 'update' as const,
      table: 'transactions' as const,
      id,
      fields: { is_recurring: true }
    }));

    await engineBatchWrite(markOps);
    debug('log', '[ML:RECURRING] Marked', toMark.length, 'transactions as is_recurring');
  }

  debug(
    'log',
    '[ML:RECURRING] Sync complete:',
    detections.length,
    'patterns,',
    batchOps.length,
    'writes,',
    toMark.length,
    'transactions marked'
  );
}
