<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    onclose,
    maxWidth = '500px',
    maxHeight = '85vh',
    children,
    ...rest
  }: {
    open?: boolean;
    onclose?: () => void;
    maxWidth?: string;
    maxHeight?: string;
    children?: Snippet;
    [key: string]: unknown;
  } = $props();
</script>

{#if open}
  <div
    class="modal-overlay"
    onclick={onclose}
    onkeydown={(e) => e.key === 'Escape' && onclose?.()}
    {...rest}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="modal-sheet"
      style="--max-width: {maxWidth}; --max-height: {maxHeight}"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="-1"
    >
      <div class="sheet-handle-bar">
        <div class="sheet-handle"></div>
      </div>
      {@render children?.()}
    </div>
  </div>
{/if}

<style>
  /* ── Overlay ─────────────────────────────────────────────────────────── */
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--modal-backdrop, rgba(0, 0, 0, 0.7));
    backdrop-filter: blur(var(--modal-blur, 12px));
    -webkit-backdrop-filter: blur(var(--modal-blur, 12px));
    padding: 24px;
    animation: modalOverlayIn 0.25s ease-out;
  }

  /* Safe-area offsets on 768-and-below (Dynamic Island + tab bar) */
  @media (max-width: 767px) {
    .modal-overlay {
      padding-top: max(24px, calc(env(safe-area-inset-top, 0px) + 16px));
      padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px) + 16px);
    }
  }

  /* Bottom sheet on mobile */
  @media (max-width: 640px) {
    .modal-overlay {
      align-items: flex-end;
      padding: 0;
    }
  }

  /* ── Sheet container ─────────────────────────────────────────────────── */
  .modal-sheet {
    position: relative;
    width: 100%;
    max-width: var(--max-width, 500px);
    max-height: var(--max-height, 85vh);
    display: flex;
    flex-direction: column;
    overflow: var(--modal-overflow, hidden);
    background: var(--modal-bg, #1e1a14);
    border: 1px solid var(--modal-border, rgba(180, 150, 80, 0.1));
    border-radius: var(--modal-radius, 16px);
    box-shadow: var(
      --modal-shadow,
      0 24px 48px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(180, 150, 80, 0.08)
    );
    animation: modalSheetIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @media (max-width: 640px) {
    .modal-sheet {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      max-width: 100%;
      max-height: 90vh;
      border-radius: 20px 20px 0 0;
      animation: modalSheetSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }
  }

  /* ── Drag handle (mobile only) ───────────────────────────────────────── */
  .sheet-handle-bar {
    display: none;
    flex-shrink: 0;
  }

  .sheet-handle {
    display: none;
  }

  @media (max-width: 640px) {
    .sheet-handle-bar {
      display: flex;
      justify-content: center;
      padding: 10px 0 4px;
    }

    .sheet-handle {
      display: block;
      width: 36px;
      height: 4px;
      border-radius: 2px;
      background: rgba(160, 148, 120, 0.3);
    }
  }

  /* ── Animations ──────────────────────────────────────────────────────── */
  @keyframes modalOverlayIn {
    from {
      opacity: 0;
    }
  }

  @keyframes modalSheetIn {
    from {
      opacity: 0;
      transform: translateY(24px) scale(0.96);
    }
  }

  @keyframes modalSheetSlideUp {
    from {
      opacity: 0;
      transform: translateY(100%);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .modal-overlay,
    .modal-sheet {
      animation: none;
    }
  }
</style>
