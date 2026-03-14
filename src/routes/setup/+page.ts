/**
 * @fileoverview Setup page access control gate.
 *
 * Two modes:
 *   - **Unconfigured** — no runtime config exists yet; anyone can access the
 *     setup wizard to perform first-time Supabase configuration.
 *   - **Configured** — config already saved; only authenticated users may
 *     revisit the setup page to update credentials or redeploy.
 */

import { browser } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { getConfig } from 'stellar-drive/config';
import { getValidSession } from 'stellar-drive/auth';
import type { PageLoad } from './$types';

/**
 * Guard the setup route — allow first-time setup or authenticated access.
 *
 * @returns Page data with an `isFirstSetup` flag.
 */
export const load: PageLoad = async () => {
  /* Config and session helpers rely on browser APIs */
  if (!browser) return {};
  if (!getConfig()) {
    return { isFirstSetup: true };
  }
  const session = await getValidSession();
  if (!session?.user) {
    redirect(307, '/login');
  }
  return { isFirstSetup: false };
};
