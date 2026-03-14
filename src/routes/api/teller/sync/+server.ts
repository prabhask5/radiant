/**
 * @fileoverview POST /api/teller/sync — Sync accounts and transactions from Teller.
 *
 * This endpoint acts as an **mTLS proxy**: the browser cannot call the Teller API
 * directly because Teller requires mutual TLS (client certificate authentication).
 * Instead, the browser calls this SvelteKit route, which forwards requests to
 * Teller with the proper credentials and returns the normalized data.
 *
 * Flow:
 *   1. Client sends `{ accessToken, enrollmentId }` after Teller Connect enrollment.
 *   2. This route fetches all accounts for the enrollment from Teller.
 *   3. For each account, it fetches balances and up to 500 recent transactions.
 *   4. Returns the normalized data for the client to persist locally.
 *
 * @see https://teller.io/docs/api/accounts
 * @see https://teller.io/docs/api/account/transactions
 */

import { json } from '@sveltejs/kit';
import {
  listAccounts,
  listTransactions,
  getAccountBalances,
  TellerApiError
} from '$lib/teller/client';
import type { RequestHandler } from './$types';

/* ═══════════════════════════════════════════════════════════════════════════
   SYNC ENDPOINT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Handle POST requests to sync Teller account and transaction data.
 *
 * Expects a JSON body with `accessToken` (from Teller Connect) and
 * `enrollmentId` (the enrollment identifier). Fetches all accounts,
 * balances, and transactions from Teller and returns them in a
 * normalized format suitable for local persistence.
 *
 * @param request - The incoming request containing `{ accessToken, enrollmentId }`.
 * @returns JSON response with `{ success, accounts, transactions, syncedAt }`.
 * @throws Returns 400 if required fields are missing, 401 if the access token is
 *         invalid, or 502 if the Teller API returns an error.
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const { accessToken, enrollmentId } = await request.json();

    if (!accessToken || !enrollmentId) {
      console.log('[TELLER] Sync request missing accessToken or enrollmentId');
      return json({ error: 'Missing accessToken or enrollmentId' }, { status: 400 });
    }

    console.log(`[TELLER] Starting sync for enrollment ${enrollmentId}`);

    /* ── Fetch accounts ── */
    const tellerAccounts = await listAccounts(accessToken);
    console.log(
      `[TELLER] Sync: found ${tellerAccounts.length} accounts for enrollment ${enrollmentId}`
    );

    /* ── Fetch balances + transactions for each account ── */
    const accountsData = [];
    const transactionsData = [];

    for (const account of tellerAccounts) {
      // Fetch balances — may fail for some account types (e.g., credit cards
      // at certain institutions), so we catch and continue with null values
      let balances = { available: null as string | null, ledger: null as string | null };
      try {
        balances = await getAccountBalances(accessToken, account.id);
      } catch (err) {
        console.log(
          `[TELLER] Sync: balance fetch failed for account ${account.id}: ${err instanceof Error ? err.message : 'unknown error'}`
        );
      }

      accountsData.push({
        teller_account_id: account.id,
        enrollment_id: enrollmentId,
        institution_name: account.institution.name,
        name: account.name,
        type: account.type,
        subtype: account.subtype,
        currency: account.currency,
        last_four: account.last_four,
        status: account.status,
        balance_available: balances.available,
        balance_ledger: balances.ledger,
        balance_updated_at: new Date().toISOString(),
        is_hidden: false
      });

      // Fetch transactions (up to 500 most recent) — may fail for accounts
      // that don't support transaction history, so we catch and continue
      try {
        const transactions = await listTransactions(accessToken, account.id, { count: 500 });
        console.log(
          `[TELLER] Sync: fetched ${transactions.length} transactions for account ${account.id}`
        );
        for (const txn of transactions) {
          transactionsData.push({
            teller_transaction_id: txn.id,
            account_id: account.id, // Will be resolved to local ID on client
            teller_account_id: account.id,
            amount: txn.amount,
            date: txn.date,
            description: txn.description,
            counterparty_name: txn.details?.counterparty?.name || null,
            counterparty_type: txn.details?.counterparty?.type || null,
            teller_category: txn.details?.category || null,
            status: txn.status,
            type: txn.type,
            running_balance: txn.running_balance,
            is_excluded: false,
            notes: null
          });
        }
      } catch (err) {
        console.log(
          `[TELLER] Sync: transaction fetch failed for account ${account.id}: ${err instanceof Error ? err.message : 'unknown error'}`
        );
      }
    }

    console.log(
      `[TELLER] Sync complete for enrollment ${enrollmentId}: ${accountsData.length} accounts, ${transactionsData.length} transactions`
    );

    return json({
      success: true,
      accounts: accountsData,
      transactions: transactionsData,
      syncedAt: new Date().toISOString()
    });
  } catch (err) {
    if (err instanceof TellerApiError) {
      console.log(
        `[TELLER] Sync failed with TellerApiError: status=${err.status}, body=${err.body}`
      );
      return json(
        {
          error: `Teller API error: ${err.message}`,
          status: err.status
        },
        { status: err.status === 401 ? 401 : 502 }
      );
    }
    console.log(
      `[TELLER] Sync failed with unexpected error: ${err instanceof Error ? err.message : 'unknown error'}`
    );
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
};
