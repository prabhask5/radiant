/**
 * @fileoverview CSV parsing and transaction mapping utilities.
 *
 * Provides client-side CSV parsing with flexible column mapping for
 * importing bank transactions from arbitrary CSV formats. Supports
 * both single-amount and split debit/credit column layouts.
 *
 * Deduplication uses a deterministic hash of (account_id, date, amount,
 * description) stored in `csv_import_hash` on each transaction.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════════════════════ */

/** A single parsed CSV row mapped to the transaction schema. */
export interface CSVTransaction {
  date: string;
  description: string;
  amount: string;
  csv_import_hash: string;
}

/** Column mapping — tells the parser which CSV headers map to which fields. */
export interface CSVColumnMapping {
  date: string;
  description: string;
  /** Single amount column (positive/negative in one field). */
  amount?: string;
  /** Separate column for money coming in (deposits, credits). */
  credit?: string;
  /** Separate column for money going out (charges, debits). */
  debit?: string;
}

/** Result of parsing a CSV file. */
export interface CSVParseResult {
  headers: string[];
  rows: string[][];
}

/* ═══════════════════════════════════════════════════════════════════════════
   CSV PARSING
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Parse raw CSV text into headers and rows.
 *
 * Handles quoted fields (with commas and newlines inside quotes),
 * trims whitespace, and skips empty rows.
 */
export function parseCSV(text: string): CSVParseResult {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        current.push(field.trim());
        field = '';
      } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
        current.push(field.trim());
        field = '';
        if (current.some((f) => f.length > 0)) {
          rows.push(current);
        }
        current = [];
        if (ch === '\r') i++; // skip \n in \r\n
      } else {
        field += ch;
      }
    }
  }

  // Flush last field/row
  current.push(field.trim());
  if (current.some((f) => f.length > 0)) {
    rows.push(current);
  }

  if (rows.length === 0) return { headers: [], rows: [] };

  return {
    headers: rows[0],
    rows: rows.slice(1)
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   AUTO-DETECTION
   ═══════════════════════════════════════════════════════════════════════════ */

/** Common header name patterns for auto-mapping. */
const DATE_PATTERNS = ['date', 'transaction date', 'posting date', 'post date', 'trans date'];
const DESC_PATTERNS = [
  'description',
  'memo',
  'narrative',
  'details',
  'transaction description',
  'payee'
];
const AMOUNT_PATTERNS = ['amount', 'transaction amount', 'total'];
const CREDIT_PATTERNS = ['credit', 'credits', 'deposit', 'deposits', 'credit amount'];
const DEBIT_PATTERNS = ['debit', 'debits', 'withdrawal', 'withdrawals', 'debit amount', 'charge'];

function matchHeader(headers: string[], patterns: string[]): string | undefined {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const pattern of patterns) {
    const idx = lower.indexOf(pattern);
    if (idx !== -1) return headers[idx];
  }
  return undefined;
}

/**
 * Auto-detect column mapping from CSV headers.
 *
 * Returns a partial mapping with whatever fields it could confidently
 * match. The UI should let the user confirm/override.
 */
export function autoDetectMapping(headers: string[]): {
  mapping: Partial<CSVColumnMapping>;
  splitMode: boolean;
} {
  const date = matchHeader(headers, DATE_PATTERNS);
  const description = matchHeader(headers, DESC_PATTERNS);
  const amount = matchHeader(headers, AMOUNT_PATTERNS);
  const credit = matchHeader(headers, CREDIT_PATTERNS);
  const debit = matchHeader(headers, DEBIT_PATTERNS);

  // If we found separate credit/debit columns, prefer split mode
  const splitMode = !!(credit && debit) && !amount;

  const mapping: Partial<CSVColumnMapping> = {};
  if (date) mapping.date = date;
  if (description) mapping.description = description;

  if (splitMode) {
    if (credit) mapping.credit = credit;
    if (debit) mapping.debit = debit;
  } else {
    if (amount) mapping.amount = amount;
  }

  return { mapping, splitMode };
}

/* ═══════════════════════════════════════════════════════════════════════════
   DATE PARSING
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Parse a date string in common bank formats to YYYY-MM-DD.
 *
 * Supports: MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD, M/D/YYYY, M/D/YY,
 * MM/DD/YY, "Jan 15, 2026", "January 15, 2026".
 */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // MM/DD/YYYY or M/D/YYYY or MM-DD-YYYY
  const slashMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    const year = y.length === 2 ? (parseInt(y) > 50 ? '19' + y : '20' + y) : y;
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // "Jan 15, 2026" or "January 15, 2026"
  const namedMatch = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (namedMatch) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }

  // Fallback: let Date.parse try
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   AMOUNT PARSING
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Parse a monetary string to a number.
 * Strips currency symbols, commas, and parentheses (accounting negative).
 */
export function parseAmount(raw: string): number {
  let s = raw.trim();
  if (!s) return 0;

  // Accounting notation: (123.45) → -123.45
  const isParens = s.startsWith('(') && s.endsWith(')');
  if (isParens) s = s.slice(1, -1);

  const num = parseFloat(s.replace(/[^0-9.-]/g, ''));
  if (isNaN(num)) return 0;
  return isParens ? -num : num;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRANSACTION MAPPING
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Generate a deterministic dedup hash for a CSV-imported transaction.
 *
 * Uses a simple string hash of the composite key. Collisions are
 * acceptable at this scale (personal finance = thousands of rows).
 */
export function generateImportHash(
  accountId: string,
  date: string,
  amount: string,
  description: string
): string {
  const key = `${accountId}|${date}|${amount}|${description.trim().toLowerCase()}`;
  // djb2 hash → hex string
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Map parsed CSV rows to transaction objects using the provided column mapping.
 *
 * @param rows — Parsed CSV data rows (no headers).
 * @param headers — CSV header names (used to resolve column indices).
 * @param mapping — Column mapping configuration.
 * @param accountId — The account these transactions belong to.
 * @param accountType — `'depository'` or `'credit'`, used for sign normalisation.
 * @returns Array of mapped transactions (invalid rows are skipped).
 */
export function mapCSVToTransactions(
  rows: string[][],
  headers: string[],
  mapping: CSVColumnMapping,
  accountId: string,
  accountType: string
): CSVTransaction[] {
  const dateIdx = headers.indexOf(mapping.date);
  const descIdx = headers.indexOf(mapping.description);
  const amountIdx = mapping.amount ? headers.indexOf(mapping.amount) : -1;
  const creditIdx = mapping.credit ? headers.indexOf(mapping.credit) : -1;
  const debitIdx = mapping.debit ? headers.indexOf(mapping.debit) : -1;

  if (dateIdx === -1 || descIdx === -1) return [];
  if (amountIdx === -1 && creditIdx === -1 && debitIdx === -1) return [];

  const results: CSVTransaction[] = [];

  for (const row of rows) {
    const dateStr = parseDate(row[dateIdx] ?? '');
    const description = (row[descIdx] ?? '').trim();
    if (!dateStr || !description) continue;

    let amount: number;

    if (amountIdx !== -1) {
      // Single amount column
      amount = parseAmount(row[amountIdx] ?? '');
    } else {
      // Split debit/credit columns
      const creditVal = creditIdx !== -1 ? parseAmount(row[creditIdx] ?? '') : 0;
      const debitVal = debitIdx !== -1 ? parseAmount(row[debitIdx] ?? '') : 0;

      if (accountType === 'depository') {
        // For bank accounts: credits are positive (money in), debits are negative (money out)
        amount = Math.abs(creditVal) - Math.abs(debitVal);
      } else {
        // For credit cards: debits/charges are positive (money owed), credits are negative (payments)
        amount = Math.abs(debitVal) - Math.abs(creditVal);
      }
    }

    if (amount === 0) continue;

    const amountStr = amount.toFixed(2);
    const hash = generateImportHash(accountId, dateStr, amountStr, description);

    results.push({
      date: dateStr,
      description,
      amount: amountStr,
      csv_import_hash: hash
    });
  }

  return results;
}
