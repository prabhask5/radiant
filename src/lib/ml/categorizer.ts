/**
 * @fileoverview ML categorization orchestrator — classifier-only.
 *
 * Runs transaction descriptions through the Naive Bayes classifier
 * trained on user history. Returns the predicted category UUID or
 * `__uncategorized__` (meaning "no category" was the best match).
 *
 * Runs entirely on-device with zero network calls.
 */

import { debug } from 'stellar-drive/utils';
import { categorizer } from './classifier';

// =============================================================================
//                              TYPES
// =============================================================================

/**
 * Result of a successful categorization.
 *
 * @property categoryId - The predicted category UUID, or `null` for uncategorized
 * @property confidence - Confidence score from 0 to 1
 */
export interface CategorizationResult {
  categoryId: string | null;
  confidence: number;
}

/** Special key representing "no category" in the classifier. */
export const UNCATEGORIZED_KEY = '__uncategorized__';

// =============================================================================
//                          ORCHESTRATOR
// =============================================================================

/**
 * Categorize a single transaction via the Naive Bayes classifier.
 *
 * @param description - The transaction description / merchant name
 * @returns Categorization result, or `null` if the model is untrained
 */
export function categorizeTransaction(description: string): CategorizationResult | null {
  const nb = categorizer.predict(description);
  if (nb && nb.confidence >= 0.7) {
    const categoryId = nb.categoryKey === UNCATEGORIZED_KEY ? null : nb.categoryKey;
    return { categoryId, confidence: nb.confidence };
  }

  debug('log', '[ML:CATEGORIZE] Classifier could not categorize', {
    description: description.slice(0, 40)
  });
  return null;
}

/**
 * Batch-categorize multiple transactions via the classifier.
 *
 * @param transactions - Array of transactions to categorize
 * @returns Map of transaction ID → categorization result (only includes successful categorizations)
 */
export function batchCategorize(
  transactions: Array<{ id: string; description: string }>
): Map<string, CategorizationResult> {
  const results = new Map<string, CategorizationResult>();

  debug('log', '[ML:CATEGORIZE] Batch categorizing', { count: transactions.length });

  for (const txn of transactions) {
    const nb = categorizer.predict(txn.description);
    if (nb && nb.confidence >= 0.7) {
      const categoryId = nb.categoryKey === UNCATEGORIZED_KEY ? null : nb.categoryKey;
      results.set(txn.id, { categoryId, confidence: nb.confidence });
    }
  }

  debug('log', '[ML:CATEGORIZE] Batch complete', {
    input: transactions.length,
    categorized: results.size
  });

  return results;
}
