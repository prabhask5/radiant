/**
 * @fileoverview Hardcoded default categories for Radiant Finance.
 *
 * Provides 55 default categories (41 expense, 8 income, 5 transfer, 1 uncategorized)
 * with emoji icons, hex colors, display ordering, and Teller category mappings
 * for auto-categorization.
 *
 * Categories use deterministic UUIDs derived from their key for idempotent seeding.
 * The `seedDefaultCategories()` function batch-creates all defaults on first
 * run, gated by a localStorage flag.
 */

// =============================================================================
//                              IMPORTS
// =============================================================================

import { engineGetAll, engineBatchWrite, engineDelete } from 'stellar-drive/data';
import type { BatchOperation } from 'stellar-drive/data';
import { debug } from 'stellar-drive/utils';
import type { Category } from '$lib/types';

// =============================================================================
//                         CATEGORY DEFINITION TYPE
// =============================================================================

/**
 * Shape of a default category definition.
 *
 * @property key - URL-safe slug used as the deterministic ID suffix
 * @property name - Human-readable display name
 * @property icon - Emoji character for the category
 * @property color - Hex color for UI accents
 * @property type - Classification: expense, income, or transfer
 * @property teller_categories - Teller API category labels that map to this category
 * @property order - Display order (lower = higher in list)
 */
export interface CategoryDefinition {
  key: string;
  name: string;
  icon: string;
  color: string;
  type: 'expense' | 'income' | 'transfer';
  teller_categories: string[];
  order: number;
}

// =============================================================================
//                      DEFAULT CATEGORY DEFINITIONS
// =============================================================================

/** All 54 default categories grouped by type. */
export const DEFAULT_CATEGORIES: CategoryDefinition[] = [
  // ── Expense (40) ──────────────────────────────────────────────────────────
  {
    key: 'groceries',
    name: 'Groceries',
    icon: '🛒',
    color: '#10b981',
    type: 'expense',
    teller_categories: ['groceries'],
    order: 1
  },
  {
    key: 'dining',
    name: 'Dining',
    icon: '🍽️',
    color: '#f59e0b',
    type: 'expense',
    teller_categories: ['dining'],
    order: 2
  },
  {
    key: 'coffee',
    name: 'Coffee',
    icon: '☕',
    color: '#92400e',
    type: 'expense',
    teller_categories: [],
    order: 3
  },
  {
    key: 'fast-food',
    name: 'Fast Food',
    icon: '🍔',
    color: '#dc2626',
    type: 'expense',
    teller_categories: [],
    order: 4
  },
  {
    key: 'rent',
    name: 'Rent',
    icon: '🏠',
    color: '#14b8a6',
    type: 'expense',
    teller_categories: [],
    order: 5
  },
  {
    key: 'mortgage',
    name: 'Mortgage',
    icon: '🏦',
    color: '#0d9488',
    type: 'expense',
    teller_categories: [],
    order: 6
  },
  {
    key: 'utilities',
    name: 'Utilities',
    icon: '💡',
    color: '#6366f1',
    type: 'expense',
    teller_categories: ['utilities'],
    order: 7
  },
  {
    key: 'electric',
    name: 'Electric',
    icon: '⚡',
    color: '#eab308',
    type: 'expense',
    teller_categories: [],
    order: 8
  },
  {
    key: 'water',
    name: 'Water',
    icon: '💧',
    color: '#0ea5e9',
    type: 'expense',
    teller_categories: [],
    order: 9
  },
  {
    key: 'internet',
    name: 'Internet',
    icon: '🌐',
    color: '#8b5cf6',
    type: 'expense',
    teller_categories: [],
    order: 10
  },
  {
    key: 'phone',
    name: 'Phone',
    icon: '📱',
    color: '#a855f7',
    type: 'expense',
    teller_categories: ['phone'],
    order: 11
  },
  {
    key: 'gas-fuel',
    name: 'Gas/Fuel',
    icon: '⛽',
    color: '#f97316',
    type: 'expense',
    teller_categories: ['fuel'],
    order: 12
  },
  {
    key: 'car-payment',
    name: 'Car Payment',
    icon: '🚗',
    color: '#3b82f6',
    type: 'expense',
    teller_categories: [],
    order: 13
  },
  {
    key: 'car-insurance',
    name: 'Car Insurance',
    icon: '🛡️',
    color: '#64748b',
    type: 'expense',
    teller_categories: ['insurance'],
    order: 14
  },
  {
    key: 'car-maintenance',
    name: 'Car Maintenance',
    icon: '🔧',
    color: '#78716c',
    type: 'expense',
    teller_categories: [],
    order: 15
  },
  {
    key: 'public-transit',
    name: 'Public Transit',
    icon: '🚌',
    color: '#0284c7',
    type: 'expense',
    teller_categories: ['transport', 'transportation'],
    order: 16
  },
  {
    key: 'rideshare',
    name: 'Rideshare',
    icon: '🚕',
    color: '#7c3aed',
    type: 'expense',
    teller_categories: [],
    order: 17
  },
  {
    key: 'parking',
    name: 'Parking',
    icon: '🅿️',
    color: '#475569',
    type: 'expense',
    teller_categories: [],
    order: 18
  },
  {
    key: 'health-insurance',
    name: 'Health Insurance',
    icon: '🏥',
    color: '#ef4444',
    type: 'expense',
    teller_categories: ['health'],
    order: 19
  },
  {
    key: 'doctor',
    name: 'Doctor',
    icon: '👨‍⚕️',
    color: '#f87171',
    type: 'expense',
    teller_categories: [],
    order: 20
  },
  {
    key: 'pharmacy',
    name: 'Pharmacy',
    icon: '💊',
    color: '#fb923c',
    type: 'expense',
    teller_categories: [],
    order: 21
  },
  {
    key: 'dental',
    name: 'Dental',
    icon: '🦷',
    color: '#fbbf24',
    type: 'expense',
    teller_categories: [],
    order: 22
  },
  {
    key: 'gym-fitness',
    name: 'Gym/Fitness',
    icon: '🏋️',
    color: '#22c55e',
    type: 'expense',
    teller_categories: ['sport'],
    order: 23
  },
  {
    key: 'clothing',
    name: 'Clothing',
    icon: '👕',
    color: '#ec4899',
    type: 'expense',
    teller_categories: ['clothing'],
    order: 24
  },
  {
    key: 'electronics',
    name: 'Electronics',
    icon: '💻',
    color: '#6366f1',
    type: 'expense',
    teller_categories: ['electronics'],
    order: 25
  },
  {
    key: 'shopping',
    name: 'Shopping',
    icon: '🛍️',
    color: '#8b5cf6',
    type: 'expense',
    teller_categories: ['shopping'],
    order: 26
  },
  {
    key: 'home-improvement',
    name: 'Home Improvement',
    icon: '🔨',
    color: '#b45309',
    type: 'expense',
    teller_categories: ['home'],
    order: 27
  },
  {
    key: 'furniture',
    name: 'Furniture',
    icon: '🛋️',
    color: '#a16207',
    type: 'expense',
    teller_categories: [],
    order: 28
  },
  {
    key: 'entertainment',
    name: 'Entertainment',
    icon: '🎬',
    color: '#ec4899',
    type: 'expense',
    teller_categories: ['entertainment'],
    order: 29
  },
  {
    key: 'streaming',
    name: 'Streaming',
    icon: '📺',
    color: '#a855f7',
    type: 'expense',
    teller_categories: ['software'],
    order: 30
  },
  {
    key: 'gaming',
    name: 'Gaming',
    icon: '🎮',
    color: '#7c3aed',
    type: 'expense',
    teller_categories: [],
    order: 31
  },
  {
    key: 'music',
    name: 'Music',
    icon: '🎵',
    color: '#e879f9',
    type: 'expense',
    teller_categories: [],
    order: 32
  },
  {
    key: 'books-education',
    name: 'Books/Education',
    icon: '📚',
    color: '#0891b2',
    type: 'expense',
    teller_categories: ['education'],
    order: 33
  },
  {
    key: 'pet-care',
    name: 'Pet Care',
    icon: '🐾',
    color: '#a3e635',
    type: 'expense',
    teller_categories: [],
    order: 34
  },
  {
    key: 'personal-care',
    name: 'Personal Care',
    icon: '💇',
    color: '#f472b6',
    type: 'expense',
    teller_categories: ['service'],
    order: 35
  },
  {
    key: 'gifts',
    name: 'Gifts',
    icon: '🎁',
    color: '#fb7185',
    type: 'expense',
    teller_categories: [],
    order: 36
  },
  {
    key: 'charity',
    name: 'Charity',
    icon: '❤️',
    color: '#f43f5e',
    type: 'expense',
    teller_categories: ['charity'],
    order: 37
  },
  {
    key: 'taxes',
    name: 'Taxes',
    icon: '📋',
    color: '#64748b',
    type: 'expense',
    teller_categories: ['tax'],
    order: 38
  },
  {
    key: 'childcare',
    name: 'Childcare',
    icon: '👶',
    color: '#38bdf8',
    type: 'expense',
    teller_categories: [],
    order: 39
  },
  {
    key: 'travel',
    name: 'Travel',
    icon: '✈️',
    color: '#0ea5e9',
    type: 'expense',
    teller_categories: ['accommodation'],
    order: 40
  },
  {
    key: 'misc',
    name: 'Miscellaneous',
    icon: '🤷',
    color: '#94a3b8',
    type: 'expense',
    teller_categories: [],
    order: 41
  },

  // ── Income (8) ────────────────────────────────────────────────────────────
  {
    key: 'salary',
    name: 'Salary',
    icon: '💰',
    color: '#22c55e',
    type: 'income',
    teller_categories: ['income'],
    order: 42
  },
  {
    key: 'freelance',
    name: 'Freelance',
    icon: '💼',
    color: '#10b981',
    type: 'income',
    teller_categories: [],
    order: 43
  },
  {
    key: 'investment-income',
    name: 'Investment Income',
    icon: '📈',
    color: '#059669',
    type: 'income',
    teller_categories: ['investment'],
    order: 44
  },
  {
    key: 'rental-income',
    name: 'Rental Income',
    icon: '🏘️',
    color: '#14b8a6',
    type: 'income',
    teller_categories: [],
    order: 45
  },
  {
    key: 'side-hustle',
    name: 'Side Hustle',
    icon: '🔥',
    color: '#f97316',
    type: 'income',
    teller_categories: [],
    order: 46
  },
  {
    key: 'refund',
    name: 'Refund',
    icon: '↩️',
    color: '#6366f1',
    type: 'income',
    teller_categories: [],
    order: 47
  },
  {
    key: 'interest',
    name: 'Interest',
    icon: '🏦',
    color: '#0d9488',
    type: 'income',
    teller_categories: [],
    order: 48
  },
  {
    key: 'other-income',
    name: 'Other Income',
    icon: '💵',
    color: '#34d399',
    type: 'income',
    teller_categories: [],
    order: 49
  },

  // ── Transfer (5) ──────────────────────────────────────────────────────────
  {
    key: 'transfer',
    name: 'Transfer',
    icon: '🔄',
    color: '#94a3b8',
    type: 'transfer',
    teller_categories: [],
    order: 50
  },
  {
    key: 'savings-transfer',
    name: 'Savings Transfer',
    icon: '🐖',
    color: '#a78bfa',
    type: 'transfer',
    teller_categories: [],
    order: 51
  },
  {
    key: 'credit-card-payment',
    name: 'Credit Card Payment',
    icon: '💳',
    color: '#64748b',
    type: 'transfer',
    teller_categories: [],
    order: 52
  },
  {
    key: 'investment-transfer',
    name: 'Investment Transfer',
    icon: '📊',
    color: '#8b5cf6',
    type: 'transfer',
    teller_categories: [],
    order: 53
  },
  {
    key: 'loan-payment',
    name: 'Loan Payment',
    icon: '🏛️',
    color: '#475569',
    type: 'transfer',
    teller_categories: ['loan'],
    order: 54
  }
];

// =============================================================================
//                          LOOKUP HELPERS
// =============================================================================

/** Map from category key to its definition for O(1) lookups. */
export const CATEGORY_BY_KEY = new Map(DEFAULT_CATEGORIES.map((c) => [c.key, c]));

/** Map from Teller category label to default category key. */
export const TELLER_TO_CATEGORY = new Map<string, string>();
for (const cat of DEFAULT_CATEGORIES) {
  for (const tc of cat.teller_categories) {
    TELLER_TO_CATEGORY.set(tc, cat.key);
  }
}

/**
 * Generate a deterministic UUID from a string input.
 *
 * Uses DJB2 hash with per-byte seeding to produce 16 bytes, then formats
 * as UUID v4 with proper version/variant bits. The same input always produces
 * the same UUID, making it safe for idempotent seeding.
 */
function deterministicUuid(input: string): string {
  const str = `radiant-category-v1-${input}`;
  const bytes = new Uint8Array(16);

  for (let i = 0; i < 16; i++) {
    let hash = 5381 + i * 33;
    for (let j = 0; j < str.length; j++) {
      hash = ((hash << 5) + hash + str.charCodeAt(j)) & 0xffffffff;
    }
    bytes[i] = hash & 0xff;
  }

  // UUID v4 format: set version and variant bits
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Convert a category key to its deterministic UUID.
 *
 * @param key - The category slug (e.g., `'groceries'`)
 * @returns Deterministic UUID string
 */
export function categoryKeyToId(key: string): string {
  return deterministicUuid(key);
}

/** Precomputed map from deterministic UUID → CategoryDefinition for reverse lookups. */
const CATEGORY_BY_UUID = new Map<string, CategoryDefinition>(
  DEFAULT_CATEGORIES.map((c) => [categoryKeyToId(c.key), c])
);

/**
 * Find a default category definition by its database UUID.
 *
 * @param id - The category UUID
 * @returns The category definition, or `undefined` if not found
 */
export function getCategoryById(id: string): CategoryDefinition | undefined {
  return CATEGORY_BY_UUID.get(id);
}

// =============================================================================
//                          SEEDING
// =============================================================================

/** localStorage key to gate one-time seeding. */
const SEED_FLAG = 'radiant_categories_seeded_v4';

/**
 * Seed all default categories into the database if not already present.
 *
 * Checks the categories table — if empty, batch-creates all 54 defaults
 * with deterministic IDs. Gated by a localStorage flag for idempotency.
 *
 * @example
 * ```ts
 * // In +layout.ts after engine init:
 * await seedDefaultCategories();
 * ```
 */
export async function seedDefaultCategories(): Promise<void> {
  // Skip if already seeded with UUID-based IDs
  if (typeof localStorage !== 'undefined' && localStorage.getItem(SEED_FLAG)) {
    debug('log', '[CATEGORIES] Already seeded — skipping');
    return;
  }

  // Check if categories already exist
  const existing = (await engineGetAll('categories')) as unknown as Category[];

  // Migration: if old `cat-{key}` format IDs exist, delete and re-seed with UUIDs
  const hasOldFormat = existing.some((c) => c.id.startsWith('cat-'));
  if (hasOldFormat) {
    debug('log', '[CATEGORIES] Migrating from cat- prefix IDs to UUIDs', {
      count: existing.length
    });
    // Delete old categories
    for (const cat of existing) {
      if (cat.id.startsWith('cat-')) {
        await engineDelete('categories', cat.id);
      }
    }
    // Migrate transaction category_id references from old cat- format to new UUIDs
    const allTxns = (await engineGetAll('transactions')) as unknown as Array<{
      id: string;
      category_id: string | null;
    }>;
    const migrateOps: BatchOperation[] = [];
    for (const txn of allTxns) {
      if (txn.category_id && txn.category_id.startsWith('cat-')) {
        const key = txn.category_id.slice(4);
        const newId = CATEGORY_BY_KEY.has(key) ? categoryKeyToId(key) : null;
        migrateOps.push({
          type: 'update' as const,
          table: 'transactions',
          id: txn.id,
          fields: { category_id: newId }
        });
      }
    }
    if (migrateOps.length > 0) {
      await engineBatchWrite(migrateOps);
      debug('log', '[CATEGORIES] Migrated transaction category_id references', {
        count: migrateOps.length
      });
    }
    // Clear old classifier model since it references old category IDs
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('radiant_nb_model');
    }
  } else if (existing.length > 0) {
    debug('log', '[CATEGORIES] Categories already present — marking as seeded');
    if (typeof localStorage !== 'undefined') localStorage.setItem(SEED_FLAG, 'true');
    return;
  }

  debug('log', '[CATEGORIES] Seeding default categories', { count: DEFAULT_CATEGORIES.length });

  const ops: BatchOperation[] = DEFAULT_CATEGORIES.map((cat) => ({
    type: 'create' as const,
    table: 'categories',
    data: {
      id: categoryKeyToId(cat.key),
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      type: cat.type,
      parent_id: null,
      teller_categories: cat.teller_categories,
      order: cat.order
    }
  }));

  await engineBatchWrite(ops);

  if (typeof localStorage !== 'undefined') localStorage.setItem(SEED_FLAG, 'true');
  debug('log', '[CATEGORIES] Seeding complete', { count: DEFAULT_CATEGORIES.length });
}
