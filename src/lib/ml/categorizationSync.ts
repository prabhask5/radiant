/**
 * @fileoverview Categorization sync — auto-assigns categories to uncategorized transactions.
 *
 * Runs after transactionsStore.load(), processes all transactions where
 * `category_id === null`, and assigns categories above the confidence
 * threshold via the ML classifier.
 *
 * User overrides are permanent — once a user manually sets a category,
 * auto-categorization never touches that transaction again (it already
 * has a non-null category_id, or was marked is_auto_categorized).
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
 * Each transaction is only auto-categorized **once**. On first run the ML
 * classifier assigns a category and sets `is_auto_categorized = true`. If the
 * user later changes the category, the flag stays true so the transaction
 * is never re-processed. This means manual edits are permanent.
 *
 * Includes `category_id === null` transactions in training data (as the
 * `__uncategorized__` class) so the classifier can learn to predict
 * "no category" as a real pattern.
 *
 * 1. Loads all transactions from the database
 * 2. Trains the classifier on all user-categorized transactions (including null = uncategorized)
 * 3. Filters to never-categorized transactions (category_id null AND is_auto_categorized false)
 * 4. Runs the classifier on each
 * 5. Writes category assignments + is_auto_categorized flag for results above threshold
 */
export async function syncCategorizationResults(): Promise<void> {
  const allTxns = (await engineGetAll('transactions')) as unknown as Transaction[];
  if (allTxns.length === 0) return;

  // Train classifier on all transactions that have been through user categorization.
  // Include manually-categorized (category_id set) and manually-uncategorized
  // (category_id null but is_auto_categorized true, meaning user explicitly set "no category").
  const trainingData = allTxns.filter(
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
  }

  // Find transactions that have never been auto-categorized.
  // Once is_auto_categorized is set to true, the transaction is never
  // re-processed — even if the user clears the category back to null.
  const uncategorized = allTxns.filter(
    (t) => t.category_id === null && !t.is_auto_categorized && !t.deleted
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

  // Build batch update operations — always set is_auto_categorized so the
  // transaction is never re-processed, even if we couldn't categorize it.
  const ops: BatchOperation[] = [];
  for (const txn of uncategorized) {
    const result = results.get(txn.id);
    if (result && result.confidence >= CONFIDENCE_THRESHOLD) {
      ops.push({
        type: 'update' as const,
        table: 'transactions',
        id: txn.id,
        fields: { category_id: result.categoryId, is_auto_categorized: true }
      });
    } else {
      // Mark as processed even if no category was assigned — prevents re-processing
      ops.push({
        type: 'update' as const,
        table: 'transactions',
        id: txn.id,
        fields: { is_auto_categorized: true }
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
