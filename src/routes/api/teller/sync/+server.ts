/**
 * @fileoverview POST /api/teller/sync — Sync accounts and transactions from Teller.
 *
 * This endpoint serves two roles:
 *
 *   1. **mTLS proxy** — The browser cannot call the Teller API directly because
 *      Teller requires mutual TLS (client certificate authentication). This route
 *      forwards requests with the proper credentials.
 *
 *   2. **Supabase persistence** — After fetching from Teller, the endpoint upserts
 *      enrollment, accounts, and transactions directly into Supabase using the
 *      service_role admin client. This ensures data is immediately available on
 *      all devices via stellar-drive's realtime WebSocket subscriptions.
 *
 * Called in two scenarios:
 *   - **New enrollment**: After Teller Connect completes, the client sends the
 *     access token and enrollment details for initial data ingestion.
 *   - **Manual refresh**: The user taps the retry/refresh button on the accounts
 *     page to re-sync a specific enrollment.
 *
 * The client also receives the data in the response so it can write to local
 * IndexedDB for immediate UI reactivity (before the realtime subscription fires).
 *
 * @see https://teller.io/docs/api/accounts
 * @see https://teller.io/docs/api/account/transactions
 */

import { json } from '@sveltejs/kit';
import { createServerAdminClient } from 'stellar-drive/kit';
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
 * Expects a JSON body with:
 *   - `accessToken` — The Teller enrollment access token.
 *   - `enrollmentId` — The Teller enrollment ID (e.g., `enr_xxx`).
 *   - `userId` — The authenticated user's UUID (for Supabase row ownership).
 *   - `localEnrollmentId` — The stellar-drive UUID for this enrollment.
 *   - `institutionName` — The institution display name.
 *
 * @returns JSON `{ success, accounts, transactions, syncedAt }` with stable
 *          Supabase IDs that the client uses for local IndexedDB writes.
 */
export const POST: RequestHandler = async ({ request }) => {
  try {
    const { accessToken, enrollmentId, userId, localEnrollmentId, institutionName } =
      await request.json();

    if (!accessToken || !enrollmentId || !userId || !localEnrollmentId) {
      console.log('[TELLER] Sync request missing required fields');
      return json(
        { error: 'Missing accessToken, enrollmentId, userId, or localEnrollmentId' },
        { status: 400 }
      );
    }

    console.log(`[TELLER] Starting sync for enrollment ${enrollmentId}`);

    /* ── Fetch accounts from Teller ── */
    const tellerAccounts = await listAccounts(accessToken);
    console.log(
      `[TELLER] Sync: found ${tellerAccounts.length} accounts for enrollment ${enrollmentId}`
    );

    /* ── Fetch balances for each account ── */
    const accountsData: Record<string, unknown>[] = [];

    for (const account of tellerAccounts) {
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
        enrollment_id: localEnrollmentId,
        institution_name: account.institution.name,
        name: account.name,
        type: account.type,
        subtype: account.subtype,
        currency: account.currency,
        last_four: account.last_four,
        status: account.status,
        source: 'teller',
        balance_available: balances.available,
        balance_ledger: balances.ledger,
        balance_updated_at: new Date().toISOString(),
        is_hidden: false
      });
    }

    /* ── Persist to Supabase ── */
    const admin = createServerAdminClient('radiant');
    if (!admin) {
      console.log(
        '[TELLER] Supabase admin client not configured — returning data without persistence'
      );
      return json({
        success: true,
        accounts: accountsData,
        transactions: [],
        syncedAt: new Date().toISOString()
      });
    }

    const timestamp = new Date().toISOString();

    // Check previous sync timestamp BEFORE upserting (to detect initial vs refresh)
    const { data: enrollmentData } = await admin
      .from('teller_enrollments')
      .select('last_synced_at')
      .eq('id', localEnrollmentId)
      .single();

    const lastSyncedAt = (enrollmentData?.last_synced_at as string | null) ?? null;

    // Upsert enrollment to ensure it exists in Supabase for webhook lookups
    const { error: enrollError } = await admin.from('teller_enrollments').upsert(
      {
        id: localEnrollmentId,
        user_id: userId,
        enrollment_id: enrollmentId,
        institution_name: institutionName || tellerAccounts[0]?.institution?.name || 'Unknown',
        institution_id: '',
        access_token: accessToken,
        status: 'connected',
        last_synced_at: timestamp,
        error_message: null,
        created_at: timestamp,
        updated_at: timestamp,
        deleted: false,
        _version: 1
      },
      { onConflict: 'id' }
    );
    if (enrollError) {
      console.log(`[TELLER] Supabase enrollment upsert error: ${enrollError.message}`);
    }

    // For incremental sync, compute a 7-day buffer before last sync
    let bufferDate: string | null = null;
    if (lastSyncedAt) {
      const d = new Date(lastSyncedAt);
      d.setDate(d.getDate() - 7);
      bufferDate = d.toISOString().slice(0, 10); // YYYY-MM-DD
      console.log(
        `[TELLER] Incremental sync: last_synced_at=${lastSyncedAt}, buffer_date=${bufferDate}`
      );
    } else {
      console.log('[TELLER] Initial sync: fetching all transactions');
    }

    // Look up existing accounts by teller_account_id to get stable IDs
    const { data: existingAccounts } = await admin
      .from('accounts')
      .select('id, teller_account_id')
      .eq('user_id', userId);
    const acctIdMap = new Map(
      (existingAccounts ?? []).map((a: { id: string; teller_account_id: string }) => [
        a.teller_account_id,
        a.id
      ])
    );

    // Assign stable IDs to accounts
    const accountRows = accountsData.map((acct) => {
      const tellerId = acct.teller_account_id as string;
      const id = acctIdMap.get(tellerId) ?? crypto.randomUUID();
      acctIdMap.set(tellerId, id);
      return {
        id,
        user_id: userId,
        ...acct,
        created_at: timestamp,
        updated_at: timestamp,
        deleted: false,
        _version: 1
      };
    });

    // Upsert accounts
    if (accountRows.length > 0) {
      const { error: acctError } = await admin
        .from('accounts')
        .upsert(accountRows, { onConflict: 'id' });
      if (acctError) {
        console.log(`[TELLER] Supabase accounts upsert error: ${acctError.message}`);
      }
    }

    // Fetch transactions from Teller — incremental or full
    const transactionsData: Record<string, unknown>[] = [];
    for (const account of tellerAccounts) {
      try {
        const fetchOpts = bufferDate ? { start_date: bufferDate } : { count: 500 };
        const transactions = await listTransactions(accessToken, account.id, fetchOpts);
        console.log(
          `[TELLER] Sync: fetched ${transactions.length} transactions for account ${account.id}`
        );
        for (const txn of transactions) {
          transactionsData.push({
            teller_transaction_id: txn.id,
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
      `[TELLER] Sync fetched: ${accountsData.length} accounts, ${transactionsData.length} transactions`
    );

    // Look up existing transactions — scoped to date window for incremental sync
    let txnQuery = admin
      .from('transactions')
      .select('id, teller_transaction_id, deleted')
      .eq('user_id', userId);
    if (bufferDate) txnQuery = txnQuery.gte('date', bufferDate);
    const { data: existingTxns } = await txnQuery;
    const txnLookup = new Map(
      (existingTxns ?? []).map(
        (t: { id: string; teller_transaction_id: string; deleted: boolean }) => [
          t.teller_transaction_id,
          { id: t.id, deleted: t.deleted }
        ]
      )
    );

    // Three-way routing: new inserts vs selective updates vs skip (deleted)
    const insertRows: Record<string, unknown>[] = [];
    const updateRows: Record<string, unknown>[] = [];

    // Teller-owned fields that can change on existing active transactions
    const TELLER_OWNED_FIELDS = [
      'amount',
      'status',
      'running_balance',
      'counterparty_name',
      'counterparty_type',
      'teller_category',
      'type'
    ] as const;

    for (const txn of transactionsData) {
      const tellerTxnId = txn.teller_transaction_id as string;
      const tellerAcctId = txn.teller_account_id as string;
      const accountId = acctIdMap.get(tellerAcctId);
      if (!accountId) continue;

      const existing = txnLookup.get(tellerTxnId);

      if (!existing) {
        // New transaction — full insert
        const { teller_account_id: _, ...txnFields } = txn;
        insertRows.push({
          id: crypto.randomUUID(),
          user_id: userId,
          account_id: accountId,
          ...txnFields,
          created_at: timestamp,
          updated_at: timestamp,
          deleted: false,
          _version: 1
        });
      } else if (existing.deleted) {
        // Existing + soft-deleted — skip
        continue;
      } else {
        // Existing + active — selective update of Teller-owned fields only
        const updates: Record<string, unknown> = {
          id: existing.id,
          updated_at: timestamp
        };
        for (const field of TELLER_OWNED_FIELDS) {
          updates[field] = txn[field];
        }
        updateRows.push(updates);
      }
    }

    console.log(
      `[TELLER] Sync routing: ${insertRows.length} new, ${updateRows.length} updates, ${transactionsData.length - insertRows.length - updateRows.length} skipped`
    );

    // Batch insert new transactions
    const BATCH_SIZE = 200;
    for (let i = 0; i < insertRows.length; i += BATCH_SIZE) {
      const batch = insertRows.slice(i, i + BATCH_SIZE);
      const { error: txnError } = await admin.from('transactions').insert(batch);
      if (txnError) {
        console.log(
          `[TELLER] Supabase transactions insert error (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${txnError.message}`
        );
      }
    }

    // Batch update existing active transactions (selective Teller-owned fields)
    for (let i = 0; i < updateRows.length; i += BATCH_SIZE) {
      const batch = updateRows.slice(i, i + BATCH_SIZE);
      const { error: txnError } = await admin
        .from('transactions')
        .upsert(batch, { onConflict: 'id' });
      if (txnError) {
        console.log(
          `[TELLER] Supabase transactions update error (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${txnError.message}`
        );
      }
    }

    // Update enrollment last_synced_at
    await admin
      .from('teller_enrollments')
      .update({ last_synced_at: timestamp, updated_at: timestamp, status: 'connected' })
      .eq('id', localEnrollmentId);

    console.log(
      `[TELLER] Sync persisted to Supabase: ${accountRows.length} accounts, ${insertRows.length} inserted, ${updateRows.length} updated`
    );

    // Return data with stable IDs so client can write to IndexedDB
    // For new transactions: full rows. For updates: only Teller-owned fields + id.
    const clientTransactions = [
      ...insertRows,
      ...updateRows.map((row) => ({
        id: row.id,
        amount: row.amount,
        status: row.status,
        running_balance: row.running_balance,
        counterparty_name: row.counterparty_name,
        counterparty_type: row.counterparty_type,
        teller_category: row.teller_category,
        type: row.type,
        updated_at: row.updated_at,
        _partial: true
      }))
    ];

    return json({
      success: true,
      accounts: accountRows,
      transactions: clientTransactions,
      syncedAt: timestamp
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
