<script lang="ts">
  /**
   * @fileoverview Login / unlock / device-link page — primary auth entry point.
   *
   * This page serves **three distinct modes** depending on the state of
   * the single-user local auth system:
   *
   * 1. **Setup Mode** — First visit, no account exists yet. A two-step
   *    wizard collects email + name (step 1) then a 6-digit PIN with
   *    confirmation (step 2). May show an email-confirmation modal.
   *
   * 2. **Unlock Mode** — Account already set up on this device. The user
   *    enters their 6-digit PIN to unlock. On untrusted devices, a
   *    device-verification modal (email OTP) appears after the code.
   *
   * 3. **Link Device Mode** — A remote user exists (fetched via
   *    `fetchRemoteGateConfig`) but this device has no local keys yet.
   *    The user enters their existing PIN to link this device.
   *
   * Cross-tab communication is handled via `BroadcastChannel` —
   * the `/confirm` page broadcasts `AUTH_CONFIRMED` which this page
   * listens for to auto-complete verification without a manual refresh.
   *
   * Visual design: warm gold gem/crystal theme with faceted shards,
   * prismatic light bands, and crystal refractions — all pure CSS.
   */

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

  // =============================================================================
  //  Layout / Page Data
  // =============================================================================

  /** Whether this device has a linked single-user account (derived from IndexedDB, not layout data) */
  let deviceLinked = $state(false);

  /** Post-login redirect URL — validated to prevent open-redirect attacks */
  const redirectUrl = $derived.by(() => {
    const param = $page.url.searchParams.get('redirect');
    if (param && isSafeRedirect(param)) return param;
    return '/';
  });

  // =============================================================================
  //  Shared UI State
  // =============================================================================

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

    /* ── Demo mode → redirect to home (demo users shouldn't see PIN entry) ── */
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
        loading = false;
        await tick();
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
        loading = false;
        await tick();
        if (unlockInputs[0]) unlockInputs[0].focus();
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
        linkLoading = false;
        await tick();
        if (linkInputs[0]) linkInputs[0].focus();
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
  <title>{deviceLinked ? 'Unlock' : 'Welcome'} - Radiant Finance</title>
</svelte:head>

<!-- Page Root — gem/crystal-themed full-viewport login -->
<div class="login-page" class:mounted>
  <!-- Starfield (fixed backdrop, always covers viewport) — renders as crystal facet grid -->
  <div class="starfield">
    <div class="stars stars-small"></div>
    <div class="stars stars-medium"></div>
    <div class="stars stars-large"></div>
  </div>

  <!-- Nebula Effects (fixed, ambient color orbs) — renders as prismatic light bands -->
  <div class="nebula nebula-1"></div>
  <div class="nebula nebula-2"></div>
  <div class="nebula nebula-3"></div>

  <!-- Background Effects (clipped separately so content can scroll) -->
  <div class="background-effects">
    <!-- Orbital Rings — renders as angular facet refraction lines -->
    <div class="orbital-system">
      <div class="orbit orbit-1"></div>
      <div class="orbit orbit-2"></div>
      <div class="orbit orbit-3"></div>
      <div class="orbit-particle particle-1"></div>
      <div class="orbit-particle particle-2"></div>
      <div class="orbit-particle particle-3"></div>
    </div>

    <!-- Shooting Stars — renders as prismatic light streaks -->
    <div class="shooting-star shooting-star-1"></div>
    <div class="shooting-star shooting-star-2"></div>

    <!-- Floating Particles — renders as tiny crystal shards -->
    <div class="particles">
      {#each Array(15) as _, _i (_i)}
        <span
          class="particle"
          style="
            --delay: {Math.random() * 5}s;
            --duration: {5 + Math.random() * 10}s;
            --x-start: {Math.random() * 100}%;
            --y-start: {Math.random() * 100}%;
            --size: {2 + Math.random() * 3}px;
            --opacity: {0.2 + Math.random() * 0.4};
          "
        ></span>
      {/each}
    </div>
  </div>

  <!-- Login Content — centered card area -->
  <div class="login-content">
    <!-- Brand Header — logo + title + tagline -->
    <div class="brand">
      <div class="brand-icon">
        <div class="brand-glow"></div>
        <svg width="48" height="48" viewBox="0 0 100 100" fill="none">
          <circle
            cx="50"
            cy="50"
            r="45"
            stroke="url(#loginBrandGrad)"
            stroke-width="5"
            fill="none"
          />
          <path
            d="M30 52 L45 67 L72 35"
            stroke="url(#loginCheckGrad)"
            stroke-width="6"
            stroke-linecap="round"
            stroke-linejoin="round"
            fill="none"
          />
          <defs>
            <linearGradient id="loginBrandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#d4a039" />
              <stop offset="100%" stop-color="#e85d75" />
            </linearGradient>
            <linearGradient id="loginCheckGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#34d399" />
              <stop offset="100%" stop-color="#2ec4a6" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <h1 class="brand-title">Radiant</h1>
      <p class="brand-tagline">Your personal finance vault</p>
    </div>

    <!-- Mode cards (hidden while resolving initial auth state) -->
    {#if resolving}
      <div class="login-card resolving-card">
        <div class="card-glow"></div>
        <div class="card-inner">
          <div class="resolving-loader">
            <div class="resolving-orb">
              <div class="resolving-orb-core"></div>
              <div class="resolving-orb-ring"></div>
              <div class="resolving-orb-ring resolving-orb-ring-2"></div>
            </div>
            <div class="resolving-shimmer-line"></div>
            <div class="resolving-shimmer-line resolving-shimmer-short"></div>
          </div>
        </div>
      </div>
    {:else if deviceLinked}
      <div class="login-card" class:shake={shaking}>
        <div class="card-glow"></div>
        <div class="card-inner">
          <!-- User avatar + welcome message -->
          <div class="unlock-user-info">
            <div class="avatar-wrapper">
              <div class="avatar-ring-outer"></div>
              <div class="avatar-ring-inner"></div>
              <div class="avatar">
                {(userInfo?.firstName || 'U').charAt(0).toUpperCase()}
              </div>
            </div>
            <h2 class="card-title">
              Welcome back{userInfo?.firstName ? `, ${userInfo.firstName}` : ''}
            </h2>
            <p class="card-subtitle">Enter your code to continue</p>
          </div>

          <!-- PIN code entry -->
          <div class="form-fields">
            <div class="form-group">
              <div class="code-label">Access Code</div>
              {#if loading}
                <div class="code-loading">
                  <span class="loading-spinner"></span>
                </div>
              {:else}
                <div class="code-input-group">
                  {#each unlockDigits as digit, i (i)}
                    <div class="code-digit-wrapper" class:filled={digit !== ''}>
                      <input
                        class="code-digit"
                        type="tel"
                        inputmode="numeric"
                        pattern="[0-9]"
                        maxlength="1"
                        bind:this={unlockInputs[i]}
                        value={digit}
                        oninput={(e) =>
                          handleDigitInput(unlockDigits, i, e, unlockInputs, autoSubmitUnlock)}
                        onkeydown={(e) => handleDigitKeydown(unlockDigits, i, e, unlockInputs)}
                        onpaste={(e) =>
                          handleDigitPaste(unlockDigits, e, unlockInputs, autoSubmitUnlock)}
                        disabled={loading || retryCountdown > 0}
                        autocomplete="off"
                      />
                    </div>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- Error message with retry countdown -->
            {#if error}
              <div class="message error">
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
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}{retryCountdown > 0 ? ` (${retryCountdown}s)` : ''}</span>
              </div>
            {/if}
          </div>
        </div>
      </div>

      <!-- Mode: Link Device (new device, existing remote user) -->
    {:else if linkMode && remoteUser}
      <div class="login-card" class:shake={shaking}>
        <div class="card-glow"></div>
        <div class="card-inner">
          <!-- Remote user avatar + welcome message -->
          <div class="unlock-user-info">
            <div class="avatar-wrapper">
              <div class="avatar-ring-outer"></div>
              <div class="avatar-ring-inner"></div>
              <div class="avatar">
                {((remoteUser.profile?.firstName as string) || 'U').charAt(0).toUpperCase()}
              </div>
            </div>
            <h2 class="card-title">
              Welcome back{remoteUser.profile?.firstName ? `, ${remoteUser.profile.firstName}` : ''}
            </h2>
            <p class="card-subtitle">Enter your code to link this device</p>
          </div>

          <!-- PIN code entry for device linking -->
          <div class="form-fields">
            <div class="form-group">
              <div class="code-label">Access Code</div>
              {#if linkLoading}
                <div class="code-loading">
                  <span class="loading-spinner"></span>
                </div>
              {:else}
                <div class="code-input-group">
                  {#each linkDigits as digit, i (i)}
                    <div class="code-digit-wrapper" class:filled={digit !== ''}>
                      <input
                        class="code-digit"
                        type="tel"
                        inputmode="numeric"
                        pattern="[0-9]"
                        maxlength="1"
                        bind:this={linkInputs[i]}
                        value={digit}
                        oninput={(e) =>
                          handleDigitInput(linkDigits, i, e, linkInputs, autoSubmitLink)}
                        onkeydown={(e) => handleDigitKeydown(linkDigits, i, e, linkInputs)}
                        onpaste={(e) => handleDigitPaste(linkDigits, e, linkInputs, autoSubmitLink)}
                        disabled={linkLoading || retryCountdown > 0}
                        autocomplete="off"
                      />
                    </div>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- Error message with retry countdown -->
            {#if error}
              <div class="message error">
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
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}{retryCountdown > 0 ? ` (${retryCountdown}s)` : ''}</span>
              </div>
            {/if}
          </div>
        </div>
      </div>

      <!-- Mode: Offline, No Setup -->
    {:else if offlineNoSetup}
      <div class="login-card">
        <div class="card-glow"></div>
        <div class="card-inner">
          <div class="unlock-user-info">
            <h2 class="card-title">Setup Required</h2>
            <p class="card-subtitle">An internet connection is required to set up this device</p>
          </div>
        </div>
      </div>

      <!-- Mode: Setup (first-time account creation) -->
    {:else}
      <div class="login-card">
        <div class="card-glow"></div>
        <div class="card-inner">
          <!-- Step 1: Email + Name -->
          {#if setupStep === 1}
            <div class="setup-step">
              <!-- Step indicator dots (1 active, 2 pending) -->
              <div class="step-indicator">
                <div class="step-dot active"></div>
                <div class="step-line"></div>
                <div class="step-dot"></div>
              </div>

              <h2 class="card-title">Welcome to Radiant</h2>
              <p class="card-subtitle">Let's get you set up</p>

              <div class="form-fields">
                <!-- Email input -->
                <div class="form-group">
                  <label for="email">Email</label>
                  <div class="input-wrapper">
                    <input
                      type="email"
                      id="email"
                      bind:value={email}
                      required
                      disabled={loading}
                      placeholder="you@example.com"
                    />
                    <div class="input-glow"></div>
                  </div>
                </div>

                <!-- First / Last name side-by-side -->
                <div class="name-row">
                  <div class="form-group">
                    <label for="firstName">First Name</label>
                    <div class="input-wrapper">
                      <input
                        type="text"
                        id="firstName"
                        bind:value={firstName}
                        required
                        disabled={loading}
                        placeholder="John"
                      />
                      <div class="input-glow"></div>
                    </div>
                  </div>

                  <div class="form-group">
                    <label for="lastName">Last Name</label>
                    <div class="input-wrapper">
                      <input
                        type="text"
                        id="lastName"
                        bind:value={lastName}
                        disabled={loading}
                        placeholder="Doe"
                      />
                      <div class="input-glow"></div>
                    </div>
                  </div>
                </div>

                <!-- Validation error -->
                {#if error}
                  <div class="message error">
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
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{error}</span>
                  </div>
                {/if}

                <!-- Continue button → advance to step 2 -->
                <button type="button" class="btn btn-primary submit-btn" onclick={goToCodeStep}>
                  Continue
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
                    <path d="M5 12h14" />
                    <path d="M12 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Step 2: PIN Code Creation + Confirmation -->
          {:else}
            <div class="setup-step" class:shake={shaking}>
              <!-- Step indicator dots (1 completed, 2 active) -->
              <div class="step-indicator">
                <div class="step-dot completed">
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div class="step-line active"></div>
                <div class="step-dot active"></div>
              </div>

              <!-- Back button to return to step 1 -->
              <button type="button" class="back-link" onclick={goBackToNameStep}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M19 12H5" />
                  <path d="M12 19l-7-7 7-7" />
                </svg>
                Back
              </button>

              <h2 class="card-title">Create Your Code</h2>
              <p class="card-subtitle">
                Choose a 6-digit code to secure your account, {firstName.trim()}
              </p>

              <div class="form-fields">
                <!-- Primary code entry -->
                <div class="form-group">
                  <div class="code-label">Your Code</div>
                  <div class="code-input-group">
                    {#each codeDigits as digit, i (i)}
                      <div class="code-digit-wrapper" class:filled={digit !== ''}>
                        <input
                          class="code-digit"
                          type="tel"
                          inputmode="numeric"
                          pattern="[0-9]"
                          maxlength="1"
                          bind:this={codeInputs[i]}
                          value={digit}
                          oninput={(e) =>
                            handleDigitInput(codeDigits, i, e, codeInputs, autoFocusConfirm)}
                          onkeydown={(e) => handleDigitKeydown(codeDigits, i, e, codeInputs)}
                          onpaste={(e) =>
                            handleDigitPaste(codeDigits, e, codeInputs, autoFocusConfirm)}
                          disabled={loading}
                          autocomplete="off"
                        />
                      </div>
                    {/each}
                  </div>
                </div>

                <!-- Confirmation code entry -->
                <div class="form-group">
                  <div class="code-label">Confirm Code</div>
                  {#if loading}
                    <div class="code-loading">
                      <span class="loading-spinner"></span>
                    </div>
                  {:else}
                    <div class="code-input-group">
                      {#each confirmDigits as digit, i (i)}
                        <div class="code-digit-wrapper" class:filled={digit !== ''}>
                          <input
                            class="code-digit"
                            type="tel"
                            inputmode="numeric"
                            pattern="[0-9]"
                            maxlength="1"
                            bind:this={confirmInputs[i]}
                            value={digit}
                            oninput={(e) =>
                              handleDigitInput(confirmDigits, i, e, confirmInputs, autoSubmitSetup)}
                            onkeydown={(e) =>
                              handleDigitKeydown(confirmDigits, i, e, confirmInputs)}
                            onpaste={(e) =>
                              handleDigitPaste(confirmDigits, e, confirmInputs, autoSubmitSetup)}
                            disabled={loading}
                            autocomplete="off"
                          />
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>

                <!-- Error message -->
                {#if error}
                  <div class="message error">
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
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    <span>{error}</span>
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <!-- Email Confirmation Modal (after setup) -->
  {#if showConfirmationModal}
    <div class="modal-overlay">
      <div class="modal-card">
        <div class="card-glow"></div>
        <div class="card-inner">
          <!-- Mail icon -->
          <div class="modal-icon">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="url(#mailGrad)"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M22 7l-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7" />
              <defs>
                <linearGradient id="mailGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#d4a039" />
                  <stop offset="100%" stop-color="#2ec4a6" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h2 class="card-title">Check your email</h2>
          <p class="card-subtitle">
            We sent a confirmation link to <strong>{email}</strong>. Click it to activate your
            account.
          </p>
          <!-- Resend button with cooldown -->
          <button
            type="button"
            class="btn btn-primary submit-btn"
            onclick={handleResendEmail}
            disabled={resendCooldown > 0}
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend email'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Device Verification Modal (after unlock on untrusted device) -->
  {#if showDeviceVerificationModal}
    <div class="modal-overlay">
      <div class="modal-card">
        <div class="card-glow"></div>
        <div class="card-inner">
          <!-- Shield icon -->
          <div class="modal-icon">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="url(#shieldGrad)"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <defs>
                <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="#e85d75" />
                  <stop offset="100%" stop-color="#d4a039" />
                </linearGradient>
              </defs>
            </svg>
          </div>
          <h2 class="card-title">New device detected</h2>
          <p class="card-subtitle">
            We sent a verification link to <strong>{maskedEmail}</strong>. Click it to trust this
            device.
          </p>
          <p class="card-hint">This page will update automatically once verified.</p>
          <!-- Resend button with cooldown -->
          <button
            type="button"
            class="btn btn-primary submit-btn"
            onclick={handleResendEmail}
            disabled={resendCooldown > 0}
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend email'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* =================================================================================
     CSS CUSTOM PROPERTIES — Radiant warm gold / citrine / ruby palette
     ================================================================================= */

  :root {
    --r-void: #0a0806;
    --r-surface: rgba(20, 16, 10, 0.92);
    --r-surface-border: rgba(180, 140, 50, 0.15);
    --r-gold: #d4a039;
    --r-gold-light: #e8b94a;
    --r-gold-deep: #b8862e;
    --r-gold-pale: #f0d080;
    --r-ruby: #e85d75;
    --r-teal: #2ec4a6;
    --r-emerald: #34d399;
    --r-text: #f0e8d0;
    --r-text-muted: #a09478;
    --r-text-dim: #706450;
    --r-error: #fb7185;
    --r-radius-2xl: 24px;
    --r-radius-lg: 14px;
    --r-font:
      'SF Pro Display', 'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui,
      sans-serif;
  }

  /* =================================================================================
     LOGIN PAGE CONTAINER
     ================================================================================= */

  .login-page {
    inset: 0;
    z-index: 200;
    position: fixed;
    height: calc(100vh + env(safe-area-inset-top, 0px) + env(safe-area-inset-bottom, 0px));
    margin-top: calc(-1 * env(safe-area-inset-top, 0px));
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden auto;
    background: radial-gradient(
      ellipse at center,
      rgba(20, 16, 10, 1) 0%,
      rgba(10, 8, 6, 1) 50%,
      rgba(5, 4, 2, 1) 100%
    );
  }

  .background-effects {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  /* =================================================================================
     STARFIELD — Crystal facet grid (angular refraction lines instead of stars)
     ================================================================================= */

  .starfield {
    position: fixed;
    inset: 0;
    pointer-events: none;
  }

  .stars {
    position: absolute;
    inset: 0;
    background-repeat: repeat;
  }

  /* Fine facet-refraction pinpoints */
  .stars-small {
    background-image:
      radial-gradient(1px 1px at 10% 20%, rgba(240, 208, 128, 0.5) 0%, transparent 100%),
      radial-gradient(1px 1px at 30% 70%, rgba(240, 208, 128, 0.35) 0%, transparent 100%),
      radial-gradient(1px 1px at 50% 10%, rgba(232, 185, 74, 0.45) 0%, transparent 100%),
      radial-gradient(1px 1px at 70% 50%, rgba(212, 160, 57, 0.3) 0%, transparent 100%),
      radial-gradient(1px 1px at 90% 80%, rgba(240, 208, 128, 0.35) 0%, transparent 100%),
      radial-gradient(1px 1px at 15% 90%, rgba(184, 134, 46, 0.25) 0%, transparent 100%),
      radial-gradient(1px 1px at 85% 15%, rgba(232, 185, 74, 0.3) 0%, transparent 100%),
      radial-gradient(1px 1px at 45% 45%, rgba(240, 208, 128, 0.35) 0%, transparent 100%);
    background-size: 200px 200px;
    animation: starsDrift 100s linear infinite;
  }

  /* Colored crystal gleams */
  .stars-medium {
    background-image:
      radial-gradient(1.5px 1.5px at 20% 30%, rgba(212, 160, 57, 0.7) 0%, transparent 100%),
      radial-gradient(1.5px 1.5px at 60% 80%, rgba(232, 93, 117, 0.5) 0%, transparent 100%),
      radial-gradient(1.5px 1.5px at 80% 20%, rgba(46, 196, 166, 0.5) 0%, transparent 100%),
      radial-gradient(1.5px 1.5px at 40% 60%, rgba(232, 185, 74, 0.4) 0%, transparent 100%);
    background-size: 300px 300px;
    animation: starsDrift 150s linear infinite reverse;
  }

  /* Bright crystal highlights */
  .stars-large {
    background-image:
      radial-gradient(2px 2px at 25% 25%, rgba(240, 232, 208, 0.8) 0%, transparent 100%),
      radial-gradient(2.5px 2.5px at 75% 75%, rgba(212, 160, 57, 0.9) 0%, transparent 100%),
      radial-gradient(2px 2px at 50% 90%, rgba(232, 93, 117, 0.6) 0%, transparent 100%);
    background-size: 400px 400px;
    animation:
      starsTwinkle 4s ease-in-out infinite,
      starsDrift 200s linear infinite;
  }

  @keyframes starsDrift {
    from {
      transform: translateY(0) translateX(0);
    }
    to {
      transform: translateY(-100px) translateX(-50px);
    }
  }

  @keyframes starsTwinkle {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }

  /* =================================================================================
     NEBULA — Prismatic light bands (warm gold / ruby / teal washes)
     ================================================================================= */

  .nebula {
    position: fixed;
    border-radius: 50%;
    filter: blur(80px);
    opacity: 0.5;
    pointer-events: none;
  }

  .nebula-1 {
    width: 700px;
    height: 700px;
    top: -250px;
    right: -200px;
    background: radial-gradient(ellipse, rgba(212, 160, 57, 0.45) 0%, transparent 70%);
    animation:
      nebulaPulse 8s ease-in-out infinite,
      nebulaFloat 20s ease-in-out infinite;
  }

  .nebula-2 {
    width: 600px;
    height: 600px;
    bottom: -200px;
    left: -150px;
    background: radial-gradient(ellipse, rgba(232, 93, 117, 0.35) 0%, transparent 70%);
    animation:
      nebulaPulse 10s ease-in-out infinite 2s,
      nebulaFloat 25s ease-in-out infinite reverse;
  }

  .nebula-3 {
    width: 500px;
    height: 500px;
    top: 40%;
    left: 60%;
    transform: translate(-50%, -50%);
    background: radial-gradient(ellipse, rgba(46, 196, 166, 0.2) 0%, transparent 70%);
    animation: nebulaPulse 12s ease-in-out infinite 4s;
  }

  @keyframes nebulaPulse {
    0%,
    100% {
      opacity: 0.35;
      transform: scale(1);
    }
    50% {
      opacity: 0.55;
      transform: scale(1.1);
    }
  }

  @keyframes nebulaFloat {
    0%,
    100% {
      transform: translate(0, 0);
    }
    33% {
      transform: translate(30px, -20px);
    }
    66% {
      transform: translate(-20px, 30px);
    }
  }

  /* =================================================================================
     ORBITAL SYSTEM — Angular facet refraction lines (hexagonal rotation paths)
     ================================================================================= */

  .orbital-system {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .orbit {
    position: absolute;
    top: 50%;
    left: 50%;
    border: 1px solid rgba(212, 160, 57, 0.08);
    transform: translate(-50%, -50%);
    clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
  }

  .orbit-1 {
    width: 400px;
    height: 400px;
    animation: orbitRotate 40s linear infinite;
  }
  .orbit-2 {
    width: 600px;
    height: 600px;
    border-color: rgba(232, 93, 117, 0.06);
    animation: orbitRotate 60s linear infinite reverse;
  }
  .orbit-3 {
    width: 800px;
    height: 800px;
    border-color: rgba(46, 196, 166, 0.04);
    animation: orbitRotate 80s linear infinite;
  }

  @keyframes orbitRotate {
    from {
      transform: translate(-50%, -50%) rotate(0deg);
    }
    to {
      transform: translate(-50%, -50%) rotate(360deg);
    }
  }

  .orbit-particle {
    position: absolute;
    width: 6px;
    height: 6px;
    top: 50%;
    left: 50%;
    clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
  }

  .particle-1 {
    background: var(--r-gold);
    box-shadow:
      0 0 15px rgba(212, 160, 57, 0.5),
      0 0 30px rgba(212, 160, 57, 0.25);
    animation: orbitParticle1 40s linear infinite;
  }

  .particle-2 {
    background: var(--r-ruby);
    box-shadow:
      0 0 15px rgba(232, 93, 117, 0.4),
      0 0 30px rgba(232, 93, 117, 0.2);
    animation: orbitParticle2 60s linear infinite reverse;
    width: 4px;
    height: 4px;
  }

  .particle-3 {
    background: var(--r-teal);
    box-shadow:
      0 0 15px rgba(46, 196, 166, 0.4),
      0 0 30px rgba(46, 196, 166, 0.2);
    animation: orbitParticle3 80s linear infinite;
    width: 5px;
    height: 5px;
  }

  @keyframes orbitParticle1 {
    from {
      transform: rotate(0deg) translateX(200px) rotate(0deg);
    }
    to {
      transform: rotate(360deg) translateX(200px) rotate(-360deg);
    }
  }
  @keyframes orbitParticle2 {
    from {
      transform: rotate(0deg) translateX(300px) rotate(0deg);
    }
    to {
      transform: rotate(360deg) translateX(300px) rotate(-360deg);
    }
  }
  @keyframes orbitParticle3 {
    from {
      transform: rotate(0deg) translateX(400px) rotate(0deg);
    }
    to {
      transform: rotate(360deg) translateX(400px) rotate(-360deg);
    }
  }

  /* =================================================================================
     SHOOTING STARS — Prismatic light streaks (gold/ruby angular flares)
     ================================================================================= */

  .shooting-star {
    position: absolute;
    width: 120px;
    height: 2px;
    background: linear-gradient(
      90deg,
      rgba(240, 208, 128, 0) 0%,
      rgba(240, 208, 128, 0.6) 50%,
      rgba(212, 160, 57, 1) 100%
    );
    border-radius: 100px;
    opacity: 0;
    pointer-events: none;
  }

  .shooting-star-1 {
    top: 20%;
    left: 5%;
    transform: rotate(-35deg);
    animation: shootingStar 10s ease-in-out infinite;
  }

  .shooting-star-2 {
    top: 40%;
    right: 10%;
    transform: rotate(-40deg);
    animation: shootingStar 14s ease-in-out infinite 5s;
  }

  @keyframes shootingStar {
    0%,
    90%,
    100% {
      opacity: 0;
      transform: rotate(-35deg) translateX(0);
    }
    92% {
      opacity: 1;
    }
    95% {
      opacity: 1;
      transform: rotate(-35deg) translateX(350px);
    }
    96% {
      opacity: 0;
      transform: rotate(-35deg) translateX(400px);
    }
  }

  /* =================================================================================
     FLOATING PARTICLES — Tiny crystal shard shapes
     ================================================================================= */

  .particles {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .particle {
    position: absolute;
    left: var(--x-start);
    top: var(--y-start);
    width: var(--size);
    height: var(--size);
    background: var(--r-gold-pale);
    clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
    opacity: var(--opacity);
    animation: particleFloat var(--duration) ease-in-out var(--delay) infinite;
  }

  @keyframes particleFloat {
    0%,
    100% {
      transform: translateY(0) translateX(0);
      opacity: var(--opacity);
    }
    25% {
      transform: translateY(-30px) translateX(15px);
    }
    50% {
      transform: translateY(-50px) translateX(-10px);
      opacity: calc(var(--opacity) * 1.5);
    }
    75% {
      transform: translateY(-20px) translateX(20px);
    }
  }

  /* =================================================================================
     LOGIN CONTENT — Centered card area with entrance animation
     ================================================================================= */

  .login-content {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2rem;
    padding: calc(2rem + env(safe-area-inset-top, 0px)) 2rem
      calc(2rem + env(safe-area-inset-bottom, 0px));
    width: 100%;
    max-width: 440px;
    margin: auto;
    opacity: 0;
    transform: translateY(40px) scale(0.95);
  }

  .mounted .login-content {
    animation: contentReveal 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes contentReveal {
    0% {
      opacity: 0;
      transform: translateY(40px) scale(0.95);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* =================================================================================
     BRAND — Logo icon, title with shimmer gradient, tagline
     ================================================================================= */

  .brand {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .brand-icon {
    position: relative;
    animation: brandFloat 4s ease-in-out infinite;
    filter: drop-shadow(0 0 30px rgba(212, 160, 57, 0.4));
  }

  .brand-glow {
    position: absolute;
    inset: -20px;
    background: radial-gradient(circle, rgba(212, 160, 57, 0.35) 0%, transparent 70%);
    border-radius: 50%;
    animation: brandGlowPulse 3s ease-in-out infinite;
  }

  @keyframes brandGlowPulse {
    0%,
    100% {
      opacity: 0.5;
      transform: scale(1);
    }
    50% {
      opacity: 0.8;
      transform: scale(1.2);
    }
  }

  @keyframes brandFloat {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-8px);
    }
  }

  .brand-title {
    font-family: var(--r-font);
    font-size: 2.5rem;
    font-weight: 800;
    background: linear-gradient(
      135deg,
      var(--r-text) 0%,
      var(--r-gold-light) 50%,
      var(--r-text) 100%
    );
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    letter-spacing: -0.03em;
    animation: textShimmer 6s linear infinite;
    margin: 0;
  }

  @keyframes textShimmer {
    0% {
      background-position: 0% center;
    }
    100% {
      background-position: 200% center;
    }
  }

  .brand-tagline {
    font-family: var(--r-font);
    color: var(--r-text-muted);
    font-size: 1rem;
    font-weight: 500;
    margin: 0;
    opacity: 0.8;
  }

  /* =================================================================================
     LOGIN CARD — Glassmorphism card with animated gold gradient border
     ================================================================================= */

  .login-card {
    width: 100%;
    position: relative;
    border-radius: var(--r-radius-2xl);
    padding: 2px;
    background: linear-gradient(
      135deg,
      rgba(212, 160, 57, 0.5),
      rgba(232, 93, 117, 0.3),
      rgba(46, 196, 166, 0.2),
      rgba(232, 185, 74, 0.3),
      rgba(212, 160, 57, 0.5)
    );
    background-size: 300% 300%;
    animation: borderGlow 6s ease-in-out infinite;
  }

  @keyframes borderGlow {
    0%,
    100% {
      background-position: 0% 50%;
    }
    50% {
      background-position: 100% 50%;
    }
  }

  /* Ambient glow behind the card */
  .card-glow {
    position: absolute;
    inset: -40px;
    background: radial-gradient(ellipse at center, rgba(212, 160, 57, 0.12) 0%, transparent 70%);
    border-radius: 50%;
    pointer-events: none;
    animation: cardGlowPulse 4s ease-in-out infinite;
  }

  @keyframes cardGlowPulse {
    0%,
    100% {
      opacity: 0.5;
    }
    50% {
      opacity: 1;
    }
  }

  /* Inner card surface — glassmorphism with frosted backdrop */
  .card-inner {
    background: linear-gradient(165deg, var(--r-surface) 0%, rgba(16, 13, 8, 0.92) 100%);
    border-radius: calc(var(--r-radius-2xl) - 2px);
    padding: 2.5rem;
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    box-shadow:
      0 32px 80px rgba(0, 0, 0, 0.5),
      0 0 0 1px rgba(240, 208, 128, 0.05) inset;
    position: relative;
    overflow: hidden;
  }

  /* Subtle inner light streak at the top edge */
  .card-inner::before {
    content: '';
    position: absolute;
    top: 0;
    left: 10%;
    right: 10%;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(240, 208, 128, 0.15),
      rgba(212, 160, 57, 0.3),
      rgba(240, 208, 128, 0.15),
      transparent
    );
  }

  /* Subtle inner light streak at the bottom edge */
  .card-inner::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 20%;
    right: 20%;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(232, 93, 117, 0.15), transparent);
  }

  .card-title {
    font-family: var(--r-font);
    text-align: center;
    margin: 0 0 0.5rem 0;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--r-text);
    letter-spacing: -0.02em;
  }

  .card-subtitle {
    font-family: var(--r-font);
    text-align: center;
    color: var(--r-text-muted);
    font-size: 0.9375rem;
    margin: 0 0 2rem 0;
    opacity: 0.8;
    line-height: 1.5;
  }

  .card-hint {
    font-family: var(--r-font);
    text-align: center;
    color: var(--r-text-muted);
    font-size: 0.8125rem;
    margin: -1rem 0 1.5rem 0;
    opacity: 0.5;
    font-style: italic;
  }

  /* =================================================================================
     UNLOCK MODE — Avatar with hexagonal gem bezel
     ================================================================================= */

  .unlock-user-info {
    text-align: center;
    margin-bottom: 1.5rem;
  }

  .avatar-wrapper {
    position: relative;
    width: 80px;
    height: 80px;
    margin: 0 auto 1.25rem;
  }

  .avatar {
    width: 80px;
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, var(--r-gold-deep), var(--r-gold));
    color: white;
    font-family: var(--r-font);
    font-weight: 700;
    font-size: 2rem;
    clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
    position: relative;
    z-index: 2;
    box-shadow:
      0 4px 20px rgba(212, 160, 57, 0.4),
      0 0 40px rgba(212, 160, 57, 0.15);
  }

  /* Hexagonal gem bezel — outer ring */
  .avatar-ring-outer {
    position: absolute;
    inset: -12px;
    clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
    background: linear-gradient(
      135deg,
      rgba(212, 160, 57, 0.3),
      rgba(232, 93, 117, 0.2),
      rgba(46, 196, 166, 0.2),
      rgba(212, 160, 57, 0.3)
    );
    animation: avatarRingPulse 3s ease-in-out infinite;
  }

  /* Hexagonal gem bezel — inner ring */
  .avatar-ring-inner {
    position: absolute;
    inset: -6px;
    clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
    background: linear-gradient(
      135deg,
      rgba(212, 160, 57, 0.45),
      rgba(232, 185, 74, 0.3),
      rgba(212, 160, 57, 0.45)
    );
    animation: avatarRingPulse 3s ease-in-out infinite 0.5s;
  }

  @keyframes avatarRingPulse {
    0%,
    100% {
      transform: scale(1);
      opacity: 0.6;
    }
    50% {
      transform: scale(1.05);
      opacity: 0.3;
    }
  }

  /* =================================================================================
     SETUP MODE — Step Indicator & Transitions
     ================================================================================= */

  .setup-step {
    animation: stepFadeIn 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes stepFadeIn {
    from {
      opacity: 0;
      transform: translateX(20px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  .step-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    margin-bottom: 1.75rem;
  }

  .step-dot {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(212, 160, 57, 0.1);
    border: 2px solid rgba(212, 160, 57, 0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
    position: relative;
  }

  .step-dot.active {
    background: linear-gradient(135deg, var(--r-gold-deep), var(--r-gold));
    border-color: rgba(212, 160, 57, 0.6);
    box-shadow: 0 0 20px rgba(212, 160, 57, 0.3);
  }

  .step-dot.completed {
    background: linear-gradient(135deg, rgba(46, 196, 166, 0.8), rgba(52, 211, 153, 0.6));
    border-color: rgba(46, 196, 166, 0.6);
    box-shadow: 0 0 15px rgba(46, 196, 166, 0.3);
    color: white;
  }

  .step-line {
    width: 60px;
    height: 2px;
    background: rgba(212, 160, 57, 0.15);
    transition: all 0.3s ease;
  }

  .step-line.active {
    background: linear-gradient(90deg, rgba(46, 196, 166, 0.6), rgba(212, 160, 57, 0.6));
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--r-text-muted);
    font-family: var(--r-font);
    font-size: 0.8125rem;
    font-weight: 500;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.25rem 0;
    margin-bottom: 1rem;
    transition: color 0.2s ease;
  }

  .back-link:hover {
    color: var(--r-gold-light);
  }

  /* =================================================================================
     FORM ELEMENTS — Text inputs, labels, layout
     ================================================================================= */

  .form-fields {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .name-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  label {
    font-family: var(--r-font);
    font-weight: 700;
    color: var(--r-text-muted);
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .input-wrapper {
    position: relative;
  }

  /* Glow effect behind focused inputs */
  .input-glow {
    position: absolute;
    inset: -1px;
    border-radius: var(--r-radius-lg);
    opacity: 0;
    background: linear-gradient(135deg, rgba(212, 160, 57, 0.35), rgba(232, 93, 117, 0.2));
    filter: blur(8px);
    transition: opacity 0.3s ease;
    pointer-events: none;
    z-index: -1;
  }

  .input-wrapper:focus-within .input-glow {
    opacity: 1;
  }

  input {
    width: 100%;
    padding: 0.875rem 1rem;
    font-size: 16px; /* Prevents iOS zoom */
    font-family: var(--r-font);
    color: var(--r-text);
    background: rgba(14, 11, 6, 0.6);
    border: 1px solid rgba(212, 160, 57, 0.15);
    border-radius: var(--r-radius-lg);
    transition: all 0.3s ease;
    position: relative;
  }

  input:focus {
    outline: none;
    border-color: rgba(212, 160, 57, 0.45);
    box-shadow: 0 0 24px rgba(212, 160, 57, 0.15);
    background: rgba(14, 11, 6, 0.8);
  }

  input::placeholder {
    color: var(--r-text-dim);
  }

  input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* =================================================================================
     PIN CODE INPUTS — Glowing digit boxes with focus/filled states
     ================================================================================= */

  .code-input-group {
    display: flex;
    justify-content: center;
    gap: 0.5rem;
  }

  .code-digit-wrapper {
    position: relative;
  }

  /* Glow pseudo-element behind filled digit boxes */
  .code-digit-wrapper::after {
    content: '';
    position: absolute;
    inset: -2px;
    border-radius: calc(var(--r-radius-lg) + 2px);
    background: linear-gradient(135deg, rgba(212, 160, 57, 0.3), rgba(232, 93, 117, 0.2));
    opacity: 0;
    transition: opacity 0.3s ease;
    z-index: -1;
    filter: blur(6px);
  }

  .code-digit-wrapper.filled::after {
    opacity: 1;
  }

  .code-digit {
    width: 48px;
    height: 56px;
    text-align: center;
    font-size: 1.375rem;
    font-weight: 700;
    letter-spacing: 0;
    caret-color: var(--r-gold-light);
    padding: 0;
    transition: all 0.3s ease;
  }

  .code-digit:focus {
    border-color: rgba(212, 160, 57, 0.5);
    box-shadow:
      0 0 24px rgba(212, 160, 57, 0.2),
      0 0 0 2px rgba(212, 160, 57, 0.15);
    transform: translateY(-2px);
  }

  .code-digit-wrapper.filled .code-digit {
    border-color: rgba(212, 160, 57, 0.35);
    background: rgba(212, 160, 57, 0.06);
  }

  .code-label {
    font-family: var(--r-font);
    text-align: center;
    font-weight: 700;
    color: var(--r-text-muted);
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 0.75rem;
  }

  .code-loading {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 56px;
  }

  /* =================================================================================
     MESSAGES — Error feedback with fade-in animation
     ================================================================================= */

  .message {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    border-radius: var(--r-radius-lg);
    font-family: var(--r-font);
    font-size: 0.875rem;
    font-weight: 600;
    backdrop-filter: blur(16px);
    animation: messageFadeIn 0.3s ease-out;
  }

  @keyframes messageFadeIn {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .error {
    background: linear-gradient(
      135deg,
      rgba(251, 113, 133, 0.15) 0%,
      rgba(251, 113, 133, 0.05) 100%
    );
    color: var(--r-error);
    border: 1px solid rgba(251, 113, 133, 0.3);
    box-shadow: 0 0 20px rgba(251, 113, 133, 0.08);
  }

  /* =================================================================================
     BUTTONS — Primary submit with shimmer overlay
     ================================================================================= */

  .btn {
    font-family: var(--r-font);
    border: none;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .btn-primary {
    background: linear-gradient(135deg, var(--r-gold-deep), var(--r-gold));
    color: #fff;
    font-weight: 700;
    border-radius: var(--r-radius-lg);
    letter-spacing: 0.01em;
  }

  .btn-primary:hover:not(:disabled) {
    transform: translateY(-2px) scale(1.02);
    box-shadow:
      0 8px 32px rgba(212, 160, 57, 0.35),
      0 0 40px rgba(212, 160, 57, 0.15);
  }

  .btn-primary:active:not(:disabled) {
    transform: translateY(0) scale(0.98);
  }

  .submit-btn {
    width: 100%;
    padding: 1rem;
    margin-top: 0.75rem;
    font-size: 1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    position: relative;
    overflow: hidden;
  }

  /* Animated shimmer overlay on the button surface */
  .submit-btn::after {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
    animation: buttonShimmer 3s ease-in-out infinite;
  }

  @keyframes buttonShimmer {
    0% {
      left: -100%;
    }
    50%,
    100% {
      left: 100%;
    }
  }

  .submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none !important;
    box-shadow: none !important;
  }

  .submit-btn:disabled::after {
    display: none;
  }

  .loading-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* =================================================================================
     RESOLVING STATE — Crystal loader while initial auth state resolves
     ================================================================================= */

  .resolving-card {
    animation:
      borderGlow 6s ease-in-out infinite,
      resolvingFadeIn 0.6s ease-out;
  }

  .resolving-loader {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    padding: 2rem 0;
  }

  .resolving-orb {
    position: relative;
    width: 56px;
    height: 56px;
  }

  .resolving-orb-core {
    position: absolute;
    inset: 16px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(212, 160, 57, 0.9), rgba(232, 93, 117, 0.5));
    box-shadow:
      0 0 20px rgba(212, 160, 57, 0.6),
      0 0 40px rgba(212, 160, 57, 0.3);
    animation: resolvingOrbPulse 2s ease-in-out infinite;
  }

  .resolving-orb-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2px solid transparent;
    border-top-color: rgba(212, 160, 57, 0.8);
    border-right-color: rgba(232, 93, 117, 0.4);
    animation: spin 1.5s linear infinite;
  }

  .resolving-orb-ring-2 {
    inset: 4px;
    border-top-color: rgba(46, 196, 166, 0.6);
    border-right-color: rgba(52, 211, 153, 0.3);
    animation-direction: reverse;
    animation-duration: 2s;
  }

  .resolving-shimmer-line {
    width: 140px;
    height: 10px;
    border-radius: 5px;
    background: linear-gradient(
      90deg,
      rgba(212, 160, 57, 0.1) 0%,
      rgba(212, 160, 57, 0.3) 50%,
      rgba(212, 160, 57, 0.1) 100%
    );
    background-size: 200% 100%;
    animation: resolvingShimmer 1.5s ease-in-out infinite;
  }

  .resolving-shimmer-short {
    width: 90px;
    height: 8px;
    animation-delay: 0.3s;
  }

  @keyframes resolvingFadeIn {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes resolvingOrbPulse {
    0%,
    100% {
      transform: scale(1);
      box-shadow:
        0 0 20px rgba(212, 160, 57, 0.6),
        0 0 40px rgba(212, 160, 57, 0.3);
    }
    50% {
      transform: scale(1.15);
      box-shadow:
        0 0 30px rgba(212, 160, 57, 0.8),
        0 0 60px rgba(232, 93, 117, 0.4);
    }
  }

  @keyframes resolvingShimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  /* =================================================================================
     SHAKE ANIMATION — Error feedback for incorrect codes
     ================================================================================= */

  @keyframes shake {
    0%,
    100% {
      transform: translateX(0);
    }
    10%,
    30%,
    50%,
    70%,
    90% {
      transform: translateX(-6px);
    }
    20%,
    40%,
    60%,
    80% {
      transform: translateX(6px);
    }
  }

  .shake {
    animation: shake 0.5s ease-in-out;
  }

  /* =================================================================================
     RESPONSIVE — Large Screens (1200px+)
     ================================================================================= */

  @media (min-width: 1200px) {
    .login-content {
      max-width: 480px;
    }
    .brand-icon svg {
      width: 56px;
      height: 56px;
    }
    .brand-title {
      font-size: 3rem;
    }
    .brand-tagline {
      font-size: 1.125rem;
    }
    .card-inner {
      padding: 3rem;
    }
    .orbit-1 {
      width: 500px;
      height: 500px;
    }
    .orbit-2 {
      width: 750px;
      height: 750px;
    }
    .orbit-3 {
      width: 1000px;
      height: 1000px;
    }
    .nebula-1 {
      width: 800px;
      height: 800px;
    }
    .nebula-2 {
      width: 700px;
      height: 700px;
    }
    .nebula-3 {
      width: 600px;
      height: 600px;
    }
  }

  /* =================================================================================
     RESPONSIVE — Tablets (768px - 1199px)
     ================================================================================= */

  @media (min-width: 768px) and (max-width: 1199px) {
    .login-content {
      max-width: 460px;
    }
    .brand-icon svg {
      width: 52px;
      height: 52px;
    }
    .brand-title {
      font-size: 2.75rem;
    }
    .card-inner {
      padding: 2.75rem;
    }
  }

  /* =================================================================================
     RESPONSIVE — Mobile Devices (< 768px)
     ================================================================================= */

  @media (max-width: 767px) {
    .login-content {
      padding: 1.5rem;
      gap: 1.5rem;
    }
    .brand-icon svg {
      width: 44px;
      height: 44px;
    }
    .brand-title {
      font-size: 2.25rem;
    }
    .brand-tagline {
      font-size: 0.9375rem;
    }
    .card-inner {
      padding: 2rem;
    }
    .card-title {
      font-size: 1.375rem;
    }

    /* Smaller hexagonal rings for mobile viewports */
    .orbit-1 {
      width: 320px;
      height: 320px;
    }
    .orbit-2 {
      width: 480px;
      height: 480px;
    }
    .orbit-3 {
      width: 640px;
      height: 640px;
    }

    /* Re-scoped orbit particle radii for smaller rings */
    @keyframes orbitParticle1 {
      from {
        transform: rotate(0deg) translateX(160px) rotate(0deg);
      }
      to {
        transform: rotate(360deg) translateX(160px) rotate(-360deg);
      }
    }
    @keyframes orbitParticle2 {
      from {
        transform: rotate(0deg) translateX(240px) rotate(0deg);
      }
      to {
        transform: rotate(360deg) translateX(240px) rotate(-360deg);
      }
    }
    @keyframes orbitParticle3 {
      from {
        transform: rotate(0deg) translateX(320px) rotate(0deg);
      }
      to {
        transform: rotate(360deg) translateX(320px) rotate(-360deg);
      }
    }

    .nebula-1 {
      width: 500px;
      height: 500px;
    }
    .nebula-2 {
      width: 450px;
      height: 450px;
    }
    .nebula-3 {
      width: 400px;
      height: 400px;
    }
  }

  /* =================================================================================
     RESPONSIVE — iPhone 16 Pro / 15 Pro / 14 Pro (~393px width)
     ================================================================================= */

  @media (min-width: 390px) and (max-width: 429px) {
    .login-content {
      padding: 1.25rem;
      gap: 1.75rem;
    }
    .brand-icon svg {
      width: 48px;
      height: 48px;
    }
    .brand-title {
      font-size: 2.5rem;
    }
    .brand-tagline {
      font-size: 1rem;
    }
    .card-inner {
      padding: 2rem;
      border-radius: 22px;
    }
    .card-title {
      font-size: 1.5rem;
    }
    .login-card {
      border-radius: 24px;
    }

    input {
      padding: 1rem 1.125rem;
      border-radius: 14px;
    }

    .submit-btn {
      padding: 1.125rem;
      font-size: 1.0625rem;
      border-radius: 14px;
    }

    .avatar-wrapper {
      width: 72px;
      height: 72px;
    }
    .avatar {
      width: 72px;
      height: 72px;
      font-size: 1.75rem;
    }

    .code-digit {
      width: 40px;
      height: 48px;
      font-size: 1.25rem;
    }
    .code-input-group {
      gap: 0.375rem;
    }
  }

  /* =================================================================================
     RESPONSIVE — iPhone 16 Pro Max / 15 Pro Max (~430px width)
     ================================================================================= */

  @media (min-width: 430px) and (max-width: 480px) {
    .login-content {
      padding: 1.5rem;
      gap: 2rem;
    }
    .brand-icon svg {
      width: 52px;
      height: 52px;
    }
    .brand-title {
      font-size: 2.75rem;
    }
    .card-inner {
      padding: 2.25rem;
    }
    .card-title {
      font-size: 1.5rem;
    }

    .avatar-wrapper {
      width: 80px;
      height: 80px;
    }
    .avatar {
      width: 80px;
      height: 80px;
      font-size: 2rem;
    }

    .code-digit {
      width: 44px;
      height: 52px;
      font-size: 1.375rem;
    }
    .code-input-group {
      gap: 0.4375rem;
    }
  }

  /* =================================================================================
     RESPONSIVE — Small Devices (iPhone SE, older phones < 390px)
     ================================================================================= */

  @media (max-width: 389px) {
    .login-content {
      padding: 1rem;
      gap: 1.25rem;
    }
    .brand-icon svg {
      width: 40px;
      height: 40px;
    }
    .brand-title {
      font-size: 2rem;
    }
    .brand-tagline {
      font-size: 0.8125rem;
    }
    .card-inner {
      padding: 1.5rem;
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

    .submit-btn {
      padding: 0.875rem;
      font-size: 0.9375rem;
    }

    .avatar-wrapper {
      width: 60px;
      height: 60px;
    }
    .avatar {
      width: 60px;
      height: 60px;
      font-size: 1.5rem;
    }

    .code-digit {
      width: 36px;
      height: 44px;
      font-size: 1.125rem;
    }
    .code-input-group {
      gap: 0.25rem;
    }

    .step-line {
      width: 40px;
    }

    /* Even smaller hexagonal rings */
    .orbit-1 {
      width: 240px;
      height: 240px;
    }
    .orbit-2 {
      width: 360px;
      height: 360px;
    }
    .orbit-3 {
      width: 480px;
      height: 480px;
    }

    @keyframes orbitParticle1 {
      from {
        transform: rotate(0deg) translateX(120px) rotate(0deg);
      }
      to {
        transform: rotate(360deg) translateX(120px) rotate(-360deg);
      }
    }
    @keyframes orbitParticle2 {
      from {
        transform: rotate(0deg) translateX(180px) rotate(0deg);
      }
      to {
        transform: rotate(360deg) translateX(180px) rotate(-360deg);
      }
    }
    @keyframes orbitParticle3 {
      from {
        transform: rotate(0deg) translateX(240px) rotate(0deg);
      }
      to {
        transform: rotate(360deg) translateX(240px) rotate(-360deg);
      }
    }

    .nebula-1 {
      width: 350px;
      height: 350px;
    }
    .nebula-2 {
      width: 300px;
      height: 300px;
    }
    .nebula-3 {
      width: 250px;
      height: 250px;
    }
  }

  /* =================================================================================
     REDUCED MOTION — Respect prefers-reduced-motion preference
     ================================================================================= */

  @media (prefers-reduced-motion: reduce) {
    .stars,
    .nebula,
    .orbit,
    .orbit-particle,
    .shooting-star,
    .particle,
    .brand-icon,
    .brand-glow,
    .card-glow,
    .avatar-ring-outer,
    .avatar-ring-inner {
      animation: none;
    }

    .brand-title {
      animation: none;
    }
    .login-card {
      animation: none;
      background: rgba(212, 160, 57, 0.3);
    }
    .submit-btn::after {
      animation: none;
      display: none;
    }
    .setup-step {
      animation: none;
      opacity: 1;
    }

    .login-content,
    .mounted .login-content {
      animation: none;
      opacity: 1;
      transform: none;
    }

    .code-digit:focus {
      transform: none;
    }
  }

  /* =================================================================================
     MODAL OVERLAY — Confirmation / Device Verification
     ================================================================================= */

  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 8, 6, 0.75);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    padding: 1.5rem;
    animation: modalFadeIn 0.3s ease-out;
  }

  @keyframes modalFadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* Modal card — reuses the same glass card styling as the login card */
  .modal-card {
    width: 100%;
    max-width: 400px;
    position: relative;
    border-radius: var(--r-radius-2xl);
    padding: 2px;
    background: linear-gradient(
      135deg,
      rgba(212, 160, 57, 0.5),
      rgba(232, 93, 117, 0.3),
      rgba(46, 196, 166, 0.25),
      rgba(212, 160, 57, 0.5)
    );
    background-size: 300% 300%;
    animation: borderGlow 6s ease-in-out infinite;
  }

  .modal-card .card-inner {
    text-align: center;
  }

  /* Circular icon badge in the modal header */
  .modal-icon {
    margin: 0 auto 1.25rem;
    width: 72px;
    height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(212, 160, 57, 0.1);
    border-radius: 50%;
    border: 1px solid rgba(212, 160, 57, 0.2);
    animation: modalIconPulse 3s ease-in-out infinite;
  }

  @keyframes modalIconPulse {
    0%,
    100% {
      box-shadow: 0 0 20px rgba(212, 160, 57, 0.2);
    }
    50% {
      box-shadow: 0 0 40px rgba(212, 160, 57, 0.4);
    }
  }

  .modal-card .card-subtitle strong {
    color: var(--r-text);
    font-weight: 600;
  }
</style>
