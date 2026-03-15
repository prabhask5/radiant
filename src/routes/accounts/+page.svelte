<!--
  @fileoverview Accounts page — bank account management with Teller Connect
  integration and crystal-faceted UI design.

  Displays connected financial accounts grouped by institution, manages
  Teller Connect enrollment flow, and shows account totals summary.
-->
<script lang="ts">
  /**
   * @fileoverview Accounts page script — Teller Connect SDK loading,
   * enrollment management, account display, and balance calculations.
   */

  // ==========================================================================
  //                                IMPORTS
  // ==========================================================================

  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { accountsStore, enrollmentsStore } from '$lib/stores/data';
  import { getConfig } from 'stellar-drive/config';
  import { formatCurrency } from '$lib/utils/currency';
  import type { TellerConnectStatic, TellerConnectEnrollment } from '$lib/teller/types';
  import type { Account, TellerEnrollment } from '$lib/types';

  // ==========================================================================
  //                           COMPONENT STATE
  // ==========================================================================

  /** Whether data has been loaded initially. */
  let loaded = $state(false);

  /** Whether Teller Connect SDK is loaded and ready. */
  let _tellerReady = $state(false);

  /** Whether we're currently loading the Teller Connect SDK. */
  let tellerLoading = $state(false);

  /** Whether a sync operation is in progress after enrollment. */
  let syncing = $state(false);

  /** Feedback message shown after sync or error. */
  let feedbackMessage = $state('');

  /** Feedback message type for styling. */
  let feedbackType = $state<'success' | 'error' | ''>('');

  /** Enrollment ID pending disconnection confirmation. */
  let confirmDisconnectId = $state<string | null>(null);

  /** Whether a disconnect operation is in progress. */
  let disconnecting = $state(false);

  /** Account ID whose balance visibility is being toggled. */
  let togglingHidden = $state<string | null>(null);

  /** Auto-dismiss timeout reference. */
  let feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

  // ==========================================================================
  //                         DERIVED STATE
  // ==========================================================================

  /** All accounts from the store. */
  const accounts: Account[] = $derived($accountsStore ?? []);

  /** All enrollments from the store. */
  const enrollments: TellerEnrollment[] = $derived($enrollmentsStore ?? []);

  /** Teller configuration from runtime config (served by /api/config). */
  const tellerAppId = getConfig()?.extra?.PUBLIC_TELLER_APP_ID || '';
  const tellerEnvironment =
    (getConfig()?.extra?.PUBLIC_TELLER_ENVIRONMENT as 'sandbox' | 'development' | 'production') ||
    'sandbox';

  /**
   * Accounts grouped by institution name.
   * Each group includes the enrollment info and its accounts.
   */
  const accountsByInstitution = $derived.by(() => {
    const groups = new Map<
      string,
      {
        institutionName: string;
        enrollmentId: string;
        enrollmentStatus: string;
        lastSynced: string | null;
        accounts: typeof accounts;
      }
    >();

    for (const enrollment of enrollments) {
      groups.set(enrollment.id, {
        institutionName: enrollment.institution_name,
        enrollmentId: enrollment.enrollment_id,
        enrollmentStatus: enrollment.status,
        lastSynced: enrollment.last_synced_at,
        accounts: []
      });
    }

    for (const account of accounts) {
      const group = groups.get(account.enrollment_id);
      if (group) {
        group.accounts.push(account);
      }
    }

    // Sort accounts within each group: visible first, then by name
    for (const group of groups.values()) {
      group.accounts.sort((a, b) => {
        if (a.is_hidden !== b.is_hidden) return a.is_hidden ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
    }

    return Array.from(groups.values()).sort((a, b) =>
      a.institutionName.localeCompare(b.institutionName)
    );
  });

  /**
   * Total assets: sum of balances from depository accounts (checking, savings, etc).
   */
  const totalAssets = $derived.by(() => {
    return accounts
      .filter((a) => a.type === 'depository' && !a.is_hidden)
      .reduce((sum, a) => {
        const balance = parseFloat(a.balance_available ?? a.balance_ledger ?? '0');
        return sum + (isNaN(balance) ? 0 : balance);
      }, 0);
  });

  /**
   * Total liabilities: sum of balances from credit accounts.
   * Credit card balances represent money owed, so they are liabilities.
   */
  const totalLiabilities = $derived.by(() => {
    return accounts
      .filter((a) => a.type === 'credit' && !a.is_hidden)
      .reduce((sum, a) => {
        const balance = parseFloat(a.balance_ledger ?? a.balance_available ?? '0');
        return sum + (isNaN(balance) ? 0 : Math.abs(balance));
      }, 0);
  });

  /** Net position: assets minus liabilities. */
  const netPosition = $derived(totalAssets - totalLiabilities);

  /** Whether the Teller app ID is configured. */
  const hasTellerConfig = $derived(!!tellerAppId);

  // ==========================================================================
  //                     TELLER CONNECT INTEGRATION
  // ==========================================================================

  /**
   * Load the Teller Connect SDK script dynamically.
   * Resolves when the script is loaded and ready.
   */
  function loadTellerConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[src*="teller.io"]')) {
        _tellerReady = true;
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.teller.io/connect/connect.js';
      script.onload = () => {
        _tellerReady = true;
        resolve();
      };
      script.onerror = () => reject(new Error('Failed to load Teller Connect'));
      document.body.appendChild(script);
    });
  }

  /**
   * Open the Teller Connect widget for linking a new financial institution.
   * On success, triggers a sync with the received access token.
   */
  async function openTellerConnect() {
    if (!tellerAppId) {
      showFeedback('error', 'Teller app ID not configured. Deploy with PUBLIC_TELLER_APP_ID set.');
      return;
    }

    tellerLoading = true;

    try {
      await loadTellerConnect();

      const TellerConnect = (window as unknown as { TellerConnect: TellerConnectStatic })
        .TellerConnect;
      if (!TellerConnect) {
        throw new Error('TellerConnect not available after script load');
      }

      const tellerConnect = TellerConnect.setup({
        applicationId: tellerAppId,
        products: ['balance', 'transactions'],
        environment: tellerEnvironment,
        onSuccess: async (enrollment: TellerConnectEnrollment) => {
          await handleEnrollmentSuccess(enrollment);
        },
        onInit: () => {
          tellerLoading = false;
        },
        onExit: () => {
          tellerLoading = false;
        },
        onFailure: (error: { message: string }) => {
          tellerLoading = false;
          showFeedback('error', `Connection failed: ${error.message}`);
        }
      });

      tellerConnect.open();
    } catch (err) {
      tellerLoading = false;
      showFeedback('error', err instanceof Error ? err.message : 'Failed to open Teller Connect');
    }
  }

  /**
   * Handle successful enrollment from Teller Connect.
   * Stores the enrollment and triggers a backend sync.
   */
  async function handleEnrollmentSuccess(enrollment: TellerConnectEnrollment) {
    syncing = true;
    showFeedback(
      'success',
      `Connected to ${enrollment.enrollment.institution.name}. Syncing accounts...`
    );

    try {
      // Save the enrollment locally
      await enrollmentsStore.create({
        enrollment_id: enrollment.enrollment.id,
        institution_name: enrollment.enrollment.institution.name,
        institution_id: '',
        access_token: enrollment.accessToken,
        status: 'connected',
        last_synced_at: null,
        error_message: null
      });

      // Trigger server-side sync to pull accounts and transactions
      const response = await fetch('/api/teller/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: enrollment.accessToken,
          enrollmentId: enrollment.enrollment.id
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || `Sync failed with status ${response.status}`);
      }

      // Refresh stores to pick up new data
      await Promise.all([accountsStore.refresh(), enrollmentsStore.refresh()]);

      showFeedback(
        'success',
        `${enrollment.enrollment.institution.name} accounts synced successfully.`
      );
    } catch (err) {
      console.error('Enrollment sync error:', err);
      showFeedback('error', err instanceof Error ? err.message : 'Sync failed. Please try again.');
    } finally {
      syncing = false;
    }
  }

  /**
   * Retry sync for an existing enrollment using its stored access token.
   */
  async function retrySyncEnrollment(enrollmentId: string) {
    const enrollment = enrollments.find((e) => e.id === enrollmentId);
    if (!enrollment?.access_token) {
      showFeedback('error', 'No access token stored for this enrollment.');
      return;
    }

    syncing = true;
    showFeedback('success', `Re-syncing ${enrollment.institution_name}...`);

    try {
      const response = await fetch('/api/teller/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: enrollment.access_token,
          enrollmentId: enrollment.enrollment_id
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Sync failed with status ${response.status}`);
      }

      await Promise.all([accountsStore.refresh(), enrollmentsStore.refresh()]);
      showFeedback('success', `${enrollment.institution_name} accounts synced successfully.`);
    } catch (err) {
      console.error('Retry sync error:', err);
      showFeedback('error', err instanceof Error ? err.message : 'Sync failed. Please try again.');
    } finally {
      syncing = false;
    }
  }

  /**
   * Disconnect an enrollment (remove all associated data).
   */
  async function disconnectEnrollment(enrollmentId: string) {
    disconnecting = true;
    try {
      await enrollmentsStore.remove(enrollmentId);
      await Promise.all([accountsStore.refresh(), enrollmentsStore.refresh()]);
      confirmDisconnectId = null;
      showFeedback('success', 'Institution disconnected.');
    } catch (err) {
      console.error('Disconnect error:', err);
      showFeedback('error', 'Failed to disconnect. Please try again.');
    } finally {
      disconnecting = false;
    }
  }

  /**
   * Toggle an account's hidden/visible state.
   */
  async function toggleAccountHidden(accountId: string, currentlyHidden: boolean) {
    togglingHidden = accountId;
    try {
      // The accountsStore doesn't have an update method exposed directly,
      // so we use the engineUpdate pattern through the store refresh
      const { engineUpdate } = await import('stellar-drive');
      await engineUpdate('accounts', accountId, { is_hidden: !currentlyHidden });
      await accountsStore.refresh();
    } catch (err) {
      console.error('Toggle hidden error:', err);
    } finally {
      togglingHidden = null;
    }
  }

  // ==========================================================================
  //                           HELPERS
  // ==========================================================================

  /**
   * Display a feedback message with auto-dismiss.
   */
  function showFeedback(type: 'success' | 'error', message: string) {
    feedbackType = type;
    feedbackMessage = message;
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
    feedbackTimeout = setTimeout(() => {
      feedbackMessage = '';
      feedbackType = '';
    }, 6000);
  }

  /**
   * Dismiss the current feedback message.
   */
  function dismissFeedback() {
    feedbackMessage = '';
    feedbackType = '';
    if (feedbackTimeout) clearTimeout(feedbackTimeout);
  }

  /**
   * Get a display label for the account subtype.
   */
  function subtypeLabel(subtype: string): string {
    const labels: Record<string, string> = {
      checking: 'Checking',
      savings: 'Savings',
      money_market: 'Money Market',
      certificate_of_deposit: 'CD',
      treasury: 'Treasury',
      sweep: 'Sweep',
      credit_card: 'Credit Card'
    };
    return labels[subtype] ?? subtype;
  }

  /**
   * Get the primary balance to display for an account.
   */
  function displayBalance(account: (typeof accounts)[0]): string {
    const balance = account.balance_available ?? account.balance_ledger;
    if (!balance) return '--';
    return formatCurrency(balance);
  }

  /**
   * Format a timestamp to a relative or absolute time string.
   */
  function formatLastSync(timestamp: string | null): string {
    if (!timestamp) return 'Never synced';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /**
   * Get the status badge color class for an enrollment status.
   */
  function statusClass(status: string): string {
    if (status === 'connected') return 'status-connected';
    if (status === 'error') return 'status-error';
    return 'status-disconnected';
  }

  /**
   * Get the account type icon SVG based on account type.
   */
  function accountTypeIcon(type: string, subtype: string): string {
    if (type === 'credit' || subtype === 'credit_card') return 'credit';
    if (subtype === 'savings' || subtype === 'money_market' || subtype === 'certificate_of_deposit')
      return 'savings';
    return 'checking';
  }

  // ==========================================================================
  //                           LIFECYCLE
  // ==========================================================================

  onMount(async () => {
    await Promise.all([accountsStore.refresh(), enrollmentsStore.refresh()]);
    loaded = true;

    // Pre-load Teller Connect SDK in the background if configured
    if (browser && tellerAppId) {
      loadTellerConnect().catch(() => {
        // Silent fail — will retry when user clicks Connect
      });
    }
  });
</script>

<svelte:head>
  <title>Accounts - Radiant Finance</title>
</svelte:head>

<!-- ═══════════════════════════════════════════════════════════════════════════
     PAGE TEMPLATE
     ═══════════════════════════════════════════════════════════════════════════ -->

<div class="accounts-page">
  <!-- Crystal lattice background -->
  <div class="lattice-bg" aria-hidden="true"></div>

  <!-- ── Header ─────────────────────────────────────────────────────── -->
  <header class="page-header">
    <div class="header-left">
      <h1 class="page-title">Accounts</h1>
      <p class="page-subtitle">
        {accounts.length} account{accounts.length !== 1 ? 's' : ''} connected
      </p>
    </div>
    <button class="connect-btn" onclick={openTellerConnect} disabled={tellerLoading || syncing}>
      {#if tellerLoading || syncing}
        <div class="btn-spinner"></div>
        {syncing ? 'Syncing...' : 'Connecting...'}
      {:else}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path
            d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
          /></svg
        >
        Connect Account
      {/if}
    </button>
  </header>

  <!-- ── Feedback Toast ──────────────────────────────────────────── -->
  {#if feedbackMessage}
    <div class="feedback-toast feedback-{feedbackType}" role="alert">
      <div class="feedback-content">
        {#if feedbackType === 'success'}
          <svg
            class="feedback-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline
              points="22 4 12 14.01 9 11.01"
            /></svg
          >
        {:else}
          <svg
            class="feedback-icon"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line
              x1="9"
              y1="9"
              x2="15"
              y2="15"
            /></svg
          >
        {/if}
        <span>{feedbackMessage}</span>
      </div>
      <button class="feedback-dismiss" onclick={dismissFeedback} aria-label="Dismiss">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
        >
      </button>
    </div>
  {/if}

  {#if !loaded}
    <!-- ── Loading State ─────────────────────────────────────────── -->
    <div class="loading-state">
      <div class="crystal-loader">
        <div class="loader-shard"></div>
        <div class="loader-shard"></div>
        <div class="loader-shard"></div>
        <div class="loader-shard"></div>
      </div>
      <p class="loading-text">Retrieving your accounts...</p>
    </div>
  {:else if accountsByInstitution.length === 0}
    <!-- ── Empty State ───────────────────────────────────────────── -->
    <div class="empty-state">
      <div class="empty-crystal">
        <svg width="96" height="96" viewBox="0 0 96 96" fill="none">
          <!-- Crystal cluster -->
          <path
            d="M48 12L62 36L48 60L34 36L48 12Z"
            stroke="url(#crystGrad1)"
            stroke-width="1.5"
            fill="url(#crystGrad1)"
            fill-opacity="0.08"
          />
          <path
            d="M30 28L42 48L30 68L18 48L30 28Z"
            stroke="url(#crystGrad2)"
            stroke-width="1.5"
            fill="url(#crystGrad2)"
            fill-opacity="0.06"
          />
          <path
            d="M66 28L78 48L66 68L54 48L66 28Z"
            stroke="url(#crystGrad2)"
            stroke-width="1.5"
            fill="url(#crystGrad2)"
            fill-opacity="0.06"
          />
          <!-- Facet lines -->
          <line
            x1="48"
            y1="12"
            x2="48"
            y2="60"
            stroke="url(#crystGrad1)"
            stroke-width="0.8"
            opacity="0.3"
          />
          <line
            x1="34"
            y1="36"
            x2="62"
            y2="36"
            stroke="url(#crystGrad1)"
            stroke-width="0.8"
            opacity="0.3"
          />
          <!-- Connection dots -->
          <circle cx="48" cy="72" r="2" fill="url(#crystGrad1)" opacity="0.5" />
          <circle cx="38" cy="76" r="1.5" fill="url(#crystGrad2)" opacity="0.4" />
          <circle cx="58" cy="76" r="1.5" fill="url(#crystGrad2)" opacity="0.4" />
          <line
            x1="38"
            y1="76"
            x2="48"
            y2="72"
            stroke="url(#crystGrad2)"
            stroke-width="0.8"
            opacity="0.2"
          />
          <line
            x1="58"
            y1="76"
            x2="48"
            y2="72"
            stroke="url(#crystGrad2)"
            stroke-width="0.8"
            opacity="0.2"
          />
          <defs>
            <linearGradient id="crystGrad1" x1="34" y1="12" x2="62" y2="60">
              <stop offset="0%" stop-color="#67e8f9" />
              <stop offset="100%" stop-color="#2ec4a6" />
            </linearGradient>
            <linearGradient id="crystGrad2" x1="18" y1="28" x2="78" y2="68">
              <stop offset="0%" stop-color="#e8b94a" />
              <stop offset="100%" stop-color="#b8862e" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <h2 class="empty-title">Connect your first account</h2>
      <p class="empty-desc">
        Link your bank accounts and credit cards to see all your finances in one crystal-clear view.
      </p>
      {#if !hasTellerConfig}
        <p class="empty-config-hint">First, add your Teller App ID in Settings.</p>
      {/if}
      <button
        class="connect-btn empty-cta"
        onclick={openTellerConnect}
        disabled={tellerLoading || syncing}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path
            d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
          /></svg
        >
        Connect with Teller
      </button>
    </div>
  {:else}
    <!-- ── Account Totals Summary ────────────────────────────────── -->
    <div class="totals-bar">
      <div class="total-item">
        <span class="total-label">Total Assets</span>
        <span class="total-value assets">{formatCurrency(totalAssets)}</span>
      </div>
      <div class="total-divider"></div>
      <div class="total-item">
        <span class="total-label">Total Liabilities</span>
        <span class="total-value liabilities">{formatCurrency(totalLiabilities)}</span>
      </div>
      <div class="total-divider"></div>
      <div class="total-item">
        <span class="total-label">Net Position</span>
        <span
          class="total-value"
          class:positive={netPosition >= 0}
          class:negative={netPosition < 0}
        >
          {formatCurrency(Math.abs(netPosition))}
          {#if netPosition < 0}
            <span class="net-sign">(deficit)</span>
          {/if}
        </span>
      </div>
    </div>

    <!-- ── Institution Groups ────────────────────────────────────── -->
    <div class="institutions-list">
      {#each accountsByInstitution as group, gi (group.enrollmentId)}
        <div class="institution-group" style="--group-delay: {gi * 80}ms">
          <!-- Institution Header -->
          <div class="institution-header">
            <div class="inst-info">
              <div class="inst-icon">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path
                    d="M9 21v-4h6v4"
                  /><path d="M9 9h.01" /><path d="M15 9h.01" /><path d="M9 13h.01" /><path
                    d="M15 13h.01"
                  /></svg
                >
              </div>
              <div class="inst-text">
                <h2 class="inst-name">{group.institutionName}</h2>
                <span class="inst-sync">{formatLastSync(group.lastSynced)}</span>
              </div>
            </div>
            <div class="inst-actions">
              <span class="status-badge {statusClass(group.enrollmentStatus)}">
                {group.enrollmentStatus}
              </span>
              {#if confirmDisconnectId === group.enrollmentId}
                <div class="disconnect-confirm">
                  <button
                    class="btn-danger-sm"
                    onclick={() => disconnectEnrollment(group.enrollmentId)}
                    disabled={disconnecting}
                  >
                    {disconnecting ? 'Removing...' : 'Confirm'}
                  </button>
                  <button class="btn-ghost-sm" onclick={() => (confirmDisconnectId = null)}>
                    Cancel
                  </button>
                </div>
              {:else}
                <button
                  class="sync-btn"
                  onclick={() => retrySyncEnrollment(group.enrollmentId)}
                  disabled={syncing}
                  aria-label="Re-sync {group.institutionName}"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><polyline points="23 4 23 10 17 10" /><path
                      d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
                    /></svg
                  >
                </button>
                <button
                  class="disconnect-btn"
                  onclick={() => (confirmDisconnectId = group.enrollmentId)}
                  aria-label="Disconnect {group.institutionName}"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><path d="M18.36 6.64a9 9 0 11-12.73 0" /><line
                      x1="12"
                      y1="2"
                      x2="12"
                      y2="12"
                    /></svg
                  >
                </button>
              {/if}
            </div>
          </div>

          <!-- Account Cards -->
          <div class="accounts-list">
            {#each group.accounts as account, ai (account.id)}
              {@const iconType = accountTypeIcon(account.type, account.subtype)}
              <div
                class="account-card"
                class:hidden-account={account.is_hidden}
                style="--acct-delay: {gi * 80 + ai * 50}ms"
              >
                <!-- Account type icon -->
                <div class="acct-icon acct-icon-{iconType}">
                  {#if iconType === 'credit'}
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line
                        x1="1"
                        y1="10"
                        x2="23"
                        y2="10"
                      /></svg
                    >
                  {:else if iconType === 'savings'}
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><path
                        d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-3.5c1.3-.8 2-2.2 2-3.5 0-.3-.1-2.7 0-3 .1-.3.3-1 .5-1.5.2-.7.5-1.5.5-2.5s-1-2-2-2z"
                      /><path d="M2 9.5a1 1 0 011-1 5 5 0 014 2c1 .5 2 .5 3 0" /></svg
                    >
                  {:else}
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><rect x="2" y="5" width="20" height="14" rx="2" /><line
                        x1="2"
                        y1="10"
                        x2="22"
                        y2="10"
                      /><line x1="7" y1="15" x2="7" y2="15.01" /><line
                        x1="11"
                        y1="15"
                        x2="13"
                        y2="15"
                      /></svg
                    >
                  {/if}
                </div>

                <!-- Account info -->
                <div class="acct-info">
                  <div class="acct-top">
                    <span class="acct-name" class:muted={account.is_hidden}>
                      {account.name}
                      {#if account.last_four}
                        <span class="acct-last4">{account.last_four}</span>
                      {/if}
                    </span>
                    <span class="acct-type-badge type-{account.type}">
                      {subtypeLabel(account.subtype)}
                    </span>
                  </div>
                  <div class="acct-bottom">
                    <span class="acct-balance" class:muted={account.is_hidden}>
                      {displayBalance(account)}
                    </span>
                    {#if account.balance_updated_at}
                      <span class="acct-updated">{formatLastSync(account.balance_updated_at)}</span>
                    {/if}
                  </div>
                </div>

                <!-- Hide toggle -->
                <button
                  class="hide-toggle"
                  class:is-hidden={account.is_hidden}
                  onclick={(e) => {
                    e.stopPropagation();
                    toggleAccountHidden(account.id, account.is_hidden);
                  }}
                  disabled={togglingHidden === account.id}
                  aria-label={account.is_hidden ? 'Show account' : 'Hide account'}
                >
                  {#if togglingHidden === account.id}
                    <div class="toggle-spinner"></div>
                  {:else if account.is_hidden}
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><path
                        d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"
                      /><line x1="1" y1="1" x2="23" y2="23" /></svg
                    >
                  {:else}
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle
                        cx="12"
                        cy="12"
                        r="3"
                      /></svg
                    >
                  {/if}
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     SCOPED STYLES
     ═══════════════════════════════════════════════════════════════════════════ -->

<style>
  /* ── Design Tokens ──────────────────────────────────────────────────────── */
  .accounts-page {
    --cyan: #2ec4a6;
    --cyan-dim: #083344;
    --cyan-glow: rgba(46, 196, 166, 0.3);
    --amethyst: #e8b94a;
    --amethyst-dim: #2e1065;
    --amethyst-glow: rgba(232, 185, 74, 0.3);
    --emerald: #34d399;
    --emerald-glow: rgba(52, 211, 153, 0.3);
    --ruby: #f87171;
    --ruby-glow: rgba(248, 113, 113, 0.3);
    --gold: #fbbf24;

    --surface-base: #0c0a06;
    --surface-card: #14100a;
    --surface-raised: #1a1610;
    --surface-overlay: #221e16;

    --text-primary: #f0e8d0;
    --text-secondary: #a09478;
    --text-muted: #706450;

    --border-subtle: rgba(180, 150, 80, 0.1);
    --border-interactive: rgba(180, 150, 80, 0.2);

    position: relative;
    min-height: 100dvh;
    padding: 1.5rem;
    padding-bottom: 6rem;
    background: var(--surface-base);
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    color: var(--text-primary);
    overflow-x: hidden;
  }

  /* ── Crystal Lattice Background ─────────────────────────────────────────── */
  .lattice-bg {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background:
      radial-gradient(ellipse at 20% 30%, rgba(46, 196, 166, 0.04) 0%, transparent 50%),
      radial-gradient(ellipse at 80% 60%, rgba(232, 185, 74, 0.03) 0%, transparent 50%);
  }

  .lattice-bg::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(
        30deg,
        transparent 49.5%,
        rgba(46, 196, 166, 0.012) 49.5%,
        rgba(46, 196, 166, 0.012) 50.5%,
        transparent 50.5%
      ),
      linear-gradient(
        150deg,
        transparent 49.5%,
        rgba(232, 185, 74, 0.008) 49.5%,
        rgba(232, 185, 74, 0.008) 50.5%,
        transparent 50.5%
      );
    background-size: 100px 100px;
  }

  /* ── Page Header ────────────────────────────────────────────────────────── */
  .page-header {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 2rem;
    flex-wrap: wrap;
  }

  .page-title {
    font-family: var(--font-display);
    font-size: 1.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    background: linear-gradient(135deg, var(--cyan) 0%, var(--amethyst) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin: 0;
    line-height: 1.2;
  }

  .page-subtitle {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0.25rem 0 0;
    font-weight: 400;
    letter-spacing: 0.04em;
  }

  /* ── Connect Button ─────────────────────────────────────────────────────── */
  .connect-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 1.15rem;
    background: linear-gradient(135deg, var(--cyan-dim), rgba(46, 196, 166, 0.18));
    border: 1px solid rgba(46, 196, 166, 0.3);
    border-radius: 10px;
    color: var(--cyan);
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.25s;
    letter-spacing: 0.02em;
  }

  .connect-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, rgba(46, 196, 166, 0.22), rgba(46, 196, 166, 0.12));
    border-color: rgba(46, 196, 166, 0.5);
    box-shadow: 0 0 24px var(--cyan-glow);
    transform: translateY(-1px);
  }

  .connect-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .btn-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spinner 0.6s linear infinite;
  }

  @keyframes spinner {
    to {
      transform: rotate(360deg);
    }
  }

  /* ── Feedback Toast ─────────────────────────────────────────────────────── */
  .feedback-toast {
    position: relative;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-radius: 12px;
    margin-bottom: 1.5rem;
    animation: toast-in 0.3s ease-out;
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
  }

  .feedback-success {
    background: rgba(52, 211, 153, 0.1);
    border: 1px solid rgba(52, 211, 153, 0.25);
    color: var(--emerald);
  }

  .feedback-error {
    background: rgba(248, 113, 113, 0.1);
    border: 1px solid rgba(248, 113, 113, 0.25);
    color: var(--ruby);
  }

  .feedback-content {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .feedback-icon {
    flex-shrink: 0;
  }

  .feedback-dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    opacity: 0.6;
    border-radius: 6px;
    transition: opacity 0.2s;
    flex-shrink: 0;
  }

  .feedback-dismiss:hover {
    opacity: 1;
  }

  /* ── Loading State ──────────────────────────────────────────────────────── */
  .loading-state {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 6rem 2rem;
    gap: 1.5rem;
  }

  .crystal-loader {
    display: flex;
    gap: 0.4rem;
    align-items: flex-end;
  }

  .loader-shard {
    width: 6px;
    background: var(--cyan);
    border-radius: 3px;
    animation: shard-grow 1.2s ease-in-out infinite;
  }

  .loader-shard:nth-child(1) {
    height: 16px;
    animation-delay: 0s;
  }
  .loader-shard:nth-child(2) {
    height: 24px;
    animation-delay: 0.15s;
    background: var(--amethyst);
  }
  .loader-shard:nth-child(3) {
    height: 20px;
    animation-delay: 0.3s;
  }
  .loader-shard:nth-child(4) {
    height: 14px;
    animation-delay: 0.45s;
    background: var(--amethyst);
  }

  @keyframes shard-grow {
    0%,
    100% {
      transform: scaleY(0.6);
      opacity: 0.4;
    }
    50% {
      transform: scaleY(1.2);
      opacity: 1;
    }
  }

  .loading-text {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-style: italic;
    letter-spacing: 0.03em;
  }

  /* ── Empty State ────────────────────────────────────────────────────────── */
  .empty-state {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 4rem 2rem;
    gap: 1rem;
  }

  .empty-crystal {
    margin-bottom: 0.5rem;
    animation: crystal-float 5s ease-in-out infinite;
  }

  @keyframes crystal-float {
    0%,
    100% {
      transform: translateY(0) rotate(0deg);
    }
    33% {
      transform: translateY(-6px) rotate(1deg);
    }
    66% {
      transform: translateY(-3px) rotate(-1deg);
    }
  }

  .empty-title {
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: 0.04em;
  }

  .empty-desc {
    font-size: 0.9rem;
    color: var(--text-secondary);
    max-width: 360px;
    line-height: 1.6;
    margin: 0;
  }

  .empty-config-hint {
    font-size: 0.8rem;
    color: var(--gold);
    margin: 0;
    opacity: 0.8;
  }

  .empty-cta {
    margin-top: 0.75rem;
    padding: 0.65rem 1.5rem;
    font-size: 0.9rem;
  }

  /* ── Totals Summary Bar ─────────────────────────────────────────────────── */
  .totals-bar {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    padding: 1.25rem 1.5rem;
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: 16px;
    margin-bottom: 2rem;
    flex-wrap: wrap;
    overflow: hidden;
  }

  .totals-bar::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      135deg,
      rgba(46, 196, 166, 0.03) 0%,
      transparent 40%,
      rgba(232, 185, 74, 0.03) 100%
    );
    pointer-events: none;
  }

  .total-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    min-width: 100px;
  }

  .total-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    font-weight: 500;
  }

  .total-value {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .total-value.assets {
    color: var(--emerald);
  }

  .total-value.liabilities {
    color: var(--ruby);
  }

  .total-value.positive {
    color: var(--cyan);
  }

  .total-value.negative {
    color: var(--ruby);
  }

  .net-sign {
    font-size: 0.7rem;
    font-weight: 400;
    opacity: 0.7;
    margin-left: 0.25rem;
  }

  .total-divider {
    width: 1px;
    height: 36px;
    background: var(--border-subtle);
    flex-shrink: 0;
  }

  /* ── Institution Groups ─────────────────────────────────────────────────── */
  .institutions-list {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .institution-group {
    animation: group-enter 0.4s ease-out both;
    animation-delay: var(--group-delay);
  }

  @keyframes group-enter {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }

  /* ── Institution Header ─────────────────────────────────────────────────── */
  .institution-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: 14px 14px 4px 4px;
    flex-wrap: wrap;
  }

  .inst-info {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .inst-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    color: var(--amethyst);
  }

  .inst-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .inst-name {
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: 0.03em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inst-sync {
    font-size: 0.72rem;
    color: var(--text-muted);
    letter-spacing: 0.02em;
  }

  .inst-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  /* ── Status Badge ───────────────────────────────────────────────────────── */
  .status-badge {
    font-size: 0.68rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.25rem 0.6rem;
    border-radius: 6px;
  }

  .status-connected {
    background: rgba(52, 211, 153, 0.12);
    color: var(--emerald);
    border: 1px solid rgba(52, 211, 153, 0.2);
  }

  .status-disconnected {
    background: rgba(251, 191, 36, 0.1);
    color: var(--gold);
    border: 1px solid rgba(251, 191, 36, 0.2);
  }

  .status-error {
    background: rgba(248, 113, 113, 0.1);
    color: var(--ruby);
    border: 1px solid rgba(248, 113, 113, 0.2);
  }

  /* ── Disconnect Button ──────────────────────────────────────────────────── */
  .sync-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
  }

  .sync-btn:hover {
    background: rgba(212, 160, 57, 0.08);
    border-color: rgba(212, 160, 57, 0.2);
    color: var(--gold);
  }

  .sync-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .disconnect-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
  }

  .disconnect-btn:hover {
    background: rgba(248, 113, 113, 0.08);
    border-color: rgba(248, 113, 113, 0.2);
    color: var(--ruby);
  }

  .disconnect-confirm {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .btn-danger-sm {
    padding: 0.3rem 0.7rem;
    background: rgba(248, 113, 113, 0.12);
    border: 1px solid rgba(248, 113, 113, 0.3);
    border-radius: 6px;
    color: var(--ruby);
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-danger-sm:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.2);
  }

  .btn-danger-sm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-ghost-sm {
    padding: 0.3rem 0.6rem;
    background: transparent;
    border: 1px solid var(--border-interactive);
    border-radius: 6px;
    color: var(--text-secondary);
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-ghost-sm:hover {
    background: var(--surface-raised);
  }

  /* ── Accounts List ──────────────────────────────────────────────────────── */
  .accounts-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .account-card {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 1rem 1.25rem;
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-top: none;
    transition:
      background 0.2s ease,
      transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
      box-shadow 0.3s ease;
    animation: acct-enter 0.35s ease-out both;
    animation-delay: var(--acct-delay);
  }

  .account-card::before {
    content: '';
    position: absolute;
    left: 0;
    top: 20%;
    bottom: 20%;
    width: 2px;
    background: linear-gradient(180deg, var(--cyan, #2ec4a6), var(--acct-amethyst, #e8b94a));
    border-radius: 2px;
    opacity: 0.4;
    transition:
      opacity 0.3s ease,
      box-shadow 0.3s ease;
  }

  .account-card:hover::before {
    opacity: 0.8;
    box-shadow: 0 0 8px rgba(46, 196, 166, 0.3);
  }

  @keyframes acct-enter {
    from {
      opacity: 0;
    }
  }

  .account-card:last-child {
    border-radius: 0 0 14px 14px;
  }

  .account-card:hover {
    background: var(--surface-raised);
    transform: translateY(-2px);
    box-shadow:
      0 8px 24px rgba(0, 0, 0, 0.3),
      0 0 20px rgba(46, 196, 166, 0.06);
  }

  .account-card.hidden-account {
    opacity: 0.5;
  }

  /* ── Account Type Icon ──────────────────────────────────────────────────── */
  .acct-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    flex-shrink: 0;
    border: 1px solid var(--border-subtle);
  }

  .acct-icon-checking {
    background: rgba(46, 196, 166, 0.08);
    color: var(--cyan);
  }

  .acct-icon-savings {
    background: rgba(52, 211, 153, 0.08);
    color: var(--emerald);
  }

  .acct-icon-credit {
    background: rgba(232, 185, 74, 0.08);
    color: var(--amethyst);
  }

  /* ── Account Info ───────────────────────────────────────────────────────── */
  .acct-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .acct-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .acct-name {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .acct-name.muted {
    color: var(--text-muted);
  }

  .acct-last4 {
    font-weight: 400;
    color: var(--text-muted);
    font-size: 0.8rem;
    margin-left: 0.15rem;
    font-variant-numeric: tabular-nums;
  }

  .acct-last4::before {
    content: '\2022\2022\2022\2022';
    font-size: 0.5rem;
    vertical-align: middle;
    margin-right: 0.15rem;
    letter-spacing: 0.05em;
  }

  .acct-type-badge {
    font-size: 0.65rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .type-depository {
    background: rgba(46, 196, 166, 0.1);
    color: var(--cyan);
  }

  .type-credit {
    background: rgba(232, 185, 74, 0.1);
    color: var(--amethyst);
  }

  .acct-bottom {
    display: flex;
    align-items: baseline;
    gap: 0.65rem;
  }

  .acct-balance {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .acct-balance.muted {
    color: var(--text-muted);
  }

  .acct-updated {
    font-size: 0.7rem;
    color: var(--text-muted);
    letter-spacing: 0.02em;
  }

  /* ── Hide Toggle ────────────────────────────────────────────────────────── */
  .hide-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
    opacity: 0.4;
  }

  .account-card:hover .hide-toggle {
    opacity: 1;
  }

  .hide-toggle:hover {
    background: var(--surface-overlay);
    border-color: var(--border-interactive);
    color: var(--text-secondary);
  }

  .hide-toggle.is-hidden {
    opacity: 0.8;
    color: var(--gold);
  }

  .hide-toggle:disabled {
    cursor: not-allowed;
  }

  .toggle-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid transparent;
    border-top-color: var(--text-muted);
    border-radius: 50%;
    animation: spinner 0.6s linear infinite;
  }

  /* ── Responsive ─────────────────────────────────────────────────────────── */
  @media (max-width: 640px) {
    .accounts-page {
      padding: 1rem;
      padding-bottom: 5rem;
    }

    .page-header {
      flex-direction: column;
      gap: 0.75rem;
    }

    .connect-btn {
      align-self: flex-start;
    }

    .page-title {
      font-size: 1.5rem;
    }

    .totals-bar {
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
    }

    .total-divider {
      width: 60px;
      height: 1px;
    }

    .total-value {
      font-size: 1.1rem;
    }

    .institution-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.6rem;
      padding: 0.65rem 0.85rem;
    }

    .inst-actions {
      align-self: flex-end;
    }

    .account-card {
      padding: 0.85rem 0.85rem;
      gap: 0.65rem;
    }

    .acct-icon {
      width: 36px;
      height: 36px;
    }

    .acct-name {
      font-size: 0.85rem;
    }

    .acct-balance {
      font-size: 0.95rem;
    }
  }

  @media (max-width: 480px) {
    .total-item {
      min-width: 70px;
    }

    .total-divider {
      display: none;
    }

    .inst-name {
      font-size: 0.9rem;
    }
  }

  @media (max-width: 380px) {
    .acct-type-badge {
      display: none;
    }

    .connect-btn {
      font-size: 0.8rem;
      padding: 0.45rem 0.85rem;
    }

    .disconnect-confirm {
      flex-direction: column;
    }
  }
</style>
