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

import { engineCreate, engineUpdate, engineDelete, engineGetAll, generateId } from 'stellar-drive';
import { createCollectionStore, onSyncComplete } from 'stellar-drive/stores';
import { debug } from 'stellar-drive/utils';
import type { Account, Transaction, Category, TellerEnrollment } from '$lib/types';
import { now } from 'stellar-drive';

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
 * Provides read access to all accounts and a manual refresh trigger.
 * Accounts are created/updated via Teller enrollment flows, not directly
 * through this store.
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
    },
    async updateCategory(transactionId: string, categoryId: string | null) {
      debug('log', '[DATA] transactions — updateCategory', { transactionId, categoryId });
      await engineUpdate('transactions', transactionId, { category_id: categoryId });
      debug('log', '[DATA] transactions — updateCategory complete', { transactionId });
    },
    async toggleExcluded(transactionId: string, excluded: boolean) {
      debug('log', '[DATA] transactions — toggleExcluded', { transactionId, excluded });
      await engineUpdate('transactions', transactionId, { is_excluded: excluded });
      debug('log', '[DATA] transactions — toggleExcluded complete', { transactionId });
    },
    async updateNotes(transactionId: string, notes: string) {
      debug('log', '[DATA] transactions — updateNotes', { transactionId });
      await engineUpdate('transactions', transactionId, { notes });
      debug('log', '[DATA] transactions — updateNotes complete', { transactionId });
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
      await engineCreate('categories', { id, ...data });
      await store.load();
      debug('log', '[DATA] categories — create complete', { id });
      return id;
    },
    async update(id: string, data: Partial<Category>) {
      debug('log', '[DATA] categories — update', { id });
      await engineUpdate('categories', id, data);
      await store.load();
      debug('log', '[DATA] categories — update complete', { id });
    },
    async remove(id: string) {
      debug('log', '[DATA] categories — remove', { id });
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
      await engineCreate('teller_enrollments', { id, ...data });
      await store.load();
      debug('log', '[DATA] teller_enrollments — create complete', { id });
      return id;
    },
    async updateStatus(id: string, status: string, errorMessage?: string) {
      debug('log', '[DATA] teller_enrollments — updateStatus', { id, status });
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
