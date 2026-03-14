/**
 * @fileoverview POST /api/teller/webhook — Handle Teller webhook events.
 *
 * Teller sends webhook events to notify the application of changes to
 * enrollments and accounts. This endpoint receives those events, verifies
 * their HMAC-SHA-256 signature, and processes them accordingly.
 *
 * Supported event types:
 *   - `enrollment.disconnected` — The bank connection was severed (e.g.,
 *     credentials changed, MFA required). The user must re-enroll via
 *     Teller Connect to restore access.
 *   - `transactions.processed` — New transactions are available for one or
 *     more accounts. The client should trigger a sync.
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
import type { RequestHandler } from './$types';

/* ═══════════════════════════════════════════════════════════════════════════
   WEBHOOK ENDPOINT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Handle incoming Teller webhook events.
 *
 * Reads the raw request body, verifies the HMAC-SHA-256 signature (if a
 * signing secret is configured), parses the event payload, and dispatches
 * to the appropriate handler based on event type.
 *
 * @param request - The incoming webhook request from Teller.
 * @returns JSON `{ received: true }` on success, or an error response.
 * @throws Returns 401 if the webhook signature is invalid, or 400 if
 *         the payload cannot be parsed as JSON.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.text();
  const signature = request.headers.get('teller-signature');

  console.log('[TELLER] Webhook received');

  // Verify webhook signature if signing secret is configured.
  // Without a secret, webhooks are accepted without verification — this
  // should only be the case in development.
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
        // The enrollment has been disconnected — the client will need to
        // re-authenticate via Teller Connect to restore access
        console.log(
          `[TELLER] Enrollment disconnected: enrollment_id=${payload.enrollment_id}, reason=${payload.reason}`
        );
        break;

      case 'transactions.processed':
        // New transactions are available — the client should sync
        console.log('[TELLER] New transactions processed — clients should sync');
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
      `[TELLER] Failed to parse webhook payload: ${err instanceof Error ? err.message : 'unknown error'}`
    );
    return json({ error: 'Invalid webhook payload' }, { status: 400 });
  }
};

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
 *
 * @param body - The raw request body string.
 * @param signatureHeader - The `teller-signature` header value.
 * @param secret - The webhook signing secret from the Teller dashboard.
 * @returns `true` if the signature is valid, `false` otherwise.
 */
async function verifyWebhookSignature(
  body: string,
  signatureHeader: string,
  secret: string
): Promise<boolean> {
  try {
    // Parse the signature header into timestamp and signature components
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
