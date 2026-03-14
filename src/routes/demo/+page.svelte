<!--
  @fileoverview Demo landing page — try Radiant Finance without an account.

  Provides a sandboxed demo environment with mock data. All changes
  reset on page refresh. No account, email, or setup required.

  Customize this page with your app's design system — add background
  effects, toggle visual styling, and theming to match your brand.
-->
<script lang="ts">
  import { isDemoMode, setDemoMode, cleanupDemoDatabase } from 'stellar-drive';

  let demoActive = $state(isDemoMode());
  let toggling = $state(false);
  let fading = $state(false);

  function handleToggle() {
    if (toggling) return;
    toggling = true;
    const turningOn = !demoActive;
    demoActive = turningOn;

    if (turningOn) {
      setTimeout(() => {
        fading = true;
      }, 1200);
      setTimeout(() => {
        setDemoMode(true);
        window.location.href = '/';
      }, 1800);
    } else {
      setTimeout(() => {
        fading = true;
      }, 800);
      setTimeout(() => {
        setDemoMode(false);
        cleanupDemoDatabase('radiant_demo');
        window.location.href = '/';
      }, 1400);
    }
  }
</script>

<svelte:head>
  <title>Demo Mode — Radiant Finance</title>
</svelte:head>

<div class="page" class:active={demoActive} class:fading>
  <h1 class="title">Demo Mode</h1>
  <p class="sub">Explore Radiant Finance with sample data — no account required</p>

  <!-- Toggle -->
  <div class="tz">
    <button
      class="tog"
      class:on={demoActive}
      onclick={handleToggle}
      disabled={toggling}
      aria-label={demoActive ? 'Disable demo mode' : 'Enable demo mode'}
    >
      <span class="track">
        <span class="knob"></span>
      </span>
    </button>
    <span class="state-label" class:on={demoActive}>{demoActive ? 'ACTIVE' : 'INACTIVE'}</span>
  </div>

  <!-- Info card -->
  <section class="info">
    <div class="col ok">
      <h3>Available</h3>
      <ul>
        <li>Browse all pages</li>
        <li>Create & edit items</li>
        <li>Full app functionality</li>
      </ul>
    </div>
    <div class="divider"></div>
    <div class="col cap">
      <h3>Limited</h3>
      <ul>
        <li>Cloud sync</li>
        <li>Account settings</li>
        <li>Device management</li>
      </ul>
    </div>
  </section>

  <p class="foot">Data resets each session</p>
</div>

<style>
  /* ═══ PAGE ═══ */

  .page {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    padding-top: max(1.5rem, env(safe-area-inset-top, 0px));
    padding-bottom: max(1.5rem, env(safe-area-inset-bottom, 0px));
    padding-left: max(1.5rem, env(safe-area-inset-left, 0px));
    padding-right: max(1.5rem, env(safe-area-inset-right, 0px));
    gap: clamp(0.75rem, 2vh, 1.5rem);
    overflow: hidden;
    background: var(--demo-bg, #0a0a1a);
    color: var(--demo-text, #e8e6f0);
    font-family: inherit;
    transition:
      opacity 0.7s ease,
      filter 0.7s ease,
      transform 0.7s ease;
  }

  /* ═══ EXIT ANIMATION ═══ */

  .page.fading {
    opacity: 0;
    filter: blur(16px);
    transform: scale(1.06);
  }

  /* ═══ TITLE ═══ */

  .title {
    position: relative;
    font-size: clamp(2.5rem, 8vw, 5rem);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1;
    margin: 0;
    text-align: center;
    color: var(--demo-title, inherit);
    opacity: 0;
    animation: titleIn 1s 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes titleIn {
    from {
      opacity: 0;
      transform: translateY(-40px);
      filter: blur(16px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
      filter: blur(0);
    }
  }

  .sub {
    font-size: clamp(0.85rem, 2vw, 1.1rem);
    color: var(--demo-muted, #a09bb5);
    max-width: 420px;
    margin: -0.25rem auto 0;
    text-align: center;
    line-height: 1.5;
    opacity: 0;
    animation: subIn 0.8s 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes subIn {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 0.85;
      transform: translateY(0);
    }
  }

  /* ═══ TOGGLE ZONE ═══ */

  .tz {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    opacity: 0;
    animation: toggleBirth 1.4s 1.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes toggleBirth {
    0% {
      opacity: 0;
      transform: scale(0.5);
      filter: blur(20px);
    }
    50% {
      opacity: 1;
      transform: scale(1.08);
      filter: blur(2px);
    }
    75% {
      transform: scale(0.97);
      filter: blur(0);
    }
    100% {
      opacity: 1;
      transform: scale(1);
      filter: blur(0);
    }
  }

  .tog {
    position: relative;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    outline: none;
    -webkit-tap-highlight-color: transparent;
  }

  .tog:focus-visible .track {
    outline: 2px solid var(--demo-accent, #6c5ce7);
    outline-offset: 6px;
  }

  .tog:disabled {
    cursor: default;
  }

  /* ═══ TRACK ═══ */

  .track {
    position: relative;
    display: block;
    width: 200px;
    height: 68px;
    border-radius: 34px;
    background: var(--demo-track-bg, rgba(255, 255, 255, 0.08));
    border: 2px solid var(--demo-track-border, rgba(255, 255, 255, 0.1));
    transition:
      background 0.4s,
      border-color 0.4s,
      box-shadow 0.4s;
  }

  .tog.on .track {
    background: var(--demo-track-active-bg, rgba(108, 92, 231, 0.25));
    border-color: var(--demo-track-active-border, rgba(108, 92, 231, 0.4));
    box-shadow: 0 0 30px rgba(108, 92, 231, 0.15);
  }

  .tog:hover:not(:disabled) .track {
    border-color: var(--demo-track-hover-border, rgba(255, 255, 255, 0.2));
  }

  /* ═══ KNOB ═══ */

  .knob {
    position: absolute;
    top: 6px;
    left: 6px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--demo-knob-bg, rgba(255, 255, 255, 0.15));
    transition:
      transform 0.5s cubic-bezier(0.68, -0.15, 0.27, 1.15),
      background 0.4s,
      box-shadow 0.4s;
  }

  .tog.on .knob {
    transform: translateX(132px);
    background: var(--demo-knob-active-bg, #6c5ce7);
    box-shadow: 0 0 20px rgba(108, 92, 231, 0.4);
  }

  /* ═══ STATE LABEL ═══ */

  .state-label {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: var(--demo-muted, rgba(160, 155, 181, 0.4));
    user-select: none;
    transition: color 0.4s;
  }

  .state-label.on {
    color: var(--demo-accent, #6c5ce7);
  }

  /* ═══ INFO CARD ═══ */

  .info {
    display: flex;
    gap: 1.5rem;
    max-width: 440px;
    width: 100%;
    background: var(--demo-card-bg, rgba(255, 255, 255, 0.04));
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--demo-card-border, rgba(255, 255, 255, 0.06));
    border-radius: 12px;
    padding: clamp(0.75rem, 2vh, 1.25rem) clamp(1rem, 3vw, 1.5rem);
    opacity: 0;
    animation: infoIn 0.8s 2.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes infoIn {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
    to {
      opacity: 0.8;
      transform: translateY(0);
    }
  }

  .col {
    flex: 1;
  }

  .col h3 {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 0 0 0.5rem;
  }

  .ok h3 {
    color: var(--demo-text, rgba(232, 230, 240, 0.7));
  }

  .cap h3 {
    color: var(--demo-muted, rgba(160, 155, 181, 0.5));
  }

  .col ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .col li {
    font-size: 0.78rem;
    line-height: 1.5;
    padding-left: 1.2rem;
    position: relative;
    color: var(--demo-muted, rgba(160, 155, 181, 0.6));
  }

  .ok li::before {
    content: '\2713';
    position: absolute;
    left: 0;
    color: rgba(38, 222, 129, 0.65);
    font-weight: 700;
    font-size: 0.75rem;
  }

  .cap li::before {
    content: '\2014';
    position: absolute;
    left: 0;
    color: var(--demo-muted, rgba(160, 155, 181, 0.3));
  }

  .divider {
    width: 1px;
    background: var(--demo-card-border, rgba(255, 255, 255, 0.06));
    align-self: stretch;
  }

  /* ═══ FOOTER ═══ */

  .foot {
    font-size: 0.7rem;
    color: var(--demo-muted, rgba(160, 155, 181, 0.2));
    margin: 0;
    letter-spacing: 0.04em;
    opacity: 0;
    animation: fadeIn 0.6s 3.2s ease forwards;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* ═══ REDUCED MOTION ═══ */

  @media (prefers-reduced-motion: reduce) {
    .title,
    .sub,
    .tz,
    .info,
    .foot {
      animation: none;
      opacity: 1;
      filter: none;
      transform: none;
    }

    .page {
      transition-duration: 0.15s;
    }

    .knob,
    .track,
    .state-label {
      transition-duration: 0.15s;
    }
  }

  /* ═══ RESPONSIVE ═══ */

  @media (max-width: 640px) {
    .page {
      padding: 1rem;
      padding-top: max(1rem, calc(env(safe-area-inset-top, 0px) + 0.5rem));
      padding-bottom: max(1rem, calc(env(safe-area-inset-bottom, 0px) + 0.5rem));
      gap: clamp(0.5rem, 1.5vh, 1rem);
    }

    .title {
      font-size: clamp(2rem, 10vw, 3rem);
    }

    .track {
      width: 170px;
      height: 58px;
      border-radius: 29px;
    }

    .knob {
      width: 48px;
      height: 48px;
      top: 5px;
      left: 5px;
    }

    .tog.on .knob {
      transform: translateX(112px);
    }

    .info {
      flex-direction: column;
      gap: 0.6rem;
    }

    .divider {
      width: 100%;
      height: 1px;
    }
  }

  @media (max-width: 380px) {
    .page {
      padding: 0.75rem;
      padding-top: max(0.75rem, calc(env(safe-area-inset-top, 0px) + 0.25rem));
      padding-bottom: max(0.75rem, calc(env(safe-area-inset-bottom, 0px) + 0.25rem));
      gap: clamp(0.5rem, 1.2vh, 0.75rem);
    }

    .title {
      font-size: 1.8rem;
    }

    .track {
      width: 150px;
      height: 52px;
      border-radius: 26px;
    }

    .knob {
      width: 42px;
      height: 42px;
      top: 5px;
      left: 5px;
    }

    .tog.on .knob {
      transform: translateX(98px);
    }

    .info {
      padding: 0.75rem;
    }
  }

  @media (max-height: 600px) {
    .page {
      gap: 0.5rem;
      padding: 0.5rem 1rem;
    }

    .title {
      font-size: clamp(1.5rem, 6vw, 2.5rem);
    }

    .info {
      flex-direction: row;
      padding: 0.6rem 0.75rem;
      gap: 0.75rem;
    }

    .col li {
      font-size: 0.72rem;
    }

    .foot {
      display: none;
    }
  }
</style>
