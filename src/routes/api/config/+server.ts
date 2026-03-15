/**
 * @fileoverview Config API endpoint.
 *
 * Wraps stellar-drive's `createConfigHandler()` and adds a
 * `serviceRoleConfigured` boolean so the client can detect when
 * `SUPABASE_SERVICE_ROLE_KEY` is missing (without exposing the key itself).
 */

import { createConfigHandler } from 'stellar-drive/kit';
import type { RequestHandler } from './$types';

const baseHandler = createConfigHandler({
  extraEnvVars: ['PUBLIC_TELLER_APP_ID', 'PUBLIC_TELLER_ENVIRONMENT']
});

/** GET /api/config — Supabase config + Teller public vars + service role status. */
export const GET: RequestHandler = async () => {
  const response = await baseHandler();
  const data = await response.json();

  // Inject env-var status flags into `extra` so stellar-drive caches them.
  // Never expose the actual secret values — only boolean-as-string flags.
  if (!data.extra) data.extra = {};
  data.extra.SERVICE_ROLE_CONFIGURED = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'true' : 'false';

  return new Response(JSON.stringify(data), {
    headers: response.headers
  });
};
