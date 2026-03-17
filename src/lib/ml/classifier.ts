/**
 * @fileoverview Frequency-based transaction classifier (Layer 2).
 *
 * Learns from the user's own categorization history using a Naive Bayes
 * approach with word-frequency features. Trains on manually categorized
 * transactions, then predicts categories for uncategorized ones.
 *
 * The model is persisted to localStorage so retraining only happens when
 * new training data is available.
 */

import { debug } from 'stellar-drive/utils';

// =============================================================================
//                              TYPES
// =============================================================================

/** Result of a classifier prediction. */
export interface ClassifierResult {
  categoryKey: string;
  confidence: number;
}

/** Serialized model state for localStorage persistence. */
interface SerializedModel {
  categoryWords: Record<string, Record<string, number>>;
  categoryCounts: Record<string, number>;
  totalDocs: number;
  vocab: string[];
}

// =============================================================================
//                          TOKENIZER
// =============================================================================

/**
 * Tokenize a transaction description into lowercased word tokens.
 *
 * Splits on non-alphanumeric characters, filters out short words (< 2 chars)
 * and common stop words, and deduplicates.
 *
 * @param text - Raw transaction description
 * @returns Array of unique lowercased tokens
 */
function tokenize(text: string): string[] {
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
    'credit'
  ]);

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stops.has(w));

  return [...new Set(words)];
}

// =============================================================================
//                      FREQUENCY CATEGORIZER
// =============================================================================

/** localStorage key for persisted model. */
const MODEL_KEY = 'radiant_nb_model';

/**
 * Naive Bayes-style frequency categorizer.
 *
 * Learns word→category associations from categorized transactions,
 * then predicts the most likely category for new descriptions.
 *
 * @example
 * ```ts
 * const classifier = new FrequencyCategorizer();
 * classifier.train([
 *   { description: 'WHOLE FOODS MARKET', category_id: 'cat-groceries' },
 *   { description: 'TRADER JOES', category_id: 'cat-groceries' },
 *   { description: 'NETFLIX.COM', category_id: 'cat-streaming' }
 * ]);
 * classifier.predict('WHOLE FOODS #123');
 * // → { categoryKey: 'cat-groceries', confidence: 0.85 }
 * ```
 */
export class FrequencyCategorizer {
  /** Category → (word → count) frequency table. */
  private categoryWords: Map<string, Map<string, number>> = new Map();

  /** Category → total document count. */
  private categoryCounts: Map<string, number> = new Map();

  /** Total training documents. */
  private totalDocs = 0;

  /** Full vocabulary set for Laplace smoothing. */
  private vocab: Set<string> = new Set();

  // ═══════════════════════════════════════════════════════════════════════
  //                           TRAINING
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Train the classifier on categorized transactions.
   *
   * Resets any previous model state and rebuilds from scratch.
   * Call this when the user's categorization history changes.
   *
   * @param transactions - Array of transactions with descriptions and category IDs
   */
  train(transactions: Array<{ description: string; category_id: string }>): void {
    this.categoryWords.clear();
    this.categoryCounts.clear();
    this.vocab.clear();
    this.totalDocs = 0;

    for (const txn of transactions) {
      const words = tokenize(txn.description);
      const cat = txn.category_id;
      this.totalDocs++;
      this.categoryCounts.set(cat, (this.categoryCounts.get(cat) || 0) + 1);

      if (!this.categoryWords.has(cat)) this.categoryWords.set(cat, new Map());
      const wordMap = this.categoryWords.get(cat)!;
      for (const w of words) {
        wordMap.set(w, (wordMap.get(w) || 0) + 1);
        this.vocab.add(w);
      }
    }

    debug('log', '[ML:CATEGORIZE] Classifier trained', {
      docs: this.totalDocs,
      categories: this.categoryCounts.size,
      vocab: this.vocab.size
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //                          PREDICTION
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Predict the most likely category for a transaction description.
   *
   * Uses log-space Naive Bayes with Laplace smoothing. Returns the
   * highest-scoring category with a normalized confidence score.
   *
   * @param description - Raw transaction description
   * @returns Prediction result, or `null` if model is untrained
   */
  predict(description: string): ClassifierResult | null {
    if (this.totalDocs === 0 || this.categoryCounts.size === 0) return null;

    const words = tokenize(description);
    if (words.length === 0) return null;

    const vocabSize = this.vocab.size;
    let bestCat = '';
    let bestScore = -Infinity;
    const scores: Map<string, number> = new Map();

    for (const [cat, catCount] of this.categoryCounts) {
      // Log prior: P(category)
      let logProb = Math.log(catCount / this.totalDocs);

      const wordMap = this.categoryWords.get(cat)!;
      const totalWordsInCat = Array.from(wordMap.values()).reduce((s, c) => s + c, 0);

      // Log likelihood for each word with Laplace smoothing
      for (const w of words) {
        const wordCount = wordMap.get(w) || 0;
        logProb += Math.log((wordCount + 1) / (totalWordsInCat + vocabSize));
      }

      scores.set(cat, logProb);
      if (logProb > bestScore) {
        bestScore = logProb;
        bestCat = cat;
      }
    }

    if (!bestCat) return null;

    // Convert log scores to normalized confidence via softmax
    const maxScore = bestScore;
    let expSum = 0;
    for (const score of scores.values()) {
      expSum += Math.exp(score - maxScore);
    }
    const confidence = 1 / expSum;

    debug('log', '[ML:CATEGORIZE] Classifier prediction', {
      description: description.slice(0, 40),
      category: bestCat,
      confidence: confidence.toFixed(3)
    });

    return { categoryKey: bestCat, confidence };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //                        PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Serialize the trained model to a JSON string for localStorage.
   *
   * @returns JSON string representation of the model
   */
  serialize(): string {
    const data: SerializedModel = {
      categoryWords: {},
      categoryCounts: Object.fromEntries(this.categoryCounts),
      totalDocs: this.totalDocs,
      vocab: [...this.vocab]
    };

    for (const [cat, words] of this.categoryWords) {
      data.categoryWords[cat] = Object.fromEntries(words);
    }

    return JSON.stringify(data);
  }

  /**
   * Deserialize a model from a JSON string (from localStorage).
   *
   * @param json - JSON string from a previous `serialize()` call
   */
  deserialize(json: string): void {
    try {
      const data: SerializedModel = JSON.parse(json);
      this.totalDocs = data.totalDocs;
      this.categoryCounts = new Map(
        Object.entries(data.categoryCounts).map(([k, v]) => [k, Number(v)])
      );
      this.vocab = new Set(data.vocab);
      this.categoryWords.clear();

      for (const [cat, words] of Object.entries(data.categoryWords)) {
        this.categoryWords.set(cat, new Map(Object.entries(words).map(([k, v]) => [k, Number(v)])));
      }

      debug('log', '[ML:CATEGORIZE] Classifier deserialized', {
        docs: this.totalDocs,
        categories: this.categoryCounts.size
      });
    } catch {
      debug('warn', '[ML:CATEGORIZE] Failed to deserialize classifier model');
      this.categoryWords.clear();
      this.categoryCounts.clear();
      this.totalDocs = 0;
      this.vocab.clear();
    }
  }

  /**
   * Save the model to localStorage.
   */
  save(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MODEL_KEY, this.serialize());
      debug('log', '[ML:CATEGORIZE] Classifier model saved to localStorage');
    }
  }

  /**
   * Load the model from localStorage.
   *
   * @returns `true` if a model was loaded, `false` otherwise
   */
  load(): boolean {
    if (typeof localStorage === 'undefined') return false;
    const json = localStorage.getItem(MODEL_KEY);
    if (!json) return false;
    this.deserialize(json);
    return this.totalDocs > 0;
  }
}

/** Singleton classifier instance. */
export const categorizer = new FrequencyCategorizer();
