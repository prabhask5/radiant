<script lang="ts">
  /**
   * @fileoverview UpdatePrompt — service-worker update notification.
   *
   * Detects when a new service worker version is waiting to activate and
   * shows an "update available" prompt. Detection relies on six signals:
   *   1. `statechange` on the installing SW → catches updates during the visit
   *   2. `updatefound` on the registration → catches background installs
   *   3. `visibilitychange` → re-checks when the tab becomes visible
   *   4. `online` event → re-checks when connectivity is restored
   *   5. Periodic interval → fallback for iOS standalone mode
   *   6. Initial check on mount → catches SWs that installed before this component
   *
   * Uses `monitorSwLifecycle()` from stellar-drive to wire up all six, and
   * `handleSwUpdate()` to send SKIP_WAITING + reload on user confirmation.
   */

  // ==========================================================================
  //                                IMPORTS
  // ==========================================================================

  import { onMount, onDestroy } from 'svelte';
  import { monitorSwLifecycle, handleSwUpdate } from 'stellar-drive/kit';

  // ==========================================================================
  //                           COMPONENT STATE
  // ==========================================================================

  /** Whether the update prompt is visible */
  let showPrompt = $state(false);

  /** Guard flag to prevent double-reload */
  let reloading = false;

  /** Cleanup function returned by monitorSwLifecycle */
  let cleanup: (() => void) | null = null;

  // ==========================================================================
  //                      SERVICE WORKER MONITORING
  // ==========================================================================

  onMount(() => {
    cleanup = monitorSwLifecycle({
      onUpdateAvailable: () => {
        showPrompt = true;
      }
    });
  });

  onDestroy(() => {
    cleanup?.();
  });

  // ==========================================================================
  //                          ACTION HANDLERS
  // ==========================================================================

  /**
   * Apply the update: sends SKIP_WAITING to the waiting SW,
   * waits for controllerchange, then reloads the page.
   */
  async function handleRefresh() {
    if (reloading) return;
    reloading = true;
    showPrompt = false;
    await handleSwUpdate();
  }

  /**
   * Dismiss the prompt. The update will apply on the next visit.
   */
  function handleDismiss() {
    showPrompt = false;
  }
</script>

{#if showPrompt}
  <div class="update-toast" role="alert">
    <div class="update-content">
      <div class="update-icon">
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
          <path d="M12 2L2 9l10 18 10-18L12 2z" opacity="0.6" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
      </div>
      <span class="update-text">A new version of Radiant is available</span>
    </div>
    <div class="update-actions">
      <button class="btn-dismiss" onclick={handleDismiss}>Later</button>
      <button class="btn-refresh" onclick={handleRefresh}>Refresh</button>
    </div>
  </div>
{/if}

<style>
  .update-toast {
    position: fixed;
    bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: rgba(14, 12, 8, 0.92);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(212, 160, 57, 0.25);
    border-radius: 12px;
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.4),
      0 0 16px rgba(212, 160, 57, 0.1);
    max-width: calc(100vw - 2rem);
    animation: toastSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes toastSlideUp {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  .update-content {
    display: flex;
    align-items: center;
    gap: 0.625rem;
  }

  .update-icon {
    color: var(--color-primary, #d4a039);
    flex-shrink: 0;
  }

  .update-text {
    font-size: 0.85rem;
    color: var(--color-text-secondary, #c8bfa8);
    white-space: nowrap;
  }

  .update-actions {
    display: flex;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .btn-dismiss,
  .btn-refresh {
    padding: 0.375rem 0.75rem;
    border: none;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-dismiss {
    background: transparent;
    color: var(--color-text-muted, #8a7e68);
  }

  .btn-dismiss:hover {
    color: var(--color-text-secondary, #c8bfa8);
  }

  .btn-refresh {
    background: var(--color-primary, #d4a039);
    color: #fff;
  }

  .btn-refresh:hover {
    background: var(--color-primary-hover, #b8862e);
    box-shadow: 0 0 12px rgba(212, 160, 57, 0.3);
  }

  @media (max-width: 480px) {
    .update-toast {
      flex-direction: column;
      gap: 0.75rem;
      bottom: calc(5rem + env(safe-area-inset-bottom, 0px));
      left: 0.75rem;
      right: 0.75rem;
      transform: none;
    }

    @keyframes toastSlideUp {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .update-text {
      white-space: normal;
    }
  }
</style>
