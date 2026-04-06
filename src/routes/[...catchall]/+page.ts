/**
 * Catch-All Route Handler — `[...catchall]/+page.ts`
 *
 * Unknown URLs should end up at `/`, but client-side redirects from a hydrated
 * bad route can leave the shell in an inconsistent state. On first document
 * request we let the server issue a normal HTTP redirect; on client-side
 * catch-all entry we render the page component and let it perform a hard
 * browser navigation.
 */

import { browser } from '$app/environment';
import { redirect } from '@sveltejs/kit';

export function load() {
  if (!browser) {
    redirect(302, '/');
  }

  return {};
}
