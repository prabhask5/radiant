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
  engineGetAll,
  generateId,
  now
} from 'stellar-drive';
import { createCollectionStore, onSyncComplete } from 'stellar-drive/stores';
import { debug } from 'stellar-drive/utils';
import type {
  Account,
  Transaction,
  Category,
  Budget,
  RecurringTransaction,
  NetWorthSnapshot,
  UserSettings,
  CategoryRule,
  TellerEnrollment
} from '$lib/types';

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
 *
 * @returns A collection store with an additional `refresh` method.
 */
function createAccountsStore() {
  const store = createCollectionStore<Account>({
    load: () => engineGetAll('accounts') as unknown as Promise<Account[]>
  });

  return {
    ...store,
    /**
     * Reload accounts from the local database.
     *
     * Called automatically on sync completion and can be invoked
     * manually when the UI needs to reflect a known change.
     */
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
 *
 * @returns A collection store with category, exclusion, and notes update methods.
 */
function createTransactionsStore() {
  const store = createCollectionStore<Transaction>({
    load: () => engineGetAll('transactions') as unknown as Promise<Transaction[]>
  });

  return {
    ...store,
    /**
     * Reload transactions from the local database.
     */
    async refresh() {
      debug('log', '[DATA] transactions — refreshing');
      await store.load();
      debug('log', '[DATA] transactions — refresh complete');
    },
    /**
     * Assign or clear a category on a transaction.
     *
     * @param transactionId - The transaction to update.
     * @param categoryId    - The new category ID, or `null` to clear.
     */
    async updateCategory(transactionId: string, categoryId: string | null) {
      debug('log', '[DATA] transactions — updateCategory', { transactionId, categoryId });
      await engineUpdate('transactions', transactionId, { category_id: categoryId });
      debug('log', '[DATA] transactions — updateCategory complete', { transactionId });
    },
    /**
     * Toggle the exclusion flag on a transaction.
     *
     * Excluded transactions are hidden from budgets and spending reports.
     *
     * @param transactionId - The transaction to update.
     * @param excluded      - `true` to exclude, `false` to include.
     */
    async toggleExcluded(transactionId: string, excluded: boolean) {
      debug('log', '[DATA] transactions — toggleExcluded', { transactionId, excluded });
      await engineUpdate('transactions', transactionId, { is_excluded: excluded });
      debug('log', '[DATA] transactions — toggleExcluded complete', { transactionId });
    },
    /**
     * Update the user-provided notes on a transaction.
     *
     * @param transactionId - The transaction to update.
     * @param notes         - Free-form text to attach.
     */
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
 *
 * @returns A collection store with `create`, `update`, and `remove` methods.
 */
function createCategoriesStore() {
  const store = createCollectionStore<Category>({
    load: () => engineGetAll('categories') as unknown as Promise<Category[]>
  });

  return {
    ...store,
    /**
     * Create a new category.
     *
     * @param data - Category fields (system columns are auto-populated).
     * @returns The generated ID of the new category.
     */
    async create(data: Omit<Category, SystemKeys>) {
      const id = generateId();
      debug('log', '[DATA] categories — create', { id });
      await engineCreate('categories', { id, ...data });
      await store.load();
      debug('log', '[DATA] categories — create complete', { id });
      return id;
    },
    /**
     * Partially update an existing category.
     *
     * @param id   - The category to update.
     * @param data - Fields to merge into the existing record.
     */
    async update(id: string, data: Partial<Category>) {
      debug('log', '[DATA] categories — update', { id });
      await engineUpdate('categories', id, data);
      await store.load();
      debug('log', '[DATA] categories — update complete', { id });
    },
    /**
     * Soft-delete a category.
     *
     * @param id - The category to remove.
     */
    async remove(id: string) {
      debug('log', '[DATA] categories — remove', { id });
      await engineDelete('categories', id);
      await store.load();
      debug('log', '[DATA] categories — remove complete', { id });
    },
    /**
     * Reload categories from the local database.
     */
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
   BUDGETS STORE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Create the reactive budgets store.
 *
 * Budgets define spending limits per category for a given period.
 * Supports full CRUD operations.
 *
 * @returns A collection store with `create`, `update`, and `remove` methods.
 */
function createBudgetsStore() {
  const store = createCollectionStore<Budget>({
    load: () => engineGetAll('budgets') as unknown as Promise<Budget[]>
  });

  return {
    ...store,
    /**
     * Create a new budget.
     *
     * @param data - Budget fields (system columns are auto-populated).
     * @returns The generated ID of the new budget.
     */
    async create(data: Omit<Budget, SystemKeys>) {
      const id = generateId();
      debug('log', '[DATA] budgets — create', { id });
      await engineCreate('budgets', { id, ...data });
      await store.load();
      debug('log', '[DATA] budgets — create complete', { id });
      return id;
    },
    /**
     * Partially update an existing budget.
     *
     * @param id   - The budget to update.
     * @param data - Fields to merge into the existing record.
     */
    async update(id: string, data: Partial<Budget>) {
      debug('log', '[DATA] budgets — update', { id });
      await engineUpdate('budgets', id, data);
      await store.load();
      debug('log', '[DATA] budgets — update complete', { id });
    },
    /**
     * Soft-delete a budget.
     *
     * @param id - The budget to remove.
     */
    async remove(id: string) {
      debug('log', '[DATA] budgets — remove', { id });
      await engineDelete('budgets', id);
      await store.load();
      debug('log', '[DATA] budgets — remove complete', { id });
    },
    /**
     * Reload budgets from the local database.
     */
    async refresh() {
      debug('log', '[DATA] budgets — refreshing');
      await store.load();
      debug('log', '[DATA] budgets — refresh complete');
    }
  };
}

/** Reactive store of all {@link Budget} rows. */
export const budgetsStore = createBudgetsStore();
onSyncComplete(() => budgetsStore.refresh());

/* ═══════════════════════════════════════════════════════════════════════════
   ENROLLMENTS STORE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Create the reactive Teller enrollments store.
 *
 * Enrollments track connections to financial institutions via the
 * Teller API. Each enrollment maps to one linked bank and may hold
 * multiple accounts.
 *
 * @returns A collection store with `create`, `updateStatus`, and `remove` methods.
 */
function createEnrollmentsStore() {
  const store = createCollectionStore<TellerEnrollment>({
    load: () => engineGetAll('teller_enrollments') as unknown as Promise<TellerEnrollment[]>
  });

  return {
    ...store,
    /**
     * Create a new Teller enrollment record.
     *
     * @param data - Enrollment fields (system columns are auto-populated).
     * @returns The generated ID of the new enrollment.
     */
    async create(data: Omit<TellerEnrollment, SystemKeys>) {
      const id = generateId();
      debug('log', '[DATA] teller_enrollments — create', { id });
      await engineCreate('teller_enrollments', { id, ...data });
      await store.load();
      debug('log', '[DATA] teller_enrollments — create complete', { id });
      return id;
    },
    /**
     * Update the sync status of an enrollment.
     *
     * Also stamps `last_synced_at` with the current time. Optionally
     * records an error message when the status indicates a failure.
     *
     * @param id           - The enrollment to update.
     * @param status       - New status string (e.g. `'connected'`, `'error'`).
     * @param errorMessage - Optional human-readable error detail.
     */
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
    /**
     * Soft-delete an enrollment and its associated accounts.
     *
     * @param id - The enrollment to remove.
     */
    async remove(id: string) {
      debug('log', '[DATA] teller_enrollments — remove', { id });
      await engineDelete('teller_enrollments', id);
      await store.load();
      debug('log', '[DATA] teller_enrollments — remove complete', { id });
    },
    /**
     * Reload enrollments from the local database.
     */
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
 * Recurring transactions are auto-detected patterns (e.g. monthly
 * subscriptions). This is a read-only store — the detection logic
 * populates the table server-side.
 *
 * @returns A collection store with a `refresh` method.
 */
function createRecurringStore() {
  const store = createCollectionStore<RecurringTransaction>({
    load: () => engineGetAll('recurring_transactions') as unknown as Promise<RecurringTransaction[]>
  });

  return {
    ...store,
    /**
     * Reload recurring transactions from the local database.
     */
    async refresh() {
      debug('log', '[DATA] recurring_transactions — refreshing');
      await store.load();
      debug('log', '[DATA] recurring_transactions — refresh complete');
    }
  };
}

/** Reactive store of all {@link RecurringTransaction} rows. */
export const recurringStore = createRecurringStore();
onSyncComplete(() => recurringStore.refresh());

/* ═══════════════════════════════════════════════════════════════════════════
   NET WORTH STORE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Create the reactive net worth snapshots store.
 *
 * Snapshots record the user's total net worth at a point in time,
 * enabling historical trend charts. Generated server-side during
 * account sync.
 *
 * @returns A collection store with a `refresh` method.
 */
function createNetWorthStore() {
  const store = createCollectionStore<NetWorthSnapshot>({
    load: () => engineGetAll('net_worth_snapshots') as unknown as Promise<NetWorthSnapshot[]>
  });

  return {
    ...store,
    /**
     * Reload net worth snapshots from the local database.
     */
    async refresh() {
      debug('log', '[DATA] net_worth_snapshots — refreshing');
      await store.load();
      debug('log', '[DATA] net_worth_snapshots — refresh complete');
    }
  };
}

/** Reactive store of all {@link NetWorthSnapshot} rows. */
export const netWorthStore = createNetWorthStore();
onSyncComplete(() => netWorthStore.refresh());

/* ═══════════════════════════════════════════════════════════════════════════
   USER SETTINGS STORE (SINGLETON)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Create the reactive user settings store (singleton).
 *
 * The `user_settings` table holds at most one row per user.
 * The `update` method performs an upsert — updating the existing
 * row if present, or creating one with sensible defaults otherwise.
 *
 * @returns A collection store with a singleton-aware `update` method.
 */
function createSettingsStore() {
  const store = createCollectionStore<UserSettings>({
    load: () => engineGetAll('user_settings') as unknown as Promise<UserSettings[]>
  });

  return {
    ...store,
    /**
     * Upsert user settings.
     *
     * If a settings row already exists it is partially updated.
     * Otherwise a new row is created with application defaults
     * merged with the provided overrides.
     *
     * @param data - Partial settings to apply.
     */
    async update(data: Partial<UserSettings>) {
      debug('log', '[DATA] user_settings — update (upsert)');
      const current = (await engineGetAll('user_settings')) as unknown as UserSettings[];
      if (current.length > 0) {
        debug('log', '[DATA] user_settings — updating existing row', { id: current[0].id });
        await engineUpdate('user_settings', current[0].id, data);
      } else {
        const id = generateId();
        debug('log', '[DATA] user_settings — creating default row', { id });
        await engineCreate('user_settings', {
          id,
          currency: 'USD',
          locale: 'en-US',
          auto_sync_enabled: true,
          auto_sync_interval_minutes: 60,
          auto_categorize: true,
          show_cents: true,
          fiscal_month_start_day: 1,
          ...data
        });
      }
      await store.load();
      debug('log', '[DATA] user_settings — update complete');
    },
    /**
     * Reload user settings from the local database.
     */
    async refresh() {
      debug('log', '[DATA] user_settings — refreshing');
      await store.load();
      debug('log', '[DATA] user_settings — refresh complete');
    }
  };
}

/** Reactive store of the singleton {@link UserSettings} row. */
export const settingsStore = createSettingsStore();
onSyncComplete(() => settingsStore.refresh());

/* ═══════════════════════════════════════════════════════════════════════════
   CATEGORY RULES STORE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Create the reactive category rules store.
 *
 * Category rules define pattern-matching logic that auto-assigns a
 * category to incoming transactions based on merchant name or
 * description substring matches.
 *
 * @returns A collection store with `create` and `remove` methods.
 */
function createCategoryRulesStore() {
  const store = createCollectionStore<CategoryRule>({
    load: () => engineGetAll('category_rules') as unknown as Promise<CategoryRule[]>
  });

  return {
    ...store,
    /**
     * Create a new category rule.
     *
     * @param data - Rule fields (system columns are auto-populated).
     * @returns The generated ID of the new rule.
     */
    async create(data: Omit<CategoryRule, SystemKeys>) {
      const id = generateId();
      debug('log', '[DATA] category_rules — create', { id });
      await engineCreate('category_rules', { id, ...data });
      await store.load();
      debug('log', '[DATA] category_rules — create complete', { id });
      return id;
    },
    /**
     * Soft-delete a category rule.
     *
     * @param id - The rule to remove.
     */
    async remove(id: string) {
      debug('log', '[DATA] category_rules — remove', { id });
      await engineDelete('category_rules', id);
      await store.load();
      debug('log', '[DATA] category_rules — remove complete', { id });
    },
    /**
     * Reload category rules from the local database.
     */
    async refresh() {
      debug('log', '[DATA] category_rules — refreshing');
      await store.load();
      debug('log', '[DATA] category_rules — refresh complete');
    }
  };
}

/** Reactive store of all {@link CategoryRule} rows. */
export const categoryRulesStore = createCategoryRulesStore();
onSyncComplete(() => categoryRulesStore.refresh());
