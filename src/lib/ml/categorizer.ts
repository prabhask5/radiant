/**
 * @fileoverview ML categorization orchestrator — 3-layer cascade.
 *
 * Runs transaction descriptions through a priority cascade:
 * 1. **Rules** (instant) — keyword lookup + Teller category mapping
 * 2. **Classifier** (fast) — Naive Bayes trained on user history
 *
 * Both layers run entirely on-device with zero network calls.
 * Returns the first result above the confidence threshold, or `null`
 * if no layer can categorize the transaction.
 */

import { debug } from 'stellar-drive/utils';
import { ruleLookup } from './rules';
import { categorizer } from './classifier';

// =============================================================================
//                              TYPES
// =============================================================================

/**
 * Result of a successful categorization.
 *
 * @property categoryKey - The matched category key (e.g., `'groceries'`)
 * @property confidence - Confidence score from 0 to 1
 * @property layer - Which layer produced the result
 */
export interface CategorizationResult {
  categoryKey: string;
  confidence: number;
  layer: 'rules' | 'classifier';
}

// =============================================================================
//                          ORCHESTRATOR
// =============================================================================

/**
 * Categorize a single transaction via the 2-layer cascade.
 *
 * Layer 1 (rules) is tried first — if it returns a result with confidence
 * >= 0.7, it's used immediately. Otherwise Layer 2 (Naive Bayes) is tried.
 * Both layers run entirely on-device.
 *
 * @param description - The transaction description / merchant name
 * @param tellerCategory - Optional Teller API category label
 * @returns Categorization result, or `null` if no layer could classify
 *
 * @example
 * ```ts
 * const result = categorizeTransaction('WHOLE FOODS MARKET #10432');
 * // → { categoryKey: 'groceries', confidence: 0.9, layer: 'rules' }
 * ```
 */
export function categorizeTransaction(
  description: string,
  tellerCategory?: string
): CategorizationResult | null {
  // Layer 1: instant rule lookup
  const rule = ruleLookup(description, tellerCategory);
  if (rule && rule.confidence >= 0.7) {
    return { categoryKey: rule.categoryKey, confidence: rule.confidence, layer: 'rules' };
  }

  // Layer 2: Naive Bayes (trained on user history)
  const nb = categorizer.predict(description);
  if (nb && nb.confidence >= 0.7) {
    return { categoryKey: nb.categoryKey, confidence: nb.confidence, layer: 'classifier' };
  }

  debug('log', '[ML:CATEGORIZE] No layer could classify', {
    description: description.slice(0, 40)
  });
  return null;
}

/**
 * Batch-categorize multiple transactions.
 *
 * Runs Layer 1 (rules) + Layer 2 (Naive Bayes) locally on all transactions.
 * Both layers are synchronous and run entirely on-device with no network calls.
 *
 * @param transactions - Array of transactions to categorize
 * @returns Map of transaction ID → categorization result (only includes successful categorizations)
 *
 * @example
 * ```ts
 * const results = batchCategorize([
 *   { id: 'txn-1', description: 'WHOLE FOODS MARKET' },
 *   { id: 'txn-2', description: 'NETFLIX.COM' }
 * ]);
 * results.get('txn-1'); // → { categoryKey: 'groceries', confidence: 0.9, layer: 'rules' }
 * ```
 */
export function batchCategorize(
  transactions: Array<{ id: string; description: string; tellerCategory?: string }>
): Map<string, CategorizationResult> {
  const results = new Map<string, CategorizationResult>();

  debug('log', '[ML:CATEGORIZE] Batch categorizing', { count: transactions.length });

  for (const txn of transactions) {
    // Layer 1
    const rule = ruleLookup(txn.description, txn.tellerCategory);
    if (rule && rule.confidence >= 0.7) {
      results.set(txn.id, {
        categoryKey: rule.categoryKey,
        confidence: rule.confidence,
        layer: 'rules'
      });
      continue;
    }

    // Layer 2
    const nb = categorizer.predict(txn.description);
    if (nb && nb.confidence >= 0.7) {
      results.set(txn.id, {
        categoryKey: nb.categoryKey,
        confidence: nb.confidence,
        layer: 'classifier'
      });
    }
  }

  debug('log', '[ML:CATEGORIZE] Batch complete', {
    input: transactions.length,
    categorized: results.size,
    layer1: Array.from(results.values()).filter((r) => r.layer === 'rules').length,
    layer2: Array.from(results.values()).filter((r) => r.layer === 'classifier').length
  });

  return results;
}
