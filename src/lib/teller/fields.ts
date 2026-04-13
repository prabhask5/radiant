/**
 * @fileoverview Shared Teller field comparison utilities.
 *
 * Pure functions with no browser or Node.js dependencies — safe to import
 * from both client-side code (autoSync.ts) and server-side routes (webhook).
 */

/** Teller-managed transaction fields used for change detection. */
export interface TellerTxnFields {
  status: string;
  amount: string;
  description: string;
  counterparty_name: string | null;
  counterparty_type: string | null;
  teller_category: string | null;
  type: string | null;
  running_balance: string | null;
}

/**
 * Build an update fields object for Teller-managed transaction properties.
 * Returns null if nothing changed. Never touches user-editable fields
 * (category_id, notes, is_excluded, etc.).
 */
export function getTellerTxnUpdateFields(
  local: TellerTxnFields,
  tellerTxn: Record<string, unknown>
): Record<string, unknown> | null {
  const details = tellerTxn.details as
    | { counterparty?: { name?: string; type?: string }; category?: string }
    | undefined;

  const incoming: TellerTxnFields = {
    amount: tellerTxn.amount as string,
    status: tellerTxn.status as string,
    description: tellerTxn.description as string,
    running_balance: ((tellerTxn.running_balance as string) ?? null) as string | null,
    counterparty_name: (details?.counterparty?.name ?? null) as string | null,
    counterparty_type: (details?.counterparty?.type ?? null) as string | null,
    teller_category: (details?.category ?? null) as string | null,
    type: ((tellerTxn.type as string) ?? null) as string | null
  };

  const changed: Record<string, unknown> = {};
  let hasChanges = false;

  for (const key of Object.keys(incoming) as Array<keyof TellerTxnFields>) {
    if (incoming[key] !== local[key]) {
      changed[key] = incoming[key];
      hasChanges = true;
    }
  }

  return hasChanges ? changed : null;
}
