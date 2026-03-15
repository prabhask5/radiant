<!--
  @fileoverview Profile & settings page.

  Capabilities:
    - View / edit display name and avatar
    - Change email address (with re-verification)
    - Change unlock gate type (PIN length, pattern, etc.)
    - Manage trusted devices (view, revoke)
    - Toggle debug mode
    - Reset local database (destructive — requires confirmation)
-->
<script lang="ts">
  // =============================================================================
  //                               IMPORTS
  // =============================================================================

  import { goto } from '$app/navigation';
  import {
    changeSingleUserGate,
    updateSingleUserProfile,
    getSingleUserInfo,
    changeSingleUserEmail,
    completeSingleUserEmailChange,
    resolveUserId,
    resolveAvatarInitial
  } from 'stellar-drive/auth';
  import { authState } from 'stellar-drive/stores';
  import { isDebugMode, setDebugMode, getDiagnostics } from 'stellar-drive/utils';
  import { resetDatabase } from 'stellar-drive/config';
  import { repairSyncQueue } from 'stellar-drive/engine';
  import { getTrustedDevices, removeTrustedDevice, getCurrentDeviceId } from 'stellar-drive/auth';
  import { isDemoMode, getDemoConfig } from 'stellar-drive/demo';
  import type { TrustedDevice } from 'stellar-drive/types';
  import type { DiagnosticsSnapshot } from 'stellar-drive/types';
  import { onMount, onDestroy } from 'svelte';

  /** Whether the app is in demo mode — shows a simplified read-only profile. */
  const inDemoMode = $derived(isDemoMode());

  // =============================================================================
  //                         COMPONENT STATE
  // =============================================================================

  /* ── Profile form fields ──── */
  let firstName = $state('');
  let lastName = $state('');

  /* ── Gate (6-digit code) change — digit-array approach ──── */
  let oldCodeDigits = $state(['', '', '', '', '', '']);
  let newCodeDigits = $state(['', '', '', '', '', '']);
  let confirmCodeDigits = $state(['', '', '', '', '', '']);

  /** Concatenated old code string → derived from individual digit inputs */
  const oldCode = $derived(oldCodeDigits.join(''));
  /** Concatenated new code string → derived from individual digit inputs */
  const newCode = $derived(newCodeDigits.join(''));
  /** Concatenated confirm code string — must match `newCode` */
  const confirmNewCode = $derived(confirmCodeDigits.join(''));

  /* ── Input element refs for auto-focus advancement ──── */
  let oldCodeInputs: HTMLInputElement[] = $state([]);
  let newCodeInputs: HTMLInputElement[] = $state([]);
  let confirmCodeInputs: HTMLInputElement[] = $state([]);

  /* ── Email change fields ──── */
  let currentEmail = $state('');
  let newEmail = $state('');
  let emailLoading = $state(false);
  let emailError = $state<string | null>(null);
  let emailSuccess = $state<string | null>(null);
  /** Whether the email confirmation modal overlay is visible */
  let showEmailConfirmationModal = $state(false);
  /** Seconds remaining before the user can re-send the confirmation email */
  let emailResendCooldown = $state(0);

  /* ── General UI / feedback state ──── */
  let profileLoading = $state(false);
  let codeLoading = $state(false);
  let profileError = $state<string | null>(null);
  let profileSuccess = $state<string | null>(null);
  let codeError = $state<string | null>(null);
  let codeSuccess = $state<string | null>(null);
  let debugMode = $state(isDebugMode());
  let resetting = $state(false);

  /* ── Demo mode toast ──── */
  let demoToast = $state('');
  let demoToastDismissing = $state(false);
  let demoToastTimer: ReturnType<typeof setTimeout> | null = null;
  let demoToastDismissTimer: ReturnType<typeof setTimeout> | null = null;

  /** Show a temporary toast for blocked demo operations. */
  function showDemoToast(msg: string) {
    demoToast = msg;
    demoToastDismissing = false;
    if (demoToastTimer) clearTimeout(demoToastTimer);
    if (demoToastDismissTimer) clearTimeout(demoToastDismissTimer);
    demoToastTimer = setTimeout(() => {
      demoToastDismissing = true;
      demoToastDismissTimer = setTimeout(() => {
        demoToast = '';
        demoToastDismissing = false;
      }, 300);
    }, 3000);
  }

  /* ── Debug tools loading flags ──── */
  let forceSyncing = $state(false);
  let triggeringSyncManual = $state(false);
  let resettingCursor = $state(false);
  let repairingSyncQueue = $state(false);

  let viewingTombstones = $state(false);
  let cleaningTombstones = $state(false);

  /* ── Trusted devices ──── */
  let trustedDevices = $state<TrustedDevice[]>([]);
  let currentDeviceId = $state('');
  let devicesLoading = $state(true);
  /** ID of the device currently being removed — shows spinner on that row */
  let removingDeviceId = $state<string | null>(null);

  /* ── Diagnostics ──── */
  let diagnostics = $state<DiagnosticsSnapshot | null>(null);
  let diagnosticsLoading = $state(true);
  let diagnosticsInterval: ReturnType<typeof setInterval> | null = null;

  /** Avatar initial derived from auth state */
  const avatarInitial = $derived(
    resolveAvatarInitial($authState?.session, $authState?.offlineProfile, '?')
  );

  // =============================================================================
  //                           LIFECYCLE
  // =============================================================================

  /** Poll diagnostics and update state. */
  async function pollDiagnostics() {
    try {
      diagnostics = await getDiagnostics();
    } catch {
      // Ignore polling errors — stale data is fine
    }
    diagnosticsLoading = false;
  }

  /** Populate form fields from the engine and load trusted devices on mount. */
  onMount(async () => {
    /* In demo mode, populate from mock profile instead of real data */
    if (inDemoMode) {
      const demoConfig = getDemoConfig();
      if (demoConfig) {
        firstName = demoConfig.mockProfile.firstName;
        lastName = demoConfig.mockProfile.lastName;
        currentEmail = demoConfig.mockProfile.email;
      }
      currentDeviceId = 'demo-device';
      trustedDevices = [
        {
          id: 'demo-td-1',
          userId: 'demo-user',
          deviceId: 'demo-device',
          deviceLabel: 'Chrome on macOS',
          trustedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
          lastUsedAt: new Date().toISOString()
        },
        {
          id: 'demo-td-2',
          userId: 'demo-user',
          deviceId: 'demo-device-2',
          deviceLabel: 'Safari on iPhone',
          trustedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
          lastUsedAt: new Date(Date.now() - 2 * 86400000).toISOString()
        }
      ] as TrustedDevice[];
      diagnostics = {
        timestamp: new Date().toISOString(),
        prefix: 'radiant',
        deviceId: 'demo-device',
        sync: {
          status: 'idle' as const,
          totalCycles: 0,
          lastSyncTime: null,
          lastSuccessfulSyncTimestamp: null,
          syncMessage: null,
          recentCycles: [],
          cyclesLastMinute: 0,
          hasHydrated: false,
          schemaValidated: false,
          pendingCount: 0
        },
        egress: {
          sessionStart: new Date().toISOString(),
          totalBytes: 0,
          totalFormatted: '0 B',
          totalRecords: 0,
          byTable: {}
        },
        queue: {
          pendingOperations: 0,
          pendingEntityIds: [],
          byTable: {},
          byOperationType: {},
          oldestPendingTimestamp: null,
          itemsInBackoff: 0
        },
        realtime: {
          connectionState: 'disconnected' as const,
          healthy: false,
          reconnectAttempts: 0,
          lastError: null,
          userId: null,
          deviceId: 'demo-device',
          recentlyProcessedCount: 0,
          operationInProgress: false,
          reconnectScheduled: false
        },
        network: { online: true },
        engine: {
          isTabVisible: true,
          tabHiddenAt: null,
          lockHeld: false,
          lockHeldForMs: null,
          recentlyModifiedCount: 0,
          wasOffline: false,
          authValidatedAfterReconnect: false
        },
        conflicts: { recentHistory: [], totalCount: 0 },
        errors: { lastError: null, lastErrorDetails: null, recentErrors: [] },
        crdt: {
          enabled: false,
          config: null,
          activeDocuments: [],
          activeDocumentCount: 0,
          offline: {
            documentCount: 0,
            maxDocuments: 0,
            totalSizeBytes: 0,
            totalSizeFormatted: '0 B',
            documents: []
          },
          pendingUpdates: [],
          totalPendingUpdates: 0
        },
        config: {
          tableCount: 4,
          tableNames: ['teller_enrollments', 'accounts', 'transactions', 'categories'],
          syncDebounceMs: 500,
          syncIntervalMs: 30000,
          tombstoneMaxAgeDays: 30
        }
      } as DiagnosticsSnapshot;
      devicesLoading = false;
      diagnosticsLoading = false;
      return;
    }

    const info = await getSingleUserInfo();
    if (info) {
      firstName = (info.profile.firstName as string) || '';
      lastName = (info.profile.lastName as string) || '';
      currentEmail = info.email || '';
    }

    // Load trusted devices
    currentDeviceId = getCurrentDeviceId();
    try {
      const userId = resolveUserId($authState?.session, $authState?.offlineProfile);
      if (userId) {
        trustedDevices = await getTrustedDevices(userId);
      }
    } catch {
      // Ignore errors loading devices
    }
    devicesLoading = false;

    // Start diagnostics polling
    pollDiagnostics();
    diagnosticsInterval = setInterval(pollDiagnostics, 3000);
  });

  onDestroy(() => {
    if (diagnosticsInterval) {
      clearInterval(diagnosticsInterval);
      diagnosticsInterval = null;
    }
  });

  // =============================================================================
  //                     DIGIT INPUT HELPERS
  // =============================================================================

  /**
   * Handle single-digit input in a code field.
   * Auto-advances focus to the next input when a digit is entered.
   * @param digits  - Reactive digit array to mutate
   * @param index   - Position in the 6-digit code (0–5)
   * @param event   - Native input event
   * @param inputs  - Array of `<input>` refs for focus management
   */
  function handleDigitInput(
    digits: string[],
    index: number,
    event: Event,
    inputs: HTMLInputElement[]
  ) {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/[^0-9]/g, '');
    if (value.length > 0) {
      digits[index] = value.charAt(value.length - 1);
      input.value = digits[index];
      if (index < 5 && inputs[index + 1]) {
        inputs[index + 1].focus();
      }
    } else {
      digits[index] = '';
    }
  }

  /**
   * Handle Backspace in a digit field — moves focus backward when the current
   * digit is already empty.
   * @param digits  - Reactive digit array to mutate
   * @param index   - Position in the 6-digit code (0–5)
   * @param event   - Native keyboard event
   * @param inputs  - Array of `<input>` refs for focus management
   */
  function handleDigitKeydown(
    digits: string[],
    index: number,
    event: KeyboardEvent,
    inputs: HTMLInputElement[]
  ) {
    if (event.key === 'Backspace') {
      if (digits[index] === '' && index > 0 && inputs[index - 1]) {
        inputs[index - 1].focus();
        digits[index - 1] = '';
      } else {
        digits[index] = '';
      }
    }
  }

  /**
   * Handle paste into a digit field — distributes pasted digits across all 6 inputs.
   * @param digits  - Reactive digit array to mutate
   * @param event   - Native clipboard event
   * @param inputs  - Array of `<input>` refs for focus management
   */
  function handleDigitPaste(digits: string[], event: ClipboardEvent, inputs: HTMLInputElement[]) {
    event.preventDefault();
    const pasted = (event.clipboardData?.getData('text') || '').replace(/[^0-9]/g, '');
    for (let i = 0; i < 6 && i < pasted.length; i++) {
      digits[i] = pasted[i];
      if (inputs[i]) inputs[i].value = pasted[i];
    }
    const focusIndex = Math.min(pasted.length, 5);
    if (inputs[focusIndex]) inputs[focusIndex].focus();
  }

  // =============================================================================
  //                      FORM SUBMISSION HANDLERS
  // =============================================================================

  /**
   * Submit profile name changes to the engine and update the auth store
   * so the navbar reflects changes immediately.
   * @param e - Form submit event
   */
  async function handleProfileSubmit(e: Event) {
    e.preventDefault();
    if (inDemoMode) {
      showDemoToast('Not available in demo mode');
      return;
    }
    profileLoading = true;
    profileError = null;
    profileSuccess = null;

    try {
      const result = await updateSingleUserProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim()
      });
      if (result.error) {
        profileError = result.error;
      } else {
        // Update auth state to immediately reflect changes in navbar
        authState.updateUserProfile({ first_name: firstName.trim(), last_name: lastName.trim() });
        profileSuccess = 'Profile updated successfully';
        setTimeout(() => (profileSuccess = null), 3000);
      }
    } catch (err: unknown) {
      profileError = err instanceof Error ? err.message : 'Failed to update profile';
    }

    profileLoading = false;
  }

  /**
   * Validate and submit a 6-digit gate code change.
   * Resets all digit arrays on success.
   * @param e - Form submit event
   */
  async function handleCodeSubmit(e: Event) {
    e.preventDefault();
    if (inDemoMode) {
      showDemoToast('Not available in demo mode');
      return;
    }

    if (oldCode.length !== 6) {
      codeError = 'Please enter your current 6-digit code';
      return;
    }

    if (newCode.length !== 6) {
      codeError = 'Please enter a new 6-digit code';
      return;
    }

    if (newCode !== confirmNewCode) {
      codeError = 'New codes do not match';
      return;
    }

    codeLoading = true;
    codeError = null;
    codeSuccess = null;

    try {
      const result = await changeSingleUserGate(oldCode, newCode);
      if (result.error) {
        codeError = result.error;
      } else {
        codeSuccess = 'Code changed successfully';
        oldCodeDigits = ['', '', '', '', '', ''];
        newCodeDigits = ['', '', '', '', '', ''];
        confirmCodeDigits = ['', '', '', '', '', ''];
        setTimeout(() => (codeSuccess = null), 3000);
      }
    } catch (err: unknown) {
      codeError = err instanceof Error ? err.message : 'Failed to change code';
    }

    codeLoading = false;
  }

  // =============================================================================
  //                      EMAIL CHANGE FLOW
  // =============================================================================

  /**
   * Initiate an email change — sends a confirmation link to the new address.
   * Opens the confirmation modal and starts listening for the cross-tab
   * `BroadcastChannel` auth event.
   * @param e - Form submit event
   */
  async function handleEmailSubmit(e: Event) {
    e.preventDefault();
    if (inDemoMode) {
      showDemoToast('Not available in demo mode');
      return;
    }
    emailError = null;
    emailSuccess = null;

    if (!newEmail.trim()) {
      emailError = 'Please enter a new email address';
      return;
    }

    if (newEmail.trim() === currentEmail) {
      emailError = 'New email is the same as your current email';
      return;
    }

    emailLoading = true;

    try {
      const result = await changeSingleUserEmail(newEmail.trim());
      if (result.error) {
        emailError = result.error;
      } else if (result.confirmationRequired) {
        showEmailConfirmationModal = true;
        startResendCooldown();
        listenForEmailConfirmation();
      }
    } catch (err: unknown) {
      emailError = err instanceof Error ? err.message : 'Failed to change email';
    }

    emailLoading = false;
  }

  /** Start a 30-second countdown preventing repeated confirmation emails. */
  function startResendCooldown() {
    emailResendCooldown = 30;
    const interval = setInterval(() => {
      emailResendCooldown--;
      if (emailResendCooldown <= 0) clearInterval(interval);
    }, 1000);
  }

  /** Re-send the email change confirmation (guarded by cooldown). */
  async function handleResendEmailChange() {
    if (emailResendCooldown > 0) return;
    try {
      await changeSingleUserEmail(newEmail.trim());
      startResendCooldown();
    } catch {
      // Ignore resend errors
    }
  }

  /**
   * Listen on a `BroadcastChannel` for the confirmation tab to signal
   * that the user clicked the email-change link. Once received, complete
   * the email change server-side and update local state.
   */
  function listenForEmailConfirmation() {
    if (!('BroadcastChannel' in window)) return;
    const channel = new BroadcastChannel('radiant-auth-channel');
    channel.onmessage = async (event) => {
      if (
        event.data?.type === 'AUTH_CONFIRMED' &&
        event.data?.verificationType === 'email_change'
      ) {
        // Bring this tab to the foreground before the confirm tab closes
        window.focus();
        const result = await completeSingleUserEmailChange();
        if (!result.error && result.newEmail) {
          currentEmail = result.newEmail;
          emailSuccess = 'Email changed successfully';
          newEmail = '';
          setTimeout(() => (emailSuccess = null), 5000);
        } else {
          emailError = result.error || 'Failed to complete email change';
        }
        showEmailConfirmationModal = false;
        channel.close();
      }
    };
  }

  /** Close the email confirmation modal without completing the change. */
  function dismissEmailModal() {
    showEmailConfirmationModal = false;
  }

  // =============================================================================
  //                     ADMINISTRATION HANDLERS
  // =============================================================================

  /** Toggle debug mode on/off — requires a page refresh to take full effect. */
  function toggleDebugMode() {
    debugMode = !debugMode;
    setDebugMode(debugMode);
  }

  /** Navigate back to the home view. */
  function goBack() {
    goto('/');
  }

  /**
   * Delete and recreate the local IndexedDB, then reload the page.
   * Session is preserved in localStorage so the app will re-hydrate.
   */
  async function handleResetDatabase() {
    if (inDemoMode) {
      showDemoToast('Not available in demo mode');
      return;
    }
    if (
      !confirm(
        'This will delete all local data and reload. Your data will be re-synced from the server. Continue?'
      )
    ) {
      return;
    }
    resetting = true;
    try {
      await resetDatabase();
      // Reload the page — session is preserved in localStorage, so the app
      // will re-create the DB, fetch config from Supabase, and re-hydrate.
      window.location.reload();
    } catch (err) {
      alert('Reset failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
      resetting = false;
    }
  }

  /**
   * Remove a trusted device by ID and update the local list.
   * @param id - Database ID of the trusted device row
   */
  async function handleRemoveDevice(id: string) {
    if (inDemoMode) {
      showDemoToast('Not available in demo mode');
      return;
    }
    removingDeviceId = id;
    try {
      await removeTrustedDevice(id);
      trustedDevices = trustedDevices.filter((d) => d.id !== id);
    } catch {
      // Ignore errors
    }
    removingDeviceId = null;
  }

  // =============================================================================
  //                     DEBUG TOOL HANDLERS
  // =============================================================================

  /**
   * Cast `window` to an untyped record for accessing runtime-injected
   * debug helpers (e.g., `__radiantSync`, `__radiantDiagnostics`).
   * @returns The global `window` as a loose `Record`
   */
  function getDebugWindow(): Record<string, unknown> {
    return window as unknown as Record<string, unknown>;
  }

  /** Resets the sync cursor and re-downloads all data from Supabase. */
  async function handleForceFullSync() {
    if (inDemoMode) {
      showDemoToast('Not available in demo mode');
      return;
    }
    if (
      !confirm(
        'This will reset the sync cursor and re-download all data from the server. Continue?'
      )
    )
      return;
    forceSyncing = true;
    try {
      const fn = getDebugWindow().__radiantSync as
        | { forceFullSync: () => Promise<void> }
        | undefined;
      if (fn?.forceFullSync) {
        await fn.forceFullSync();
        alert('Force full sync complete.');
      } else {
        alert('Debug mode must be enabled and the page refreshed to use this tool.');
      }
    } catch (err) {
      alert('Force full sync failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
    forceSyncing = false;
  }

  /** Manually trigger a single push/pull sync cycle. */
  async function handleTriggerSync() {
    if (inDemoMode) {
      showDemoToast('Not available in demo mode');
      return;
    }
    triggeringSyncManual = true;
    try {
      const fn = getDebugWindow().__radiantSync as { sync: () => Promise<void> } | undefined;
      if (fn?.sync) {
        await fn.sync();
        alert('Sync cycle complete.');
      } else {
        alert('Debug mode must be enabled and the page refreshed to use this tool.');
      }
    } catch (err) {
      alert('Sync failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
    triggeringSyncManual = false;
  }

  /** Reset the sync cursor so the next cycle pulls all remote data. */
  async function handleResetSyncCursor() {
    if (inDemoMode) {
      showDemoToast('Not available in demo mode');
      return;
    }
    resettingCursor = true;
    try {
      const fn = getDebugWindow().__radiantSync as
        | { resetSyncCursor: () => Promise<void> }
        | undefined;
      if (fn?.resetSyncCursor) {
        await fn.resetSyncCursor();
        alert('Sync cursor reset. The next sync will pull all data.');
      } else {
        alert('Debug mode must be enabled and the page refreshed to use this tool.');
      }
    } catch (err) {
      alert('Reset cursor failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
    resettingCursor = false;
  }

  /** Log soft-deleted record counts per table to the browser console. */
  async function handleViewTombstones() {
    if (inDemoMode) {
      showDemoToast('Not available in demo mode');
      return;
    }
    viewingTombstones = true;
    try {
      const fn = getDebugWindow().__radiantTombstones as
        | ((opts?: { cleanup?: boolean; force?: boolean }) => Promise<void>)
        | undefined;
      if (fn) {
        await fn();
        alert('Tombstone details logged to console. Open DevTools to view.');
      } else {
        alert('Debug mode must be enabled and the page refreshed to use this tool.');
      }
    } catch (err) {
      alert('View tombstones failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
    viewingTombstones = false;
  }

  /** Permanently remove old soft-deleted records from local + remote DBs. */
  async function handleCleanupTombstones() {
    if (inDemoMode) {
      showDemoToast('Not available in demo mode');
      return;
    }
    if (
      !confirm(
        'This will permanently remove old soft-deleted records from local and server databases. Continue?'
      )
    )
      return;
    cleaningTombstones = true;
    try {
      const fn = getDebugWindow().__radiantTombstones as
        | ((opts?: { cleanup?: boolean; force?: boolean }) => Promise<void>)
        | undefined;
      if (fn) {
        await fn({ cleanup: true });
        alert('Tombstone cleanup complete. Details logged to console.');
      } else {
        alert('Debug mode must be enabled and the page refreshed to use this tool.');
      }
    } catch (err) {
      alert('Tombstone cleanup failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
    cleaningTombstones = false;
  }

  /** Scan IndexedDB for records missing from the sync queue and re-queue them. */
  async function handleRepairSyncQueue() {
    if (inDemoMode) {
      showDemoToast('Not available in demo mode');
      return;
    }
    if (
      !confirm(
        'This will scan all local records and re-queue any that are missing from the sync queue. Continue?'
      )
    )
      return;
    repairingSyncQueue = true;
    try {
      const count = await repairSyncQueue();
      alert(`Repair complete. Re-queued ${count} record${count === 1 ? '' : 's'}.`);
    } catch (err) {
      alert('Repair failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
    repairingSyncQueue = false;
  }

  // =============================================================================
  //                     DIAGNOSTICS HELPERS
  // =============================================================================

  /** Map sync status to a human-readable label. */
  function formatSyncStatus(status: string): string {
    const map: Record<string, string> = {
      idle: 'Idle',
      syncing: 'Syncing',
      error: 'Error',
      offline: 'Offline'
    };
    return map[status] || status;
  }

  /** Map sync status to a CSS color class suffix. */
  function getStatusColor(status: string): string {
    const map: Record<string, string> = {
      idle: 'green',
      syncing: 'gold',
      error: 'red',
      offline: 'yellow'
    };
    return map[status] || 'gray';
  }

  /** Format an ISO timestamp to a relative "X ago" string. */
  function formatTimestamp(iso: string | null | undefined): string {
    if (!iso) return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 5000) return 'just now';
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  }

  /** Format milliseconds to a compact duration string. */
  function formatDuration(ms: number | null | undefined): string {
    if (!ms) return '\u2014';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  /** Dispatch a custom event that the app shell listens for to sign out on mobile. */
  function handleMobileSignOut() {
    if (inDemoMode) {
      showDemoToast('Not available in demo mode');
      return;
    }
    window.dispatchEvent(new CustomEvent('radiant:signout'));
  }
</script>

<svelte:head>
  <title>Profile - Radiant Finance</title>
</svelte:head>

<!-- ================================================================= -->
<!--                        PROFILE PAGE                               -->
<!-- ================================================================= -->
<div class="profile-page">
  <!-- ── Header ── -->
  <header class="profile-header">
    <button class="header-back" onclick={goBack} type="button" aria-label="Go back">
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
        <polyline points="15 18 9 12 15 6" />
      </svg>
    </button>
    <h1 class="header-title">Profile</h1>
    <div class="header-spacer"></div>
  </header>

  <!-- ── Avatar ── -->
  <div class="avatar-section">
    <div class="avatar-circle">
      {avatarInitial}
    </div>
    <p class="avatar-name">{firstName}{lastName ? ` ${lastName}` : ''}</p>
    <p class="avatar-email">{currentEmail}</p>
  </div>

  <div class="cards-container">
    <!-- ================================================================= -->
    <!--                      PROFILE CARD                                 -->
    <!-- ================================================================= -->
    <section class="settings-card">
      <h2 class="card-heading">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        Display Name
      </h2>
      <form onsubmit={handleProfileSubmit}>
        <div class="field-row">
          <div class="field-group">
            <label class="field-label" for="profile-first">First name</label>
            <input
              id="profile-first"
              type="text"
              class="field-input"
              bind:value={firstName}
              disabled={profileLoading}
            />
          </div>
          <div class="field-group">
            <label class="field-label" for="profile-last">Last name</label>
            <input
              id="profile-last"
              type="text"
              class="field-input"
              bind:value={lastName}
              disabled={profileLoading}
            />
          </div>
        </div>
        {#if profileError}
          <p class="msg msg-error">{profileError}</p>
        {/if}
        {#if profileSuccess}
          <p class="msg msg-success">{profileSuccess}</p>
        {/if}
        <button class="btn-action" type="submit" disabled={profileLoading}>
          {#if profileLoading}<span class="spinner"></span>{/if}
          Save Changes
        </button>
      </form>
    </section>

    <!-- ================================================================= -->
    <!--                       EMAIL CARD                                  -->
    <!-- ================================================================= -->
    <section class="settings-card">
      <h2 class="card-heading">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
        Email Address
      </h2>
      <div class="current-email-row">
        <span class="current-label">Current</span>
        <span class="current-value">{currentEmail || '—'}</span>
      </div>
      <form onsubmit={handleEmailSubmit}>
        <div class="field-group" style="margin-bottom: 12px">
          <label class="field-label" for="new-email">New email</label>
          <input
            id="new-email"
            type="email"
            class="field-input"
            placeholder="new@example.com"
            bind:value={newEmail}
            disabled={emailLoading}
          />
        </div>
        {#if emailError}
          <p class="msg msg-error">{emailError}</p>
        {/if}
        {#if emailSuccess}
          <p class="msg msg-success">{emailSuccess}</p>
        {/if}
        <button class="btn-action" type="submit" disabled={emailLoading || !newEmail.trim()}>
          {#if emailLoading}<span class="spinner"></span>{/if}
          Change Email
        </button>
      </form>
    </section>

    <!-- ================================================================= -->
    <!--                     SECURITY CARD (Change PIN)                    -->
    <!-- ================================================================= -->
    <section class="settings-card">
      <h2 class="card-heading">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        Change Code
      </h2>
      <form onsubmit={handleCodeSubmit}>
        <div class="pin-group">
          <span class="pin-group-label" id="pin-label-current">Current Code</span>
          <div class="pin-row" role="group" aria-labelledby="pin-label-current">
            {#each oldCodeDigits as _, i (i)}
              <input
                type="tel"
                inputmode="numeric"
                maxlength="1"
                class="pin-digit"
                aria-label={`Current Code digit ${i + 1}`}
                bind:this={oldCodeInputs[i]}
                oninput={(e) => handleDigitInput(oldCodeDigits, i, e, oldCodeInputs)}
                onkeydown={(e) => handleDigitKeydown(oldCodeDigits, i, e, oldCodeInputs)}
                onpaste={(e) => handleDigitPaste(oldCodeDigits, e, oldCodeInputs)}
                disabled={codeLoading}
              />
            {/each}
          </div>
        </div>

        <div class="pin-group">
          <span class="pin-group-label" id="pin-label-new">New Code</span>
          <div class="pin-row" role="group" aria-labelledby="pin-label-new">
            {#each newCodeDigits as _, i (i)}
              <input
                type="tel"
                inputmode="numeric"
                maxlength="1"
                class="pin-digit"
                aria-label={`New Code digit ${i + 1}`}
                bind:this={newCodeInputs[i]}
                oninput={(e) => handleDigitInput(newCodeDigits, i, e, newCodeInputs)}
                onkeydown={(e) => handleDigitKeydown(newCodeDigits, i, e, newCodeInputs)}
                onpaste={(e) => handleDigitPaste(newCodeDigits, e, newCodeInputs)}
                disabled={codeLoading}
              />
            {/each}
          </div>
        </div>

        <div class="pin-group">
          <span class="pin-group-label" id="pin-label-confirm">Confirm New Code</span>
          <div class="pin-row" role="group" aria-labelledby="pin-label-confirm">
            {#each confirmCodeDigits as _, i (i)}
              <input
                type="tel"
                inputmode="numeric"
                maxlength="1"
                class="pin-digit"
                aria-label={`Confirm Code digit ${i + 1}`}
                bind:this={confirmCodeInputs[i]}
                oninput={(e) => handleDigitInput(confirmCodeDigits, i, e, confirmCodeInputs)}
                onkeydown={(e) => handleDigitKeydown(confirmCodeDigits, i, e, confirmCodeInputs)}
                onpaste={(e) => handleDigitPaste(confirmCodeDigits, e, confirmCodeInputs)}
                disabled={codeLoading}
              />
            {/each}
          </div>
        </div>

        {#if codeError}
          <p class="msg msg-error">{codeError}</p>
        {/if}
        {#if codeSuccess}
          <p class="msg msg-success">{codeSuccess}</p>
        {/if}
        <button class="btn-action" type="submit" disabled={codeLoading}>
          {#if codeLoading}<span class="spinner"></span>{/if}
          Update Code
        </button>
      </form>
    </section>

    <!-- ================================================================= -->
    <!--                   TRUSTED DEVICES CARD                            -->
    <!-- ================================================================= -->
    <section class="settings-card">
      <h2 class="card-heading">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
        Trusted Devices
      </h2>
      {#if devicesLoading}
        <div class="devices-loading">
          <span class="spinner"></span>
          <span>Loading devices...</span>
        </div>
      {:else if trustedDevices.length === 0}
        <p class="devices-empty">No trusted devices found.</p>
      {:else}
        <ul class="device-list">
          {#each trustedDevices as device (device.id)}
            <li class="device-row" class:current={device.deviceId === currentDeviceId}>
              <div class="device-info">
                <span class="device-name">
                  {device.deviceLabel || 'Unknown Device'}
                  {#if device.deviceId === currentDeviceId}
                    <span class="device-badge">This device</span>
                  {/if}
                </span>
                <span class="device-meta">
                  Last seen {new Date(device.lastUsedAt).toLocaleDateString()}
                </span>
              </div>
              {#if device.deviceId !== currentDeviceId}
                <button
                  class="device-remove"
                  onclick={() => handleRemoveDevice(device.id)}
                  disabled={removingDeviceId === device.id}
                  aria-label="Remove device"
                >
                  {#if removingDeviceId === device.id}
                    <span class="spinner"></span>
                  {:else}
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
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  {/if}
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- ================================================================= -->
    <!--                   SETTINGS CARD                                   -->
    <!-- ================================================================= -->
    <section class="settings-card compact">
      <h2 class="card-heading">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
        Settings
      </h2>
      {#if inDemoMode}
        <button
          class="btn-action setup-link"
          onclick={() => showDemoToast('Not available in demo mode')}>Update Configuration</button
        >
      {:else}
        <a href="/setup" class="btn-action setup-link">Update Configuration</a>
      {/if}
    </section>

    <!-- ================================================================= -->
    <!--                   DIAGNOSTICS DASHBOARD                           -->
    <!-- ================================================================= -->
    <section class="settings-card">
      <h2 class="card-heading">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        Diagnostics
      </h2>

      {#if diagnosticsLoading}
        <div class="devices-loading">
          <span class="spinner"></span>
          <span>Loading diagnostics...</span>
        </div>
      {:else if diagnostics}
        <!-- 1. Status Banner -->
        <div class="diag-status-banner">
          <span class="diag-status-dot diag-status-dot--{getStatusColor(diagnostics.sync.status)}"
          ></span>
          <div class="diag-status-info">
            <span class="diag-status-label">{formatSyncStatus(diagnostics.sync.status)}</span>
            <span class="diag-status-meta">
              {diagnostics.network.online ? 'Online' : 'Offline'} &middot; {diagnostics.deviceId.slice(
                0,
                8
              )}
            </span>
          </div>
        </div>

        <!-- 2. Sync Engine -->
        <div class="diag-section-title">Sync Engine</div>
        <div class="diag-grid">
          <div class="diag-stat">
            <span class="diag-stat-value">{diagnostics.sync.totalCycles}</span>
            <span class="diag-stat-label">Total Cycles</span>
          </div>
          <div class="diag-stat">
            <span class="diag-stat-value">{diagnostics.sync.cyclesLastMinute}</span>
            <span class="diag-stat-label">Last Minute</span>
          </div>
          <div class="diag-stat">
            <span class="diag-stat-value">{diagnostics.sync.pendingCount}</span>
            <span class="diag-stat-label">Pending Ops</span>
          </div>
          <div class="diag-stat">
            <span class="diag-stat-value">{formatTimestamp(diagnostics.sync.lastSyncTime)}</span>
            <span class="diag-stat-label">Last Sync</span>
          </div>
        </div>
        <div class="diag-badges">
          <span class="diag-badge-{diagnostics.sync.hasHydrated ? 'ok' : 'warn'}">
            {diagnostics.sync.hasHydrated ? 'Hydrated' : 'Not Hydrated'}
          </span>
          <span class="diag-badge-{diagnostics.sync.schemaValidated ? 'ok' : 'warn'}">
            {diagnostics.sync.schemaValidated ? 'Schema OK' : 'Schema Pending'}
          </span>
        </div>

        <!-- 3. Realtime -->
        <div class="diag-section-title">Realtime</div>
        <div class="diag-row">
          <span class="diag-row-label">Connection</span>
          <span class="diag-row-value">
            <span
              class="diag-inline-dot diag-inline-dot--{diagnostics.realtime.connectionState ===
              'connected'
                ? 'green'
                : diagnostics.realtime.connectionState === 'connecting'
                  ? 'yellow'
                  : 'red'}"
            ></span>
            {diagnostics.realtime.connectionState}
          </span>
        </div>
        <div class="diag-row">
          <span class="diag-row-label">Healthy</span>
          <span class="diag-row-value">{diagnostics.realtime.healthy ? 'Yes' : 'No'}</span>
        </div>
        <div class="diag-row">
          <span class="diag-row-label">Reconnects</span>
          <span class="diag-row-value">{diagnostics.realtime.reconnectAttempts}</span>
        </div>
        <div class="diag-row">
          <span class="diag-row-label">Events Processed</span>
          <span class="diag-row-value">{diagnostics.realtime.recentlyProcessedCount}</span>
        </div>

        <!-- 4. Data Transfer -->
        <div class="diag-section-title">Data Transfer</div>
        <div class="diag-grid-2">
          <div class="diag-stat">
            <span class="diag-stat-value">{diagnostics.egress.totalFormatted}</span>
            <span class="diag-stat-label">Total Egress</span>
          </div>
          <div class="diag-stat">
            <span class="diag-stat-value">{diagnostics.egress.totalRecords.toLocaleString()}</span>
            <span class="diag-stat-label">Records</span>
          </div>
        </div>
        {#if Object.keys(diagnostics.egress.byTable).length > 0}
          <div class="diag-table-bars">
            {#each Object.entries(diagnostics.egress.byTable) as [table, data] (table)}
              <div class="diag-table-row">
                <div class="diag-table-header">
                  <span class="diag-table-name">{table}</span>
                  <span class="diag-table-pct">{data.percentage}</span>
                </div>
                <div class="diag-progress-bar">
                  <div class="diag-progress-fill" style="width: {data.percentage}"></div>
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <!-- 5. Sync Queue -->
        <div class="diag-section-title">Sync Queue</div>
        <div class="diag-grid-2">
          <div class="diag-stat">
            <span class="diag-stat-value">{diagnostics.queue.pendingOperations}</span>
            <span class="diag-stat-label">Pending</span>
          </div>
          <div class="diag-stat">
            <span class="diag-stat-value">{diagnostics.queue.itemsInBackoff}</span>
            <span class="diag-stat-label">In Backoff</span>
          </div>
        </div>
        {#if diagnostics.queue.oldestPendingTimestamp}
          <div class="diag-row">
            <span class="diag-row-label">Oldest Pending</span>
            <span class="diag-row-value"
              >{formatTimestamp(diagnostics.queue.oldestPendingTimestamp)}</span
            >
          </div>
        {/if}

        <!-- 6. Engine -->
        <div class="diag-section-title">Engine</div>
        <div class="diag-row">
          <span class="diag-row-label">Tab Visible</span>
          <span class="diag-row-value">{diagnostics.engine.isTabVisible ? 'Yes' : 'No'}</span>
        </div>
        <div class="diag-row">
          <span class="diag-row-label">Lock Held</span>
          <span class="diag-row-value">
            {diagnostics.engine.lockHeld ? 'Yes' : 'No'}
            {#if diagnostics.engine.lockHeld && diagnostics.engine.lockHeldForMs}
              <span class="diag-lock-duration"
                >({formatDuration(diagnostics.engine.lockHeldForMs)})</span
              >
            {/if}
          </span>
        </div>
        <div class="diag-row">
          <span class="diag-row-label">Recently Modified</span>
          <span class="diag-row-value">{diagnostics.engine.recentlyModifiedCount}</span>
        </div>

        <!-- 7. Recent Cycles -->
        {#if diagnostics.sync.recentCycles.length > 0}
          <div class="diag-section-title">Recent Cycles</div>
          <div class="diag-cycles">
            {#each diagnostics.sync.recentCycles.slice(0, 5) as cycle (cycle.timestamp)}
              <div class="diag-cycle-item">
                <div class="diag-cycle-header">
                  <span class="diag-cycle-trigger">{cycle.trigger}</span>
                  <span class="diag-cycle-time">{formatTimestamp(cycle.timestamp)}</span>
                </div>
                <div class="diag-cycle-stats">
                  <span>{cycle.pushedItems} pushed</span>
                  <span>{cycle.pulledRecords} pulled</span>
                  <span>{formatDuration(cycle.durationMs)}</span>
                </div>
              </div>
            {/each}
          </div>
        {/if}

        <!-- 8. Conflicts -->
        {#if diagnostics.conflicts.totalCount > 0}
          <div class="diag-section-title">Conflicts</div>
          <div class="diag-row">
            <span class="diag-row-label">Total</span>
            <span class="diag-row-value">{diagnostics.conflicts.totalCount}</span>
          </div>
        {/if}

        <!-- 9. Errors -->
        {#if diagnostics.errors.lastError || diagnostics.errors.recentErrors.length > 0}
          <div class="diag-section-title">Errors</div>
          {#if diagnostics.errors.lastError}
            <div class="diag-error-banner">
              {diagnostics.errors.lastError}
            </div>
          {/if}
          {#each diagnostics.errors.recentErrors.slice(0, 3) as err (err.entityId)}
            <div class="diag-error-item">
              <span class="diag-error-table">{err.table}.{err.operation}</span>
              <span class="diag-error-msg">{err.message}</span>
            </div>
          {/each}
        {/if}

        <!-- 10. Configuration -->
        <div class="diag-section-title">Configuration</div>
        <div class="diag-config-tables">
          <div class="diag-config-tables-header">
            <span class="diag-row-label">Tables</span>
            <span class="diag-row-value">{diagnostics.config.tableCount}</span>
          </div>
          <div class="diag-config-table-names">
            {#each diagnostics.config.tableNames as name (name)}
              <span class="diag-table-tag">{name}</span>
            {/each}
          </div>
        </div>
        <div class="diag-row">
          <span class="diag-row-label">Sync Interval</span>
          <span class="diag-row-value">{formatDuration(diagnostics.config.syncIntervalMs)}</span>
        </div>
        <div class="diag-row">
          <span class="diag-row-label">Debounce</span>
          <span class="diag-row-value">{formatDuration(diagnostics.config.syncDebounceMs)}</span>
        </div>

        <!-- 11. Footer -->
        <div class="diag-footer">
          <span class="diag-footer-dot"></span>
          Updated {formatTimestamp(diagnostics.timestamp)}
        </div>
      {/if}
    </section>

    <!-- ================================================================= -->
    <!--                   DIAGNOSTICS CONTROLS                            -->
    <!-- ================================================================= -->
    <section class="settings-card compact">
      <h2 class="card-heading">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
          />
        </svg>
        Controls
      </h2>
      <div class="toggle-row">
        <div class="toggle-info">
          <span class="toggle-label">Debug Mode</span>
          <span class="toggle-hint"
            >Enable console logging for troubleshooting. Refresh the page after toggling for changes
            to take effect.</span
          >
        </div>
        <button
          class="toggle-switch"
          class:on={debugMode}
          onclick={toggleDebugMode}
          role="switch"
          aria-checked={debugMode}
          aria-label="Toggle debug mode"
          type="button"
        >
          <span class="toggle-thumb"></span>
        </button>
      </div>
      <button class="btn-danger-subtle" onclick={handleResetDatabase} disabled={resetting}>
        {#if resetting}<span class="spinner"></span>{/if}
        Reset Local Database
      </button>
    </section>

    <!-- ================================================================= -->
    <!--                   DEBUG TOOLS (when enabled)                       -->
    <!-- ================================================================= -->
    {#if debugMode}
      <section class="settings-card debug-card">
        <h2 class="card-heading debug-heading">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          Debug Tools
        </h2>
        <div class="debug-grid">
          <button class="btn-debug" onclick={handleForceFullSync} disabled={forceSyncing}>
            {#if forceSyncing}<span class="spinner"></span>{:else}Force Sync{/if}
          </button>
          <button class="btn-debug" onclick={handleTriggerSync} disabled={triggeringSyncManual}>
            {#if triggeringSyncManual}<span class="spinner"></span>{:else}Trigger Sync{/if}
          </button>
          <button class="btn-debug" onclick={handleResetSyncCursor} disabled={resettingCursor}>
            {#if resettingCursor}<span class="spinner"></span>{:else}Reset Cursor{/if}
          </button>
          <button class="btn-debug" onclick={handleViewTombstones} disabled={viewingTombstones}>
            {#if viewingTombstones}<span class="spinner"></span>{:else}View Tombstones{/if}
          </button>
          <button class="btn-debug" onclick={handleCleanupTombstones} disabled={cleaningTombstones}>
            {#if cleaningTombstones}<span class="spinner"></span>{:else}Cleanup Tombstones{/if}
          </button>
          <button class="btn-debug" onclick={handleRepairSyncQueue} disabled={repairingSyncQueue}>
            {#if repairingSyncQueue}<span class="spinner"></span>{:else}Repair Sync Queue{/if}
          </button>
        </div>
      </section>
    {/if}

    <!-- ================================================================= -->
    <!--                   SIGN OUT (Mobile)                               -->
    <!-- ================================================================= -->
    <button class="btn-signout" onclick={handleMobileSignOut} type="button">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      Sign Out
    </button>

    <!-- ================================================================= -->
    <!--                   FOOTER                                          -->
    <!-- ================================================================= -->
    <footer class="profile-footer">
      <a href="/policy" class="footer-link">Privacy Policy</a>
    </footer>
  </div>
</div>

<!-- ================================================================= -->
<!--                    DEMO MODE TOAST                                -->
<!-- ================================================================= -->
{#if demoToast}
  <div class="demo-toast" class:dismissing={demoToastDismissing}>{demoToast}</div>
{/if}

<!-- ================================================================= -->
<!--               EMAIL CONFIRMATION MODAL                            -->
<!-- ================================================================= -->
{#if showEmailConfirmationModal}
  <div
    class="modal-backdrop"
    onclick={dismissEmailModal}
    onkeydown={(e) => e.key === 'Escape' && dismissEmailModal()}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-card" onclick={(e) => e.stopPropagation()}>
      <div class="modal-icon">
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      </div>
      <h3 class="modal-title">Confirm Email Change</h3>
      <p class="modal-text">
        We sent a confirmation link to<br />
        <strong>{newEmail}</strong>
      </p>
      <p class="modal-hint">Click the link in the email to complete the change.</p>
      <div class="modal-actions">
        <button
          class="btn-modal"
          onclick={handleResendEmailChange}
          disabled={emailResendCooldown > 0}
        >
          {#if emailResendCooldown > 0}
            Resend in {emailResendCooldown}s
          {:else}
            Resend Email
          {/if}
        </button>
        <button class="btn-modal-dismiss" onclick={dismissEmailModal} type="button">Cancel</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ================================================================= */
  /*                     CSS CUSTOM PROPERTIES                         */
  /* ================================================================= */

  :root {
    --prof-void: #0a0806;
    --prof-surface: rgba(18, 14, 10, 0.88);
    --prof-surface-border: rgba(180, 140, 50, 0.12);
    --prof-gem: #e8b94a;
    --prof-gem-light: #f0d88a;
    --prof-gem-accent: #b8862e;
    --prof-gem-aqua: #2ec4a6;
    --prof-text: #f0e8d0;
    --prof-text-muted: #a09478;
    --prof-text-dim: #706450;
    --prof-error: #fb7185;
    --prof-success: #34d399;
    --prof-radius: 16px;
    --prof-radius-sm: 10px;
  }

  /* ================================================================= */
  /*                     PAGE CONTAINER                                */
  /* ================================================================= */

  .profile-page {
    position: relative;
    background: transparent;
    /* bottom padding handled by layout */
    animation: profileEnter 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  @keyframes profileEnter {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .profile-page::before {
    content: '';
    position: fixed;
    inset: 0;
    background:
      /* Prismatic light band — sweeps diagonally like light refracting through a gem */ linear-gradient(
      135deg,
      transparent 0%,
      rgba(212, 160, 57, 0.04) 20%,
      transparent 35%,
      rgba(46, 196, 166, 0.03) 50%,
      transparent 65%,
      rgba(232, 93, 117, 0.03) 80%,
      transparent 100%
    );
    background-size: 200% 200%;
    z-index: -1;
    pointer-events: none;
    animation: profilePrismSweep 12s ease-in-out infinite alternate;
  }

  @keyframes profilePrismSweep {
    0% {
      background-position: 0% 0%;
    }
    100% {
      background-position: 100% 100%;
    }
  }

  /* ================================================================= */
  /*                     HEADER                                        */
  /* ================================================================= */

  .profile-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px 1rem;
    position: sticky;
    top: 0;
    z-index: 10;
    background: rgba(10, 8, 6, 0.8);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border-bottom: 1px solid rgba(180, 140, 50, 0.06);
  }

  .header-back {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: rgba(232, 185, 74, 0.08);
    border: 1px solid rgba(232, 185, 74, 0.12);
    border-radius: 10px;
    color: var(--prof-gem);
    cursor: pointer;
    transition: background 0.2s ease;
  }

  .header-back:hover {
    background: rgba(232, 185, 74, 0.15);
  }

  .header-title {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--prof-text);
    letter-spacing: -0.01em;
    margin: 0;
  }

  .header-spacer {
    width: 36px;
  }

  /* ================================================================= */
  /*                     AVATAR SECTION                                */
  /* ================================================================= */

  .avatar-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 28px 20px 8px;
  }

  .avatar-circle {
    position: relative;
    overflow: visible;
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--prof-gem-accent), var(--prof-gem));
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 1.5rem;
    font-weight: 700;
    color: #fff;
    letter-spacing: 0.02em;
    box-shadow: 0 0 28px rgba(184, 134, 46, 0.2);
    margin-bottom: 12px;
  }

  .avatar-circle::before {
    content: '';
    position: absolute;
    inset: -10px;
    background: linear-gradient(
      135deg,
      rgba(232, 185, 74, 0.5),
      rgba(46, 196, 166, 0.35),
      rgba(232, 93, 117, 0.3),
      rgba(232, 185, 74, 0.5)
    );
    clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
    opacity: 0.6;
    animation: gemBezelGlow 4s ease-in-out infinite;
  }

  @keyframes gemBezelGlow {
    0%,
    100% {
      opacity: 0.4;
      filter: brightness(1);
    }
    50% {
      opacity: 0.7;
      filter: brightness(1.3);
    }
  }

  .avatar-circle::after {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    background: linear-gradient(
      135deg,
      transparent 0%,
      rgba(232, 185, 74, 0.5) 20%,
      rgba(46, 196, 166, 0.4) 40%,
      transparent 50%,
      rgba(232, 93, 117, 0.4) 70%,
      rgba(245, 158, 11, 0.3) 85%,
      transparent 100%
    );
    background-size: 300% 300%;
    mask: radial-gradient(circle, transparent 78%, black 80%);
    -webkit-mask: radial-gradient(circle, transparent 78%, black 80%);
    animation: gemShimmerSweep 5s ease-in-out infinite;
  }

  @keyframes gemShimmerSweep {
    0% {
      background-position: 100% 100%;
    }
    50% {
      background-position: 0% 0%;
    }
    100% {
      background-position: 100% 100%;
    }
  }

  .avatar-name {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 1.125rem;
    font-weight: 600;
    background: linear-gradient(135deg, var(--prof-text, #f0e8d0), var(--prof-gem-light, #f0d88a));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin: 0 0 4px;
  }

  .avatar-email {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    color: var(--prof-text-muted);
    margin: 0;
  }

  /* ================================================================= */
  /*                     CARDS CONTAINER                               */
  /* ================================================================= */

  .cards-container {
    max-width: 520px;
    margin: 0 auto;
    padding: 20px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* ================================================================= */
  /*                     SETTINGS CARD                                 */
  /* ================================================================= */

  .settings-card {
    position: relative;
    background: var(--prof-surface);
    border: 1px solid var(--prof-surface-border);
    border-radius: var(--prof-radius);
    padding: 24px 20px;
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    transition:
      transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
      box-shadow 0.3s ease,
      border-color 0.3s ease;
  }

  .settings-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 15%;
    right: 15%;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(232, 185, 74, 0.35),
      rgba(255, 255, 255, 0.2),
      rgba(232, 185, 74, 0.35),
      transparent
    );
    border-radius: 1px;
  }

  .settings-card:hover {
    transform: translateY(-2px);
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.3),
      0 0 30px rgba(184, 134, 46, 0.08);
    border-color: rgba(180, 140, 50, 0.2);
  }

  .settings-card.compact {
    padding: 20px;
  }

  .card-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.9375rem;
    font-weight: 600;
    color: var(--prof-text);
    margin: 0 0 20px;
    letter-spacing: -0.01em;
  }

  .card-heading svg {
    color: var(--prof-gem);
    flex-shrink: 0;
  }

  .debug-heading svg {
    color: #fbbf24;
  }

  .debug-card {
    border-color: rgba(251, 191, 36, 0.12);
  }

  /* ================================================================= */
  /*                     FORM FIELDS                                   */
  /* ================================================================= */

  .field-row {
    display: flex;
    gap: 12px;
    margin-bottom: 12px;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex: 1;
  }

  .field-label {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--prof-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .field-input {
    width: 100%;
    padding: 10px 12px;
    background: rgba(10, 10, 26, 0.6);
    border: 1px solid rgba(180, 140, 50, 0.12);
    border-radius: var(--prof-radius-sm);
    color: var(--prof-text);
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.875rem;
    outline: none;
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease;
    box-sizing: border-box;
  }

  .field-input::placeholder {
    color: var(--prof-text-dim);
  }

  .field-input:focus {
    border-color: var(--prof-gem);
    box-shadow: 0 0 0 3px rgba(232, 185, 74, 0.1);
  }

  .field-input:disabled {
    opacity: 0.5;
  }

  /* ── Current email row ── */

  .current-email-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: rgba(10, 10, 26, 0.4);
    border-radius: var(--prof-radius-sm);
    margin-bottom: 16px;
  }

  .current-label {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--prof-text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .current-value {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    color: var(--prof-gem-light);
  }

  /* ================================================================= */
  /*                     PIN INPUTS (Profile)                          */
  /* ================================================================= */

  .pin-group {
    margin-bottom: 16px;
  }

  .pin-group-label {
    display: block;
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--prof-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 8px;
  }

  .pin-row {
    display: flex;
    gap: 6px;
    justify-content: center;
  }

  .pin-digit {
    width: 40px;
    height: 46px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 1.125rem;
    font-weight: 500;
    color: var(--prof-text);
    background: rgba(10, 10, 26, 0.7);
    border: 1.5px solid rgba(180, 140, 50, 0.15);
    border-radius: 8px;
    outline: none;
    caret-color: var(--prof-gem);
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease;
  }

  .pin-digit:focus {
    border-color: var(--prof-gem);
    box-shadow: 0 0 0 3px rgba(232, 185, 74, 0.12);
  }

  .pin-digit:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ================================================================= */
  /*                     BUTTONS                                       */
  /* ================================================================= */

  .btn-action {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 12px 16px;
    margin-top: 4px;
    background: linear-gradient(135deg, var(--prof-gem-accent), var(--prof-gem));
    color: #fff;
    border: none;
    border-radius: var(--prof-radius-sm);
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .btn-action:hover:not(:disabled) {
    transform: translateY(-2px) scale(1.02);
    box-shadow:
      0 8px 24px rgba(184, 134, 46, 0.25),
      0 0 30px rgba(184, 134, 46, 0.12);
  }

  .btn-action:active:not(:disabled) {
    transform: translateY(0) scale(0.98);
  }

  .btn-action:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn-danger-subtle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 10px 16px;
    margin-top: 12px;
    background: rgba(251, 113, 133, 0.06);
    color: var(--prof-error);
    border: 1px solid rgba(251, 113, 133, 0.12);
    border-radius: var(--prof-radius-sm);
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background 0.2s ease,
      border-color 0.2s ease;
  }

  .btn-danger-subtle:hover:not(:disabled) {
    background: rgba(251, 113, 133, 0.12);
    border-color: rgba(251, 113, 133, 0.2);
  }

  .btn-danger-subtle:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-signout {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 14px 20px;
    background: none;
    color: var(--prof-error);
    border: 1px solid rgba(251, 113, 133, 0.15);
    border-radius: var(--prof-radius);
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.9375rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background 0.2s ease,
      border-color 0.2s ease;
  }

  .btn-signout:hover {
    background: rgba(251, 113, 133, 0.06);
    border-color: rgba(251, 113, 133, 0.25);
  }

  /* ── Debug buttons ── */

  .debug-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .btn-debug {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 12px;
    background: rgba(251, 191, 36, 0.06);
    color: #fbbf24;
    border: 1px solid rgba(251, 191, 36, 0.12);
    border-radius: var(--prof-radius-sm);
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
    transition: background 0.2s ease;
  }

  .btn-debug:hover:not(:disabled) {
    background: rgba(251, 191, 36, 0.12);
  }

  .btn-debug:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ================================================================= */
  /*                     TOGGLE SWITCH                                 */
  /* ================================================================= */

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .toggle-label {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.875rem;
    color: var(--prof-text);
  }

  .toggle-hint {
    font-size: 0.72rem;
    color: var(--prof-text-dim);
    line-height: 1.3;
  }

  .toggle-switch {
    position: relative;
    width: 44px;
    height: 24px;
    background: rgba(180, 140, 50, 0.15);
    border: 1px solid rgba(180, 140, 50, 0.2);
    border-radius: 12px;
    cursor: pointer;
    transition:
      background 0.25s ease,
      border-color 0.25s ease;
    padding: 0;
    flex-shrink: 0;
    -webkit-appearance: none;
    appearance: none;
  }

  .toggle-switch.on {
    background: var(--prof-gem-accent);
    border-color: var(--prof-gem);
  }

  .toggle-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    background: #fff;
    border-radius: 50%;
    transition:
      transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1),
      background 0.3s ease,
      box-shadow 0.3s ease;
    pointer-events: none;
  }

  .toggle-switch.on .toggle-thumb {
    transform: translateX(20px);
    box-shadow: 0 0 12px rgba(184, 134, 46, 0.4);
  }

  /* ================================================================= */
  /*                     DEVICE LIST                                   */
  /* ================================================================= */

  .devices-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 16px;
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    color: var(--prof-text-muted);
  }

  .devices-empty {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    color: var(--prof-text-dim);
    text-align: center;
    padding: 12px;
    margin: 0;
  }

  .device-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .device-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    background: rgba(10, 10, 26, 0.35);
    border: 1px solid transparent;
    border-radius: var(--prof-radius-sm);
    transition:
      border-color 0.3s ease,
      box-shadow 0.3s ease;
  }

  .device-row.current {
    border-color: rgba(46, 196, 166, 0.3);
    background: rgba(46, 196, 166, 0.05);
    box-shadow:
      0 0 12px rgba(46, 196, 166, 0.08),
      inset 0 0 12px rgba(46, 196, 166, 0.03);
  }

  .device-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .device-name {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--prof-text);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .device-badge {
    font-size: 0.625rem;
    font-weight: 600;
    color: var(--prof-gem-aqua);
    background: rgba(46, 196, 166, 0.1);
    padding: 2px 7px;
    border-radius: 6px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .device-meta {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.6875rem;
    color: var(--prof-text-dim);
  }

  .device-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: rgba(251, 113, 133, 0.06);
    border: 1px solid rgba(251, 113, 133, 0.1);
    border-radius: 7px;
    color: var(--prof-error);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.2s ease;
  }

  .device-remove:hover:not(:disabled) {
    background: rgba(251, 113, 133, 0.15);
  }

  .device-remove:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ================================================================= */
  /*                     MESSAGES                                      */
  /* ================================================================= */

  .msg {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    text-align: center;
    margin: 8px 0;
    padding: 8px 12px;
    border-radius: 8px;
  }

  .msg-error {
    color: var(--prof-error);
    background: rgba(251, 113, 133, 0.06);
    border: 1px solid rgba(251, 113, 133, 0.1);
  }

  .msg-success {
    color: var(--prof-success);
    background: rgba(52, 211, 153, 0.06);
    border: 1px solid rgba(52, 211, 153, 0.1);
  }

  /* ================================================================= */
  /*                     SPINNER                                       */
  /* ================================================================= */

  .spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid rgba(232, 185, 74, 0.2);
    border-top-color: var(--prof-gem);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ================================================================= */
  /*                     DEMO TOAST                                    */
  /* ================================================================= */

  .demo-toast {
    position: fixed;
    bottom: calc(100px + env(safe-area-inset-bottom, 0px));
    left: 50%;
    transform: translateX(-50%);
    background: rgba(18, 14, 10, 0.95);
    border: 1px solid rgba(180, 140, 50, 0.2);
    color: var(--prof-text);
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    padding: 10px 20px;
    border-radius: 10px;
    z-index: 200;
    animation: toastIn 0.3s ease-out forwards;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
    white-space: nowrap;
  }

  .demo-toast.dismissing {
    animation: toastOut 0.3s ease-in forwards;
  }

  @keyframes toastIn {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  @keyframes toastOut {
    from {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    to {
      opacity: 0;
      transform: translateX(-50%) translateY(12px);
    }
  }

  /* ================================================================= */
  /*                     MODAL                                         */
  /* ================================================================= */

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(10, 8, 6, 0.85);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 24px;
    animation: fadeIn 0.25s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .modal-card {
    background: var(--prof-surface);
    border: 1px solid var(--prof-surface-border);
    border-radius: var(--prof-radius);
    padding: 32px 24px 24px;
    max-width: 360px;
    width: 100%;
    text-align: center;
    box-shadow: 0 8px 48px rgba(0, 0, 0, 0.5);
    animation: modalSlideUp 0.3s ease-out;
  }

  @keyframes modalSlideUp {
    from {
      opacity: 0;
      transform: translateY(24px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .modal-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    margin: 0 auto 16px;
    border-radius: 50%;
    background: rgba(232, 185, 74, 0.1);
    color: var(--prof-gem);
    border: 1px solid rgba(232, 185, 74, 0.15);
  }

  .modal-title {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--prof-text);
    margin: 0 0 8px;
  }

  .modal-text {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    color: var(--prof-text-muted);
    margin: 0 0 6px;
    line-height: 1.6;
  }

  .modal-text strong {
    color: var(--prof-gem-light);
    font-weight: 500;
  }

  .modal-hint {
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
    color: var(--prof-text-dim);
    margin: 0 0 20px;
  }

  .modal-actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .btn-modal {
    padding: 10px 20px;
    background: rgba(232, 185, 74, 0.1);
    color: var(--prof-gem-light);
    border: 1px solid rgba(232, 185, 74, 0.2);
    border-radius: var(--prof-radius-sm);
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.2s ease;
  }

  .btn-modal:hover:not(:disabled) {
    background: rgba(232, 185, 74, 0.18);
  }

  .btn-modal:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-modal-dismiss {
    padding: 10px 20px;
    background: none;
    color: var(--prof-text-dim);
    border: none;
    border-radius: var(--prof-radius-sm);
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    cursor: pointer;
    transition: color 0.2s ease;
  }

  .btn-modal-dismiss:hover {
    color: var(--prof-text-muted);
  }

  /* ================================================================= */
  /*                     RESPONSIVE — MOBILE                           */
  /* ================================================================= */

  @media (max-width: 640px) {
    .field-row {
      flex-direction: column;
    }
    .settings-card {
      padding: 1.25rem;
    }
    .avatar-circle {
      width: 80px;
      height: 80px;
      font-size: 2rem;
    }
    .field-input {
      padding: 0.75rem 0.875rem;
      font-size: 16px;
    }
    .btn-action,
    .btn-danger-subtle,
    .btn-signout {
      padding: 0.875rem 1.25rem;
      font-size: 0.9375rem;
    }
    .debug-grid {
      grid-template-columns: 1fr;
    }
  }

  /* ================================================================= */
  /*                     RESPONSIVE — SMALL MOBILE (≤480px)             */
  /* ================================================================= */

  @media (max-width: 480px) {
    .cards-container {
      padding: 16px 12px;
    }
    .settings-card {
      padding: 18px 14px;
    }
    .avatar-section {
      padding: 20px 16px 8px;
    }
    .field-row {
      flex-direction: column;
    }
    .btn-action,
    .btn-danger-subtle,
    .btn-signout {
      width: 100%;
      min-height: 48px;
    }
  }

  @media (max-width: 380px) {
    .pin-digit {
      width: 34px;
      height: 42px;
      font-size: 1rem;
      padding: 0;
    }
    .pin-row {
      gap: 4px;
    }
  }

  @media (max-width: 375px) {
    .profile-header .header-title {
      font-size: 1.125rem;
    }
    .settings-card {
      padding: 14px 12px;
    }
    .avatar-circle {
      width: 70px;
      height: 70px;
      font-size: 1.75rem;
    }
    .pin-digit {
      width: 36px;
      height: 44px;
      font-size: 1.125rem;
    }
    .pin-row {
      gap: 0.25rem;
    }
  }

  /* ================================================================= */
  /*                     RESPONSIVE — iPHONE 16 PRO (400–430px)        */
  /* ================================================================= */

  @media (min-width: 400px) and (max-width: 430px) {
    .settings-card {
      padding: 1.5rem;
    }
    .avatar-circle {
      width: 88px;
      height: 88px;
      font-size: 2.25rem;
    }
    .pin-digit {
      width: 44px;
      height: 52px;
      font-size: 1.375rem;
    }
    .pin-row {
      gap: 0.4375rem;
    }
  }

  /* ================================================================= */
  /*                     RESPONSIVE — iPHONE PRO MAX (430–640px)       */
  /* ================================================================= */

  @media (min-width: 430px) and (max-width: 640px) {
    .settings-card {
      padding: 1.75rem;
    }
    .field-row {
      flex-direction: row;
    }
    .avatar-circle {
      width: 100px;
      height: 100px;
      font-size: 2.5rem;
    }
  }

  /* ================================================================= */
  /*                     RESPONSIVE — iPHONE PIN (390–399px)           */
  /* ================================================================= */

  @media (min-width: 390px) and (max-width: 399px) {
    .pin-digit {
      width: 40px;
      height: 48px;
      font-size: 1.25rem;
    }
    .pin-row {
      gap: 0.375rem;
    }
  }

  /* ================================================================= */
  /*                     SETUP LINK                                    */
  /* ================================================================= */

  .setup-link {
    text-decoration: none;
    text-align: center;
  }

  /* ================================================================= */
  /*                     DIAGNOSTICS DASHBOARD                         */
  /* ================================================================= */

  /* ── Status Banner ── */
  .diag-status-banner {
    display: flex;
    align-items: center;
    gap: 0.875rem;
    padding: 1rem 1.25rem;
    background: rgba(14, 12, 8, 0.6);
    border: 1px solid rgba(180, 140, 50, 0.15);
    border-radius: var(--prof-radius-sm);
    margin-bottom: 1.25rem;
  }

  .diag-status-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .diag-status-dot--green {
    background: #26de81;
    box-shadow: 0 0 12px rgba(38, 222, 129, 0.5);
    animation: statusPulse 3s ease-in-out infinite;
  }

  .diag-status-dot--gold {
    background: var(--prof-gem);
    box-shadow: 0 0 12px rgba(212, 160, 57, 0.5);
    animation: statusPulse 1s ease-in-out infinite;
  }

  .diag-status-dot--yellow {
    background: #ffd43b;
    box-shadow: 0 0 12px rgba(255, 212, 59, 0.5);
    animation: statusPulse 2s ease-in-out infinite;
  }

  .diag-status-dot--red {
    background: #ff6b6b;
    box-shadow: 0 0 12px rgba(255, 107, 107, 0.5);
    animation: statusPulse 0.8s ease-in-out infinite;
  }

  @keyframes statusPulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.6;
      transform: scale(0.85);
    }
  }

  .diag-status-info {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .diag-status-label {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.9375rem;
    font-weight: 700;
    color: var(--prof-text);
  }

  .diag-status-meta {
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
    color: var(--prof-text-muted);
  }

  /* ── Section Titles ── */
  .diag-section-title {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--prof-text-muted);
    margin: 1.25rem 0 0.625rem;
  }

  /* ── Stat Grids ── */
  .diag-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.625rem;
  }

  .diag-grid-2 {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.625rem;
  }

  .diag-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.75rem 0.5rem;
    background: rgba(14, 12, 8, 0.4);
    border: 1px solid rgba(180, 140, 50, 0.1);
    border-radius: 8px;
    font-variant-numeric: tabular-nums;
  }

  .diag-stat-value {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--prof-text);
    font-variant-numeric: tabular-nums;
  }

  .diag-stat-label {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.625rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--prof-text-muted);
  }

  @media (max-width: 640px) {
    .diag-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  /* ── Badges ── */
  .diag-badges {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.625rem;
    flex-wrap: wrap;
  }

  .diag-badge-ok {
    display: inline-flex;
    padding: 0.2rem 0.625rem;
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-radius: 4px;
    color: #26de81;
    background: rgba(38, 222, 129, 0.12);
    border: 1px solid rgba(38, 222, 129, 0.25);
  }

  .diag-badge-warn {
    display: inline-flex;
    padding: 0.2rem 0.625rem;
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-radius: 4px;
    color: #ffd43b;
    background: rgba(255, 212, 59, 0.12);
    border: 1px solid rgba(255, 212, 59, 0.25);
  }

  /* ── Key-Value Rows ── */
  .diag-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0;
    border-bottom: 1px solid rgba(180, 140, 50, 0.08);
    font-variant-numeric: tabular-nums;
    gap: 0.75rem;
  }

  .diag-row:last-of-type {
    border-bottom: none;
  }

  .diag-row-label {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    color: var(--prof-text-muted);
    flex-shrink: 0;
  }

  .diag-row-value {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--prof-text);
    display: flex;
    align-items: center;
    gap: 0.375rem;
    min-width: 0;
    text-align: right;
  }

  .diag-lock-duration {
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--prof-text-muted);
  }

  /* ── Inline Status Dot ── */
  .diag-inline-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .diag-inline-dot--green {
    background: #26de81;
    box-shadow: 0 0 6px rgba(38, 222, 129, 0.4);
  }

  .diag-inline-dot--yellow {
    background: #ffd43b;
    box-shadow: 0 0 6px rgba(255, 212, 59, 0.4);
  }

  .diag-inline-dot--red {
    background: #ff6b6b;
    box-shadow: 0 0 6px rgba(255, 107, 107, 0.4);
  }

  /* ── Progress Bars ── */
  .diag-table-bars {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    margin-top: 0.75rem;
  }

  .diag-table-row {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .diag-table-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .diag-table-name {
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
    font-weight: 600;
    color: var(--prof-text);
  }

  .diag-table-pct {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--prof-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .diag-progress-bar {
    height: 6px;
    background: rgba(212, 160, 57, 0.1);
    border-radius: 3px;
    overflow: hidden;
  }

  .diag-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--prof-gem-accent), var(--prof-gem));
    border-radius: 3px;
    transition: width 600ms ease-out;
  }

  /* ── Configuration Tables ── */
  .diag-config-tables {
    padding: 0.5rem 0;
    border-bottom: 1px solid rgba(180, 140, 50, 0.08);
  }

  .diag-config-tables-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }

  .diag-config-table-names {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .diag-table-tag {
    display: inline-flex;
    padding: 0.1875rem 0.5rem;
    font-size: 0.6875rem;
    font-weight: 600;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    color: var(--prof-gem-light);
    background: rgba(212, 160, 57, 0.1);
    border: 1px solid rgba(212, 160, 57, 0.2);
    border-radius: 4px;
  }

  /* ── Recent Cycles Timeline ── */
  .diag-cycles {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .diag-cycle-item {
    padding: 0.625rem 0.875rem;
    background: rgba(14, 12, 8, 0.3);
    border-left: 3px solid rgba(212, 160, 57, 0.4);
    border-radius: 0 8px 8px 0;
  }

  .diag-cycle-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.25rem;
  }

  .diag-cycle-trigger {
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
    font-weight: 700;
    color: var(--prof-gem-light);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .diag-cycle-time {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.6875rem;
    color: var(--prof-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .diag-cycle-stats {
    display: flex;
    gap: 0.75rem;
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.6875rem;
    color: var(--prof-text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* ── Errors ── */
  .diag-error-banner {
    padding: 0.75rem 1rem;
    background: rgba(255, 107, 107, 0.08);
    border: 1px solid rgba(255, 107, 107, 0.2);
    border-radius: 8px;
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--prof-error);
    margin-bottom: 0.5rem;
  }

  .diag-error-item {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid rgba(255, 107, 107, 0.1);
  }

  .diag-error-item:last-child {
    border-bottom: none;
  }

  .diag-error-table {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--prof-error);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .diag-error-msg {
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
    color: var(--prof-text-muted);
  }

  /* ── Footer ── */
  .diag-footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1.25rem;
    padding-top: 0.75rem;
    border-top: 1px solid rgba(180, 140, 50, 0.1);
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.6875rem;
    color: var(--prof-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .diag-footer-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(212, 160, 57, 0.5);
    animation: footerTick 2.5s ease-in-out infinite;
  }

  @keyframes footerTick {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
  }

  /* ================================================================= */
  /*                     PROFILE FOOTER                                */
  /* ================================================================= */

  .profile-footer {
    display: flex;
    justify-content: center;
    padding-top: 20px;
    padding-bottom: 8px;
  }

  .footer-link {
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--prof-text-dim);
    text-decoration: none;
    transition: color 0.2s ease;
    opacity: 0.7;
  }

  .footer-link:hover {
    color: var(--prof-gem-light);
    opacity: 1;
  }

  /* ================================================================= */
  /*                     REDUCED MOTION                                */
  /* ================================================================= */

  @media (prefers-reduced-motion: reduce) {
    .profile-page {
      animation-duration: 0.01ms;
    }
    .profile-page::before {
      animation: none;
    }
    .avatar-circle::before {
      animation: none;
      opacity: 0.5;
    }
    .avatar-circle::after {
      animation: none;
      background-position: 50% 50%;
    }
    .diag-status-dot,
    .diag-footer-dot,
    .spinner {
      animation: none;
    }
    .diag-progress-fill {
      transition: none;
    }
  }

  /* ── Diagnostics responsive (mobile) ── */
  @media (max-width: 640px) {
    .diag-status-banner {
      padding: 0.75rem 1rem;
      gap: 0.625rem;
    }
    .diag-status-label {
      font-size: 0.875rem;
    }
    .diag-stat {
      padding: 0.625rem 0.375rem;
    }
    .diag-stat-value {
      font-size: 0.9375rem;
    }
    .diag-stat-label {
      font-size: 0.5625rem;
    }
    .diag-row {
      padding: 0.4375rem 0;
    }
    .diag-row-label {
      font-size: 0.75rem;
    }
    .diag-row-value {
      font-size: 0.75rem;
    }
    .diag-cycle-stats {
      flex-wrap: wrap;
      gap: 0.375rem 0.625rem;
    }
    .diag-cycle-item {
      padding: 0.5rem 0.625rem;
    }
    .diag-table-tag {
      font-size: 0.625rem;
      padding: 0.125rem 0.375rem;
    }
    .diag-error-banner {
      font-size: 0.75rem;
      padding: 0.625rem 0.75rem;
    }
  }

  @media (max-width: 375px) {
    .diag-stat-value {
      font-size: 0.875rem;
    }
    .diag-grid-2 {
      gap: 0.5rem;
    }
    .diag-cycle-stats {
      font-size: 0.625rem;
    }
    .diag-table-tag {
      font-size: 0.5625rem;
    }
  }
</style>
