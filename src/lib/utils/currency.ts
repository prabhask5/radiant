/**
 * @fileoverview Currency formatting and financial calculation utilities.
 *
 * Provides consistent formatting for monetary values, percentages, and dates
 * throughout the Radiant Finance UI. All currency formatting uses
 * `Intl.NumberFormat` for locale-aware output.
 *
 * Key conventions:
 * - Monetary amounts are stored as strings in the database to preserve
 *   decimal precision; these helpers accept both `number` and `string`.
 * - Dates are stored as YYYY-MM-DD strings; month identifiers as YYYY-MM.
 * - All formatting currently uses the `'en-US'` locale.
 */

/**
 * Format a numeric amount as a locale-aware currency string.
 *
 * Handles both `number` and `string` inputs (common when reading decimal
 * strings from the database). Returns `'$0.00'` for `NaN` inputs.
 *
 * @param amount - The amount to format (number or decimal string)
 * @param currency - ISO 4217 currency code (default: `'USD'`)
 * @param showCents - Whether to show decimal places (default: `true`)
 * @returns Formatted currency string
 *
 * @example
 * ```ts
 * formatCurrency(1234.5);             // "$1,234.50"
 * formatCurrency('1234.5', 'USD', false); // "$1,235"
 * formatCurrency(-42.99);             // "-$42.99"
 * formatCurrency('not-a-number');     // "$0.00"
 * ```
 */
export function formatCurrency(
  amount: number | string,
  currency = 'USD',
  showCents = true
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '$0.00';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0
  }).format(num);
}

/**
 * Format a currency value in compact notation (e.g., `$1.2K`, `$3.5M`).
 *
 * Useful for dashboard summaries and chart axis labels where space is limited.
 *
 * @param amount - The amount to format (number or decimal string)
 * @param currency - ISO 4217 currency code (default: `'USD'`)
 * @returns Compact currency string
 *
 * @example
 * ```ts
 * formatCurrencyCompact(1200);        // "$1.2K"
 * formatCurrencyCompact(3500000);     // "$3.5M"
 * formatCurrencyCompact('750');       // "$750"
 * formatCurrencyCompact('invalid');   // "$0"
 * ```
 */
export function formatCurrencyCompact(amount: number | string, currency = 'USD'): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '$0';

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(num);
}

/**
 * Parse a monetary string to a number, stripping currency symbols and commas.
 *
 * Extracts the numeric value from formatted currency strings. Returns `0`
 * if parsing fails.
 *
 * @param value - The monetary string to parse (e.g., `"$1,234.56"`)
 * @returns Parsed numeric value
 *
 * @example
 * ```ts
 * parseMoney('$1,234.56');  // 1234.56
 * parseMoney('-$42.99');    // -42.99
 * parseMoney('invalid');    // 0
 * ```
 */
export function parseMoney(value: string): number {
  const cleaned = value.replace(/[^0-9.-]/g, '');
  return parseFloat(cleaned) || 0;
}

/**
 * Calculate the percentage change between two values.
 *
 * Uses `Math.abs(previous)` as the denominator to handle negative base
 * values correctly (e.g., liability reduction). Returns `0` when both
 * values are zero, and `100` when the previous value is zero but current
 * is non-zero.
 *
 * @param current - The current value
 * @param previous - The previous value to compare against
 * @returns Percentage change (can be negative)
 *
 * @example
 * ```ts
 * percentChange(110, 100);   // 10
 * percentChange(90, 100);    // -10
 * percentChange(50, 0);      // 100
 * percentChange(0, 0);       // 0
 * ```
 */
export function percentChange(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Format a percentage with an explicit sign prefix.
 *
 * Positive values get a `+` prefix, negative values keep their `-`,
 * and zero gets no prefix.
 *
 * @param value - The percentage value to format
 * @param decimals - Number of decimal places (default: `1`)
 * @returns Formatted percentage string with sign
 *
 * @example
 * ```ts
 * formatPercent(12.345);     // "+12.3%"
 * formatPercent(-5.678);     // "-5.7%"
 * formatPercent(0);          // "0.0%"
 * formatPercent(100, 0);     // "+100%"
 * ```
 */
export function formatPercent(value: number, decimals = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

/**
 * Determine the CSS class for a transaction amount.
 *
 * Sign conventions differ by account type:
 * - **Depository (bank)**: positive = deposit (money in), negative = withdrawal (money out)
 * - **Credit card**: positive = charge (money out), negative = payment/refund (money in)
 *
 * @param amount - The amount to classify (number or decimal string)
 * @param accountType - The account type (`'depository'` or `'credit'`); defaults to `'credit'`
 * @returns `'credit'`, `'debit'`, or `'zero'`
 */
export function amountClass(
  amount: number | string,
  accountType: string = 'credit'
): 'credit' | 'debit' | 'zero' {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (num === 0 || isNaN(num)) return 'zero';

  const isMoneyIn = accountType === 'depository' ? num > 0 : num < 0;

  return isMoneyIn ? 'credit' : 'debit';
}

/**
 * Determine if a transaction amount represents money coming in.
 *
 * Sign conventions differ by account type:
 * - **Depository (bank)**: positive = money in
 * - **Credit card**: negative = money in (payment/refund)
 *
 * @param amount - The parsed numeric amount
 * @param accountType - The account type (`'depository'` or `'credit'`)
 * @returns `true` if the amount represents inflow
 */
export function isInflow(amount: number, accountType: string): boolean {
  return accountType === 'depository' ? amount > 0 : amount < 0;
}

/**
 * Get the current month as a `YYYY-MM` string.
 *
 * Uses the system clock to determine the current calendar month.
 *
 * @returns Current month in `YYYY-MM` format
 *
 * @example
 * ```ts
 * getCurrentMonth(); // "2026-03" (if called in March 2026)
 * ```
 */
export function getCurrentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get the previous month as a `YYYY-MM` string.
 *
 * If a `month` argument is provided, returns the month before that one.
 * Otherwise, returns the month before the current system month. Handles
 * year boundaries correctly (January wraps to December of the prior year).
 *
 * @param month - Optional reference month in `YYYY-MM` format
 * @returns Previous month in `YYYY-MM` format
 *
 * @example
 * ```ts
 * getPreviousMonth('2026-03');  // "2026-02"
 * getPreviousMonth('2026-01');  // "2025-12"
 * getPreviousMonth();           // previous month from today
 * ```
 */
export function getPreviousMonth(month?: string): string {
  const d = month ? new Date(month + '-01') : new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Format a `YYYY-MM` month string to a human-readable display name.
 *
 * @param month - Month identifier in `YYYY-MM` format
 * @returns Formatted month name (e.g., `"March 2026"`)
 *
 * @example
 * ```ts
 * formatMonth('2026-03');  // "March 2026"
 * formatMonth('2025-12');  // "December 2025"
 * ```
 */
export function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  const date = new Date(parseInt(year), parseInt(m) - 1, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Format a `YYYY-MM-DD` date string for display with relative-day awareness.
 *
 * Returns relative labels for recent dates ("Today", "Yesterday", weekday
 * names for the past week) and falls back to abbreviated date format for
 * older dates. Omits the year when it matches the current year.
 *
 * @param dateStr - Date in `YYYY-MM-DD` format
 * @returns Human-readable date string
 *
 * @example
 * ```ts
 * formatDate('2026-03-14');  // "Today" (if today is March 14, 2026)
 * formatDate('2026-03-13');  // "Yesterday"
 * formatDate('2026-03-10');  // "Tuesday"
 * formatDate('2026-01-15');  // "Jan 15"
 * formatDate('2025-06-01');  // "Jun 1, 2025"
 * ```
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

/**
 * Format a `YYYY-MM-DD` date string for grouping headers.
 *
 * Always includes the year, producing a consistent format suitable for
 * transaction list group dividers.
 *
 * @param dateStr - Date in `YYYY-MM-DD` format
 * @returns Formatted date string (e.g., `"Mar 14, 2026"`)
 *
 * @example
 * ```ts
 * formatDateGroup('2026-03-14');  // "Mar 14, 2026"
 * formatDateGroup('2025-01-01');  // "Jan 1, 2025"
 * ```
 */
export function formatDateGroup(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}
