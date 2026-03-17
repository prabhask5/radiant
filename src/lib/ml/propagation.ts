/**
 * @fileoverview Category propagation — fuzzy-matches similar transactions
 * after a manual category assignment and applies the same category.
 *
 * When a user manually sets a category on a transaction, this module finds
 * other transactions with similar descriptions and propagates the category.
 * Only targets uncategorized or previously auto-categorized transactions —
 * never overwrites a user's manual choice.
 *
 * Also retrains the Naive Bayes classifier on the updated training data
 * so future auto-categorizations benefit from the new signal.
 */

import { engineGetAll, engineBatchWrite } from 'stellar-drive/data';
import type { BatchOperation } from 'stellar-drive/data';
import { debug } from 'stellar-drive/utils';
import type { Transaction } from '$lib/types';
import { categorizer } from './classifier';

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
 * - Uncategorized (category_id === null)
 * - Above the similarity threshold
 *
 * After propagation, retrains the classifier on the full updated dataset.
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
  if (!source) return { propagatedCount: 0 };

  const sourceTokens = tokenize(source.description);
  if (sourceTokens.size === 0) return { propagatedCount: 0 };

  // Find similar uncategorized transactions to propagate to.
  // Only targets transactions with no category at all — never overwrites
  // any existing categorization (manual or auto).
  const matches = allTxns.filter((t) => {
    if (t.deleted || t.id === sourceTransactionId) return false;
    if (t.category_id !== null) return false;
    return similarity(sourceTokens, tokenize(t.description)) >= SIMILARITY_THRESHOLD;
  });

  if (matches.length > 0) {
    const ops: BatchOperation[] = matches.map((t) => ({
      type: 'update' as const,
      table: 'transactions',
      id: t.id,
      fields: { category_id: categoryId, is_auto_categorized: true }
    }));
    await engineBatchWrite(ops);
    debug('log', '[ML:PROPAGATE] Propagated category to similar transactions', {
      source: source.description.slice(0, 40),
      categoryId,
      count: matches.length
    });
  }

  // Retrain classifier on the full updated dataset (including propagated changes)
  const updatedTxns = (await engineGetAll('transactions')) as unknown as Transaction[];
  const trainingData = updatedTxns.filter(
    (t) => !t.deleted && (t.category_id !== null || t.is_auto_categorized)
  );
  if (trainingData.length > 0) {
    categorizer.train(
      trainingData.map((t) => ({
        description: t.description,
        category_id: t.category_id
      }))
    );
    categorizer.save();
    debug('log', '[ML:PROPAGATE] Classifier retrained after propagation', {
      trainingDocs: trainingData.length
    });
  }

  return { propagatedCount: matches.length };
}
