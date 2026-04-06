/**
 * Catch-All Route Handler — `[...catchall]/+page.server.ts`
 *
 * Unknown URLs should redirect to `/` before any bad-route page renders.
 * Keeping this redirect server-only avoids mounting the app shell on an
 * invalid route, which prevents transient loader/page flicker.
 */

import { redirect } from '@sveltejs/kit';

export function load() {
  redirect(302, '/');
}
