<!--
  @fileoverview Root layout component — app shell, auth hydration,
  navigation chrome, overlays, and PWA lifecycle.

  This is the outermost Svelte component. It wraps every page and is
  responsible for hydrating auth state from the load function, rendering
  the navigation bar / tab bar, and mounting global overlays like the
  service-worker update prompt.
-->
<script lang="ts">
  /**
   * @fileoverview Root layout script — auth state management, navigation logic,
   * service worker communication, and global event handlers.
   */

  // =============================================================================
  //  Imports
  // =============================================================================

  /* ── Svelte Lifecycle & Transitions ── */
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';

  /* ── SvelteKit Utilities ── */
  import { page } from '$app/stores';
  import { browser } from '$app/environment';

  /* ── Stellar Engine — Auth & Stores ── */
  import { lockSingleUser } from 'stellar-drive/auth';
  import { authState } from 'stellar-drive/stores';
  import { debug } from 'stellar-drive/utils';
  import { hydrateAuthState } from 'stellar-drive/kit';
  import DemoBanner from 'stellar-drive/components/DemoBanner';
  import SyncStatus from 'stellar-drive/components/SyncStatus';

  /* ── App Components ── */
  import UpdatePrompt from '$lib/components/UpdatePrompt.svelte';

  /* ── Types ── */
  import type { LayoutData } from './+layout';

  // =============================================================================
  //  Props
  // =============================================================================

  interface Props {
    /** Default slot content — the matched page component. */
    children?: import('svelte').Snippet;

    /** Layout data from `+layout.ts` — session, auth mode, offline profile. */
    data: LayoutData;
  }

  let { children, data }: Props = $props();

  // =============================================================================
  //  Component State
  // =============================================================================

  /* ── Toast Notification ── */
  /** Whether the toast notification is currently visible. */
  let showToast = $state(false);

  /** The text content of the current toast notification. */
  let toastMessage = $state('');

  /** The visual style of the toast — `'info'` (purple) or `'error'` (pink). */
  let toastType = $state<'info' | 'error'>('info');

  /* ── Sign-Out ── */
  /** When `true`, a full-screen overlay is shown to mask the sign-out transition. */
  let isSigningOut = $state(false);

  /* ── Cleanup References ── */
  /** Stored reference to the chunk error handler so we can remove it on destroy. */
  let chunkErrorHandler: ((event: PromiseRejectionEvent) => void) | null = null;

  // =============================================================================
  //  Derived Auth & Navigation State
  // =============================================================================

  /**
   * Derived booleans for controlling navigation visibility.
   * Auth/public pages hide the app shell chrome (nav bars, etc.).
   */
  const isOnLoginPage = $derived($page.url.pathname.startsWith('/login'));
  const isOnSetupPage = $derived($page.url.pathname.startsWith('/setup'));
  const isOnDemoPage = $derived($page.url.pathname === '/demo');
  const isOnPolicyPage = $derived($page.url.pathname.startsWith('/policy'));
  const isOnConfirmPage = $derived($page.url.pathname.startsWith('/confirm'));
  const isSetupNoAuth = $derived(isOnSetupPage && data.authMode === 'none');
  const isAuthPage = $derived(
    isOnLoginPage || isSetupNoAuth || isOnDemoPage || isOnPolicyPage || isOnConfirmPage
  );
  const isAuthenticated = $derived(
    data.authMode !== 'none' && !isAuthPage && !$authState.isLoading
  );

  /**
   * Derive the current page title from the URL path for the mobile header.
   */
  const pageTitle = $derived.by(() => {
    const path = $page.url.pathname;
    if (path === '/') return 'Dashboard';
    if (path.startsWith('/transactions')) return 'Transactions';
    if (path.startsWith('/budgets')) return 'Budgets';
    if (path.startsWith('/accounts')) return 'Accounts';
    if (path.startsWith('/profile')) return 'Profile';
    return 'Radiant';
  });

  /**
   * Navigation items for both the desktop top-nav and mobile bottom tab bar.
   */
  const navItems = [
    { href: '/', label: 'Dashboard', icon: 'grid' },
    { href: '/transactions', label: 'Transactions', icon: 'list' },
    { href: '/budgets', label: 'Budgets', icon: 'pie-chart' },
    { href: '/accounts', label: 'Accounts', icon: 'credit-card' },
    { href: '/profile', label: 'Profile', icon: 'user' }
  ];

  // =============================================================================
  //  Reactive Effects
  // =============================================================================

  /**
   * Effect: hydrate the global `authState` store from layout load data.
   *
   * Runs whenever `data` changes (e.g. after navigation or revalidation).
   * Maps the three possible auth modes to the corresponding store setter:
   * - `'supabase'` + session → `setSupabaseAuth`
   * - `'offline'` + cached profile → `setOfflineAuth`
   * - anything else → `setNoAuth`
   */
  $effect(() => {
    hydrateAuthState(data);
  });

  // =============================================================================
  //  Lifecycle — Mount
  // =============================================================================

  onMount(() => {
    // ── Chunk Error Handler ────────────────────────────────────────────────
    // When navigating offline to a page whose JS chunks aren't cached,
    // the dynamic import fails and shows a cryptic error. Catch and show a friendly message.
    chunkErrorHandler = (event: PromiseRejectionEvent) => {
      const error = event.reason;
      // Check if this is a chunk loading error (fetch failed or syntax error from 503 response)
      const isChunkError =
        error?.message?.includes('Failed to fetch dynamically imported module') ||
        error?.message?.includes('error loading dynamically imported module') ||
        error?.message?.includes('Importing a module script failed') ||
        error?.name === 'ChunkLoadError' ||
        (error?.message?.includes('Loading chunk') && error?.message?.includes('failed'));

      if (isChunkError && !navigator.onLine) {
        event.preventDefault(); // Prevent default error handling
        // Show offline navigation toast
        toastMessage = "This page isn't available offline. Please reconnect or go back.";
        toastType = 'info';
        showToast = true;
        setTimeout(() => {
          showToast = false;
        }, 5000);
      }
    };

    window.addEventListener('unhandledrejection', chunkErrorHandler);

    // ── Sign-Out Event Listener ───────────────────────────────────────────
    // Listen for sign out requests from child pages (e.g. mobile profile page)
    window.addEventListener('radiant:signout', handleSignOut);

    // ── Service Worker — Background Precaching ────────────────────────────
    // Proactively cache all app chunks for full offline support.
    // This runs in the background after page load, so it doesn't affect Lighthouse scores.
    if ('serviceWorker' in navigator) {
      // Listen for precache completion messages from service worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'PRECACHE_COMPLETE') {
          const { cached, total } = event.data;
          debug('log', `[PWA] Background precaching complete: ${cached}/${total} assets cached`);
          if (cached === total) {
            debug('log', '[PWA] Full offline support ready - all pages accessible offline');
          } else {
            debug('warn', `[PWA] Some assets failed to cache: ${total - cached} missing`);
          }
        }
      });

      // Wait for service worker to be ready (handles first load case)
      navigator.serviceWorker.ready.then((registration) => {
        debug('log', '[PWA] Service worker ready, scheduling background precache...');

        // Give the page time to fully load, then trigger background precaching
        setTimeout(() => {
          const controller = navigator.serviceWorker.controller || registration.active;
          if (!controller) {
            debug('warn', '[PWA] No service worker controller available');
            return;
          }

          // First, cache current page's assets (scripts + stylesheets)
          const scripts = Array.from(document.querySelectorAll('script[src]'))
            .map((el) => (el as HTMLScriptElement).src)
            .filter((src) => src.startsWith(location.origin));

          const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
            .map((el) => (el as HTMLLinkElement).href)
            .filter((href) => href.startsWith(location.origin));

          const urls = [...scripts, ...styles];

          if (urls.length > 0) {
            debug('log', `[PWA] Caching ${urls.length} current page assets...`);
            controller.postMessage({
              type: 'CACHE_URLS',
              urls
            });
          }

          // Then trigger full background precaching for all app chunks.
          // This ensures offline support for all pages, not just visited ones.
          debug('log', '[PWA] Triggering background precache of all app chunks...');
          controller.postMessage({
            type: 'PRECACHE_ALL'
          });
        }, 500); // Cache assets quickly to reduce window for uncached refreshes
      });
    }
  });

  // =============================================================================
  //  Lifecycle — Destroy
  // =============================================================================

  onDestroy(() => {
    if (browser) {
      // Cleanup chunk error handler
      if (chunkErrorHandler) {
        window.removeEventListener('unhandledrejection', chunkErrorHandler);
      }
      // Cleanup sign out listener
      window.removeEventListener('radiant:signout', handleSignOut);
    }
  });

  // =============================================================================
  //  Event Handlers
  // =============================================================================

  /**
   * Handles the sign-out flow with a visual transition.
   *
   * 1. Shows a full-screen "Locking..." overlay immediately.
   * 2. Waits 250ms for the overlay fade-in to complete.
   * 3. Calls `lockSingleUser()` to stop the engine and clear the session
   *    (but NOT destroy user data).
   * 4. Hard-navigates to `/login` (full page reload to reset all state).
   */
  async function handleSignOut() {
    // Show full-screen overlay immediately
    isSigningOut = true;

    // Wait for overlay to fully appear
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Lock the single-user session (stops engine, resets auth state, does NOT destroy data)
    await lockSingleUser();

    // Navigate to login
    window.location.href = '/login';
  }

  /**
   * Checks whether a given route `href` matches the current page path.
   * Used to highlight the active nav item.
   *
   * @param href - The route path to check (e.g. `'/agenda'`)
   * @returns `true` if the current path starts with `href`
   */
  function isActive(href: string): boolean {
    if (href === '/') return $page.url.pathname === '/';
    return $page.url.pathname.startsWith(href);
  }

  /**
   * Dismisses the currently visible toast notification.
   */
  function dismissToast() {
    showToast = false;
  }
</script>

<!-- ═══════════════════════════════════════════════════════════════════════════
     App Shell Container
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="app" class:authenticated={isAuthenticated} class:loading={$authState.isLoading}>
  <!-- ── Auth Loading Overlay — crystal-cutting spinner ── -->
  {#if $authState.isLoading && !isAuthPage}
    <div class="auth-loading-overlay">
      <div class="crystal-loader">
        <div class="crystal-facet facet-1"></div>
        <div class="crystal-facet facet-2"></div>
        <div class="crystal-facet facet-3"></div>
        <div class="crystal-core">
          <div class="crystal-core-inner"></div>
        </div>
        <div class="crystal-spark spark-1"></div>
        <div class="crystal-spark spark-2"></div>
        <div class="crystal-spark spark-3"></div>
        <div class="crystal-spark spark-4"></div>
      </div>
    </div>
  {/if}

  <!-- ── Sign-Out Overlay — full-screen transition during lock ── -->
  {#if isSigningOut}
    <div class="signout-overlay" transition:fade={{ duration: 200 }}>
      <div class="signout-content">
        <div class="signout-icon">
          <svg width="48" height="48" viewBox="0 0 100 100" fill="none">
            <polygon
              points="50,5 61,35 95,35 68,55 79,85 50,65 21,85 32,55 5,35 39,35"
              stroke="url(#signoutGemGrad)"
              stroke-width="4"
              fill="none"
            />
            <defs>
              <linearGradient id="signoutGemGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="var(--color-primary, #8b5cf6)" />
                <stop offset="100%" stop-color="var(--color-success, #10b981)" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <p class="signout-text">Locking...</p>
      </div>
    </div>
  {/if}

  <!-- ── Toast Notification — glassmorphic floating toast ── -->
  {#if showToast}
    <div
      class="app-toast"
      class:toast-error={toastType === 'error'}
      transition:fade={{ duration: 150 }}
    >
      <div class="toast-content">
        {#if toastType === 'error'}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        {:else}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
        {/if}
        <span>{toastMessage}</span>
        <button class="toast-dismiss" onclick={dismissToast} aria-label="Dismiss notification">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════════
       Mobile Dynamic Island Header (visible < 768px)
       ═══════════════════════════════════════════════════════════════════════ -->
  {#if isAuthenticated}
    <header class="island-header">
      <!-- Left: gem logo + brand -->
      <div class="island-left">
        <a href="/" class="island-brand-link">
          <span class="island-brand">
            <svg class="island-logo" viewBox="0 0 100 100" fill="none">
              <polygon
                points="50,8 65,38 95,38 72,58 80,90 50,70 20,90 28,58 5,38 35,38"
                stroke="url(#islandGemGrad)"
                stroke-width="5"
                fill="url(#islandGemFill)"
              />
              <defs>
                <linearGradient id="islandGemGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="var(--color-primary, #8b5cf6)" />
                  <stop offset="100%" stop-color="#e056a0" />
                </linearGradient>
                <linearGradient id="islandGemFill" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="rgba(139, 92, 246, 0.15)" />
                  <stop offset="100%" stop-color="rgba(224, 86, 160, 0.05)" />
                </linearGradient>
              </defs>
            </svg>
          </span>
          <span class="island-page-title">{pageTitle}</span>
        </a>
      </div>
      <!-- Center: reserved gap for iPhone Dynamic Island -->
      <div class="island-center"></div>
      <!-- Right: sync status indicator -->
      <div class="island-right">
        <SyncStatus />
      </div>
    </header>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════════
       Desktop / Tablet Top Navigation (visible >= 768px)
       ═══════════════════════════════════════════════════════════════════════ -->
  {#if isAuthenticated}
    <nav class="nav-desktop">
      <div class="nav-inner">
        <!-- ── Brand ── -->
        <a href="/" class="nav-brand">
          <span class="brand-icon">
            <svg width="28" height="28" viewBox="0 0 100 100" fill="none">
              <polygon
                points="50,8 65,38 95,38 72,58 80,90 50,70 20,90 28,58 5,38 35,38"
                stroke="url(#brandGemGrad)"
                stroke-width="5"
                fill="url(#brandGemFill)"
              />
              <defs>
                <linearGradient id="brandGemGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="var(--color-primary, #8b5cf6)" />
                  <stop offset="100%" stop-color="#e056a0" />
                </linearGradient>
                <linearGradient id="brandGemFill" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="rgba(139, 92, 246, 0.2)" />
                  <stop offset="100%" stop-color="rgba(224, 86, 160, 0.05)" />
                </linearGradient>
              </defs>
            </svg>
          </span>
          <span class="brand-text">Radiant</span>
        </a>

        <!-- ── Center Navigation Links ── -->
        <div class="nav-center">
          {#each navItems as item (item.href)}
            <a href={item.href} class="nav-link" class:active={isActive(item.href)}>
              <span class="link-icon">
                {#if item.icon === 'grid'}
                  <!-- Dashboard / grid icon -->
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect x="3" y="3" width="7" height="7"></rect>
                    <rect x="14" y="3" width="7" height="7"></rect>
                    <rect x="14" y="14" width="7" height="7"></rect>
                    <rect x="3" y="14" width="7" height="7"></rect>
                  </svg>
                {:else if item.icon === 'list'}
                  <!-- Transactions / list icon -->
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <line x1="8" y1="6" x2="21" y2="6"></line>
                    <line x1="8" y1="12" x2="21" y2="12"></line>
                    <line x1="8" y1="18" x2="21" y2="18"></line>
                    <line x1="3" y1="6" x2="3.01" y2="6"></line>
                    <line x1="3" y1="12" x2="3.01" y2="12"></line>
                    <line x1="3" y1="18" x2="3.01" y2="18"></line>
                  </svg>
                {:else if item.icon === 'pie-chart'}
                  <!-- Budgets / pie-chart icon -->
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
                    <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
                  </svg>
                {:else if item.icon === 'credit-card'}
                  <!-- Accounts / credit-card icon -->
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                    <line x1="1" y1="10" x2="23" y2="10"></line>
                  </svg>
                {:else if item.icon === 'user'}
                  <!-- Profile / user icon -->
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                {/if}
              </span>
              <span class="link-text">{item.label}</span>
              {#if isActive(item.href)}
                <span class="active-indicator"></span>
              {/if}
            </a>
          {/each}
        </div>

        <!-- ── Right Actions — sync status + logout ── -->
        <div class="nav-actions">
          <SyncStatus />
          <button class="logout-btn" onclick={handleSignOut} aria-label="Sign out">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </nav>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════════
       Main Content Area — renders the matched page
       ═══════════════════════════════════════════════════════════════════════ -->
  <main class="main" class:with-nav={isAuthenticated}>
    {@render children?.()}
  </main>

  <!-- ═══════════════════════════════════════════════════════════════════════
       Mobile Bottom Tab Bar — visible < 768px
       ═══════════════════════════════════════════════════════════════════════ -->
  {#if isAuthenticated}
    <nav class="nav-mobile">
      <div class="nav-mobile-bg"></div>
      <div class="tab-bar">
        {#each navItems as item, index (item.href)}
          <a
            href={item.href}
            class="tab-item"
            class:active={isActive(item.href)}
            style="--tab-index: {index};"
          >
            <span class="tab-glow"></span>
            <span class="tab-icon">
              {#if item.icon === 'grid'}
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="3" y="3" width="7" height="7"></rect>
                  <rect x="14" y="3" width="7" height="7"></rect>
                  <rect x="14" y="14" width="7" height="7"></rect>
                  <rect x="3" y="14" width="7" height="7"></rect>
                </svg>
              {:else if item.icon === 'list'}
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="8" y1="6" x2="21" y2="6"></line>
                  <line x1="8" y1="12" x2="21" y2="12"></line>
                  <line x1="8" y1="18" x2="21" y2="18"></line>
                  <line x1="3" y1="6" x2="3.01" y2="6"></line>
                  <line x1="3" y1="12" x2="3.01" y2="12"></line>
                  <line x1="3" y1="18" x2="3.01" y2="18"></line>
                </svg>
              {:else if item.icon === 'pie-chart'}
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path>
                  <path d="M22 12A10 10 0 0 0 12 2v10z"></path>
                </svg>
              {:else if item.icon === 'credit-card'}
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                  <line x1="1" y1="10" x2="23" y2="10"></line>
                </svg>
              {:else if item.icon === 'user'}
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
              {/if}
            </span>
            <span class="tab-label">{item.label}</span>
            {#if isActive(item.href)}
              <span class="tab-active-dot"></span>
            {/if}
          </a>
        {/each}
      </div>
    </nav>
  {/if}

  <!-- ── Global Update Prompt — shown when a new service worker is available ── -->
  <UpdatePrompt />

  <!-- ── Demo Mode Banner ── -->
  <DemoBanner />
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     STYLES
     ═══════════════════════════════════════════════════════════════════════════ -->
<style>
  /* ═══════════════════════════════════════════════════════════════════════════
     APP SHELL
     ═══════════════════════════════════════════════════════════════════════════
     All design tokens come from app.css :root — no overrides needed here.
     ═══════════════════════════════════════════════════════════════════════════ */

  .app {
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--color-bg);
    color: var(--color-text);
  }

  .app.loading > :not(.auth-loading-overlay) {
    visibility: hidden;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     AUTH LOADING OVERLAY — Crystal Cutting Animation
     ═══════════════════════════════════════════════════════════════════════════ */

  .auth-loading-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-obsidian);
  }

  .crystal-loader {
    position: relative;
    width: 80px;
    height: 80px;
  }

  .crystal-facet {
    position: absolute;
    inset: 0;
    border: 2px solid transparent;
    border-radius: 50%;
  }

  .facet-1 {
    border-top-color: var(--color-primary);
    animation: crystal-spin 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
  }

  .facet-2 {
    inset: 6px;
    border-right-color: var(--color-primary-light);
    animation: crystal-spin 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
    animation-delay: -0.3s;
  }

  .facet-3 {
    inset: 12px;
    border-bottom-color: var(--color-success);
    animation: crystal-spin 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
    animation-delay: -0.6s;
  }

  .crystal-core {
    position: absolute;
    inset: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .crystal-core-inner {
    width: 16px;
    height: 16px;
    background: var(--color-primary);
    clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
    animation: crystal-pulse 1.2s ease-in-out infinite;
  }

  .crystal-spark {
    position: absolute;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--color-primary-light);
    animation: crystal-spark-orbit 2s linear infinite;
  }

  .spark-1 {
    top: 0;
    left: 50%;
    animation-delay: 0s;
  }
  .spark-2 {
    top: 50%;
    right: 0;
    animation-delay: -0.5s;
  }
  .spark-3 {
    bottom: 0;
    left: 50%;
    animation-delay: -1s;
  }
  .spark-4 {
    top: 50%;
    left: 0;
    animation-delay: -1.5s;
  }

  @keyframes crystal-spin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  @keyframes crystal-pulse {
    0%,
    100% {
      transform: scale(0.8) rotate(0deg);
      opacity: 0.6;
    }
    50% {
      transform: scale(1.2) rotate(45deg);
      opacity: 1;
    }
  }

  @keyframes crystal-spark-orbit {
    0% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(0.3);
      opacity: 0.3;
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SIGN-OUT OVERLAY
     ═══════════════════════════════════════════════════════════════════════════ */

  .signout-overlay {
    position: fixed;
    inset: 0;
    z-index: 9998;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 10, 26, 0.92);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
  }

  .signout-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .signout-icon {
    animation: signout-gem-spin 2s ease-in-out infinite;
  }

  .signout-text {
    font-size: 1.1rem;
    color: var(--color-text-muted);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    font-weight: 500;
  }

  @keyframes signout-gem-spin {
    0%,
    100% {
      transform: rotate(0deg) scale(1);
    }
    50% {
      transform: rotate(180deg) scale(0.9);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     TOAST NOTIFICATION — Glassmorphic
     ═══════════════════════════════════════════════════════════════════════════ */

  .app-toast {
    position: fixed;
    top: calc(var(--safe-area-top) + 16px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 9000;
    max-width: 420px;
    width: calc(100% - 32px);
  }

  .toast-content {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: var(--color-glass);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border: 1px solid var(--color-glass-border);
    border-radius: 14px;
    color: var(--color-text);
    font-size: 0.875rem;
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(139, 92, 246, 0.08);
  }

  .toast-error .toast-content {
    border-color: rgba(244, 114, 182, 0.25);
    box-shadow:
      0 8px 32px rgba(244, 114, 182, 0.15),
      inset 0 1px 0 rgba(244, 114, 182, 0.08);
  }

  .toast-content span {
    flex: 1;
    line-height: 1.4;
  }

  .toast-dismiss {
    flex-shrink: 0;
    background: none;
    border: none;
    color: var(--color-text-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 6px;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .toast-dismiss:hover {
    color: var(--color-text);
    background: rgba(255, 255, 255, 0.06);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MOBILE DYNAMIC ISLAND HEADER
     ═══════════════════════════════════════════════════════════════════════════ */

  .island-header {
    display: none;
  }

  @media (max-width: 767px) {
    .island-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
      height: calc(48px + var(--safe-area-top));
      padding: var(--safe-area-top) 16px 0 16px;
      background: var(--color-glass);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--color-glass-border);
    }
  }

  .island-left {
    display: flex;
    align-items: center;
  }

  .island-brand-link {
    display: flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    color: var(--color-text);
  }

  .island-brand {
    display: flex;
    align-items: center;
  }

  .island-logo {
    width: 24px;
    height: 24px;
  }

  .island-page-title {
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .island-center {
    flex: 1;
  }

  .island-right {
    display: flex;
    align-items: center;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     DESKTOP TOP NAVIGATION — Frosted Glass
     ═══════════════════════════════════════════════════════════════════════════ */

  .nav-desktop {
    display: none;
  }

  @media (min-width: 768px) {
    .nav-desktop {
      display: block;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
      height: var(--nav-height);
      background: var(--color-glass);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border-bottom: 1px solid var(--color-glass-border);
    }
  }

  .nav-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 100%;
    max-width: 1280px;
    margin: 0 auto;
    padding: 0 24px;
  }

  /* ── Brand ── */

  .nav-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    color: var(--color-text);
    flex-shrink: 0;
  }

  .brand-icon {
    display: flex;
    align-items: center;
    filter: drop-shadow(0 0 6px rgba(139, 92, 246, 0.4));
  }

  .brand-text {
    font-size: 1.15rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    background: linear-gradient(135deg, var(--color-primary-light), var(--color-primary));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  /* ── Center Nav Links ── */

  .nav-center {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.04);
  }

  .nav-link {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 12px;
    text-decoration: none;
    color: var(--color-text-muted);
    font-size: 0.85rem;
    font-weight: 500;
    letter-spacing: 0.02em;
    transition:
      color 0.2s,
      background 0.2s;
    white-space: nowrap;
  }

  .nav-link:hover {
    color: var(--color-text);
    background: rgba(139, 92, 246, 0.08);
  }

  .nav-link.active {
    color: var(--color-primary-light);
    background: rgba(139, 92, 246, 0.12);
  }

  .link-icon {
    display: flex;
    align-items: center;
    opacity: 0.7;
    transition: opacity 0.2s;
  }

  .nav-link.active .link-icon {
    opacity: 1;
    filter: drop-shadow(0 0 4px rgba(139, 92, 246, 0.5));
  }

  .link-text {
    display: inline;
  }

  /* ── Active indicator — animated gem glow underline ── */

  .active-indicator {
    position: absolute;
    bottom: 2px;
    left: 50%;
    transform: translateX(-50%);
    width: 20px;
    height: 3px;
    border-radius: 2px;
    background: linear-gradient(90deg, var(--color-primary), var(--color-primary-light));
    box-shadow:
      0 0 8px rgba(139, 92, 246, 0.6),
      0 0 16px rgba(139, 92, 246, 0.3);
    animation: gem-glow-pulse 2s ease-in-out infinite;
  }

  @keyframes gem-glow-pulse {
    0%,
    100% {
      box-shadow:
        0 0 8px rgba(139, 92, 246, 0.6),
        0 0 16px rgba(139, 92, 246, 0.3);
    }
    50% {
      box-shadow:
        0 0 12px rgba(139, 92, 246, 0.8),
        0 0 24px rgba(139, 92, 246, 0.5);
    }
  }

  /* ── Right Actions ── */

  .nav-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .logout-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    border: 1px solid var(--color-border);
    background: rgba(255, 255, 255, 0.03);
    color: var(--color-text-muted);
    cursor: pointer;
    transition:
      color 0.2s,
      background 0.2s,
      border-color 0.2s;
  }

  .logout-btn:hover {
    color: var(--color-error);
    background: rgba(244, 114, 182, 0.08);
    border-color: rgba(244, 114, 182, 0.25);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MAIN CONTENT AREA
     ═══════════════════════════════════════════════════════════════════════════ */

  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .main.with-nav {
    padding-top: 0;
  }

  @media (min-width: 768px) {
    .main.with-nav {
      padding-top: var(--nav-height);
    }
  }

  @media (max-width: 767px) {
    .main.with-nav {
      padding-top: calc(48px + var(--safe-area-top));
      padding-bottom: calc(var(--tab-height) + var(--safe-area-bottom));
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MOBILE BOTTOM TAB BAR
     ═══════════════════════════════════════════════════════════════════════════ */

  .nav-mobile {
    display: none;
  }

  @media (max-width: 767px) {
    .nav-mobile {
      display: block;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 100;
    }
  }

  .nav-mobile-bg {
    position: absolute;
    inset: 0;
    background: var(--color-glass);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border-top: 1px solid var(--color-glass-border);
  }

  .tab-bar {
    position: relative;
    display: flex;
    align-items: stretch;
    justify-content: space-around;
    height: var(--tab-height);
    padding-bottom: var(--safe-area-bottom);
  }

  .tab-item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    gap: 2px;
    text-decoration: none;
    color: var(--color-text-muted);
    transition: color 0.2s;
    padding: 6px 0;
    -webkit-tap-highlight-color: transparent;
  }

  .tab-item.active {
    color: var(--color-primary-light);
  }

  .tab-glow {
    position: absolute;
    top: 4px;
    left: 50%;
    transform: translateX(-50%);
    width: 40px;
    height: 32px;
    border-radius: 12px;
    background: transparent;
    transition: background 0.25s;
    pointer-events: none;
  }

  .tab-item.active .tab-glow {
    background: rgba(139, 92, 246, 0.12);
  }

  .tab-icon {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s;
  }

  .tab-item.active .tab-icon {
    transform: translateY(-1px);
    filter: drop-shadow(0 0 4px rgba(139, 92, 246, 0.5));
  }

  .tab-label {
    position: relative;
    z-index: 1;
    font-size: 0.65rem;
    font-weight: 500;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  /* ── Active dot indicator ── */

  .tab-active-dot {
    position: absolute;
    bottom: calc(6px + var(--safe-area-bottom));
    left: 50%;
    transform: translateX(-50%);
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--color-primary-light);
    box-shadow:
      0 0 6px rgba(139, 92, 246, 0.7),
      0 0 12px rgba(139, 92, 246, 0.4);
    animation: gem-dot-pulse 2s ease-in-out infinite;
  }

  @keyframes gem-dot-pulse {
    0%,
    100% {
      box-shadow:
        0 0 6px rgba(139, 92, 246, 0.7),
        0 0 12px rgba(139, 92, 246, 0.4);
    }
    50% {
      box-shadow:
        0 0 10px rgba(139, 92, 246, 0.9),
        0 0 20px rgba(139, 92, 246, 0.6);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     GLOBAL — SyncStatus icon colour override (rendered via Snippet)
     ═══════════════════════════════════════════════════════════════════════════ */

  :global(.sync-status) {
    color: var(--color-text-muted);
  }
</style>
