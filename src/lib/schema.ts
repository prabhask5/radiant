/**
 * @fileoverview Declarative schema definition for Radiant Finance.
 *
 * This file is the single source of truth for the database schema. It is
 * consumed in two places:
 *
 * 1. **Runtime** — imported by `+layout.ts` and passed to `initEngine()` to
 *    configure IndexedDB (Dexie) stores and table configs.
 *
 * 2. **Build / dev time** — loaded by the `stellarPWA` Vite plugin to
 *    auto-generate TypeScript types (`src/lib/types.generated.ts`) and
 *    push Supabase migration SQL when the schema changes.
 *
 * Tables model a personal finance tracker: bank accounts, transactions,
 * budgets, categories, investments, and net-worth snapshots — all synced
 * via Teller.io and persisted locally + remotely through stellar-drive.
 */

import type { SchemaDefinition } from 'stellar-drive/types';

export const schema: SchemaDefinition = {
  /* ═══════════════════════════════════════════════════════════════════════
     TELLER ENROLLMENTS — Connected financial institution sessions
     ═══════════════════════════════════════════════════════════════════════

     Stores active Teller.io enrollment sessions. Each enrollment represents
     a user's connection to a specific bank or credit union. The access token
     is used by the server-side Teller API proxy to fetch accounts and
     transactions.

     Relationships:
       - One enrollment → many `accounts` (via `accounts.enrollment_id`)

     Indexes:
       - `institution_name` — filter/sort enrollments by bank
       - `status` — quickly find connected vs disconnected/error enrollments
     ═══════════════════════════════════════════════════════════════════════ */
  teller_enrollments: {
    indexes: 'institution_name, status',
    fields: {
      enrollment_id: 'string',
      institution_name: 'string',
      institution_id: 'string',
      access_token: 'string',
      status: 'string',
      last_synced_at: 'timestamp?',
      error_message: 'string?'
    }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     ACCOUNTS — Bank, credit card, and investment accounts
     ═══════════════════════════════════════════════════════════════════════

     Stores individual financial accounts pulled from Teller.io. Each account
     belongs to exactly one enrollment and tracks current balances, account
     type metadata, and visibility state.

     Relationships:
       - Many accounts → one `teller_enrollments` (via `enrollment_id`)
       - One account → many `transactions` (via `transactions.account_id`)
       - One account → many `recurring_transactions` (via `recurring_transactions.account_id`)

     Indexes:
       - `enrollment_id` — join back to the parent enrollment
       - `type` / `subtype` — filter by depository vs credit, checking vs savings
       - `status` — distinguish open vs closed accounts
       - `institution_name` — group accounts by bank for display
     ═══════════════════════════════════════════════════════════════════════ */
  accounts: {
    indexes: 'enrollment_id, type, subtype, status, institution_name',
    fields: {
      enrollment_id: 'uuid',
      teller_account_id: 'string',
      institution_name: 'string',
      name: 'string',
      type: 'string',
      subtype: 'string',
      currency: 'string',
      last_four: 'string?',
      status: 'string',
      balance_available: 'string?',
      balance_ledger: 'string?',
      balance_updated_at: 'timestamp?',
      is_hidden: 'boolean'
    }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     TRANSACTIONS — Individual financial transactions from Teller
     ═══════════════════════════════════════════════════════════════════════

     Stores individual debit/credit transactions synced from Teller.io. Each
     transaction belongs to one account and may be assigned a user-defined
     category. Amounts are stored as decimal strings to avoid floating-point
     precision issues.

     Relationships:
       - Many transactions → one `accounts` (via `account_id`, ownership FK)
       - Many transactions → one `categories` (via `category_id`, nullable)

     Indexes:
       - `account_id` — filter transactions for a given account
       - `date` — sort/range-query by transaction date
       - `category_id` — aggregate spending per category
       - `status` — distinguish posted vs pending transactions
       - `[account_id+date]` — compound index for efficient per-account date queries
     ═══════════════════════════════════════════════════════════════════════ */
  transactions: {
    indexes: 'account_id, date, category_id, status, [account_id+date]',
    ownership: { parent: 'accounts', fk: 'account_id' },
    fields: {
      account_id: 'uuid',
      teller_transaction_id: 'string',
      amount: 'string',
      date: 'date',
      description: 'string',
      counterparty_name: 'string?',
      counterparty_type: 'string?',
      teller_category: 'string?',
      category_id: 'uuid?',
      status: 'string',
      type: 'string?',
      running_balance: 'string?',
      is_excluded: 'boolean',
      notes: 'string?'
    }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     CATEGORIES — User-defined transaction categories
     ═══════════════════════════════════════════════════════════════════════

     Stores the user's category taxonomy for classifying transactions. Supports
     a single level of nesting via `parent_id` (subcategories). Each category
     has display metadata (icon, color) and an optional mapping to Teller's
     built-in category labels for auto-categorization.

     Relationships:
       - One category → many `transactions` (via `transactions.category_id`)
       - One category → many `budgets` (via `budgets.category_id`)
       - One category → many `category_rules` (via `category_rules.category_id`)
       - Self-referential: `parent_id` → `categories.id` for subcategories

     Indexes:
       - `parent_id` — fetch subcategories for a given parent
       - `type` — filter expense vs income vs transfer categories
       - `order` — maintain user-defined display order
     ═══════════════════════════════════════════════════════════════════════ */
  categories: {
    indexes: 'parent_id, type, order',
    fields: {
      name: 'string',
      icon: 'string',
      color: 'string',
      type: 'string',
      parent_id: 'uuid?',
      teller_categories: 'json?',
      order: 'number'
    }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     BUDGETS — Monthly spending budgets per category
     ═══════════════════════════════════════════════════════════════════════

     Defines spending limits tied to a specific category. Each budget tracks
     a target amount and period type (monthly, weekly, yearly). The optional
     `rollover` flag allows unspent amounts to carry forward into the next
     period.

     Relationships:
       - Many budgets → one `categories` (via `category_id`)
       - One budget → many `budget_periods` (via `budget_periods.budget_id`)

     Indexes:
       - `category_id` — look up the budget for a given category
       - `period_type` — filter by monthly vs weekly vs yearly budgets
       - `order` — maintain user-defined display order
     ═══════════════════════════════════════════════════════════════════════ */
  budgets: {
    indexes: 'category_id, period_type, order',
    fields: {
      category_id: 'uuid',
      name: 'string',
      amount: 'string',
      period_type: 'string',
      start_date: 'date?',
      is_active: 'boolean',
      color: 'string?',
      icon: 'string?',
      rollover: 'boolean',
      order: 'number'
    }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     BUDGET PERIODS — Monthly snapshots of budget spend tracking
     ═══════════════════════════════════════════════════════════════════════

     Materializes per-period budget progress. Each row captures the budgeted
     amount, actual spend, and optional rollover from the previous period for
     a single budget in a single month. This avoids recomputing historical
     budget data from raw transactions.

     Relationships:
       - Many budget_periods → one `budgets` (via `budget_id`, ownership FK)

     Indexes:
       - `budget_id` — fetch all periods for a given budget
       - `month` — filter periods by month (YYYY-MM format)
       - `[budget_id+month]` — compound index for efficient lookup of a
         specific budget's data in a specific month
     ═══════════════════════════════════════════════════════════════════════ */
  budget_periods: {
    indexes: 'budget_id, month, [budget_id+month]',
    ownership: { parent: 'budgets', fk: 'budget_id' },
    fields: {
      budget_id: 'uuid',
      month: 'string',
      budgeted_amount: 'string',
      spent_amount: 'string',
      rollover_amount: 'string?'
    }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     RECURRING TRANSACTIONS — Bills and subscriptions detected or manual
     ═══════════════════════════════════════════════════════════════════════

     Tracks repeating charges such as subscriptions, utility bills, and
     recurring income. Entries can be auto-detected from transaction patterns
     or manually created. Used for cash-flow forecasting and upcoming bill
     reminders.

     Relationships:
       - Many recurring_transactions → one `accounts` (via `account_id`, nullable)
       - Many recurring_transactions → one `categories` (via `category_id`, nullable)

     Indexes:
       - `account_id` — filter recurring items by source account
       - `category_id` — group by spending category
       - `frequency` — filter by weekly, monthly, quarterly, yearly
       - `next_expected_date` — sort by upcoming due dates for reminders
     ═══════════════════════════════════════════════════════════════════════ */
  recurring_transactions: {
    indexes: 'account_id, category_id, frequency, next_expected_date',
    fields: {
      account_id: 'uuid?',
      category_id: 'uuid?',
      name: 'string',
      amount: 'string',
      frequency: 'string',
      next_expected_date: 'date?',
      last_occurrence_date: 'date?',
      is_active: 'boolean',
      is_bill: 'boolean',
      merchant_name: 'string?',
      notes: 'string?'
    }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     NET WORTH SNAPSHOTS — Point-in-time net worth calculations
     ═══════════════════════════════════════════════════════════════════════

     Stores periodic snapshots of the user's total financial position. Each
     snapshot sums all asset accounts (depository) and liability accounts
     (credit) to compute a net worth figure. The `breakdown` JSON field
     stores per-account contributions for drill-down views.

     Relationships:
       - Standalone — references account data indirectly via `breakdown` JSON

     Indexes:
       - `date` — sort/range-query snapshots chronologically for trend charts
     ═══════════════════════════════════════════════════════════════════════ */
  net_worth_snapshots: {
    indexes: 'date',
    fields: {
      date: 'date',
      total_assets: 'string',
      total_liabilities: 'string',
      net_worth: 'string',
      breakdown: 'json?'
    }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     SPENDING INSIGHTS — Pre-computed spending analytics
     ═══════════════════════════════════════════════════════════════════════

     Caches pre-computed analytics results to avoid re-aggregating large
     transaction sets on every page load. Each row holds one insight type
     (e.g., spending by category, income vs expense) for one month. The
     `data` JSON field contains the computed result payload.

     Relationships:
       - Standalone — derived from `transactions` and `categories`

     Indexes:
       - `month` — filter insights by month (YYYY-MM format)
       - `type` — look up a specific insight type for a given month
     ═══════════════════════════════════════════════════════════════════════ */
  spending_insights: {
    indexes: 'month, type',
    fields: {
      month: 'string',
      type: 'string',
      data: 'json',
      generated_at: 'timestamp'
    }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     CATEGORY RULES — Auto-categorization rules for transactions
     ═══════════════════════════════════════════════════════════════════════

     Defines pattern-matching rules that automatically assign categories to
     incoming transactions. Each rule specifies which transaction field to
     inspect (`match_field`), how to compare it (`match_type`), and the
     pattern to look for (`match_value`). Rules are evaluated in `priority`
     order — the first matching rule wins.

     Relationships:
       - Many category_rules → one `categories` (via `category_id`)

     Indexes:
       - `category_id` — find all rules that assign a given category
       - `priority` — evaluate rules in deterministic order (lower = higher priority)
     ═══════════════════════════════════════════════════════════════════════ */
  category_rules: {
    indexes: 'category_id, priority',
    fields: {
      category_id: 'uuid',
      match_field: 'string',
      match_type: 'string',
      match_value: 'string',
      priority: 'number'
    }
  }
};
