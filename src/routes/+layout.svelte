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

  /* ── Global Styles ── */
  import '../app.css';

  /* ── Svelte Lifecycle & Transitions ── */
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';

  /* ── SvelteKit Utilities ── */
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';

  /* ── Stellar Engine — Auth & Stores ── */
  import { lockSingleUser, resolveFirstName, resolveAvatarInitial } from 'stellar-drive/auth';
  import { authState } from 'stellar-drive/stores';
  import { debug } from 'stellar-drive/utils';
  import { hydrateAuthState } from 'stellar-drive/kit';
  import { scrollGuard } from 'stellar-drive/actions';
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
   * Navbar only shows on the four main app pages (dashboard, transactions,
   * accounts, profile). All other routes hide the app shell chrome.
   */
  const NAV_ROUTES = ['/', '/transactions', '/accounts', '/profile'];
  const isNavPage = $derived(
    NAV_ROUTES.some((r) =>
      r === '/' ? $page.url.pathname === '/' : $page.url.pathname.startsWith(r)
    )
  );
  const isAuthenticated = $derived(data.authMode !== 'none' && isNavPage && !$authState.isLoading);

  /** User's first name for the greeting. */
  const greeting = $derived(resolveFirstName(data.session, data.offlineProfile, 'there'));

  /** Single uppercase initial for avatar circles. */
  const avatarInitial = $derived(resolveAvatarInitial(data.session, data.offlineProfile, '?'));

  /**
   * Navigation items for both the desktop top-nav and mobile bottom tab bar.
   */
  const navItems = [
    { href: '/', label: 'Dashboard', icon: 'grid' },
    { href: '/transactions', label: 'Transactions', icon: 'list' },
    { href: '/accounts', label: 'Accounts', icon: 'credit-card' }
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

    // Client-side navigate to login — keeps the layout mounted so the
    // sign-out overlay persists seamlessly (no flicker between pages).
    await goto('/login', { invalidateAll: true });

    // Dismiss the overlay now that the login page has rendered underneath
    await new Promise((resolve) => setTimeout(resolve, 100));
    isSigningOut = false;
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
  {#if $authState.isLoading}
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
                <stop offset="0%" stop-color="var(--color-primary, #d4a039)" />
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
      <!-- Left: Radiant brand icon + name -->
      <div class="island-left">
        <a href="/" class="island-brand-link">
          <span class="island-brand">
            <svg class="island-logo" viewBox="0 0 512 512" fill="none">
              <defs>
                <linearGradient id="islandGemGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#e8b94a" />
                  <stop offset="50%" stop-color="#d4a039" />
                  <stop offset="100%" stop-color="#e85d75" />
                </linearGradient>
                <linearGradient id="islandGemFill" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#f0d88a" />
                  <stop offset="100%" stop-color="#e8b94a" />
                </linearGradient>
              </defs>
              <polygon
                points="256,72 370,140 414,256 370,372 256,436 142,372 98,256 142,140"
                fill="url(#islandGemGrad)"
                stroke="#b8862e"
                stroke-width="2.5"
              />
              <polygon
                points="256,164 326,208 348,234 348,278 280,328 168,328 168,278 186,208"
                fill="url(#islandGemFill)"
                opacity="0.8"
              />
              <polygon
                points="256,192 306,220 324,256 306,292 256,308 206,292 188,256 206,220"
                fill="#f5e6b8"
                opacity="0.5"
              />
            </svg>
          </span>
          <span class="island-brand-text">Radiant</span>
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
            <svg width="28" height="28" viewBox="0 0 512 512" fill="none">
              <defs>
                <linearGradient id="navGemGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#e8b94a" />
                  <stop offset="50%" stop-color="#d4a039" />
                  <stop offset="100%" stop-color="#e85d75" />
                </linearGradient>
                <linearGradient id="navTableGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stop-color="#f0d88a" />
                  <stop offset="100%" stop-color="#e8b94a" />
                </linearGradient>
              </defs>
              <polygon
                points="256,72 370,140 414,256 370,372 256,436 142,372 98,256 142,140"
                fill="url(#navGemGrad)"
                stroke="#b8862e"
                stroke-width="2.5"
              />
              <polygon
                points="256,164 326,208 348,234 348,278 280,328 168,328 168,278 186,208"
                fill="url(#navTableGrad)"
                opacity="0.8"
              />
              <polygon
                points="256,192 306,220 324,256 306,292 256,308 206,292 188,256 206,220"
                fill="#f5e6b8"
                opacity="0.5"
              />
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
          <a href="/profile" class="user-menu user-menu-link">
            <span class="user-avatar">
              {avatarInitial}
            </span>
            <span class="user-greeting">Hey, {greeting}!</span>
          </a>
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
  <main class="main" class:with-nav={isAuthenticated} use:scrollGuard>
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
            {#if isActive(item.href)}
              <span class="tab-active-indicator"></span>
            {/if}
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
              {/if}
            </span>
            <span class="tab-label">{item.label}</span>
          </a>
        {/each}

        <!-- ── Profile Tab — avatar with first-letter initial ── -->
        <a
          href="/profile"
          class="tab-item tab-profile"
          class:active={isActive('/profile')}
          style="--tab-index: 4;"
        >
          {#if isActive('/profile')}
            <span class="tab-active-indicator"></span>
          {/if}
          <span class="tab-glow"></span>
          <span class="tab-icon">
            <span class="mobile-avatar">{avatarInitial}</span>
          </span>
          <span class="tab-label">Profile</span>
        </a>
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
      inset 0 1px 0 rgba(212, 160, 57, 0.08);
  }

  .toast-error .toast-content {
    border-color: rgba(232, 93, 117, 0.25);
    box-shadow:
      0 8px 32px rgba(232, 93, 117, 0.15),
      inset 0 1px 0 rgba(232, 93, 117, 0.08);
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
    position: fixed;
    top: calc(-1 * env(safe-area-inset-top, 0px));
    left: 0;
    right: 0;
    z-index: 150;
    height: calc(env(safe-area-inset-top, 47px) * 2 + 24px);
    padding-top: calc(env(safe-area-inset-top, 47px) * 2);
    background: linear-gradient(
      180deg,
      rgba(14, 12, 8, 0.3) 0%,
      rgba(14, 12, 8, 0.6) 40%,
      rgba(14, 12, 8, 0.85) 70%,
      rgba(14, 12, 8, 0.7) 100%
    );
    pointer-events: none;
    animation: islandFadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.1s backwards;
  }

  @keyframes islandFadeIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .island-header > * {
    pointer-events: auto;
  }

  .island-header {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    padding-left: max(12px, env(safe-area-inset-left, 12px));
    padding-right: max(12px, env(safe-area-inset-right, 12px));
    padding-bottom: 0;
  }

  @media (max-width: 767px) {
    .island-header {
      display: flex;
    }
  }

  .island-left {
    display: flex;
    align-items: center;
    padding-left: 4px;
    animation: islandItemFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s backwards;
  }

  @keyframes islandItemFadeIn {
    from {
      opacity: 0;
      transform: translateX(-8px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .island-brand-link {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;
  }

  .island-brand {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    filter: drop-shadow(0 0 6px rgba(212, 160, 57, 0.4));
    animation: brandFloatMobile 4s ease-in-out infinite;
  }

  @keyframes brandFloatMobile {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-2px);
    }
  }

  .island-logo {
    width: 32px;
    height: 32px;
  }

  .island-brand-text {
    font-size: 1.35rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    background: linear-gradient(
      135deg,
      var(--color-text, #f5efe0) 0%,
      var(--color-primary-light, #e8b94a) 50%,
      var(--color-text, #f5efe0) 100%
    );
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: brandTextShimmer 8s linear infinite;
  }

  @keyframes brandTextShimmer {
    0% {
      background-position: 0% center;
    }
    100% {
      background-position: 200% center;
    }
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
      padding: 0 1.5rem;
      padding-top: env(safe-area-inset-top, 0);
    }
  }

  .nav-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 100%;
    max-width: 1400px;
    margin: 0 auto;
    gap: 1.5rem;
    position: relative;
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
    justify-content: center;
    filter: drop-shadow(0 0 6px rgba(212, 160, 57, 0.4));
    animation: brandFloat 4s ease-in-out infinite;
  }

  @keyframes brandFloat {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-3px);
    }
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
    /* Absolutely center the nav regardless of brand/actions widths */
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
  }

  .nav-link {
    position: relative;
    overflow: hidden;
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
      color 0.3s,
      background 0.3s;
    white-space: nowrap;
  }

  /* Faceted background reveal on hover */
  .nav-link::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: rgba(212, 160, 57, 0.12);
    opacity: 0;
    transform: scale(0.8);
    transition:
      opacity 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
      transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    z-index: -1;
  }

  .nav-link:hover::before {
    opacity: 1;
    transform: scale(1);
  }

  .nav-link:hover {
    color: var(--color-text);
  }

  .nav-link.active {
    color: var(--color-primary-light);
  }

  .nav-link.active::before {
    opacity: 1;
    transform: scale(1);
    background: linear-gradient(145deg, rgba(212, 160, 57, 0.18) 0%, rgba(232, 93, 117, 0.08) 100%);
    box-shadow:
      0 4px 20px rgba(212, 160, 57, 0.15),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
  }

  /* ── Nav link shimmer sweep on active ── */
  .nav-link.active::after {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 60%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(232, 185, 74, 0.15), transparent);
    border-radius: inherit;
    animation: navGemShimmer 4s ease-in-out infinite;
  }

  @keyframes navGemShimmer {
    0% {
      left: -100%;
    }
    50%,
    100% {
      left: 100%;
    }
  }

  .link-icon {
    display: flex;
    align-items: center;
    opacity: 0.7;
    transition:
      opacity 0.3s,
      transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
      filter 0.3s;
  }

  .nav-link:hover .link-icon {
    opacity: 1;
    transform: scale(1.15) rotate(-5deg);
  }

  .nav-link.active .link-icon {
    opacity: 1;
    filter: drop-shadow(0 0 6px rgba(212, 160, 57, 0.7));
    transform: scale(1.1);
  }

  .nav-link.active:hover .link-icon {
    transform: scale(1.2) rotate(-5deg);
  }

  .link-text {
    display: inline;
  }

  /* ── Active indicator — gem facet glow dot ── */

  .active-indicator {
    position: absolute;
    bottom: -8px;
    left: 50%;
    transform: translateX(-50%) scale(0);
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--color-primary-light, #e8b94a);
    box-shadow:
      0 0 8px rgba(212, 160, 57, 0.8),
      0 0 16px rgba(212, 160, 57, 0.4);
    transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .nav-link.active .active-indicator {
    transform: translateX(-50%) scale(1);
  }

  @keyframes gem-glow-pulse {
    0%,
    100% {
      box-shadow:
        0 0 8px rgba(212, 160, 57, 0.6),
        0 0 16px rgba(212, 160, 57, 0.3);
    }
    50% {
      box-shadow:
        0 0 12px rgba(212, 160, 57, 0.8),
        0 0 24px rgba(212, 160, 57, 0.5);
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
    background: rgba(232, 93, 117, 0.08);
    border-color: rgba(232, 93, 117, 0.25);
  }

  /* ── User Menu (greeting pill) ── */

  .user-menu {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0.375rem;
    padding-left: 0.5rem;
    padding-right: 0.375rem;
    background: rgba(14, 12, 8, 0.6);
    border: 1px solid rgba(212, 160, 57, 0.15);
    border-radius: 9999px;
    transition: all 0.3s ease;
  }

  .user-menu:hover {
    border-color: rgba(212, 160, 57, 0.3);
    background: rgba(14, 12, 8, 0.8);
  }

  .user-menu-link {
    text-decoration: none;
    cursor: pointer;
  }

  .user-menu-link:hover {
    border-color: rgba(212, 160, 57, 0.4);
    box-shadow: 0 0 20px rgba(212, 160, 57, 0.15);
  }

  .user-avatar {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, var(--color-primary, #d4a039), #e85d75);
    color: white;
    font-weight: 700;
    font-size: 0.875rem;
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(212, 160, 57, 0.3);
    transition:
      transform 0.3s ease,
      box-shadow 0.3s;
  }

  .user-menu:hover .user-avatar {
    transform: scale(1.05);
    box-shadow: 0 4px 16px rgba(212, 160, 57, 0.4);
  }

  .user-greeting {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text);
    white-space: nowrap;
    padding-right: 0.25rem;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MAIN CONTENT AREA
     ═══════════════════════════════════════════════════════════════════════════ */

  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 2rem;
    padding-top: calc(var(--nav-height) + 2rem);
  }

  @media (max-width: 767px) {
    .main {
      padding: 1rem;
      padding-left: max(1rem, env(safe-area-inset-left, 1rem));
      padding-right: max(1rem, env(safe-area-inset-right, 1rem));
      /* Clear the fixed island-header: safe-area + header content (24px) + breathing room */
      padding-top: calc(env(safe-area-inset-top, 47px) + 24px + 1rem);
    }
    .main.with-nav {
      /* Clear the fixed bottom tab bar + breathing room */
      padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px) + 16px);
    }
  }

  @media (max-width: 375px) {
    .main {
      padding: 0.875rem;
      padding-top: calc(env(safe-area-inset-top, 20px) + 16px + 0.875rem);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MOBILE BOTTOM TAB BAR
     ═══════════════════════════════════════════════════════════════════════════ */

  .nav-mobile {
    display: none;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 100;
    padding-bottom: calc(env(safe-area-inset-bottom, 0px) * 0.6);
    background: var(--color-obsidian, #0e0c08);
  }

  @media (max-width: 767px) {
    .nav-mobile {
      display: block;
    }
  }

  .nav-mobile-bg {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(
      180deg,
      rgba(14, 12, 8, 0.95) 0%,
      rgba(14, 12, 8, 0.98) 50%,
      #0e0c08 100%
    );
    backdrop-filter: blur(40px) saturate(180%);
    -webkit-backdrop-filter: blur(40px) saturate(180%);
    border-top: 1px solid rgba(212, 160, 57, 0.12);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 -10px 40px rgba(0, 0, 0, 0.3);
  }

  /* Animated gem-light shine at top of bottom nav */
  .nav-mobile-bg::before {
    content: '';
    position: absolute;
    top: 0;
    left: 5%;
    right: 5%;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(212, 160, 57, 0.3) 20%,
      rgba(232, 185, 74, 0.6) 40%,
      rgba(232, 93, 117, 0.3) 60%,
      rgba(212, 160, 57, 0.3) 80%,
      transparent 100%
    );
    animation: navGemGlowShift 6s ease-in-out infinite;
  }

  @keyframes navGemGlowShift {
    0%,
    100% {
      opacity: 0.5;
    }
    50% {
      opacity: 1;
    }
  }

  /* Subtle warm glow accent above the bar */
  .nav-mobile-bg::after {
    content: '';
    position: absolute;
    top: -20px;
    left: 20%;
    right: 20%;
    height: 40px;
    background: radial-gradient(ellipse at center, rgba(212, 160, 57, 0.1) 0%, transparent 70%);
    pointer-events: none;
  }

  /* ── Tab Bar Container ── */

  .tab-bar {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-around;
    height: 64px;
    max-width: 420px;
    margin: 0 auto;
    padding: 0 0.75rem;
    padding-left: max(0.75rem, env(safe-area-inset-left, 0));
    padding-right: max(0.75rem, env(safe-area-inset-right, 0));
    z-index: 1;
  }

  /* ── Individual Tab Item ── */

  .tab-item {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    padding: 0.625rem 0.875rem;
    color: var(--color-text-muted);
    text-decoration: none;
    font-size: 0.625rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    border: none;
    background: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    min-width: 56px;
    animation: tabItemEnter 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
    animation-delay: calc(var(--tab-index, 0) * 0.05s);
  }

  @keyframes tabItemEnter {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* Gem glow background for tabs */
  .tab-glow {
    position: absolute;
    inset: 4px;
    border-radius: 14px;
    background: transparent;
    transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    z-index: -1;
  }

  .tab-item.active .tab-glow {
    background: linear-gradient(145deg, rgba(212, 160, 57, 0.18) 0%, rgba(212, 160, 57, 0.04) 100%);
    box-shadow: 0 0 20px rgba(212, 160, 57, 0.2);
  }

  .tab-item:active {
    transform: scale(0.9);
    transition: transform 0.1s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .tab-item:active .tab-glow {
    background: rgba(212, 160, 57, 0.12);
  }

  .tab-item.active {
    color: var(--color-text);
  }

  /* ── Tab Icon ── */

  .tab-icon {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .tab-icon svg {
    transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .tab-item.active .tab-icon {
    color: var(--color-primary-light, #e8b94a);
    transform: translateY(-2px);
  }

  .tab-item.active .tab-icon svg {
    filter: drop-shadow(0 0 8px rgba(212, 160, 57, 0.6));
  }

  /* ── Tab Label ── */

  .tab-label {
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .tab-item.active .tab-label {
    color: var(--color-primary-light, #e8b94a);
    text-shadow: 0 0 8px rgba(212, 160, 57, 0.4);
  }

  /* ── Active Indicator — pulsing gem dot above active tab ── */

  .tab-active-indicator {
    position: absolute;
    top: 0;
    left: 50%;
    width: 6px;
    height: 6px;
    background: linear-gradient(135deg, #e8b94a, #d4a039);
    border-radius: 50%;
    transform: translateX(-50%);
    box-shadow:
      0 0 10px rgba(212, 160, 57, 0.8),
      0 0 20px rgba(212, 160, 57, 0.4);
    animation: gemIndicatorPulse 2s ease-in-out infinite;
  }

  @keyframes gemIndicatorPulse {
    0%,
    100% {
      transform: translateX(-50%) scale(1);
      box-shadow:
        0 0 10px rgba(212, 160, 57, 0.8),
        0 0 20px rgba(212, 160, 57, 0.4);
    }
    50% {
      transform: translateX(-50%) scale(1.3);
      box-shadow:
        0 0 14px rgba(212, 160, 57, 0.9),
        0 0 28px rgba(212, 160, 57, 0.5);
    }
  }

  /* ── Profile Tab (mobile) ── */

  .tab-profile {
    min-width: auto;
  }

  .mobile-avatar {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, rgba(212, 160, 57, 0.3) 0%, rgba(232, 93, 117, 0.2) 100%);
    border: 1.5px solid rgba(212, 160, 57, 0.4);
    color: var(--color-text);
    font-weight: 700;
    font-size: 0.75rem;
    border-radius: 50%;
    transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .tab-item.active .mobile-avatar {
    border-color: rgba(212, 160, 57, 0.7);
    box-shadow:
      0 0 12px rgba(212, 160, 57, 0.4),
      0 2px 8px rgba(0, 0, 0, 0.3);
    transform: scale(1.08);
  }

  /* ── Wide Tablet (<=1100px) — hide greeting text to prevent nav overlap ── */
  @media (max-width: 1100px) {
    .user-greeting {
      display: none;
    }

    .user-menu {
      padding-right: 0.375rem;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     GLOBAL — SyncStatus icon colour override (rendered via Snippet)
     ═══════════════════════════════════════════════════════════════════════════ */

  :global(.sync-status) {
    color: var(--color-text-muted);
  }
</style>
