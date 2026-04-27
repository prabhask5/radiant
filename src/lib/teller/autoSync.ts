/**
 * @fileoverview Automatic Teller sync — background sync for connected enrollments on page load.
 *
 * Fetches fresh data from Teller via the mTLS proxy and writes new transactions
 * and pending→posted updates to IndexedDB via the sync engine. Designed to run
 * silently in the background on page load so the app stays fresh without
 * depending on Teller webhook delivery.
 *
 * The `processTellerSyncData` function is also used by the accounts page for
 * manual sync and initial enrollment flows.
 *
 * Duplicate prevention:
 *   - A module-level mutex ensures only one sync runs at a time
 *   - Transactions are deduped by `teller_transaction_id` against IndexedDB
 *   - Existing pending transactions are updated (not duplicated) when Teller
 *     reports them as posted — user-editable fields are preserved
 *   - User-deleted transactions are respected and never re-created
 *   - A second freshness check right before the batch write catches any
 *     transactions that arrived via webhook/realtime during the sync
 */

import { engineBatchWrite, engineGetAll } from 'stellar-drive/data';
import type { BatchOperation } from 'stellar-drive/data';
import { generateId, now } from 'stellar-drive/utils';
import { remoteChangesStore } from 'stellar-drive/stores';
import { debug } from 'stellar-drive/utils';
import { isDemoMode } from 'stellar-drive/demo';
import { isOffline } from 'stellar-drive';
import type { Account, TellerEnrollment } from '$lib/types';
import { getTellerTxnUpdateFields } from '$lib/teller/fields';

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS & MUTEX
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Module-level mutex: only one Teller sync can run at a time.
 * Prevents duplicate transactions from concurrent auto-sync + manual sync.
 */
let syncInProgress: Promise<number> | null = null;

/**
 * Module-level mutex for autoSyncEnrollments: prevents concurrent
 * auto-sync invocations when navigating between pages (accounts → transactions).
 */
let autoSyncInProgress: Promise<number> | null = null;

/* ═══════════════════════════════════════════════════════════════════════════
   PROCESS TELLER SYNC DATA
   ═══════════════════════════════════════════════════════════════════════════ */

/** Local transaction record shape for dedup checks (extends shared TellerTxnFields). */
interface LocalTellerTxn {
  id: string;
  status: string;
  amount: string;
  description: string;
  counterparty_name: string | null;
  counterparty_type: string | null;
  teller_category: string | null;
  type: string | null;
  running_balance: string | null;
  deleted?: boolean;
  user_deleted?: boolean;
  account_id?: string;
}

/** Teller-managed account fields we track for change detection. */
interface LocalTellerAccount {
  id: string;
  institution_name: string;
  name: string;
  type: string;
  subtype: string;
  currency: string | null;
  last_four: string | null;
  status: string;
  balance_available: string | null;
  balance_ledger: string | null;
}

/**
 * Get a map of all teller_transaction_ids currently in IndexedDB,
 * including Teller-managed fields for change detection.
 */
async function getFreshTellerTxnMap(): Promise<Map<string, LocalTellerTxn>> {
  const allLocalTxns = (await engineGetAll('transactions')) as unknown as Array<
    Record<string, unknown> & { teller_transaction_id: string | null }
  >;
  const map = new Map<string, LocalTellerTxn>();
  for (const t of allLocalTxns) {
    if (t.teller_transaction_id) {
      map.set(t.teller_transaction_id, {
        id: t.id as string,
        status: t.status as string,
        amount: t.amount as string,
        description: t.description as string,
        counterparty_name: (t.counterparty_name as string | null) ?? null,
        counterparty_type: (t.counterparty_type as string | null) ?? null,
        teller_category: (t.teller_category as string | null) ?? null,
        type: (t.type as string | null) ?? null,
        running_balance: (t.running_balance as string | null) ?? null,
        deleted: t.deleted as boolean | undefined,
        user_deleted: t.user_deleted as boolean | undefined,
        account_id: t.account_id as string | undefined
      });
    }
  }
  return map;
}

// getTellerTxnUpdateFields is imported from '$lib/teller/fields' — shared with webhook server

/**
 * Build an update fields object for Teller-managed account properties that changed.
 * Returns null if nothing changed, preventing redundant account writes.
 */
function getTellerAccountUpdateFields(
  local: LocalTellerAccount,
  tellerAcct: Record<string, unknown>
): Record<string, unknown> | null {
  const institution = tellerAcct.institution as { name?: string } | undefined;
  const incoming = {
    institution_name: institution?.name ?? local.institution_name,
    name: tellerAcct.name as string,
    type: tellerAcct.type as string,
    subtype: tellerAcct.subtype as string,
    currency: ((tellerAcct.currency as string) ?? null) as string | null,
    last_four: ((tellerAcct.last_four as string) ?? null) as string | null,
    status: tellerAcct.status as string,
    balance_available: ((tellerAcct.balance_available as string) ?? null) as string | null,
    balance_ledger: ((tellerAcct.balance_ledger as string) ?? null) as string | null
  };

  const changed: Record<string, unknown> = {};
  let hasChanges = false;

  for (const key of Object.keys(incoming) as Array<keyof typeof incoming>) {
    if (incoming[key] !== local[key]) {
      changed[key] = incoming[key];
      hasChanges = true;
    }
  }

  if (!hasChanges) return null;
  changed.balance_updated_at = now();
  return changed;
}

/** Result of a Teller sync operation with accurate counts for toast messages. */
export interface TellerSyncResult {
  /** New transactions created from Teller data. */
  newTransactions: number;
  /** Existing transactions updated (e.g. pending → posted). */
  updatedTransactions: number;
  /** New accounts created. */
  newAccounts: number;
  /** Existing accounts whose balance/status was refreshed. */
  updatedAccounts: number;
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
 * @returns Structured sync result with accurate counts.
 */
export function processTellerSyncData(
  rawData: {
    accounts: Array<Record<string, unknown>>;
    transactions: Array<Record<string, unknown>>;
  },
  localEnrollmentId: string,
  options?: {
    /**
     * When true (enrollment creation / forced re-import), soft-deleted transactions
     * are restored instead of skipped. This allows a bank to be re-added within the
     * tombstone TTL window (default 10 years for Radiant) without losing history.
     * In normal auto-sync this must be false so user-deleted transactions stay gone.
     */
    isInitialSync?: boolean;
  }
): Promise<TellerSyncResult> {
  // If a sync is already in progress, wait for it then run ours
  if (syncInProgress) {
    return (syncInProgress as Promise<unknown>).then(() =>
      processTellerSyncDataInternal(rawData, localEnrollmentId, options)
    ) as Promise<TellerSyncResult>;
  }

  const task = processTellerSyncDataInternal(rawData, localEnrollmentId, options);
  syncInProgress = task as unknown as Promise<number>;
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
  localEnrollmentId: string,
  options?: { isInitialSync?: boolean }
): Promise<TellerSyncResult> {
  const isInitialSync = options?.isInitialSync ?? false;
  debug('log', '[TELLER-SYNC] processTellerSyncData — enrollmentId:', localEnrollmentId);

  // Build local lookup maps from IndexedDB
  const allLocalAccounts = (await engineGetAll('accounts')) as unknown as Account[];
  const localAccountMap = new Map(
    allLocalAccounts
      .filter((a) => a.teller_account_id)
      .map((a) => [a.teller_account_id, a as Account & LocalTellerAccount])
  );

  const existingTxnMap = await getFreshTellerTxnMap();

  const ops: BatchOperation[] = [];
  const tellerIdToLocalId = new Map<string, string>();
  let newAccountCount = 0;
  let updatedAccountCount = 0;

  // Process accounts: create new, update existing
  for (const tellerAcct of rawData.accounts) {
    const tellerId = tellerAcct.id as string;
    const existing = localAccountMap.get(tellerId);

    if (existing) {
      tellerIdToLocalId.set(tellerId, existing.id);
      const updateFields = getTellerAccountUpdateFields(existing, tellerAcct);
      if (updateFields) {
        ops.push({ type: 'update', table: 'accounts', id: existing.id, fields: updateFields });
        remoteChangesStore.recordLocalChange(existing.id, 'accounts', 'update');
        updatedAccountCount++;
      }
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
      newAccountCount++;
    }
  }

  // First pass: sort transactions into new, needs-update, and skip
  const candidateTxns: Array<{
    tellerTxnId: string;
    accountId: string;
    tellerTxn: Record<string, unknown>;
  }> = [];
  let skippedExisting = 0;
  let updatedCount = 0;
  let newTxnCount = 0;

  for (const tellerTxn of rawData.transactions) {
    const tellerTxnId = tellerTxn.id as string;
    const tellerAcctId = tellerTxn.account_id as string;
    const accountId = tellerIdToLocalId.get(tellerAcctId);
    if (!accountId) continue;

    const existing = existingTxnMap.get(tellerTxnId);

    if (existing) {
      if (existing.user_deleted) {
        // User explicitly deleted this transaction — never re-import, even on
        // initial enrollment sync. The record persists as a permanent "do not
        // re-import" marker (no tombstone TTL).
        skippedExisting++;
        continue;
      }

      if (existing.deleted) {
        if (isInitialSync) {
          // Initial enrollment sync: restore the tombstone (cascade-deleted when
          // enrollment was disconnected). Flips deleted: false and refreshes Teller
          // fields — no new record created, existing UUID is reused.
          const updateFields = getTellerTxnUpdateFields(existing, tellerTxn) ?? {};
          ops.push({
            type: 'update',
            table: 'transactions',
            id: existing.id,
            fields: { ...updateFields, deleted: false, account_id: accountId }
          });
          remoteChangesStore.recordLocalChange(existing.id, 'transactions', 'update');
          newTxnCount++; // counts as new from the user's perspective
        } else {
          // Normal auto-sync: respect the tombstone.
          skippedExisting++;
        }
        continue;
      }

      // Check if any Teller-managed fields have actually changed.
      // This covers: pending→posted, pending amount/description changes
      // (e.g. restaurant tip, gas pre-auth), description enrichment, etc.
      // Posted transactions are immutable in Teller so this is a no-op for them.
      const updateFields = getTellerTxnUpdateFields(existing, tellerTxn);
      if (updateFields) {
        ops.push({
          type: 'update',
          table: 'transactions',
          id: existing.id,
          fields: updateFields
        });
        remoteChangesStore.recordLocalChange(existing.id, 'transactions', 'update');
        updatedCount++;
      } else {
        skippedExisting++;
      }
      continue;
    }

    candidateTxns.push({ tellerTxnId, accountId, tellerTxn });
  }

  // Second freshness check: re-read IndexedDB right before writing to catch
  // any transactions that arrived via webhook/realtime during the Teller fetch
  if (candidateTxns.length > 0) {
    const freshMap = await getFreshTellerTxnMap();
    const trulyNew = candidateTxns.filter((c) => !freshMap.has(c.tellerTxnId));
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
          category_source: null,
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
    pendingToPosted: updatedCount,
    total: ops.length
  });
  if (ops.length > 0) {
    await engineBatchWrite(ops);
    debug('log', '[TELLER-SYNC] processTellerSyncData — batch write complete');
  } else {
    debug('log', '[TELLER-SYNC] No new data from Teller — zero Supabase writes needed');
  }

  return {
    newTransactions: newTxnCount,
    updatedTransactions: updatedCount,
    newAccounts: newAccountCount,
    updatedAccounts: updatedAccountCount
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   AUTO-SYNC ENROLLMENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Auto-sync all connected Teller enrollments on page load.
 * Runs silently in the background — no UI feedback unless something fails.
 *
 * @param enrollments — current enrollment list from the store
 * @param updateStatus — callback to update enrollment status after sync
 * @returns The total number of new transactions synced across all enrollments.
 */
export function autoSyncEnrollments(
  enrollments: TellerEnrollment[],
  updateStatus: (id: string, status: string, force?: boolean) => Promise<void>
): Promise<number> {
  // If an auto-sync is already running (e.g. from another page mount), return its result
  if (autoSyncInProgress) {
    debug('log', '[TELLER-SYNC] Auto-sync already in progress — returning existing promise');
    return autoSyncInProgress;
  }

  const task = autoSyncEnrollmentsInternal(enrollments, updateStatus);
  autoSyncInProgress = task;
  task.finally(() => {
    autoSyncInProgress = null;
  });
  return task;
}

async function autoSyncEnrollmentsInternal(
  enrollments: TellerEnrollment[],
  updateStatus: (id: string, status: string, force?: boolean) => Promise<void>
): Promise<number> {
  if (isDemoMode()) return 0;
  if (isOffline()) {
    debug('log', '[TELLER-SYNC] Offline — skipping auto-sync');
    return 0;
  }

  // Sync all active enrollments on every page load. This does NOT increase
  // Supabase egress: if Teller returns nothing new, zero sync queue entries
  // are created → zero Supabase requests. Only cost is 1 HTTP request to our
  // own server endpoint per enrollment (not counted in Supabase egress).
  // Include 'error' enrollments so transient failures (network blips, server
  // timeouts) self-heal on next page load. Only 'disconnected' (expired token)
  // requires manual reconnection.
  const activeEnrollments = enrollments.filter((e) => {
    return (e.status === 'connected' || e.status === 'error') && !!e.access_token;
  });

  if (activeEnrollments.length === 0) return 0;

  debug('log', `[TELLER-SYNC] Auto-sync: ${activeEnrollments.length} active enrollment(s)`);

  let totalNew = 0;

  for (const enrollment of activeEnrollments) {
    // Compute incremental fetch date: 3-day buffer before last_synced_at
    // to catch pending→posted transitions near the sync boundary
    let sinceDate: string | undefined;
    if (enrollment.last_synced_at) {
      const d = new Date(enrollment.last_synced_at);
      d.setDate(d.getDate() - 3);
      sinceDate = d.toISOString().slice(0, 10); // YYYY-MM-DD
    }

    // Retry transient failures up to 5 times with exponential backoff (2s, 4s, 8s, 16s).
    // The error badge/banner only surfaces after all attempts are exhausted, so users
    // never see transient blips that resolve themselves within ~30s.
    const MAX_ATTEMPTS = 5;
    let succeeded = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetch('/api/teller/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: enrollment.access_token, sinceDate })
        });

        if (!response.ok) {
          let errorBody = '';
          try {
            errorBody = await response.text();
          } catch {
            /* non-fatal */
          }

          // 401 → access token expired, no retries — user must reconnect manually.
          if (response.status === 401) {
            debug(
              'warn',
              `[TELLER-SYNC] Auto-sync failed for ${enrollment.institution_name}: HTTP 401 — marking disconnected`
            );
            await updateStatus(enrollment.id, 'disconnected');
            succeeded = true; // not a retryable failure — skip to next enrollment
            break;
          }

          // Transient error — retry if attempts remain
          debug(
            'warn',
            `[TELLER-SYNC] Auto-sync attempt ${attempt}/${MAX_ATTEMPTS} failed for ${enrollment.institution_name}: HTTP ${response.status}${errorBody ? ` — ${errorBody.slice(0, 200)}` : ''}`
          );

          if (attempt < MAX_ATTEMPTS) {
            const backoffMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s, 16s
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }

          // All attempts exhausted
          await updateStatus(enrollment.id, 'error');
          break;
        }

        // Success
        const rawData = await response.json();
        const result = await processTellerSyncData(rawData, enrollment.id);
        totalNew += result.newTransactions + result.updatedTransactions;
        // Always update status + last_synced_at so:
        //   - Error/disconnected state always clears after a successful sync (#7)
        //   - last_synced_at always reflects when sync actually ran (#6)
        await updateStatus(enrollment.id, 'connected', true);
        debug(
          'log',
          `[TELLER-SYNC] Auto-sync complete: ${enrollment.institution_name} — ${result.newTransactions} new, ${result.updatedTransactions} transaction updates, ${result.updatedAccounts} account updates`
        );
        succeeded = true;
        break;
      } catch (err) {
        debug(
          'warn',
          `[TELLER-SYNC] Auto-sync attempt ${attempt}/${MAX_ATTEMPTS} error for ${enrollment.institution_name}:`,
          err
        );

        if (attempt < MAX_ATTEMPTS) {
          const backoffMs = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }

        // All attempts exhausted
        await updateStatus(enrollment.id, 'error');
      }
    }

    if (!succeeded) {
      debug(
        'warn',
        `[TELLER-SYNC] All ${MAX_ATTEMPTS} attempts exhausted for ${enrollment.institution_name}`
      );
    }
  }

  return totalNew;
}
