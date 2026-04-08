<!--
  @fileoverview GemPieChart — A cinematic, gem-crystal themed donut/pie chart component.

  Generic reusable pie chart for Radiant Finance. Renders animated donut
  segments with grow-in spring animations, glass-morphism center label,
  interactive hover/tap tooltips, and crystalline shimmer effects.

  Design language: obsidian surfaces, citrine accents, glass-morphism tooltips,
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
  const RADIUS = 70;
  const STROKE_WIDTH = 28;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const STAGGER_MS = 60;

  // ══════════════════════════════════════════════════════════════════════════
  //                         COMPONENT STATE
  // ══════════════════════════════════════════════════════════════════════════

  let wrapperEl: HTMLDivElement | undefined = $state(undefined);
  let containerW = $state(0);
  let mounted = $state(false);
  let hoveredIndex: number | null = $state(null);
  let tooltipPos = $state({ x: 0, y: 0 });

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

  // Trigger entrance animation on mount
  $effect(() => {
    mounted = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        mounted = true;
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
   * Each segment is a portion of the circumference, offset to start where
   * the previous segment ended. We rotate -90deg so the first segment
   * starts at 12 o'clock.
   */
  const segmentRender = $derived.by(() => {
    if (!hasData) return [];

    let accumulated = 0;
    return segments.map((seg, i) => {
      const fraction = seg.value / total;
      const dashLength = fraction * CIRCUMFERENCE;
      // Gap between segments (1px visual gap)
      const gap = segments.length > 1 ? 2 : 0;
      const effectiveDash = Math.max(0, dashLength - gap);
      const offset = -accumulated + gap / 2;
      accumulated += dashLength;

      return {
        ...seg,
        index: i,
        fraction,
        dashArray: `${effectiveDash} ${CIRCUMFERENCE - effectiveDash}`,
        dashOffset: offset,
        // For grow-in animation: start fully hidden
        dashArrayHidden: `0 ${CIRCUMFERENCE}`,
        dashOffsetHidden: offset,
        delay: i * STAGGER_MS
      };
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //                     HOVER / TOOLTIP INTERACTION
  // ══════════════════════════════════════════════════════════════════════════

  function onSegmentEnter(index: number, event: PointerEvent | MouseEvent) {
    hoveredIndex = index;
    updateTooltipPos(event);
  }

  function onSegmentMove(event: PointerEvent | MouseEvent) {
    updateTooltipPos(event);
  }

  function onSegmentLeave() {
    hoveredIndex = null;
  }

  function updateTooltipPos(event: PointerEvent | MouseEvent) {
    if (!wrapperEl) return;
    const rect = wrapperEl.getBoundingClientRect();
    tooltipPos = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  const hoveredSegment = $derived(
    hoveredIndex !== null && hoveredIndex < segments.length ? segments[hoveredIndex] : null
  );

  // Tooltip clamping — use fixed positioning so it's never clipped by overflow:hidden
  // and always appears above the hovered element with generous clearance.
  const tipStyle = $derived.by(() => {
    if (!hoveredSegment || !wrapperEl) return '';
    const tipW = 160;
    const rect = wrapperEl.getBoundingClientRect();
    // Convert container-relative coords to viewport coords for fixed positioning
    const viewX = rect.left + tooltipPos.x;
    const viewY = rect.top + tooltipPos.y;
    // Clamp within viewport
    const vw = typeof window !== 'undefined' ? window.innerWidth : 800;
    let x = viewX;
    if (x + tipW / 2 > vw - 12) x = vw - tipW / 2 - 12;
    if (x - tipW / 2 < 12) x = tipW / 2 + 12;
    // Position tooltip above cursor with generous gap (72px)
    return `left: ${x}px; top: ${viewY - 72}px;`;
  });
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
          <svg
            viewBox="0 0 {SVG_SIZE} {SVG_SIZE}"
            class="pie-svg"
            role="img"
            aria-label={title || 'Pie chart'}
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
              <!-- Glow layer (visible on hover) -->
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
                style="transition-delay: {seg.delay}ms;"
                transform="rotate(-90 {CENTER} {CENTER})"
              />

              <!-- Main segment -->
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
                style="transition-delay: {seg.delay}ms;"
                transform="rotate(-90 {CENTER} {CENTER})"
                role="img"
                aria-label="{seg.label}: {seg.value}"
                onpointerenter={(e) => onSegmentEnter(seg.index, e)}
                onpointermove={onSegmentMove}
                onpointerleave={onSegmentLeave}
              />
            {/each}

            <!-- Inner circle mask for non-donut mode is handled by fill -->
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

        <!-- Tooltip -->
        {#if hoveredSegment}
          <div class="pie-tip" style={tipStyle}>
            <div class="tip-row">
              <span class="tip-swatch" style="background: {hoveredSegment.color};"></span>
              {#if hoveredSegment.icon}
                <span class="tip-icon">{hoveredSegment.icon}</span>
              {/if}
              <span class="tip-label">{hoveredSegment.label}</span>
              <span class="tip-val">{formatValue(hoveredSegment.value)}</span>
            </div>
            <div class="tip-pct">
              {((hoveredSegment.value / total) * 100).toFixed(1)}%
            </div>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Legend -->
    {#if hasData}
      <div class="chart-legend">
        {#each segments as seg, i (seg.label)}
          <button
            class="legend-item"
            class:legend-active={hoveredIndex === i}
            style="--li-delay: {i * STAGGER_MS}ms"
            onpointerenter={(e) => onSegmentEnter(i, e)}
            onpointerleave={onSegmentLeave}
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
      stroke-dasharray 0.8s var(--gc-spring),
      stroke-width 0.25s ease,
      filter 0.25s ease;
    /* Minimum touch target ensured by stroke-width (28px on rendered SVG) */
  }

  .segment-arc.hovered {
    stroke-width: 32;
    filter: drop-shadow(0 0 8px currentColor);
  }

  .segment-glow {
    opacity: 0;
    pointer-events: none;
    /* No opacity transition — glow must be immediate on hover */
    transition: stroke-dasharray 0.8s var(--gc-spring);
  }

  .segment-glow.glow-active {
    animation: glowPulse 1.2s ease-in-out infinite;
  }

  @keyframes glowPulse {
    0%,
    100% {
      opacity: 0.15;
    }
    50% {
      opacity: 0.35;
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
     TOOLTIP
     ──────────────────────────────────────────────────────────────────────── */
  .pie-tip {
    /* Fixed positioning so it's never clipped by overflow:hidden on parent */
    position: fixed;
    transform: translateX(-50%);
    background: rgba(12, 10, 6, 0.92);
    backdrop-filter: blur(20px) saturate(1.3);
    -webkit-backdrop-filter: blur(20px) saturate(1.3);
    border: 1px solid rgba(180, 150, 80, 0.2);
    border-radius: 10px;
    padding: 10px 14px;
    pointer-events: none;
    box-shadow:
      0 12px 40px rgba(0, 0, 0, 0.55),
      0 0 0 0.5px rgba(180, 150, 80, 0.1) inset;
    z-index: 9999;
    white-space: nowrap;
    animation: tipReveal 0.18s ease-out;
    min-width: 120px;
  }

  @keyframes tipReveal {
    from {
      opacity: 0;
      transform: translate(-50%, -100%) translateY(4px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -100%) translateY(0) scale(1);
    }
  }

  .tip-row {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 0.72rem;
    color: var(--gc-text);
    line-height: 1.65;
  }

  .tip-swatch {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 4px currentColor;
  }

  .tip-icon {
    font-size: 0.82rem;
    flex-shrink: 0;
  }

  .tip-label {
    color: var(--gc-muted);
    margin-right: auto;
    padding-right: 10px;
  }

  .tip-val {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .tip-pct {
    font-size: 0.6rem;
    color: var(--gc-dim);
    letter-spacing: 0.04em;
    margin-top: 2px;
    text-align: right;
  }

  /* ────────────────────────────────────────────────────────────────────────
     LEGEND
     ──────────────────────────────────────────────────────────────────────── */
  .chart-legend {
    position: relative;
    z-index: 1;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    margin-top: 14px;
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
    transition:
      background 0.2s ease,
      border-color 0.2s ease;
    min-height: 44px;
  }

  .gem-pie.mounted .legend-item {
    opacity: 1;
    transform: translateY(0);
    transition:
      opacity 0.4s ease,
      transform 0.4s var(--gc-spring),
      background 0.2s ease,
      border-color 0.2s ease;
    transition-delay: var(--li-delay);
  }

  .legend-item:hover,
  .legend-item.legend-active {
    background: var(--gc-frost);
    border-color: var(--gc-border);
  }

  .legend-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .legend-icon {
    font-size: 0.82rem;
    flex-shrink: 0;
  }

  .legend-label {
    font-size: 0.68rem;
    color: var(--gc-muted);
    letter-spacing: 0.02em;
  }

  .legend-value {
    font-size: 0.68rem;
    color: var(--gc-text);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    margin-left: auto;
    padding-left: 8px;
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

    .pie-tip {
      animation-duration: 0.01ms !important;
    }

    .skeleton-shimmer-ring::after {
      animation-duration: 0.01ms !important;
    }
  }
</style>
