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
 * and categories — all synced via Teller.io and persisted locally + remotely
 * through stellar-drive.
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

     Stores individual financial accounts. Accounts are either pulled from
     Teller.io (`source: 'teller'`) or created manually (`source: 'manual'`).
     Each Teller account belongs to an enrollment; manual accounts have no
     enrollment. Both track balances, type metadata, and visibility state.

     Relationships:
       - Many accounts → one `teller_enrollments` (via `enrollment_id`, nullable for manual)
       - One account → many `transactions` (via `transactions.account_id`)

     Indexes:
       - `enrollment_id` — join back to the parent enrollment
       - `type` / `subtype` — filter by depository vs credit, checking vs savings
       - `status` — distinguish open vs closed accounts
       - `institution_name` — group accounts by bank for display
       - `source` — filter by teller vs manual
     ═══════════════════════════════════════════════════════════════════════ */
  accounts: {
    indexes: 'enrollment_id, type, subtype, status, institution_name, source',
    fields: {
      enrollment_id: 'uuid?',
      teller_account_id: 'string?',
      institution_name: 'string',
      name: 'string',
      type: 'string',
      subtype: 'string',
      currency: 'string',
      last_four: 'string?',
      status: 'string',
      source: 'string?',
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
    indexes:
      'account_id, date, category_id, status, [account_id+date], csv_import_hash, teller_transaction_id',
    ownership: { parent: 'accounts', fk: 'account_id' },
    fields: {
      account_id: 'uuid',
      teller_transaction_id: 'string?',
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
      is_recurring: 'boolean',
      is_auto_categorized: 'boolean',
      notes: 'string?',
      csv_import_hash: 'string?'
    },
    uniqueConstraints: [
      { columns: ['teller_transaction_id'], where: 'teller_transaction_id is not null' },
      { columns: ['account_id', 'csv_import_hash'], where: 'csv_import_hash is not null' }
    ]
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
     BUDGET ITEMS — Per-category monthly allocations for the single global budget
     ═══════════════════════════════════════════════════════════════════════

     Each row represents one category's monthly spending limit. The total
     budget is the sum of all budget_items rows. There is no month or
     is_active field — there is ONE global budget that retroactively
     applies to all historical months.

     To add/remove a category from the budget, create/delete its row.

     Relationships:
       - Many budget_items → one `categories` (via `category_id`)

     Indexes:
       - `category_id` — lookup budget for a specific category
     ═══════════════════════════════════════════════════════════════════════ */
  budget_items: {
    indexes: 'category_id',
    fields: {
      category_id: 'uuid',
      amount: 'string'
    }
  },

  /* ═══════════════════════════════════════════════════════════════════════
     RECURRING TRANSACTIONS — Detected or manually created recurring charges
     ═══════════════════════════════════════════════════════════════════════

     Tracks recurring financial obligations (subscriptions, rent, etc.).
     Entries are either auto-detected by the ML pipeline or created
     manually by the user. All fields are user-editable regardless of
     source.

     Relationships:
       - Many recurring_transactions → one `categories` (via `category_id`, nullable)

     Indexes:
       - `category_id` — aggregate recurring charges per category
       - `status` — filter active vs paused vs ended
     ═══════════════════════════════════════════════════════════════════════ */
  recurring_transactions: {
    indexes: 'category_id, status',
    fields: {
      name: 'string',
      amount: 'string',
      category_id: 'uuid?',
      frequency: 'string',
      source: 'string',
      status: 'string',
      account_id: 'uuid?',
      merchant_pattern: 'string?',
      last_detected_date: 'string?',
      next_date: 'string?'
    }
  }
};
