/**
 * @fileoverview Categorization sync — auto-assigns categories to uncategorized transactions.
 *
 * Runs after transactionsStore.load(), trains the Naive Bayes classifier on
 * the full transaction dataset (manual, propagated, auto — everything with a
 * category), then predicts categories for transactions that don't have one yet.
 *
 * Key rules:
 * - Training uses ALL non-deleted transactions with a category_id, regardless
 *   of source. This means propagated categories teach the classifier.
 * - Only transactions with `category_id === null` are candidates for auto-assignment.
 * - Manual assignments (`category_source: 'manual'`) are never overwritten.
 * - If the classifier can't confidently categorize a transaction, it is LEFT
 *   UNTOUCHED (no category_source set) so it can be retried on the next sync
 *   when the model has more training data.
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
 * 1. Loads all transactions from the database
 * 2. Trains the classifier on ALL transactions that have a category
 *    (manual + auto + propagated + legacy) — the full dataset
 * 3. Filters to uncategorized transactions (`category_id === null` and
 *    not manually set to "no category")
 * 4. Runs the classifier on each
 * 5. Writes `category_id` + `category_source = 'auto'` ONLY for results
 *    above confidence threshold. Failed predictions are left untouched
 *    so they can be retried on the next sync.
 */
export async function syncCategorizationResults(): Promise<Transaction[]> {
  const allTxns = (await engineGetAll('transactions')) as unknown as Transaction[];
  if (allTxns.length === 0) return allTxns;

  // Skip ML when no categories exist — nothing useful to assign.
  // Transactions stay untouched until the user creates categories.
  const allCategories = (await engineGetAll('categories')) as unknown as { deleted?: boolean }[];
  if (allCategories.filter((c) => !c.deleted).length === 0) return allTxns;

  // ── Training: use the FULL dataset ──────────────────────────────────────
  // Every non-deleted transaction with a category_id contributes to the
  // classifier, regardless of how it got categorized (manual, propagation,
  // auto, or legacy). This ensures propagated categories teach the model
  // so new similar transactions get classified correctly without needing
  // another manual categorization.
  //
  // Transactions where the user explicitly chose "no category"
  // (category_source === 'manual' and category_id === null) train the
  // __uncategorized__ class so the classifier can learn that pattern too.
  const trainingData = allTxns.filter(
    (t) => !t.deleted && (t.category_id !== null || t.category_source === 'manual')
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

  // ── Candidates: transactions with no category ───────────────────────────
  // Process any transaction where category_id is null AND the user hasn't
  // explicitly chosen "no category" (category_source !== 'manual').
  // This includes:
  //  - Brand-new transactions (category_source === null)
  //  - Previously failed auto-attempts (category_source === null, retried)
  //  - Transactions uncategorized by category deletion (category_source may
  //    be 'auto' or 'propagation' but category_id was cleared)
  const uncategorized = allTxns.filter(
    (t) => t.category_id === null && t.category_source !== 'manual' && !t.deleted
  );
  if (uncategorized.length === 0) {
    debug('log', '[ML:CATEGORIZE] No uncategorized transactions to process');
    return allTxns;
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

  // Build batch update operations — ONLY write when the classifier is
  // confident. Failed predictions are left untouched so the transaction
  // remains a candidate for the next sync (when the model may have more
  // training data from new manual categorizations).
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
    }
    // If below threshold: leave untouched — no category_source set, so
    // the transaction will be retried on the next sync.
  }

  if (ops.length > 0) {
    await engineBatchWrite(ops);
    debug('log', '[ML:CATEGORIZE] Auto-categorized transactions', {
      categorized: ops.length,
      skipped: uncategorized.length - ops.length,
      total: uncategorized.length
    });
  } else {
    debug('log', '[ML:CATEGORIZE] No transactions met confidence threshold');
  }

  return allTxns;
}
