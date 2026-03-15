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

  <!-- ═══ Prismatic rays from center (8 rays) ═══ -->
  <div class="prismatic-rays">
    <div class="p-ray r1"></div>
    <div class="p-ray r2"></div>
    <div class="p-ray r3"></div>
    <div class="p-ray r4"></div>
    <div class="p-ray r5"></div>
    <div class="p-ray r6"></div>
    <div class="p-ray r7"></div>
    <div class="p-ray r8"></div>
  </div>

  <!-- ═══ Diamond-shaped motes (16) ═══ -->
  <div class="mote m1"></div>
  <div class="mote m2"></div>
  <div class="mote m3"></div>
  <div class="mote m4"></div>
  <div class="mote m5"></div>
  <div class="mote m6"></div>
  <div class="mote m7"></div>
  <div class="mote m8"></div>
  <div class="mote m9"></div>
  <div class="mote m10"></div>
  <div class="mote m11"></div>
  <div class="mote m12"></div>
  <div class="mote m13"></div>
  <div class="mote m14"></div>
  <div class="mote m15"></div>
  <div class="mote m16"></div>

  <!-- ═══ Refraction overlay ═══ -->
  <div class="refraction-overlay"></div>

  <!-- ═══ Caustic light wash (expands from toggle on ignite) ═══ -->
  <div class="caustic-wash"></div>

  <!-- ═══ Flash overlay ═══ -->
  <div class="flash-overlay"></div>

  <!-- ═══ Caustic sparkles (20 diamond shapes scattered across page) ═══ -->
  <div class="caustic-sparkle cs1"></div>
  <div class="caustic-sparkle cs2"></div>
  <div class="caustic-sparkle cs3"></div>
  <div class="caustic-sparkle cs4"></div>
  <div class="caustic-sparkle cs5"></div>
  <div class="caustic-sparkle cs6"></div>
  <div class="caustic-sparkle cs7"></div>
  <div class="caustic-sparkle cs8"></div>
  <div class="caustic-sparkle cs9"></div>
  <div class="caustic-sparkle cs10"></div>
  <div class="caustic-sparkle cs11"></div>
  <div class="caustic-sparkle cs12"></div>
  <div class="caustic-sparkle cs13"></div>
  <div class="caustic-sparkle cs14"></div>
  <div class="caustic-sparkle cs15"></div>
  <div class="caustic-sparkle cs16"></div>
  <div class="caustic-sparkle cs17"></div>
  <div class="caustic-sparkle cs18"></div>
  <div class="caustic-sparkle cs19"></div>
  <div class="caustic-sparkle cs20"></div>

  <!-- ═══ Toggle zone ═══ -->
  <div class="toggle-zone">
    <!-- ═══ Sunbeam container (14 rays radiating from gem) ═══ -->
    <div class="sunbeam-container">
      <div class="sunbeam sb1"></div>
      <div class="sunbeam sb2"></div>
      <div class="sunbeam sb3"></div>
      <div class="sunbeam sb4"></div>
      <div class="sunbeam sb5"></div>
      <div class="sunbeam sb6"></div>
      <div class="sunbeam sb7"></div>
      <div class="sunbeam sb8"></div>
      <div class="sunbeam sb9"></div>
      <div class="sunbeam sb10"></div>
      <div class="sunbeam sb11"></div>
      <div class="sunbeam sb12"></div>
      <div class="sunbeam sb13"></div>
      <div class="sunbeam sb14"></div>
    </div>

    <!-- ═══ Lens flare ═══ -->
    <div class="lens-flare"></div>
    <div class="lens-flare-secondary"></div>

    <!-- ═══ Toggle aura ═══ -->
    <div class="toggle-aura"></div>

    <!-- ═══ Toggle button ═══ -->
    <button
      class="toggle-btn"
      onclick={handleToggle}
      disabled={toggling}
      aria-label="Toggle demo mode"
    >
      <div class="track">
        <div class="track-shimmer"></div>
        <div class="track-inner-glow"></div>
      </div>
      <div class="knob">
        <div class="gem-glow"></div>
        <div class="gem-bezel"></div>
        <div class="gem-face"></div>
        <div class="gem-flare"></div>
        <div class="gem-specular"></div>
      </div>
    </button>

    <!-- ═══ State label ═══ -->
    <span class="state-label">
      {#if igniting}
        Refracting light…
      {:else if dimming}
        Fading…
      {:else if demoActive}
        Demo active
      {:else}
        Demo inactive
      {/if}
    </span>
  </div>

  <!-- ═══ Info card ═══ -->
  <div class="info-card">
    <h1>Experience Radiant</h1>
    <p>
      Toggle demo mode to explore Radiant Finance with sample data. No account required — all data
      stays on your device.
    </p>
  </div>

  <!-- ═══ Footer ═══ -->
  <footer class="footer">
    <p>Your data never leaves your browser.</p>
  </footer>
</div>

<style>
  /* ╔══════════════════════════════════════════════╗
     ║  RADIANT DEMO — SUNLIGHT REFRACTION THEME   ║
     ╚══════════════════════════════════════════════╝ */

  /* ── Palette tokens ── */
  :root {
    --gold: #e8b94a;
    --gold-deep: #d4a039;
    --gold-dark: #b8862e;
    --rose: #e85d75;
    --teal: #2ec4a6;
    --void: #0a0806;
    --text: #f0e8d0;
    --gold-glow: rgba(232, 185, 74, 0.6);
    --gold-bright: #fde68a;
    --white-hot: #fffef5;
  }

  /* ── Reset ── */
  .page {
    position: fixed;
    inset: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family:
      'Inter',
      'Segoe UI',
      system-ui,
      -apple-system,
      sans-serif;
    color: var(--text);
    background: var(--void);
    gap: 2rem;
    -webkit-font-smoothing: antialiased;
  }

  /* ══════════════════════════════════════
     BACKGROUND WASH
     ══════════════════════════════════════ */
  .bg-wash {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 80% 60% at 50% 50%, rgba(232, 185, 74, 0.06) 0%, transparent 70%),
      radial-gradient(ellipse 50% 40% at 30% 40%, rgba(232, 93, 117, 0.03) 0%, transparent 60%),
      radial-gradient(ellipse 50% 40% at 70% 60%, rgba(46, 196, 166, 0.03) 0%, transparent 60%);
    transition: opacity 0.8s ease;
    pointer-events: none;
  }

  .page.active .bg-wash {
    background:
      radial-gradient(ellipse 80% 60% at 50% 50%, rgba(232, 185, 74, 0.12) 0%, transparent 70%),
      radial-gradient(ellipse 50% 40% at 30% 40%, rgba(232, 93, 117, 0.06) 0%, transparent 60%),
      radial-gradient(ellipse 50% 40% at 70% 60%, rgba(46, 196, 166, 0.06) 0%, transparent 60%);
  }

  .page.igniting .bg-wash {
    background:
      radial-gradient(ellipse 100% 80% at 50% 50%, rgba(232, 185, 74, 0.25) 0%, transparent 70%),
      radial-gradient(ellipse 60% 50% at 30% 40%, rgba(232, 93, 117, 0.1) 0%, transparent 60%),
      radial-gradient(ellipse 60% 50% at 70% 60%, rgba(46, 196, 166, 0.1) 0%, transparent 60%);
  }

  /* ══════════════════════════════════════
     CRYSTAL SHARDS (5 floating polygons)
     ══════════════════════════════════════ */
  .crystal-shard {
    position: absolute;
    pointer-events: none;
    opacity: 0.04;
    transition:
      opacity 1s ease,
      filter 1s ease;
  }

  .page.active .crystal-shard {
    opacity: 0.08;
  }

  .page.igniting .crystal-shard {
    opacity: 0.18;
    filter: brightness(2.5) saturate(1.5);
  }

  .sh1 {
    width: 280px;
    height: 200px;
    top: 5%;
    left: -2%;
    background: linear-gradient(135deg, rgba(232, 185, 74, 0.3), transparent);
    clip-path: polygon(20% 0%, 80% 10%, 100% 60%, 70% 100%, 10% 80%);
    animation: shard-drift-1 25s ease-in-out infinite;
  }
  .sh2 {
    width: 200px;
    height: 260px;
    top: 60%;
    right: -3%;
    background: linear-gradient(200deg, rgba(232, 93, 117, 0.3), transparent);
    clip-path: polygon(50% 0%, 100% 30%, 85% 100%, 15% 90%, 0% 40%);
    animation: shard-drift-2 30s ease-in-out infinite;
  }
  .sh3 {
    width: 180px;
    height: 180px;
    top: 15%;
    right: 10%;
    background: linear-gradient(160deg, rgba(46, 196, 166, 0.25), transparent);
    clip-path: polygon(30% 0%, 100% 20%, 80% 100%, 0% 70%);
    animation: shard-drift-3 22s ease-in-out infinite;
  }
  .sh4 {
    width: 150px;
    height: 220px;
    bottom: 10%;
    left: 8%;
    background: linear-gradient(180deg, rgba(232, 185, 74, 0.2), transparent);
    clip-path: polygon(40% 0%, 90% 15%, 100% 70%, 50% 100%, 0% 60%);
    animation: shard-drift-4 28s ease-in-out infinite;
  }
  .sh5 {
    width: 240px;
    height: 160px;
    top: 40%;
    left: 5%;
    background: linear-gradient(120deg, rgba(232, 93, 117, 0.15), rgba(46, 196, 166, 0.15));
    clip-path: polygon(10% 0%, 70% 5%, 100% 50%, 60% 100%, 0% 80%);
    animation: shard-drift-5 26s ease-in-out infinite;
  }

  @keyframes shard-drift-1 {
    0%,
    100% {
      transform: translate(0, 0) rotate(0deg);
    }
    50% {
      transform: translate(15px, 20px) rotate(3deg);
    }
  }
  @keyframes shard-drift-2 {
    0%,
    100% {
      transform: translate(0, 0) rotate(0deg);
    }
    50% {
      transform: translate(-10px, -15px) rotate(-2deg);
    }
  }
  @keyframes shard-drift-3 {
    0%,
    100% {
      transform: translate(0, 0) rotate(0deg);
    }
    50% {
      transform: translate(10px, 12px) rotate(4deg);
    }
  }
  @keyframes shard-drift-4 {
    0%,
    100% {
      transform: translate(0, 0) rotate(0deg);
    }
    50% {
      transform: translate(-8px, 18px) rotate(-3deg);
    }
  }
  @keyframes shard-drift-5 {
    0%,
    100% {
      transform: translate(0, 0) rotate(0deg);
    }
    50% {
      transform: translate(12px, -10px) rotate(2deg);
    }
  }

  /* ══════════════════════════════════════
     CENTRAL DIAMOND SILHOUETTE
     ══════════════════════════════════════ */
  .diamond {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 120px;
    height: 120px;
    pointer-events: none;
    opacity: 0.06;
    transition: opacity 1s ease;
  }
  .page.active .diamond {
    opacity: 0.1;
  }
  .page.igniting .diamond {
    opacity: 0.2;
  }

  .diamond-body {
    position: absolute;
    inset: 0;
    clip-path: polygon(50% 0%, 100% 35%, 80% 100%, 20% 100%, 0% 35%);
    background: linear-gradient(180deg, var(--gold) 0%, var(--gold-dark) 100%);
  }
  .diamond-table {
    position: absolute;
    top: 10%;
    left: 20%;
    right: 20%;
    height: 25%;
    clip-path: polygon(15% 0%, 85% 0%, 100% 100%, 0% 100%);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.3), rgba(232, 185, 74, 0.4));
  }
  .diamond-facet {
    position: absolute;
    top: 35%;
    width: 50%;
    height: 65%;
    opacity: 0.4;
  }
  .diamond-facet.f-l {
    left: 0;
    clip-path: polygon(0% 0%, 100% 0%, 60% 100%);
    background: linear-gradient(160deg, rgba(232, 185, 74, 0.5), transparent);
  }
  .diamond-facet.f-r {
    right: 0;
    clip-path: polygon(0% 0%, 100% 0%, 40% 100%);
    background: linear-gradient(200deg, rgba(212, 160, 57, 0.5), transparent);
  }

  /* ══════════════════════════════════════
     PRISMATIC RAYS FROM CENTER (8 rays)
     ══════════════════════════════════════ */
  .prismatic-rays {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .p-ray {
    position: absolute;
    width: 2px;
    height: 300px;
    transform-origin: center bottom;
    bottom: 0;
    left: -1px;
    opacity: 0.04;
    transition:
      opacity 0.8s ease,
      height 0.8s ease,
      filter 0.8s ease;
  }

  .page.active .p-ray {
    opacity: 0.08;
  }

  .page.igniting .p-ray {
    opacity: 0.3;
    height: 600px;
    filter: brightness(3) blur(1px);
  }

  .p-ray.r1 {
    transform: rotate(0deg);
    background: linear-gradient(to top, var(--gold), transparent);
  }
  .p-ray.r2 {
    transform: rotate(45deg);
    background: linear-gradient(to top, var(--rose), transparent);
  }
  .p-ray.r3 {
    transform: rotate(90deg);
    background: linear-gradient(to top, var(--gold-deep), transparent);
  }
  .p-ray.r4 {
    transform: rotate(135deg);
    background: linear-gradient(to top, var(--teal), transparent);
  }
  .p-ray.r5 {
    transform: rotate(180deg);
    background: linear-gradient(to top, var(--gold), transparent);
  }
  .p-ray.r6 {
    transform: rotate(225deg);
    background: linear-gradient(to top, var(--rose), transparent);
  }
  .p-ray.r7 {
    transform: rotate(270deg);
    background: linear-gradient(to top, var(--gold-deep), transparent);
  }
  .p-ray.r8 {
    transform: rotate(315deg);
    background: linear-gradient(to top, var(--teal), transparent);
  }

  /* ══════════════════════════════════════
     DIAMOND-SHAPED MOTES (16)
     ══════════════════════════════════════ */
  .mote {
    position: absolute;
    width: 8px;
    height: 8px;
    clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
    transform: rotate(45deg);
    background: var(--gold);
    opacity: 0.06;
    pointer-events: none;
    transition: opacity 0.8s ease;
  }

  .page.active .mote {
    opacity: 0.12;
  }
  .page.igniting .mote {
    opacity: 0.35;
  }

  .m1 {
    top: 8%;
    left: 15%;
    animation: mote-float 12s ease-in-out infinite;
  }
  .m2 {
    top: 12%;
    left: 75%;
    animation: mote-float 15s ease-in-out infinite 1s;
    background: var(--rose);
  }
  .m3 {
    top: 20%;
    left: 45%;
    animation: mote-float 10s ease-in-out infinite 0.5s;
  }
  .m4 {
    top: 25%;
    left: 85%;
    animation: mote-float 14s ease-in-out infinite 2s;
    background: var(--teal);
  }
  .m5 {
    top: 35%;
    left: 10%;
    animation: mote-float 13s ease-in-out infinite 1.5s;
  }
  .m6 {
    top: 40%;
    left: 60%;
    animation: mote-float 11s ease-in-out infinite 0.3s;
    background: var(--gold-deep);
  }
  .m7 {
    top: 50%;
    left: 25%;
    animation: mote-float 16s ease-in-out infinite 2.5s;
  }
  .m8 {
    top: 55%;
    left: 90%;
    animation: mote-float 12s ease-in-out infinite 0.8s;
    background: var(--rose);
  }
  .m9 {
    top: 65%;
    left: 40%;
    animation: mote-float 14s ease-in-out infinite 1.2s;
  }
  .m10 {
    top: 70%;
    left: 70%;
    animation: mote-float 10s ease-in-out infinite 1.8s;
    background: var(--teal);
  }
  .m11 {
    top: 78%;
    left: 20%;
    animation: mote-float 15s ease-in-out infinite 0.6s;
  }
  .m12 {
    top: 82%;
    left: 55%;
    animation: mote-float 13s ease-in-out infinite 2.2s;
    background: var(--gold-deep);
  }
  .m13 {
    top: 88%;
    left: 80%;
    animation: mote-float 11s ease-in-out infinite 1.4s;
  }
  .m14 {
    top: 15%;
    left: 30%;
    animation: mote-float 16s ease-in-out infinite 0.9s;
    background: var(--rose);
  }
  .m15 {
    top: 45%;
    left: 50%;
    animation: mote-float 12s ease-in-out infinite 1.7s;
  }
  .m16 {
    top: 92%;
    left: 35%;
    animation: mote-float 14s ease-in-out infinite 2.8s;
    background: var(--teal);
  }

  @keyframes mote-float {
    0%,
    100% {
      transform: rotate(45deg) translate(0, 0);
    }
    25% {
      transform: rotate(45deg) translate(4px, -6px);
    }
    50% {
      transform: rotate(45deg) translate(-3px, 5px);
    }
    75% {
      transform: rotate(45deg) translate(5px, 3px);
    }
  }

  /* ══════════════════════════════════════
     REFRACTION OVERLAY
     ══════════════════════════════════════ */
  .refraction-overlay {
    position: absolute;
    inset: 0;
    background: repeating-conic-gradient(
      from 0deg at 50% 50%,
      transparent 0deg,
      rgba(232, 185, 74, 0.015) 5deg,
      transparent 10deg
    );
    pointer-events: none;
    opacity: 0.5;
    transition: opacity 1s ease;
    animation: refraction-rotate 60s linear infinite;
  }

  .page.active .refraction-overlay {
    opacity: 0.8;
  }

  .page.igniting .refraction-overlay {
    opacity: 1;
    background: repeating-conic-gradient(
      from 0deg at 50% 50%,
      transparent 0deg,
      rgba(232, 185, 74, 0.05) 3deg,
      rgba(232, 93, 117, 0.02) 6deg,
      transparent 9deg
    );
  }

  @keyframes refraction-rotate {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  /* ══════════════════════════════════════
     CAUSTIC LIGHT WASH
     ══════════════════════════════════════ */
  .caustic-wash {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0;
    background: radial-gradient(
      ellipse 120% 100% at 50% 50%,
      rgba(232, 185, 74, 0.35) 0%,
      rgba(232, 185, 74, 0.15) 25%,
      rgba(212, 160, 57, 0.08) 45%,
      rgba(232, 93, 117, 0.04) 65%,
      transparent 85%
    );
    transition: opacity 0.4s ease;
  }

  .page.igniting .caustic-wash {
    opacity: 1;
    animation: caustic-expand 2.5s ease-out forwards;
  }

  .page.dimming .caustic-wash {
    opacity: 0;
    transition: opacity 1.2s ease;
  }

  @keyframes caustic-expand {
    0% {
      background: radial-gradient(
        ellipse 10% 10% at 50% 50%,
        rgba(255, 254, 245, 0.8) 0%,
        rgba(232, 185, 74, 0.6) 30%,
        transparent 60%
      );
      opacity: 1;
    }
    30% {
      background: radial-gradient(
        ellipse 60% 50% at 50% 50%,
        rgba(255, 254, 245, 0.4) 0%,
        rgba(232, 185, 74, 0.3) 25%,
        rgba(232, 93, 117, 0.08) 50%,
        transparent 75%
      );
      opacity: 1;
    }
    100% {
      background: radial-gradient(
        ellipse 140% 120% at 50% 50%,
        rgba(232, 185, 74, 0.15) 0%,
        rgba(232, 185, 74, 0.06) 35%,
        rgba(46, 196, 166, 0.03) 60%,
        transparent 85%
      );
      opacity: 0.7;
    }
  }

  /* ══════════════════════════════════════
     FLASH OVERLAY (initial burst)
     ══════════════════════════════════════ */
  .flash-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0;
    background: radial-gradient(
      circle at 50% 50%,
      rgba(255, 254, 245, 0.9) 0%,
      rgba(232, 185, 74, 0.4) 30%,
      transparent 60%
    );
  }

  .page.igniting .flash-overlay {
    animation: ignite-flash 0.8s ease-out forwards;
  }

  @keyframes ignite-flash {
    0% {
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }

  .page.fading .flash-overlay {
    animation: fade-flash 0.6s ease-out forwards;
  }

  @keyframes fade-flash {
    0% {
      opacity: 0;
    }
    30% {
      opacity: 0.6;
    }
    100% {
      opacity: 1;
    }
  }

  /* ══════════════════════════════════════
     CAUSTIC SPARKLES (20 diamond shapes)
     ══════════════════════════════════════ */
  .caustic-sparkle {
    position: absolute;
    pointer-events: none;
    opacity: 0;
    clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
    transform: rotate(45deg);
    background: var(--gold-bright);
    transition: opacity 0.3s ease;
  }

  .page.igniting .caustic-sparkle {
    animation: sparkle-appear 2s ease-out forwards;
  }

  .page.dimming .caustic-sparkle {
    opacity: 0;
    transition: opacity 0.5s ease;
  }

  @keyframes sparkle-appear {
    0% {
      opacity: 0;
      transform: rotate(45deg) scale(0);
    }
    20% {
      opacity: 1;
      transform: rotate(45deg) scale(1.5);
    }
    40% {
      opacity: 0.8;
      transform: rotate(45deg) scale(1);
    }
    60% {
      opacity: 1;
      transform: rotate(45deg) scale(1.2);
    }
    80% {
      opacity: 0.6;
      transform: rotate(45deg) scale(0.9);
    }
    100% {
      opacity: 0.4;
      transform: rotate(45deg) scale(1);
    }
  }

  .cs1 {
    width: 10px;
    height: 10px;
    top: 10%;
    left: 20%;
    animation-delay: 0.1s;
    background: var(--gold-bright);
  }
  .cs2 {
    width: 7px;
    height: 7px;
    top: 15%;
    left: 70%;
    animation-delay: 0.3s;
    background: var(--rose);
  }
  .cs3 {
    width: 12px;
    height: 12px;
    top: 25%;
    left: 35%;
    animation-delay: 0.15s;
  }
  .cs4 {
    width: 6px;
    height: 6px;
    top: 30%;
    left: 80%;
    animation-delay: 0.5s;
    background: var(--teal);
  }
  .cs5 {
    width: 9px;
    height: 9px;
    top: 18%;
    left: 50%;
    animation-delay: 0.25s;
  }
  .cs6 {
    width: 8px;
    height: 8px;
    top: 40%;
    left: 15%;
    animation-delay: 0.4s;
    background: var(--rose);
  }
  .cs7 {
    width: 11px;
    height: 11px;
    top: 55%;
    left: 85%;
    animation-delay: 0.2s;
  }
  .cs8 {
    width: 6px;
    height: 6px;
    top: 60%;
    left: 25%;
    animation-delay: 0.6s;
    background: var(--teal);
  }
  .cs9 {
    width: 10px;
    height: 10px;
    top: 45%;
    left: 65%;
    animation-delay: 0.35s;
  }
  .cs10 {
    width: 7px;
    height: 7px;
    top: 70%;
    left: 45%;
    animation-delay: 0.45s;
    background: var(--gold-deep);
  }
  .cs11 {
    width: 9px;
    height: 9px;
    top: 75%;
    left: 75%;
    animation-delay: 0.55s;
  }
  .cs12 {
    width: 8px;
    height: 8px;
    top: 80%;
    left: 30%;
    animation-delay: 0.3s;
    background: var(--rose);
  }
  .cs13 {
    width: 12px;
    height: 12px;
    top: 85%;
    left: 60%;
    animation-delay: 0.1s;
    background: var(--teal);
  }
  .cs14 {
    width: 6px;
    height: 6px;
    top: 22%;
    left: 90%;
    animation-delay: 0.7s;
  }
  .cs15 {
    width: 10px;
    height: 10px;
    top: 50%;
    left: 5%;
    animation-delay: 0.4s;
    background: var(--gold-deep);
  }
  .cs16 {
    width: 7px;
    height: 7px;
    top: 35%;
    left: 55%;
    animation-delay: 0.2s;
  }
  .cs17 {
    width: 9px;
    height: 9px;
    top: 65%;
    left: 10%;
    animation-delay: 0.5s;
    background: var(--rose);
  }
  .cs18 {
    width: 11px;
    height: 11px;
    top: 90%;
    left: 50%;
    animation-delay: 0.15s;
  }
  .cs19 {
    width: 6px;
    height: 6px;
    top: 5%;
    left: 40%;
    animation-delay: 0.65s;
    background: var(--teal);
  }
  .cs20 {
    width: 8px;
    height: 8px;
    top: 48%;
    left: 92%;
    animation-delay: 0.35s;
  }

  .page.igniting .cs1 {
    animation-delay: 0.1s;
  }
  .page.igniting .cs2 {
    animation-delay: 0.3s;
  }
  .page.igniting .cs3 {
    animation-delay: 0.15s;
  }
  .page.igniting .cs4 {
    animation-delay: 0.5s;
  }
  .page.igniting .cs5 {
    animation-delay: 0.25s;
  }
  .page.igniting .cs6 {
    animation-delay: 0.4s;
  }
  .page.igniting .cs7 {
    animation-delay: 0.2s;
  }
  .page.igniting .cs8 {
    animation-delay: 0.6s;
  }
  .page.igniting .cs9 {
    animation-delay: 0.35s;
  }
  .page.igniting .cs10 {
    animation-delay: 0.45s;
  }
  .page.igniting .cs11 {
    animation-delay: 0.55s;
  }
  .page.igniting .cs12 {
    animation-delay: 0.3s;
  }
  .page.igniting .cs13 {
    animation-delay: 0.1s;
  }
  .page.igniting .cs14 {
    animation-delay: 0.7s;
  }
  .page.igniting .cs15 {
    animation-delay: 0.4s;
  }
  .page.igniting .cs16 {
    animation-delay: 0.2s;
  }
  .page.igniting .cs17 {
    animation-delay: 0.5s;
  }
  .page.igniting .cs18 {
    animation-delay: 0.15s;
  }
  .page.igniting .cs19 {
    animation-delay: 0.65s;
  }
  .page.igniting .cs20 {
    animation-delay: 0.35s;
  }

  /* ══════════════════════════════════════
     TOGGLE ZONE
     ══════════════════════════════════════ */
  .toggle-zone {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    z-index: 10;
  }

  /* ══════════════════════════════════════
     SUNBEAM CONTAINER (14 rays from gem)
     ══════════════════════════════════════ */
  .sunbeam-container {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 0;
    height: 0;
    pointer-events: none;
    z-index: 1;
  }

  .sunbeam {
    position: absolute;
    transform-origin: center bottom;
    bottom: 0;
    opacity: 0;
    border-radius: 2px 2px 0 0;
    filter: blur(2px);
    transition: opacity 0.3s ease;
  }

  .page.igniting .sunbeam {
    animation: sunbeam-blast 2.2s ease-out forwards;
  }

  .page.dimming .sunbeam {
    animation: sunbeam-retract 1s ease-in forwards;
  }

  @keyframes sunbeam-blast {
    0% {
      opacity: 0;
      height: 0;
    }
    10% {
      opacity: 0.9;
    }
    30% {
      opacity: 0.7;
    }
    100% {
      opacity: 0.3;
    }
  }

  @keyframes sunbeam-retract {
    0% {
      opacity: 0.3;
    }
    100% {
      opacity: 0;
      height: 0;
    }
  }

  /* Each sunbeam: unique angle, width, height, color */
  .sb1 {
    left: -1px;
    width: 3px;
    height: 500px;
    transform: rotate(0deg);
    background: linear-gradient(to top, var(--gold), rgba(255, 254, 245, 0.5) 40%, transparent);
  }
  .sb2 {
    left: -2px;
    width: 5px;
    height: 550px;
    transform: rotate(26deg);
    background: linear-gradient(to top, var(--gold-deep), rgba(232, 185, 74, 0.4) 50%, transparent);
  }
  .sb3 {
    left: -1px;
    width: 2px;
    height: 480px;
    transform: rotate(52deg);
    background: linear-gradient(to top, var(--rose), rgba(232, 93, 117, 0.3) 45%, transparent);
  }
  .sb4 {
    left: -3px;
    width: 6px;
    height: 600px;
    transform: rotate(77deg);
    background: linear-gradient(
      to top,
      var(--gold-bright),
      rgba(253, 230, 138, 0.5) 35%,
      transparent
    );
  }
  .sb5 {
    left: -1px;
    width: 3px;
    height: 520px;
    transform: rotate(103deg);
    background: linear-gradient(to top, var(--teal), rgba(46, 196, 166, 0.3) 40%, transparent);
  }
  .sb6 {
    left: -2px;
    width: 4px;
    height: 470px;
    transform: rotate(128deg);
    background: linear-gradient(to top, var(--gold), rgba(232, 185, 74, 0.4) 50%, transparent);
  }
  .sb7 {
    left: -1px;
    width: 2px;
    height: 560px;
    transform: rotate(154deg);
    background: linear-gradient(
      to top,
      var(--gold-deep),
      rgba(212, 160, 57, 0.35) 45%,
      transparent
    );
  }
  .sb8 {
    left: -2px;
    width: 5px;
    height: 530px;
    transform: rotate(180deg);
    background: linear-gradient(
      to top,
      var(--gold-bright),
      rgba(255, 254, 245, 0.6) 30%,
      transparent
    );
  }
  .sb9 {
    left: -1px;
    width: 3px;
    height: 490px;
    transform: rotate(206deg);
    background: linear-gradient(to top, var(--rose), rgba(232, 93, 117, 0.25) 50%, transparent);
  }
  .sb10 {
    left: -3px;
    width: 7px;
    height: 580px;
    transform: rotate(231deg);
    background: linear-gradient(to top, var(--gold), rgba(232, 185, 74, 0.5) 35%, transparent);
  }
  .sb11 {
    left: -1px;
    width: 2px;
    height: 450px;
    transform: rotate(257deg);
    background: linear-gradient(to top, var(--teal), rgba(46, 196, 166, 0.35) 40%, transparent);
  }
  .sb12 {
    left: -2px;
    width: 4px;
    height: 540px;
    transform: rotate(283deg);
    background: linear-gradient(to top, var(--gold-deep), rgba(212, 160, 57, 0.4) 45%, transparent);
  }
  .sb13 {
    left: -1px;
    width: 3px;
    height: 510px;
    transform: rotate(308deg);
    background: linear-gradient(
      to top,
      var(--gold-bright),
      rgba(253, 230, 138, 0.4) 40%,
      transparent
    );
  }
  .sb14 {
    left: -2px;
    width: 5px;
    height: 570px;
    transform: rotate(334deg);
    background: linear-gradient(to top, var(--gold), rgba(255, 254, 245, 0.45) 35%, transparent);
  }

  .page.igniting .sb1 {
    animation-delay: 0s;
  }
  .page.igniting .sb2 {
    animation-delay: 0.04s;
  }
  .page.igniting .sb3 {
    animation-delay: 0.08s;
  }
  .page.igniting .sb4 {
    animation-delay: 0.02s;
  }
  .page.igniting .sb5 {
    animation-delay: 0.1s;
  }
  .page.igniting .sb6 {
    animation-delay: 0.06s;
  }
  .page.igniting .sb7 {
    animation-delay: 0.12s;
  }
  .page.igniting .sb8 {
    animation-delay: 0.03s;
  }
  .page.igniting .sb9 {
    animation-delay: 0.09s;
  }
  .page.igniting .sb10 {
    animation-delay: 0.01s;
  }
  .page.igniting .sb11 {
    animation-delay: 0.11s;
  }
  .page.igniting .sb12 {
    animation-delay: 0.05s;
  }
  .page.igniting .sb13 {
    animation-delay: 0.07s;
  }
  .page.igniting .sb14 {
    animation-delay: 0.03s;
  }

  /* ══════════════════════════════════════
     LENS FLARE
     ══════════════════════════════════════ */
  .lens-flare {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 600px;
    height: 4px;
    pointer-events: none;
    opacity: 0;
    z-index: 5;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(232, 185, 74, 0.1) 15%,
      rgba(253, 230, 138, 0.3) 30%,
      rgba(255, 254, 245, 0.9) 48%,
      rgba(255, 255, 255, 1) 50%,
      rgba(255, 254, 245, 0.9) 52%,
      rgba(253, 230, 138, 0.3) 70%,
      rgba(232, 185, 74, 0.1) 85%,
      transparent 100%
    );
    border-radius: 50%;
    filter: blur(1px);
  }

  .lens-flare-secondary {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 400px;
    height: 2px;
    pointer-events: none;
    opacity: 0;
    z-index: 5;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(46, 196, 166, 0.05) 20%,
      rgba(232, 93, 117, 0.15) 40%,
      rgba(255, 254, 245, 0.4) 50%,
      rgba(232, 93, 117, 0.15) 60%,
      rgba(46, 196, 166, 0.05) 80%,
      transparent 100%
    );
    border-radius: 50%;
    filter: blur(2px);
    transform: translate(-50%, calc(-50% + 6px));
  }

  .page.igniting .lens-flare {
    animation: flare-streak 2s ease-out forwards;
  }

  .page.igniting .lens-flare-secondary {
    animation: flare-streak-secondary 2s ease-out 0.1s forwards;
  }

  .page.dimming .lens-flare,
  .page.dimming .lens-flare-secondary {
    opacity: 0;
    transition: opacity 0.6s ease;
  }

  @keyframes flare-streak {
    0% {
      opacity: 0;
      width: 0;
    }
    15% {
      opacity: 1;
      width: 700px;
    }
    30% {
      opacity: 0.8;
      width: 500px;
    }
    100% {
      opacity: 0.2;
      width: 300px;
    }
  }

  @keyframes flare-streak-secondary {
    0% {
      opacity: 0;
      width: 0;
    }
    15% {
      opacity: 0.6;
      width: 500px;
    }
    30% {
      opacity: 0.4;
      width: 350px;
    }
    100% {
      opacity: 0.1;
      width: 200px;
    }
  }

  /* ══════════════════════════════════════
     TOGGLE AURA
     ══════════════════════════════════════ */
  .toggle-aura {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 120px;
    height: 120px;
    border-radius: 50%;
    pointer-events: none;
    opacity: 0;
    z-index: 2;
    background: radial-gradient(
      circle,
      rgba(232, 185, 74, 0.4) 0%,
      rgba(232, 185, 74, 0.1) 50%,
      transparent 70%
    );
    transition:
      opacity 0.6s ease,
      width 0.6s ease,
      height 0.6s ease;
  }

  .page.active .toggle-aura {
    opacity: 0.5;
    width: 160px;
    height: 160px;
    animation: aura-pulse 3s ease-in-out infinite;
  }

  .page.igniting .toggle-aura {
    opacity: 1;
    width: 400px;
    height: 400px;
    animation: aura-explode 2s ease-out forwards;
  }

  @keyframes aura-pulse {
    0%,
    100% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 0.4;
    }
    50% {
      transform: translate(-50%, -50%) scale(1.15);
      opacity: 0.6;
    }
  }

  @keyframes aura-explode {
    0% {
      transform: translate(-50%, -50%) scale(0.5);
      opacity: 1;
    }
    30% {
      transform: translate(-50%, -50%) scale(1.5);
      opacity: 0.9;
    }
    100% {
      transform: translate(-50%, -50%) scale(2);
      opacity: 0.3;
    }
  }

  /* ══════════════════════════════════════
     TOGGLE BUTTON
     ══════════════════════════════════════ */
  .toggle-btn {
    position: relative;
    width: 80px;
    height: 40px;
    border: none;
    background: none;
    cursor: pointer;
    padding: 0;
    z-index: 10;
    outline: none;
    -webkit-tap-highlight-color: transparent;
  }

  .toggle-btn:disabled {
    cursor: not-allowed;
  }

  .toggle-btn:focus-visible .track {
    outline: 2px solid var(--gold);
    outline-offset: 3px;
  }

  /* ── Track ── */
  .track {
    position: absolute;
    inset: 0;
    border-radius: 20px;
    background: linear-gradient(135deg, #1a1510 0%, #0d0b08 100%);
    border: 1px solid rgba(232, 185, 74, 0.15);
    overflow: hidden;
    transition:
      border-color 0.6s ease,
      box-shadow 0.6s ease;
  }

  .page.active .track {
    border-color: rgba(232, 185, 74, 0.4);
    box-shadow: inset 0 0 20px rgba(232, 185, 74, 0.15);
  }

  .page.igniting .track {
    border-color: rgba(232, 185, 74, 0.8);
    box-shadow: inset 0 0 30px rgba(232, 185, 74, 0.3);
  }

  .track-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(232, 185, 74, 0.08) 50%,
      transparent 100%
    );
    animation: track-shimmer-slide 4s ease-in-out infinite;
  }

  @keyframes track-shimmer-slide {
    0%,
    100% {
      transform: translateX(-100%);
    }
    50% {
      transform: translateX(100%);
    }
  }

  .track-inner-glow {
    position: absolute;
    inset: 0;
    border-radius: 20px;
    opacity: 0;
    background: radial-gradient(ellipse at 70% 50%, rgba(232, 185, 74, 0.3) 0%, transparent 70%);
    transition: opacity 0.6s ease;
  }

  .page.active .track-inner-glow {
    opacity: 1;
  }

  /* ── Knob (Gem) ── */
  .knob {
    position: absolute;
    top: 50%;
    left: 6px;
    transform: translateY(-50%);
    width: 30px;
    height: 30px;
    transition: left 0.5s cubic-bezier(0.68, -0.3, 0.32, 1.3);
  }

  .page.active .knob {
    left: 44px;
  }

  /* Gem glow (behind the gem) */
  .gem-glow {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 40px;
    height: 40px;
    border-radius: 50%;
    opacity: 0;
    background: radial-gradient(
      circle,
      rgba(232, 185, 74, 0.8) 0%,
      rgba(232, 185, 74, 0.3) 40%,
      transparent 70%
    );
    transition:
      opacity 0.6s ease,
      width 0.6s ease,
      height 0.6s ease;
  }

  .page.active .gem-glow {
    opacity: 0.7;
    animation: gem-heartbeat-active 2s ease-in-out infinite;
  }

  .gem-glow {
    animation: gem-heartbeat 3s ease-in-out infinite;
    opacity: 0.2;
  }

  .page.igniting .gem-glow {
    opacity: 1;
    width: 120px;
    height: 120px;
    background: radial-gradient(
      circle,
      rgba(255, 254, 245, 1) 0%,
      rgba(253, 230, 138, 0.8) 20%,
      rgba(232, 185, 74, 0.5) 40%,
      transparent 65%
    );
    animation: none;
  }

  @keyframes gem-heartbeat {
    0%,
    100% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 0.15;
    }
    50% {
      transform: translate(-50%, -50%) scale(1.2);
      opacity: 0.3;
    }
  }

  @keyframes gem-heartbeat-active {
    0%,
    100% {
      transform: translate(-50%, -50%) scale(1);
      opacity: 0.6;
    }
    50% {
      transform: translate(-50%, -50%) scale(1.3);
      opacity: 0.8;
    }
  }

  /* Gem bezel (hexagonal border) */
  .gem-bezel {
    position: absolute;
    inset: 0;
    clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
    background: linear-gradient(135deg, #3d3225 0%, #1a150f 50%, #2a2118 100%);
    transition: background 0.6s ease;
  }

  .page.active .gem-bezel {
    background: linear-gradient(135deg, var(--gold-dark) 0%, #5a4520 50%, var(--gold-deep) 100%);
  }

  .page.igniting .gem-bezel {
    background: linear-gradient(
      135deg,
      var(--gold-bright) 0%,
      var(--gold) 50%,
      var(--gold-deep) 100%
    );
  }

  /* Gem face (inner hexagonal surface) */
  .gem-face {
    position: absolute;
    inset: 3px;
    clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
    background: linear-gradient(160deg, #1c1710 0%, #12100c 40%, #0d0b08 100%);
    transition: background 0.6s ease;
  }

  .page.active .gem-face {
    background: linear-gradient(
      160deg,
      var(--gold) 0%,
      var(--gold-deep) 40%,
      var(--gold-dark) 100%
    );
  }

  .page.igniting .gem-face {
    background: linear-gradient(
      160deg,
      var(--white-hot) 0%,
      var(--gold-bright) 30%,
      var(--gold) 60%,
      var(--gold-deep) 100%
    );
  }

  /* Gem flare (specular highlight that rotates slowly) */
  .gem-flare {
    position: absolute;
    inset: 2px;
    clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
    background: conic-gradient(
      from 0deg,
      transparent 0deg,
      rgba(255, 255, 255, 0.1) 30deg,
      transparent 60deg,
      transparent 180deg,
      rgba(255, 255, 255, 0.05) 210deg,
      transparent 240deg
    );
    animation: gem-flare-rotate 8s linear infinite;
    opacity: 0.3;
    transition: opacity 0.6s ease;
  }

  .page.active .gem-flare {
    opacity: 0.7;
  }
  .page.igniting .gem-flare {
    opacity: 1;
  }

  @keyframes gem-flare-rotate {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  /* Gem specular (white-hot highlight) */
  .gem-specular {
    position: absolute;
    top: 20%;
    left: 30%;
    width: 8px;
    height: 4px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.3);
    filter: blur(1px);
    opacity: 0;
    transition: opacity 0.6s ease;
  }

  .page.active .gem-specular {
    opacity: 0.8;
    background: rgba(255, 255, 255, 0.6);
  }

  .page.igniting .gem-specular {
    opacity: 1;
    background: white;
    filter: blur(2px);
    width: 12px;
    height: 6px;
    box-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
  }

  /* ══════════════════════════════════════
     STATE LABEL
     ══════════════════════════════════════ */
  .state-label {
    font-size: 0.85rem;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(240, 232, 208, 0.5);
    transition:
      color 0.6s ease,
      text-shadow 0.6s ease;
    text-align: center;
    min-height: 1.3em;
  }

  .page.active .state-label {
    color: var(--gold);
    text-shadow: 0 0 20px rgba(232, 185, 74, 0.4);
  }

  .page.igniting .state-label {
    color: var(--gold-bright);
    text-shadow: 0 0 30px rgba(232, 185, 74, 0.6);
  }

  /* ══════════════════════════════════════
     INFO CARD
     ══════════════════════════════════════ */
  .info-card {
    position: relative;
    z-index: 10;
    max-width: 420px;
    text-align: center;
    padding: 0 1.5rem;
  }

  .info-card h1 {
    font-size: 1.6rem;
    font-weight: 600;
    margin: 0 0 0.6rem;
    background: linear-gradient(135deg, var(--gold) 0%, var(--gold-deep) 50%, var(--rose) 100%);
    background-clip: text;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    letter-spacing: -0.01em;
  }

  .info-card p {
    font-size: 0.95rem;
    line-height: 1.6;
    color: rgba(240, 232, 208, 0.7);
    margin: 0;
  }

  /* ══════════════════════════════════════
     FOOTER
     ══════════════════════════════════════ */
  .footer {
    position: absolute;
    bottom: 2rem;
    z-index: 10;
    text-align: center;
  }

  .footer p {
    font-size: 0.75rem;
    color: rgba(240, 232, 208, 0.3);
    margin: 0;
    letter-spacing: 0.05em;
  }

  /* ══════════════════════════════════════
     FADE TRANSITION (navigating away)
     ══════════════════════════════════════ */
  .page.fading {
    animation: page-fade 0.6s ease-out forwards;
  }

  @keyframes page-fade {
    to {
      opacity: 0;
    }
  }

  /* ══════════════════════════════════════
     RESPONSIVE — 640px
     ══════════════════════════════════════ */
  @media (max-width: 640px) {
    .info-card h1 {
      font-size: 1.35rem;
    }
    .info-card p {
      font-size: 0.88rem;
    }
    .info-card {
      max-width: 340px;
      padding: 0 1rem;
    }

    .lens-flare {
      width: 400px;
    }
    .lens-flare-secondary {
      width: 280px;
    }

    .sunbeam {
      filter: blur(3px);
    }

    .sb1,
    .sb2,
    .sb3,
    .sb4,
    .sb5,
    .sb6,
    .sb7,
    .sb8,
    .sb9,
    .sb10,
    .sb11,
    .sb12,
    .sb13,
    .sb14 {
      height: 350px;
    }

    .page.igniting .sb1,
    .page.igniting .sb2,
    .page.igniting .sb3,
    .page.igniting .sb4,
    .page.igniting .sb5,
    .page.igniting .sb6,
    .page.igniting .sb7,
    .page.igniting .sb8,
    .page.igniting .sb9,
    .page.igniting .sb10,
    .page.igniting .sb11,
    .page.igniting .sb12,
    .page.igniting .sb13,
    .page.igniting .sb14 {
      height: 350px;
    }

    .sh1 {
      width: 180px;
      height: 130px;
    }
    .sh2 {
      width: 130px;
      height: 170px;
    }
    .sh3 {
      width: 120px;
      height: 120px;
    }
    .sh4 {
      width: 100px;
      height: 150px;
    }
    .sh5 {
      width: 160px;
      height: 110px;
    }

    .diamond {
      width: 80px;
      height: 80px;
    }
  }

  /* ══════════════════════════════════════
     RESPONSIVE — 380px
     ══════════════════════════════════════ */
  @media (max-width: 380px) {
    .page {
      gap: 1.2rem;
    }

    .info-card h1 {
      font-size: 1.15rem;
    }
    .info-card p {
      font-size: 0.82rem;
      line-height: 1.5;
    }
    .info-card {
      max-width: 280px;
      padding: 0 0.75rem;
    }

    .state-label {
      font-size: 0.75rem;
    }
    .footer {
      bottom: 1rem;
    }
    .footer p {
      font-size: 0.65rem;
    }

    .lens-flare {
      width: 280px;
    }
    .lens-flare-secondary {
      width: 180px;
    }

    .sb1,
    .sb2,
    .sb3,
    .sb4,
    .sb5,
    .sb6,
    .sb7,
    .sb8,
    .sb9,
    .sb10,
    .sb11,
    .sb12,
    .sb13,
    .sb14 {
      height: 250px;
    }

    .caustic-sparkle {
      transform: rotate(45deg) scale(0.7);
    }
    .diamond {
      width: 60px;
      height: 60px;
    }
  }

  /* ══════════════════════════════════════
     RESPONSIVE — max-height 600px
     ══════════════════════════════════════ */
  @media (max-height: 600px) {
    .page {
      gap: 1rem;
    }
    .info-card h1 {
      font-size: 1.2rem;
    }
    .info-card p {
      font-size: 0.82rem;
    }
    .footer {
      bottom: 0.75rem;
    }

    .sb1,
    .sb2,
    .sb3,
    .sb4,
    .sb5,
    .sb6,
    .sb7,
    .sb8,
    .sb9,
    .sb10,
    .sb11,
    .sb12,
    .sb13,
    .sb14 {
      height: 200px;
    }

    .diamond {
      width: 70px;
      height: 70px;
    }

    .page.igniting .toggle-aura {
      width: 200px;
      height: 200px;
    }
  }

  /* ══════════════════════════════════════
     PREFERS REDUCED MOTION
     ══════════════════════════════════════ */
  @media (prefers-reduced-motion: reduce) {
    .crystal-shard,
    .mote,
    .track-shimmer,
    .gem-flare,
    .refraction-overlay,
    .p-ray {
      animation: none;
    }

    .sunbeam,
    .lens-flare,
    .lens-flare-secondary,
    .caustic-sparkle,
    .caustic-wash,
    .flash-overlay,
    .toggle-aura {
      animation: none;
    }

    .page.igniting .sunbeam,
    .page.igniting .lens-flare,
    .page.igniting .lens-flare-secondary,
    .page.igniting .caustic-sparkle,
    .page.igniting .caustic-wash,
    .page.igniting .flash-overlay,
    .page.igniting .toggle-aura {
      animation: none;
    }

    .page.dimming .sunbeam,
    .page.dimming .lens-flare,
    .page.dimming .lens-flare-secondary {
      animation: none;
    }

    .page.igniting .caustic-wash {
      opacity: 0.5;
    }
    .page.igniting .sunbeam {
      opacity: 0.3;
    }
    .page.igniting .caustic-sparkle {
      opacity: 0.3;
    }

    .gem-glow {
      animation: none;
    }
    .page.active .gem-glow {
      animation: none;
    }
    .page.igniting .gem-glow {
      animation: none;
    }

    .knob {
      transition-duration: 0.1s;
    }

    .page.fading {
      animation-duration: 0.1s;
    }
  }
</style>
