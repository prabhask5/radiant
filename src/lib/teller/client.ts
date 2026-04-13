/**
 * @fileoverview Teller API client — server-side only.
 *
 * All Teller API calls require mTLS (mutual TLS with a client certificate)
 * and must run server-side. Browsers cannot perform mTLS, so SvelteKit API
 * routes act as an mTLS proxy: the browser calls our `/api/teller/*` routes,
 * which forward requests to the Teller API with the proper client certificate.
 *
 * Authentication model:
 *   1. **mTLS** — The server presents a client certificate to Teller's API.
 *      In production, this is handled by the deployment environment (e.g.,
 *      Vercel Edge Functions with client certificates configured via env vars
 *      `TELLER_CERT` and `TELLER_KEY`).
 *   2. **Access token** — Each enrollment (bank connection) gets a unique access
 *      token from Teller Connect. This token is sent as Basic auth (username=token,
 *      no password) on every API request.
 *
 * @see https://teller.io/docs/api/authentication
 */

import https from 'node:https';
import type {
  TellerAccount,
  TellerAccountBalances,
  TellerAccountDetails,
  TellerTransaction,
  TellerIdentity
} from './types';

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURATION
   ═══════════════════════════════════════════════════════════════════════════ */

/** Base URL for all Teller REST API endpoints. */
const TELLER_API_BASE = 'https://api.teller.io';

/**
 * Create an HTTPS agent with mTLS client certificate if available.
 *
 * Teller requires mutual TLS in `development` and `production` environments.
 * The `TELLER_CERT` and `TELLER_KEY` env vars must contain the PEM-encoded
 * client certificate and private key respectively.
 *
 * In `sandbox` mode, mTLS is not required and the agent is created without
 * certificate configuration.
 */
function getTellerAgent(): https.Agent | undefined {
  const cert = process.env.TELLER_CERT;
  const key = process.env.TELLER_KEY;

  if (!cert || !key) {
    return undefined;
  }

  return new https.Agent({
    cert,
    key,
    keepAlive: true
  });
}

/** Cached HTTPS agent — created once, reused across requests. */
let _agent: https.Agent | undefined | null = null;

function getAgent(): https.Agent | undefined {
  if (_agent === null) {
    _agent = getTellerAgent();
  }
  return _agent;
}

/**
 * Make an authenticated request to the Teller API with mTLS support.
 *
 * Uses Node.js `https.request` to support client certificates, since the
 * built-in `fetch` does not support custom TLS configuration.
 *
 * @param url - The full Teller API URL.
 * @param accessToken - The enrollment-specific access token from Teller Connect.
 * @param method - HTTP method (default: GET).
 * @returns The parsed JSON response.
 * @throws {TellerApiError} If the Teller API returns a non-2xx response.
 */
async function tellerRequest<T>(
  url: string,
  accessToken: string,
  method: string = 'GET'
): Promise<{ status: number; data: T }> {
  const credentials = Buffer.from(`${accessToken}:`).toString('base64');
  const agent = getAgent();
  const parsed = new URL(url);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json'
        },
        ...(agent ? { agent } : {})
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          const status = res.statusCode ?? 500;

          if (status >= 200 && status < 300) {
            try {
              resolve({ status, data: status === 204 ? (undefined as T) : JSON.parse(body) });
            } catch {
              resolve({ status, data: undefined as T });
            }
          } else {
            reject(new TellerApiError(status, body));
          }
        });
      }
    );

    req.on('error', (err) => {
      reject(new Error(`Teller request failed: ${err.message}`));
    });

    req.end();
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   API METHODS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * List all accounts for an enrollment.
 *
 * Returns every bank account associated with the enrollment's access token,
 * including checking, savings, and credit card accounts.
 *
 * @param accessToken - The enrollment-specific access token from Teller Connect.
 * @returns An array of account objects for the enrollment.
 * @throws {TellerApiError} If the Teller API returns a non-2xx response.
 * @see https://teller.io/docs/api/accounts
 */
export async function listAccounts(accessToken: string): Promise<TellerAccount[]> {
  console.log('[TELLER] Fetching accounts for enrollment');
  const { status, data } = await tellerRequest<TellerAccount[]>(
    `${TELLER_API_BASE}/accounts`,
    accessToken
  );
  console.log(`[TELLER] Fetched ${data.length} accounts (status ${status})`);
  return data;
}

/**
 * Get a single account by ID.
 *
 * @param accessToken - The enrollment-specific access token from Teller Connect.
 * @param accountId - The Teller account ID (e.g., `acc_xxx`).
 * @returns The account object.
 * @throws {TellerApiError} If the Teller API returns a non-2xx response.
 */
export async function getAccount(accessToken: string, accountId: string): Promise<TellerAccount> {
  console.log(`[TELLER] Fetching account ${accountId}`);
  const { status, data } = await tellerRequest<TellerAccount>(
    `${TELLER_API_BASE}/accounts/${accountId}`,
    accessToken
  );
  console.log(`[TELLER] Fetched account ${accountId} (status ${status})`);
  return data;
}

/**
 * Get account balances (available + ledger).
 *
 * The `available` balance reflects holds and pending transactions, while
 * `ledger` is the posted balance. Either may be `null` depending on the
 * account type and institution.
 *
 * @param accessToken - The enrollment-specific access token from Teller Connect.
 * @param accountId - The Teller account ID (e.g., `acc_xxx`).
 * @returns The account balances object with `available` and `ledger` fields.
 * @throws {TellerApiError} If the Teller API returns a non-2xx response.
 * @see https://teller.io/docs/api/account/balances
 */
export async function getAccountBalances(
  accessToken: string,
  accountId: string
): Promise<TellerAccountBalances> {
  console.log(`[TELLER] Fetching balances for account ${accountId}`);
  const { status, data } = await tellerRequest<TellerAccountBalances>(
    `${TELLER_API_BASE}/accounts/${accountId}/balances`,
    accessToken
  );
  console.log(`[TELLER] Fetched balances for account ${accountId} (status ${status})`);
  return data;
}

/**
 * Get account details (account number, routing numbers).
 *
 * Returns sensitive account information including the full account number
 * and ACH/wire routing numbers. Use with care — this data should never
 * be exposed to the client.
 *
 * @param accessToken - The enrollment-specific access token from Teller Connect.
 * @param accountId - The Teller account ID (e.g., `acc_xxx`).
 * @returns The account details object with account and routing numbers.
 * @throws {TellerApiError} If the Teller API returns a non-2xx response.
 * @see https://teller.io/docs/api/account/details
 */
export async function getAccountDetails(
  accessToken: string,
  accountId: string
): Promise<TellerAccountDetails> {
  console.log(`[TELLER] Fetching details for account ${accountId}`);
  const { status, data } = await tellerRequest<TellerAccountDetails>(
    `${TELLER_API_BASE}/accounts/${accountId}/details`,
    accessToken
  );
  console.log(`[TELLER] Fetched details for account ${accountId} (status ${status})`);
  return data;
}

/**
 * List transactions for an account with optional pagination and date filtering.
 *
 * Teller returns transactions in reverse chronological order. Use the `count`
 * option to limit results and `from_id` for cursor-based pagination. Date
 * filters (`start_date`, `end_date`) use `YYYY-MM-DD` format.
 *
 * @param accessToken - The enrollment-specific access token from Teller Connect.
 * @param accountId - The Teller account ID (e.g., `acc_xxx`).
 * @param options - Optional pagination and filtering parameters.
 * @param options.count - Maximum number of transactions to return.
 * @param options.from_id - Cursor: return transactions after this transaction ID.
 * @param options.start_date - Only return transactions on or after this date (YYYY-MM-DD).
 * @param options.end_date - Only return transactions on or before this date (YYYY-MM-DD).
 * @returns An array of transaction objects, newest first.
 * @throws {TellerApiError} If the Teller API returns a non-2xx response.
 * @see https://teller.io/docs/api/account/transactions
 */
export async function listTransactions(
  accessToken: string,
  accountId: string,
  options?: {
    count?: number;
    from_id?: string;
    start_date?: string;
    end_date?: string;
  }
): Promise<TellerTransaction[]> {
  const params = new URLSearchParams();
  if (options?.count) params.set('count', String(options.count));
  if (options?.from_id) params.set('from_id', options.from_id);
  if (options?.start_date) params.set('start_date', options.start_date);
  if (options?.end_date) params.set('end_date', options.end_date);

  const qs = params.toString() ? `?${params.toString()}` : '';
  console.log(`[TELLER] Fetching transactions for account ${accountId}${qs ? ` (${qs})` : ''}`);
  const { status, data } = await tellerRequest<TellerTransaction[]>(
    `${TELLER_API_BASE}/accounts/${accountId}/transactions${qs}`,
    accessToken
  );
  console.log(
    `[TELLER] Fetched ${data.length} transactions for account ${accountId} (status ${status})`
  );
  return data;
}

/**
 * Get a single transaction by ID.
 *
 * @param accessToken - The enrollment-specific access token from Teller Connect.
 * @param accountId - The Teller account ID (e.g., `acc_xxx`).
 * @param transactionId - The Teller transaction ID (e.g., `txn_xxx`).
 * @returns The transaction object.
 * @throws {TellerApiError} If the Teller API returns a non-2xx response.
 */
export async function getTransaction(
  accessToken: string,
  accountId: string,
  transactionId: string
): Promise<TellerTransaction> {
  console.log(`[TELLER] Fetching transaction ${transactionId} for account ${accountId}`);
  const { status, data } = await tellerRequest<TellerTransaction>(
    `${TELLER_API_BASE}/accounts/${accountId}/transactions/${transactionId}`,
    accessToken
  );
  console.log(
    `[TELLER] Fetched transaction ${transactionId} for account ${accountId} (status ${status})`
  );
  return data;
}

/**
 * Get identity information for an enrollment.
 *
 * Returns personal information (name, address, DOB, etc.) associated with
 * the enrolled accounts. May return multiple identity records if the
 * institution provides them.
 *
 * @param accessToken - The enrollment-specific access token from Teller Connect.
 * @returns An array of identity records for the enrollment.
 * @throws {TellerApiError} If the Teller API returns a non-2xx response.
 * @see https://teller.io/docs/api/identity
 */
export async function getIdentity(accessToken: string): Promise<TellerIdentity[]> {
  console.log('[TELLER] Fetching identity information');
  const { status, data } = await tellerRequest<TellerIdentity[]>(
    `${TELLER_API_BASE}/identity`,
    accessToken
  );
  console.log(`[TELLER] Fetched ${data.length} identity records (status ${status})`);
  return data;
}

/**
 * Delete (disconnect) a specific account from the enrollment.
 *
 * Once deleted, the account's data can no longer be fetched via the API.
 * This does **not** close the bank account — it only removes the Teller
 * connection.
 *
 * @param accessToken - The enrollment-specific access token from Teller Connect.
 * @param accountId - The Teller account ID to disconnect (e.g., `acc_xxx`).
 * @throws {TellerApiError} If the Teller API returns an unexpected non-2xx/204 response.
 */
export async function deleteAccount(accessToken: string, accountId: string): Promise<void> {
  console.log(`[TELLER] Deleting account ${accountId}`);
  const { status } = await tellerRequest<void>(
    `${TELLER_API_BASE}/accounts/${accountId}`,
    accessToken,
    'DELETE'
  );
  console.log(`[TELLER] Deleted account ${accountId} (status ${status})`);
}

/**
 * Delete (revoke) a Teller enrollment, stopping all future webhook events.
 *
 * @param accessToken - The enrollment's access token.
 * @param enrollmentId - The Teller enrollment ID (e.g., `enr_xxx`).
 * @throws {TellerApiError} If the Teller API returns an unexpected non-2xx/204 response.
 */
export async function deleteEnrollment(accessToken: string, enrollmentId: string): Promise<void> {
  console.log(`[TELLER] Deleting enrollment ${enrollmentId}`);
  const { status } = await tellerRequest<void>(
    `${TELLER_API_BASE}/enrollments/${enrollmentId}`,
    accessToken,
    'DELETE'
  );
  console.log(`[TELLER] Deleted enrollment ${enrollmentId} (status ${status})`);
}

/* ═══════════════════════════════════════════════════════════════════════════
   ERROR HANDLING
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Structured Teller API error with HTTP status code and response body.
 *
 * Thrown by all client methods when the Teller API returns a non-2xx
 * response. The `status` field can be used to differentiate between
 * auth failures (401), rate limits (429), and server errors (5xx).
 */
export class TellerApiError extends Error {
  /**
   * @param status - The HTTP status code from the Teller API response.
   * @param body - The raw response body text from the Teller API.
   */
  constructor(
    public status: number,
    public body: string
  ) {
    super(`Teller API error ${status}: ${body}`);
    this.name = 'TellerApiError';
    console.log(`[TELLER] API error: status=${status}, body=${body}`);
  }
}
