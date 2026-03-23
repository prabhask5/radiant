/**
 * @fileoverview Categorization sync — auto-assigns categories to uncategorized transactions.
 *
 * Runs after transactionsStore.load(), processes all transactions where
 * `category_id === null`, and assigns categories above the confidence
 * threshold via the ML classifier.
 *
 * User overrides are permanent — once a user manually sets a category,
 * auto-categorization never touches that transaction again (it already
 * has a non-null category_id, or has category_source set).
 */

import { engineGetAll, engineBatchWrite } from 'stellar-drive/data';
import type { BatchOperation } from 'stellar-drive/data';
import { debug } from 'stellar-drive/utils';
import type { Transaction } from '$lib/types';
import { batchCategorize } from './categorizer';
import { categorizer } from './classifier';

// =============================================================================
//                          SYNC FUNCTION
// =============================================================================

/** Minimum confidence threshold for auto-assignment. */
const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Auto-categorize uncategorized transactions.
 *
 * Only processes truly new transactions (`category_source === null`).
 * Transactions touched by propagation, manual categorization, or a
 * previous auto-sync run are never re-processed.
 *
 * Includes `category_id === null` transactions in training data (as the
 * `__uncategorized__` class) so the classifier can learn to predict
 * "no category" as a real pattern.
 *
 * 1. Loads all transactions from the database
 * 2. Trains the classifier on all categorized transactions (manual + auto)
 * 3. Filters to never-categorized transactions (`category_source === null`)
 * 4. Runs the classifier on each
 * 5. Writes category assignments + `category_source = 'auto'` for results above threshold
 */
export async function syncCategorizationResults(): Promise<void> {
  const allTxns = (await engineGetAll('transactions')) as unknown as Transaction[];
  if (allTxns.length === 0) return;

  // Skip ML when no categories exist — nothing useful to assign.
  // Transactions stay in "never touched" state until the user creates categories.
  const allCategories = (await engineGetAll('categories')) as unknown as { deleted?: boolean }[];
  if (allCategories.filter((c) => !c.deleted).length === 0) return;

  // Train classifier on all transactions that have been categorized (manual or auto).
  // Include manually-uncategorized (category_source set but category_id null,
  // meaning user explicitly chose "no category") so the classifier can learn that pattern.
  // Also include legacy data (category_source null but category_id set) for training.
  const trainingData = allTxns.filter(
    (t) => !t.deleted && (t.category_source !== null || t.category_id !== null)
  );
  if (trainingData.length > 0) {
    categorizer.train(
      trainingData.map((t) => ({
        description: t.description,
        category_id: t.category_id
      }))
    );
    categorizer.save();
  }

  // Find truly new transactions that have never been categorized by anyone.
  // Once category_source is set (to 'manual' or 'auto'), the transaction is
  // never re-processed — even if the user clears the category back to null.
  // Legacy data (category_source null + category_id set) is treated as already processed.
  const uncategorized = allTxns.filter(
    (t) => t.category_source === null && t.category_id === null && !t.deleted
  );
  if (uncategorized.length === 0) {
    debug('log', '[ML:CATEGORIZE] No uncategorized transactions to process');
    return;
  }

  debug('log', '[ML:CATEGORIZE] Processing uncategorized transactions', {
    count: uncategorized.length
  });

  // Run classifier (fully synchronous, no network calls)
  const results = batchCategorize(
    uncategorized.map((t) => ({
      id: t.id,
      description: t.description
    }))
  );

  // Build batch update operations — always set category_source so the
  // transaction is never re-processed, even if we couldn't categorize it.
  const ops: BatchOperation[] = [];
  for (const txn of uncategorized) {
    const result = results.get(txn.id);
    if (result && result.confidence >= CONFIDENCE_THRESHOLD) {
      ops.push({
        type: 'update' as const,
        table: 'transactions',
        id: txn.id,
        fields: { category_id: result.categoryId, category_source: 'auto' }
      });
    } else {
      // Mark as processed even if no category was assigned — prevents re-processing
      ops.push({
        type: 'update' as const,
        table: 'transactions',
        id: txn.id,
        fields: { category_source: 'auto' }
      });
    }
  }

  if (ops.length > 0) {
    await engineBatchWrite(ops);
    debug('log', '[ML:CATEGORIZE] Auto-categorized transactions', {
      count: ops.length,
      total: uncategorized.length
    });
  } else {
    debug('log', '[ML:CATEGORIZE] No transactions met confidence threshold');
  }
}
