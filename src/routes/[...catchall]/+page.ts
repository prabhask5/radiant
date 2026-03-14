/**
 * Catch-All Route Handler — `[...catchall]/+page.ts`
 *
 * Matches any URL that doesn't correspond to a defined route and
 * redirects the user back to the home page. Prevents 404 errors
 * for deep links that no longer exist.
 */

import { redirect } from '@sveltejs/kit';

/**
 * Redirect unknown paths to the app root.
 */
export function load() {
  redirect(302, '/');
}
