/**
 * @fileoverview Setup page access control gate.
 *
 * Three modes:
 *   - **Unconfigured** — no runtime config exists yet; anyone can access the
 *     setup wizard to perform first-time configuration.
 *   - **Partially configured** — Supabase is set but required app env vars
 *     (service role key, Teller) are missing; anyone can access the setup
 *     page since the app can't function without them.
 *   - **Fully configured** — all env vars present; only authenticated users
 *     may revisit the setup page to update credentials or redeploy.
 */

import { browser } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { ROUTES } from '$lib/routes';
import { getConfig } from 'stellar-drive/config';
import { getValidSession } from 'stellar-drive/auth';
import type { PageLoad } from './$types';

/**
 * Guard the setup route — allow first-time/partial setup or authenticated access.
 *
 * @returns Page data with an `isFirstSetup` flag.
 */
export const load: PageLoad = async () => {
  /* Config and session helpers rely on browser APIs */
  if (!browser) return {};

  const config = getConfig();

  // No config at all → first-time setup (public)
  if (!config) {
    return { isFirstSetup: true };
  }

  // Config exists but required env vars are missing → treat as first setup (public)
  const serviceRoleConfigured = config.extra?.SERVICE_ROLE_CONFIGURED === 'true';
  const tellerConfigured = !!config.extra?.PUBLIC_TELLER_APP_ID;
  if (!serviceRoleConfigured || !tellerConfigured) {
    return { isFirstSetup: true };
  }

  // Fully configured → require authentication to reconfigure
  const session = await getValidSession();
  if (!session?.user) {
    redirect(307, ROUTES.LOGIN);
  }
  return { isFirstSetup: false };
};
