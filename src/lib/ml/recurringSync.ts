/**
 * @fileoverview Recurring transaction sync layer.
 *
 * Runs after transactionsStore.load(), compares ML detections against
 * existing recurring_transactions entries, creates new auto-detected
 * entries, marks matching transactions as is_recurring = true, and
 * auto-ends stale entries whose expected next charge never arrived.
 */

// =============================================================================
//                              IMPORTS
// =============================================================================

import { engineGetAll, engineBatchWrite } from 'stellar-drive/data';
import type { BatchOperation } from 'stellar-drive/data';
import { generateId, debug } from 'stellar-drive/utils';
import type { Transaction, RecurringTransaction, Account, AccountType } from '$lib/types';
import { detectRecurringTransactions } from './recurringDetector';

// =============================================================================
//                          FREQUENCY INTERVALS
// =============================================================================

/** Number of days to add for each frequency when computing `next_date`. */
const FREQUENCY_DAYS: Record<string, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  quarterly: 90,
  yearly: 365
};

/**
 * Grace period (in days) past `next_date` before an entry is auto-ended.
 * Scaled by frequency so a monthly sub gets ~10 days grace, while a yearly
 * sub gets ~30 days. Minimum 7 days to absorb billing jitter.
 */
const GRACE_DAYS: Record<string, number> = {
  weekly: 7,
  biweekly: 7,
  monthly: 10,
  quarterly: 20,
  yearly: 30
};

// =============================================================================
//                          HELPER FUNCTIONS
// =============================================================================

/** Format a Date as a local YYYY-MM-DD string (avoids UTC shift from toISOString). */
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  // Append T00:00:00 to force local-time parsing (date-only strings default to UTC)
  const date = new Date(lastDate + 'T00:00:00');
  date.setDate(date.getDate() + (FREQUENCY_DAYS[frequency] ?? 30));
  return toLocalDateStr(date);
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
export async function syncRecurringDetections(
  preloadedTransactions?: Transaction[]
): Promise<void> {
  debug('log', '[ML:RECURRING] Starting recurring sync...');

  // ── Step 1: Load data ─────────────────────────────────────────────────

  const transactions =
    preloadedTransactions ?? ((await engineGetAll('transactions')) as unknown as Transaction[]);
  const accounts = (await engineGetAll('accounts')) as unknown as Account[];
  const existingRecurring = (await engineGetAll(
    'recurring_transactions'
  )) as unknown as RecurringTransaction[];

  // Build account type map so detection correctly handles sign conventions
  const accountTypes = new Map<string, AccountType>();
  for (const acct of accounts) {
    if (acct.type === 'depository' || acct.type === 'credit') {
      accountTypes.set(acct.id, acct.type as AccountType);
    }
  }

  debug(
    'log',
    '[ML:RECURRING] Loaded',
    transactions.length,
    'transactions,',
    existingRecurring.length,
    'existing recurring entries'
  );

  // ── Step 2: Run detection ─────────────────────────────────────────────

  const detections = detectRecurringTransactions(transactions, accountTypes);

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
  // Track which existing entries were refreshed by the detector
  const refreshedIds = new Set<string>();
  // Use local date for all comparisons (date-only strings parsed as local time)
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  for (const detection of detections) {
    allMatchedTxnIds.push(...detection.transactionIds);

    const existing = existingByPattern.get(detection.merchantPattern);

    if (!existing) {
      // Create new auto-detected recurring entry
      const id = generateId();
      const nextDate = computeNextDate(detection.lastDate, detection.frequency);

      // Skip creating entries that are already stale — the subscription
      // has likely ended, so creating it just to auto-end it is churn.
      const grace = GRACE_DAYS[detection.frequency] ?? 10;
      const deadline = new Date(nextDate + 'T00:00:00');
      deadline.setDate(deadline.getDate() + grace);
      if (today > toLocalDateStr(deadline)) {
        debug(
          'log',
          '[ML:RECURRING] Skipping stale detection:',
          detection.name,
          '(next_date',
          nextDate,
          'already past grace)'
        );
        continue;
      }

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
      refreshedIds.add(existing.id);

      // Update existing entry if detection has newer data or category changed
      const existingLastDate = existing.last_detected_date ?? '';
      const updateFields: Record<string, unknown> = {};

      if (detection.lastDate > existingLastDate) {
        updateFields.last_detected_date = detection.lastDate;
        updateFields.next_date = computeNextDate(detection.lastDate, detection.frequency);
      }

      // Sync category from matched transactions (most common category).
      // Only update auto-detected entries — manual entries have user-set categories.
      if (existing.source !== 'manual' && detection.categoryId !== existing.category_id) {
        updateFields.category_id = detection.categoryId;
        debug(
          'log',
          '[ML:RECURRING] Category sync:',
          existing.name,
          existing.category_id,
          '→',
          detection.categoryId
        );
      }

      if (Object.keys(updateFields).length > 0) {
        batchOps.push({
          type: 'update',
          table: 'recurring_transactions',
          id: existing.id,
          fields: updateFields
        });

        debug(
          'log',
          '[ML:RECURRING] Updated:',
          existing.name,
          Object.keys(updateFields).join(', ')
        );
      }
    }
  }

  // ── Step 4: Auto-end stale entries ──────────────────────────────────────
  // If next_date + grace period has passed and the detector didn't refresh
  // the entry, the subscription likely stopped — mark it as ended.

  for (const rec of existingRecurring) {
    // Only auto-end auto-detected, active/cancelling entries that weren't
    // refreshed this run. Manual entries are user-managed — never auto-end them.
    if (rec.status !== 'active' && rec.status !== 'cancelling') continue;
    if (rec.deleted) continue;
    if (rec.source === 'manual') continue;
    if (refreshedIds.has(rec.id)) continue;
    if (!rec.next_date) continue;

    const grace = GRACE_DAYS[rec.frequency] ?? 10;
    const deadline = new Date(rec.next_date + 'T00:00:00');
    deadline.setDate(deadline.getDate() + grace);

    if (today > toLocalDateStr(deadline)) {
      batchOps.push({
        type: 'update',
        table: 'recurring_transactions',
        id: rec.id,
        fields: { status: 'ended' }
      });

      debug(
        'log',
        '[ML:RECURRING] Auto-ended stale entry:',
        rec.name,
        '(next_date was',
        rec.next_date,
        '+ grace',
        grace,
        'days)'
      );
    }
  }

  // ── Step 5: Write recurring entry changes ─────────────────────────────

  if (batchOps.length > 0) {
    await engineBatchWrite(batchOps);
    debug('log', '[ML:RECURRING] Wrote', batchOps.length, 'recurring entry operations');
  }

  // ── Step 6: Mark matched transactions as is_recurring ─────────────────

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
