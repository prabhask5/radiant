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

  // ── Step 0: Gate on budget setup ──────────────────────────────────────
  // Don't generate recurring entries if the user hasn't set up any budget
  // categories yet — the budget page isn't configured.
  const allCategories = (await engineGetAll('categories')) as unknown as { deleted?: boolean }[];
  if (allCategories.filter((c) => !c.deleted).length === 0) {
    debug('log', '[ML:RECURRING] No categories — skipping recurring detection (budget not set up)');
    return;
  }

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

      // Re-activate ended entries when the detector finds them again.
      // The detector's recency check guarantees the pattern has recent data,
      // so this only fires for subscriptions that are truly active again.
      if (existing.status === 'ended' && existing.source !== 'manual') {
        updateFields.status = 'active';
        debug(
          'log',
          '[ML:RECURRING] Re-activating ended entry:',
          existing.name,
          '(detector found recent data)'
        );
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

  // ── Step 4: Auto-end unrefreshed auto-detected entries ──────────────────
  // If the detector no longer finds an auto-detected entry, end it immediately.
  // The detector's exact-interval matching is the source of truth — if it can't
  // find a valid recurring pattern, the entry should not remain active.

  for (const rec of existingRecurring) {
    if (rec.status !== 'active' && rec.status !== 'cancelling') continue;
    if (rec.deleted) continue;
    if (rec.source === 'manual') continue;
    if (refreshedIds.has(rec.id)) continue;

    batchOps.push({
      type: 'update',
      table: 'recurring_transactions',
      id: rec.id,
      fields: { status: 'ended' }
    });

    debug('log', '[ML:RECURRING] Auto-ended entry (not detected this run):', rec.name);
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

  // ── Step 6b: Clear is_recurring on stale transactions ─────────────────
  // Transactions previously marked is_recurring that are NOT in the current
  // detection set must be cleared — zero stale data.
  const matchedIdSet = new Set(uniqueTxnIds);
  const toClear = transactions.filter(
    (t) => t.is_recurring && !t.deleted && !matchedIdSet.has(t.id)
  );

  if (toClear.length > 0) {
    const clearOps: BatchOperation[] = toClear.map((t) => ({
      type: 'update' as const,
      table: 'transactions' as const,
      id: t.id,
      fields: { is_recurring: false }
    }));

    await engineBatchWrite(clearOps);
    debug('log', '[ML:RECURRING] Cleared is_recurring on', toClear.length, 'stale transactions');
  }

  debug(
    'log',
    '[ML:RECURRING] Sync complete:',
    detections.length,
    'patterns,',
    batchOps.length,
    'writes,',
    toMark.length,
    'marked,',
    toClear.length,
    'cleared'
  );
}
