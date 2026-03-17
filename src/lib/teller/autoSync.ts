/**
 * @fileoverview Automatic Teller sync — background sync for stale enrollments.
 *
 * Fetches fresh data from Teller via the mTLS proxy and writes only truly new
 * transactions to IndexedDB via the sync engine. Designed to run silently in
 * the background on page load so the app stays fresh without depending on
 * Teller webhook delivery.
 *
 * The `processTellerSyncData` function is also used by the accounts page for
 * manual sync and initial enrollment flows.
 *
 * Duplicate prevention:
 *   - A module-level mutex ensures only one sync runs at a time
 *   - Transactions are deduped by `teller_transaction_id` against IndexedDB
 *   - A second freshness check right before the batch write catches any
 *     transactions that arrived via webhook/realtime during the sync
 */

import { engineBatchWrite, engineGetAll } from 'stellar-drive/data';
import type { BatchOperation } from 'stellar-drive/data';
import { generateId, now } from 'stellar-drive/utils';
import { remoteChangesStore } from 'stellar-drive/stores';
import { debug } from 'stellar-drive/utils';
import { isDemoMode } from 'stellar-drive/demo';
import type { Account, TellerEnrollment } from '$lib/types';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS & MUTEX
   ═══════════════════════════════════════════════════════════════════════════ */

/** Enrollments older than this are considered stale and will auto-sync. */
const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Module-level mutex: only one Teller sync can run at a time.
 * Prevents duplicate transactions from concurrent auto-sync + manual sync.
 */
let syncInProgress: Promise<number> | null = null;

/**
 * Module-level mutex for autoSyncStaleEnrollments: prevents concurrent
 * auto-sync invocations when navigating between pages (accounts → transactions).
 */
let autoSyncInProgress: Promise<number> | null = null;

/* ═══════════════════════════════════════════════════════════════════════════
   PROCESS TELLER SYNC DATA
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Get a fresh set of all teller_transaction_ids currently in IndexedDB.
 * Used for dedup checks before writing new transactions.
 */
async function getFreshTellerTxnIds(): Promise<Set<string>> {
  const allLocalTxns = (await engineGetAll('transactions')) as unknown as Array<
    Record<string, unknown> & { teller_transaction_id: string | null }
  >;
  return new Set(
    allLocalTxns.filter((t) => t.teller_transaction_id).map((t) => t.teller_transaction_id!)
  );
}

/**
 * Process raw Teller API data into local IndexedDB via engine functions.
 *
 * All writes go through engineBatchWrite → IndexedDB + sync queue → Supabase.
 * This preserves the offline-first architecture: local-first, then sync.
 *
 * Guarded by a module-level mutex — concurrent calls will await the first
 * call's completion before proceeding, ensuring no duplicate writes.
 *
 * @returns The number of new transactions created.
 */
export function processTellerSyncData(
  rawData: {
    accounts: Array<Record<string, unknown>>;
    transactions: Array<Record<string, unknown>>;
  },
  localEnrollmentId: string
): Promise<number> {
  // If a sync is already in progress, wait for it then run ours
  if (syncInProgress) {
    return syncInProgress.then(() => processTellerSyncDataInternal(rawData, localEnrollmentId));
  }

  const task = processTellerSyncDataInternal(rawData, localEnrollmentId);
  syncInProgress = task;
  task.finally(() => {
    syncInProgress = null;
  });
  return task;
}

async function processTellerSyncDataInternal(
  rawData: {
    accounts: Array<Record<string, unknown>>;
    transactions: Array<Record<string, unknown>>;
  },
  localEnrollmentId: string
): Promise<number> {
  debug('log', '[TELLER-SYNC] processTellerSyncData — enrollmentId:', localEnrollmentId);

  // Build local lookup maps from IndexedDB
  const allLocalAccounts = (await engineGetAll('accounts')) as unknown as Account[];
  const localAccountMap = new Map(
    allLocalAccounts.filter((a) => a.teller_account_id).map((a) => [a.teller_account_id, a])
  );

  const existingTellerTxnIds = await getFreshTellerTxnIds();

  const ops: BatchOperation[] = [];
  const tellerIdToLocalId = new Map<string, string>();

  // Process accounts: create new, update existing
  for (const tellerAcct of rawData.accounts) {
    const tellerId = tellerAcct.id as string;
    const existing = localAccountMap.get(tellerId);

    if (existing) {
      // Update balance + status only
      tellerIdToLocalId.set(tellerId, existing.id);
      const updateFields = {
        balance_available: tellerAcct.balance_available ?? existing.balance_available,
        balance_ledger: tellerAcct.balance_ledger ?? existing.balance_ledger,
        balance_updated_at: now(),
        status: tellerAcct.status ?? existing.status
      };
      ops.push({ type: 'update', table: 'accounts', id: existing.id, fields: updateFields });
      remoteChangesStore.recordLocalChange(existing.id, 'accounts', 'update');
    } else {
      // Create new account
      const id = generateId();
      tellerIdToLocalId.set(tellerId, id);
      ops.push({
        type: 'create',
        table: 'accounts',
        data: {
          id,
          enrollment_id: localEnrollmentId,
          teller_account_id: tellerId,
          institution_name: (tellerAcct.institution as { name: string })?.name ?? 'Unknown',
          name: tellerAcct.name as string,
          type: tellerAcct.type as string,
          subtype: tellerAcct.subtype as string,
          currency: (tellerAcct.currency as string) ?? 'USD',
          last_four: (tellerAcct.last_four as string) ?? null,
          status: (tellerAcct.status as string) ?? 'open',
          source: 'teller',
          balance_available: (tellerAcct.balance_available as string) ?? null,
          balance_ledger: (tellerAcct.balance_ledger as string) ?? null,
          balance_updated_at: now(),
          is_hidden: false
        }
      });
      remoteChangesStore.recordLocalChange(id, 'accounts', 'create');
    }
  }

  // First pass: identify candidate new transactions
  const candidateTxns: Array<{
    tellerTxnId: string;
    accountId: string;
    tellerTxn: Record<string, unknown>;
  }> = [];
  let skippedExisting = 0;

  for (const tellerTxn of rawData.transactions) {
    const tellerTxnId = tellerTxn.id as string;
    const tellerAcctId = tellerTxn.account_id as string;
    const accountId = tellerIdToLocalId.get(tellerAcctId);
    if (!accountId) continue;

    if (existingTellerTxnIds.has(tellerTxnId)) {
      skippedExisting++;
      continue;
    }

    candidateTxns.push({ tellerTxnId, accountId, tellerTxn });
  }

  // Second freshness check: re-read IndexedDB right before writing to catch
  // any transactions that arrived via webhook/realtime during the Teller fetch
  let newTxnCount = 0;
  if (candidateTxns.length > 0) {
    const freshIds = await getFreshTellerTxnIds();
    const trulyNew = candidateTxns.filter((c) => !freshIds.has(c.tellerTxnId));
    const caughtByRecheck = candidateTxns.length - trulyNew.length;

    if (caughtByRecheck > 0) {
      debug('log', `[TELLER-SYNC] Freshness recheck caught ${caughtByRecheck} duplicate(s)`);
      skippedExisting += caughtByRecheck;
    }

    // Build create ops for truly new transactions
    for (const { tellerTxnId, accountId, tellerTxn } of trulyNew) {
      const id = generateId();
      const details = tellerTxn.details as
        | { counterparty?: { name?: string; type?: string }; category?: string }
        | undefined;
      ops.push({
        type: 'create',
        table: 'transactions',
        data: {
          id,
          account_id: accountId,
          teller_transaction_id: tellerTxnId,
          amount: tellerTxn.amount as string,
          date: tellerTxn.date as string,
          description: tellerTxn.description as string,
          counterparty_name: details?.counterparty?.name ?? null,
          counterparty_type: details?.counterparty?.type ?? null,
          teller_category: details?.category ?? null,
          category_id: null,
          status: tellerTxn.status as string,
          type: (tellerTxn.type as string) ?? null,
          running_balance: (tellerTxn.running_balance as string) ?? null,
          is_excluded: false,
          is_auto_categorized: false,
          notes: null,
          csv_import_hash: null
        }
      });
      remoteChangesStore.recordLocalChange(id, 'transactions', 'create');
      newTxnCount++;
    }
  }

  debug('log', '[TELLER-SYNC] processTellerSyncData — skipped existing:', skippedExisting);

  // Single atomic batch write → IndexedDB + sync queue
  const createOps = ops.filter((o) => o.type === 'create');
  const updateOps = ops.filter((o) => o.type === 'update');
  debug('log', '[TELLER-SYNC] processTellerSyncData — batch ops:', {
    creates: createOps.length,
    updates: updateOps.length,
    newTransactions: newTxnCount,
    total: ops.length
  });
  if (ops.length > 0) {
    await engineBatchWrite(ops);
    debug('log', '[TELLER-SYNC] processTellerSyncData — batch write complete');
  }

  return newTxnCount;
}

/* ═══════════════════════════════════════════════════════════════════════════
   AUTO-SYNC STALE ENROLLMENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Auto-sync all connected Teller enrollments that haven't synced recently.
 * Runs silently in the background — no UI feedback unless something fails.
 *
 * @param enrollments — current enrollment list from the store
 * @param updateStatus — callback to update enrollment status after sync
 * @returns The total number of new transactions synced across all enrollments.
 */
export function autoSyncStaleEnrollments(
  enrollments: TellerEnrollment[],
  updateStatus: (id: string, status: string) => Promise<void>
): Promise<number> {
  // If an auto-sync is already running (e.g. from another page mount), return its result
  if (autoSyncInProgress) {
    debug('log', '[TELLER-SYNC] Auto-sync already in progress — returning existing promise');
    return autoSyncInProgress;
  }

  const task = autoSyncStaleEnrollmentsInternal(enrollments, updateStatus);
  autoSyncInProgress = task;
  task.finally(() => {
    autoSyncInProgress = null;
  });
  return task;
}

async function autoSyncStaleEnrollmentsInternal(
  enrollments: TellerEnrollment[],
  updateStatus: (id: string, status: string) => Promise<void>
): Promise<number> {
  if (isDemoMode()) return 0;

  const staleEnrollments = enrollments.filter((e) => {
    if (e.status !== 'connected' || !e.access_token) return false;
    if (!e.last_synced_at) return true; // never synced
    return Date.now() - new Date(e.last_synced_at).getTime() > STALE_THRESHOLD_MS;
  });

  if (staleEnrollments.length === 0) return 0;

  debug('log', `[TELLER-SYNC] Auto-sync: ${staleEnrollments.length} stale enrollment(s)`);

  let totalNew = 0;

  for (const enrollment of staleEnrollments) {
    try {
      // Compute incremental fetch date: 3-day buffer before last_synced_at
      // to catch pending→posted transitions near the sync boundary
      let sinceDate: string | undefined;
      if (enrollment.last_synced_at) {
        const d = new Date(enrollment.last_synced_at);
        d.setDate(d.getDate() - 3);
        sinceDate = d.toISOString().slice(0, 10); // YYYY-MM-DD
      }

      const response = await fetch('/api/teller/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: enrollment.access_token, sinceDate })
      });

      if (!response.ok) {
        debug(
          'warn',
          `[TELLER-SYNC] Auto-sync failed for ${enrollment.institution_name}: HTTP ${response.status}`
        );
        continue;
      }

      const rawData = await response.json();
      const newCount = await processTellerSyncData(rawData, enrollment.id);
      totalNew += newCount;
      await updateStatus(enrollment.id, 'connected');
      debug(
        'log',
        `[TELLER-SYNC] Auto-sync complete: ${enrollment.institution_name} — ${newCount} new`
      );
    } catch (err) {
      debug('warn', `[TELLER-SYNC] Auto-sync error for ${enrollment.institution_name}:`, err);
    }
  }

  return totalNew;
}
