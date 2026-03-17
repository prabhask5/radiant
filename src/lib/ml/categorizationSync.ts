/**
 * @fileoverview Categorization sync — auto-assigns categories to uncategorized transactions.
 *
 * Runs after transactionsStore.load(), processes all transactions where
 * `category_id === null`, and assigns categories above the confidence
 * threshold via the ML cascade.
 *
 * User overrides are permanent — once a user manually sets a category,
 * auto-categorization never touches that transaction again (it already
 * has a non-null category_id).
 */

import { engineGetAll, engineBatchWrite } from 'stellar-drive/data';
import type { BatchOperation } from 'stellar-drive/data';
import { debug } from 'stellar-drive/utils';
import type { Transaction } from '$lib/types';
import { categoryKeyToId } from '$lib/categories';
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
 * cascade assigns a category and sets `is_auto_categorized = true`. If the
 * user later changes the category, the flag stays true so the transaction
 * is never re-processed. This means manual edits are permanent.
 *
 * 1. Loads all transactions from the database
 * 2. Trains the Layer 2 classifier on already-categorized transactions
 * 3. Filters to never-categorized transactions (category_id null AND is_auto_categorized false)
 * 4. Runs the ML cascade on each
 * 5. Writes category assignments + is_auto_categorized flag for results above threshold
 *
 * Safe to call multiple times — only processes transactions that have never
 * been through auto-categorization.
 *
 * @example
 * ```ts
 * // After loading transactions:
 * await syncCategorizationResults();
 * ```
 */
export async function syncCategorizationResults(): Promise<void> {
  const allTxns = (await engineGetAll('transactions')) as unknown as Transaction[];
  if (allTxns.length === 0) return;

  // Train classifier on already-categorized transactions
  const categorized = allTxns.filter((t) => t.category_id !== null);
  if (categorized.length > 0) {
    categorizer.train(
      categorized.map((t) => ({
        description: t.description,
        category_id: t.category_id!
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

  // Run ML cascade (fully synchronous — rules + Naive Bayes, no network calls)
  const results = batchCategorize(
    uncategorized.map((t) => ({
      id: t.id,
      description: t.description,
      tellerCategory: t.teller_category ?? undefined
    }))
  );

  // Build batch update operations — always set is_auto_categorized so the
  // transaction is never re-processed, even if we couldn't categorize it.
  const ops: BatchOperation[] = [];
  const processed = new Set(uncategorized.map((t) => t.id));
  for (const txnId of processed) {
    const result = results.get(txnId);
    if (result && result.confidence >= CONFIDENCE_THRESHOLD) {
      const categoryId =
        result.layer === 'classifier' ? result.categoryKey : categoryKeyToId(result.categoryKey);

      ops.push({
        type: 'update' as const,
        table: 'transactions',
        id: txnId,
        fields: { category_id: categoryId, is_auto_categorized: true }
      });
    } else {
      // Mark as processed even if no category was assigned — prevents re-processing
      ops.push({
        type: 'update' as const,
        table: 'transactions',
        id: txnId,
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
