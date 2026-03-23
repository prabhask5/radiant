/**
 * @fileoverview Category propagation — fuzzy-matches similar transactions
 * after a manual category assignment and applies the same category.
 *
 * When a user manually sets a category on a transaction, this module finds
 * other transactions with similar descriptions and propagates the category.
 * Overwrites auto-categorized and new transactions but never manual user assignments.
 *
 * Classifier retraining is handled by the caller via `scheduleMLSync()` —
 * this module only handles the propagation write.
 */

import { engineGetAll, engineBatchWrite } from 'stellar-drive/data';
import type { BatchOperation } from 'stellar-drive/data';
import { debug } from 'stellar-drive/utils';
import type { Transaction } from '$lib/types';

// =============================================================================
//                          TOKENIZATION & SIMILARITY
// =============================================================================

/**
 * Tokenize a transaction description for similarity matching.
 * Strips numbers, special chars, lowercases, splits into unique tokens.
 *
 * @example "STARBUCKS #10432 SEATTLE WA" → Set{"starbucks", "seattle"}
 */
function tokenize(desc: string): Set<string> {
  const stops = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'this',
    'that',
    'was',
    'are',
    'com',
    'www',
    'inc',
    'llc',
    'ltd',
    'corp',
    'pos',
    'debit',
    'credit',
    'purchase',
    'payment',
    'online',
    'sq',
    'tst',
    'pp'
  ]);

  const tokens = desc
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stops.has(w));
  return new Set(tokens);
}

/**
 * Compute similarity between two token sets using overlap coefficient:
 * |intersection| / min(|A|, |B|).
 *
 * Returns 1.0 when one set is a complete subset of the other.
 */
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const token of smaller) {
    if (larger.has(token)) overlap++;
  }
  return overlap / smaller.size;
}

/**
 * Minimum overlap coefficient to consider two descriptions "similar".
 *
 * 0.5 allows matching when half the tokens in the shorter description
 * appear in the longer one — handles varying store numbers, locations,
 * and suffixes (e.g. "STARBUCKS SEATTLE WA" ↔ "STARBUCKS BELLEVUE WA").
 */
const SIMILARITY_THRESHOLD = 0.5;

// =============================================================================
//                          PROPAGATION
// =============================================================================

export interface PropagationResult {
  propagatedCount: number;
}

/**
 * Propagate a manual category assignment to similar transactions.
 *
 * Reads fresh data from the database (not reactive stores) to avoid
 * stale-data bugs. Only updates transactions that are:
 * - Not deleted
 * - Not the source transaction
 * - Not manually categorized (never overwrites manual assignments)
 * - Not already set to the target category
 * - Above the similarity threshold
 *
 * Does NOT retrain the classifier — the caller's `scheduleMLSync()` handles
 * that, avoiding redundant retraining.
 *
 * @param sourceTransactionId - The transaction the user just categorized
 * @param categoryId - The category the user assigned
 * @returns Number of transactions that were propagated to
 */
export async function propagateCategory(
  sourceTransactionId: string,
  categoryId: string
): Promise<PropagationResult> {
  const allTxns = (await engineGetAll('transactions')) as unknown as Transaction[];
  const source = allTxns.find((t) => t.id === sourceTransactionId);
  if (!source) {
    debug('warn', '[ML:PROPAGATE] Source transaction not found', { sourceTransactionId });
    return { propagatedCount: 0 };
  }

  const sourceTokens = tokenize(source.description);
  if (sourceTokens.size === 0) {
    debug('warn', '[ML:PROPAGATE] Source tokenized to empty set', {
      description: source.description
    });
    return { propagatedCount: 0 };
  }

  debug('log', '[ML:PROPAGATE] Starting propagation', {
    source: source.description.slice(0, 50),
    tokens: [...sourceTokens],
    categoryId,
    totalTxns: allTxns.length
  });

  // Find similar transactions to propagate to.
  // Overwrites auto-ML, previous propagation, and new transactions but
  // never overwrites manual user categorizations — user intent always wins.
  const matches = allTxns.filter((t) => {
    if (t.deleted || t.id === sourceTransactionId) return false;
    // Never overwrite manually-set categories (including manual "no category").
    // Legacy data (category_source null + category_id set) is treated as manual.
    if (t.category_source === 'manual') return false;
    if (t.category_source === null && t.category_id !== null) return false;
    // Skip transactions already set to this exact category
    if (t.category_id === categoryId) return false;
    return similarity(sourceTokens, tokenize(t.description)) >= SIMILARITY_THRESHOLD;
  });

  if (matches.length > 0) {
    const ops: BatchOperation[] = matches.map((t) => ({
      type: 'update' as const,
      table: 'transactions',
      id: t.id,
      fields: { category_id: categoryId, category_source: 'propagation' }
    }));
    await engineBatchWrite(ops);
    debug('log', '[ML:PROPAGATE] Propagated category to similar transactions', {
      source: source.description.slice(0, 40),
      categoryId,
      count: matches.length
    });
  }

  return { propagatedCount: matches.length };
}
