/**
 * @fileoverview Reactive data stores for Radiant Finance.
 *
 * Each store wraps a local-first query and exposes CRUD operations
 * that write optimistically to IndexedDB and queue sync to Supabase.
 *
 * Stores auto-refresh when the sync engine reports new data from the
 * server via `onSyncComplete()`.
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
import { createCollectionStore, onSyncComplete, remoteChangesStore } from 'stellar-drive/stores';
import { debug } from 'stellar-drive/utils';
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

let mlSyncTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedule ML sync operations (recurring detection + auto-categorization)
 * after a debounced delay. Safe to call repeatedly — only the last call
 * within the delay window triggers the actual sync.
 */
function scheduleMLSync() {
  if (mlSyncTimeout) clearTimeout(mlSyncTimeout);
  mlSyncTimeout = setTimeout(async () => {
    try {
      await syncCategorizationResults();
      await syncRecurringDetections();
    } catch (e) {
      debug('error', '[ML] Sync error:', e);
    }
  }, 1500);
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
    load: () => engineGetAll('accounts') as unknown as Promise<Account[]>
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
      debug('log', '[DATA] accounts — updateBalance', { accountId, balance });
      remoteChangesStore.recordLocalChange(accountId, 'accounts', 'update');
      await engineUpdate('accounts', accountId, {
        balance_ledger: balance,
        balance_available: balance,
        balance_updated_at: now()
      });
      await store.load();
      debug('log', '[DATA] accounts — updateBalance complete', { accountId });
    },
    async deleteAccount(accountId: string) {
      debug('log', '[DATA] accounts — deleteAccount', { accountId });
      await remoteChangesStore.markPendingDelete(accountId, 'accounts');
      await engineDelete('accounts', accountId);
      await store.load();
      debug('log', '[DATA] accounts — deleteAccount complete', { accountId });
    }
  };
}

/** Reactive store of all {@link Account} rows. */
export const accountsStore = createAccountsStore();
onSyncComplete(() => accountsStore.refresh());

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
    load: () => engineGetAll('transactions') as unknown as Promise<Transaction[]>
  });

  return {
    ...store,
    async refresh() {
      debug('log', '[DATA] transactions — refreshing');
      await store.load();
      debug('log', '[DATA] transactions — refresh complete');
      scheduleMLSync();
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
      debug('log', '[DATA] transactions — updateCategory', { transactionId, categoryId });
      remoteChangesStore.recordLocalChange(transactionId, 'transactions', 'update');
      await engineUpdate('transactions', transactionId, { category_id: categoryId });
      await store.load();
      debug('log', '[DATA] transactions — updateCategory complete', { transactionId });

      // Propagate to similar transactions + retrain classifier, then run remaining ML sync
      if (categoryId) {
        const result = await propagateCategory(transactionId, categoryId);
        if (result.propagatedCount > 0) {
          await store.load();
          debug(
            'log',
            '[DATA] transactions — propagated category to',
            result.propagatedCount,
            'similar'
          );
        }
        scheduleMLSync();
        return result.propagatedCount;
      }
      scheduleMLSync();
      return 0;
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

      // Dedup: get existing hashes for this account
      const all = (await engineGetAll('transactions')) as unknown as Transaction[];
      const existingHashes = new Set(
        all
          .filter((t) => t.account_id === accountId && t.csv_import_hash)
          .map((t) => t.csv_import_hash)
      );

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
            is_auto_categorized: false,
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
onSyncComplete(() => transactionsStore.refresh());

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
    load: () => engineGetAll('categories') as unknown as Promise<Category[]>
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

      // Uncategorize all transactions that reference this category
      const allTxns = (await engineGetAll('transactions')) as unknown as Transaction[];
      const affected = allTxns.filter((t) => t.category_id === id && !t.deleted);
      if (affected.length > 0) {
        const ops: BatchOperation[] = affected.map((t) => ({
          type: 'update' as const,
          table: 'transactions',
          id: t.id,
          fields: { category_id: null }
        }));
        await engineBatchWrite(ops);
        debug('log', '[DATA] categories — uncategorized transactions', { count: affected.length });
      }

      await remoteChangesStore.markPendingDelete(id, 'categories');
      await engineDelete('categories', id);
      await store.load();
      debug('log', '[DATA] categories — remove complete', { id });
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
onSyncComplete(() => categoriesStore.refresh());

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
    load: () => engineGetAll('teller_enrollments') as unknown as Promise<TellerEnrollment[]>
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
onSyncComplete(() => enrollmentsStore.refresh());

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
    load: () => engineGetAll('recurring_transactions') as unknown as Promise<RecurringTransaction[]>
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
      await remoteChangesStore.markPendingDelete(id, 'recurring_transactions');
      await engineDelete('recurring_transactions', id);
      await store.load();
      debug('log', '[DATA] recurring_transactions — remove complete', { id });
    }
  };
}

/** Reactive store of all {@link RecurringTransaction} rows. */
export const recurringTransactionsStore = createRecurringTransactionsStore();
onSyncComplete(() => recurringTransactionsStore.refresh());
