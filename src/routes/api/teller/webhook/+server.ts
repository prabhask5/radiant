/**
 * @fileoverview POST /api/teller/webhook — Handle Teller webhook events.
 *
 * Teller sends webhook events to notify the application of changes to
 * enrollments and accounts. This endpoint receives those events, verifies
 * their HMAC-SHA-256 signature, and **actively processes** them:
 *
 *   - `transactions.processed` — New transactions are available. The handler
 *     looks up the enrollment in Supabase, fetches fresh data from Teller via
 *     mTLS, and upserts accounts + transactions into Supabase. All connected
 *     clients receive the updates via stellar-drive's realtime WebSocket.
 *
 *   - `enrollment.disconnected` — The bank connection was severed (e.g.,
 *     credentials changed, MFA required). The handler updates the enrollment
 *     status in Supabase so all clients see the disconnection.
 *
 *   - `webhook.test` — A test event sent when configuring the webhook URL
 *     in the Teller dashboard.
 *
 * Security:
 *   Webhooks are verified using HMAC-SHA-256 signatures. The signature header
 *   format is `t=<timestamp>,v1=<hex-signature>`. The signed payload is
 *   `<timestamp>.<body>`. Timestamps older than 3 minutes are rejected to
 *   prevent replay attacks.
 *
 * @see https://teller.io/docs/api/webhooks
 */

import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createServerAdminClient } from 'stellar-drive/kit';
import {
  listAccounts,
  listTransactions,
  getAccountBalances,
  TellerApiError
} from '$lib/teller/client';
import type { RequestHandler } from './$types';

interface ExistingAccountRow {
  id: string;
  teller_account_id: string;
  institution_name: string;
  name: string;
  type: string;
  subtype: string;
  currency: string | null;
  last_four: string | null;
  status: string;
  balance_available: string | null;
  balance_ledger: string | null;
}

function getWebhookAccountUpdateFields(
  existing: ExistingAccountRow,
  incoming: {
    institution_name: string;
    name: string;
    type: string;
    subtype: string;
    currency: string | null;
    last_four: string | null;
    status: string;
    balance_available: string | null;
    balance_ledger: string | null;
  },
  timestamp: string
): Record<string, unknown> | null {
  const changed: Record<string, unknown> = {};
  let hasChanges = false;

  for (const key of Object.keys(incoming) as Array<keyof typeof incoming>) {
    if (incoming[key] !== existing[key]) {
      changed[key] = incoming[key];
      hasChanges = true;
    }
  }

  if (!hasChanges) return null;
  changed.updated_at = timestamp;
  changed.balance_updated_at = timestamp;
  return changed;
}

/* ═══════════════════════════════════════════════════════════════════════════
   WEBHOOK ENDPOINT
   ═══════════════════════════════════════════════════════════════════════════ */

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.text();
  const signature = request.headers.get('teller-signature');

  console.log('[TELLER] Webhook received — raw payload:', body);

  // Verify webhook signature if signing secret is configured
  const signingSecret = env.TELLER_WEBHOOK_SECRET;
  if (signingSecret && signature) {
    console.log('[TELLER] Verifying webhook signature');
    const isValid = await verifyWebhookSignature(body, signature, signingSecret);
    if (!isValid) {
      console.log('[TELLER] Webhook signature verification failed');
      return json({ error: 'Invalid webhook signature' }, { status: 401 });
    }
    console.log('[TELLER] Webhook signature verified successfully');
  } else if (!signingSecret) {
    console.log('[TELLER] No TELLER_WEBHOOK_SECRET configured — skipping signature verification');
  }

  try {
    const event = JSON.parse(body);
    const { type, payload } = event;

    console.log(`[TELLER] Processing webhook event: type=${type}`);

    switch (type) {
      case 'enrollment.disconnected':
        await handleEnrollmentDisconnected(payload);
        break;

      case 'transactions.processed':
        await handleTransactionsProcessed(payload);
        break;

      case 'webhook.test':
        console.log('[TELLER] Test webhook received — configuration is working');
        break;

      default:
        console.log(`[TELLER] Unknown webhook event type: ${type}`);
    }

    return json({ received: true });
  } catch (err) {
    console.log(
      `[TELLER] Failed to process webhook: ${err instanceof Error ? err.message : 'unknown error'}`
    );
    return json({ error: 'Webhook processing failed' }, { status: 400 });
  }
};

/* ═══════════════════════════════════════════════════════════════════════════
   EVENT HANDLERS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Handle `enrollment.disconnected` — update enrollment status in Supabase.
 *
 * All connected clients will see the status change via realtime.
 */
async function handleEnrollmentDisconnected(payload: { enrollment_id: string; reason?: string }) {
  console.log(
    `[TELLER] Enrollment disconnected: enrollment_id=${payload.enrollment_id}, reason=${payload.reason}`
  );

  const admin = createServerAdminClient('radiant');
  if (!admin) {
    console.log('[TELLER] No admin client — cannot update enrollment status');
    return;
  }

  const timestamp = new Date().toISOString();
  const { error } = await admin
    .from('teller_enrollments')
    .update({
      status: 'disconnected',
      error_message: payload.reason || 'Enrollment disconnected by institution',
      updated_at: timestamp
    })
    .eq('enrollment_id', payload.enrollment_id);

  if (error) {
    console.log(`[TELLER] Failed to update enrollment status: ${error.message}`);
  } else {
    console.log(`[TELLER] Enrollment ${payload.enrollment_id} marked as disconnected`);
  }
}

/**
 * Handle `transactions.processed` — fetch new data from Teller and persist.
 *
 * 1. Look up the enrollment in Supabase by Teller enrollment_id.
 * 2. Use the stored access_token to fetch accounts, balances, and transactions.
 * 3. Upsert everything into Supabase.
 * 4. stellar-drive's realtime propagates changes to all connected clients.
 */
async function handleTransactionsProcessed(payload: { enrollment_id: string }) {
  console.log(`[TELLER] Transactions processed for enrollment: ${payload.enrollment_id}`);

  const admin = createServerAdminClient('radiant');
  if (!admin) {
    console.log('[TELLER] No admin client — cannot process new transactions');
    return;
  }

  // Look up enrollment to get access_token and user_id.
  // Don't filter by status — we want to see what's there for diagnostics.
  const { data: enrollments, error: lookupError } = await admin
    .from('teller_enrollments')
    .select('id, user_id, access_token, institution_name, last_synced_at, status, deleted')
    .eq('enrollment_id', payload.enrollment_id)
    .limit(1);

  if (lookupError || !enrollments?.length) {
    console.log(
      `[TELLER] Enrollment not found for ${payload.enrollment_id}: ${lookupError?.message || 'no results'}`
    );
    return;
  }

  const enrollment = enrollments[0];
  const { id: localEnrollmentId, user_id: userId, access_token: accessToken } = enrollment;

  console.log(
    `[TELLER] Found enrollment ${localEnrollmentId} for user ${userId} — status=${enrollment.status}, deleted=${enrollment.deleted}`
  );

  // Skip if enrollment is deleted or disconnected
  if (enrollment.deleted) {
    console.log(`[TELLER] Enrollment ${localEnrollmentId} is deleted — skipping`);
    return;
  }
  if (enrollment.status === 'disconnected') {
    console.log(`[TELLER] Enrollment ${localEnrollmentId} is disconnected — skipping`);
    return;
  }

  try {
    // Fetch accounts from Teller
    const tellerAccounts = await listAccounts(accessToken);
    console.log(`[TELLER] Webhook sync: found ${tellerAccounts.length} accounts`);

    const timestamp = new Date().toISOString();

    // Look up existing accounts for stable IDs
    const { data: existingAccounts } = await admin
      .from('accounts')
      .select(
        'id, teller_account_id, institution_name, name, type, subtype, currency, last_four, status, balance_available, balance_ledger'
      )
      .eq('enrollment_id', localEnrollmentId);
    const acctIdMap = new Map(
      (existingAccounts ?? []).map((a: ExistingAccountRow) => [a.teller_account_id, a.id])
    );
    const existingAccountMap = new Map(
      (existingAccounts ?? []).map((a: ExistingAccountRow) => [a.teller_account_id, a])
    );

    // Build account updates only for rows whose Teller-managed fields changed.
    const accountUpdates: Array<{ id: string; fields: Record<string, unknown> }> = [];
    let updatedAccountCount = 0;
    for (const account of tellerAccounts) {
      let balances = { available: null as string | null, ledger: null as string | null };
      try {
        balances = await getAccountBalances(accessToken, account.id);
      } catch (err) {
        console.log(
          `[TELLER] Webhook: balance fetch failed for ${account.id}: ${err instanceof Error ? err.message : 'unknown'}`
        );
      }

      const id = acctIdMap.get(account.id) ?? crypto.randomUUID();
      acctIdMap.set(account.id, id);
      const existing = existingAccountMap.get(account.id);
      if (!existing) continue;

      const updateFields = getWebhookAccountUpdateFields(
        existing,
        {
          institution_name: account.institution.name,
          name: account.name,
          type: account.type,
          subtype: account.subtype,
          currency: account.currency ?? null,
          last_four: account.last_four ?? null,
          status: account.status,
          balance_available: balances.available,
          balance_ledger: balances.ledger
        },
        timestamp
      );

      if (updateFields) {
        accountUpdates.push({ id, fields: updateFields });
        updatedAccountCount++;
      }
    }

    await Promise.all(
      accountUpdates.map(async ({ id, fields }) => {
        const { error: acctError } = await admin.from('accounts').update(fields).eq('id', id);
        if (acctError) {
          console.log(`[TELLER] Webhook account update error for ${id}: ${acctError.message}`);
        }
      })
    );

    // Compute incremental fetch window: 7-day buffer before last_synced_at
    // for pending→posted transitions, or full fetch if never synced
    const lastSyncedAt = enrollment.last_synced_at as string | null;
    let fetchOptions: { count: number } | { start_date: string };
    let bufferDate: string | null = null;

    if (lastSyncedAt) {
      const syncDate = new Date(lastSyncedAt);
      syncDate.setDate(syncDate.getDate() - 7);
      bufferDate = syncDate.toISOString().slice(0, 10); // YYYY-MM-DD
      fetchOptions = { start_date: bufferDate };
      console.log(`[TELLER] Incremental fetch from ${bufferDate} (last synced ${lastSyncedAt})`);
    } else {
      fetchOptions = { count: 500 };
      console.log('[TELLER] Initial fetch: no last_synced_at — fetching up to 500 per account');
    }

    // Look up existing transactions scoped to the fetch window.
    // transactions is a child table (no user_id) — query by account_id instead.
    // Fetch all Teller-managed fields for change detection (not just status).
    const accountIds = [...acctIdMap.values()];
    const txnSelectFields =
      'id, teller_transaction_id, deleted, status, amount, description, running_balance, counterparty_name, counterparty_type, teller_category, type';

    interface ExistingTxnRow {
      id: string;
      teller_transaction_id: string;
      deleted: boolean;
      status: string;
      amount: string;
      description: string;
      running_balance: string | null;
      counterparty_name: string | null;
      counterparty_type: string | null;
      teller_category: string | null;
      type: string | null;
    }

    let txnIdMap: Map<string, ExistingTxnRow>;
    if (bufferDate) {
      const { data: existingTxns } = await admin
        .from('transactions')
        .select(txnSelectFields)
        .in('account_id', accountIds)
        .gte('date', bufferDate);
      txnIdMap = new Map(
        (existingTxns ?? []).map((t: ExistingTxnRow) => [t.teller_transaction_id, t])
      );
    } else {
      const { data: existingTxns } = await admin
        .from('transactions')
        .select(txnSelectFields)
        .in('account_id', accountIds);
      txnIdMap = new Map(
        (existingTxns ?? []).map((t: ExistingTxnRow) => [t.teller_transaction_id, t])
      );
    }

    // Fetch transactions for each account — insert new, update changed
    const insertRows: Record<string, unknown>[] = [];
    const updateRows: Record<string, unknown>[] = [];
    let skippedExisting = 0;

    for (const account of tellerAccounts) {
      try {
        // Paginate through all transactions (cursor-based via from_id)
        const allTxns: Awaited<ReturnType<typeof listTransactions>> = [];
        let fromId: string | undefined;
        let hasMore = true;
        while (hasMore) {
          const opts = { ...fetchOptions, count: 500, ...(fromId ? { from_id: fromId } : {}) };
          const page = await listTransactions(accessToken, account.id, opts);
          allTxns.push(...page);
          if (page.length < 500) {
            hasMore = false;
          } else {
            fromId = page[page.length - 1].id;
          }
        }
        console.log(`[TELLER] Webhook: fetched ${allTxns.length} transactions for ${account.id}`);

        const accountId = acctIdMap.get(account.id);
        if (!accountId) continue;

        for (const txn of allTxns) {
          const existing = txnIdMap.get(txn.id);

          if (existing?.deleted) {
            // User-deleted transaction — respect their decision
            skippedExisting++;
            continue;
          }

          if (existing) {
            // Build update with only the fields that actually changed.
            // Covers: pending→posted, pending amount/description changes
            // (restaurant tips, gas pre-auths), description enrichment, etc.
            // Never touches user-editable fields (category_id, notes, etc.).
            const changed: Record<string, unknown> = {};
            let hasChanges = false;
            const incoming = {
              amount: txn.amount,
              status: txn.status,
              description: txn.description,
              running_balance: txn.running_balance ?? null,
              counterparty_name: txn.details?.counterparty?.name || null,
              counterparty_type: txn.details?.counterparty?.type || null,
              teller_category: txn.details?.category || null,
              type: txn.type ?? null
            };
            for (const [key, val] of Object.entries(incoming)) {
              if (val !== existing[key as keyof ExistingTxnRow]) {
                changed[key] = val;
                hasChanges = true;
              }
            }

            if (hasChanges) {
              changed.id = existing.id;
              changed.updated_at = timestamp;
              updateRows.push(changed);
            } else {
              skippedExisting++;
            }
            continue;
          }

          // Truly new transaction — insert
          insertRows.push({
            id: crypto.randomUUID(),
            account_id: accountId,
            teller_transaction_id: txn.id,
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
            category_source: null,
            notes: null,
            created_at: timestamp,
            updated_at: timestamp,
            deleted: false,
            _version: 1
          });
        }
      } catch (err) {
        console.log(
          `[TELLER] Webhook: transaction fetch failed for ${account.id}: ${err instanceof Error ? err.message : 'unknown'}`
        );
      }
    }

    // Insert new transactions in batches
    const BATCH_SIZE = 200;
    for (let i = 0; i < insertRows.length; i += BATCH_SIZE) {
      const batch = insertRows.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await admin
        .from('transactions')
        .upsert(batch, { onConflict: 'id' });
      if (insertError) {
        console.log(
          `[TELLER] Webhook transactions insert error (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${insertError.message}`
        );
      }
    }

    // Update pending→posted transactions in batches
    for (let i = 0; i < updateRows.length; i += BATCH_SIZE) {
      const batch = updateRows.slice(i, i + BATCH_SIZE);
      const { error: updateError } = await admin
        .from('transactions')
        .upsert(batch, { onConflict: 'id' });
      if (updateError) {
        console.log(
          `[TELLER] Webhook transactions update error (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${updateError.message}`
        );
      }
    }

    const hasMaterialChanges =
      updatedAccountCount > 0 || insertRows.length > 0 || updateRows.length > 0;
    if (hasMaterialChanges || enrollment.status !== 'connected') {
      await admin
        .from('teller_enrollments')
        .update({
          status: 'connected',
          error_message: null,
          last_synced_at: timestamp,
          updated_at: timestamp
        })
        .eq('id', localEnrollmentId);
    }

    console.log(
      `[TELLER] Webhook sync complete: ${updatedAccountCount} account updates, ${insertRows.length} new transactions, ${updateRows.length} transaction updates, ${skippedExisting} skipped existing`
    );
  } catch (err) {
    if (err instanceof TellerApiError && err.status === 401) {
      // Access token expired — mark enrollment as disconnected
      console.log(`[TELLER] Webhook: access token expired for enrollment ${localEnrollmentId}`);
      await admin
        .from('teller_enrollments')
        .update({
          status: 'disconnected',
          error_message: 'Access token expired',
          updated_at: new Date().toISOString()
        })
        .eq('id', localEnrollmentId);
    } else {
      console.log(
        `[TELLER] Webhook sync failed: ${err instanceof Error ? err.message : 'unknown error'}`
      );
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SIGNATURE VERIFICATION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Verify a Teller webhook HMAC-SHA-256 signature.
 *
 * Teller signs webhook payloads using HMAC-SHA-256. The signature header
 * format is:
 *
 *   `t=<unix-timestamp>,v1=<hex-encoded-hmac>`
 *
 * The signed payload is constructed as `<timestamp>.<body>`. Multiple `v1=`
 * values may be present (e.g., during secret rotation); the webhook is
 * considered valid if **any** of them match.
 *
 * As a replay attack mitigation, timestamps older than 3 minutes are rejected.
 */
async function verifyWebhookSignature(
  body: string,
  signatureHeader: string,
  secret: string
): Promise<boolean> {
  try {
    const parts = signatureHeader.split(',');
    const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
    const signatures = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));

    if (!timestamp || signatures.length === 0) {
      console.log('[TELLER] Webhook signature header missing timestamp or v1 signature');
      return false;
    }

    // Reject old timestamps (> 3 minutes) to prevent replay attacks
    const age = Date.now() - parseInt(timestamp) * 1000;
    if (age > 3 * 60 * 1000) {
      console.log(
        `[TELLER] Webhook signature rejected: timestamp too old (${Math.round(age / 1000)}s)`
      );
      return false;
    }

    // Compute the expected HMAC-SHA-256 signature
    const payload = `${timestamp}.${body}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    const computed = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // Accept if any provided signature matches (supports secret rotation)
    const isValid = signatures.some((s) => s === computed);
    if (!isValid) {
      console.log('[TELLER] Webhook HMAC mismatch — no provided signature matched');
    }
    return isValid;
  } catch (err) {
    console.log(
      `[TELLER] Webhook signature verification error: ${err instanceof Error ? err.message : 'unknown error'}`
    );
    return false;
  }
}
