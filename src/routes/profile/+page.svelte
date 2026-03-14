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
    resolveUserId
  } from 'stellar-drive/auth';
  import { authState } from 'stellar-drive/stores';
  import { isDebugMode, setDebugMode } from 'stellar-drive/utils';
  import {
    resetDatabase,
    getTrustedDevices,
    removeTrustedDevice,
    getCurrentDeviceId,
    isDemoMode
  } from 'stellar-drive';
  import type { TrustedDevice } from 'stellar-drive';
  import { getDemoConfig } from 'stellar-drive';
  import { onMount } from 'svelte';

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
  let demoToastTimer: ReturnType<typeof setTimeout> | null = null;

  /** Show a temporary toast for blocked demo operations. */
  function showDemoToast(msg: string) {
    demoToast = msg;
    if (demoToastTimer) clearTimeout(demoToastTimer);
    demoToastTimer = setTimeout(() => (demoToast = ''), 3000);
  }

  /* ── Debug tools loading flags ──── */
  let forceSyncing = $state(false);
  let triggeringSyncManual = $state(false);
  let resettingCursor = $state(false);

  let viewingTombstones = $state(false);
  let cleaningTombstones = $state(false);

  /* ── Trusted devices ──── */
  let trustedDevices = $state<TrustedDevice[]>([]);
  let currentDeviceId = $state('');
  let devicesLoading = $state(true);
  /** ID of the device currently being removed — shows spinner on that row */
  let removingDeviceId = $state<string | null>(null);

  // =============================================================================
  //                           LIFECYCLE
  // =============================================================================

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
      devicesLoading = false;
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
      {#if firstName}
        {firstName.charAt(0).toUpperCase()}{lastName ? lastName.charAt(0).toUpperCase() : ''}
      {:else}
        ?
      {/if}
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
        Change PIN
      </h2>
      <form onsubmit={handleCodeSubmit}>
        <div class="pin-group">
          <span class="pin-group-label" id="pin-label-current">Current PIN</span>
          <div class="pin-row" role="group" aria-labelledby="pin-label-current">
            {#each oldCodeDigits as _, i (i)}
              <input
                type="tel"
                inputmode="numeric"
                maxlength="1"
                class="pin-digit"
                aria-label={`Current PIN digit ${i + 1}`}
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
          <span class="pin-group-label" id="pin-label-new">New PIN</span>
          <div class="pin-row" role="group" aria-labelledby="pin-label-new">
            {#each newCodeDigits as _, i (i)}
              <input
                type="tel"
                inputmode="numeric"
                maxlength="1"
                class="pin-digit"
                aria-label={`New PIN digit ${i + 1}`}
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
          <span class="pin-group-label" id="pin-label-confirm">Confirm New PIN</span>
          <div class="pin-row" role="group" aria-labelledby="pin-label-confirm">
            {#each confirmCodeDigits as _, i (i)}
              <input
                type="tel"
                inputmode="numeric"
                maxlength="1"
                class="pin-digit"
                aria-label={`Confirm PIN digit ${i + 1}`}
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
          Update PIN
        </button>
      </form>
    </section>

    <!-- ================================================================= -->
    <!--                   TRUSTED DEVICES CARD                            -->
    <!-- ================================================================= -->
    {#if !inDemoMode}
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
              <li class="device-row">
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
    {/if}

    <!-- ================================================================= -->
    <!--                   DIAGNOSTICS SECTION                             -->
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
        Diagnostics
      </h2>
      <div class="toggle-row">
        <span class="toggle-label">Debug Mode</span>
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
  </div>
</div>

<!-- ================================================================= -->
<!--                    DEMO MODE TOAST                                -->
<!-- ================================================================= -->
{#if demoToast}
  <div class="demo-toast">{demoToast}</div>
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
    min-height: 100dvh;
    background: var(--prof-void);
    background-image:
      radial-gradient(ellipse 70% 40% at 30% 0%, rgba(184, 134, 46, 0.07) 0%, transparent 60%),
      radial-gradient(ellipse 50% 30% at 80% 100%, rgba(46, 196, 166, 0.04) 0%, transparent 50%);
    padding-bottom: calc(40px + env(safe-area-inset-bottom, 0px));
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
    padding: 16px 20px;
    padding-top: calc(16px + env(safe-area-inset-top, 0px));
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
    border-radius: var(--prof-radius-sm);
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
    animation: toastIn 0.3s ease-out;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
    white-space: nowrap;
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
    .profile-page {
      padding-left: 0.25rem;
      padding-right: 0.25rem;
    }
    .field-row {
      grid-template-columns: 1fr;
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
  /*                     RESPONSIVE — iPHONE SE (≤375px)               */
  /* ================================================================= */

  @media (max-width: 375px) {
    .profile-header .header-title {
      font-size: 1.125rem;
    }
    .settings-card {
      padding: 1rem;
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
    .profile-page {
      padding-left: 0.5rem;
      padding-right: 0.5rem;
    }
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
    .profile-page {
      padding-left: 0.75rem;
      padding-right: 0.75rem;
    }
    .settings-card {
      padding: 1.75rem;
    }
    .field-row {
      grid-template-columns: 1fr 1fr;
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
  }
</style>
