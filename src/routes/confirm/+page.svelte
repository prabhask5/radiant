<!--
  @fileoverview Email confirmation page — token verification, BroadcastChannel
  relay, and close/redirect flow.

  Supabase email links land here with `?token_hash=...&type=...` query
  params. The page verifies the token, broadcasts the result to the
  originating tab via BroadcastChannel, and either tells the user they
  can close the tab or redirects them to the app root.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { handleEmailConfirmation, broadcastAuthConfirmed } from 'stellar-drive/kit';

  let status: 'verifying' | 'success' | 'error' | 'redirecting' | 'can_close' = 'verifying';
  let errorMessage = '';

  const CHANNEL_NAME = 'radiant-auth-channel';

  onMount(async () => {
    const tokenHash = $page.url.searchParams.get('token_hash');
    const type = $page.url.searchParams.get('type');

    if (tokenHash && type) {
      const result = await handleEmailConfirmation(
        tokenHash,
        type as 'signup' | 'email' | 'email_change' | 'magiclink'
      );

      if (!result.success) {
        status = 'error';
        errorMessage = result.error || 'Unknown error';
        return;
      }

      status = 'success';
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    const tabResult = await broadcastAuthConfirmed(CHANNEL_NAME, type || 'signup');
    if (tabResult === 'can_close') {
      status = 'can_close';
    } else if (tabResult === 'no_broadcast') {
      focusOrRedirect();
    }
  });

  async function focusOrRedirect() {
    status = 'redirecting';
    const type = $page.url.searchParams.get('type') || 'signup';
    const result = await broadcastAuthConfirmed(CHANNEL_NAME, type);
    if (result === 'no_broadcast') {
      goto('/', { replaceState: true });
    } else {
      setTimeout(() => {
        status = 'can_close';
      }, 200);
    }
  }
</script>

<svelte:head>
  <title>Confirming... - Radiant Finance</title>
</svelte:head>

<div class="confirm-page">
  <div class="confirm-container">
    {#if status === 'verifying'}
      <div class="gem-spinner">
        <div class="facet"></div>
        <div class="facet"></div>
        <div class="facet"></div>
      </div>
      <h2>Verifying...</h2>
      <p>Please wait while we confirm your email.</p>
    {:else if status === 'success'}
      <div class="gem-icon success">
        <svg viewBox="0 0 48 48" fill="none">
          <path
            d="M24 4L4 20L24 44L44 20L24 4Z"
            stroke="currentColor"
            stroke-width="2"
            fill="none"
          />
          <path
            d="M16 22L22 28L32 16"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <h2>Confirmed!</h2>
      <p>Your email has been verified successfully.</p>
    {:else if status === 'error'}
      <div class="gem-icon error">
        <svg viewBox="0 0 48 48" fill="none">
          <path
            d="M24 4L4 20L24 44L44 20L24 4Z"
            stroke="currentColor"
            stroke-width="2"
            fill="none"
          />
          <path
            d="M18 16L30 28M30 16L18 28"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
          />
        </svg>
      </div>
      <h2>Verification Failed</h2>
      <p>{errorMessage}</p>
      <button class="btn btn-primary" onclick={() => goto('/login', { replaceState: true })}>
        Back to Login
      </button>
    {:else if status === 'can_close'}
      <div class="gem-icon success">
        <svg viewBox="0 0 48 48" fill="none">
          <path
            d="M24 4L4 20L24 44L44 20L24 4Z"
            stroke="currentColor"
            stroke-width="2"
            fill="none"
          />
          <path
            d="M16 22L22 28L32 16"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <h2>All Done!</h2>
      <p>You can close this tab and return to the app.</p>
    {:else if status === 'redirecting'}
      <div class="gem-spinner">
        <div class="facet"></div>
        <div class="facet"></div>
        <div class="facet"></div>
      </div>
      <h2>Redirecting...</h2>
    {/if}
  </div>
</div>

<style>
  .confirm-page {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    background: transparent;
    color: var(--color-text);
  }

  .confirm-container {
    text-align: center;
    max-width: 380px;
    animation: confirmFadeUp 0.7s var(--ease-out) forwards;
  }

  @keyframes confirmFadeUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .gem-icon {
    width: 64px;
    height: 64px;
    margin: 0 auto 1.5rem;
  }

  .gem-icon.success {
    color: var(--color-success);
    filter: drop-shadow(0 0 16px var(--color-success-glow));
    animation: confirmSuccessPulse 2s ease-in-out infinite;
  }

  .gem-icon.error {
    color: var(--color-ruby);
    filter: drop-shadow(0 0 16px var(--color-ruby-glow));
  }

  @keyframes confirmSuccessPulse {
    0%,
    100% {
      filter: drop-shadow(0 0 12px var(--color-success-glow));
    }
    50% {
      filter: drop-shadow(0 0 24px var(--color-success-glow));
    }
  }

  .gem-spinner {
    width: 48px;
    height: 48px;
    margin: 0 auto 1.5rem;
    position: relative;
    filter: drop-shadow(0 0 12px var(--color-primary-glow));
  }

  .facet {
    position: absolute;
    inset: 0;
    border: 2px solid var(--color-primary);
    clip-path: polygon(50% 0%, 0% 40%, 50% 100%, 100% 40%);
    animation: spinFacet 1.5s ease-in-out infinite;
  }

  .facet:nth-child(2) {
    animation-delay: 0.2s;
    opacity: 0.6;
    transform: scale(0.85);
    border-color: var(--color-accent);
  }

  .facet:nth-child(3) {
    animation-delay: 0.4s;
    opacity: 0.3;
    transform: scale(0.7);
    border-color: var(--color-cyan);
  }

  @keyframes spinFacet {
    0%,
    100% {
      transform: rotate(0deg) scale(1);
      opacity: 0.3;
    }
    50% {
      transform: rotate(180deg) scale(1.1);
      opacity: 1;
    }
  }

  h2 {
    font-size: 1.5rem;
    font-weight: 700;
    font-family: var(--font-display);
    letter-spacing: var(--tracking-tight);
    margin: 0 0 0.5rem;
    background: linear-gradient(
      120deg,
      var(--color-primary-light) 0%,
      var(--color-accent) 50%,
      var(--color-primary-light) 100%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: confirmShimmer 4s ease-in-out infinite;
  }

  @keyframes confirmShimmer {
    0%,
    100% {
      background-position: 0% 50%;
    }
    50% {
      background-position: 200% 50%;
    }
  }

  p {
    color: var(--color-text-secondary);
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    line-height: 1.5;
    margin: 0 0 1.5rem;
  }

  .btn {
    padding: 0.625rem 1.5rem;
    border: none;
    border-radius: var(--radius-sm);
    font-size: 0.875rem;
    font-weight: 600;
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    cursor: pointer;
    transition:
      box-shadow var(--duration-fast) var(--ease-out),
      transform var(--duration-fast) var(--ease-out);
  }

  .btn:active {
    transform: scale(0.97);
  }

  .btn-primary {
    background: var(--gradient-primary);
    color: #fff;
    box-shadow: 0 2px 12px rgba(139, 92, 246, 0.3);
  }

  .btn-primary:hover {
    box-shadow:
      0 4px 24px rgba(139, 92, 246, 0.5),
      0 0 40px rgba(139, 92, 246, 0.2);
  }

  @media (prefers-reduced-motion: reduce) {
    .confirm-container {
      animation: none;
    }

    .gem-icon.success {
      animation: none;
    }

    h2 {
      animation: none;
      -webkit-text-fill-color: var(--color-primary-light);
    }
  }
</style>
