<!--
  @fileoverview GemPieChart — A cinematic, gem-crystal themed donut/pie chart component.

  Generic reusable pie chart for Radiant Finance. Renders animated donut
  segments with grow-in spring animations, glass-morphism center label,
  interactive hover/tap highlights, and crystalline shimmer effects.

  Design language: obsidian surfaces, citrine accents, glass-morphism,
  spring-curve animations, mobile-first touch targets.
-->
<script lang="ts">
  // ══════════════════════════════════════════════════════════════════════════
  //                              TYPES
  // ══════════════════════════════════════════════════════════════════════════

  export interface PieSegment {
    label: string;
    value: number;
    color: string;
    icon?: string;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //                              PROPS
  // ══════════════════════════════════════════════════════════════════════════

  let {
    title = '',
    segments,
    formatValue,
    height = 220,
    loading = false,
    donut = true,
    centerLabel = '',
    centerValue = ''
  }: {
    title?: string;
    segments: PieSegment[];
    formatValue: (value: number) => string;
    height?: number;
    loading?: boolean;
    donut?: boolean;
    centerLabel?: string;
    centerValue?: string;
  } = $props();

  // ══════════════════════════════════════════════════════════════════════════
  //                           CONSTANTS
  // ══════════════════════════════════════════════════════════════════════════

  const SVG_SIZE = 200;
  const CENTER = SVG_SIZE / 2;
  const RADIUS = 72;
  const STROKE_WIDTH = 26;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const STAGGER_MS = 45;

  // ══════════════════════════════════════════════════════════════════════════
  //                         COMPONENT STATE
  // ══════════════════════════════════════════════════════════════════════════

  let wrapperEl: HTMLDivElement | undefined = $state(undefined);
  let legendEl: HTMLDivElement | undefined = $state(undefined);
  let containerW = $state(0);
  let mounted = $state(false);
  let legendShowTopFade = $state(false);
  let legendShowBottomFade = $state(false);
  /** True once the initial stagger entrance has fully completed — after this, data-change
   * morphs use zero delay so both dashArray and dashOffset animate together. */
  let entranceDone = $state(false);
  let hoveredIndex: number | null = $state(null);
  /** True when the primary pointer is coarse (touch device) — switches from
   * hover to tap-to-toggle interaction model. */
  let isTouchDevice = $state(false);

  // Unique ID prefix for SVG defs (multiple charts on same page)
  const uid = Math.random().toString(36).slice(2, 8);

  // ══════════════════════════════════════════════════════════════════════════
  //                           LIFECYCLE
  // ══════════════════════════════════════════════════════════════════════════

  $effect(() => {
    if (!wrapperEl) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) containerW = e.contentRect.width;
    });
    ro.observe(wrapperEl);
    return () => ro.disconnect();
  });

  // Track legend scroll position to show/hide bottom fade
  $effect(() => {
    const el = legendEl;
    if (!el) return;
    function update() {
      const scrollTop = el!.scrollTop;
      const clientHeight = el!.clientHeight;
      const scrollHeight = el!.scrollHeight;
      const overflows = scrollHeight > clientHeight + 2;
      legendShowTopFade = overflows && scrollTop > 4;
      legendShowBottomFade = overflows && scrollTop + clientHeight < scrollHeight - 4;
    }
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  });

  // Detect touch/coarse-pointer device
  $effect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(pointer: coarse)');
    isTouchDevice = mql.matches;
    const handler = (e: MediaQueryListEvent) => {
      isTouchDevice = e.matches;
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  });

  // Trigger entrance animation on mount
  $effect(() => {
    mounted = false;
    entranceDone = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        mounted = true;
        // Zero out stagger delays after the last segment finishes animating in,
        // so subsequent data-change morphs are clean and simultaneous.
        const lastDelay = (segments.length - 1) * STAGGER_MS;
        setTimeout(() => {
          entranceDone = true;
        }, lastDelay + 850);
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //                         LAYOUT GEOMETRY
  // ══════════════════════════════════════════════════════════════════════════

  const chartH = $derived(Math.max(180, height));

  // SVG scales to fit container while preserving aspect ratio via viewBox
  const _svgWidth = $derived(Math.min(containerW, chartH));

  // ══════════════════════════════════════════════════════════════════════════
  //                        DATA COMPUTATION
  // ══════════════════════════════════════════════════════════════════════════

  const total = $derived(segments.reduce((sum, s) => sum + s.value, 0));
  const hasData = $derived(segments.length > 0 && total > 0);

  /**
   * Compute each segment's stroke-dasharray and stroke-dashoffset values.
   *
   * Applies a per-segment minimum fraction floor so tiny slices always have a
   * tappable arc. The floor scales down with segment count so it doesn't
   * distort charts with many categories. Display fractions are normalised back
   * to sum to 1; true fractions are preserved for percentage display.
   */
  const segmentRender = $derived.by(() => {
    if (!hasData) return [];

    // Adaptive floor: 4% for small charts, shrinks so ≤ 25 segments are usable
    const minFraction = Math.min(0.04, 0.6 / Math.max(segments.length, 1));

    // True fractions from data
    const trueFractions = segments.map((s) => s.value / total);

    // Apply floor and normalise so display fractions still sum to 1
    const floored = trueFractions.map((f) => Math.max(f, minFraction));
    const flooredSum = floored.reduce((a, b) => a + b, 0);
    const displayFractions = floored.map((f) => f / flooredSum);

    let accumulated = 0;
    return segments.map((seg, i) => {
      const displayFrac = displayFractions[i];
      const dashLength = displayFrac * CIRCUMFERENCE;
      const gap = segments.length > 1 ? 2 : 0;
      const effectiveDash = Math.max(0, dashLength - gap);
      const offset = -accumulated + gap / 2;
      accumulated += dashLength;

      return {
        ...seg,
        index: i,
        fraction: trueFractions[i], // true fraction for display
        dashArray: `${effectiveDash} ${CIRCUMFERENCE - effectiveDash}`,
        dashOffset: offset,
        dashArrayHidden: `0 ${CIRCUMFERENCE}`,
        dashOffsetHidden: offset,
        delay: i * STAGGER_MS
      };
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //                     INTERACTION HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  /** Desktop hover — enter */
  function onHoverEnter(index: number) {
    hoveredIndex = index;
  }

  /** Desktop hover — leave */
  function onHoverLeave() {
    hoveredIndex = null;
  }

  /** Mobile tap — toggle highlight for a segment/legend index */
  function onTap(index: number) {
    hoveredIndex = hoveredIndex === index ? null : index;
  }

  /** Mobile tap on SVG background — dismiss any active highlight */
  function onSvgBackgroundTap(e: MouseEvent) {
    if ((e.target as Element).tagName === 'svg') hoveredIndex = null;
  }
</script>

<!-- ═══════════════════════════════════════════════════════════════════════════
     TEMPLATE
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="gem-pie" class:mounted bind:this={wrapperEl}>
  <!-- Header -->
  {#if title}
    <div class="chart-header">
      <h3 class="chart-title">{title}</h3>
    </div>
  {/if}

  <!-- Loading skeleton -->
  {#if loading}
    <div class="chart-canvas" style="height: {chartH}px;">
      <div class="pie-skeleton">
        <svg viewBox="0 0 {SVG_SIZE} {SVG_SIZE}" width="100%" height="100%">
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="var(--gc-border-sub)"
            stroke-width={STROKE_WIDTH}
          />
        </svg>
        <div class="skeleton-shimmer-ring"></div>
      </div>
    </div>
  {:else}
    <!-- Chart SVG -->
    <div class="chart-canvas" style="height: {chartH}px;">
      {#if !hasData}
        <div class="empty-state">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 2a10 10 0 0 1 10 10" />
            <path d="M12 12l5-5" />
          </svg>
          <span>No data available</span>
        </div>
      {:else if containerW > 0}
        <div class="pie-container">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <svg
            viewBox="0 0 {SVG_SIZE} {SVG_SIZE}"
            class="pie-svg"
            role="img"
            aria-label={title || 'Pie chart'}
            onclick={isTouchDevice ? onSvgBackgroundTap : undefined}
          >
            <defs>
              <!-- Glow filters for each segment -->
              {#each segmentRender as seg (seg.index)}
                <filter id="{uid}-glow{seg.index}" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="4" />
                </filter>
              {/each}
            </defs>

            <!-- Segment arcs -->
            {#each segmentRender as seg (seg.index)}
              <!-- Glow layer (visible on active) -->
              <circle
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                stroke={seg.color}
                stroke-width={STROKE_WIDTH + 4}
                stroke-dasharray={mounted ? seg.dashArray : seg.dashArrayHidden}
                stroke-dashoffset={seg.dashOffset}
                stroke-linecap="butt"
                filter="url(#{uid}-glow{seg.index})"
                class="segment-glow"
                class:glow-active={hoveredIndex === seg.index}
                style="transition-delay: {entranceDone ? 0 : seg.delay}ms;"
                transform="rotate(-90 {CENTER} {CENTER})"
              />

              <!-- Main segment -->
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <circle
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="none"
                stroke={seg.color}
                stroke-width={STROKE_WIDTH}
                stroke-dasharray={mounted ? seg.dashArray : seg.dashArrayHidden}
                stroke-dashoffset={seg.dashOffset}
                stroke-linecap="butt"
                class="segment-arc"
                class:hovered={hoveredIndex === seg.index}
                style="transition-delay: {entranceDone ? 0 : seg.delay}ms;"
                transform="rotate(-90 {CENTER} {CENTER})"
                role="img"
                aria-label="{seg.label}: {formatValue(seg.value)}"
                onpointerenter={!isTouchDevice ? () => onHoverEnter(seg.index) : undefined}
                onpointerleave={!isTouchDevice ? onHoverLeave : undefined}
                onclick={isTouchDevice ? () => onTap(seg.index) : undefined}
              />
            {/each}

            <!-- Inner circle mask for non-donut mode -->
            {#if !donut}
              <circle
                cx={CENTER}
                cy={CENTER}
                r={RADIUS - STROKE_WIDTH / 2}
                fill="var(--gc-surface)"
              />
            {/if}
          </svg>

          <!-- Glass-morphism center label (donut mode only) -->
          {#if donut && (centerValue || centerLabel)}
            <div class="center-label" class:center-visible={mounted}>
              {#if centerValue}
                <span class="center-value">{centerValue}</span>
              {/if}
              {#if centerLabel}
                <span class="center-sublabel">{centerLabel}</span>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Legend -->
    {#if hasData}
      <div class="chart-legend-wrap">
        <div class="chart-legend" bind:this={legendEl}>
          {#each segments as seg, i (seg.label)}
            <button
              class="legend-item"
              class:legend-active={hoveredIndex === i}
              style="--li-delay: {i * STAGGER_MS}ms; --seg-color: {seg.color};"
              onpointerenter={!isTouchDevice ? () => onHoverEnter(i) : undefined}
              onpointerleave={!isTouchDevice ? onHoverLeave : undefined}
              onclick={isTouchDevice ? () => onTap(i) : undefined}
            >
              <span
                class="legend-dot"
                style="background: {seg.color}; box-shadow: 0 0 6px {seg.color}40;"
              ></span>
              {#if seg.icon}
                <span class="legend-icon">{seg.icon}</span>
              {/if}
              <span class="legend-label">{seg.label}</span>
              <span class="legend-value">{formatValue(seg.value)}</span>
            </button>
          {/each}
        </div>
        {#if legendShowTopFade}
          <div class="legend-fade legend-fade-top"></div>
        {/if}
        {#if legendShowBottomFade}
          <div class="legend-fade legend-fade-bottom"></div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     STYLES
     ═══════════════════════════════════════════════════════════════════════════ -->
<style>
  /* ────────────────────────────────────────────────────────────────────────
     DESIGN TOKENS
     ──────────────────────────────────────────────────────────────────────── */
  .gem-pie {
    --gc-surface: #161310;
    --gc-raised: #1e1a14;
    --gc-border: rgba(180, 150, 80, 0.1);
    --gc-border-sub: rgba(180, 150, 80, 0.05);
    --gc-text: #f0e8d0;
    --gc-muted: #a09478;
    --gc-dim: #706450;
    --gc-citrine: #dbb044;
    --gc-frost: rgba(200, 180, 120, 0.06);
    --gc-spring: cubic-bezier(0.16, 1, 0.3, 1);
  }

  /* ────────────────────────────────────────────────────────────────────────
     CONTAINER
     ──────────────────────────────────────────────────────────────────────── */
  .gem-pie {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--gc-surface);
    border: 1px solid var(--gc-border);
    border-radius: 16px;
    padding: 20px 16px 16px;
    overflow: hidden;
    /* Entrance */
    opacity: 0;
    transform: translateY(16px);
    transition:
      opacity 0.5s var(--gc-spring),
      transform 0.5s var(--gc-spring);
  }

  .gem-pie.mounted {
    opacity: 1;
    transform: translateY(0);
  }

  @media (min-width: 640px) {
    .gem-pie {
      padding: 24px 24px 20px;
    }
  }

  /* Subtle prismatic sheen */
  .gem-pie::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 16px;
    background: linear-gradient(
      135deg,
      rgba(61, 214, 140, 0.025) 0%,
      transparent 45%,
      rgba(219, 176, 68, 0.025) 100%
    );
    pointer-events: none;
  }

  /* Shimmer sweep on mount */
  .gem-pie::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 16px;
    background: linear-gradient(
      110deg,
      transparent 20%,
      rgba(232, 185, 74, 0.06) 40%,
      rgba(232, 185, 74, 0.1) 50%,
      rgba(232, 185, 74, 0.06) 60%,
      transparent 80%
    );
    background-size: 250% 100%;
    background-position: 200% 0;
    pointer-events: none;
    opacity: 0;
  }

  .gem-pie.mounted::after {
    opacity: 1;
    animation: shimmerSweep 1.8s 0.2s ease-out forwards;
  }

  @keyframes shimmerSweep {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }

  /* ────────────────────────────────────────────────────────────────────────
     HEADER
     ──────────────────────────────────────────────────────────────────────── */
  .chart-header {
    position: relative;
    z-index: 1;
    margin-bottom: 8px;
  }

  .chart-title {
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--gc-muted);
    margin: 0;
    white-space: nowrap;
  }

  /* ────────────────────────────────────────────────────────────────────────
     CHART CANVAS
     ──────────────────────────────────────────────────────────────────────── */
  .chart-canvas {
    position: relative;
    width: 100%;
    z-index: 1;
  }

  /* ── Empty state ─────────────────────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    color: var(--gc-dim);
    font-size: 0.78rem;
    letter-spacing: 0.02em;
  }

  .empty-state svg {
    opacity: 0.4;
  }

  /* ────────────────────────────────────────────────────────────────────────
     PIE CONTAINER
     ──────────────────────────────────────────────────────────────────────── */
  .pie-container {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  .pie-svg {
    display: block;
    width: 100%;
    max-width: 220px;
    height: auto;
  }

  /* ────────────────────────────────────────────────────────────────────────
     SEGMENT ARCS
     ──────────────────────────────────────────────────────────────────────── */
  .segment-arc {
    cursor: pointer;
    transition:
      stroke-dasharray 0.65s var(--gc-spring),
      stroke-dashoffset 0.65s var(--gc-spring),
      stroke-width 0.25s ease,
      filter 0.25s ease;
  }

  .segment-arc.hovered {
    stroke-width: 34;
    filter: drop-shadow(0 0 10px currentColor);
  }

  .segment-glow {
    opacity: 0;
    pointer-events: none;
    transition:
      stroke-dasharray 0.65s var(--gc-spring),
      stroke-dashoffset 0.65s var(--gc-spring);
  }

  .segment-glow.glow-active {
    animation: glowPulse 1.2s ease-in-out infinite;
  }

  @keyframes glowPulse {
    0%,
    100% {
      opacity: 0.2;
    }
    50% {
      opacity: 0.45;
    }
  }

  /* ────────────────────────────────────────────────────────────────────────
     CENTER LABEL (glass-morphism)
     ──────────────────────────────────────────────────────────────────────── */
  .center-label {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0.85);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    pointer-events: none;
    opacity: 0;
    transition:
      opacity 0.5s ease 0.3s,
      transform 0.5s var(--gc-spring) 0.3s;
    /* Glass-morphism */
    background: rgba(12, 10, 6, 0.6);
    backdrop-filter: blur(12px) saturate(1.2);
    -webkit-backdrop-filter: blur(12px) saturate(1.2);
    border: 1px solid rgba(180, 150, 80, 0.08);
    border-radius: 50%;
    width: 72px;
    height: 72px;
  }

  .center-label.center-visible {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }

  .center-value {
    font-size: 1rem;
    font-weight: 700;
    color: var(--gc-text);
    letter-spacing: -0.02em;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }

  .center-sublabel {
    font-size: 0.58rem;
    font-weight: 500;
    color: var(--gc-dim);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    line-height: 1.2;
    margin-top: 1px;
  }

  /* ────────────────────────────────────────────────────────────────────────
     LEGEND
     ──────────────────────────────────────────────────────────────────────── */
  .chart-legend-wrap {
    position: relative;
    margin-top: 14px;
  }

  .chart-legend {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px 8px;
    max-height: 260px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: rgba(180, 150, 80, 0.2) transparent;
  }

  .legend-fade {
    position: absolute;
    left: 0;
    right: 0;
    height: 48px;
    pointer-events: none;
    z-index: 2;
  }

  .legend-fade-top {
    top: 0;
    background: linear-gradient(to top, transparent, var(--gc-surface, #1a1a14));
  }

  .legend-fade-bottom {
    bottom: 0;
    background: linear-gradient(to bottom, transparent, var(--gc-surface, #1a1a14));
  }

  .chart-legend::-webkit-scrollbar {
    width: 3px;
  }

  .chart-legend::-webkit-scrollbar-track {
    background: transparent;
  }

  .chart-legend::-webkit-scrollbar-thumb {
    background: rgba(180, 150, 80, 0.2);
    border-radius: 2px;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    opacity: 0;
    transform: translateY(6px);
    background: none;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 6px 10px;
    cursor: pointer;
    font-family: inherit;
    -webkit-tap-highlight-color: transparent;
    position: relative;
    overflow: hidden;
    transition:
      background 0.22s ease,
      border-color 0.22s ease,
      transform 0.22s var(--gc-spring),
      box-shadow 0.22s ease;
    min-height: 38px;
  }

  /* Left-edge accent bar */
  .legend-item::before {
    content: '';
    position: absolute;
    left: 0;
    top: 20%;
    bottom: 20%;
    width: 2px;
    border-radius: 2px;
    background: var(--seg-color, transparent);
    opacity: 0;
    transition: opacity 0.2s ease;
  }

  .gem-pie.mounted .legend-item {
    opacity: 1;
    transform: translateY(0);
    transition:
      opacity 0.4s ease,
      transform 0.4s var(--gc-spring),
      background 0.22s ease,
      border-color 0.22s ease,
      box-shadow 0.22s ease;
    transition-delay: var(--li-delay);
  }

  .legend-item:hover,
  .legend-item.legend-active {
    background: color-mix(in srgb, var(--seg-color, transparent) 12%, transparent);
    border-color: color-mix(in srgb, var(--seg-color, transparent) 35%, transparent);
    box-shadow: 0 0 16px color-mix(in srgb, var(--seg-color, transparent) 10%, transparent);
    transform: translateY(-1px);
  }

  .legend-item:hover::before,
  .legend-item.legend-active::before {
    opacity: 1;
  }

  /* Dot: grows and brightens on active */
  .legend-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    transition:
      transform 0.22s var(--gc-spring),
      box-shadow 0.22s ease;
  }

  .legend-item:hover .legend-dot,
  .legend-item.legend-active .legend-dot {
    transform: scale(1.5);
    box-shadow:
      0 0 10px var(--seg-color),
      0 0 20px color-mix(in srgb, var(--seg-color) 40%, transparent) !important;
  }

  .legend-icon {
    font-size: 0.82rem;
    flex-shrink: 0;
  }

  .legend-label {
    font-size: 0.68rem;
    color: var(--gc-muted);
    letter-spacing: 0.02em;
    transition: color 0.18s ease;
  }

  .legend-item:hover .legend-label,
  .legend-item.legend-active .legend-label {
    color: var(--gc-text);
  }

  .legend-value {
    font-size: 0.68rem;
    color: var(--gc-text);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    margin-left: auto;
    padding-left: 8px;
    transition: color 0.18s ease;
  }

  .legend-item:hover .legend-value,
  .legend-item.legend-active .legend-value {
    color: color-mix(in srgb, var(--seg-color) 70%, var(--gc-text));
  }

  /* ────────────────────────────────────────────────────────────────────────
     LOADING SKELETON
     ──────────────────────────────────────────────────────────────────────── */
  .pie-skeleton {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  .pie-skeleton svg {
    width: 100%;
    max-width: 220px;
    height: auto;
  }

  .skeleton-shimmer-ring {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .skeleton-shimmer-ring::after {
    content: '';
    width: 180px;
    height: 180px;
    border-radius: 50%;
    background: conic-gradient(
      from 0deg,
      transparent 0%,
      rgba(200, 160, 60, 0.08) 15%,
      rgba(232, 200, 122, 0.12) 25%,
      rgba(200, 160, 60, 0.08) 35%,
      transparent 50%,
      transparent 100%
    );
    animation: skeletonSpin 1.8s linear infinite;
  }

  @keyframes skeletonSpin {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }

  /* ────────────────────────────────────────────────────────────────────────
     MOBILE-FIRST
     ──────────────────────────────────────────────────────────────────────── */
  @media (max-width: 640px) {
    .gem-pie {
      font-size: 15px;
    }

    .center-value {
      font-size: 0.92rem;
    }

    .center-label {
      width: 64px;
      height: 64px;
    }
  }

  /* ────────────────────────────────────────────────────────────────────────
     REDUCED MOTION
     ──────────────────────────────────────────────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    .gem-pie,
    .gem-pie.mounted {
      transition-duration: 0.01ms !important;
    }

    .gem-pie.mounted::after {
      animation-duration: 0.01ms !important;
    }

    .segment-arc,
    .segment-glow {
      transition-duration: 0.01ms !important;
    }

    .segment-glow.glow-active {
      animation-duration: 0.01ms !important;
    }

    .center-label,
    .center-label.center-visible {
      transition-duration: 0.01ms !important;
    }

    .gem-pie.mounted .legend-item {
      transition-duration: 0.01ms !important;
    }

    .skeleton-shimmer-ring::after {
      animation-duration: 0.01ms !important;
    }
  }

  /* ────────────────────────────────────────────────────────────────────────
     MOBILE — instant tap highlight, remove hover transitions
     ──────────────────────────────────────────────────────────────────────── */
  @media (max-width: 767px) {
    /* Remove transition delay so highlight is instant on tap */
    .legend-item,
    .gem-pie.mounted .legend-item {
      transition:
        background 0s,
        border-color 0s,
        box-shadow 0s,
        opacity 0.4s ease,
        transform 0.4s var(--gc-spring);
      transition-delay: var(--li-delay), 0s, 0s;
    }

    .legend-item::before {
      transition: opacity 0s;
    }

    .legend-dot {
      transition:
        transform 0s,
        box-shadow 0s;
    }

    /* Remove the transform-up hover effect on touch */
    .legend-item:hover,
    .legend-item.legend-active {
      transform: none;
    }
  }

  /* ────────────────────────────────────────────────────────────────────────
     MOBILE WIDTH — legend always fully visible (not clipped)
     ──────────────────────────────────────────────────────────────────────── */
  @media (max-width: 767px) {
    /* Legend always fully visible (not clipped) on mobile */
    .chart-legend {
      overflow: visible;
      max-height: none;
    }

    .chart-legend-wrap {
      overflow: visible;
    }

    .legend-fade-top,
    .legend-fade-bottom {
      display: none;
    }
  }
</style>
