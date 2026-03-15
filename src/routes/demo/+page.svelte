<script lang="ts">
  import { isDemoMode, setDemoMode, cleanupDemoDatabase } from 'stellar-drive';

  let demoActive = $state(isDemoMode());
  let toggling = $state(false);
  let igniting = $state(false);
  let dimming = $state(false);
  let fading = $state(false);

  function handleToggle() {
    if (toggling) return;
    toggling = true;
    const turningOn = !demoActive;
    demoActive = turningOn;

    if (turningOn) {
      igniting = true;
      setTimeout(() => {
        fading = true;
      }, 2400);
      setTimeout(() => {
        setDemoMode(true);
        window.location.href = '/';
      }, 3000);
    } else {
      dimming = true;
      setTimeout(() => {
        fading = true;
      }, 1200);
      setTimeout(() => {
        setDemoMode(false);
        cleanupDemoDatabase('RadiantFinanceDB_demo');
        window.location.href = '/';
      }, 1800);
    }
  }
</script>

<svelte:head>
  <title>Demo Mode — Radiant Finance</title>
</svelte:head>

<div class="page" class:active={demoActive} class:igniting class:dimming class:fading>
  <!-- ═══ Background wash ═══ -->
  <div class="bg-wash"></div>

  <!-- ═══ Crystal shards (5 floating polygons) ═══ -->
  <div class="crystal-shard sh1"></div>
  <div class="crystal-shard sh2"></div>
  <div class="crystal-shard sh3"></div>
  <div class="crystal-shard sh4"></div>
  <div class="crystal-shard sh5"></div>

  <!-- ═══ Central diamond silhouette ═══ -->
  <div class="diamond">
    <div class="diamond-body"></div>
    <div class="diamond-table"></div>
    <div class="diamond-facet f-l"></div>
    <div class="diamond-facet f-r"></div>
  </div>

  <!-- ═══ Prismatic rays (8 radiating from center) ═══ -->
  {#each Array(8) as _, i (i)}
    <div
      class="prism-ray"
      class:on={demoActive}
      style="--angle:{i * 45}deg; --len:{[320, 260, 380, 240, 350, 280, 300, 220][
        i
      ]}px; --delay:{i * 0.08}s"
    ></div>
  {/each}

  <!-- ═══ Golden motes (16 floating particles) ═══ -->
  {#each Array(16) as _, i (i)}
    <span
      class="mote"
      style="
        --mx:{[8, 92, 22, 78, 45, 55, 14, 86, 35, 65, 72, 28, 50, 82, 18, 60][i]}%;
        --my:{[15, 28, 55, 75, 88, 38, 62, 45, 20, 82, 10, 58, 42, 32, 70, 12][i]}%;
        --ms:{[2.5, 3.5, 2, 4, 3, 2.5, 3, 2, 3.5, 2.5, 3, 2, 2.5, 3.5, 2, 3][i]}px;
        --md:{[22, 30, 18, 28, 25, 20, 26, 24, 32, 19, 27, 23, 21, 29, 17, 25][i]}s;
        --mr:{[30, 45, 25, 50, 35, 28, 42, 32, 48, 26, 38, 30, 44, 36, 22, 40][i]}px;
        --mw:{(i * 1.3).toFixed(1)}s;
      "
    ></span>
  {/each}

  <!-- ═══ Refraction overlay ═══ -->
  <div class="refraction"></div>

  <!-- ═══ Flash overlay (golden ignition burst) ═══ -->
  <div class="flash"></div>

  <!-- ═══ Title ═══ -->
  <h1 class="title"><span class="grad">Demo Mode</span></h1>
  <p class="sub">Explore Radiant Finance with sample data — no account required</p>

  <!-- ═══════════════════════════════════════════════════════════════════════
       THE TOGGLE — a gemstone brought to life
       ═══════════════════════════════════════════════════════════════════════ -->
  <div class="tz">
    <!-- Ignition rings (3, expand on toggle activation) -->
    <div class="ignite-ring ir1"></div>
    <div class="ignite-ring ir2"></div>
    <div class="ignite-ring ir3"></div>

    <!-- Warm aura behind toggle -->
    <div class="toggle-aura" class:on={demoActive}></div>

    <button
      class="tog"
      class:on={demoActive}
      onclick={handleToggle}
      disabled={toggling}
      aria-label={demoActive ? 'Deactivate demo mode' : 'Activate demo mode'}
    >
      <span class="track">
        <span class="track-shimmer"></span>
        <span class="track-inner-glow"></span>
        <span class="knob">
          <span class="gem-glow"></span>
          <span class="gem-bezel"></span>
          <span class="gem-face"></span>
          <span class="gem-flare"></span>
        </span>
      </span>
    </button>
    <span class="state-label" class:on={demoActive}>{demoActive ? 'ACTIVE' : 'INACTIVE'}</span>
  </div>

  <!-- ═══ Info card ═══ -->
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
  /* ═══════════════════════════════════════════════════════════════════════════
     1. PAGE BASE
     ═══════════════════════════════════════════════════════════════════════════ */

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
    background: #0a0806;
    color: #f0e8d0;
    font-family: inherit;
    transition:
      opacity 0.7s ease,
      filter 0.7s ease,
      transform 0.7s ease;
  }

  .page.fading {
    opacity: 0;
    filter: blur(20px);
    transform: scale(1.08);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     2. BACKGROUND WASH (warm radial gradients)
     ═══════════════════════════════════════════════════════════════════════════ */

  .bg-wash {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background:
      radial-gradient(ellipse 80% 60% at 25% 75%, rgba(184, 134, 46, 0.1) 0%, transparent 60%),
      radial-gradient(ellipse 60% 50% at 75% 25%, rgba(232, 185, 74, 0.06) 0%, transparent 50%),
      radial-gradient(ellipse 50% 40% at 50% 50%, rgba(46, 196, 166, 0.03) 0%, transparent 40%);
    opacity: 0;
    animation: fadeIn 1.5s 0.2s ease forwards;
  }

  .page.active .bg-wash {
    background:
      radial-gradient(ellipse 80% 60% at 25% 75%, rgba(184, 134, 46, 0.16) 0%, transparent 60%),
      radial-gradient(ellipse 60% 50% at 75% 25%, rgba(232, 185, 74, 0.1) 0%, transparent 50%),
      radial-gradient(ellipse 50% 40% at 50% 50%, rgba(46, 196, 166, 0.06) 0%, transparent 40%);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     3. CRYSTAL SHARDS (5 floating gem polygons)
     ═══════════════════════════════════════════════════════════════════════════ */

  .crystal-shard {
    position: absolute;
    border: 1px solid rgba(232, 185, 74, 0.08);
    pointer-events: none;
    z-index: 0;
    opacity: 0;
    animation-fill-mode: forwards;
  }

  .sh1 {
    width: 340px;
    height: 340px;
    top: -80px;
    right: -100px;
    background: linear-gradient(135deg, rgba(184, 134, 46, 0.07) 0%, transparent 70%);
    clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%);
    animation:
      fadeIn 1s 0.3s ease forwards,
      shardFloat 20s ease-in-out infinite;
  }

  .sh2 {
    width: 240px;
    height: 240px;
    bottom: 8%;
    left: -50px;
    background: linear-gradient(225deg, rgba(46, 196, 166, 0.06) 0%, transparent 70%);
    clip-path: polygon(50% 0%, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%);
    animation:
      fadeIn 1s 0.5s ease forwards,
      shardFloat 25s ease-in-out infinite reverse;
  }

  .sh3 {
    width: 180px;
    height: 180px;
    top: 25%;
    left: 12%;
    background: linear-gradient(315deg, rgba(240, 200, 122, 0.05) 0%, transparent 70%);
    clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
    animation:
      fadeIn 1s 0.7s ease forwards,
      shardFloat 18s ease-in-out infinite;
    animation-delay:
      0.7s,
      -5s;
  }

  .sh4 {
    width: 140px;
    height: 140px;
    bottom: 18%;
    right: 8%;
    background: linear-gradient(180deg, rgba(232, 93, 117, 0.04) 0%, transparent 70%);
    clip-path: polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%);
    animation:
      fadeIn 1s 0.9s ease forwards,
      shardFloat 22s ease-in-out infinite;
    animation-delay:
      0.9s,
      -8s;
  }

  .sh5 {
    width: 100px;
    height: 100px;
    top: 12%;
    right: 20%;
    background: linear-gradient(45deg, rgba(232, 185, 74, 0.05) 0%, transparent 70%);
    clip-path: polygon(50% 0%, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%);
    animation:
      fadeIn 1s 1.1s ease forwards,
      shardFloat 16s ease-in-out infinite;
    animation-delay:
      1.1s,
      -3s;
  }

  @keyframes shardFloat {
    0%,
    100% {
      transform: translateY(0) rotate(0deg);
    }
    33% {
      transform: translateY(-15px) rotate(2deg);
    }
    66% {
      transform: translateY(10px) rotate(-1.5deg);
    }
  }

  .page.igniting .crystal-shard {
    transition: filter 1s ease-out;
    filter: brightness(1.8);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     4. CENTRAL DIAMOND SILHOUETTE
     ═══════════════════════════════════════════════════════════════════════════ */

  .diamond {
    position: absolute;
    top: 50%;
    left: 50%;
    translate: -50% -55%;
    width: 400px;
    height: 400px;
    pointer-events: none;
    z-index: 0;
    opacity: 0;
    animation: fadeIn 2s 0.5s ease forwards;
  }

  .diamond-body {
    position: absolute;
    top: 20%;
    left: 15%;
    width: 70%;
    height: 65%;
    clip-path: polygon(50% 0%, 100% 30%, 85% 100%, 15% 100%, 0% 30%);
    border: 1px solid rgba(232, 185, 74, 0.06);
    background: linear-gradient(
      180deg,
      rgba(232, 185, 74, 0.03) 0%,
      rgba(184, 134, 46, 0.015) 50%,
      rgba(232, 185, 74, 0.025) 100%
    );
    transition:
      border-color 1s,
      background 1s;
  }

  .diamond-table {
    position: absolute;
    top: 20%;
    left: 25%;
    width: 50%;
    height: 18%;
    clip-path: polygon(10% 0%, 90% 0%, 100% 100%, 0% 100%);
    border: 1px solid rgba(232, 185, 74, 0.05);
    background: linear-gradient(180deg, rgba(232, 185, 74, 0.04) 0%, rgba(232, 185, 74, 0.02) 100%);
    transition:
      border-color 1s,
      background 1s;
  }

  .diamond-facet {
    position: absolute;
    width: 0;
    height: 0;
    pointer-events: none;
    transition:
      border-color 1s,
      filter 1s;
  }

  .f-l {
    top: 38%;
    left: 15%;
    border-left: 1px solid rgba(232, 185, 74, 0.04);
    border-top: 100px solid transparent;
    border-bottom: 0;
    border-right: 140px solid rgba(232, 185, 74, 0.015);
  }

  .f-r {
    top: 38%;
    right: 15%;
    border-right: 1px solid rgba(232, 185, 74, 0.04);
    border-top: 100px solid transparent;
    border-bottom: 0;
    border-left: 140px solid rgba(232, 185, 74, 0.015);
  }

  /* Diamond brightens when active */
  .page.active .diamond-body {
    border-color: rgba(232, 185, 74, 0.15);
    background: linear-gradient(
      180deg,
      rgba(232, 185, 74, 0.07) 0%,
      rgba(184, 134, 46, 0.03) 50%,
      rgba(232, 185, 74, 0.05) 100%
    );
  }

  .page.active .diamond-table {
    border-color: rgba(232, 185, 74, 0.12);
    background: linear-gradient(180deg, rgba(232, 185, 74, 0.08) 0%, rgba(232, 185, 74, 0.04) 100%);
  }

  .page.igniting .diamond {
    animation: diamondFlare 1.5s ease-out forwards;
  }

  @keyframes diamondFlare {
    0% {
      filter: brightness(1);
    }
    30% {
      filter: brightness(3) drop-shadow(0 0 60px rgba(232, 185, 74, 0.5));
    }
    100% {
      filter: brightness(1.2) drop-shadow(0 0 30px rgba(232, 185, 74, 0.2));
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     5. PRISMATIC RAYS (8 light beams from center)
     ═══════════════════════════════════════════════════════════════════════════ */

  .prism-ray {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 2px;
    height: 0;
    transform-origin: center bottom;
    transform: translate(-50%, -50%) rotate(var(--angle)) translateY(-40px);
    background: linear-gradient(
      to top,
      rgba(232, 185, 74, 0.2),
      rgba(232, 185, 74, 0.06),
      transparent
    );
    pointer-events: none;
    opacity: 0;
    z-index: 1;
    transition:
      height 0.8s var(--delay) cubic-bezier(0.16, 1, 0.3, 1),
      opacity 0.6s var(--delay);
  }

  .prism-ray.on {
    height: var(--len);
    opacity: 1;
    animation: rayPulse 5s ease-in-out infinite;
    animation-delay: var(--delay);
  }

  @keyframes rayPulse {
    0%,
    100% {
      opacity: 0.6;
      transform: translate(-50%, -50%) rotate(var(--angle)) translateY(-40px) scaleY(1);
    }
    50% {
      opacity: 0.25;
      transform: translate(-50%, -50%) rotate(var(--angle)) translateY(-40px) scaleY(0.75);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     6. GOLDEN MOTES (16 warm floating particles)
     ═══════════════════════════════════════════════════════════════════════════ */

  .mote {
    position: fixed;
    left: var(--mx);
    top: var(--my);
    width: var(--ms);
    height: var(--ms);
    border-radius: 50%;
    background: rgba(232, 185, 74, 0.4);
    pointer-events: none;
    z-index: 0;
    animation: moteFloat var(--md) var(--mw) ease-in-out infinite;
  }

  @keyframes moteFloat {
    0%,
    100% {
      transform: translate(0, 0) scale(1);
      opacity: 0.1;
    }
    25% {
      transform: translate(calc(var(--mr) * 0.6), calc(var(--mr) * -0.8)) scale(1.5);
      opacity: 0.5;
    }
    50% {
      transform: translate(calc(var(--mr) * -0.4), calc(var(--mr) * -0.5)) scale(0.8);
      opacity: 0.2;
    }
    75% {
      transform: translate(calc(var(--mr) * 0.7), calc(var(--mr) * 0.3)) scale(1.3);
      opacity: 0.4;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     7. REFRACTION OVERLAY
     ═══════════════════════════════════════════════════════════════════════════ */

  .refraction {
    position: fixed;
    inset: 0;
    background: repeating-conic-gradient(
      from 0deg at 50% 50%,
      transparent 0deg 88deg,
      rgba(232, 185, 74, 0.012) 88deg 92deg
    );
    pointer-events: none;
    z-index: 0;
    opacity: 0;
    animation: fadeIn 1s 0.4s ease forwards;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     8. FLASH OVERLAY (golden ignition burst)
     ═══════════════════════════════════════════════════════════════════════════ */

  .flash {
    position: fixed;
    inset: 0;
    z-index: 100;
    pointer-events: none;
    opacity: 0;
    background: radial-gradient(
      circle at 50% 50%,
      rgba(255, 255, 255, 0.9) 0%,
      rgba(232, 185, 74, 0.6) 15%,
      rgba(184, 134, 46, 0.3) 35%,
      transparent 65%
    );
  }

  .page.igniting .flash {
    animation: goldenBurst 1.2s ease-out forwards;
  }

  @keyframes goldenBurst {
    0% {
      opacity: 0;
      transform: scale(0.5);
    }
    20% {
      opacity: 0.85;
      transform: scale(1);
    }
    100% {
      opacity: 0;
      transform: scale(1.5);
    }
  }

  .page.dimming .flash {
    animation: dimFlash 0.5s ease-out forwards;
  }

  @keyframes dimFlash {
    0% {
      opacity: 0;
    }
    25% {
      opacity: 0.2;
    }
    100% {
      opacity: 0;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     9. TITLE (gradient text, dramatic entrance)
     ═══════════════════════════════════════════════════════════════════════════ */

  .title {
    position: relative;
    z-index: 6;
    font-size: clamp(3rem, 10vw, 6rem);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1;
    margin: 0;
    text-align: center;
    opacity: 0;
    animation: titleIn 1.2s 1s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes titleIn {
    from {
      opacity: 0;
      transform: translateY(-50px) scale(0.9);
      filter: blur(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
      filter: blur(0);
    }
  }

  .grad {
    background: linear-gradient(
      135deg,
      #e8b94a 0%,
      #f0d080 20%,
      #e85d75 45%,
      #2ec4a6 65%,
      #e8b94a 85%,
      #f0d080 100%
    );
    background-size: 300% 300%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: gradShift 8s ease-in-out infinite;
  }

  @keyframes gradShift {
    0%,
    100% {
      background-position: 0% 50%;
    }
    50% {
      background-position: 100% 50%;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     10. SUBTITLE
     ═══════════════════════════════════════════════════════════════════════════ */

  .sub {
    position: relative;
    z-index: 6;
    font-size: clamp(0.9rem, 2vw, 1.1rem);
    color: #a09478;
    max-width: 420px;
    margin: -0.25rem auto 0;
    text-align: center;
    line-height: 1.5;
    opacity: 0;
    animation: subIn 0.8s 1.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes subIn {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
    to {
      opacity: 0.85;
      transform: translateY(0);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     11. TOGGLE ZONE (dramatic singularity birth)
     ═══════════════════════════════════════════════════════════════════════════ */

  .tz {
    position: relative;
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    opacity: 0;
    animation: toggleBirth 1.8s 2.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes toggleBirth {
    0% {
      opacity: 0;
      transform: scale(0.01);
      filter: blur(30px) brightness(3);
    }
    30% {
      opacity: 0.7;
      transform: scale(0.5);
      filter: blur(10px) brightness(2);
    }
    60% {
      opacity: 1;
      transform: scale(1.12);
      filter: blur(2px) brightness(1.3);
    }
    80% {
      transform: scale(0.96);
      filter: blur(0) brightness(1.1);
    }
    95% {
      transform: scale(1.03);
    }
    100% {
      opacity: 1;
      transform: scale(1);
      filter: blur(0) brightness(1);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     12. IGNITION RINGS (expand on toggle activation)
     ═══════════════════════════════════════════════════════════════════════════ */

  .ignite-ring {
    position: absolute;
    top: 50%;
    left: 50%;
    translate: -50% -50%;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    pointer-events: none;
    opacity: 0;
    z-index: 1;
  }

  .page.igniting .ir1 {
    border: 2px solid rgba(232, 185, 74, 0.7);
    animation: ringExpand 1.8s 0ms ease-out forwards;
  }

  .page.igniting .ir2 {
    border: 2px solid rgba(232, 93, 117, 0.5);
    animation: ringExpand 1.8s 150ms ease-out forwards;
  }

  .page.igniting .ir3 {
    border: 2px solid rgba(46, 196, 166, 0.4);
    animation: ringExpand 1.8s 300ms ease-out forwards;
  }

  @keyframes ringExpand {
    0% {
      width: 40px;
      height: 40px;
      opacity: 0.8;
      border-width: 2px;
    }
    100% {
      width: 900px;
      height: 900px;
      opacity: 0;
      border-width: 0.3px;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     13. TOGGLE AURA (warm radial glow behind toggle)
     ═══════════════════════════════════════════════════════════════════════════ */

  .toggle-aura {
    position: absolute;
    top: 50%;
    left: 50%;
    translate: -50% -55%;
    width: 160px;
    height: 160px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(232, 185, 74, 0.04) 0%, transparent 70%);
    pointer-events: none;
    transition: all 1s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .toggle-aura.on {
    width: 420px;
    height: 420px;
    background: radial-gradient(
      circle,
      rgba(232, 185, 74, 0.15) 0%,
      rgba(184, 134, 46, 0.06) 35%,
      transparent 70%
    );
    animation: auraPulse 4s ease-in-out infinite;
  }

  @keyframes auraPulse {
    0%,
    100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(1.15);
      opacity: 0.5;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     14. TOGGLE BUTTON
     ═══════════════════════════════════════════════════════════════════════════ */

  .tog {
    position: relative;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    outline: none;
    -webkit-tap-highlight-color: transparent;
    z-index: 5;
  }

  .tog:focus-visible .track {
    outline: 2px solid #e8b94a;
    outline-offset: 6px;
  }

  .tog:disabled {
    cursor: default;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     15. TRACK (gem setting — elongated capsule)
     ═══════════════════════════════════════════════════════════════════════════ */

  .track {
    position: relative;
    display: block;
    width: 220px;
    height: 76px;
    border-radius: 38px;
    background: rgba(16, 12, 8, 0.95);
    border: 2px solid rgba(232, 185, 74, 0.12);
    transition:
      background 0.6s,
      border-color 0.6s,
      box-shadow 0.6s;
    overflow: hidden;
  }

  .tog:not(.on) .track {
    animation: trackBreathe 3.5s 5s ease-in-out infinite;
    animation-fill-mode: both;
  }

  @keyframes trackBreathe {
    0%,
    100% {
      border-color: rgba(232, 185, 74, 0.1);
      box-shadow: none;
    }
    50% {
      border-color: rgba(232, 185, 74, 0.25);
      box-shadow: 0 0 20px rgba(232, 185, 74, 0.05);
    }
  }

  .tog:hover:not(:disabled) .track {
    border-color: rgba(232, 185, 74, 0.3);
    box-shadow: 0 0 24px rgba(232, 185, 74, 0.08);
  }

  .tog.on .track {
    background: linear-gradient(
      135deg,
      rgba(184, 134, 46, 0.25) 0%,
      rgba(232, 185, 74, 0.15) 50%,
      rgba(46, 196, 166, 0.1) 100%
    );
    border-color: rgba(232, 185, 74, 0.5);
    box-shadow:
      0 0 40px rgba(232, 185, 74, 0.25),
      0 0 80px rgba(184, 134, 46, 0.1),
      inset 0 0 30px rgba(232, 185, 74, 0.08);
  }

  .tog.on:hover:not(:disabled) .track {
    box-shadow:
      0 0 55px rgba(232, 185, 74, 0.35),
      0 0 110px rgba(184, 134, 46, 0.15),
      inset 0 0 30px rgba(232, 185, 74, 0.08);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     16. TRACK SHIMMER (golden sweep)
     ═══════════════════════════════════════════════════════════════════════════ */

  .track-shimmer {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(
      110deg,
      transparent 25%,
      rgba(232, 185, 74, 0.03) 42%,
      rgba(232, 185, 74, 0.06) 50%,
      rgba(232, 185, 74, 0.03) 58%,
      transparent 75%
    );
    background-size: 250% 100%;
    opacity: 0;
    transition: opacity 0.5s;
  }

  .tog.on .track-shimmer {
    opacity: 1;
    animation: shimmerSweep 4s 0.3s ease-in-out infinite;
  }

  @keyframes shimmerSweep {
    0% {
      background-position: 250% 0;
    }
    100% {
      background-position: -250% 0;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     17. TRACK INNER GLOW (warm energy flow when ON)
     ═══════════════════════════════════════════════════════════════════════════ */

  .track-inner-glow {
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(232, 185, 74, 0.06) 20%,
      rgba(232, 93, 117, 0.04) 50%,
      rgba(46, 196, 166, 0.05) 80%,
      transparent 100%
    );
    background-size: 200% 100%;
    opacity: 0;
    transition: opacity 0.6s;
  }

  .tog.on .track-inner-glow {
    opacity: 1;
    animation: energyFlow 3.5s linear infinite;
  }

  @keyframes energyFlow {
    0% {
      background-position: -100% 0;
    }
    100% {
      background-position: 100% 0;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     18. KNOB (the gemstone)
     ═══════════════════════════════════════════════════════════════════════════ */

  .knob {
    position: absolute;
    top: 8px;
    left: 8px;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    z-index: 2;
    transition: transform 0.6s cubic-bezier(0.68, -0.15, 0.27, 1.15);
  }

  /* travel = 220 - 16 - 60 = 144 */
  .tog.on .knob {
    transform: translateX(144px);
  }

  .tog:active:not(:disabled) .knob {
    transition-duration: 0.35s;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     19. GEM GLOW (warm radial bloom behind the knob)
     ═══════════════════════════════════════════════════════════════════════════ */

  .gem-glow {
    position: absolute;
    inset: -20px;
    border-radius: 50%;
    background: radial-gradient(
      circle,
      rgba(232, 185, 74, 0.25) 0%,
      rgba(184, 134, 46, 0.1) 40%,
      transparent 70%
    );
    opacity: 0;
    transition: opacity 0.6s ease;
    z-index: 0;
    pointer-events: none;
  }

  .tog.on .gem-glow {
    opacity: 1;
    animation: gemGlowPulse 3s ease-in-out infinite;
  }

  @keyframes gemGlowPulse {
    0%,
    100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(1.8);
      opacity: 0.3;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     20. GEM BEZEL (hexagonal ring around the knob)
     ═══════════════════════════════════════════════════════════════════════════ */

  .gem-bezel {
    position: absolute;
    inset: -3px;
    z-index: 1;
  }

  .gem-bezel::before {
    content: '';
    position: absolute;
    inset: 0;
    clip-path: polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%);
    background: linear-gradient(
      135deg,
      rgba(232, 185, 74, 0.25) 0%,
      rgba(184, 134, 46, 0.12) 50%,
      rgba(232, 185, 74, 0.25) 100%
    );
    transition:
      background 0.6s,
      filter 0.6s;
  }

  .tog:not(.on) .gem-bezel::before {
    animation: bezelBreath 4s 5s ease-in-out infinite;
    animation-fill-mode: both;
  }

  @keyframes bezelBreath {
    0%,
    100% {
      background: linear-gradient(
        135deg,
        rgba(232, 185, 74, 0.15) 0%,
        rgba(184, 134, 46, 0.08) 50%,
        rgba(232, 185, 74, 0.15) 100%
      );
    }
    50% {
      background: linear-gradient(
        135deg,
        rgba(232, 185, 74, 0.3) 0%,
        rgba(184, 134, 46, 0.18) 50%,
        rgba(232, 185, 74, 0.3) 100%
      );
    }
  }

  .tog.on .gem-bezel::before {
    background: linear-gradient(
      135deg,
      rgba(232, 185, 74, 0.55) 0%,
      rgba(46, 196, 166, 0.3) 33%,
      rgba(232, 93, 117, 0.35) 66%,
      rgba(232, 185, 74, 0.55) 100%
    );
    background-size: 300% 300%;
    animation: bezelShift 6s linear infinite;
  }

  @keyframes bezelShift {
    0% {
      background-position: 0% 0%;
    }
    100% {
      background-position: 300% 300%;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     21. GEM FACE (the inner gemstone surface)
     ═══════════════════════════════════════════════════════════════════════════ */

  .gem-face {
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    background: radial-gradient(circle at 38% 32%, #1a1408 0%, #0e0b06 100%);
    box-shadow:
      0 2px 8px rgba(0, 0, 0, 0.5),
      inset 0 1px 2px rgba(255, 255, 255, 0.03);
    transition:
      background 0.6s,
      box-shadow 0.6s;
    z-index: 3;
  }

  /* Heartbeat glow when OFF */
  .tog:not(.on) .gem-face {
    animation: gemHeartbeat 3s 5s ease-in-out infinite;
    animation-fill-mode: both;
  }

  @keyframes gemHeartbeat {
    0%,
    100% {
      box-shadow:
        0 0 8px rgba(232, 185, 74, 0.1),
        0 2px 8px rgba(0, 0, 0, 0.5),
        inset 0 1px 2px rgba(255, 255, 255, 0.03);
    }
    14% {
      box-shadow:
        0 0 18px rgba(232, 185, 74, 0.35),
        0 0 36px rgba(232, 185, 74, 0.15),
        0 2px 8px rgba(0, 0, 0, 0.5),
        inset 0 1px 2px rgba(255, 255, 255, 0.03);
    }
    28% {
      box-shadow:
        0 0 10px rgba(232, 185, 74, 0.15),
        0 2px 8px rgba(0, 0, 0, 0.5),
        inset 0 1px 2px rgba(255, 255, 255, 0.03);
    }
    42% {
      box-shadow:
        0 0 22px rgba(232, 185, 74, 0.4),
        0 0 44px rgba(232, 185, 74, 0.18),
        0 2px 8px rgba(0, 0, 0, 0.5),
        inset 0 1px 2px rgba(255, 255, 255, 0.03);
    }
  }

  .tog:hover:not(:disabled) .gem-face {
    background: radial-gradient(circle at 38% 32%, #241c0e 0%, #140f08 100%);
  }

  .tog.on .gem-face {
    background: linear-gradient(135deg, #e8b94a 0%, #d4a039 35%, #b8862e 70%, #e8b94a 100%);
    background-size: 200% 200%;
    box-shadow:
      0 0 24px rgba(232, 185, 74, 0.8),
      0 0 50px rgba(184, 134, 46, 0.5),
      0 0 100px rgba(232, 185, 74, 0.25),
      0 0 160px rgba(184, 134, 46, 0.1),
      inset 0 1px 4px rgba(255, 255, 255, 0.3);
    animation: gemShift 4s ease-in-out infinite;
  }

  @keyframes gemShift {
    0%,
    100% {
      background-position: 0% 50%;
    }
    50% {
      background-position: 100% 50%;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     22. GEM FLARE (white-hot spark at center)
     ═══════════════════════════════════════════════════════════════════════════ */

  .gem-flare {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 5px;
    height: 5px;
    margin: -2.5px 0 0 -2.5px;
    border-radius: 50%;
    background: rgba(232, 185, 74, 0.2);
    z-index: 4;
    transition:
      width 0.5s,
      height 0.5s,
      margin 0.5s,
      background 0.4s,
      box-shadow 0.4s;
  }

  .tog.on .gem-flare {
    width: 14px;
    height: 14px;
    margin: -7px 0 0 -7px;
    background: radial-gradient(
      circle,
      rgba(255, 255, 255, 0.95) 0%,
      rgba(255, 245, 210, 0.5) 50%,
      transparent 70%
    );
    box-shadow:
      0 0 12px rgba(255, 255, 255, 0.7),
      0 0 24px rgba(232, 185, 74, 0.4);
    animation: flarePulse 2s ease-in-out infinite;
  }

  @keyframes flarePulse {
    0%,
    100% {
      transform: scale(1);
      opacity: 1;
    }
    50% {
      transform: scale(0.6);
      opacity: 0.5;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     23. STATE LABEL
     ═══════════════════════════════════════════════════════════════════════════ */

  .state-label {
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    color: rgba(160, 148, 120, 0.35);
    user-select: none;
    transition:
      color 0.5s,
      text-shadow 0.5s;
  }

  .state-label.on {
    color: #e8b94a;
    text-shadow:
      0 0 20px rgba(232, 185, 74, 0.5),
      0 0 40px rgba(184, 134, 46, 0.2);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     24. IGNITING STATE OVERRIDES
     ═══════════════════════════════════════════════════════════════════════════ */

  .page.igniting .knob {
    transition: transform 0.8s cubic-bezier(0.34, -0.25, 0.15, 1.35);
  }

  .page.igniting .mote {
    animation-duration: 3s;
    opacity: 0.8;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     25. DIMMING STATE OVERRIDES
     ═══════════════════════════════════════════════════════════════════════════ */

  .page.dimming .knob {
    transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .page.dimming .toggle-aura {
    transition-duration: 0.4s;
  }

  .page.dimming .prism-ray {
    transition-duration: 0.3s;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     26. ACTIVE PAGE OVERRIDES
     ═══════════════════════════════════════════════════════════════════════════ */

  .page.active .crystal-shard {
    filter: brightness(1.3);
    transition: filter 1s ease;
  }

  .page.active .refraction {
    background: repeating-conic-gradient(
      from 0deg at 50% 50%,
      transparent 0deg 88deg,
      rgba(232, 185, 74, 0.025) 88deg 92deg
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     27. INFO CARD
     ═══════════════════════════════════════════════════════════════════════════ */

  .info {
    position: relative;
    z-index: 6;
    display: flex;
    gap: 2rem;
    max-width: 480px;
    width: 100%;
    background: rgba(16, 12, 8, 0.5);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(232, 185, 74, 0.08);
    border-radius: 16px;
    padding: clamp(0.75rem, 2vh, 1.5rem) clamp(1rem, 3vw, 2rem);
    opacity: 0;
    animation: infoIn 1s 5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes infoIn {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 0.85;
      transform: translateY(0);
    }
  }

  .info:hover {
    border-color: rgba(232, 185, 74, 0.18);
  }

  .col {
    flex: 1;
  }

  .col h3 {
    font-size: 0.72rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 0 0 0.6rem;
  }

  .ok h3 {
    color: rgba(240, 232, 208, 0.7);
  }

  .cap h3 {
    color: rgba(160, 148, 120, 0.55);
  }

  .col ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .col li {
    font-size: 0.8rem;
    line-height: 1.5;
    padding-left: 1.3rem;
    position: relative;
    color: rgba(160, 148, 120, 0.65);
  }

  .ok li::before {
    content: '\2713';
    position: absolute;
    left: 0;
    color: rgba(46, 196, 166, 0.65);
    font-weight: 700;
    font-size: 0.78rem;
  }

  .cap li::before {
    content: '\2014';
    position: absolute;
    left: 0;
    color: rgba(160, 148, 120, 0.3);
  }

  .divider {
    width: 1px;
    background: rgba(232, 185, 74, 0.08);
    align-self: stretch;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     28. FOOTER
     ═══════════════════════════════════════════════════════════════════════════ */

  .foot {
    position: relative;
    z-index: 6;
    font-size: 0.7rem;
    color: rgba(160, 148, 120, 0.18);
    margin: 0;
    letter-spacing: 0.05em;
    opacity: 0;
    animation: fadeIn 0.8s 5.5s ease forwards;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     29. REDUCED MOTION
     ═══════════════════════════════════════════════════════════════════════════ */

  @media (prefers-reduced-motion: reduce) {
    .crystal-shard,
    .mote,
    .bg-wash,
    .refraction {
      animation: none;
      opacity: 1;
    }

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

    .diamond {
      animation: none;
      opacity: 1;
    }

    .grad {
      animation: none;
      background-position: 0% 50%;
    }

    .flash {
      display: none;
    }

    .ignite-ring {
      display: none;
    }

    .knob,
    .gem-face,
    .gem-glow,
    .gem-bezel::before,
    .gem-flare,
    .track,
    .track-shimmer,
    .track-inner-glow,
    .toggle-aura,
    .prism-ray,
    .state-label {
      transition-duration: 0.15s;
    }

    .tog.on .track-shimmer,
    .tog.on .track-inner-glow,
    .tog.on .gem-glow,
    .tog.on .gem-bezel::before,
    .tog.on .gem-face,
    .tog.on .gem-flare,
    .tog:not(.on) .gem-face,
    .tog:not(.on) .gem-bezel::before,
    .tog:not(.on) .track,
    .toggle-aura.on,
    .prism-ray.on {
      animation: none;
    }

    .page {
      transition-duration: 0.15s;
    }

    .page.igniting .knob,
    .page.dimming .knob {
      transition-duration: 0.15s;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     30. MOBILE (640px)
     ═══════════════════════════════════════════════════════════════════════════ */

  @media (max-width: 640px) {
    .page {
      padding: 1rem;
      padding-top: max(1rem, calc(env(safe-area-inset-top, 0px) + 0.5rem));
      padding-bottom: max(1rem, calc(env(safe-area-inset-bottom, 0px) + 0.5rem));
      gap: clamp(0.5rem, 1.5vh, 1rem);
    }

    .title {
      font-size: clamp(2.5rem, 12vw, 3.8rem);
    }

    .diamond {
      width: 300px;
      height: 300px;
    }

    /* Track: 190x66, knob: 52px, travel = 190-16-52 = 122 */
    .track {
      width: 190px;
      height: 66px;
      border-radius: 33px;
    }

    .knob {
      width: 52px;
      height: 52px;
      top: 7px;
      left: 7px;
    }

    .tog.on .knob {
      transform: translateX(122px);
    }

    .gem-bezel {
      inset: -2px;
    }

    .gem-glow {
      inset: -16px;
    }

    .gem-flare {
      width: 4px;
      height: 4px;
      margin: -2px 0 0 -2px;
    }

    .tog.on .gem-flare {
      width: 11px;
      height: 11px;
      margin: -5.5px 0 0 -5.5px;
    }

    .toggle-aura.on {
      width: 320px;
      height: 320px;
    }

    .sh1 {
      width: 240px;
      height: 240px;
    }

    .sh2 {
      width: 170px;
      height: 170px;
    }

    .sh3 {
      width: 130px;
      height: 130px;
    }

    .sh4 {
      width: 100px;
      height: 100px;
    }

    .sh5 {
      width: 70px;
      height: 70px;
    }

    .info {
      flex-direction: column;
      padding: 1.25rem;
      gap: 0.8rem;
    }

    .divider {
      width: 100%;
      height: 1px;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     31. SMALL MOBILE (380px)
     ═══════════════════════════════════════════════════════════════════════════ */

  @media (max-width: 380px) {
    .page {
      padding: 0.75rem;
      padding-top: max(0.75rem, calc(env(safe-area-inset-top, 0px) + 0.25rem));
      padding-bottom: max(0.75rem, calc(env(safe-area-inset-bottom, 0px) + 0.25rem));
      gap: clamp(0.5rem, 1.2vh, 0.75rem);
    }

    .title {
      font-size: 2.2rem;
    }

    .diamond {
      width: 220px;
      height: 220px;
    }

    /* Track: 160x58, knob: 44px, travel = 160-16-44 = 100 */
    .track {
      width: 160px;
      height: 58px;
      border-radius: 29px;
    }

    .knob {
      width: 44px;
      height: 44px;
      top: 7px;
      left: 7px;
    }

    .tog.on .knob {
      transform: translateX(100px);
    }

    .gem-bezel {
      inset: -2px;
    }

    .gem-glow {
      inset: -12px;
    }

    .gem-flare {
      width: 3px;
      height: 3px;
      margin: -1.5px 0 0 -1.5px;
    }

    .tog.on .gem-flare {
      width: 9px;
      height: 9px;
      margin: -4.5px 0 0 -4.5px;
    }

    .info {
      padding: 1rem;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     32. SHORT VIEWPORTS
     ═══════════════════════════════════════════════════════════════════════════ */

  @media (max-height: 600px) {
    .page {
      gap: 0.5rem;
      padding: 0.5rem 1rem;
    }

    .title {
      font-size: clamp(1.8rem, 8vw, 3rem);
    }

    .diamond {
      width: 200px;
      height: 200px;
    }

    /* Track: 170x58, knob: 46px, travel = 170-16-46 = 108 */
    .track {
      width: 170px;
      height: 58px;
      border-radius: 29px;
    }

    .knob {
      width: 46px;
      height: 46px;
      top: 6px;
      left: 6px;
    }

    .tog.on .knob {
      transform: translateX(108px);
    }

    .info {
      flex-direction: row;
      padding: 0.75rem 1rem;
      gap: 1rem;
    }

    .col li {
      font-size: 0.72rem;
    }

    .col h3 {
      margin-bottom: 0.3rem;
    }

    .foot {
      display: none;
    }
  }
</style>
