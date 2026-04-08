<!--
  @fileoverview GemChart — A cinematic, gem-crystal themed line chart component.

  Generic reusable chart for Radiant Finance. Renders up to 3 smooth
  interpolated lines with area fills, glowing endpoints, interactive
  crosshair tooltips, and crystalline refraction ambient effects.

  Design language: obsidian surfaces, citrine accents, emerald/ruby/sapphire
  data lines, glass-morphism tooltips, spring-curve animations.
-->
<script lang="ts">
  // ══════════════════════════════════════════════════════════════════════════
  //                              TYPES
  // ══════════════════════════════════════════════════════════════════════════

  export interface ChartDataPoint {
    date: string;
    value: number;
  }

  export interface ChartLine {
    label: string;
    color: string;
    data: ChartDataPoint[];
  }

  export interface ChartTimeRange {
    label: string;
    value: string;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //                              PROPS
  // ══════════════════════════════════════════════════════════════════════════

  let {
    title = '',
    lines,
    timeRanges = [],
    selectedRange = '',
    onRangeChange,
    height = 200,
    formatValue,
    loading = false
  }: {
    title?: string;
    lines: ChartLine[];
    timeRanges?: ChartTimeRange[];
    selectedRange?: string;
    onRangeChange?: (range: string) => void;
    height?: number;
    formatValue: (value: number) => string;
    loading?: boolean;
  } = $props();

  // ══════════════════════════════════════════════════════════════════════════
  //                           CONSTANTS
  // ══════════════════════════════════════════════════════════════════════════

  const GRID_LINES = 4;

  // ══════════════════════════════════════════════════════════════════════════
  //                         COMPONENT STATE
  // ══════════════════════════════════════════════════════════════════════════

  let wrapperEl: HTMLDivElement | undefined = $state(undefined);
  let svgEl: SVGSVGElement | undefined = $state(undefined);
  let containerW = $state(0);
  let hoverX: number | null = $state(null);
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

  // Trigger entrance animation on mount and re-trigger on range change
  $effect(() => {
    void selectedRange;
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

  /** Whether to use mobile chart layout (floating overlay y-labels, no left margin). */
  const isMobileLayout = $derived(containerW > 0 && containerW < 520);

  const margin = $derived({
    top: 12,
    right: isMobileLayout ? 4 : 20,
    bottom: 28,
    // Mobile: y-labels are HTML overlays, so no left margin needed
    left: isMobileLayout ? 0 : containerW < 360 ? 44 : 54
  });

  const chartH = $derived(Math.max(140, height));
  const plotW = $derived(Math.max(0, containerW - margin.left - margin.right));
  const plotH = $derived(Math.max(0, chartH - margin.top - margin.bottom));

  // ══════════════════════════════════════════════════════════════════════════
  //                        DATA COMPUTATION
  // ══════════════════════════════════════════════════════════════════════════

  const hasData = $derived(lines.some((l) => l.data.length > 0));

  /** Global value extent with padding. */
  const valExtent = $derived.by(() => {
    let lo = Infinity,
      hi = -Infinity;
    for (const l of lines)
      for (const d of l.data) {
        if (d.value < lo) lo = d.value;
        if (d.value > hi) hi = d.value;
      }
    if (lo === Infinity) return { lo: 0, hi: 100 };
    if (lo === hi) {
      const p = Math.abs(lo) * 0.15 || 10;
      return { lo: lo - p, hi: hi + p };
    }
    const p = (hi - lo) * 0.1;
    return { lo: lo - p, hi: hi + p };
  });

  /** Global time extent. */
  const timeExtent = $derived.by(() => {
    let lo = Infinity,
      hi = -Infinity;
    for (const l of lines)
      for (const d of l.data) {
        const t = new Date(d.date + 'T00:00:00').getTime();
        if (t < lo) lo = t;
        if (t > hi) hi = t;
      }
    if (lo === Infinity) {
      const now = Date.now();
      return { lo: now - 7 * 864e5, hi: now };
    }
    if (lo === hi) return { lo: lo - 864e5, hi: hi + 864e5 };
    return { lo, hi };
  });

  // ── Scale functions ────────────────────────────────────────────────────

  function sx(t: number): number {
    const span = timeExtent.hi - timeExtent.lo;
    if (span === 0) return margin.left + plotW / 2;
    return margin.left + ((t - timeExtent.lo) / span) * plotW;
  }

  function sy(v: number): number {
    const span = valExtent.hi - valExtent.lo;
    if (span === 0) return margin.top + plotH / 2;
    return margin.top + (1 - (v - valExtent.lo) / span) * plotH;
  }

  // ── Y-axis ticks (nice round numbers) ──────────────────────────────────

  const yTicks = $derived.by(() => {
    const range = valExtent.hi - valExtent.lo;
    if (range === 0) return [valExtent.lo];
    const ticks: number[] = [];
    for (let i = 0; i <= GRID_LINES; i++) {
      ticks.push(valExtent.lo + (range * i) / GRID_LINES);
    }
    return ticks;
  });

  // ── X-axis labels ─────────────────────────────────────────────────────

  const xLabels = $derived.by(() => {
    if (!hasData) return [];
    const count = containerW < 360 ? 3 : containerW < 560 ? 4 : 5;
    const span = timeExtent.hi - timeExtent.lo;
    const out: { x: number; text: string }[] = [];
    for (let i = 0; i < count; i++) {
      const t = timeExtent.lo + (span * i) / (count - 1);
      const d = new Date(t);
      // Short month + day, omit year if current
      const thisYear = d.getFullYear() === new Date().getFullYear();
      const text = d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        ...(thisYear ? {} : { year: '2-digit' })
      });
      out.push({ x: sx(t), text });
    }
    return out;
  });

  // ══════════════════════════════════════════════════════════════════════════
  //                  MONOTONE CUBIC INTERPOLATION → SVG PATH
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Monotone cubic Hermite spline (Fritsch-Carlson method).
   * Guarantees the curve never overshoots between data points — no loops
   * or backward-tracking even with sharp value changes.
   */
  function toPath(pts: { x: number; y: number }[]): string {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
    if (pts.length === 2) return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`;

    const n = pts.length;

    // 1. Compute slopes (dx, dy, m)
    const dx: number[] = [];
    const dy: number[] = [];
    const m: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      dx.push(pts[i + 1].x - pts[i].x);
      dy.push(pts[i + 1].y - pts[i].y);
      m.push(dx[i] === 0 ? 0 : dy[i] / dx[i]);
    }

    // 2. Compute tangents with Fritsch-Carlson monotonicity
    const tangent: number[] = [m[0]];
    for (let i = 1; i < n - 1; i++) {
      if (m[i - 1] * m[i] <= 0) {
        // Sign change or zero — flat tangent to prevent overshoot
        tangent.push(0);
      } else {
        tangent.push((m[i - 1] + m[i]) / 2);
      }
    }
    tangent.push(m[n - 2]);

    // 3. Clamp tangents to ensure monotonicity (Fritsch-Carlson step 3)
    for (let i = 0; i < n - 1; i++) {
      if (Math.abs(m[i]) < 1e-10) {
        tangent[i] = 0;
        tangent[i + 1] = 0;
      } else {
        const a = tangent[i] / m[i];
        const b = tangent[i + 1] / m[i];
        const s = a * a + b * b;
        if (s > 9) {
          const t = 3 / Math.sqrt(s);
          tangent[i] = t * a * m[i];
          tangent[i + 1] = t * b * m[i];
        }
      }
    }

    // 4. Build cubic bezier path
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < n - 1; i++) {
      const seg = dx[i] / 3;
      const c1x = pts[i].x + seg;
      const c1y = pts[i].y + tangent[i] * seg;
      const c2x = pts[i + 1].x - seg;
      const c2y = pts[i + 1].y - tangent[i + 1] * seg;
      d += `C${c1x},${c1y},${c2x},${c2y},${pts[i + 1].x},${pts[i + 1].y}`;
    }
    return d;
  }

  function pathLen(pts: { x: number; y: number }[]): number {
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return len * 1.4;
  }

  // ── Build all line render data ─────────────────────────────────────────

  const lineRender = $derived.by(() => {
    return lines.map((line, i) => {
      const pts = line.data.map((d) => ({
        x: sx(new Date(d.date + 'T00:00:00').getTime()),
        y: sy(d.value)
      }));
      const linePath = toPath(pts);

      // Closed area path
      let areaPath = '';
      if (pts.length > 0) {
        const bottom = margin.top + plotH;
        areaPath = linePath + `L${pts[pts.length - 1].x},${bottom}L${pts[0].x},${bottom}Z`;
      }

      const lastPt = pts.length > 0 ? pts[pts.length - 1] : null;
      const lastVal = line.data.length > 0 ? line.data[line.data.length - 1].value : 0;

      return {
        i,
        color: line.color,
        label: line.label,
        linePath,
        areaPath,
        pts,
        len: pathLen(pts),
        lastPt,
        lastVal
      };
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //                     HOVER / TOOLTIP INTERACTION
  // ══════════════════════════════════════════════════════════════════════════

  /** Interpolate value at a given timestamp for a line's data. */
  function interpolateAt(data: ChartDataPoint[], timestamp: number): number | null {
    if (data.length === 0) return null;
    if (data.length === 1) return data[0].value;

    const times = data.map((d) => new Date(d.date + 'T00:00:00').getTime());

    // Clamp to edges
    if (timestamp <= times[0]) return data[0].value;
    if (timestamp >= times[times.length - 1]) return data[data.length - 1].value;

    // Find bracketing points and lerp
    for (let i = 0; i < times.length - 1; i++) {
      if (timestamp >= times[i] && timestamp <= times[i + 1]) {
        const t = (timestamp - times[i]) / (times[i + 1] - times[i]);
        return data[i].value + t * (data[i + 1].value - data[i].value);
      }
    }
    return data[data.length - 1].value;
  }

  const hover = $derived.by(() => {
    if (hoverX === null || !hasData || plotW <= 0) return null;

    const ratio = (hoverX - margin.left) / plotW;
    const timestamp = timeExtent.lo + ratio * (timeExtent.hi - timeExtent.lo);
    const snappedX = sx(timestamp);

    // Find closest actual date for the label
    let closestDate = '';
    let minDist = Infinity;
    for (const l of lines) {
      for (const d of l.data) {
        const dist = Math.abs(new Date(d.date + 'T00:00:00').getTime() - timestamp);
        if (dist < minDist) {
          minDist = dist;
          closestDate = d.date;
        }
      }
    }

    const dateStr = closestDate
      ? new Date(closestDate + 'T00:00:00').toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        })
      : '';

    const items = lines.map((line) => {
      const val = interpolateAt(line.data, timestamp);
      return {
        label: line.label,
        color: line.color,
        value: val !== null ? formatValue(val) : '—',
        y: val !== null ? sy(val) : null
      };
    });

    // Tooltip positioning — keep in bounds
    let tipX = snappedX;
    const tipW = 170;
    if (tipX + tipW / 2 > containerW - 12) tipX = containerW - tipW / 2 - 12;
    if (tipX - tipW / 2 < 12) tipX = tipW / 2 + 12;

    return { crossX: snappedX, tipX, dateStr, items };
  });

  function onPointerMove(e: PointerEvent) {
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x >= margin.left && x <= margin.left + plotW) {
      hoverX = x;
    } else {
      hoverX = null;
    }
  }

  function onPointerLeave() {
    hoverX = null;
  }
</script>

<!-- ═══════════════════════════════════════════════════════════════════════════
     TEMPLATE
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="gem-chart" class:mounted bind:this={wrapperEl}>
  <!-- Header: title + range (desktop inline, mobile: range moves to bottom) -->
  <div class="chart-header">
    {#if title}
      <h3 class="chart-title">{title}</h3>
    {/if}
  </div>

  <!-- Time range selector: direct child for CSS order on mobile -->
  {#if timeRanges.length > 0 && onRangeChange}
    <div class="range-track">
      {#each timeRanges as range (range.value)}
        <button
          class="range-pill"
          class:active={selectedRange === range.value}
          onclick={() => onRangeChange?.(range.value)}
        >
          {range.label}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Loading skeleton -->
  {#if loading}
    <div class="chart-canvas" style="height: {chartH}px;">
      <div class="chart-skeleton">
        <div class="skeleton-line s1"></div>
        <div class="skeleton-line s2"></div>
        <div class="skeleton-line s3"></div>
        <div class="skeleton-line s4"></div>
        <div class="skeleton-shimmer"></div>
      </div>
    </div>
  {:else}
    <!-- Legend -->
    {#if lines.length > 1}
      <div class="chart-legend">
        {#each lines as line, i (line.label)}
          <div class="legend-item" style="--li-delay: {i * 60}ms">
            <span
              class="legend-gem"
              style="background: {line.color}; box-shadow: 0 0 6px {line.color}40;"
            ></span>
            <span class="legend-label">{line.label}</span>
          </div>
        {/each}
      </div>
    {/if}

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
            <path d="M3 3v18h18" /><path d="M7 16l4-8 4 4 5-6" />
          </svg>
          <span>No data for this period</span>
        </div>
      {:else if containerW > 0}
        <svg
          bind:this={svgEl}
          width="100%"
          height={chartH}
          viewBox="0 0 {containerW} {chartH}"
          preserveAspectRatio="none"
          onpointermove={onPointerMove}
          onpointerleave={onPointerLeave}
          role="img"
          aria-label={title || 'Line chart'}
        >
          <defs>
            <!-- Area gradients -->
            {#each lines as line, i (line.label)}
              <linearGradient id="{uid}-ag{i}" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color={line.color} stop-opacity="0.2" />
                <stop offset="85%" stop-color={line.color} stop-opacity="0.02" />
                <stop offset="100%" stop-color={line.color} stop-opacity="0" />
              </linearGradient>
              <filter id="{uid}-gl{i}" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur in="SourceGraphic" stdDeviation="5" />
              </filter>
            {/each}

            <!-- Crosshair gradient -->
            <linearGradient id="{uid}-cross" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(219,176,68,0)" />
              <stop offset="20%" stop-color="rgba(219,176,68,0.35)" />
              <stop offset="80%" stop-color="rgba(219,176,68,0.35)" />
              <stop offset="100%" stop-color="rgba(219,176,68,0)" />
            </linearGradient>
          </defs>

          <!-- Grid lines -->
          {#each yTicks as tick, i (i)}
            <line
              x1={margin.left}
              y1={sy(tick)}
              x2={margin.left + plotW}
              y2={sy(tick)}
              class="grid"
              class:grid-on={mounted}
              style="transition-delay: {i * 40}ms;"
            />
          {/each}

          <!-- Y-axis labels (desktop only — mobile uses HTML overlay) -->
          {#if !isMobileLayout}
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
          {/if}

          <!-- X-axis labels -->
          {#each xLabels as lbl, i (i)}
            <text x={lbl.x} y={chartH - 6} class="x-label" text-anchor="middle">
              {lbl.text}
            </text>
          {/each}

          <!-- Lines: glow → area → stroke → endpoint -->
          {#each lineRender as lr (lr.i)}
            {#if lr.pts.length > 0}
              <!-- Soft glow behind the line -->
              <path
                d={lr.linePath}
                fill="none"
                stroke={lr.color}
                stroke-width="5"
                filter="url(#{uid}-gl{lr.i})"
                class="line-glow"
                class:glow-on={mounted}
                style="transition-delay: {lr.i * 120 + 400}ms;"
              />

              <!-- Area fill -->
              <path
                d={lr.areaPath}
                fill="url(#{uid}-ag{lr.i})"
                class="area"
                class:area-on={mounted}
                style="transition-delay: {lr.i * 120 + 300}ms;"
              />

              <!-- Main stroke — animated draw-in -->
              <path
                d={lr.linePath}
                fill="none"
                stroke={lr.color}
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="line-stroke"
                class:stroke-on={mounted}
                style="--len: {lr.len}; transition-delay: {lr.i * 120}ms;"
              />

              <!-- Glowing endpoint dot -->
              {#if lr.lastPt}
                <circle
                  cx={lr.lastPt.x}
                  cy={lr.lastPt.y}
                  r="3.5"
                  fill={lr.color}
                  class="endpoint"
                  class:ep-on={mounted}
                  style="transition-delay: {lr.i * 120 + 900}ms;"
                />
                <circle
                  cx={lr.lastPt.x}
                  cy={lr.lastPt.y}
                  r="7"
                  fill="none"
                  stroke={lr.color}
                  stroke-width="1.5"
                  class="endpoint-ring"
                  class:ep-on={mounted}
                  style="transition-delay: {lr.i * 120 + 900}ms;"
                />
              {/if}
            {/if}
          {/each}

          <!-- Hover crosshair -->
          {#if hover}
            <line
              x1={hover.crossX}
              y1={margin.top}
              x2={hover.crossX}
              y2={margin.top + plotH}
              stroke="url(#{uid}-cross)"
              stroke-width="1"
              class="crosshair-line"
            />

            <!-- Hover dots on each line -->
            {#each hover.items as item (item.label)}
              {#if item.y !== null}
                <circle
                  cx={hover.crossX}
                  cy={item.y}
                  r="4"
                  fill={item.color}
                  stroke="#161310"
                  stroke-width="2"
                  class="hover-dot"
                />
              {/if}
            {/each}
          {/if}
        </svg>

        <!-- Mobile: floating y-label overlay (replaces SVG y-labels to save left margin) -->
        {#if isMobileLayout}
          <div class="y-labels-overlay" aria-hidden="true">
            {#each yTicks as tick, i (i)}
              {#if i === 0 || i === Math.floor(yTicks.length / 2) || i === yTicks.length - 1}
                <span class="y-overlay-label" style="top: {sy(tick)}px;">{formatValue(tick)}</span>
              {/if}
            {/each}
          </div>
        {/if}

        <!-- Tooltip (HTML, outside SVG for backdrop-filter) -->
        {#if hover}
          <div class="chart-tip" style="left: {hover.tipX}px;">
            <div class="tip-date">{hover.dateStr}</div>
            {#each hover.items as item (item.label)}
              <div class="tip-row">
                <span class="tip-swatch" style="background: {item.color};"></span>
                <span class="tip-label">{item.label}</span>
                <span class="tip-val">{item.value}</span>
              </div>
            {/each}
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
  .gem-chart {
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
  .gem-chart {
    position: relative;
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

  .gem-chart.mounted {
    opacity: 1;
    transform: translateY(0);
  }

  @media (min-width: 640px) {
    .gem-chart {
      padding: 24px 24px 20px;
    }
  }

  /* Subtle prismatic sheen */
  .gem-chart::before {
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
  .gem-chart::after {
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

  .gem-chart.mounted::after {
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
     LAYOUT (flex column for ordering)
     ──────────────────────────────────────────────────────────────────────── */
  .gem-chart {
    display: flex;
    flex-direction: column;
  }

  .chart-header {
    order: 0;
  }

  .range-track {
    order: 1;
  }

  .chart-legend {
    order: 2;
  }

  .chart-canvas {
    order: 3;
  }

  /* ────────────────────────────────────────────────────────────────────────
     HEADER
     ──────────────────────────────────────────────────────────────────────── */
  .chart-header {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 4px;
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

  /* ── Time range selector ──────────────────────────────────────────────── */
  .range-track {
    position: relative;
    z-index: 1;
    display: flex;
    gap: 2px;
    background: var(--gc-frost);
    border-radius: 8px;
    padding: 2px;
    border: 1px solid var(--gc-border-sub);
    align-self: flex-end;
    margin-bottom: 8px;
  }

  .range-pill {
    background: transparent;
    border: 1px solid transparent;
    color: var(--gc-dim);
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    padding: 4px 9px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.25s ease;
    font-family: inherit;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
  }

  .range-pill:hover:not(.active) {
    color: var(--gc-muted);
    background: rgba(200, 180, 120, 0.05);
  }

  .range-pill.active {
    background: rgba(219, 176, 68, 0.14);
    color: var(--gc-citrine);
    border-color: rgba(219, 176, 68, 0.18);
    box-shadow: 0 0 8px rgba(219, 176, 68, 0.06);
  }

  /* ── Mobile: range track moves below chart ─────────────────────────── */
  @media (max-width: 640px) {
    .range-track {
      order: 10;
      align-self: center;
      margin-top: 14px;
      margin-bottom: 0;
    }
  }

  /* ────────────────────────────────────────────────────────────────────────
     LEGEND
     ──────────────────────────────────────────────────────────────────────── */
  .chart-legend {
    position: relative;
    z-index: 1;
    display: flex;
    gap: 16px;
    margin-bottom: 8px;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    opacity: 0;
    transform: translateY(6px);
  }

  .gem-chart.mounted .legend-item {
    opacity: 1;
    transform: translateY(0);
    transition:
      opacity 0.4s ease,
      transform 0.4s var(--gc-spring);
    transition-delay: var(--li-delay);
  }

  .legend-gem {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .legend-label {
    font-size: 0.68rem;
    color: var(--gc-muted);
    letter-spacing: 0.02em;
  }

  /* ────────────────────────────────────────────────────────────────────────
     CHART CANVAS
     ──────────────────────────────────────────────────────────────────────── */
  .chart-canvas {
    position: relative;
    width: 100%;
    touch-action: none;
    z-index: 1;
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

  /* ── Line stroke (animated draw-in) ──────────────────────────────────── */
  .line-stroke {
    stroke-dasharray: var(--len);
    stroke-dashoffset: var(--len);
    transition: stroke-dashoffset 1.4s var(--gc-spring);
  }

  .line-stroke.stroke-on {
    stroke-dashoffset: 0;
  }

  /* ── Area fill ───────────────────────────────────────────────────────── */
  .area {
    opacity: 0;
    transition: opacity 0.8s ease;
  }

  .area.area-on {
    opacity: 1;
  }

  /* ── Line glow ───────────────────────────────────────────────────────── */
  .line-glow {
    opacity: 0;
    transition: opacity 0.6s ease;
  }

  .line-glow.glow-on {
    animation: glowBreath 4s ease-in-out infinite;
    animation-delay: inherit;
  }

  @keyframes glowBreath {
    0%,
    100% {
      opacity: 0.2;
    }
    50% {
      opacity: 0.38;
    }
  }

  /* ── Endpoint dots ───────────────────────────────────────────────────── */
  .endpoint {
    opacity: 0;
    transform-origin: center;
    transition:
      opacity 0.3s ease,
      r 0.3s var(--gc-spring);
  }

  .endpoint.ep-on {
    opacity: 1;
  }

  .endpoint-ring {
    opacity: 0;
    transform-origin: center;
    transition: opacity 0.3s ease;
  }

  .endpoint-ring.ep-on {
    animation: ringPulse 2.5s ease-in-out infinite;
  }

  @keyframes ringPulse {
    0%,
    100% {
      opacity: 0.25;
      r: 7;
    }
    50% {
      opacity: 0.5;
      r: 10;
    }
  }

  /* ── Crosshair ───────────────────────────────────────────────────────── */
  .crosshair-line {
    pointer-events: none;
  }

  .hover-dot {
    pointer-events: none;
    filter: drop-shadow(0 0 3px currentColor);
  }

  /* ────────────────────────────────────────────────────────────────────────
     TOOLTIP
     ──────────────────────────────────────────────────────────────────────── */
  /* ── Mobile y-label overlay ─────────────────────────────────────────── */
  .y-labels-overlay {
    position: absolute;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    z-index: 2;
  }

  .y-overlay-label {
    position: absolute;
    left: 4px;
    transform: translateY(-50%);
    font-size: 9px;
    color: var(--gc-dim);
    background: rgba(14, 12, 8, 0.72);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    padding: 1px 4px;
    border-radius: 3px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    letter-spacing: 0.02em;
  }

  .chart-tip {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    background: rgba(12, 10, 6, 0.88);
    backdrop-filter: blur(20px) saturate(1.3);
    -webkit-backdrop-filter: blur(20px) saturate(1.3);
    border: 1px solid rgba(180, 150, 80, 0.14);
    border-radius: 10px;
    padding: 10px 14px;
    pointer-events: none;
    box-shadow:
      0 12px 40px rgba(0, 0, 0, 0.5),
      0 0 0 0.5px rgba(180, 150, 80, 0.08) inset;
    z-index: 9999;
    white-space: nowrap;
    animation: tipReveal 0.18s ease-out;
    min-width: 120px;
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

  .tip-date {
    color: var(--gc-dim);
    font-size: 0.62rem;
    letter-spacing: 0.04em;
    margin-bottom: 6px;
    text-transform: uppercase;
    font-weight: 500;
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

  /* ── Loading skeleton ─────────────────────────────────────────────────── */
  .chart-skeleton {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 0;
    padding: 16px 0;
  }

  .skeleton-line {
    height: 1px;
    background: var(--gc-border-sub);
    margin: 0 12px;
    flex: 1;
    border-bottom: 1px solid var(--gc-border-sub);
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
</style>
