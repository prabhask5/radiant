/**
 * @fileoverview Demo mock data — realistic financial seed data for Radiant Finance.
 *
 * Provides {@link seedDemoData}, the async function called by the engine when
 * demo mode is activated. It populates every Dexie (IndexedDB) table with
 * deterministic, realistic data:
 *
 * - **Teller Enrollments** — two linked bank institutions (Chase, BofA).
 * - **Accounts** — five accounts across checking, savings, and credit cards.
 * - **Categories** — subset of 54 default emoji categories.
 * - **Transactions** — ~45 entries spanning the last 60 days.
 * - **Budget Items** — 8 categories with monthly spending limits.
 * - **Recurring Transactions** — 4 auto-detected recurring charges.
 *
 * Sign conventions (matching Teller / currency.ts):
 * - **Depository (bank)**: positive = deposit (money IN), negative = withdrawal (money OUT)
 * - **Credit card**: positive = charge (money OUT), negative = payment/refund (money IN)
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
 */
const now = () => new Date().toISOString();

/**
 * Return an ISO date string (YYYY-MM-DD) for a date `days` days in the past.
 */
function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Return an ISO date string (YYYY-MM-DD) for a date `days` days in the future.
 */
function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Build the shared base fields that every Dexie record requires.
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

// Categories — deterministic IDs matching categories.ts `cat-{key}` pattern
const CAT_GROCERIES = 'cat-groceries';
const CAT_DINING = 'cat-dining';
const CAT_COFFEE = 'cat-coffee';
const CAT_RENT = 'cat-rent';
const CAT_UTILITIES = 'cat-utilities';
const CAT_GAS_FUEL = 'cat-gas-fuel';
const CAT_RIDESHARE = 'cat-rideshare';
const CAT_SHOPPING = 'cat-shopping';
const CAT_ENTERTAINMENT = 'cat-entertainment';
const CAT_STREAMING = 'cat-streaming';
const CAT_HEALTH_INSURANCE = 'cat-health-insurance';
const CAT_CAR_INSURANCE = 'cat-car-insurance';
const CAT_SALARY = 'cat-salary';
const CAT_FREELANCE = 'cat-freelance';
const CAT_TRANSFER = 'cat-transfer';
const CAT_CREDIT_CARD_PAYMENT = 'cat-credit-card-payment';
const CAT_PHARMACY = 'cat-pharmacy';
const CAT_GYM_FITNESS = 'cat-gym-fitness';

// =============================================================================
//                            SEED FUNCTION
// =============================================================================

/**
 * Populate the demo Dexie database with realistic financial mock data.
 *
 * Called once when demo mode is activated. Seeds six Dexie tables in sequence
 * (enrollments, accounts, categories, transactions, budget_items,
 * recurring_transactions).
 *
 * Uses `bulkPut` with deterministic `demo-` / `cat-` prefixed IDs, so the
 * function is fully idempotent — calling it multiple times on the same DB is
 * a no-op.
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
      source: 'teller',
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
      source: 'teller',
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
      source: 'teller',
      balance_available: null,
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
      source: 'teller',
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
      source: 'teller',
      balance_available: null,
      balance_ledger: '523.40',
      balance_updated_at: now(),
      is_hidden: false
    }
  ]);

  // ---------------------------------------------------------------------------
  //  3. Categories — emoji-based defaults (subset of 54)
  // ---------------------------------------------------------------------------
  await db.table('categories').bulkPut([
    {
      ...base(CAT_GROCERIES),
      name: 'Groceries',
      icon: '🛒',
      color: '#10b981',
      type: 'expense',
      parent_id: null,
      teller_categories: ['groceries'],
      order: 1
    },
    {
      ...base(CAT_DINING),
      name: 'Dining',
      icon: '🍽️',
      color: '#f59e0b',
      type: 'expense',
      parent_id: null,
      teller_categories: ['dining'],
      order: 2
    },
    {
      ...base(CAT_COFFEE),
      name: 'Coffee',
      icon: '☕',
      color: '#92400e',
      type: 'expense',
      parent_id: null,
      teller_categories: [],
      order: 3
    },
    {
      ...base(CAT_RENT),
      name: 'Rent',
      icon: '🏠',
      color: '#14b8a6',
      type: 'expense',
      parent_id: null,
      teller_categories: [],
      order: 5
    },
    {
      ...base(CAT_UTILITIES),
      name: 'Utilities',
      icon: '💡',
      color: '#6366f1',
      type: 'expense',
      parent_id: null,
      teller_categories: ['utilities'],
      order: 7
    },
    {
      ...base(CAT_GAS_FUEL),
      name: 'Gas/Fuel',
      icon: '⛽',
      color: '#f97316',
      type: 'expense',
      parent_id: null,
      teller_categories: ['fuel'],
      order: 12
    },
    {
      ...base(CAT_RIDESHARE),
      name: 'Rideshare',
      icon: '🚕',
      color: '#7c3aed',
      type: 'expense',
      parent_id: null,
      teller_categories: [],
      order: 17
    },
    {
      ...base(CAT_SHOPPING),
      name: 'Shopping',
      icon: '🛍️',
      color: '#8b5cf6',
      type: 'expense',
      parent_id: null,
      teller_categories: ['shopping'],
      order: 26
    },
    {
      ...base(CAT_ENTERTAINMENT),
      name: 'Entertainment',
      icon: '🎬',
      color: '#ec4899',
      type: 'expense',
      parent_id: null,
      teller_categories: ['entertainment'],
      order: 29
    },
    {
      ...base(CAT_STREAMING),
      name: 'Streaming',
      icon: '📺',
      color: '#a855f7',
      type: 'expense',
      parent_id: null,
      teller_categories: ['software'],
      order: 30
    },
    {
      ...base(CAT_HEALTH_INSURANCE),
      name: 'Health Insurance',
      icon: '🏥',
      color: '#ef4444',
      type: 'expense',
      parent_id: null,
      teller_categories: ['health'],
      order: 19
    },
    {
      ...base(CAT_CAR_INSURANCE),
      name: 'Car Insurance',
      icon: '🛡️',
      color: '#64748b',
      type: 'expense',
      parent_id: null,
      teller_categories: ['insurance'],
      order: 14
    },
    {
      ...base(CAT_PHARMACY),
      name: 'Pharmacy',
      icon: '💊',
      color: '#fb923c',
      type: 'expense',
      parent_id: null,
      teller_categories: [],
      order: 21
    },
    {
      ...base(CAT_GYM_FITNESS),
      name: 'Gym/Fitness',
      icon: '🏋️',
      color: '#22c55e',
      type: 'expense',
      parent_id: null,
      teller_categories: ['sport'],
      order: 23
    },
    {
      ...base(CAT_SALARY),
      name: 'Salary',
      icon: '💰',
      color: '#22c55e',
      type: 'income',
      parent_id: null,
      teller_categories: ['income'],
      order: 41
    },
    {
      ...base(CAT_FREELANCE),
      name: 'Freelance',
      icon: '💼',
      color: '#10b981',
      type: 'income',
      parent_id: null,
      teller_categories: [],
      order: 42
    },
    {
      ...base(CAT_TRANSFER),
      name: 'Transfer',
      icon: '🔄',
      color: '#94a3b8',
      type: 'transfer',
      parent_id: null,
      teller_categories: [],
      order: 49
    },
    {
      ...base(CAT_CREDIT_CARD_PAYMENT),
      name: 'Credit Card Payment',
      icon: '💳',
      color: '#64748b',
      type: 'transfer',
      parent_id: null,
      teller_categories: [],
      order: 51
    }
  ]);

  // ---------------------------------------------------------------------------
  //  4. Transactions (~46 entries spanning the past 60 days)
  //
  //  Sign conventions:
  //    Depository: positive = deposit (money IN), negative = withdrawal (money OUT)
  //    Credit:     positive = charge (money OUT), negative = payment (money IN)
  // ---------------------------------------------------------------------------
  await db.table('transactions').bulkPut([
    // ── Income (positive on depository = money in) ───────────────────────
    txn(
      '01',
      ACCT_CHASE_CHECKING,
      '4250.00',
      daysAgo(1),
      'Direct Deposit - ACME Corp',
      'ACME Corp',
      'organization',
      CAT_SALARY,
      'posted'
    ),
    txn(
      '02',
      ACCT_CHASE_CHECKING,
      '4250.00',
      daysAgo(16),
      'Direct Deposit - ACME Corp',
      'ACME Corp',
      'organization',
      CAT_SALARY,
      'posted'
    ),
    txn(
      '03',
      ACCT_CHASE_CHECKING,
      '4250.00',
      daysAgo(31),
      'Direct Deposit - ACME Corp',
      'ACME Corp',
      'organization',
      CAT_SALARY,
      'posted'
    ),
    txn(
      '04',
      ACCT_BOFA_CHECKING,
      '1200.00',
      daysAgo(22),
      'Freelance Payment - Design Work',
      'DesignCo',
      'organization',
      CAT_FREELANCE,
      'posted',
      null,
      'Side project UI redesign'
    ),
    txn(
      '05',
      ACCT_CHASE_CHECKING,
      '4250.00',
      daysAgo(46),
      'Direct Deposit - ACME Corp',
      'ACME Corp',
      'organization',
      CAT_SALARY,
      'posted'
    ),

    // ── Housing (negative on depository = money out) ─────────────────────
    txn(
      '06',
      ACCT_CHASE_CHECKING,
      '-2200.00',
      daysAgo(2),
      'RENT PAYMENT - AVALON APT',
      'Avalon Apartments',
      'organization',
      CAT_RENT,
      'posted',
      null,
      null,
      false,
      true
    ),
    txn(
      '07',
      ACCT_CHASE_CHECKING,
      '-2200.00',
      daysAgo(32),
      'RENT PAYMENT - AVALON APT',
      'Avalon Apartments',
      'organization',
      CAT_RENT,
      'posted',
      null,
      null,
      false,
      true
    ),

    // ── Groceries ────────────────────────────────────────────────────────
    txn(
      '08',
      ACCT_CHASE_CHECKING,
      '-87.43',
      daysAgo(1),
      'WHOLE FOODS MARKET #10432',
      'Whole Foods',
      'organization',
      CAT_GROCERIES,
      'pending'
    ),
    txn(
      '09',
      ACCT_CHASE_CHECKING,
      '-62.18',
      daysAgo(4),
      'TRADER JOES #521',
      "Trader Joe's",
      'organization',
      CAT_GROCERIES,
      'posted'
    ),
    txn(
      '10',
      ACCT_BOFA_CHECKING,
      '-134.92',
      daysAgo(8),
      'COSTCO WHOLESALE #1142',
      'Costco',
      'organization',
      CAT_GROCERIES,
      'posted',
      null,
      'Monthly bulk run'
    ),
    txn(
      '11',
      ACCT_CHASE_CHECKING,
      '-45.67',
      daysAgo(14),
      'GROCERY OUTLET #87',
      'Grocery Outlet',
      'organization',
      CAT_GROCERIES,
      'posted'
    ),
    txn(
      '12',
      ACCT_CHASE_CHECKING,
      '-78.31',
      daysAgo(21),
      'WHOLE FOODS MARKET #10432',
      'Whole Foods',
      'organization',
      CAT_GROCERIES,
      'posted'
    ),
    txn(
      '13',
      ACCT_BOFA_CHECKING,
      '-96.40',
      daysAgo(35),
      'COSTCO WHOLESALE #1142',
      'Costco',
      'organization',
      CAT_GROCERIES,
      'posted'
    ),
    txn(
      '14',
      ACCT_CHASE_CHECKING,
      '-53.22',
      daysAgo(42),
      'TRADER JOES #521',
      "Trader Joe's",
      'organization',
      CAT_GROCERIES,
      'posted'
    ),

    // ── Dining (credit card charges = positive) ──────────────────────────
    txn(
      '15',
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
      '16',
      ACCT_CHASE_CREDIT,
      '78.90',
      daysAgo(5),
      'THE CHEESECAKE FACTORY',
      'Cheesecake Factory',
      'organization',
      CAT_DINING,
      'posted',
      null,
      'Birthday dinner'
    ),
    txn(
      '17',
      ACCT_CHASE_CREDIT,
      '15.47',
      daysAgo(9),
      'STARBUCKS #14523',
      'Starbucks',
      'organization',
      CAT_COFFEE,
      'posted'
    ),
    txn(
      '18',
      ACCT_BOFA_CREDIT,
      '32.80',
      daysAgo(12),
      'PANERA BREAD #3421',
      'Panera Bread',
      'organization',
      CAT_DINING,
      'posted'
    ),
    txn(
      '19',
      ACCT_CHASE_CREDIT,
      '28.15',
      daysAgo(25),
      'SWEETGREEN #091',
      'Sweetgreen',
      'organization',
      CAT_DINING,
      'posted'
    ),
    txn(
      '20',
      ACCT_BOFA_CREDIT,
      '51.30',
      daysAgo(38),
      'OLIVE GARDEN #782',
      'Olive Garden',
      'organization',
      CAT_DINING,
      'posted'
    ),

    // ── Transportation ───────────────────────────────────────────────────
    txn(
      '21',
      ACCT_CHASE_CREDIT,
      '34.52',
      daysAgo(1),
      'UBER TRIP',
      'Uber',
      'organization',
      CAT_RIDESHARE,
      'pending'
    ),
    txn(
      '22',
      ACCT_CHASE_CHECKING,
      '-55.00',
      daysAgo(6),
      'SHELL OIL #54231',
      'Shell',
      'organization',
      CAT_GAS_FUEL,
      'posted'
    ),
    txn(
      '23',
      ACCT_BOFA_CREDIT,
      '18.75',
      daysAgo(11),
      'UBER TRIP',
      'Uber',
      'organization',
      CAT_RIDESHARE,
      'posted'
    ),
    txn(
      '24',
      ACCT_CHASE_CHECKING,
      '-48.60',
      daysAgo(34),
      'CHEVRON #41029',
      'Chevron',
      'organization',
      CAT_GAS_FUEL,
      'posted'
    ),

    // ── Shopping ─────────────────────────────────────────────────────────
    txn(
      '25',
      ACCT_CHASE_CREDIT,
      '129.99',
      daysAgo(3),
      'AMAZON.COM*RT4K21',
      'Amazon',
      'organization',
      CAT_SHOPPING,
      'posted',
      null,
      'New keyboard'
    ),
    txn(
      '26',
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
      '27',
      ACCT_BOFA_CREDIT,
      '43.21',
      daysAgo(18),
      'AMAZON.COM*MK9P32',
      'Amazon',
      'organization',
      CAT_SHOPPING,
      'posted'
    ),
    txn(
      '28',
      ACCT_CHASE_CREDIT,
      '89.95',
      daysAgo(40),
      'BEST BUY #0934',
      'Best Buy',
      'organization',
      CAT_SHOPPING,
      'posted'
    ),

    // ── Entertainment ────────────────────────────────────────────────────
    txn(
      '29',
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
      '30',
      ACCT_BOFA_CREDIT,
      '59.99',
      daysAgo(16),
      'TICKETMASTER',
      'Ticketmaster',
      'organization',
      CAT_ENTERTAINMENT,
      'posted',
      null,
      'Concert tickets'
    ),

    // ── Utilities (negative on depository = money out) ───────────────────
    txn(
      '31',
      ACCT_CHASE_CHECKING,
      '-142.87',
      daysAgo(10),
      'PG&E ELECTRIC',
      'PG&E',
      'organization',
      CAT_UTILITIES,
      'posted',
      null,
      null,
      false,
      true
    ),
    txn(
      '32',
      ACCT_CHASE_CHECKING,
      '-65.00',
      daysAgo(12),
      'AT&T INTERNET',
      'AT&T',
      'organization',
      CAT_UTILITIES,
      'posted',
      null,
      null,
      false,
      true
    ),
    txn(
      '33',
      ACCT_CHASE_CHECKING,
      '-138.50',
      daysAgo(40),
      'PG&E ELECTRIC',
      'PG&E',
      'organization',
      CAT_UTILITIES,
      'posted',
      null,
      null,
      false,
      true
    ),

    // ── Health ───────────────────────────────────────────────────────────
    txn(
      '34',
      ACCT_BOFA_CHECKING,
      '-35.00',
      daysAgo(13),
      'CVS PHARMACY #8832',
      'CVS',
      'organization',
      CAT_PHARMACY,
      'posted'
    ),
    txn(
      '35',
      ACCT_CHASE_CREDIT,
      '150.00',
      daysAgo(20),
      'KAISER PERMANENTE COPAY',
      'Kaiser',
      'organization',
      CAT_HEALTH_INSURANCE,
      'posted'
    ),

    // ── Streaming (recurring subscriptions on credit card) ───────────────
    txn(
      '36',
      ACCT_CHASE_CREDIT,
      '15.99',
      daysAgo(5),
      'NETFLIX.COM',
      'Netflix',
      'organization',
      CAT_STREAMING,
      'posted',
      null,
      null,
      false,
      true
    ),
    txn(
      '37',
      ACCT_CHASE_CREDIT,
      '10.99',
      daysAgo(8),
      'SPOTIFY USA',
      'Spotify',
      'organization',
      CAT_STREAMING,
      'posted',
      null,
      null,
      false,
      true
    ),
    txn(
      '38',
      ACCT_BOFA_CREDIT,
      '14.99',
      daysAgo(9),
      'OPENAI *CHATGPT PLUS',
      'OpenAI',
      'organization',
      CAT_STREAMING,
      'posted',
      null,
      null,
      false,
      true
    ),
    txn(
      '39',
      ACCT_CHASE_CREDIT,
      '15.99',
      daysAgo(35),
      'NETFLIX.COM',
      'Netflix',
      'organization',
      CAT_STREAMING,
      'posted',
      null,
      null,
      false,
      true
    ),
    txn(
      '40',
      ACCT_CHASE_CREDIT,
      '10.99',
      daysAgo(38),
      'SPOTIFY USA',
      'Spotify',
      'organization',
      CAT_STREAMING,
      'posted',
      null,
      null,
      false,
      true
    ),

    // ── Insurance (negative on depository = money out) ───────────────────
    txn(
      '41',
      ACCT_CHASE_CHECKING,
      '-189.00',
      daysAgo(3),
      'GEICO AUTO INSURANCE',
      'GEICO',
      'organization',
      CAT_CAR_INSURANCE,
      'posted'
    ),

    // ── Gym (recurring) ──────────────────────────────────────────────────
    txn(
      '47',
      ACCT_CHASE_CREDIT,
      '49.99',
      daysAgo(6),
      'EQUINOX FITNESS',
      'Equinox',
      'organization',
      CAT_GYM_FITNESS,
      'posted',
      null,
      null,
      false,
      true
    ),
    txn(
      '48',
      ACCT_CHASE_CREDIT,
      '49.99',
      daysAgo(36),
      'EQUINOX FITNESS',
      'Equinox',
      'organization',
      CAT_GYM_FITNESS,
      'posted',
      null,
      null,
      false,
      true
    ),

    // ── Transfers ────────────────────────────────────────────────────────
    txn(
      '42',
      ACCT_CHASE_CHECKING,
      '-500.00',
      daysAgo(7),
      'TRANSFER TO SAVINGS',
      null,
      null,
      CAT_TRANSFER,
      'posted'
    ),
    txn(
      '43',
      ACCT_CHASE_SAVINGS,
      '500.00',
      daysAgo(7),
      'TRANSFER FROM CHECKING',
      null,
      null,
      CAT_TRANSFER,
      'posted'
    ),

    // ── Credit card payments (negative on credit = paying down balance) ──
    txn(
      '44',
      ACCT_CHASE_CREDIT,
      '-1500.00',
      daysAgo(4),
      'PAYMENT THANK YOU',
      'Chase',
      'organization',
      CAT_CREDIT_CARD_PAYMENT,
      'posted'
    ),
    txn(
      '45',
      ACCT_BOFA_CREDIT,
      '-400.00',
      daysAgo(15),
      'ONLINE PAYMENT THANK YOU',
      'Bank of America',
      'organization',
      CAT_CREDIT_CARD_PAYMENT,
      'posted'
    ),

    // ── Excluded transaction (showcases the is_excluded feature) ─────────
    txn(
      '46',
      ACCT_CHASE_CHECKING,
      '-250.00',
      daysAgo(19),
      'VENMO *JOHN DOE',
      'Venmo',
      'organization',
      CAT_TRANSFER,
      'posted',
      null,
      'Splitting rent with roommate — exclude from totals',
      true
    )
  ]);

  // ---------------------------------------------------------------------------
  //  5. Budget Items — single global budget with 8 category allocations
  // ---------------------------------------------------------------------------
  await db.table('budgetItems').bulkPut([
    { ...base('demo-bi-groceries'), category_id: CAT_GROCERIES, amount: '600' },
    { ...base('demo-bi-dining'), category_id: CAT_DINING, amount: '300' },
    { ...base('demo-bi-utilities'), category_id: CAT_UTILITIES, amount: '250' },
    { ...base('demo-bi-gas-fuel'), category_id: CAT_GAS_FUEL, amount: '150' },
    { ...base('demo-bi-shopping'), category_id: CAT_SHOPPING, amount: '200' },
    { ...base('demo-bi-entertainment'), category_id: CAT_ENTERTAINMENT, amount: '150' },
    { ...base('demo-bi-streaming'), category_id: CAT_STREAMING, amount: '60' },
    { ...base('demo-bi-rent'), category_id: CAT_RENT, amount: '2200' }
  ]);

  // ---------------------------------------------------------------------------
  //  6. Recurring Transactions — 4 auto-detected recurring charges
  // ---------------------------------------------------------------------------
  await db.table('recurringTransactions').bulkPut([
    {
      ...base('demo-rec-netflix'),
      name: 'Netflix',
      amount: '15.99',
      category_id: CAT_STREAMING,
      frequency: 'monthly',
      source: 'auto-detected',
      status: 'active',
      account_id: ACCT_CHASE_CREDIT,
      merchant_pattern: 'netflix',
      last_detected_date: daysAgo(5),
      next_date: daysFromNow(25)
    },
    {
      ...base('demo-rec-spotify'),
      name: 'Spotify',
      amount: '10.99',
      category_id: CAT_STREAMING,
      frequency: 'monthly',
      source: 'auto-detected',
      status: 'active',
      account_id: ACCT_CHASE_CREDIT,
      merchant_pattern: 'spotify',
      last_detected_date: daysAgo(8),
      next_date: daysFromNow(22)
    },
    {
      ...base('demo-rec-rent'),
      name: 'Rent - Avalon Apartments',
      amount: '2200.00',
      category_id: CAT_RENT,
      frequency: 'monthly',
      source: 'auto-detected',
      status: 'active',
      account_id: ACCT_CHASE_CHECKING,
      merchant_pattern: 'avalon',
      last_detected_date: daysAgo(2),
      next_date: daysFromNow(28)
    },
    {
      ...base('demo-rec-gym'),
      name: 'Equinox Fitness',
      amount: '49.99',
      category_id: CAT_GYM_FITNESS,
      frequency: 'monthly',
      source: 'auto-detected',
      status: 'active',
      account_id: ACCT_CHASE_CREDIT,
      merchant_pattern: 'equinox',
      last_detected_date: daysAgo(6),
      next_date: daysFromNow(24)
    }
  ]);
}

// =============================================================================
//                         RECORD BUILDER HELPERS
// =============================================================================

/**
 * Build a complete transaction record for demo seeding.
 *
 * @param seq - Two-digit sequence number, used to build the ID.
 * @param accountId - Foreign key to the account this transaction belongs to.
 * @param amount - Signed decimal string.
 *   Depository: positive = deposit (money in), negative = withdrawal (money out).
 *   Credit: positive = charge (money out), negative = payment (money in).
 * @param date - ISO date string (YYYY-MM-DD).
 * @param description - Raw merchant description.
 * @param counterpartyName - Merchant name, or `null` for transfers.
 * @param counterpartyType - Counterparty type, or `null`.
 * @param categoryId - Foreign key to the category.
 * @param status - `'posted'` or `'pending'`.
 * @param csvHash - Optional CSV import hash for deduplication.
 * @param notes - Optional user notes.
 * @param isExcluded - Whether to exclude from summaries.
 * @param isRecurring - Whether this is a recurring transaction.
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
  status: 'posted' | 'pending',
  csvHash: string | null = null,
  notes: string | null = null,
  isExcluded = false,
  isRecurring = false
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
    is_excluded: isExcluded,
    is_recurring: isRecurring,
    is_auto_categorized: true,
    notes,
    csv_import_hash: csvHash
  };
}
