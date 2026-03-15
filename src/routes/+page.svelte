<!--
  @fileoverview Home / Dashboard — cinematic greeting hero with
  gem-crystal design language and staggered entrance choreography.
-->
<script lang="ts">
  /**
   * @fileoverview Dashboard script — greeting hero with gem-themed
   * crystal design language. Foundation for future dashboard features.
   */

  // ==========================================================================
  //                                IMPORTS
  // ==========================================================================

  /* ── Svelte ── */
  import { onMount } from 'svelte';

  /* ── Stellar Engine — Auth & Stores ── */
  import { resolveFirstName } from 'stellar-drive/auth';
  import { authState } from 'stellar-drive/stores';

  /* ── App Data Stores ── */
  import { accountsStore } from '$lib/stores/data';

  /* ── Types ── */
  import type { Account } from '$lib/types';

  // ==========================================================================
  //                          COMPONENT STATE
  // ==========================================================================

  /** Controls staggered entrance animation. */
  let mounted = $state(false);

  /** Time of day for greeting. */
  const greeting = $derived.by(() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return 'Good morning';
    if (h >= 12 && h < 17) return 'Good afternoon';
    return 'Good evening';
  });

  /** User's first name. */
  const firstName = $derived(resolveFirstName($authState.session, $authState.offlineProfile));

  /** Whether we have any linked accounts. */
  const hasAccounts = $derived(
    ($accountsStore ?? []).filter((a: Account) => !a.is_hidden && a.status === 'open').length > 0
  );

  // ==========================================================================
  //                           LIFECYCLE
  // ==========================================================================

  onMount(() => {
    // Trigger entrance animations
    requestAnimationFrame(() => {
      mounted = true;
    });
  });
</script>

<svelte:head>
  <title>Dashboard - Radiant Finance</title>
</svelte:head>

<!-- ═══════════════════════════════════════════════════════════════════════════
     DASHBOARD LAYOUT
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="dashboard" class:mounted>
  <!-- ─────────────────────────────────────────────────────────────────────
       GREETING HERO
       ───────────────────────────────────────────────────────────────────── -->
  <header class="hero anim-item" style="--delay: 0">
    <div class="hero-bg">
      <div class="crystal-refraction r1"></div>
      <div class="crystal-refraction r2"></div>
      <div class="crystal-refraction r3"></div>
    </div>
    <div class="hero-content">
      <p class="hero-label">Dashboard</p>
      <h1 class="hero-greeting">
        {greeting}, <span class="hero-name">{firstName}</span>
      </h1>
      <p class="hero-subtitle">
        {#if hasAccounts}
          Your finances at a glance
        {:else}
          Connect an account to get started
        {/if}
      </p>
    </div>
  </header>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     STYLES
     ═══════════════════════════════════════════════════════════════════════════ -->
<style>
  /* ──────────────────────────────────────────────────────────────────────────
     DESIGN TOKENS (gem / crystal palette)
     ────────────────────────────────────────────────────────────────────────── */
  .dashboard {
    --gem-void: #0a0806;
    --gem-obsidian: #0e0c08;
    --gem-onyx: #161310;
    --gem-surface: #201c16;
    --gem-surface-2: #2a2520;
    --gem-border: rgba(232, 185, 74, 0.12);
    --gem-border-hover: rgba(232, 185, 74, 0.25);
    --gem-text: #f0e8d0;
    --gem-text-dim: #a09478;
    --gem-text-muted: #706450;
    --gem-citrine: #e8b94a;
    --gem-citrine-glow: rgba(232, 185, 74, 0.15);
    --gem-topaz: #f59e0b;
    --gem-topaz-warm: #d97706;
    --gem-emerald: #34d399;
    --gem-ruby: #f87171;
    --gem-sapphire: #60a5fa;
    --gem-rose-quartz: #f9a8d4;
    --gem-citrine: #fbbf24;
    --gem-jade: #6ee7b7;
    --gem-gradient-gold: linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%);
    --gem-gradient-crystal: linear-gradient(135deg, #e8b94a 0%, #d4a039 50%, #b8862e 100%);
    --gem-gradient-shimmer: linear-gradient(
      110deg,
      transparent 25%,
      rgba(232, 185, 74, 0.06) 37%,
      rgba(232, 185, 74, 0.12) 50%,
      rgba(232, 185, 74, 0.06) 63%,
      transparent 75%
    );
    --radius: 16px;
    --radius-sm: 10px;
  }

  /* ──────────────────────────────────────────────────────────────────────────
     LAYOUT
     ────────────────────────────────────────────────────────────────────────── */
  .dashboard {
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 20px;
    box-sizing: border-box;
  }

  @media (min-width: 768px) {
    .dashboard {
      gap: 24px;
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
     ENTRANCE ANIMATIONS
     ────────────────────────────────────────────────────────────────────────── */
  .anim-item {
    opacity: 0;
    transform: translateY(28px);
    transition:
      opacity 0.55s cubic-bezier(0.16, 1, 0.3, 1),
      transform 0.55s cubic-bezier(0.16, 1, 0.3, 1);
    transition-delay: calc(var(--delay) * 90ms);
  }

  .dashboard.mounted .anim-item {
    opacity: 1;
    transform: translateY(0);
  }

  /* ──────────────────────────────────────────────────────────────────────────
     HERO
     ────────────────────────────────────────────────────────────────────────── */
  .hero {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius);
    padding: 40px 24px 32px;
    background: var(--gem-obsidian);
    border: 1px solid var(--gem-border);
  }

  .hero-bg {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }

  /* Crystal refraction light flares */
  .crystal-refraction {
    position: absolute;
    border-radius: 50%;
    filter: blur(60px);
    opacity: 0.4;
  }

  .r1 {
    width: 200px;
    height: 200px;
    top: -60px;
    right: -40px;
    background: radial-gradient(circle, rgba(232, 185, 74, 0.35), transparent 70%);
    animation: refract-drift 12s ease-in-out infinite alternate;
  }

  .r2 {
    width: 160px;
    height: 160px;
    bottom: -40px;
    left: 10%;
    background: radial-gradient(circle, rgba(96, 165, 250, 0.25), transparent 70%);
    animation: refract-drift 16s ease-in-out infinite alternate-reverse;
  }

  .r3 {
    width: 120px;
    height: 120px;
    top: 20%;
    right: 30%;
    background: radial-gradient(circle, rgba(245, 158, 11, 0.2), transparent 70%);
    animation: refract-drift 10s ease-in-out infinite alternate;
  }

  @keyframes refract-drift {
    0% {
      transform: translate(0, 0) scale(1);
    }
    100% {
      transform: translate(20px, -15px) scale(1.15);
    }
  }

  .hero-content {
    position: relative;
    z-index: 1;
  }

  .hero-label {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--gem-citrine);
    margin: 0 0 8px;
  }

  .hero-greeting {
    font-size: 1.65rem;
    font-weight: 700;
    color: var(--gem-text);
    margin: 0 0 6px;
    line-height: 1.2;
    letter-spacing: -0.01em;
  }

  .hero-name {
    background: var(
      --gem-gradient-crystal,
      linear-gradient(135deg, #e8b94a 0%, #d4a039 50%, #b8862e 100%)
    );
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    background-size: 200% auto;
    animation: gemNameShimmer 6s linear infinite;
  }

  .hero-subtitle {
    font-size: 0.85rem;
    color: var(--gem-text-dim);
    margin: 0;
  }

  @media (max-width: 480px) {
    .hero {
      padding: 28px 16px 24px;
    }
    .hero-greeting {
      font-size: 1.4rem;
    }
  }

  @media (min-width: 768px) {
    .hero {
      padding: 48px 36px 40px;
    }
    .hero-greeting {
      font-size: 2rem;
    }
  }

  /* ──────────────────────────────────────────────────────────────────────────
     PRISMATIC AMBIENT — subtle animated gradient on the whole page
     ────────────────────────────────────────────────────────────────────────── */
  .dashboard::before {
    content: '';
    position: fixed;
    top: 0;
    left: 50%;
    width: 600px;
    height: 400px;
    transform: translateX(-50%);
    background: radial-gradient(ellipse at center, rgba(232, 185, 74, 0.04) 0%, transparent 70%);
    pointer-events: none;
    z-index: -1;
  }

  /* ──────────────────────────────────────────────────────────────────────────
     HERO NAME SHIMMER
     ────────────────────────────────────────────────────────────────────────── */
  @keyframes gemNameShimmer {
    0% {
      background-position: 0% center;
    }
    100% {
      background-position: 200% center;
    }
  }
</style>
