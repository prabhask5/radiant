<!--
  @fileoverview Login page — three modes:
    1. **Setup**       — first-time account creation (email + PIN)
    2. **Unlock**      — returning user enters PIN to unlock
    3. **Link Device** — new device links to an existing account via email verification

  Uses BroadcastChannel (`auth-channel`) for cross-tab communication with
  the /confirm page so email verification results propagate instantly.
-->
<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import {
    setupSingleUser,
    unlockSingleUser,
    getSingleUserInfo,
    completeSingleUserSetup,
    completeDeviceVerification,
    pollDeviceVerification,
    fetchRemoteGateConfig,
    linkSingleUserDevice
  } from 'stellar-drive/auth';
  import { sendDeviceVerification, isDemoMode } from 'stellar-drive';
  import { isSafeRedirect } from 'stellar-drive/utils';

  // ==========================================================================
  //                        LAYOUT / PAGE DATA
  // ==========================================================================

  /** Whether this device has a linked single-user account (derived from IndexedDB, not layout data) */
  let deviceLinked = $state(false);

  /** Post-login redirect URL — validated to prevent open-redirect attacks */
  const redirectUrl = $derived.by(() => {
    const param = $page.url.searchParams.get('redirect');
    if (param && isSafeRedirect(param)) return param;
    return '/';
  });

  // ==========================================================================
  //                          SHARED UI STATE
  // ==========================================================================

  /** `true` while any async auth operation is in-flight */
  let loading = $state(false);

  /** Current error message shown to the user (null = no error) */
  let error = $state<string | null>(null);

  /** Triggers the CSS shake animation on the login card */
  let shaking = $state(false);

  /** Set to `true` after the component mounts — enables entrance animation */
  let mounted = $state(false);

  /** `true` while the initial auth state is being resolved (prevents card flash) */
  let resolving = $state(true);

  // =============================================================================
  //  Setup Mode State (step 1 → email/name, step 2 → PIN creation)
  // =============================================================================

  /** User's email address for account creation */
  let email = $state('');

  /** User's first name */
  let firstName = $state('');

  /** User's last name (optional) */
  let lastName = $state('');

  /** Individual digit values for the 6-digit PIN code */
  let codeDigits = $state(['', '', '', '', '', '']);

  /** Individual digit values for the PIN confirmation */
  let confirmDigits = $state(['', '', '', '', '', '']);

  /** Concatenated PIN code — derived from `codeDigits` */
  const code = $derived(codeDigits.join(''));

  /** Concatenated confirmation code — derived from `confirmDigits` */
  const confirmCode = $derived(confirmDigits.join(''));

  /** Current setup wizard step: 1 = email + name, 2 = PIN creation */
  let setupStep = $state(1); // 1 = email + name, 2 = code

  // =============================================================================
  //  Unlock Mode State (returning user on this device)
  // =============================================================================

  /** Individual digit values for the unlock PIN */
  let unlockDigits = $state(['', '', '', '', '', '']);

  /** Concatenated unlock code — derived from `unlockDigits` */
  const unlockCode = $derived(unlockDigits.join(''));

  /** Cached user profile info (first/last name) for the welcome message */
  let userInfo = $state<{ firstName: string; lastName: string } | null>(null);

  // =============================================================================
  //  Link Device Mode State (new device, existing remote user)
  // =============================================================================

  /** Individual digit values for the device-linking PIN */
  let linkDigits = $state(['', '', '', '', '', '']);

  /** Concatenated link code — derived from `linkDigits` */
  const linkCode = $derived(linkDigits.join(''));

  /**
   * Remote user info fetched from the gate config — contains email,
   * gate type, code length, and profile data for the welcome message.
   */
  let remoteUser = $state<{
    email: string;
    gateType: string;
    codeLength: number;
    profile: Record<string, unknown>;
  } | null>(null);

  /** `true` when we detected a remote user and entered link-device mode */
  let linkMode = $state(false);

  /** Loading state specific to the link-device flow */
  let linkLoading = $state(false);

  /** `true` when offline and no local setup exists — shows offline card */
  let offlineNoSetup = $state(false);

  // =============================================================================
  //  Rate-Limit Countdown State
  // =============================================================================

  /** Seconds remaining before the user can retry after a rate-limit */
  let retryCountdown = $state(0);

  /** Interval handle for the retry countdown timer */
  let retryTimer: ReturnType<typeof setInterval> | null = null;

  // =============================================================================
  //  Modal State — Email Confirmation & Device Verification
  // =============================================================================

  /** Show the "check your email" modal after initial signup */
  let showConfirmationModal = $state(false);

  /** Show the "new device detected" verification modal */
  let showDeviceVerificationModal = $state(false);

  /** Masked email address displayed in the device-verification modal */
  let maskedEmail = $state('');

  /** Seconds remaining before the "resend" button re-enables */
  let resendCooldown = $state(0);

  /** Interval handle for the resend cooldown timer */
  let resendTimer: ReturnType<typeof setInterval> | null = null;

  /** Interval handle for polling device verification status */
  let verificationPollTimer: ReturnType<typeof setInterval> | null = null;

  /** Guard flag to prevent double-execution of verification completion */
  let verificationCompleting = false; // guard against double execution

  // =============================================================================
  //  Input Refs — DOM references for focus management
  // =============================================================================

  /** References to the 6 setup-code `<input>` elements */
  let codeInputs: HTMLInputElement[] = $state([]);

  /** References to the 6 confirm-code `<input>` elements */
  let confirmInputs: HTMLInputElement[] = $state([]);

  /** References to the 6 unlock-code `<input>` elements */
  let unlockInputs: HTMLInputElement[] = $state([]);

  /** References to the link-code `<input>` elements */
  let linkInputs: HTMLInputElement[] = $state([]);

  // =============================================================================
  //  Cross-Tab Communication
  // =============================================================================

  /** BroadcastChannel instance for receiving `AUTH_CONFIRMED` from `/confirm` */
  let authChannel: BroadcastChannel | null = null;

  // =============================================================================
  //  Lifecycle — onMount
  // =============================================================================

  onMount(async () => {
    mounted = true;

    /* ── Demo mode → redirect to home ──── */
    if (isDemoMode()) {
      goto('/', { replaceState: true });
      return;
    }

    /* ── Check if this device has a local account ──── */
    const info = await getSingleUserInfo();
    if (info) {
      userInfo = {
        firstName: (info.profile.firstName as string) || '',
        lastName: (info.profile.lastName as string) || ''
      };
      deviceLinked = true;
    } else {
      /* ── No local setup → check for a remote user to link to ──── */
      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (isOffline) {
        offlineNoSetup = true;
      } else {
        try {
          const remote = await fetchRemoteGateConfig();
          if (remote) {
            remoteUser = remote;
            linkMode = true;
          }
        } catch {
          /* No remote user found — fall through to normal setup */
        }
      }
    }

    /* ── Initial resolution complete — show the appropriate card ──── */
    resolving = false;

    /* ── Listen for auth confirmation from the `/confirm` page ──── */
    try {
      authChannel = new BroadcastChannel('radiant-auth-channel');
      authChannel.onmessage = async (event) => {
        if (event.data?.type === 'AUTH_CONFIRMED') {
          /* Bring this tab to the foreground before the confirm tab closes */
          window.focus();
          if (showConfirmationModal) {
            /* Setup confirmation complete → finalize account */
            const result = await completeSingleUserSetup();
            if (!result.error) {
              showConfirmationModal = false;
              await invalidateAll();
              goto('/');
            } else {
              error = result.error;
              showConfirmationModal = false;
            }
          } else if (showDeviceVerificationModal) {
            /* Device verification complete (same-browser broadcast) */
            await handleVerificationComplete();
          }
        }
      };
    } catch {
      /* BroadcastChannel not supported — user must manually refresh */
    }
  });

  // =============================================================================
  //  Lifecycle — onDestroy (cleanup timers & channels)
  // =============================================================================

  onDestroy(() => {
    authChannel?.close();
    if (resendTimer) clearInterval(resendTimer);
    if (retryTimer) clearInterval(retryTimer);
    stopVerificationPolling();
  });

  // =============================================================================
  //  Device Verification Polling
  // =============================================================================

  /**
   * Start polling the engine every 3 seconds to check whether the
   * device has been trusted (the user clicked the email link on
   * another device/browser).
   */
  function startVerificationPolling() {
    stopVerificationPolling();
    verificationPollTimer = setInterval(async () => {
      if (verificationCompleting) return;
      const trusted = await pollDeviceVerification();
      if (trusted) {
        await handleVerificationComplete();
      }
    }, 3000);
  }

  /**
   * Stop the verification polling interval and clear the handle.
   */
  function stopVerificationPolling() {
    if (verificationPollTimer) {
      clearInterval(verificationPollTimer);
      verificationPollTimer = null;
    }
  }

  /**
   * Finalize device verification — calls `completeDeviceVerification`
   * and redirects on success. Guarded by `verificationCompleting` to
   * prevent double-execution from both polling and BroadcastChannel.
   */
  async function handleVerificationComplete() {
    if (verificationCompleting) return;
    verificationCompleting = true;
    stopVerificationPolling();

    const result = await completeDeviceVerification();
    if (!result.error) {
      showDeviceVerificationModal = false;
      await invalidateAll();
      goto(redirectUrl);
    } else {
      error = result.error;
      showDeviceVerificationModal = false;
      verificationCompleting = false;
    }
  }

  // =============================================================================
  //  Resend & Retry Cooldowns
  // =============================================================================

  /**
   * Start a 30-second cooldown on the "Resend email" button to
   * prevent spamming the email service.
   */
  function startResendCooldown() {
    resendCooldown = 30;
    if (resendTimer) clearInterval(resendTimer);
    resendTimer = setInterval(() => {
      resendCooldown--;
      if (resendCooldown <= 0 && resendTimer) {
        clearInterval(resendTimer);
        resendTimer = null;
      }
    }, 1000);
  }

  /**
   * Start a countdown after receiving a rate-limit response from the
   * server. Disables the code inputs and auto-clears the error when
   * the countdown reaches zero.
   *
   * @param ms - The `retryAfterMs` value from the server response
   */
  function startRetryCountdown(ms: number) {
    retryCountdown = Math.ceil(ms / 1000);
    if (retryTimer) clearInterval(retryTimer);
    retryTimer = setInterval(() => {
      retryCountdown--;
      if (retryCountdown <= 0) {
        retryCountdown = 0;
        error = null;
        if (retryTimer) {
          clearInterval(retryTimer);
          retryTimer = null;
        }
      }
    }, 1000);
  }

  // =============================================================================
  //  Email Resend Handler
  // =============================================================================

  /**
   * Resend the confirmation or verification email depending on
   * which modal is currently visible. Respects the resend cooldown.
   */
  async function handleResendEmail() {
    if (resendCooldown > 0) return;
    startResendCooldown();
    /* For setup confirmation → resend the signup email */
    if (showConfirmationModal) {
      const { resendConfirmationEmail } = await import('stellar-drive');
      await resendConfirmationEmail(email);
    }
    /* For device verification → resend the OTP email */
    if (showDeviceVerificationModal) {
      const info = await getSingleUserInfo();
      if (info?.email) {
        await sendDeviceVerification(info.email);
      }
    }
  }

  // =============================================================================
  //  Digit Input Handlers — Shared across all PIN-code fields
  // =============================================================================

  /**
   * Handle a single digit being typed into a PIN input box. Filters
   * non-numeric characters, auto-advances focus, and triggers
   * `onComplete` when the last digit is filled.
   *
   * @param digits    - The reactive digit array being edited
   * @param index     - Which position in the array this input represents
   * @param event     - The native `input` DOM event
   * @param inputs    - Array of `HTMLInputElement` refs for focus management
   * @param onComplete - Optional callback invoked when all digits are filled
   */
  function handleDigitInput(
    digits: string[],
    index: number,
    event: Event,
    inputs: HTMLInputElement[],
    onComplete?: () => void
  ) {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/[^0-9]/g, '');

    if (value.length > 0) {
      digits[index] = value.charAt(value.length - 1);
      input.value = digits[index];
      /* Auto-focus the next input box */
      if (index < digits.length - 1 && inputs[index + 1]) {
        inputs[index + 1].focus();
      }
      /* Auto-submit when the last digit is entered (brief delay for UX) */
      if (index === digits.length - 1 && onComplete && digits.every((d) => d !== '')) {
        setTimeout(() => onComplete(), 300);
      }
    } else {
      digits[index] = '';
    }
  }

  /**
   * Handle backspace in a PIN input — moves focus to the previous
   * input when the current one is already empty.
   *
   * @param digits - The reactive digit array
   * @param index  - Current position index
   * @param event  - The native `keydown` event
   * @param inputs - Array of `HTMLInputElement` refs
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
   * Handle paste into a PIN input — distributes pasted digits across
   * all input boxes and auto-submits if the full code was pasted.
   *
   * @param digits     - The reactive digit array
   * @param event      - The native `paste` clipboard event
   * @param inputs     - Array of `HTMLInputElement` refs
   * @param onComplete - Optional callback invoked when all digits are filled
   */
  function handleDigitPaste(
    digits: string[],
    event: ClipboardEvent,
    inputs: HTMLInputElement[],
    onComplete?: () => void
  ) {
    event.preventDefault();
    const pasted = (event.clipboardData?.getData('text') || '').replace(/[^0-9]/g, '');
    for (let i = 0; i < digits.length && i < pasted.length; i++) {
      digits[i] = pasted[i];
      if (inputs[i]) inputs[i].value = pasted[i];
    }
    const focusIndex = Math.min(pasted.length, digits.length - 1);
    if (inputs[focusIndex]) inputs[focusIndex].focus();
    /* Auto-submit if the full code was pasted at once */
    if (pasted.length >= digits.length && onComplete && digits.every((d) => d !== '')) {
      onComplete();
    }
  }

  // =============================================================================
  //  Setup Mode — Step Navigation
  // =============================================================================

  /**
   * Validate email and first name, then advance to the PIN-creation
   * step (step 2). Shows an error if validation fails.
   */
  function goToCodeStep() {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      error = 'Please enter a valid email address';
      return;
    }
    if (!firstName.trim()) {
      error = 'First name is required';
      return;
    }
    error = null;
    setupStep = 2;
  }

  /**
   * Navigate back from step 2 (PIN creation) to step 1 (email/name).
   */
  function goBackToNameStep() {
    setupStep = 1;
    error = null;
  }

  /**
   * Auto-focus the first confirm-code input when the primary code
   * is fully entered.
   */
  function autoFocusConfirm() {
    if (confirmInputs[0]) confirmInputs[0].focus();
  }

  /**
   * Trigger setup submission when the confirm-code auto-completes.
   */
  function autoSubmitSetup() {
    if (confirmDigits.every((d) => d !== '')) {
      handleSetup();
    }
  }

  /**
   * Trigger unlock submission when the unlock-code auto-completes.
   */
  function autoSubmitUnlock() {
    handleUnlock();
  }

  // =============================================================================
  //  Setup Mode — Account Creation
  // =============================================================================

  /**
   * Handle the full setup flow: validate the code matches its
   * confirmation, call `setupSingleUser`, and handle the response
   * (which may require email confirmation or succeed immediately).
   */
  async function handleSetup() {
    if (loading) return;

    error = null;

    if (code.length !== 6) {
      error = 'Please enter a 6-digit code';
      return;
    }

    /* Verify code and confirmation match */
    if (code !== confirmCode) {
      error = 'Codes do not match';
      shaking = true;
      setTimeout(() => {
        shaking = false;
      }, 500);
      /* Clear confirm digits and refocus the first confirm input */
      confirmDigits = ['', '', '', '', '', ''];
      if (confirmInputs[0]) confirmInputs[0].focus();
      return;
    }

    loading = true;

    try {
      const result = await setupSingleUser(
        code,
        {
          firstName: firstName.trim(),
          lastName: lastName.trim()
        },
        email.trim()
      );
      if (result.error) {
        error = result.error;
        shaking = true;
        setTimeout(() => {
          shaking = false;
        }, 500);
        codeDigits = ['', '', '', '', '', ''];
        confirmDigits = ['', '', '', '', '', ''];
        if (codeInputs[0]) codeInputs[0].focus();
        return;
      }
      if (result.confirmationRequired) {
        /* Email confirmation needed → show the "check your email" modal */
        showConfirmationModal = true;
        startResendCooldown();
        return;
      }
      /* No confirmation needed → go straight to the app (keep loading=true to avoid flash) */
      await invalidateAll();
      goto('/');
      return;
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : 'Setup failed. Please try again.';
      shaking = true;
      setTimeout(() => {
        shaking = false;
      }, 500);
      codeDigits = ['', '', '', '', '', ''];
      confirmDigits = ['', '', '', '', '', ''];
      if (codeInputs[0]) codeInputs[0].focus();
    }
    loading = false;
  }

  // =============================================================================
  //  Unlock Mode — PIN Entry for Returning Users
  // =============================================================================

  /**
   * Attempt to unlock the local account with the entered 6-digit PIN.
   * Handles rate-limiting, device verification requirements, and
   * error feedback with shake animation.
   */
  async function handleUnlock() {
    if (loading || retryCountdown > 0) return;

    error = null;

    if (unlockCode.length !== 6) {
      error = 'Please enter your 6-digit code';
      return;
    }

    loading = true;

    try {
      const result = await unlockSingleUser(unlockCode);
      if (result.error) {
        error = result.error;
        if (result.retryAfterMs) {
          startRetryCountdown(result.retryAfterMs);
        }
        shaking = true;
        setTimeout(() => {
          shaking = false;
        }, 500);
        unlockDigits = ['', '', '', '', '', ''];
        return;
      }
      if (result.deviceVerificationRequired) {
        /* Untrusted device → show verification modal + start polling */
        maskedEmail = result.maskedEmail || '';
        showDeviceVerificationModal = true;
        startResendCooldown();
        startVerificationPolling();
        return;
      }
      /* Success → navigate to the redirect target (keep loading=true to avoid PIN flash) */
      await invalidateAll();
      goto(redirectUrl);
      return;
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : 'Incorrect code';
      shaking = true;
      setTimeout(() => {
        shaking = false;
      }, 500);
      unlockDigits = ['', '', '', '', '', ''];
    }
    loading = false;
    if (error) {
      await tick();
      if (unlockInputs[0]) unlockInputs[0].focus();
    }
  }

  // =============================================================================
  //  Link Device Mode — Connect a New Device to an Existing Account
  // =============================================================================

  /**
   * Trigger link submission when the link-code auto-completes.
   */
  function autoSubmitLink() {
    if (linkDigits.every((d) => d !== '')) {
      handleLink();
    }
  }

  /**
   * Attempt to link this device to the remote user account by
   * submitting the PIN. Similar flow to unlock — may require device
   * verification or trigger rate-limiting.
   */
  async function handleLink() {
    if (linkLoading || !remoteUser || retryCountdown > 0) return;

    error = null;

    if (linkCode.length !== remoteUser.codeLength) {
      error = `Please enter a ${remoteUser.codeLength}-digit code`;
      return;
    }

    linkLoading = true;
    try {
      const result = await linkSingleUserDevice(remoteUser.email, linkCode);
      if (result.error) {
        error = result.error;
        if (result.retryAfterMs) {
          startRetryCountdown(result.retryAfterMs);
        }
        shaking = true;
        setTimeout(() => {
          shaking = false;
        }, 500);
        linkDigits = Array(remoteUser.codeLength).fill('');
        return;
      }
      if (result.deviceVerificationRequired) {
        maskedEmail = result.maskedEmail || '';
        showDeviceVerificationModal = true;
        startResendCooldown();
        startVerificationPolling();
        return;
      }
      /* Success → navigate to the redirect target (keep linkLoading=true to avoid flash) */
      await invalidateAll();
      goto(redirectUrl);
      return;
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : 'Incorrect code';
      shaking = true;
      setTimeout(() => {
        shaking = false;
      }, 500);
      linkDigits = Array(remoteUser.codeLength).fill('');
    }
    linkLoading = false;
    if (error) {
      await tick();
      if (linkInputs[0]) linkInputs[0].focus();
    }
  }
</script>

<svelte:head>
  <title>Login - Radiant Finance</title>
</svelte:head>

<!-- ================================================================= -->
<!--                     BACKGROUND / ATMOSPHERE                       -->
<!-- ================================================================= -->
<div class="login-bg">
  <div class="crystal-shard shard-1"></div>
  <div class="crystal-shard shard-2"></div>
  <div class="crystal-shard shard-3"></div>
  <div class="refraction-overlay"></div>

  <!-- ================================================================= -->
  <!--                     RESOLVING / LOADING STATE                     -->
  <!-- ================================================================= -->
  {#if resolving}
    <div class="center-stage">
      <div class="crystal-loader">
        <div class="facet facet-1"></div>
        <div class="facet facet-2"></div>
        <div class="facet facet-3"></div>
      </div>
      <p class="resolving-text">Resolving...</p>
    </div>

    <!-- ================================================================= -->
    <!--                        OFFLINE STATE                              -->
    <!-- ================================================================= -->
  {:else if offlineNoSetup}
    <div class="center-stage" class:mounted>
      <div class="auth-card">
        <div class="card-gem-accent"></div>
        <div class="card-icon offline-icon">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        </div>
        <h2 class="card-title">You're Offline</h2>
        <p class="card-subtitle">Connect to the internet to set up your account.</p>
      </div>
    </div>

    <!-- ================================================================= -->
    <!--                     SETUP MODE (New Account)                      -->
    <!-- ================================================================= -->
  {:else if !deviceLinked && !linkMode}
    <div class="center-stage" class:mounted>
      <div class="auth-card" class:shaking>
        <div class="card-gem-accent"></div>

        <!-- Step indicator -->
        <div class="step-indicator">
          <div class="step-dot" class:active={setupStep === 1} class:done={setupStep === 2}></div>
          <div class="step-line" class:filled={setupStep === 2}></div>
          <div class="step-dot" class:active={setupStep === 2}></div>
        </div>

        <!-- ── Step 1: Email + Name ── -->
        {#if setupStep === 1}
          <div class="step-content" style="animation: fadeSlideIn 0.35s ease-out">
            <h2 class="card-title">Create Account</h2>
            <p class="card-subtitle">Set up your personal vault</p>

            <div class="form-group">
              <label class="form-label" for="email">Email</label>
              <input
                id="email"
                type="email"
                class="form-input"
                placeholder="you@example.com"
                bind:value={email}
                disabled={loading}
                autocomplete="email"
              />
            </div>

            <div class="name-row">
              <div class="form-group">
                <label class="form-label" for="first-name">First name</label>
                <input
                  id="first-name"
                  type="text"
                  class="form-input"
                  placeholder="Jane"
                  bind:value={firstName}
                  disabled={loading}
                  autocomplete="given-name"
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="last-name">Last name</label>
                <input
                  id="last-name"
                  type="text"
                  class="form-input"
                  placeholder="Doe"
                  bind:value={lastName}
                  disabled={loading}
                  autocomplete="family-name"
                />
              </div>
            </div>

            {#if error}
              <p class="error-msg">{error}</p>
            {/if}

            <button class="btn-primary" onclick={goToCodeStep} disabled={loading}>
              Continue
              <svg
                class="btn-arrow"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
            </button>
          </div>

          <!-- ── Step 2: PIN Creation ── -->
        {:else}
          <div class="step-content" style="animation: fadeSlideIn 0.35s ease-out">
            <button class="back-link" onclick={goBackToNameStep} type="button">
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
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Back
            </button>

            <h2 class="card-title">Create Your PIN</h2>
            <p class="card-subtitle">Choose a 6-digit code to unlock your vault</p>

            <div class="pin-section">
              <!-- svelte-ignore a11y_label_has_associated_control -->
              <label class="pin-label">PIN Code</label>
              <div class="pin-row">
                {#each codeDigits as _, i (i)}
                  <input
                    type="tel"
                    inputmode="numeric"
                    maxlength="1"
                    class="pin-digit"
                    bind:this={codeInputs[i]}
                    oninput={(e) =>
                      handleDigitInput(codeDigits, i, e, codeInputs, autoFocusConfirm)}
                    onkeydown={(e) => handleDigitKeydown(codeDigits, i, e, codeInputs)}
                    onpaste={(e) => handleDigitPaste(codeDigits, e, codeInputs, autoFocusConfirm)}
                    disabled={loading}
                  />
                {/each}
              </div>
            </div>

            <div class="pin-section">
              <!-- svelte-ignore a11y_label_has_associated_control -->
              <label class="pin-label">Confirm PIN</label>
              <div class="pin-row">
                {#each confirmDigits as _, i (i)}
                  <input
                    type="tel"
                    inputmode="numeric"
                    maxlength="1"
                    class="pin-digit"
                    bind:this={confirmInputs[i]}
                    oninput={(e) =>
                      handleDigitInput(confirmDigits, i, e, confirmInputs, autoSubmitSetup)}
                    onkeydown={(e) => handleDigitKeydown(confirmDigits, i, e, confirmInputs)}
                    onpaste={(e) =>
                      handleDigitPaste(confirmDigits, e, confirmInputs, autoSubmitSetup)}
                    disabled={loading}
                  />
                {/each}
              </div>
            </div>

            {#if error}
              <p class="error-msg">{error}</p>
            {/if}

            <button
              class="btn-primary"
              onclick={handleSetup}
              disabled={loading || code.length !== 6 || confirmCode.length !== 6}
            >
              {#if loading}
                <span class="spinner"></span> Creating...
              {:else}
                Create Account
              {/if}
            </button>
          </div>
        {/if}
      </div>
    </div>

    <!-- ================================================================= -->
    <!--                     UNLOCK MODE (Returning User)                  -->
    <!-- ================================================================= -->
  {:else if deviceLinked}
    <div class="center-stage" class:mounted>
      <div class="auth-card" class:shaking>
        <div class="card-gem-accent"></div>

        <div class="welcome-avatar">
          {#if userInfo?.firstName}
            {userInfo.firstName.charAt(0).toUpperCase()}
          {:else}
            ?
          {/if}
        </div>

        <h2 class="card-title">
          Welcome back{#if userInfo?.firstName}, {userInfo.firstName}{/if}
        </h2>
        <p class="card-subtitle">Enter your PIN to unlock</p>

        <div class="pin-section">
          <div class="pin-row">
            {#each unlockDigits as _, i (i)}
              <input
                type="tel"
                inputmode="numeric"
                maxlength="1"
                class="pin-digit"
                bind:this={unlockInputs[i]}
                oninput={(e) =>
                  handleDigitInput(unlockDigits, i, e, unlockInputs, autoSubmitUnlock)}
                onkeydown={(e) => handleDigitKeydown(unlockDigits, i, e, unlockInputs)}
                onpaste={(e) => handleDigitPaste(unlockDigits, e, unlockInputs, autoSubmitUnlock)}
                disabled={loading || retryCountdown > 0}
              />
            {/each}
          </div>
        </div>

        {#if error}
          <p class="error-msg">{error}</p>
        {/if}

        {#if retryCountdown > 0}
          <p class="countdown-msg">Try again in {retryCountdown}s</p>
        {/if}

        {#if loading}
          <div class="unlock-loading">
            <span class="spinner"></span>
            <span>Unlocking...</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- ================================================================= -->
    <!--                     LINK DEVICE MODE                              -->
    <!-- ================================================================= -->
  {:else if linkMode && remoteUser}
    <div class="center-stage" class:mounted>
      <div class="auth-card" class:shaking>
        <div class="card-gem-accent"></div>

        <div class="card-icon link-icon">
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
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </div>

        <h2 class="card-title">Link This Device</h2>
        <p class="card-subtitle">
          Enter the PIN for<br />
          <span class="email-highlight">{remoteUser.email}</span>
        </p>

        <div class="pin-section">
          <div class="pin-row">
            {#each { length: remoteUser.codeLength } as _, i (i)}
              <input
                type="tel"
                inputmode="numeric"
                maxlength="1"
                class="pin-digit"
                bind:this={linkInputs[i]}
                oninput={(e) => handleDigitInput(linkDigits, i, e, linkInputs, autoSubmitLink)}
                onkeydown={(e) => handleDigitKeydown(linkDigits, i, e, linkInputs)}
                onpaste={(e) => handleDigitPaste(linkDigits, e, linkInputs, autoSubmitLink)}
                disabled={linkLoading || retryCountdown > 0}
              />
            {/each}
          </div>
        </div>

        {#if error}
          <p class="error-msg">{error}</p>
        {/if}

        {#if retryCountdown > 0}
          <p class="countdown-msg">Try again in {retryCountdown}s</p>
        {/if}

        {#if linkLoading}
          <div class="unlock-loading">
            <span class="spinner"></span>
            <span>Linking...</span>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<!-- ================================================================= -->
<!--                EMAIL CONFIRMATION MODAL                           -->
<!-- ================================================================= -->
{#if showConfirmationModal}
  <div class="modal-backdrop">
    <div class="modal-card">
      <div class="modal-gem-icon">
        <svg
          width="48"
          height="48"
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
      <h3 class="modal-title">Check Your Email</h3>
      <p class="modal-text">
        We sent a confirmation link to<br />
        <strong>{email}</strong>
      </p>
      <p class="modal-hint">Click the link in your email to activate your account.</p>
      <button class="btn-secondary" onclick={handleResendEmail} disabled={resendCooldown > 0}>
        {#if resendCooldown > 0}
          Resend in {resendCooldown}s
        {:else}
          Resend Email
        {/if}
      </button>
    </div>
  </div>
{/if}

<!-- ================================================================= -->
<!--              DEVICE VERIFICATION MODAL                            -->
<!-- ================================================================= -->
{#if showDeviceVerificationModal}
  <div class="modal-backdrop">
    <div class="modal-card">
      <div class="modal-gem-icon verification-icon">
        <svg
          width="48"
          height="48"
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
      </div>
      <h3 class="modal-title">Verify This Device</h3>
      <p class="modal-text">
        We sent a verification link to<br />
        <strong>{maskedEmail}</strong>
      </p>
      <p class="modal-hint">Approve this device from your email to continue.</p>
      <div class="modal-poll-indicator">
        <span class="spinner"></span>
        <span>Waiting for verification...</span>
      </div>
      <button class="btn-secondary" onclick={handleResendEmail} disabled={resendCooldown > 0}>
        {#if resendCooldown > 0}
          Resend in {resendCooldown}s
        {:else}
          Resend Email
        {/if}
      </button>
    </div>
  </div>
{/if}

<style>
  /* ================================================================= */
  /*                     CSS CUSTOM PROPERTIES                         */
  /* ================================================================= */

  :root {
    --login-void: #050510;
    --login-surface: rgba(18, 18, 38, 0.85);
    --login-surface-border: rgba(120, 90, 200, 0.15);
    --login-gem-primary: #a78bfa;
    --login-gem-secondary: #c4b5fd;
    --login-gem-accent: #7c3aed;
    --login-gem-rose: #f0abfc;
    --login-gem-teal: #5eead4;
    --login-text: #e8e4f0;
    --login-text-muted: #9890a8;
    --login-text-dim: #6b6280;
    --login-error: #fb7185;
    --login-success: #34d399;
    --login-radius: 20px;
    --login-radius-sm: 12px;
  }

  /* ================================================================= */
  /*                     FULL-SCREEN BACKGROUND                        */
  /* ================================================================= */

  .login-bg {
    position: fixed;
    inset: 0;
    background: var(--login-void);
    background-image:
      radial-gradient(ellipse 80% 60% at 20% 80%, rgba(124, 58, 237, 0.12) 0%, transparent 60%),
      radial-gradient(ellipse 60% 50% at 80% 20%, rgba(167, 139, 250, 0.08) 0%, transparent 50%),
      radial-gradient(ellipse 40% 40% at 50% 50%, rgba(94, 234, 212, 0.04) 0%, transparent 40%);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* ── Crystal Shard Decorations ── */

  .crystal-shard {
    position: absolute;
    border: 1px solid rgba(167, 139, 250, 0.08);
    pointer-events: none;
  }

  .shard-1 {
    width: 300px;
    height: 300px;
    top: -60px;
    right: -80px;
    background: linear-gradient(135deg, rgba(124, 58, 237, 0.06) 0%, transparent 70%);
    clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%);
    animation: shardFloat 20s ease-in-out infinite;
  }

  .shard-2 {
    width: 200px;
    height: 200px;
    bottom: 10%;
    left: -40px;
    background: linear-gradient(225deg, rgba(94, 234, 212, 0.05) 0%, transparent 70%);
    clip-path: polygon(50% 0%, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%);
    animation: shardFloat 25s ease-in-out infinite reverse;
  }

  .shard-3 {
    width: 160px;
    height: 160px;
    top: 30%;
    left: 15%;
    background: linear-gradient(315deg, rgba(240, 171, 252, 0.04) 0%, transparent 70%);
    clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
    animation: shardFloat 18s ease-in-out infinite;
    animation-delay: -5s;
  }

  .refraction-overlay {
    position: absolute;
    inset: 0;
    background: repeating-conic-gradient(
      from 0deg at 50% 50%,
      transparent 0deg 88deg,
      rgba(167, 139, 250, 0.015) 88deg 92deg
    );
    pointer-events: none;
  }

  @keyframes shardFloat {
    0%,
    100% {
      transform: translateY(0) rotate(0deg);
    }
    33% {
      transform: translateY(-12px) rotate(1.5deg);
    }
    66% {
      transform: translateY(8px) rotate(-1deg);
    }
  }

  /* ================================================================= */
  /*                       CENTER STAGE                                */
  /* ================================================================= */

  .center-stage {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    max-width: 420px;
    padding: 24px;
    opacity: 0;
    transform: translateY(16px) scale(0.97);
    transition:
      opacity 0.5s ease-out,
      transform 0.5s ease-out;
    z-index: 1;
  }

  .center-stage.mounted {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  /* ================================================================= */
  /*                        AUTH CARD                                   */
  /* ================================================================= */

  .auth-card {
    position: relative;
    width: 100%;
    background: var(--login-surface);
    border: 1px solid var(--login-surface-border);
    border-radius: var(--login-radius);
    padding: 36px 28px 32px;
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    box-shadow:
      0 4px 32px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(167, 139, 250, 0.06) inset;
    overflow: visible;
  }

  .auth-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 10%;
    right: 10%;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      var(--login-gem-secondary, #c4b5fd) 30%,
      rgba(255, 255, 255, 0.3) 50%,
      var(--login-gem-secondary, #c4b5fd) 70%,
      transparent
    );
    z-index: 2;
    border-radius: 1px;
  }

  .auth-card::after {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(
      var(--border-angle, 0deg),
      var(--login-gem-primary, #a78bfa),
      var(--login-gem-rose, #f0abfc),
      var(--login-gem-teal, #5eead4),
      var(--login-gem-primary, #a78bfa)
    );
    background-size: 300% 300%;
    -webkit-mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    mask:
      linear-gradient(#fff 0 0) content-box,
      linear-gradient(#fff 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    pointer-events: none;
    z-index: 1;
    opacity: 0.4;
    animation: cardBorderGlow 6s ease-in-out infinite;
  }

  @keyframes cardBorderGlow {
    0%,
    100% {
      background-position: 0% 50%;
      opacity: 0.25;
    }
    50% {
      background-position: 100% 50%;
      opacity: 0.5;
    }
  }

  .card-gem-accent {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 120px;
    height: 3px;
    background: linear-gradient(
      90deg,
      transparent,
      var(--login-gem-primary),
      var(--login-gem-teal),
      var(--login-gem-primary),
      transparent
    );
    border-radius: 0 0 4px 4px;
  }

  /* ── Shake Animation ── */

  .auth-card.shaking {
    animation: shake 0.5s ease-in-out;
  }

  @keyframes shake {
    0%,
    100% {
      transform: translateX(0);
    }
    15% {
      transform: translateX(-8px);
    }
    30% {
      transform: translateX(7px);
    }
    45% {
      transform: translateX(-6px);
    }
    60% {
      transform: translateX(4px);
    }
    75% {
      transform: translateX(-2px);
    }
  }

  /* ================================================================= */
  /*                      STEP INDICATOR                               */
  /* ================================================================= */

  .step-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    margin-bottom: 24px;
  }

  .step-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--login-text-dim);
    transition:
      background 0.3s ease,
      box-shadow 0.3s ease;
  }

  .step-dot.active {
    background: var(--login-gem-primary);
    box-shadow: 0 0 10px rgba(167, 139, 250, 0.5);
  }

  .step-dot.done {
    background: var(--login-gem-teal);
    box-shadow: 0 0 8px rgba(94, 234, 212, 0.4);
  }

  .step-line {
    width: 48px;
    height: 2px;
    background: var(--login-text-dim);
    transition: background 0.3s ease;
  }

  .step-line.filled {
    background: linear-gradient(90deg, var(--login-gem-teal), var(--login-gem-primary));
  }

  /* ================================================================= */
  /*                     STEP CONTENT ANIMATION                        */
  /* ================================================================= */

  @keyframes fadeSlideIn {
    from {
      opacity: 0;
      transform: translateX(20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .step-content {
    display: flex;
    flex-direction: column;
  }

  /* ================================================================= */
  /*                     CARD TYPOGRAPHY                                */
  /* ================================================================= */

  .card-title {
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--login-text);
    margin: 0 0 6px;
    letter-spacing: -0.02em;
    text-align: center;
  }

  .card-subtitle {
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.875rem;
    color: var(--login-text-muted);
    margin: 0 0 28px;
    line-height: 1.5;
    text-align: center;
  }

  .card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 20px;
    color: var(--login-gem-primary);
    animation: brandIconPulse 3s ease-in-out infinite;
  }

  @keyframes brandIconPulse {
    0%,
    100% {
      transform: scale(1);
      filter: drop-shadow(0 0 8px rgba(124, 58, 237, 0.3));
    }
    50% {
      transform: scale(1.06);
      filter: drop-shadow(0 0 16px rgba(124, 58, 237, 0.5));
    }
  }

  .offline-icon {
    color: var(--login-text-muted);
  }

  .link-icon {
    color: var(--login-gem-teal);
  }

  .email-highlight {
    color: var(--login-gem-secondary);
    font-weight: 500;
  }

  /* ================================================================= */
  /*                     FORM INPUTS                                   */
  /* ================================================================= */

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
    flex: 1;
  }

  .form-label {
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--login-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .form-input {
    width: 100%;
    padding: 12px 14px;
    background: rgba(10, 10, 26, 0.6);
    border: 1px solid rgba(120, 90, 200, 0.12);
    border-radius: var(--login-radius-sm);
    color: var(--login-text);
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.9375rem;
    outline: none;
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease;
    box-sizing: border-box;
  }

  .form-input::placeholder {
    color: var(--login-text-dim);
  }

  .form-input:focus {
    border-color: var(--login-gem-primary);
    box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.1);
  }

  .form-input:disabled {
    opacity: 0.5;
  }

  .name-row {
    display: flex;
    gap: 12px;
  }

  /* ================================================================= */
  /*                     PIN DIGIT INPUTS                               */
  /* ================================================================= */

  .pin-section {
    margin-bottom: 20px;
  }

  .pin-label {
    display: block;
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--login-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 10px;
    text-align: center;
  }

  .pin-row {
    display: flex;
    gap: 8px;
    justify-content: center;
  }

  .pin-digit {
    width: 44px;
    height: 52px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 1.25rem;
    font-weight: 500;
    color: var(--login-text);
    background: rgba(10, 10, 26, 0.7);
    border: 1.5px solid rgba(120, 90, 200, 0.15);
    border-radius: 10px;
    outline: none;
    caret-color: var(--login-gem-primary);
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease,
      background 0.2s ease,
      transform 0.2s ease;
  }

  .pin-digit:focus {
    border-color: var(--login-gem-primary);
    box-shadow:
      0 0 0 3px rgba(124, 58, 237, 0.2),
      0 0 20px rgba(124, 58, 237, 0.1);
    transform: scale(1.08);
    background: rgba(124, 58, 237, 0.06);
  }

  .pin-digit:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ================================================================= */
  /*                     BUTTONS                                       */
  /* ================================================================= */

  .btn-primary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 14px 20px;
    margin-top: 8px;
    background: linear-gradient(135deg, var(--login-gem-accent), var(--login-gem-primary));
    color: #fff;
    border: none;
    border-radius: var(--login-radius-sm);
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    letter-spacing: 0.01em;
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.92;
    transform: translateY(-2px) scale(1.02);
    box-shadow:
      0 8px 24px rgba(124, 58, 237, 0.3),
      0 0 40px rgba(124, 58, 237, 0.15);
  }

  .btn-primary:active:not(:disabled) {
    transform: translateY(0) scale(0.98);
  }

  .btn-primary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn-arrow {
    transition: transform 0.2s ease;
  }

  .btn-primary:hover:not(:disabled) .btn-arrow {
    transform: translateX(3px);
  }

  .btn-secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 12px 24px;
    background: rgba(167, 139, 250, 0.1);
    color: var(--login-gem-secondary);
    border: 1px solid rgba(167, 139, 250, 0.2);
    border-radius: var(--login-radius-sm);
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background 0.2s ease,
      border-color 0.2s ease;
  }

  .btn-secondary:hover:not(:disabled) {
    background: rgba(167, 139, 250, 0.18);
    border-color: rgba(167, 139, 250, 0.35);
  }

  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    color: var(--login-text-muted);
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    cursor: pointer;
    padding: 0;
    margin-bottom: 16px;
    transition: color 0.2s ease;
    align-self: flex-start;
  }

  .back-link:hover {
    color: var(--login-text);
  }

  /* ================================================================= */
  /*                     WELCOME AVATAR                                */
  /* ================================================================= */

  .welcome-avatar {
    position: relative;
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--login-gem-accent), var(--login-gem-primary));
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 20px;
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 1.5rem;
    font-weight: 700;
    color: #fff;
    box-shadow: 0 0 24px rgba(124, 58, 237, 0.25);
  }

  .welcome-avatar::before {
    content: '';
    position: absolute;
    inset: -8px;
    border-radius: 50%;
    border: 1.5px solid transparent;
    border-top-color: var(--login-gem-primary, #a78bfa);
    border-right-color: var(--login-gem-primary, #a78bfa);
    animation: avatarRingSpin 8s linear infinite;
    opacity: 0.5;
  }

  .welcome-avatar::after {
    content: '';
    position: absolute;
    inset: -14px;
    border-radius: 50%;
    border: 1px dashed transparent;
    border-bottom-color: var(--login-gem-teal, #5eead4);
    border-left-color: var(--login-gem-teal, #5eead4);
    animation: avatarRingSpin 12s linear infinite reverse;
    opacity: 0.3;
  }

  @keyframes avatarRingSpin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  /* ================================================================= */
  /*                     ERROR / STATUS MESSAGES                       */
  /* ================================================================= */

  .error-msg {
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    color: var(--login-error);
    text-align: center;
    margin: 4px 0 8px;
    padding: 8px 12px;
    background: rgba(251, 113, 133, 0.08);
    border-radius: 8px;
    border: 1px solid rgba(251, 113, 133, 0.12);
  }

  .countdown-msg {
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    color: var(--login-text-muted);
    text-align: center;
    margin: 4px 0 0;
  }

  .unlock-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 16px;
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.875rem;
    color: var(--login-text-muted);
  }

  /* ================================================================= */
  /*                     SPINNER                                       */
  /* ================================================================= */

  .spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(167, 139, 250, 0.2);
    border-top-color: var(--login-gem-primary);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ================================================================= */
  /*                     CRYSTAL LOADER                                */
  /* ================================================================= */

  .crystal-loader {
    position: relative;
    width: 64px;
    height: 64px;
    margin: 0 auto 20px;
  }

  .facet {
    position: absolute;
    inset: 0;
    border: 2px solid transparent;
    border-radius: 50%;
  }

  .facet-1 {
    border-top-color: var(--login-gem-primary);
    animation: spin 1.2s linear infinite;
  }

  .facet-2 {
    inset: 6px;
    border-right-color: var(--login-gem-teal);
    animation: spin 1.8s linear infinite reverse;
  }

  .facet-3 {
    inset: 12px;
    border-bottom-color: var(--login-gem-rose);
    animation: spin 1s linear infinite;
  }

  .resolving-text {
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.875rem;
    color: var(--login-text-muted);
    text-align: center;
    letter-spacing: 0.04em;
  }

  /* ================================================================= */
  /*                     MODAL BACKDROP + CARD                         */
  /* ================================================================= */

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(5, 5, 16, 0.85);
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
    background: var(--login-surface);
    border: 1px solid var(--login-surface-border);
    border-radius: var(--login-radius);
    padding: 36px 28px 28px;
    max-width: 380px;
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

  .modal-gem-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 72px;
    height: 72px;
    margin: 0 auto 20px;
    border-radius: 50%;
    background: rgba(167, 139, 250, 0.1);
    color: var(--login-gem-primary);
    border: 1px solid rgba(167, 139, 250, 0.15);
  }

  .modal-gem-icon.verification-icon {
    background: rgba(94, 234, 212, 0.08);
    color: var(--login-gem-teal);
    border-color: rgba(94, 234, 212, 0.15);
  }

  .modal-title {
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--login-text);
    margin: 0 0 10px;
    letter-spacing: -0.01em;
  }

  .modal-text {
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.875rem;
    color: var(--login-text-muted);
    margin: 0 0 8px;
    line-height: 1.6;
  }

  .modal-text strong {
    color: var(--login-gem-secondary);
    font-weight: 500;
  }

  .modal-hint {
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    color: var(--login-text-dim);
    margin: 0 0 24px;
    line-height: 1.5;
  }

  .modal-poll-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: 20px;
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.8125rem;
    color: var(--login-text-muted);
  }

  /* ================================================================= */
  /*                     RESPONSIVE                                    */
  /* ================================================================= */

  @media (max-width: 480px) {
    .center-stage {
      padding: 1.5rem;
    }

    .auth-card {
      padding: 1.5rem;
    }

    .card-title {
      font-size: 1.375rem;
    }

    .pin-digit {
      width: 40px;
      height: 48px;
      font-size: 1.125rem;
    }

    .pin-row {
      gap: 6px;
    }

    .shard-1 {
      width: 200px;
      height: 200px;
    }

    .crystal-shard.shard-3 {
      display: none;
    }
  }

  /* ── iPhone 16 Pro / 15 Pro / 14 Pro (390px–429px) ── */

  @media (min-width: 390px) and (max-width: 429px) {
    .center-stage {
      padding: 1.25rem;
      gap: 1.75rem;
    }
    .auth-card {
      padding: 2rem;
      border-radius: 22px;
    }
    .card-title {
      font-size: 1.5rem;
    }
    .form-input {
      padding: 1rem 1.125rem;
      border-radius: 14px;
    }
    .btn-primary {
      padding: 1.125rem;
      font-size: 1.0625rem;
      border-radius: 14px;
    }
    .welcome-avatar {
      width: 72px;
      height: 72px;
      font-size: 1.75rem;
    }
    .pin-digit {
      width: 40px;
      height: 48px;
      font-size: 1.25rem;
    }
    .pin-row {
      gap: 0.375rem;
    }
  }

  /* ── iPhone 16 Pro Max / 15 Pro Max (430px–480px) ── */

  @media (min-width: 430px) and (max-width: 480px) {
    .center-stage {
      padding: 1.5rem;
      gap: 2rem;
    }
    .auth-card {
      padding: 2.25rem;
    }
    .card-title {
      font-size: 1.5rem;
    }
    .welcome-avatar {
      width: 80px;
      height: 80px;
      font-size: 2rem;
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

  /* ── Small phones / iPhone SE (≤389px) ── */

  @media (max-width: 389px) {
    .center-stage {
      padding: 1rem;
      gap: 1.25rem;
    }
    .auth-card {
      padding: 1.25rem;
    }
    .card-title {
      font-size: 1.25rem;
    }
    .card-subtitle {
      font-size: 0.8125rem;
    }
    .name-row {
      grid-template-columns: 1fr;
    }
    .btn-primary {
      padding: 0.875rem;
      font-size: 0.9375rem;
    }
    .welcome-avatar {
      width: 60px;
      height: 60px;
      font-size: 1.5rem;
    }
    .pin-digit {
      width: 36px;
      height: 44px;
      font-size: 1.125rem;
    }
    .pin-row {
      gap: 0.25rem;
    }
    .crystal-shard.shard-2,
    .crystal-shard.shard-3 {
      display: none;
    }
  }

  /* ================================================================= */
  /*                     REDUCED MOTION                                */
  /* ================================================================= */

  @media (prefers-reduced-motion: reduce) {
    .auth-card::after {
      animation: none;
      opacity: 0.3;
    }
    .welcome-avatar::before,
    .welcome-avatar::after {
      animation: none;
    }
    .card-icon {
      animation: none;
    }
  }
</style>
