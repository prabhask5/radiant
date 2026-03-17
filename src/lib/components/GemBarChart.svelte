<!--
  @fileoverview GemBarChart — A cinematic, gem-crystal themed vertical bar chart component.

  Generic reusable bar chart for Radiant Finance. Renders vertical bars with
  rounded tops, animated grow-up entrance, optional dashed threshold line with
  breathing glow, hover/tap glass-morphism tooltips, and crystalline shimmer.

  Design language: obsidian surfaces, citrine accents, emerald/ruby threshold
  coloring, glass-morphism tooltips, spring-curve animations.
-->
<script lang="ts">
  // ══════════════════════════════════════════════════════════════════════════
  //                              TYPES
  // ══════════════════════════════════════════════════════════════════════════

  export interface BarData {
    label: string;
    value: number;
    color?: string;
  }

  export interface ThresholdConfig {
    value: number;
    label?: string;
    color?: string;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //                              PROPS
  // ══════════════════════════════════════════════════════════════════════════

  let {
    title = '',
    bars,
    formatValue,
    height = 220,
    loading = false,
    threshold,
    overColor = '#ef4444',
    underColor = '#10b981'
  }: {
    title?: string;
    bars: BarData[];
    formatValue: (value: number) => string;
    height?: number;
    loading?: boolean;
    threshold?: ThresholdConfig;
    overColor?: string;
    underColor?: string;
  } = $props();

  // ══════════════════════════════════════════════════════════════════════════
  //                           CONSTANTS
  // ══════════════════════════════════════════════════════════════════════════

  const GRID_LINES = 4;
  const BAR_GAP_RATIO = 0.3; // gap as fraction of bar+gap unit
  const BAR_RADIUS = 4;
  const MIN_BAR_WIDTH = 20;
  const MAX_BAR_WIDTH = 64;
  const STAGGER_MS = 40;

  // ══════════════════════════════════════════════════════════════════════════
  //                         COMPONENT STATE
  // ══════════════════════════════════════════════════════════════════════════

  let wrapperEl: HTMLDivElement | undefined = $state(undefined);
  let containerW = $state(0);
  let hoveredIndex: number | null = $state(null);
  let mounted = $state(false);

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
    void bars;
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

  const margin = $derived({
    top: 12,
    right: 16,
    bottom: 36,
    left: containerW < 360 ? 44 : 54
  });

  const chartH = $derived(Math.max(160, height));
  const plotW = $derived(Math.max(0, containerW - margin.left - margin.right));
  const plotH = $derived(Math.max(0, chartH - margin.top - margin.bottom));

  // ══════════════════════════════════════════════════════════════════════════
  //                        DATA COMPUTATION
  // ══════════════════════════════════════════════════════════════════════════

  const hasData = $derived(bars.length > 0);

  /** Value extent including threshold in range if present. */
  const valExtent = $derived.by(() => {
    let lo = Infinity,
      hi = -Infinity;
    for (const b of bars) {
      if (b.value < lo) lo = b.value;
      if (b.value > hi) hi = b.value;
    }
    // Include threshold in range
    if (threshold) {
      if (threshold.value < lo) lo = threshold.value;
      if (threshold.value > hi) hi = threshold.value;
    }
    if (lo === Infinity) return { lo: 0, hi: 100 };
    // Always include 0 as baseline for bar charts
    if (lo > 0) lo = 0;
    if (lo === hi) {
      const p = Math.abs(lo) * 0.15 || 10;
      return { lo: lo, hi: hi + p };
    }
    const p = (hi - lo) * 0.1;
    return { lo: lo, hi: hi + p };
  });

  // ── Scale function ───────────────────────────────────────────────────

  function sy(v: number): number {
    const span = valExtent.hi - valExtent.lo;
    if (span === 0) return margin.top + plotH / 2;
    return margin.top + (1 - (v - valExtent.lo) / span) * plotH;
  }

  // ── Y-axis ticks ─────────────────────────────────────────────────────

  const yTicks = $derived.by(() => {
    const range = valExtent.hi - valExtent.lo;
    if (range === 0) return [valExtent.lo];
    const ticks: number[] = [];
    for (let i = 0; i <= GRID_LINES; i++) {
      ticks.push(valExtent.lo + (range * i) / GRID_LINES);
    }
    return ticks;
  });

  // ── Bar geometry ─────────────────────────────────────────────────────

  const barLayout = $derived.by(() => {
    if (!hasData || plotW <= 0) return { barW: 0, bars: [] };

    const n = bars.length;
    const unitW = plotW / n;
    const gap = unitW * BAR_GAP_RATIO;
    let barW = unitW - gap;
    barW = Math.max(MIN_BAR_WIDTH, Math.min(MAX_BAR_WIDTH, barW));

    const baseline = sy(0);

    const renderedBars = bars.map((b, i) => {
      const cx = margin.left + unitW * i + unitW / 2;
      const x = cx - barW / 2;
      const topY = sy(b.value);
      const barHeight = Math.max(0, baseline - topY);

      // Determine color based on threshold
      let color = b.color;
      if (!color && threshold) {
        color = b.value > threshold.value ? overColor : underColor;
      }
      if (!color) color = 'var(--gc-citrine)';

      return {
        index: i,
        label: b.label,
        value: b.value,
        x,
        y: topY,
        width: barW,
        height: barHeight,
        cx,
        baseline,
        color
      };
    });

    return { barW, bars: renderedBars };
  });

  /** Total content width — used for horizontal scroll when bars exceed viewport. */
  const contentWidth = $derived.by(() => {
    if (!hasData) return containerW;
    const n = bars.length;
    const unitW = plotW / n;
    const gap = unitW * BAR_GAP_RATIO;
    let barW = unitW - gap;
    // If bars would be too narrow, calculate needed width
    if (barW < MIN_BAR_WIDTH) {
      const neededUnitW = MIN_BAR_WIDTH / (1 - BAR_GAP_RATIO);
      return margin.left + margin.right + neededUnitW * n;
    }
    return containerW;
  });

  const needsScroll = $derived(contentWidth > containerW);

  // ── Threshold line Y ─────────────────────────────────────────────────

  const thresholdY = $derived(threshold ? sy(threshold.value) : 0);

  // ══════════════════════════════════════════════════════════════════════════
  //                     HOVER / TOOLTIP INTERACTION
  // ══════════════════════════════════════════════════════════════════════════

  const hoverBar = $derived.by(() => {
    if (hoveredIndex === null || !barLayout.bars[hoveredIndex]) return null;
    const b = barLayout.bars[hoveredIndex];

    // Tooltip positioning — keep in bounds
    let tipX = b.cx;
    const tipW = 150;
    const effectiveW = needsScroll ? contentWidth : containerW;
    if (tipX + tipW / 2 > effectiveW - 12) tipX = effectiveW - tipW / 2 - 12;
    if (tipX - tipW / 2 < 12) tipX = tipW / 2 + 12;

    return {
      ...b,
      tipX,
      formattedValue: formatValue(b.value)
    };
  });

  function onBarPointerEnter(index: number) {
    hoveredIndex = index;
  }

  function onBarPointerLeave() {
    hoveredIndex = null;
  }
</script>

<!-- ═══════════════════════════════════════════════════════════════════════════
     TEMPLATE
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="gem-bar-chart" class:mounted bind:this={wrapperEl}>
  <!-- Header -->
  {#if title}
    <div class="chart-header">
      <h3 class="chart-title">{title}</h3>
    </div>
  {/if}

  <!-- Loading skeleton -->
  {#if loading}
    <div class="chart-canvas" style="height: {chartH}px;">
      <div class="chart-skeleton">
        {#each { length: 6 } as _, i (i)}
          <div
            class="skeleton-bar"
            style="height: {30 + Math.sin(i * 1.2) * 25 + 20}%; animation-delay: {i * 80}ms;"
          ></div>
        {/each}
        <div class="skeleton-shimmer"></div>
      </div>
    </div>
  {:else}
    <!-- Chart SVG -->
    <div class="chart-canvas" class:scrollable={needsScroll} style="height: {chartH}px;">
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
            <path d="M3 3v18h18" /><path d="M7 16h2v2H7zm5-6h2v8h-2zm5-4h2v12h-2z" />
          </svg>
          <span>No data available</span>
        </div>
      {:else if containerW > 0}
        <svg
          width={needsScroll ? contentWidth : '100%'}
          height={chartH}
          viewBox="0 0 {needsScroll ? contentWidth : containerW} {chartH}"
          preserveAspectRatio="xMinYMid meet"
          role="img"
          aria-label={title || 'Bar chart'}
        >
          <defs>
            <!-- Bar gradients per color -->
            {#each barLayout.bars as bar (bar.index)}
              <linearGradient id="{uid}-bg{bar.index}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color={bar.color} stop-opacity="0.95" />
                <stop offset="100%" stop-color={bar.color} stop-opacity="0.7" />
              </linearGradient>
            {/each}

            <!-- Threshold glow filter -->
            {#if threshold}
              <filter id="{uid}-tglow" x="-10%" y="-50%" width="120%" height="200%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
              </filter>
            {/if}

            <!-- Clip paths for rounded top bars -->
            {#each barLayout.bars as bar (bar.index)}
              <clipPath id="{uid}-clip{bar.index}">
                <rect
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height + BAR_RADIUS}
                  rx={BAR_RADIUS}
                  ry={BAR_RADIUS}
                />
                <rect x={bar.x} y={bar.y + BAR_RADIUS} width={bar.width} height={bar.height} />
              </clipPath>
            {/each}
          </defs>

          <!-- Grid lines -->
          {#each yTicks as tick, i (i)}
            <line
              x1={margin.left}
              y1={sy(tick)}
              x2={margin.left + (needsScroll ? contentWidth - margin.left - margin.right : plotW)}
              y2={sy(tick)}
              class="grid"
              class:grid-on={mounted}
              style="transition-delay: {i * 40}ms;"
            />
          {/each}

          <!-- Y-axis labels -->
          {#each yTicks as tick, i (i)}
            {#if containerW >= 360 || i === 0 || i === yTicks.length - 1}
              <text
                x={margin.left - 10}
                y={sy(tick)}
                class="y-label"
                text-anchor="end"
                dominant-baseline="middle"
              >
                {formatValue(tick)}
              </text>
            {/if}
          {/each}

          <!-- X-axis labels -->
          {#each barLayout.bars as bar (bar.index)}
            <text
              x={bar.cx}
              y={chartH - 8}
              class="x-label"
              text-anchor="middle"
              dominant-baseline="auto"
            >
              {bar.label}
            </text>
          {/each}

          <!-- Bars -->
          {#each barLayout.bars as bar (bar.index)}
            <!-- Soft glow behind bar -->
            <rect
              x={bar.x + bar.width * 0.15}
              y={bar.y}
              width={bar.width * 0.7}
              height={bar.height}
              rx={BAR_RADIUS}
              fill={bar.color}
              opacity="0.15"
              filter="url(#{uid}-tglow)"
              class="bar-glow"
              class:bar-glow-on={mounted}
              style="--bar-delay: {bar.index * STAGGER_MS + 300}ms;"
            />

            <!-- Main bar rect (rounded top via clip-path) -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <g
              class="bar-group"
              class:bar-on={mounted}
              class:bar-hovered={hoveredIndex === bar.index}
              style="--bar-delay: {bar.index *
                STAGGER_MS}ms; transform-origin: {bar.cx}px {bar.baseline}px;"
              onpointerenter={() => onBarPointerEnter(bar.index)}
              onpointerleave={onBarPointerLeave}
            >
              <!-- Visible bar with rounded top -->
              <rect
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                rx={BAR_RADIUS}
                fill="url(#{uid}-bg{bar.index})"
                class="bar-rect"
              />
              <!-- Flatten bottom corners by overlaying a square rect at the base -->
              {#if bar.height > BAR_RADIUS}
                <rect
                  x={bar.x}
                  y={bar.baseline - BAR_RADIUS}
                  width={bar.width}
                  height={BAR_RADIUS}
                  fill="url(#{uid}-bg{bar.index})"
                />
              {/if}

              <!-- Invisible wider hit area for touch targets -->
              <rect
                x={bar.cx - Math.max(bar.width, 44) / 2}
                y={bar.y}
                width={Math.max(bar.width, 44)}
                height={bar.height}
                fill="transparent"
              />
            </g>
          {/each}

          <!-- Threshold line -->
          {#if threshold}
            <line
              x1={margin.left}
              y1={thresholdY}
              x2={margin.left + (needsScroll ? contentWidth - margin.left - margin.right : plotW)}
              y2={thresholdY}
              class="threshold-glow"
              class:threshold-on={mounted}
              stroke={threshold.color || 'var(--gc-citrine)'}
              stroke-width="3"
              filter="url(#{uid}-tglow)"
            />
            <line
              x1={margin.left}
              y1={thresholdY}
              x2={margin.left + (needsScroll ? contentWidth - margin.left - margin.right : plotW)}
              y2={thresholdY}
              class="threshold-line"
              class:threshold-on={mounted}
              stroke={threshold.color || 'var(--gc-citrine)'}
              stroke-width="1.5"
              stroke-dasharray="6 4"
            />
            {#if threshold.label}
              <text
                x={margin.left +
                  (needsScroll ? contentWidth - margin.left - margin.right : plotW) +
                  6}
                y={thresholdY}
                class="threshold-label"
                dominant-baseline="middle"
                fill={threshold.color || 'var(--gc-citrine)'}
              >
                {threshold.label}
              </text>
            {/if}
          {/if}
        </svg>

        <!-- Tooltip (HTML, outside SVG for backdrop-filter) -->
        {#if hoverBar}
          <div
            class="chart-tip"
            style="left: {hoverBar.tipX}px; top: {Math.max(8, hoverBar.y - 56)}px;"
          >
            <div class="tip-label">{hoverBar.label}</div>
            <div class="tip-row">
              <span class="tip-swatch" style="background: {hoverBar.color};"></span>
              <span class="tip-val">{hoverBar.formattedValue}</span>
            </div>
          </div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     STYLES
     ═══════════════════════════════════════════════════════════════════════════ -->
<style>
  /* ────────────────────────────────────────────────────────────────────────
     DESIGN TOKENS
     ──────────────────────────────────────────────────────────────────────── */
  .gem-bar-chart {
    --gc-void: #0a0806;
    --gc-obsidian: #0e0c08;
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
  .gem-bar-chart {
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

  .gem-bar-chart.mounted {
    opacity: 1;
    transform: translateY(0);
  }

  @media (min-width: 640px) {
    .gem-bar-chart {
      padding: 24px 24px 20px;
    }
  }

  /* Subtle prismatic sheen */
  .gem-bar-chart::before {
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
  .gem-bar-chart::after {
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

  .gem-bar-chart.mounted::after {
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
    touch-action: pan-y;
    z-index: 1;
  }

  .chart-canvas.scrollable {
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-x;
  }

  .chart-canvas svg {
    display: block;
    overflow: visible;
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

  /* ── Grid lines ──────────────────────────────────────────────────────── */
  .grid {
    stroke: var(--gc-border-sub);
    stroke-width: 1;
    opacity: 0;
    transition: opacity 0.5s ease;
  }

  .grid.grid-on {
    opacity: 1;
  }

  /* ── Axis labels ─────────────────────────────────────────────────────── */
  .y-label,
  .x-label {
    fill: var(--gc-dim);
    font-size: 10px;
    font-family: inherit;
    user-select: none;
  }

  .y-label {
    font-variant-numeric: tabular-nums;
  }

  .x-label {
    font-size: 9px;
    letter-spacing: 0.02em;
  }

  /* ────────────────────────────────────────────────────────────────────────
     BARS
     ──────────────────────────────────────────────────────────────────────── */
  .bar-group {
    transform: scaleY(0);
    transition: transform 0.7s var(--gc-spring);
    transition-delay: var(--bar-delay);
    cursor: pointer;
  }

  .bar-group.bar-on {
    transform: scaleY(1);
  }

  .bar-rect {
    transition:
      filter 0.2s ease,
      opacity 0.2s ease;
  }

  .bar-group.bar-hovered .bar-rect {
    filter: brightness(1.25);
  }

  /* Bar glow */
  .bar-glow {
    opacity: 0;
    transition: opacity 0.5s ease;
    transition-delay: var(--bar-delay);
  }

  .bar-glow.bar-glow-on {
    opacity: 1;
  }

  /* ────────────────────────────────────────────────────────────────────────
     THRESHOLD LINE
     ──────────────────────────────────────────────────────────────────────── */
  .threshold-line {
    opacity: 0;
    transition: opacity 0.6s ease 0.4s;
  }

  .threshold-line.threshold-on {
    opacity: 0.8;
  }

  .threshold-glow {
    opacity: 0;
    pointer-events: none;
  }

  .threshold-glow.threshold-on {
    animation: thresholdBreath 4s ease-in-out infinite;
    animation-delay: 0.6s;
  }

  @keyframes thresholdBreath {
    0%,
    100% {
      opacity: 0.08;
    }
    50% {
      opacity: 0.22;
    }
  }

  .threshold-label {
    font-size: 9px;
    font-family: inherit;
    font-weight: 600;
    letter-spacing: 0.04em;
    opacity: 0.7;
    user-select: none;
  }

  /* ────────────────────────────────────────────────────────────────────────
     TOOLTIP
     ──────────────────────────────────────────────────────────────────────── */
  .chart-tip {
    position: absolute;
    transform: translateX(-50%);
    background: rgba(12, 10, 6, 0.88);
    backdrop-filter: blur(20px) saturate(1.3);
    -webkit-backdrop-filter: blur(20px) saturate(1.3);
    border: 1px solid rgba(180, 150, 80, 0.14);
    border-radius: 10px;
    padding: 8px 14px;
    pointer-events: none;
    box-shadow:
      0 12px 40px rgba(0, 0, 0, 0.5),
      0 0 0 0.5px rgba(180, 150, 80, 0.08) inset;
    z-index: 10;
    white-space: nowrap;
    animation: tipReveal 0.18s ease-out;
    min-width: 90px;
  }

  @keyframes tipReveal {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(4px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }
  }

  .chart-tip .tip-label {
    color: var(--gc-dim);
    font-size: 0.62rem;
    letter-spacing: 0.04em;
    margin-bottom: 4px;
    text-transform: uppercase;
    font-weight: 500;
  }

  .tip-row {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 0.78rem;
    color: var(--gc-text);
    line-height: 1.5;
  }

  .tip-swatch {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
    box-shadow: 0 0 4px currentColor;
  }

  .tip-val {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  /* ────────────────────────────────────────────────────────────────────────
     LOADING SKELETON
     ──────────────────────────────────────────────────────────────────────── */
  .chart-skeleton {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    gap: 12px;
    padding: 16px 32px;
  }

  .skeleton-bar {
    flex: 1;
    max-width: 48px;
    min-width: 16px;
    background: var(--gc-border-sub);
    border-radius: 4px 4px 0 0;
    animation: skeletonPulse 1.6s ease-in-out infinite;
  }

  @keyframes skeletonPulse {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 0.7;
    }
  }

  .skeleton-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      110deg,
      transparent 25%,
      rgba(200, 160, 60, 0.06) 37%,
      rgba(232, 200, 122, 0.1) 50%,
      rgba(200, 160, 60, 0.06) 63%,
      transparent 75%
    );
    background-size: 250% 100%;
    animation: skeletonSweep 1.8s ease-in-out infinite;
  }

  @keyframes skeletonSweep {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }

  /* ────────────────────────────────────────────────────────────────────────
     REDUCED MOTION
     ──────────────────────────────────────────────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    .gem-bar-chart,
    .gem-bar-chart::after,
    .bar-group,
    .bar-glow,
    .grid,
    .threshold-line,
    .threshold-glow,
    .chart-tip,
    .skeleton-bar,
    .skeleton-shimmer {
      animation: none !important;
      transition: none !important;
    }

    .gem-bar-chart {
      opacity: 1;
      transform: none;
    }

    .bar-group {
      transform: scaleY(1);
    }

    .bar-glow {
      opacity: 1;
    }

    .grid {
      opacity: 1;
    }

    .threshold-line {
      opacity: 0.8;
    }

    .threshold-glow {
      opacity: 0.15;
    }
  }
</style>
