/**
 * @fileoverview POST /api/teller/sync — mTLS proxy for Teller API.
 *
 * The browser cannot call the Teller API directly because Teller requires
 * mutual TLS (client certificate authentication). This endpoint is a thin
 * proxy that forwards requests with the proper credentials and returns
 * raw Teller data.
 *
 * **No database operations.** The client writes all data to IndexedDB via
 * stellar-drive engine functions, which then sync to Supabase through the
 * standard offline-first queue. This preserves the local-first architecture.
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

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { accessToken } = await request.json();

    if (!accessToken) {
      return json({ error: 'Missing accessToken' }, { status: 400 });
    }

    /* ── Fetch accounts from Teller ── */
    const tellerAccounts = await listAccounts(accessToken);

    /* ── Fetch balances for each account ── */
    const accounts = await Promise.all(
      tellerAccounts.map(async (account) => {
        let balances = { available: null as string | null, ledger: null as string | null };
        try {
          balances = await getAccountBalances(accessToken, account.id);
        } catch {
          // Balance fetch can fail for closed accounts — non-fatal
        }
        const { links: _, ...rest } = account;
        return { ...rest, balance_available: balances.available, balance_ledger: balances.ledger };
      })
    );

    /* ── Fetch ALL transactions (full sync with pagination) ──
       Manual sync always does a full fetch. Paginates using cursor-based
       `from_id` to get beyond the 500-per-request Teller limit.
       Only the webhook uses incremental 7-day buffer logic. */
    const transactions: Array<Record<string, unknown>> = [];
    for (const account of tellerAccounts) {
      try {
        let fromId: string | undefined;
        let hasMore = true;
        while (hasMore) {
          const opts: { count: number; from_id?: string } = { count: 500 };
          if (fromId) opts.from_id = fromId;
          const txns = await listTransactions(accessToken, account.id, opts);
          for (const txn of txns) {
            const { links: _, ...rest } = txn;
            transactions.push(rest);
          }
          if (txns.length < 500) {
            hasMore = false;
          } else {
            fromId = txns[txns.length - 1].id;
          }
        }
      } catch {
        // Transaction fetch can fail for some account types — non-fatal
      }
    }

    return json({
      success: true,
      accounts,
      transactions,
      fetchedAt: new Date().toISOString()
    });
  } catch (err) {
    if (err instanceof TellerApiError) {
      return json(
        { error: `Teller API error: ${err.message}`, status: err.status },
        { status: err.status === 401 ? 401 : 502 }
      );
    }
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
};
