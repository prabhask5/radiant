/**
 * @fileoverview Demo mock data — realistic financial seed data for Radiant Finance.
 *
 * Provides {@link seedDemoData}, the async function called by the engine when
 * demo mode is activated. It populates every Dexie (IndexedDB) table with
 * deterministic, realistic data:
 *
 * - **Teller Enrollments** — two linked bank institutions (Chase, BofA).
 * - **Accounts** — five accounts across checking, savings, and credit cards.
 * - **Categories** — twelve expense/income/transfer categories with icons.
 * - **Transactions** — thirty entries spanning the last 30 days.
 *
 * All IDs are prefixed with `demo-` and are deterministic, so `bulkPut` is
 * idempotent — re-running the seed on the same DB is a safe no-op.
 */

// =============================================================================
//                                  IMPORTS
// =============================================================================

import type Dexie from 'dexie';

// =============================================================================
//                              HELPER UTILITIES
// =============================================================================

/** Sentinel user ID attached to every demo record. */
const USER_ID = 'demo-user';

/**
 * Return the current timestamp as an ISO 8601 string.
 *
 * @returns ISO date-time string (e.g. `'2026-03-14T12:00:00.000Z'`).
 */
const now = () => new Date().toISOString();

/**
 * Return an ISO date string (YYYY-MM-DD) for a date `days` days in the past.
 *
 * @param days - Number of days to subtract from today.
 * @returns Date-only ISO string (e.g. `'2026-03-07'`).
 */
function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Build the shared base fields that every Dexie record requires.
 *
 * @param id - Deterministic record ID (prefixed with `demo-`).
 * @returns Object with `id`, `user_id`, `created_at`, `updated_at`, and `deleted`.
 */
function base(id: string) {
  return {
    id,
    user_id: USER_ID,
    created_at: now(),
    updated_at: now(),
    deleted: false
  };
}

// =============================================================================
//                         DETERMINISTIC RECORD IDS
// =============================================================================

// Enrollments
const ENROLLMENT_CHASE = 'demo-enrollment-chase';
const ENROLLMENT_BOFA = 'demo-enrollment-bofa';

// Accounts
const ACCT_CHASE_CHECKING = 'demo-acct-chase-checking';
const ACCT_CHASE_SAVINGS = 'demo-acct-chase-savings';
const ACCT_CHASE_CREDIT = 'demo-acct-chase-credit';
const ACCT_BOFA_CHECKING = 'demo-acct-bofa-checking';
const ACCT_BOFA_CREDIT = 'demo-acct-bofa-credit';

// Categories
const CAT_GROCERIES = 'demo-cat-groceries';
const CAT_DINING = 'demo-cat-dining';
const CAT_TRANSPORT = 'demo-cat-transport';
const CAT_SHOPPING = 'demo-cat-shopping';
const CAT_ENTERTAINMENT = 'demo-cat-entertainment';
const CAT_UTILITIES = 'demo-cat-utilities';
const CAT_HEALTH = 'demo-cat-health';
const CAT_HOUSING = 'demo-cat-housing';
const CAT_INCOME = 'demo-cat-income';
const CAT_SUBSCRIPTIONS = 'demo-cat-subscriptions';
const CAT_INSURANCE = 'demo-cat-insurance';
const CAT_TRANSFER = 'demo-cat-transfer';

// =============================================================================
//                            SEED FUNCTION
// =============================================================================

/**
 * Populate the demo Dexie database with realistic financial mock data.
 *
 * Called once when demo mode is activated. Seeds four Dexie tables in sequence
 * (enrollments, accounts, categories, transactions).
 *
 * Uses `bulkPut` with deterministic `demo-` prefixed IDs, so the function is
 * fully idempotent — calling it multiple times on the same DB is a no-op.
 *
 * @param db - The Dexie database instance to populate.
 * @returns Resolves when all tables have been seeded.
 */
export async function seedDemoData(db: Dexie): Promise<void> {
  // ---------------------------------------------------------------------------
  //  1. Teller Enrollments
  // ---------------------------------------------------------------------------
  await db.table('tellerEnrollments').bulkPut([
    {
      ...base(ENROLLMENT_CHASE),
      enrollment_id: 'enr_chase_demo_001',
      institution_name: 'Chase',
      institution_id: 'chase',
      access_token: 'demo-token-chase',
      status: 'connected',
      last_synced_at: now(),
      error_message: null
    },
    {
      ...base(ENROLLMENT_BOFA),
      enrollment_id: 'enr_bofa_demo_001',
      institution_name: 'Bank of America',
      institution_id: 'bank_of_america',
      access_token: 'demo-token-bofa',
      status: 'connected',
      last_synced_at: now(),
      error_message: null
    }
  ]);

  // ---------------------------------------------------------------------------
  //  2. Accounts
  // ---------------------------------------------------------------------------
  await db.table('accounts').bulkPut([
    {
      ...base(ACCT_CHASE_CHECKING),
      enrollment_id: ENROLLMENT_CHASE,
      teller_account_id: 'acc_chase_chk_001',
      institution_name: 'Chase',
      name: 'Chase Total Checking',
      type: 'depository',
      subtype: 'checking',
      currency: 'USD',
      last_four: '4521',
      status: 'open',
      balance_available: '8432.50',
      balance_ledger: '8432.50',
      balance_updated_at: now(),
      is_hidden: false
    },
    {
      ...base(ACCT_CHASE_SAVINGS),
      enrollment_id: ENROLLMENT_CHASE,
      teller_account_id: 'acc_chase_sav_001',
      institution_name: 'Chase',
      name: 'Chase Savings',
      type: 'depository',
      subtype: 'savings',
      currency: 'USD',
      last_four: '7832',
      status: 'open',
      balance_available: '25000.00',
      balance_ledger: '25000.00',
      balance_updated_at: now(),
      is_hidden: false
    },
    {
      ...base(ACCT_CHASE_CREDIT),
      enrollment_id: ENROLLMENT_CHASE,
      teller_account_id: 'acc_chase_cc_001',
      institution_name: 'Chase',
      name: 'Chase Sapphire Preferred',
      type: 'credit',
      subtype: 'credit_card',
      currency: 'USD',
      last_four: '9104',
      status: 'open',
      balance_available: '8152.77',
      balance_ledger: '1847.23',
      balance_updated_at: now(),
      is_hidden: false
    },
    {
      ...base(ACCT_BOFA_CHECKING),
      enrollment_id: ENROLLMENT_BOFA,
      teller_account_id: 'acc_bofa_chk_001',
      institution_name: 'Bank of America',
      name: 'BofA Advantage Checking',
      type: 'depository',
      subtype: 'checking',
      currency: 'USD',
      last_four: '2087',
      status: 'open',
      balance_available: '3218.75',
      balance_ledger: '3218.75',
      balance_updated_at: now(),
      is_hidden: false
    },
    {
      ...base(ACCT_BOFA_CREDIT),
      enrollment_id: ENROLLMENT_BOFA,
      teller_account_id: 'acc_bofa_cc_001',
      institution_name: 'Bank of America',
      name: 'BofA Cash Rewards Visa',
      type: 'credit',
      subtype: 'credit_card',
      currency: 'USD',
      last_four: '3356',
      status: 'open',
      balance_available: '4476.60',
      balance_ledger: '523.40',
      balance_updated_at: now(),
      is_hidden: false
    }
  ]);

  // ---------------------------------------------------------------------------
  //  3. Categories
  // ---------------------------------------------------------------------------
  await db.table('categories').bulkPut([
    {
      ...base(CAT_GROCERIES),
      name: 'Groceries',
      icon: 'cart',
      color: '#10b981',
      type: 'expense',
      parent_id: null,
      teller_categories: null,
      order: 1
    },
    {
      ...base(CAT_DINING),
      name: 'Dining',
      icon: 'utensils',
      color: '#f59e0b',
      type: 'expense',
      parent_id: null,
      teller_categories: null,
      order: 2
    },
    {
      ...base(CAT_TRANSPORT),
      name: 'Transportation',
      icon: 'car',
      color: '#3b82f6',
      type: 'expense',
      parent_id: null,
      teller_categories: null,
      order: 3
    },
    {
      ...base(CAT_SHOPPING),
      name: 'Shopping',
      icon: 'bag',
      color: '#8b5cf6',
      type: 'expense',
      parent_id: null,
      teller_categories: null,
      order: 4
    },
    {
      ...base(CAT_ENTERTAINMENT),
      name: 'Entertainment',
      icon: 'film',
      color: '#ec4899',
      type: 'expense',
      parent_id: null,
      teller_categories: null,
      order: 5
    },
    {
      ...base(CAT_UTILITIES),
      name: 'Utilities',
      icon: 'zap',
      color: '#6366f1',
      type: 'expense',
      parent_id: null,
      teller_categories: null,
      order: 6
    },
    {
      ...base(CAT_HEALTH),
      name: 'Health',
      icon: 'heart',
      color: '#ef4444',
      type: 'expense',
      parent_id: null,
      teller_categories: null,
      order: 7
    },
    {
      ...base(CAT_HOUSING),
      name: 'Housing',
      icon: 'home',
      color: '#14b8a6',
      type: 'expense',
      parent_id: null,
      teller_categories: null,
      order: 8
    },
    {
      ...base(CAT_INCOME),
      name: 'Income',
      icon: 'dollar',
      color: '#22c55e',
      type: 'income',
      parent_id: null,
      teller_categories: null,
      order: 9
    },
    {
      ...base(CAT_SUBSCRIPTIONS),
      name: 'Subscriptions',
      icon: 'repeat',
      color: '#a855f7',
      type: 'expense',
      parent_id: null,
      teller_categories: null,
      order: 10
    },
    {
      ...base(CAT_INSURANCE),
      name: 'Insurance',
      icon: 'shield',
      color: '#64748b',
      type: 'expense',
      parent_id: null,
      teller_categories: null,
      order: 11
    },
    {
      ...base(CAT_TRANSFER),
      name: 'Transfer',
      icon: 'arrows',
      color: '#94a3b8',
      type: 'transfer',
      parent_id: null,
      teller_categories: null,
      order: 12
    }
  ]);

  // ---------------------------------------------------------------------------
  //  4. Transactions (30 entries across the past 30 days)
  // ---------------------------------------------------------------------------
  await db.table('transactions').bulkPut([
    // --- Income (negative = money flowing in) ---
    txn(
      '01',
      ACCT_CHASE_CHECKING,
      '-4250.00',
      daysAgo(1),
      'Direct Deposit - ACME Corp',
      'ACME Corp',
      'organization',
      CAT_INCOME,
      'posted'
    ),
    txn(
      '02',
      ACCT_BOFA_CHECKING,
      '-1200.00',
      daysAgo(15),
      'Freelance Payment - Design Work',
      'DesignCo',
      'organization',
      CAT_INCOME,
      'posted'
    ),

    // --- Groceries (positive = money flowing out) ---
    txn(
      '03',
      ACCT_CHASE_CHECKING,
      '87.43',
      daysAgo(1),
      'WHOLE FOODS MARKET #10432',
      'Whole Foods',
      'organization',
      CAT_GROCERIES,
      'pending'
    ),
    txn(
      '04',
      ACCT_CHASE_CHECKING,
      '62.18',
      daysAgo(4),
      'TRADER JOES #521',
      "Trader Joe's",
      'organization',
      CAT_GROCERIES,
      'posted'
    ),
    txn(
      '05',
      ACCT_BOFA_CHECKING,
      '134.92',
      daysAgo(8),
      'COSTCO WHOLESALE #1142',
      'Costco',
      'organization',
      CAT_GROCERIES,
      'posted'
    ),
    txn(
      '06',
      ACCT_CHASE_CHECKING,
      '45.67',
      daysAgo(14),
      'GROCERY OUTLET #87',
      'Grocery Outlet',
      'organization',
      CAT_GROCERIES,
      'posted'
    ),
    txn(
      '07',
      ACCT_CHASE_CHECKING,
      '78.31',
      daysAgo(21),
      'WHOLE FOODS MARKET #10432',
      'Whole Foods',
      'organization',
      CAT_GROCERIES,
      'posted'
    ),

    // --- Dining ---
    txn(
      '08',
      ACCT_CHASE_CREDIT,
      '42.50',
      daysAgo(2),
      'CHIPOTLE MEXICAN GRILL',
      'Chipotle',
      'organization',
      CAT_DINING,
      'posted'
    ),
    txn(
      '09',
      ACCT_CHASE_CREDIT,
      '78.90',
      daysAgo(5),
      'THE CHEESECAKE FACTORY',
      'Cheesecake Factory',
      'organization',
      CAT_DINING,
      'posted'
    ),
    txn(
      '10',
      ACCT_CHASE_CREDIT,
      '15.47',
      daysAgo(9),
      'STARBUCKS #14523',
      'Starbucks',
      'organization',
      CAT_DINING,
      'posted'
    ),
    txn(
      '11',
      ACCT_BOFA_CREDIT,
      '32.80',
      daysAgo(12),
      'PANERA BREAD #3421',
      'Panera Bread',
      'organization',
      CAT_DINING,
      'posted'
    ),

    // --- Transportation ---
    txn(
      '12',
      ACCT_CHASE_CREDIT,
      '34.52',
      daysAgo(1),
      'UBER TRIP',
      'Uber',
      'organization',
      CAT_TRANSPORT,
      'pending'
    ),
    txn(
      '13',
      ACCT_CHASE_CHECKING,
      '55.00',
      daysAgo(6),
      'SHELL OIL #54231',
      'Shell',
      'organization',
      CAT_TRANSPORT,
      'posted'
    ),
    txn(
      '14',
      ACCT_BOFA_CREDIT,
      '18.75',
      daysAgo(11),
      'UBER TRIP',
      'Uber',
      'organization',
      CAT_TRANSPORT,
      'posted'
    ),

    // --- Shopping ---
    txn(
      '15',
      ACCT_CHASE_CREDIT,
      '129.99',
      daysAgo(3),
      'AMAZON.COM*RT4K21',
      'Amazon',
      'organization',
      CAT_SHOPPING,
      'posted'
    ),
    txn(
      '16',
      ACCT_CHASE_CREDIT,
      '67.50',
      daysAgo(10),
      'TARGET #1847',
      'Target',
      'organization',
      CAT_SHOPPING,
      'posted'
    ),
    txn(
      '17',
      ACCT_BOFA_CREDIT,
      '43.21',
      daysAgo(18),
      'AMAZON.COM*MK9P32',
      'Amazon',
      'organization',
      CAT_SHOPPING,
      'posted'
    ),

    // --- Entertainment ---
    txn(
      '18',
      ACCT_CHASE_CREDIT,
      '24.99',
      daysAgo(7),
      'AMC THEATRES #342',
      'AMC',
      'organization',
      CAT_ENTERTAINMENT,
      'posted'
    ),
    txn(
      '19',
      ACCT_BOFA_CREDIT,
      '59.99',
      daysAgo(16),
      'TICKETMASTER',
      'Ticketmaster',
      'organization',
      CAT_ENTERTAINMENT,
      'posted'
    ),

    // --- Utilities ---
    txn(
      '20',
      ACCT_CHASE_CHECKING,
      '142.87',
      daysAgo(10),
      'PG&E ELECTRIC',
      'PG&E',
      'organization',
      CAT_UTILITIES,
      'posted'
    ),
    txn(
      '21',
      ACCT_CHASE_CHECKING,
      '65.00',
      daysAgo(12),
      'AT&T INTERNET',
      'AT&T',
      'organization',
      CAT_UTILITIES,
      'posted'
    ),

    // --- Health ---
    txn(
      '22',
      ACCT_BOFA_CHECKING,
      '35.00',
      daysAgo(13),
      'CVS PHARMACY #8832',
      'CVS',
      'organization',
      CAT_HEALTH,
      'posted'
    ),
    txn(
      '23',
      ACCT_CHASE_CREDIT,
      '150.00',
      daysAgo(20),
      'KAISER PERMANENTE COPAY',
      'Kaiser',
      'organization',
      CAT_HEALTH,
      'posted'
    ),

    // --- Housing ---
    txn(
      '24',
      ACCT_CHASE_CHECKING,
      '2200.00',
      daysAgo(2),
      'RENT PAYMENT - AVALON APT',
      'Avalon Apartments',
      'organization',
      CAT_HOUSING,
      'posted'
    ),

    // --- Subscriptions ---
    txn(
      '25',
      ACCT_CHASE_CREDIT,
      '15.99',
      daysAgo(5),
      'NETFLIX.COM',
      'Netflix',
      'organization',
      CAT_SUBSCRIPTIONS,
      'posted'
    ),
    txn(
      '26',
      ACCT_CHASE_CREDIT,
      '10.99',
      daysAgo(8),
      'SPOTIFY USA',
      'Spotify',
      'organization',
      CAT_SUBSCRIPTIONS,
      'posted'
    ),
    txn(
      '27',
      ACCT_BOFA_CREDIT,
      '14.99',
      daysAgo(9),
      'OPENAI *CHATGPT PLUS',
      'OpenAI',
      'organization',
      CAT_SUBSCRIPTIONS,
      'posted'
    ),

    // --- Insurance ---
    txn(
      '28',
      ACCT_CHASE_CHECKING,
      '189.00',
      daysAgo(3),
      'GEICO AUTO INSURANCE',
      'GEICO',
      'organization',
      CAT_INSURANCE,
      'posted'
    ),

    // --- Transfers ---
    txn(
      '29',
      ACCT_CHASE_CHECKING,
      '500.00',
      daysAgo(7),
      'TRANSFER TO SAVINGS',
      null,
      null,
      CAT_TRANSFER,
      'posted'
    ),
    txn(
      '30',
      ACCT_CHASE_SAVINGS,
      '-500.00',
      daysAgo(7),
      'TRANSFER FROM CHECKING',
      null,
      null,
      CAT_TRANSFER,
      'posted'
    ),

    // --- Credit card payment (negative on CC = paying it off = green) ---
    txn(
      '31',
      ACCT_CHASE_CREDIT,
      '-1500.00',
      daysAgo(4),
      'PAYMENT THANK YOU',
      'Chase',
      'organization',
      CAT_TRANSFER,
      'posted'
    )
  ]);
}

// =============================================================================
//                         RECORD BUILDER HELPERS
// =============================================================================

/**
 * Build a complete transaction record for demo seeding.
 *
 * Computes derived fields (`type`, `teller_transaction_id`) from the provided
 * arguments so callers only need to specify the unique parts.
 *
 * @param seq - Two-digit sequence number (e.g. `'01'`), used to build the ID.
 * @param accountId - Foreign key to the account this transaction belongs to.
 * @param amount - Signed decimal string; negative for expenses, positive for income.
 * @param date - ISO date string (YYYY-MM-DD) for the transaction date.
 * @param description - Raw merchant description as it would appear on a statement.
 * @param counterpartyName - Human-readable merchant name, or `null` for transfers.
 * @param counterpartyType - Counterparty type (e.g. `'organization'`), or `null`.
 * @param categoryId - Foreign key to the category for this transaction.
 * @param status - `'posted'` for cleared transactions, `'pending'` for in-flight.
 * @returns A fully-formed transaction object ready for `bulkPut`.
 */
function txn(
  seq: string,
  accountId: string,
  amount: string,
  date: string,
  description: string,
  counterpartyName: string | null,
  counterpartyType: string | null,
  categoryId: string,
  status: 'posted' | 'pending'
) {
  return {
    ...base(`demo-txn-${seq}`),
    account_id: accountId,
    teller_transaction_id: `txn_demo_${seq}`,
    amount,
    date,
    description,
    counterparty_name: counterpartyName,
    counterparty_type: counterpartyType,
    teller_category: null,
    category_id: categoryId,
    status,
    type: parseFloat(amount) < 0 ? 'credit' : 'debit',
    running_balance: null,
    is_excluded: false,
    notes: null
  };
}
