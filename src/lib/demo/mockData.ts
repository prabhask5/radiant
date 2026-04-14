/**
 * @fileoverview Demo mock data — realistic financial seed data for Radiant Finance.
 *
 * Provides {@link seedDemoData}, the async function called by the engine when
 * demo mode is activated. It populates every Dexie (IndexedDB) table with
 * deterministic, realistic data:
 *
 * - **Teller Enrollments** — two linked bank institutions (Chase, BofA).
 * - **Accounts** — five accounts across checking, savings, and credit cards.
 * - **Categories** — user-defined budget categories with budget_amount.
 * - **Transactions** — ~60 entries spanning the last 90 days.
 * - **Recurring Transactions** — 7 auto-detected recurring charges.
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
const ENROLLMENT_WF = 'demo-enrollment-wf'; // disconnected — triggers reconnect banner
const ENROLLMENT_CITI = 'demo-enrollment-citi'; // error — triggers error reconnect banner

// Accounts
const ACCT_CHASE_CHECKING = 'demo-acct-chase-checking';
const ACCT_CHASE_SAVINGS = 'demo-acct-chase-savings';
const ACCT_CHASE_CREDIT = 'demo-acct-chase-credit';
const ACCT_BOFA_CHECKING = 'demo-acct-bofa-checking';
const ACCT_BOFA_CREDIT = 'demo-acct-bofa-credit';
const ACCT_WF_CHECKING = 'demo-acct-wf-checking'; // under disconnected enrollment
const ACCT_CITI_CREDIT = 'demo-acct-citi-credit'; // under error enrollment
const ACCT_MANUAL_SAVINGS = 'demo-acct-manual-savings'; // manual (no Teller link)
const ACCT_MANUAL_BROKERAGE = 'demo-acct-manual-brokerage'; // second manual institution
const ACCT_MANUAL_CREDIT = 'demo-acct-manual-credit'; // manual credit card
const ACCT_BOFA_JOINT = 'demo-acct-bofa-joint'; // hidden account

// Categories — deterministic demo IDs
const CAT_GROCERIES = 'demo-cat-groceries';
const CAT_DINING = 'demo-cat-dining';
const CAT_COFFEE = 'demo-cat-coffee';
const CAT_RENT = 'demo-cat-rent';
const CAT_UTILITIES = 'demo-cat-utilities';
const CAT_GAS_FUEL = 'demo-cat-gas-fuel';
const CAT_RIDESHARE = 'demo-cat-rideshare';
const CAT_SHOPPING = 'demo-cat-shopping';
const CAT_ENTERTAINMENT = 'demo-cat-entertainment';
const CAT_STREAMING = 'demo-cat-streaming';
const CAT_HEALTH_INSURANCE = 'demo-cat-health-insurance';
const CAT_CAR_INSURANCE = 'demo-cat-car-insurance';
const CAT_SALARY = 'demo-cat-salary';
const CAT_FREELANCE = 'demo-cat-freelance';
const CAT_TRANSFER = 'demo-cat-transfer';
const CAT_CREDIT_CARD_PAYMENT = 'demo-cat-credit-card-payment';
const CAT_PHARMACY = 'demo-cat-pharmacy';
const CAT_GYM_FITNESS = 'demo-cat-gym-fitness';

// =============================================================================
//                            SEED FUNCTION
// =============================================================================

/**
 * Populate the demo Dexie database with realistic financial mock data.
 *
 * Called once when demo mode is activated. Seeds five Dexie tables in sequence
 * (enrollments, accounts, categories, transactions, recurring_transactions).
 *
 * Uses `bulkPut` with deterministic `demo-` prefixed IDs, so the function is
 * fully idempotent — calling it multiple times on the same DB is a no-op.
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
    },
    {
      // Disconnected enrollment — exercises the gold reconnect banner UI
      ...base(ENROLLMENT_WF),
      enrollment_id: 'enr_wf_demo_001',
      institution_name: 'Wells Fargo',
      institution_id: 'wells_fargo',
      access_token: 'demo-token-wf',
      status: 'disconnected',
      last_synced_at: new Date(Date.now() - 5 * 864e5).toISOString(),
      error_message: 'Session expired — reconnection required'
    },
    {
      // Error enrollment — exercises the ruby/red error reconnect banner UI
      ...base(ENROLLMENT_CITI),
      enrollment_id: 'enr_citi_demo_001',
      institution_name: 'Citi',
      institution_id: 'citi',
      access_token: 'demo-token-citi',
      status: 'error',
      last_synced_at: new Date(Date.now() - 2 * 864e5).toISOString(),
      error_message: 'Bank returned an unexpected error — sync unavailable'
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
      balance_available: '652.77',
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
      balance_available: '9476.60',
      balance_ledger: '523.40',
      balance_updated_at: now(),
      is_hidden: false
    },
    {
      // Account under the disconnected Wells Fargo enrollment
      ...base(ACCT_WF_CHECKING),
      enrollment_id: ENROLLMENT_WF,
      teller_account_id: 'acc_wf_chk_001',
      institution_name: 'Wells Fargo',
      name: 'WF Everyday Checking',
      type: 'depository',
      subtype: 'checking',
      currency: 'USD',
      last_four: '6218',
      status: 'open',
      source: 'teller',
      balance_available: '2150.00',
      balance_ledger: '2150.00',
      balance_updated_at: new Date(Date.now() - 5 * 864e5).toISOString(),
      is_hidden: false
    },
    {
      // Account under the error Citi enrollment — exercises error banner + Teller account badge
      ...base(ACCT_CITI_CREDIT),
      enrollment_id: ENROLLMENT_CITI,
      teller_account_id: 'acc_citi_cc_001',
      institution_name: 'Citi',
      name: 'Citi Double Cash',
      type: 'credit',
      subtype: 'credit_card',
      currency: 'USD',
      last_four: '7741',
      status: 'open',
      source: 'teller',
      balance_available: '8250.00',
      balance_ledger: '1750.00',
      balance_updated_at: new Date(Date.now() - 2 * 864e5).toISOString(),
      manual_credit_limit: '10000.00',
      is_hidden: false
    },
    {
      // Manual account — no Teller link, balance set via manual_balance_override
      ...base(ACCT_MANUAL_SAVINGS),
      enrollment_id: null,
      teller_account_id: null,
      institution_name: 'Ally Bank',
      name: 'Emergency Fund',
      type: 'depository',
      subtype: 'savings',
      currency: 'USD',
      last_four: null,
      status: 'open',
      source: 'manual',
      // balance_available/ledger match the override so txnComputedBal = override —
      // no spurious step artifact on the chart. The star ✦ badge still shows
      // because manual_balance_override is set.
      balance_available: '15000.00',
      balance_ledger: '15000.00',
      balance_updated_at: now(),
      manual_balance_override: '15000.00',
      is_hidden: false
    },
    {
      // Manual brokerage account — second manual institution (Fidelity), shows manual
      // institution management (rename / delete) and Manual badge on institution + account
      ...base(ACCT_MANUAL_BROKERAGE),
      enrollment_id: null,
      teller_account_id: null,
      institution_name: 'Fidelity',
      name: 'Roth IRA',
      type: 'depository',
      subtype: 'savings',
      currency: 'USD',
      last_four: null,
      status: 'open',
      source: 'manual',
      balance_available: '42800.00',
      balance_ledger: '42800.00',
      balance_updated_at: now(),
      manual_balance_override: '42800.00',
      is_hidden: false
    },
    {
      // Manual credit card — shows Manual badge on a credit-type account,
      // and credit limit tracking for fully manual accounts.
      // balance_available = limit - owed (matching Teller credit card convention).
      ...base(ACCT_MANUAL_CREDIT),
      enrollment_id: null,
      teller_account_id: null,
      institution_name: 'Fidelity',
      name: 'Fidelity Rewards Visa',
      type: 'credit',
      subtype: 'credit_card',
      currency: 'USD',
      last_four: '8823',
      status: 'open',
      source: 'manual',
      balance_available: '4660.00',
      balance_ledger: '340.00',
      balance_updated_at: now(),
      manual_balance_override: '340.00',
      manual_credit_limit: '5000.00',
      is_hidden: false
    },
    {
      // Hidden account — exercises is_hidden UI (excluded from totals, shown dimmed)
      ...base(ACCT_BOFA_JOINT),
      enrollment_id: ENROLLMENT_BOFA,
      teller_account_id: 'acc_bofa_joint_001',
      institution_name: 'Bank of America',
      name: 'BofA Joint Checking',
      type: 'depository',
      subtype: 'checking',
      currency: 'USD',
      last_four: '5501',
      status: 'open',
      source: 'teller',
      balance_available: '4500.00',
      balance_ledger: '4500.00',
      balance_updated_at: now(),
      is_hidden: true
    }
  ]);

  // ---------------------------------------------------------------------------
  //  3. Categories — user-defined budget categories with budget_amount
  // ---------------------------------------------------------------------------
  await db.table('categories').bulkPut([
    {
      ...base(CAT_GROCERIES),
      name: 'Groceries',
      icon: '🛒',
      color: '#10b981',
      budget_amount: '600',
      order: 1
    },
    {
      ...base(CAT_DINING),
      name: 'Dining',
      icon: '🍽️',
      color: '#f59e0b',
      budget_amount: '100',
      order: 2
    },
    {
      ...base(CAT_COFFEE),
      name: 'Coffee',
      icon: '☕',
      color: '#92400e',
      budget_amount: '80',
      order: 3
    },
    {
      ...base(CAT_RENT),
      name: 'Rent',
      icon: '🏠',
      color: '#14b8a6',
      budget_amount: '1600',
      order: 4
    },
    {
      ...base(CAT_UTILITIES),
      name: 'Utilities',
      icon: '💡',
      color: '#6366f1',
      budget_amount: '250',
      order: 5
    },
    {
      ...base(CAT_GAS_FUEL),
      name: 'Gas/Fuel',
      icon: '⛽',
      color: '#f97316',
      budget_amount: '150',
      order: 6
    },
    {
      ...base(CAT_RIDESHARE),
      name: 'Rideshare',
      icon: '🚕',
      color: '#7c3aed',
      budget_amount: '100',
      order: 7
    },
    {
      ...base(CAT_SHOPPING),
      name: 'Shopping',
      icon: '🛍️',
      color: '#8b5cf6',
      budget_amount: '130',
      order: 8
    },
    {
      ...base(CAT_ENTERTAINMENT),
      name: 'Entertainment',
      icon: '🎬',
      color: '#ec4899',
      budget_amount: '150',
      order: 9
    },
    {
      ...base(CAT_STREAMING),
      name: 'Streaming',
      icon: '📺',
      color: '#a855f7',
      budget_amount: '60',
      order: 10
    },
    {
      ...base(CAT_HEALTH_INSURANCE),
      name: 'Health Insurance',
      icon: '🏥',
      color: '#ef4444',
      budget_amount: '200',
      order: 11
    },
    {
      ...base(CAT_CAR_INSURANCE),
      name: 'Car Insurance',
      icon: '🛡️',
      color: '#64748b',
      budget_amount: '200',
      order: 12
    },
    {
      ...base(CAT_PHARMACY),
      name: 'Pharmacy',
      icon: '💊',
      color: '#fb923c',
      budget_amount: '50',
      order: 13
    },
    {
      ...base(CAT_GYM_FITNESS),
      name: 'Gym/Fitness',
      icon: '🏋️',
      color: '#22c55e',
      budget_amount: '60',
      order: 14
    },
    {
      ...base(CAT_SALARY),
      name: 'Salary',
      icon: '💰',
      color: '#22c55e',
      budget_amount: '0',
      order: 15
    },
    {
      ...base(CAT_FREELANCE),
      name: 'Freelance',
      icon: '💼',
      color: '#10b981',
      budget_amount: '0',
      order: 16
    },
    {
      ...base(CAT_TRANSFER),
      name: 'Transfer',
      icon: '🔄',
      color: '#94a3b8',
      budget_amount: '0',
      order: 17
    },
    {
      ...base(CAT_CREDIT_CARD_PAYMENT),
      name: 'Credit Card Payment',
      icon: '💳',
      color: '#64748b',
      budget_amount: '0',
      order: 18
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

    // ── Housing (negative on depository = money out, 3 months) ───────────
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
    txn(
      '65',
      ACCT_CHASE_CHECKING,
      '-2200.00',
      daysAgo(62),
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
    txn(
      '66',
      ACCT_CHASE_CREDIT,
      '479.99',
      daysAgo(6),
      'BEST BUY #0934',
      'Best Buy',
      'organization',
      CAT_SHOPPING,
      'posted',
      null,
      'New air purifier'
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

    // ── Utilities (negative on depository = money out, 3 months) ─────────
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
    txn(
      '69',
      ACCT_CHASE_CHECKING,
      '-145.20',
      daysAgo(70),
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
    // AT&T Internet — 3 months
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
      '67',
      ACCT_CHASE_CHECKING,
      '-65.00',
      daysAgo(42),
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
      '68',
      ACCT_CHASE_CHECKING,
      '-65.00',
      daysAgo(72),
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
    // Netflix — 3 months
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
      '60',
      ACCT_CHASE_CREDIT,
      '15.99',
      daysAgo(65),
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
    // Spotify — 3 months
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
    txn(
      '61',
      ACCT_CHASE_CREDIT,
      '10.99',
      daysAgo(68),
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
    // OpenAI ChatGPT — 3 months
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
      '62',
      ACCT_BOFA_CREDIT,
      '14.99',
      daysAgo(39),
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
      '63',
      ACCT_BOFA_CREDIT,
      '14.99',
      daysAgo(69),
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

    // ── Gym (recurring — 3 months) ────────────────────────────────────────
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
    txn(
      '64',
      ACCT_CHASE_CREDIT,
      '49.99',
      daysAgo(66),
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

    // ── Manual account — a few deposits to show balance history ──────────
    txn(
      '70',
      ACCT_MANUAL_SAVINGS,
      '5000.00',
      daysAgo(14),
      'Transfer from Chase Checking',
      null,
      null,
      CAT_TRANSFER,
      'posted'
    ),
    txn(
      '71',
      ACCT_MANUAL_SAVINGS,
      '10000.00',
      daysAgo(45),
      'Initial deposit — emergency fund',
      null,
      null,
      CAT_TRANSFER,
      'posted',
      null,
      '6-month emergency fund goal'
    ),

    // ── Wells Fargo (disconnected) — stale transactions still visible ─────
    txn(
      '72',
      ACCT_WF_CHECKING,
      '3200.00',
      daysAgo(20),
      'Direct Deposit - ACME Corp',
      'ACME Corp',
      'organization',
      CAT_SALARY,
      'posted'
    ),
    txn(
      '73',
      ACCT_WF_CHECKING,
      '-1800.00',
      daysAgo(22),
      'RENT PAYMENT',
      null,
      null,
      CAT_RENT,
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
    ),

    // ── Citi error enrollment — a handful of transactions before sync broke ──
    txn(
      '74',
      ACCT_CITI_CREDIT,
      '89.40',
      daysAgo(3),
      'WHOLE FOODS MARKET',
      'Whole Foods',
      'organization',
      CAT_GROCERIES,
      'posted'
    ),
    txn(
      '75',
      ACCT_CITI_CREDIT,
      '32.50',
      daysAgo(5),
      'CHIPOTLE ONLINE',
      'Chipotle',
      'organization',
      CAT_DINING,
      'posted'
    ),
    txn(
      '76',
      ACCT_CITI_CREDIT,
      '-1750.00',
      daysAgo(7),
      'CITI PAYMENT THANK YOU',
      null,
      null,
      CAT_CREDIT_CARD_PAYMENT,
      'posted'
    ),

    // ── Fidelity manual accounts — occasional manual entries ─────────────
    txn(
      '77',
      ACCT_MANUAL_CREDIT,
      '55.20',
      daysAgo(4),
      'AMAZON.COM',
      'Amazon',
      'organization',
      CAT_SHOPPING,
      'posted'
    ),
    txn(
      '78',
      ACCT_MANUAL_CREDIT,
      '18.75',
      daysAgo(9),
      'STARBUCKS',
      'Starbucks',
      'organization',
      CAT_COFFEE,
      'posted'
    ),
    txn(
      '79',
      ACCT_MANUAL_CREDIT,
      '-340.00',
      daysAgo(12),
      'FIDELITY VISA PAYMENT',
      null,
      null,
      CAT_CREDIT_CARD_PAYMENT,
      'posted'
    )
  ]);

  // ---------------------------------------------------------------------------
  //  5. Recurring Transactions — 4 auto-detected recurring charges
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
      merchant_pattern: 'avalon apartments',
      last_detected_date: daysAgo(2),
      next_date: daysFromNow(28)
    },
    {
      // 'cancelling' status — exercises the cancellation UI state (floated to top)
      ...base('demo-rec-gym'),
      name: 'Equinox Fitness',
      amount: '49.99',
      category_id: CAT_GYM_FITNESS,
      frequency: 'monthly',
      source: 'auto-detected',
      status: 'cancelling',
      account_id: ACCT_CHASE_CREDIT,
      merchant_pattern: 'equinox',
      last_detected_date: daysAgo(6),
      next_date: daysFromNow(24)
    },
    {
      ...base('demo-rec-chatgpt'),
      name: 'OpenAI ChatGPT Plus',
      amount: '14.99',
      category_id: CAT_STREAMING,
      frequency: 'monthly',
      source: 'auto-detected',
      status: 'active',
      account_id: ACCT_BOFA_CREDIT,
      merchant_pattern: 'openai',
      last_detected_date: daysAgo(9),
      next_date: daysFromNow(21)
    },
    {
      ...base('demo-rec-pge'),
      name: 'PG&E Electric',
      amount: '142.87',
      category_id: CAT_UTILITIES,
      frequency: 'monthly',
      source: 'auto-detected',
      status: 'active',
      account_id: ACCT_CHASE_CHECKING,
      merchant_pattern: 'pge',
      last_detected_date: daysAgo(10),
      next_date: daysFromNow(20)
    },
    {
      ...base('demo-rec-att'),
      name: 'AT&T Internet',
      amount: '65.00',
      category_id: CAT_UTILITIES,
      frequency: 'monthly',
      source: 'auto-detected',
      status: 'active',
      account_id: ACCT_CHASE_CHECKING,
      merchant_pattern: 'att',
      last_detected_date: daysAgo(12),
      next_date: daysFromNow(18)
    },
    {
      // 'ended' status — exercises the ended/cancelled recurring UI state
      ...base('demo-rec-hulu'),
      name: 'Hulu',
      amount: '17.99',
      category_id: CAT_STREAMING,
      frequency: 'monthly',
      source: 'auto-detected',
      status: 'ended',
      account_id: ACCT_CHASE_CREDIT,
      merchant_pattern: 'hulu',
      last_detected_date: daysAgo(65),
      next_date: null
    }
  ]);
}

// =============================================================================
//                         RECORD BUILDER HELPERS
// =============================================================================

/**
 * Build a complete transaction record for demo seeding.
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
    category_source: 'auto',
    notes,
    csv_import_hash: csvHash
  };
}
