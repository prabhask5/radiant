/**
 * @fileoverview Reactive data stores for Radiant Finance.
 *
 * Each store wraps a local-first query and exposes CRUD operations
 * that write optimistically to IndexedDB and queue sync to Supabase.
 *
 * Stores auto-refresh when the sync engine reports new data from the
 * server via the factory's built-in `onSyncComplete()` listener.
 *
 * Debug logging is gated by the stellar-drive debug mode flag.
 * Enable it via `localStorage.setItem('<prefix>_debug_mode', 'true')`
 * to see detailed store operation traces in the console.
 */

import {
  engineCreate,
  engineUpdate,
  engineDelete,
  engineBatchWrite,
  engineGetAll
} from 'stellar-drive/data';
import type { BatchOperation } from 'stellar-drive/data';
import { generateId, now } from 'stellar-drive/utils';
import { createCollectionStore, remoteChangesStore } from 'stellar-drive/stores';
import { debug } from 'stellar-drive/utils';
import { supabase } from 'stellar-drive';
import type {
  Account,
  Transaction,
  Category,
  TellerEnrollment,
  RecurringTransaction
} from '$lib/types';

/* ── ML Sync (debounced triggers) ── */
import { syncRecurringDetections } from '$lib/ml/recurringSync';
import { syncCategorizationResults } from '$lib/ml/categorizationSync';
import { propagateCategory } from '$lib/ml/propagation';
import { autoSyncStaleEnrollments } from '$lib/teller/autoSync';
import { get } from 'svelte/store';

let mlSyncTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Run ML sync directly (non-debounced). Awaitable — resolves when
 * categorization + recurring detection are complete.
 */
async function runMLSyncNow(): Promise<void> {
  // Cancel any pending debounced sync — we're running immediately
  if (mlSyncTimeout) {
    clearTimeout(mlSyncTimeout);
    mlSyncTimeout = null;
  }
  try {
    debug('log', '[ML] Sync starting — auto-categorization then recurring detection');
    const txns = await syncCategorizationResults();
    await syncRecurringDetections(txns);
    debug('log', '[ML] Sync complete');
  } catch (e) {
    debug('error', '[ML] Sync error:', e);
  }
}

/**
 * Schedule ML sync operations (recurring detection + auto-categorization)
 * after a debounced delay. Used for user-initiated changes (category edits,
 * category deletion) where multiple rapid changes should be batched.
 */
function scheduleMLSync() {
  if (mlSyncTimeout) clearTimeout(mlSyncTimeout);
  debug('log', '[ML] Sync scheduled (500ms debounce)');
  mlSyncTimeout = setTimeout(() => runMLSyncNow(), 500);
}

/** System columns managed by stellar-drive — omit these from create payloads. */
type SystemKeys =
  | 'id'
  | 'user_id'
  | 'created_at'
  | 'updated_at'
  | 'deleted'
  | '_version'
  | 'device_id';

/* ═══════════════════════════════════════════════════════════════════════════
   ACCOUNTS STORE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Create the reactive accounts store.
 *
 * Provides read access to all accounts, manual account creation,
 * balance updates, and a manual refresh trigger.
 */
function createAccountsStore() {
  const store = createCollectionStore<Account>({
    load: async () => {
      const all = await engineGetAll('accounts');
      return all.filter((r) => !r.deleted) as unknown as Account[];
    }
  });

  return {
    ...store,
    async refresh() {
      debug('log', '[DATA] accounts — refreshing');
      await store.load();
      debug('log', '[DATA] accounts — refresh complete');
    },
    async createManualAccount(
      data: Omit<Account, SystemKeys | 'enrollment_id' | 'teller_account_id' | 'source'>
    ) {
      const id = generateId();
      debug('log', '[DATA] accounts — createManualAccount', { id });
      remoteChangesStore.recordLocalChange(id, 'accounts', 'create');
      await engineCreate('accounts', {
        id,
        ...data,
        enrollment_id: null,
        teller_account_id: null,
        source: 'manual'
      });
      await store.load();
      debug('log', '[DATA] accounts — createManualAccount complete', { id });
      return id;
    },
    async updateBalance(accountId: string, balance: string) {
      const account = (await engineGetAll('accounts')).find(
        (row) => row.id === accountId && !row.deleted
      ) as Account | undefined;
      if (!account) return;

      remoteChangesStore.recordLocalChange(accountId, 'accounts', 'update');
      if (account.type === 'credit') {
        const ledgerDelta = parseFloat(balance) - parseFloat(account.balance_ledger as string);
        const updatedBalanceAvailable =
          parseFloat(account.balance_available as string) - ledgerDelta;
        debug('log', '[DATA] accounts — updateBalance: credit account', {
          accountId,
          balance_ledger: balance,
          balance_available: updatedBalanceAvailable.toFixed(2)
        });
        await engineUpdate('accounts', accountId, {
          balance_ledger: balance,
          balance_available: updatedBalanceAvailable.toFixed(2),
          balance_updated_at: now()
        });
      } else {
        debug('log', '[DATA] accounts — updateBalance: depository account', {
          accountId,
          balance_ledger: balance,
          balance_available: balance
        });
        await engineUpdate('accounts', accountId, {
          balance_ledger: balance,
          balance_available: balance,
          balance_updated_at: now()
        });
      }
      await store.load();
      debug('log', '[DATA] accounts — updateBalance complete', { accountId });
    },
    async deleteAccount(accountId: string) {
      debug('log', '[DATA] accounts — deleteAccount', { accountId });

      // Cascade: delete all transactions belonging to this account first.
      // This ensures child records are removed from both IndexedDB and Supabase
      // (as soft-delete tombstones that will be garbage-collected).
      const allTxns = (await engineGetAll('transactions')) as unknown as Transaction[];
      const accountTxns = allTxns.filter((t) => t.account_id === accountId && !t.deleted);
      if (accountTxns.length > 0) {
        debug('log', '[DATA] accounts — cascade deleting', accountTxns.length, 'transactions');
        await Promise.all(
          accountTxns.map((t) => remoteChangesStore.markPendingDelete(t.id, 'transactions'))
        );
        const ops: BatchOperation[] = accountTxns.map((t) => ({
          type: 'delete' as const,
          table: 'transactions',
          id: t.id
        }));
        await engineBatchWrite(ops);
        debug('log', '[DATA] accounts — cascade delete complete');
      }

      await remoteChangesStore.markPendingDelete(accountId, 'accounts');
      await engineDelete('accounts', accountId);
      await store.load();
      debug('log', '[DATA] accounts — deleteAccount complete', { accountId });
    }
  };
}

/** Reactive store of all {@link Account} rows. */
export const accountsStore = createAccountsStore();

/* ═══════════════════════════════════════════════════════════════════════════
   TRANSACTIONS STORE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Create the reactive transactions store.
 *
 * Exposes read access plus targeted field-level updates for
 * categorisation, exclusion, and notes. Full transaction creation
 * happens via Teller ingestion, not through this store.
 */
function createTransactionsStore() {
  const store = createCollectionStore<Transaction>({
    load: async () => {
      const all = await engineGetAll('transactions');
      return all.filter((r) => !r.deleted) as unknown as Transaction[];
    }
  });

  return {
    ...store,
    async refresh() {
      debug('log', '[DATA] transactions — refreshing');
      await store.load();
      debug('log', '[DATA] transactions — refresh complete');
    },

    /* ── User-editable field updates ── */

    async updateDescription(transactionId: string, description: string) {
      debug('log', '[DATA] transactions — updateDescription', { transactionId });
      remoteChangesStore.recordLocalChange(transactionId, 'transactions', 'rename');
      await engineUpdate('transactions', transactionId, { description });
      await store.load();
      debug('log', '[DATA] transactions — updateDescription complete', { transactionId });
    },
    async updateDate(transactionId: string, date: string) {
      debug('log', '[DATA] transactions — updateDate', { transactionId, date });
      remoteChangesStore.recordLocalChange(transactionId, 'transactions', 'update');
      await engineUpdate('transactions', transactionId, { date });
      await store.load();
      debug('log', '[DATA] transactions — updateDate complete', { transactionId });
    },
    async updateCategory(transactionId: string, categoryId: string | null) {
      debug(
        'log',
        '[DATA] transactions — updateCategory START',
        { transactionId, categoryId },
        '(1 sync op queued: manual category write)'
      );
      remoteChangesStore.recordLocalChange(transactionId, 'transactions', 'update');
      await engineUpdate('transactions', transactionId, {
        category_id: categoryId,
        category_source: 'manual'
      });
      await store.load();

      // Propagate to similar transactions (works for both assigning and un-assigning)
      debug('log', '[DATA] transactions — starting propagation...');
      const result = await propagateCategory(transactionId, categoryId);
      if (result.propagatedCount > 0) {
        await store.load();
        debug(
          'log',
          `[DATA] transactions — propagated to ${result.propagatedCount} similar (${result.propagatedCount} more sync ops queued)`
        );
      } else {
        debug('log', '[DATA] transactions — no similar transactions to propagate to');
      }
      debug(
        'log',
        '[DATA] transactions — scheduling ML sync in 500ms (will queue more sync ops for auto-categorization + recurring updates)'
      );
      scheduleMLSync();
      return result.propagatedCount;
    },
    async toggleExcluded(transactionId: string, excluded: boolean) {
      debug('log', '[DATA] transactions — toggleExcluded', { transactionId, excluded });
      remoteChangesStore.recordLocalChange(transactionId, 'transactions', 'toggle');
      await engineUpdate('transactions', transactionId, { is_excluded: excluded });
      await store.load();
      debug('log', '[DATA] transactions — toggleExcluded complete', { transactionId });
    },
    async updateNotes(transactionId: string, notes: string) {
      debug('log', '[DATA] transactions — updateNotes', { transactionId });
      remoteChangesStore.recordLocalChange(transactionId, 'transactions', 'update');
      await engineUpdate('transactions', transactionId, { notes });
      await store.load();
      debug('log', '[DATA] transactions — updateNotes complete', { transactionId });
    },
    async updateRecurring(transactionId: string, isRecurring: boolean) {
      debug('log', '[DATA] transactions — updateRecurring', { transactionId, isRecurring });
      remoteChangesStore.recordLocalChange(transactionId, 'transactions', 'update');
      await engineUpdate('transactions', transactionId, { is_recurring: isRecurring });
      await store.load();
      debug('log', '[DATA] transactions — updateRecurring complete', { transactionId });
    },

    /* ── Delete operations ── */

    async deleteTransaction(transactionId: string) {
      debug('log', '[DATA] transactions — deleteTransaction', { transactionId });
      await remoteChangesStore.markPendingDelete(transactionId, 'transactions');
      await engineDelete('transactions', transactionId);
      await store.load();
      debug('log', '[DATA] transactions — deleteTransaction complete', { transactionId });
    },
    async bulkDelete(ids: string[]) {
      debug('log', '[DATA] transactions — bulkDelete', { count: ids.length });
      await Promise.all(ids.map((id) => remoteChangesStore.markPendingDelete(id, 'transactions')));
      const ops: BatchOperation[] = ids.map((id) => ({
        type: 'delete' as const,
        table: 'transactions',
        id
      }));
      await engineBatchWrite(ops);
      await store.load();
      debug('log', '[DATA] transactions — bulkDelete complete', { count: ids.length });
    },

    /* ── CSV Import ── */

    async bulkCreateFromCSV(
      transactions: Array<{
        date: string;
        description: string;
        amount: string;
        csv_import_hash: string;
      }>,
      accountId: string
    ) {
      debug('log', '[DATA] transactions — bulkCreateFromCSV', { count: transactions.length });

      // Dedup: get existing hashes from both IndexedDB and Supabase.
      // IndexedDB alone can be stale (app reinstall, cache clear, partial sync)
      // which causes duplicate key violations on the server's unique constraint.
      const all = (await engineGetAll('transactions')) as unknown as Transaction[];
      const existingHashes = new Set(
        all
          .filter((t) => t.account_id === accountId && t.csv_import_hash)
          .map((t) => t.csv_import_hash)
      );

      // Also check Supabase for hashes that might not be in local IndexedDB.
      // This is a targeted query (only csv_import_hash column) to minimize egress.
      // Paginate to avoid the default 1000-row limit — accounts with large transaction
      // histories would silently truncate, causing duplicate key violations on push.
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const PAGE_SIZE = 1000;
          let offset = 0;
          let hasMore = true;
          while (hasMore) {
            const { data: remoteHashes } = await supabase
              .from('radiant_transactions')
              .select('csv_import_hash')
              .eq('account_id', accountId)
              .not('csv_import_hash', 'is', null)
              .or('deleted.is.null,deleted.eq.false')
              .range(offset, offset + PAGE_SIZE - 1);
            if (remoteHashes) {
              for (const row of remoteHashes) {
                if (row.csv_import_hash) existingHashes.add(row.csv_import_hash);
              }
              hasMore = remoteHashes.length === PAGE_SIZE;
            } else {
              hasMore = false;
            }
            offset += PAGE_SIZE;
          }
          debug('log', '[DATA] transactions — bulkCreateFromCSV remote dedup', {
            localHashes: all.filter((t) => t.account_id === accountId && t.csv_import_hash).length,
            totalHashes: existingHashes.size
          });
        } catch (e) {
          debug('warn', '[DATA] transactions — remote dedup failed, using local only:', e);
        }
      }

      const newTxns = transactions.filter((t) => !existingHashes.has(t.csv_import_hash));
      debug('log', '[DATA] transactions — bulkCreateFromCSV dedup', {
        total: transactions.length,
        new: newTxns.length,
        skipped: transactions.length - newTxns.length
      });

      if (newTxns.length === 0) return { inserted: 0, skipped: transactions.length };

      const ops: BatchOperation[] = newTxns.map((t) => {
        const id = generateId();
        remoteChangesStore.recordLocalChange(id, 'transactions', 'create');
        return {
          type: 'create' as const,
          table: 'transactions',
          data: {
            id,
            account_id: accountId,
            teller_transaction_id: null,
            amount: t.amount,
            date: t.date,
            description: t.description,
            counterparty_name: null,
            counterparty_type: null,
            teller_category: null,
            category_id: null,
            status: 'posted',
            type: null,
            running_balance: null,
            is_excluded: false,
            is_recurring: false,
            category_source: null,
            notes: null,
            csv_import_hash: t.csv_import_hash
          }
        };
      });

      await engineBatchWrite(ops);
      await store.load();
      debug('log', '[DATA] transactions — bulkCreateFromCSV complete', {
        inserted: newTxns.length
      });
      return { inserted: newTxns.length, skipped: transactions.length - newTxns.length };
    }
  };
}

/** Reactive store of all {@link Transaction} rows. */
export const transactionsStore = createTransactionsStore();

/* ═══════════════════════════════════════════════════════════════════════════
   CATEGORIES STORE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Create the reactive categories store.
 *
 * Categories are user-defined labels (e.g. "Groceries", "Rent") that
 * can be applied to transactions. This store supports full CRUD.
 */
function createCategoriesStore() {
  const store = createCollectionStore<Category>({
    load: async () => {
      const all = await engineGetAll('categories');
      return all.filter((r) => !r.deleted) as unknown as Category[];
    }
  });

  return {
    ...store,
    async create(data: Omit<Category, SystemKeys>) {
      const id = generateId();
      debug('log', '[DATA] categories — create', { id });
      remoteChangesStore.recordLocalChange(id, 'categories', 'create');
      await engineCreate('categories', { id, ...data });
      await store.load();
      debug('log', '[DATA] categories — create complete', { id });
      return id;
    },
    async update(id: string, data: Partial<Category>) {
      debug('log', '[DATA] categories — update', { id });
      remoteChangesStore.recordLocalChange(id, 'categories', 'update');
      await engineUpdate('categories', id, data);
      await store.load();
      debug('log', '[DATA] categories — update complete', { id });
    },
    async remove(id: string) {
      debug('log', '[DATA] categories — remove', { id });

      // Uncategorize all transactions that reference this category and reset
      // category_source so ML sync can re-process them with remaining categories
      const allTxns = (await engineGetAll('transactions')) as unknown as Transaction[];
      const affected = allTxns.filter((t) => t.category_id === id && !t.deleted);
      if (affected.length > 0) {
        const ops: BatchOperation[] = affected.map((t) => ({
          type: 'update' as const,
          table: 'transactions',
          id: t.id,
          fields: { category_id: null, category_source: null }
        }));
        await engineBatchWrite(ops);
        debug('log', '[DATA] categories — uncategorized transactions', { count: affected.length });
      }

      await remoteChangesStore.markPendingDelete(id, 'categories');
      await engineDelete('categories', id);
      await store.load();
      debug('log', '[DATA] categories — remove complete', { id });

      // Re-process the now-uncategorized transactions via ML sync
      if (affected.length > 0) {
        scheduleMLSync();
      }
    },
    async refresh() {
      debug('log', '[DATA] categories — refreshing');
      await store.load();
      debug('log', '[DATA] categories — refresh complete');
    }
  };
}

/** Reactive store of all {@link Category} rows. */
export const categoriesStore = createCategoriesStore();

/* ═══════════════════════════════════════════════════════════════════════════
   ENROLLMENTS STORE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Create the reactive Teller enrollments store.
 *
 * Enrollments track connections to financial institutions via the
 * Teller API. Each enrollment maps to one linked bank and may hold
 * multiple accounts.
 */
function createEnrollmentsStore() {
  const store = createCollectionStore<TellerEnrollment>({
    load: async () => {
      const all = await engineGetAll('teller_enrollments');
      return all.filter((r) => !r.deleted) as unknown as TellerEnrollment[];
    }
  });

  return {
    ...store,
    async create(data: Omit<TellerEnrollment, SystemKeys>) {
      const id = generateId();
      debug('log', '[DATA] teller_enrollments — create', { id });
      remoteChangesStore.recordLocalChange(id, 'teller_enrollments', 'create');
      await engineCreate('teller_enrollments', { id, ...data });
      await store.load();
      debug('log', '[DATA] teller_enrollments — create complete', { id });
      return id;
    },
    async updateStatus(id: string, status: string, errorMessage?: string) {
      debug('log', '[DATA] teller_enrollments — updateStatus', { id, status });
      remoteChangesStore.recordLocalChange(id, 'teller_enrollments', 'update');
      await engineUpdate('teller_enrollments', id, {
        status,
        error_message: errorMessage || null,
        last_synced_at: now()
      });
      await store.load();
      debug('log', '[DATA] teller_enrollments — updateStatus complete', { id, status });
    },
    async updateAccessToken(id: string, accessToken: string) {
      debug('log', '[DATA] teller_enrollments — updateAccessToken', { id });
      remoteChangesStore.recordLocalChange(id, 'teller_enrollments', 'update');
      await engineUpdate('teller_enrollments', id, { access_token: accessToken });
      await store.load();
      debug('log', '[DATA] teller_enrollments — updateAccessToken complete', { id });
    },
    async remove(id: string) {
      debug('log', '[DATA] teller_enrollments — remove', { id });
      await remoteChangesStore.markPendingDelete(id, 'teller_enrollments');
      await engineDelete('teller_enrollments', id);
      await store.load();
      debug('log', '[DATA] teller_enrollments — remove complete', { id });
    },
    async refresh() {
      debug('log', '[DATA] teller_enrollments — refreshing');
      await store.load();
      debug('log', '[DATA] teller_enrollments — refresh complete');
    }
  };
}

/** Reactive store of all {@link TellerEnrollment} rows. */
export const enrollmentsStore = createEnrollmentsStore();

/* ═══════════════════════════════════════════════════════════════════════════
   RECURRING TRANSACTIONS STORE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Create the reactive recurring transactions store.
 *
 * Tracks recurring charges (subscriptions, rent, etc.). Entries may be
 * auto-detected by the ML pipeline or created manually by the user.
 * All fields are fully user-editable regardless of source.
 */
function createRecurringTransactionsStore() {
  const store = createCollectionStore<RecurringTransaction>({
    load: async () => {
      const all = await engineGetAll('recurring_transactions');
      return all.filter((r) => !r.deleted) as unknown as RecurringTransaction[];
    }
  });

  return {
    ...store,
    async refresh() {
      debug('log', '[DATA] recurring_transactions — refreshing');
      await store.load();
      debug('log', '[DATA] recurring_transactions — refresh complete');
    },
    async create(data: Omit<RecurringTransaction, SystemKeys>) {
      const id = generateId();
      debug('log', '[DATA] recurring_transactions — create', { id, name: data.name });
      remoteChangesStore.recordLocalChange(id, 'recurring_transactions', 'create');
      await engineCreate('recurring_transactions', { id, ...data });
      await store.load();
      debug('log', '[DATA] recurring_transactions — create complete', { id });
      return id;
    },
    async update(id: string, data: Partial<RecurringTransaction>) {
      debug('log', '[DATA] recurring_transactions — update', { id });
      remoteChangesStore.recordLocalChange(id, 'recurring_transactions', 'update');
      await engineUpdate('recurring_transactions', id, data);
      await store.load();
      debug('log', '[DATA] recurring_transactions — update complete', { id });
    },
    async remove(id: string) {
      debug('log', '[DATA] recurring_transactions — remove', { id });

      // Clear is_recurring on all transactions that were matched by this entry.
      // Re-run full recurring sync to recompute is_recurring flags correctly.
      await remoteChangesStore.markPendingDelete(id, 'recurring_transactions');
      await engineDelete('recurring_transactions', id);
      await store.load();

      // Schedule ML sync to re-sync is_recurring flags immediately
      // (the sync will clear stale flags and re-mark valid ones)
      scheduleMLSync();

      debug('log', '[DATA] recurring_transactions — remove complete', { id });
    }
  };
}

/** Reactive store of all {@link RecurringTransaction} rows. */
export const recurringTransactionsStore = createRecurringTransactionsStore();

/* ═══════════════════════════════════════════════════════════════════════════
   CENTRALIZED PRELOAD + BACKGROUND SYNC
   ═══════════════════════════════════════════════════════════════════════════ */

let preloadPromise: Promise<void> | null = null;

/**
 * Preload all data stores from IndexedDB. Idempotent — returns the same
 * promise on subsequent calls so pages can `await` it cheaply.
 *
 * Does NOT trigger ML sync or Teller sync — those are handled by
 * `initializeApp()` which should be awaited before rendering pages.
 */
export function preloadAllStores(): Promise<void> {
  if (preloadPromise) return preloadPromise;
  preloadPromise = Promise.all([
    accountsStore.load(),
    transactionsStore.load(),
    categoriesStore.load(),
    enrollmentsStore.load(),
    recurringTransactionsStore.load()
  ]).then(() => {});
  return preloadPromise;
}

let initPromise: Promise<void> | null = null;

/**
 * Initialize app data from IndexedDB. Fast and local-only — loads all
 * stores so the page can render immediately with cached data.
 * Teller sync + ML sync run separately via `startBackgroundSync()`.
 *
 * @returns Promise that resolves when local data is ready to display
 */
export function initializeApp(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await preloadAllStores();
    debug('log', '[INIT] Stores loaded from IndexedDB — page ready');
  })();
  return initPromise;
}

let backgroundSyncStarted = false;

/**
 * Start Teller sync + ML processing in the background. Fires immediately
 * after `initializeApp()` resolves (no artificial delay) but does NOT
 * block page rendering. When complete, stores are silently updated and
 * the callback fires so the UI can show a toast.
 *
 * Sequence:
 * 1. Teller sync — fetch new transactions from bank APIs
 * 2. Reload transaction/account stores with new data
 * 3. ML sync — auto-categorize + detect recurring (runs on ALL data)
 * 4. Reload stores so ML-written data is visible
 *
 * @param onNewTransactions — callback with count of new Teller transactions
 */
export async function startBackgroundSync(
  onNewTransactions?: (count: number) => void
): Promise<void> {
  if (backgroundSyncStarted) return;
  backgroundSyncStarted = true;

  // Wait for local data to be loaded first
  await initializeApp();

  // 1. Teller sync for stale enrollments
  let newTellerCount = 0;
  const enrollments = (get(enrollmentsStore) ?? []) as TellerEnrollment[];
  if (enrollments.length > 0) {
    try {
      newTellerCount = await autoSyncStaleEnrollments(enrollments, (id, status) =>
        enrollmentsStore.updateStatus(id, status)
      );
      if (newTellerCount > 0) {
        // 2. Reload stores so ML sees the new Teller transactions
        await Promise.all([transactionsStore.load(), accountsStore.load()]);
        debug('log', `[SYNC] Teller: ${newTellerCount} new transactions loaded`);
      } else {
        debug('log', '[SYNC] Teller: no new transactions');
      }
    } catch (err) {
      debug('warn', '[SYNC] Teller sync failed:', err);
    }
  }

  // 3. ML sync — runs on all data (existing + any new Teller transactions)
  await runMLSyncNow();

  // 4. Reload stores so ML-written data (categories, recurring) is visible
  await Promise.all([transactionsStore.load(), recurringTransactionsStore.load()]);
  debug('log', '[SYNC] ML sync complete, stores refreshed');

  if (newTellerCount > 0) {
    onNewTransactions?.(newTellerCount);
  }

  debug('log', '[SYNC] Background sync complete');
}
