<!--
  @fileoverview BudgetLineChart — A specialized budget progress line chart
  with the Gem Radiant design language.

  Renders cumulative daily spending as a smooth citrine line against a pace
  line (expected daily burn rate) and budget ceiling. Shaded regions between
  spending and pace indicate over/under status. Includes a "today" marker,
  hover crosshair with tooltip, and animated entrance.

  Design language: obsidian surfaces, citrine accents, emerald (under budget)
  and ruby (over budget) tinted regions, glass-morphism tooltips, spring-curve
  animations.
-->
<script lang="ts">
  // ══════════════════════════════════════════════════════════════════════════
  //                              IMPORTS
  // ══════════════════════════════════════════════════════════════════════════

  import { onMount } from 'svelte';

  // ══════════════════════════════════════════════════════════════════════════
  //                              PROPS
  // ══════════════════════════════════════════════════════════════════════════

  let {
    spendingData,
    budgetTotal,
    recurringDeduction = 0,
    currentDay,
    daysInMonth,
    formatValue,
    loading = false,
    height = 200
  }: {
    spendingData: { date: string; value: number }[];
    budgetTotal: number;
    recurringDeduction?: number;
    currentDay: number;
    daysInMonth: number;
    formatValue: (value: number) => string;
    loading?: boolean;
    height?: number;
  } = $props();

  // ══════════════════════════════════════════════════════════════════════════
  //                           CONSTANTS
  // ══════════════════════════════════════════════════════════════════════════

  const GRID_LINES = 4;
  const CITRINE = '#dbb044';
  const EMERALD = '#10b981';
  const RUBY = '#ef4444';

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

  // Trigger entrance animation on mount — use onMount to avoid
  // re-running on reactive changes during re-navigation
  onMount(() => {
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
    right: 20,
    bottom: 28,
    left: containerW < 360 ? 44 : 54
  });

  const chartH = $derived(Math.max(140, height));
  const plotW = $derived(Math.max(0, containerW - margin.left - margin.right));
  const plotH = $derived(Math.max(0, chartH - margin.top - margin.bottom));

  // ══════════════════════════════════════════════════════════════════════════
  //                        DATA COMPUTATION
  // ══════════════════════════════════════════════════════════════════════════

  const hasData = $derived(spendingData.length > 0);

  /** Y-axis extent: max of budgetTotal * 1.15 and max spending value. */
  const valExtent = $derived.by(() => {
    let hi = budgetTotal * 1.15;
    for (const d of spendingData) {
      if (d.value > hi) hi = d.value;
    }
    // Add 10% headroom above max
    hi = hi * 1.1;
    return { lo: 0, hi };
  });

  /** Current cumulative spending (last data point). */
  const currentSpending = $derived(
    spendingData.length > 0 ? spendingData[spendingData.length - 1].value : 0
  );

  /** Money remaining. */
  const remaining = $derived(budgetTotal - currentSpending);

  /** Expected spending at current day based on pace line. */
  const expectedAtCurrentDay = $derived.by(() => {
    if (daysInMonth <= 1) return recurringDeduction;
    const pacePerDay = (budgetTotal - recurringDeduction) / (daysInMonth - 1);
    return recurringDeduction + pacePerDay * (currentDay - 1);
  });

  /** Over/under expected amount. */
  const overUnder = $derived(currentSpending - expectedAtCurrentDay);

  // ── Scale functions ────────────────────────────────────────────────────

  function sx(day: number): number {
    if (daysInMonth <= 1) return margin.left + plotW / 2;
    return margin.left + ((day - 1) / (daysInMonth - 1)) * plotW;
  }

  function sy(v: number): number {
    const span = valExtent.hi - valExtent.lo;
    if (span === 0) return margin.top + plotH / 2;
    return margin.top + (1 - (v - valExtent.lo) / span) * plotH;
  }

  // ── Y-axis ticks ──────────────────────────────────────────────────────

  const yTicks = $derived.by(() => {
    const range = valExtent.hi - valExtent.lo;
    if (range === 0) return [valExtent.lo];
    const ticks: number[] = [];
    for (let i = 0; i <= GRID_LINES; i++) {
      ticks.push(valExtent.lo + (range * i) / GRID_LINES);
    }
    return ticks;
  });

  // ── X-axis labels (day numbers) ─────────────────────────────────────

  const xLabels = $derived.by(() => {
    const allDays = [1, 5, 10, 15, 20, 25, 30].filter((d) => d <= daysInMonth);
    // On mobile, show fewer labels
    const subset =
      containerW < 360
        ? allDays.filter((d) => d === 1 || d === 15 || d === daysInMonth)
        : containerW < 560
          ? allDays.filter((_, i) => i % 2 === 0 || _ === daysInMonth)
          : allDays;
    // Ensure last day is included
    if (subset[subset.length - 1] !== daysInMonth && daysInMonth > 1) {
      subset.push(daysInMonth);
    }
    return subset.map((day) => ({ x: sx(day), text: String(day) }));
  });

  // ══════════════════════════════════════════════════════════════════════════
  //                  MONOTONE CUBIC INTERPOLATION -> SVG PATH
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Monotone cubic Hermite spline (Fritsch-Carlson method).
   * Guarantees the curve never overshoots between data points.
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

  // ══════════════════════════════════════════════════════════════════════════
  //                     SPENDING LINE RENDER DATA
  // ══════════════════════════════════════════════════════════════════════════

  /** Map spending data to day numbers (1-indexed). */
  const spendingPts = $derived.by(() => {
    return spendingData.map((d) => {
      const date = new Date(d.date + 'T00:00:00');
      const day = date.getDate();
      return { x: sx(day), y: sy(d.value) };
    });
  });

  const spendingPath = $derived(toPath(spendingPts));
  const spendingLen = $derived(pathLen(spendingPts));

  // ══════════════════════════════════════════════════════════════════════════
  //                        PACE LINE DATA
  // ══════════════════════════════════════════════════════════════════════════

  const paceStart = $derived({ x: sx(1), y: sy(recurringDeduction) });
  const paceEnd = $derived({ x: sx(daysInMonth), y: sy(budgetTotal) });

  // ══════════════════════════════════════════════════════════════════════════
  //                   SHADED AREA (OVER/UNDER PACE)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Build a closed path that covers the region between spending line and
   * pace line, clipped to the spending data range. We sample both curves
   * at each spending data day and close the shape.
   */
  const shadedRegions = $derived.by(() => {
    if (spendingData.length < 2 || daysInMonth <= 1) return { underPath: '', overPath: '' };

    // Pace value at a given day
    function paceAt(day: number): number {
      const pacePerDay = (budgetTotal - recurringDeduction) / (daysInMonth - 1);
      return recurringDeduction + pacePerDay * (day - 1);
    }

    // Build sample points for both spending and pace at each data day
    interface Segment {
      day: number;
      spendY: number;
      paceY: number;
      spendVal: number;
      paceVal: number;
    }

    const segments: Segment[] = spendingData.map((d) => {
      const date = new Date(d.date + 'T00:00:00');
      const day = date.getDate();
      const pVal = paceAt(day);
      return {
        day,
        spendY: sy(d.value),
        paceY: sy(pVal),
        spendVal: d.value,
        paceVal: pVal
      };
    });

    // Split into under-pace and over-pace regions by finding crossover points
    // and building separate closed paths for each region
    let underParts: string[] = [];
    let overParts: string[] = [];

    // For simplicity, build a polygon-based approach:
    // Top edge = spending line points, bottom edge = pace line points (reversed)
    // Then clip by whether spending is above or below pace
    // We'll generate two clip paths using the intersection approach

    // Find intersection day between adjacent segments where status changes
    function findCrossDay(s1: Segment, s2: Segment): number | null {
      const diff1 = s1.spendVal - s1.paceVal;
      const diff2 = s2.spendVal - s2.paceVal;
      if (diff1 * diff2 >= 0) return null; // No sign change
      const t = diff1 / (diff1 - diff2);
      return s1.day + t * (s2.day - s1.day);
    }

    // Build expanded segment list with intersection points inserted
    interface Point {
      day: number;
      spendVal: number;
      paceVal: number;
    }

    const points: Point[] = [];
    for (let i = 0; i < segments.length; i++) {
      points.push({
        day: segments[i].day,
        spendVal: segments[i].spendVal,
        paceVal: segments[i].paceVal
      });
      if (i < segments.length - 1) {
        const crossDay = findCrossDay(segments[i], segments[i + 1]);
        if (crossDay !== null) {
          const pVal = paceAt(crossDay);
          points.push({ day: crossDay, spendVal: pVal, paceVal: pVal });
        }
      }
    }

    // Now group consecutive points into under/over runs
    let currentRun: Point[] = [];
    let currentStatus: 'under' | 'over' | 'equal' = 'equal';

    function flushRun() {
      if (currentRun.length < 2) return;
      // Build closed shape: spending edge uses same cubic curves as the
      // rendered line (avoids gaps between curve and straight polygon edges),
      // pace edge uses straight lines (pace is linear).
      const spendPts = currentRun.map((p) => ({ x: sx(p.day), y: sy(p.spendVal) }));
      const spendEdge = toPath(spendPts); // Monotone cubic bezier
      const paceCoords = currentRun
        .slice()
        .reverse()
        .map((p) => `${sx(p.day)},${sy(p.paceVal)}`);
      const path = `${spendEdge}L${paceCoords.join('L')}Z`;
      if (currentStatus === 'under') {
        underParts.push(path);
      } else if (currentStatus === 'over') {
        overParts.push(path);
      }
    }

    for (const pt of points) {
      const status: 'under' | 'over' | 'equal' =
        pt.spendVal < pt.paceVal - 0.01
          ? 'under'
          : pt.spendVal > pt.paceVal + 0.01
            ? 'over'
            : 'equal';

      if (status === 'equal') {
        // Intersection point — belongs to both runs
        currentRun.push(pt);
        flushRun();
        currentRun = [pt];
        currentStatus = 'equal';
      } else if (status !== currentStatus) {
        if (currentRun.length > 0) {
          currentRun.push(pt);
          flushRun();
          currentRun = [pt];
        } else {
          currentRun.push(pt);
        }
        currentStatus = status;
      } else {
        currentRun.push(pt);
      }
    }
    flushRun();

    return {
      underPath: underParts.join(' '),
      overPath: overParts.join(' ')
    };
  });

  // ══════════════════════════════════════════════════════════════════════════
  //                     HOVER / TOOLTIP INTERACTION
  // ══════════════════════════════════════════════════════════════════════════

  /** Interpolate spending value at a given day. */
  function interpolateSpendingAt(day: number): number | null {
    if (spendingData.length === 0) return null;
    if (spendingData.length === 1) return spendingData[0].value;

    const days = spendingData.map((d) => new Date(d.date + 'T00:00:00').getDate());

    if (day <= days[0]) return spendingData[0].value;
    if (day >= days[days.length - 1]) return spendingData[spendingData.length - 1].value;

    for (let i = 0; i < days.length - 1; i++) {
      if (day >= days[i] && day <= days[i + 1]) {
        const t = (day - days[i]) / (days[i + 1] - days[i]);
        return spendingData[i].value + t * (spendingData[i + 1].value - spendingData[i].value);
      }
    }
    return spendingData[spendingData.length - 1].value;
  }

  /** Pace value at a given day. */
  function paceValueAt(day: number): number {
    if (daysInMonth <= 1) return recurringDeduction;
    const pacePerDay = (budgetTotal - recurringDeduction) / (daysInMonth - 1);
    return recurringDeduction + pacePerDay * (day - 1);
  }

  const hover = $derived.by(() => {
    if (hoverX === null || !hasData || plotW <= 0) return null;

    const ratio = (hoverX - margin.left) / plotW;
    const day = 1 + ratio * (daysInMonth - 1);
    const clampedDay = Math.max(1, Math.min(daysInMonth, day));
    const snappedX = sx(clampedDay);

    const spendVal = interpolateSpendingAt(clampedDay);
    const paceVal = paceValueAt(clampedDay);

    // Tooltip positioning — keep in bounds
    let tipX = snappedX;
    const tipW = 180;
    if (tipX + tipW / 2 > containerW - 12) tipX = containerW - tipW / 2 - 12;
    if (tipX - tipW / 2 < 12) tipX = tipW / 2 + 12;

    return {
      crossX: snappedX,
      tipX,
      day: Math.round(clampedDay),
      spendVal,
      paceVal,
      spendY: spendVal !== null ? sy(spendVal) : null,
      paceY: sy(paceVal)
    };
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
<div class="blc" class:mounted bind:this={wrapperEl}>
  <!-- Summary labels -->
  <div class="blc-header">
    {#if hasData && !loading}
      <div class="blc-remaining">
        <span class="blc-remaining-value" class:over={remaining < 0}>
          {formatValue(Math.abs(remaining))}
        </span>
        <span class="blc-remaining-label">
          {remaining >= 0 ? 'remaining' : 'over budget'}
        </span>
      </div>
      <div
        class="blc-pace-status"
        class:under-pace={overUnder < 0}
        class:over-pace={overUnder >= 0}
      >
        <span class="blc-pace-arrow">{overUnder < 0 ? '\u25BC' : '\u25B2'}</span>
        <span class="blc-pace-amount">{formatValue(Math.abs(overUnder))}</span>
        <span class="blc-pace-label">{overUnder < 0 ? 'under' : 'over'} pace</span>
      </div>
    {:else if !loading}
      <div class="blc-remaining">
        <span class="blc-remaining-value">{formatValue(budgetTotal)}</span>
        <span class="blc-remaining-label">monthly budget</span>
      </div>
    {/if}
  </div>

  <!-- Loading skeleton -->
  {#if loading}
    <div class="blc-canvas" style="height: {chartH}px;">
      <div class="blc-skeleton">
        <div class="skeleton-line s1"></div>
        <div class="skeleton-line s2"></div>
        <div class="skeleton-line s3"></div>
        <div class="skeleton-line s4"></div>
        <div class="skeleton-shimmer"></div>
      </div>
    </div>
  {:else}
    <!-- Chart SVG -->
    <div class="blc-canvas" style="height: {chartH}px;">
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
          <span>No spending data yet</span>
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
          aria-label="Budget progress chart"
        >
          <defs>
            <!-- Spending line glow filter -->
            <filter id="{uid}-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="5" />
            </filter>

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

          <!-- X-axis labels (day numbers) -->
          {#each xLabels as lbl, i (i)}
            <text x={lbl.x} y={chartH - 6} class="x-label" text-anchor="middle">
              {lbl.text}
            </text>
          {/each}

          <!-- Budget ceiling (horizontal dashed line) -->
          <line
            x1={margin.left}
            y1={sy(budgetTotal)}
            x2={margin.left + plotW}
            y2={sy(budgetTotal)}
            stroke={CITRINE}
            stroke-opacity="0.3"
            stroke-width="1"
            stroke-dasharray="8 4"
            class="ceiling-line"
            class:line-visible={mounted}
          />

          <!-- Pace line (dotted diagonal) -->
          <line
            x1={paceStart.x}
            y1={paceStart.y}
            x2={paceEnd.x}
            y2={paceEnd.y}
            stroke={CITRINE}
            stroke-opacity="0.4"
            stroke-width="1.5"
            stroke-dasharray="6 4"
            class="pace-line"
            class:line-visible={mounted}
          />

          <!-- Shaded regions between spending and pace -->
          {#if shadedRegions.underPath}
            <path
              d={shadedRegions.underPath}
              fill={EMERALD}
              opacity="0.15"
              class="shaded-region"
              class:region-on={mounted}
            />
          {/if}
          {#if shadedRegions.overPath}
            <path
              d={shadedRegions.overPath}
              fill={RUBY}
              opacity="0.15"
              class="shaded-region"
              class:region-on={mounted}
            />
          {/if}

          <!-- Spending line glow -->
          {#if spendingPts.length > 0}
            <path
              d={spendingPath}
              fill="none"
              stroke={CITRINE}
              stroke-width="5"
              filter="url(#{uid}-glow)"
              class="line-glow"
              class:glow-on={mounted}
            />
          {/if}

          <!-- Spending line (animated draw-in) -->
          {#if spendingPts.length > 0}
            <path
              d={spendingPath}
              fill="none"
              stroke={CITRINE}
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="line-stroke"
              class:stroke-on={mounted}
              style="--len: {spendingLen};"
            />
          {/if}

          <!-- Spending endpoint dot -->
          {#if spendingPts.length > 0}
            {@const lastPt = spendingPts[spendingPts.length - 1]}
            <circle
              cx={lastPt.x}
              cy={lastPt.y}
              r="3.5"
              fill={CITRINE}
              class="endpoint"
              class:ep-on={mounted}
            />
            <circle
              cx={lastPt.x}
              cy={lastPt.y}
              r="7"
              fill="none"
              stroke={CITRINE}
              stroke-width="1.5"
              class="endpoint-ring"
              class:ep-on={mounted}
            />
          {/if}

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

            <!-- Hover dot on spending line -->
            {#if hover.spendY !== null}
              <circle
                cx={hover.crossX}
                cy={hover.spendY}
                r="4"
                fill={CITRINE}
                stroke="#161310"
                stroke-width="2"
                class="hover-dot"
              />
            {/if}

            <!-- Hover dot on pace line -->
            <circle
              cx={hover.crossX}
              cy={hover.paceY}
              r="3"
              fill="none"
              stroke={CITRINE}
              stroke-opacity="0.5"
              stroke-width="1.5"
              class="hover-dot"
            />
          {/if}
        </svg>

        <!-- Tooltip (HTML, outside SVG for backdrop-filter) -->
        {#if hover}
          <div class="blc-tip" style="left: {hover.tipX}px;">
            <div class="tip-date">Day {hover.day}</div>
            <div class="tip-row">
              <span class="tip-swatch" style="background: {CITRINE};"></span>
              <span class="tip-label">Spent</span>
              <span class="tip-val"
                >{hover.spendVal !== null ? formatValue(hover.spendVal) : '\u2014'}</span
              >
            </div>
            <div class="tip-row">
              <span class="tip-swatch pace-swatch"></span>
              <span class="tip-label">Pace</span>
              <span class="tip-val">{formatValue(hover.paceVal)}</span>
            </div>
            {#if hover.spendVal !== null}
              {@const diff = hover.spendVal - hover.paceVal}
              <div class="tip-diff" class:tip-under={diff < 0} class:tip-over={diff >= 0}>
                {diff < 0 ? '\u25BC' : '\u25B2'}
                {formatValue(Math.abs(diff))}
                {diff < 0 ? 'under' : 'over'}
              </div>
            {/if}
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
  .blc {
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
    --gc-emerald: #10b981;
    --gc-ruby: #ef4444;
    --gc-frost: rgba(200, 180, 120, 0.06);
    --gc-spring: cubic-bezier(0.16, 1, 0.3, 1);
  }

  /* ────────────────────────────────────────────────────────────────────────
     CONTAINER
     ──────────────────────────────────────────────────────────────────────── */
  .blc {
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

  .blc.mounted {
    opacity: 1;
    transform: translateY(0);
  }

  @media (min-width: 640px) {
    .blc {
      padding: 24px 24px 20px;
    }
  }

  /* Subtle prismatic sheen */
  .blc::before {
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
  .blc::after {
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

  .blc.mounted::after {
    opacity: 1;
    animation: blcShimmer 1.8s 0.2s ease-out forwards;
  }

  @keyframes blcShimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }

  /* ────────────────────────────────────────────────────────────────────────
     HEADER / SUMMARY
     ──────────────────────────────────────────────────────────────────────── */
  .blc-header {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .blc-remaining {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .blc-remaining-value {
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--gc-text);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }

  .blc-remaining-value.over {
    color: var(--gc-ruby);
  }

  .blc-remaining-label {
    font-size: 0.68rem;
    color: var(--gc-dim);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-weight: 500;
  }

  .blc-pace-status {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    padding: 3px 8px;
    border-radius: 6px;
  }

  .blc-pace-status.under-pace {
    color: var(--gc-emerald);
    background: rgba(16, 185, 129, 0.1);
  }

  .blc-pace-status.over-pace {
    color: var(--gc-ruby);
    background: rgba(239, 68, 68, 0.1);
  }

  .blc-pace-arrow {
    font-size: 0.55rem;
  }

  .blc-pace-amount {
    font-variant-numeric: tabular-nums;
  }

  .blc-pace-label {
    color: var(--gc-muted);
    font-weight: 500;
  }

  /* ────────────────────────────────────────────────────────────────────────
     CHART CANVAS
     ──────────────────────────────────────────────────────────────────────── */
  .blc-canvas {
    position: relative;
    width: 100%;
    touch-action: none;
    z-index: 1;
  }

  .blc-canvas svg {
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

  /* ── Ceiling & pace lines ────────────────────────────────────────────── */
  .ceiling-line,
  .pace-line {
    opacity: 0;
    transition: opacity 0.6s ease 0.3s;
  }

  .ceiling-line.line-visible,
  .pace-line.line-visible {
    opacity: 1;
  }

  /* ── Shaded regions ──────────────────────────────────────────────────── */
  .shaded-region {
    opacity: 0;
    transition: opacity 0.8s ease 0.4s;
  }

  .shaded-region.region-on {
    opacity: 0.15;
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

  /* ── Line glow ───────────────────────────────────────────────────────── */
  .line-glow {
    opacity: 0;
    transition: opacity 0.6s ease;
  }

  .line-glow.glow-on {
    animation: blcGlowBreath 4s ease-in-out infinite;
  }

  @keyframes blcGlowBreath {
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
      opacity 0.3s ease 0.9s,
      r 0.3s var(--gc-spring);
  }

  .endpoint.ep-on {
    opacity: 1;
  }

  .endpoint-ring {
    opacity: 0;
    transform-origin: center;
    transition: opacity 0.3s ease 0.9s;
  }

  .endpoint-ring.ep-on {
    animation: blcRingPulse 2.5s ease-in-out infinite;
  }

  @keyframes blcRingPulse {
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
  .blc-tip {
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
    z-index: 10;
    white-space: nowrap;
    animation: blcTipReveal 0.18s ease-out;
    min-width: 130px;
  }

  @keyframes blcTipReveal {
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

  .tip-swatch.pace-swatch {
    background: transparent;
    border: 1.5px dashed rgba(219, 176, 68, 0.5);
    box-shadow: none;
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

  .tip-diff {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--gc-border-sub);
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .tip-diff.tip-under {
    color: var(--gc-emerald);
  }

  .tip-diff.tip-over {
    color: var(--gc-ruby);
  }

  /* ── Loading skeleton ─────────────────────────────────────────────────── */
  .blc-skeleton {
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
    animation: blcSkeletonSweep 1.8s ease-in-out infinite;
  }

  @keyframes blcSkeletonSweep {
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
    .blc {
      transition: none;
      opacity: 1;
      transform: none;
    }

    .blc::after {
      animation: none;
      opacity: 0;
    }

    .line-stroke {
      transition: none;
      stroke-dasharray: none;
      stroke-dashoffset: 0;
    }

    .line-glow {
      transition: none;
      animation: none;
      opacity: 0.25;
    }

    .endpoint,
    .endpoint-ring {
      transition: none;
      opacity: 1;
    }

    .endpoint-ring {
      animation: none;
      opacity: 0.35;
    }

    .grid {
      transition: none;
      opacity: 1;
    }

    .ceiling-line,
    .pace-line {
      transition: none;
      opacity: 1;
    }

    .shaded-region {
      transition: none;
    }

    .shaded-region.region-on {
      opacity: 0.15;
    }

    .blc-tip {
      animation: none;
    }

    .skeleton-shimmer {
      animation: none;
    }
  }
</style>
