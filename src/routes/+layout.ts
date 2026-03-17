/**
 * @fileoverview Root layout loader — engine bootstrap + auth resolution.
 *
 * This is the topmost SvelteKit layout. It runs on **every navigation** and
 * is responsible for three critical jobs:
 *
 * 1. **Engine bootstrap** (module-scope, runs once) — calls `initEngine()`
 *    to wire up Dexie (IndexedDB), Supabase, the sync engine, and
 *    auth callbacks. The schema in `$lib/schema.ts` is the single source
 *    of truth for database shape.
 *
 * 2. **Network probe** — before resolving auth, a lightweight reachability
 *    check ensures the engine knows whether the app is online or offline.
 *    If the service worker has already flagged `NETWORK_UNREACHABLE`, the
 *    probe returns instantly without issuing a request.
 *
 * 3. **Auth resolution + route guarding** — `resolveRootLayout()` returns
 *    the current auth mode (`'online'`, `'offline'`, or `'none'`). When
 *    `'none'`, the loader either redirects to `/setup` (first-run) or
 *    `/login` (unauthenticated), preserving the original URL as a query
 *    parameter for post-login redirect.
 *
 * The load function returns {@link RootLayoutData} which every child route
 * receives via `data` in its `+layout.svelte` / `+page.svelte`.
 */

// =============================================================================
//                                  IMPORTS
// =============================================================================

import { browser } from '$app/environment';
import { redirect } from '@sveltejs/kit';
import { goto } from '$app/navigation';
import { initEngine, supabase, probeNetworkReachability, getConfig } from 'stellar-drive/config';
import { debug } from 'stellar-drive/utils';
import { lockSingleUser } from 'stellar-drive/auth';
import { resolveRootLayout } from 'stellar-drive/kit';
import { isSafeRedirect } from 'stellar-drive/utils';
import { schema } from '$lib/schema';
import { demoConfig } from '$lib/demo/config';
import type { RootLayoutData } from 'stellar-drive/kit';
import type { LayoutLoad } from './$types';

// =============================================================================
//                          SVELTEKIT ROUTE CONFIG
// =============================================================================

/** Allow server-side rendering for initial page load performance. */
export const ssr = true;
/** Disable prerendering — pages depend on runtime auth state. */
export const prerender = false;

// =============================================================================
//                             TYPE RE-EXPORTS
// =============================================================================

/** Re-export the root layout data type so `+layout.svelte` can import it. */
export type { RootLayoutData as LayoutData };

// =============================================================================
//                          ENGINE BOOTSTRAP
// =============================================================================

/**
 * Initialize the sync engine at module scope (runs once on first navigation).
 *
 * Configuration wires up:
 * - **prefix** `'radiant'` — namespaces localStorage keys and debug flags.
 * - **schema** from `$lib/schema.ts` — the single source of truth that drives
 *   Dexie (IndexedDB) stores, auto-generated TypeScript types, and Supabase
 *   schema migrations during `npm run dev`.
 * - **auth.gateType** `'code'` — invite-code-based registration flow.
 * - **auth.profileExtractor / profileToMetadata** — bidirectional mapping
 *   between Supabase `user_metadata` and the app's `{firstName, lastName}`.
 * - **demo** — optional demo-mode seed data and mock profile.
 * - **onAuthStateChange** — on `SIGNED_IN`, re-runs the current route's load
 *   (via `invalidateAll`) unless we're already on `/login`.
 * - **onAuthKicked** — when another device signs in, locks the local DB and
 *   redirects to `/login`.
 */
if (browser) {
  debug('log', '[layout] Initialising engine (module scope)');
  initEngine({
    prefix: 'radiant',
    name: 'Radiant Finance',
    domain: window.location.origin,
    schema,
    supabase,
    databaseName: 'RadiantFinanceDB',
    auth: {
      gateType: 'code',
      profileExtractor: (meta: Record<string, unknown>) => ({
        firstName: (meta.first_name as string) || '',
        lastName: (meta.last_name as string) || ''
      }),
      profileToMetadata: (p: Record<string, unknown>) => ({
        first_name: p.firstName,
        last_name: p.lastName
      })
    },
    demo: demoConfig,
    onAuthStateChange: (event, session) => {
      debug('log', '[layout] onAuthStateChange:', event, session?.user?.email ?? '(no session)');
      if (event === 'SIGNED_IN' && session) {
        if (!window.location.pathname.startsWith('/login')) {
          goto(window.location.pathname, { invalidateAll: true });
        }
      }
    },
    onAuthKicked: async () => {
      debug('warn', '[layout] Auth kicked — locking single user and redirecting to /login');
      await lockSingleUser();
      goto('/login');
    }
  });
}

// =============================================================================
//                         PUBLIC ROUTES
// =============================================================================

/** Routes accessible without authentication. */
const PUBLIC_ROUTES = ['/policy', '/login', '/demo', '/confirm', '/setup'];

// =============================================================================
//                            LOAD FUNCTION
// =============================================================================

/**
 * Root layout load function — runs on every navigation.
 *
 * **Browser path:**
 * 1. Probes network reachability (skips if the SW already flagged offline).
 * 2. Calls `resolveRootLayout()` which reads the Supabase session, checks
 *    for offline credentials, and starts the sync engine if authenticated.
 * 3. If `authMode === 'none'`:
 *    - Server not yet configured → redirect to `/setup`.
 *    - Server configured, non-public route → redirect to `/login` with a
 *      `?redirect=` query parameter so the user returns after sign-in.
 *
 * **SSR path:** Returns a minimal stub (`authMode: 'none'`) — real auth
 * resolution happens client-side after hydration.
 *
 * @param params - SvelteKit load event; destructured to `{ url }`.
 * @returns {Promise<RootLayoutData>} Auth state consumed by every child route.
 */
export const load: LayoutLoad = async ({ url }): Promise<RootLayoutData> => {
  if (browser) {
    /* Probe actual network reachability ONCE before any startup code.
       Sets the offline flag so initConfig(), resolveAuthState(), and
       getSession() can skip network calls synchronously. If the SW has
       already set the flag via NETWORK_UNREACHABLE postMessage, the probe
       returns immediately without a network request. */
    debug('log', '[layout] Probing network reachability...');
    await probeNetworkReachability();

    debug('log', '[layout] Resolving root layout auth state...');
    const result = await resolveRootLayout();
    debug(
      'log',
      '[layout] Auth resolved:',
      result.authMode,
      '| serverConfigured:',
      result.serverConfigured
    );

    // Check if any required env vars are missing (even when Supabase is configured).
    // Setup takes priority over authentication — if env vars are missing, the app
    // can't function properly, so redirect everyone to /setup (which will be public).
    if (result.serverConfigured) {
      const config = getConfig();
      const serviceRoleConfigured = config?.extra?.SERVICE_ROLE_CONFIGURED === 'true';
      const tellerConfigured = !!config?.extra?.PUBLIC_TELLER_APP_ID;
      if (
        (!serviceRoleConfigured || !tellerConfigured) &&
        !url.pathname.startsWith('/setup') &&
        !url.pathname.startsWith('/policy')
      ) {
        debug('log', '[layout] Missing required env vars — redirecting to /setup', {
          serviceRoleConfigured,
          tellerConfigured
        });
        redirect(307, '/setup');
      }
    }

    if (result.authMode === 'none') {
      if (
        !result.serverConfigured &&
        !url.pathname.startsWith('/setup') &&
        !url.pathname.startsWith('/policy')
      ) {
        debug('log', '[layout] Server not configured — redirecting to /setup');
        redirect(307, '/setup');
      } else if (result.serverConfigured) {
        const isPublicRoute = PUBLIC_ROUTES.some((r) => url.pathname.startsWith(r));
        if (!isPublicRoute) {
          const returnUrl = url.pathname + url.search;
          const loginUrl =
            returnUrl && returnUrl !== '/' && isSafeRedirect(returnUrl)
              ? `/login?redirect=${encodeURIComponent(returnUrl)}`
              : '/login';
          debug('log', '[layout] Unauthenticated on protected route — redirecting to', loginUrl);
          redirect(307, loginUrl);
        }
      }
    }

    return result;
  }

  /* SSR fallback — no auth info available on the server */
  debug('log', '[layout] SSR fallback — returning empty auth state');
  return { session: null, authMode: 'none', offlineProfile: null, serverConfigured: false };
};
