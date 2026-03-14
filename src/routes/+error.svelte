<!--
  @fileoverview Error boundary — handles three scenarios:
    1. **Offline** — device has no connectivity, show a friendly offline message
    2. **404**     — page not found, offer navigation back to home
    3. **Generic** — unexpected error, display status code and retry option
-->
<script lang="ts">
  import { page } from '$app/stores';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';

  let isOffline = $state(false);

  $effect(() => {
    if (browser) {
      isOffline = !navigator.onLine;
      const handleOnline = () => {
        isOffline = false;
      };
      const handleOffline = () => {
        isOffline = true;
      };
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
  });

  function handleRetry() {
    window.location.reload();
  }

  function handleGoHome() {
    goto('/');
  }
</script>

<svelte:head>
  <title>Error - Radiant Finance</title>
</svelte:head>

<div class="error-page">
  <div class="error-container">
    <!-- Decorative gem -->
    <div class="gem-icon">
      {#if isOffline}
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M24 4L4 20L24 44L44 20L24 4Z"
            stroke="currentColor"
            stroke-width="2"
            fill="none"
            opacity="0.3"
          />
          <path d="M4 20H44" stroke="currentColor" stroke-width="1.5" opacity="0.2" />
          <path
            d="M24 4L16 20L24 44L32 20L24 4Z"
            stroke="currentColor"
            stroke-width="1"
            fill="none"
            opacity="0.15"
          />
          <line
            x1="8"
            y1="8"
            x2="40"
            y2="40"
            stroke="var(--color-ruby, #ef4444)"
            stroke-width="3"
            stroke-linecap="round"
          />
        </svg>
      {:else if $page.status === 404}
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M24 4L4 20L24 44L44 20L24 4Z"
            stroke="currentColor"
            stroke-width="2"
            fill="none"
            opacity="0.3"
          />
          <text
            x="24"
            y="28"
            text-anchor="middle"
            fill="currentColor"
            font-size="14"
            font-weight="700"
            opacity="0.5">?</text
          >
        </svg>
      {:else}
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M24 4L4 20L24 44L44 20L24 4Z"
            stroke="currentColor"
            stroke-width="2"
            fill="none"
            opacity="0.3"
          />
          <path d="M4 20H44" stroke="currentColor" stroke-width="1.5" opacity="0.2" />
          <text
            x="24"
            y="28"
            text-anchor="middle"
            fill="currentColor"
            font-size="12"
            font-weight="700"
            opacity="0.5">!</text
          >
        </svg>
      {/if}
    </div>

    {#if isOffline}
      <h1 class="error-title">You're Offline</h1>
      <p class="error-message">
        This page isn't available without a connection. Your data is safe — reconnect to continue.
      </p>
      <div class="error-actions">
        <button class="btn btn-primary" onclick={handleRetry}> Try Again </button>
        <button class="btn btn-ghost" onclick={handleGoHome}> Go Home </button>
      </div>
    {:else if $page.status === 404}
      <h1 class="error-title">Page Not Found</h1>
      <p class="error-message">
        This facet doesn't exist. The page you're looking for may have been moved or removed.
      </p>
      <div class="error-actions">
        <button class="btn btn-primary" onclick={handleGoHome}> Back to Dashboard </button>
      </div>
    {:else}
      <h1 class="error-title">Something Went Wrong</h1>
      <p class="error-code">{$page.status}</p>
      <p class="error-message">{$page.error?.message || 'An unexpected error occurred.'}</p>
      <div class="error-actions">
        <button class="btn btn-primary" onclick={handleRetry}> Retry </button>
        <button class="btn btn-ghost" onclick={handleGoHome}> Go Home </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .error-page {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    background: var(--color-bg, #0a0a16);
    color: var(--color-text, #f0eeff);
  }

  .error-container {
    text-align: center;
    max-width: 420px;
    animation: fadeIn 0.8s ease forwards;
  }

  @keyframes fadeIn {
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
    width: 80px;
    height: 80px;
    margin: 0 auto 1.5rem;
    color: var(--color-primary, #8b5cf6);
    animation: gentlePulse 3s ease-in-out infinite;
  }

  @keyframes gentlePulse {
    0%,
    100% {
      opacity: 0.7;
      transform: scale(1);
    }
    50% {
      opacity: 1;
      transform: scale(1.05);
    }
  }

  .error-title {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0 0 0.5rem;
    background: linear-gradient(
      135deg,
      var(--color-primary, #8b5cf6),
      var(--color-accent, #f472b6)
    );
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .error-code {
    font-size: 3rem;
    font-weight: 800;
    margin: 0 0 0.5rem;
    color: var(--color-text-muted, #7874a0);
    opacity: 0.4;
  }

  .error-message {
    color: var(--color-text-secondary, #c4c0e0);
    line-height: 1.6;
    margin: 0 0 2rem;
    font-size: 0.95rem;
  }

  .error-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    flex-wrap: wrap;
  }

  .btn {
    padding: 0.625rem 1.5rem;
    border: none;
    border-radius: 8px;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .btn-primary {
    background: var(--color-primary, #8b5cf6);
    color: #fff;
  }

  .btn-primary:hover {
    background: var(--color-primary-hover, #7c3aed);
    box-shadow: 0 0 20px rgba(139, 92, 246, 0.3);
  }

  .btn-ghost {
    background: transparent;
    color: var(--color-text-secondary, #c4c0e0);
    border: 1px solid var(--color-border, rgba(139, 92, 246, 0.2));
  }

  .btn-ghost:hover {
    background: rgba(139, 92, 246, 0.1);
    border-color: var(--color-border-strong, rgba(139, 92, 246, 0.4));
  }
</style>
