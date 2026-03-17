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
  import {
    accountsStore,
    transactionsStore,
    budgetItemsStore,
    recurringTransactionsStore
  } from '$lib/stores/data';

  /* ── Utilities ── */
  import { formatCurrency, formatCurrencyCompact } from '$lib/utils/currency';

  /* ── Components ── */
  import GemChart from '$lib/components/GemChart.svelte';
  import type { ChartDataPoint } from '$lib/components/GemChart.svelte';
  import BudgetLineChart from '$lib/components/BudgetLineChart.svelte';

  /* ── Types ── */
  import type { Account, BudgetItem } from '$lib/types';

  // ==========================================================================
  //                          COMPONENT STATE
  // ==========================================================================

  /** Controls staggered entrance animation. */
  let mounted = $state(false);

  /** Whether stores have been loaded. */
  let dataLoaded = $state(false);

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
  const accounts = $derived(
    ($accountsStore ?? []).filter((a: Account) => !a.is_hidden && a.status === 'open')
  );
  const hasAccounts = $derived(accounts.length > 0);

  /** Net money change this month (inflows - outflows across all accounts). */
  const monthlyNet = $derived.by(() => {
    const txns = $transactionsStore ?? [];
    if (txns.length === 0 || accounts.length === 0) return 0;
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const acctTypeMap = new Map(accounts.map((a) => [a.id, a.type]));
    let net = 0;
    for (const t of txns) {
      if (t.is_excluded || t.date < monthStart) continue;
      const type = acctTypeMap.get(t.account_id);
      if (!type) continue;
      const amt = parseFloat(t.amount) || 0;
      // Depository: positive = money in. Credit: positive = money out (flip sign).
      net += type === 'credit' ? -amt : amt;
    }
    return net;
  });

  // ==========================================================================
  //                      NET WORTH CHART DATA
  // ==========================================================================

  const chartTimeRanges = [
    { label: '1W', value: '1w' },
    { label: '1M', value: '1m' },
    { label: '3M', value: '3m' },
    { label: '6M', value: '6m' },
    { label: '1Y', value: '1y' },
    { label: 'ALL', value: 'all' }
  ];

  let chartRange = $state('1m');

  const chartCutoff = $derived.by(() => {
    const now = new Date();
    switch (chartRange) {
      case '1w':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      case '1m':
        return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      case '3m':
        return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      case '6m':
        return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      case '1y':
        return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      default: {
        // ALL — go back to earliest transaction date
        const txns = $transactionsStore ?? [];
        if (txns.length === 0)
          return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        let earliest = txns[0].date;
        for (const t of txns) {
          if (t.date < earliest) earliest = t.date;
        }
        return new Date(earliest + 'T00:00:00');
      }
    }
  });

  /**
   * Compute daily net worth (assets - liabilities) over time.
   *
   * Same carry-forward approach as accounts page: build per-account sparse
   * timelines, then sum all accounts for each date with carry-forward.
   *
   * Sign conventions:
   * - Depository: positive txn = money in, balance is asset
   * - Credit: positive txn = charge (money out), balance is liability
   */
  const netWorthLines = $derived.by(() => {
    const txns = $transactionsStore ?? [];
    const accts = accounts;
    if (accts.length === 0) return [];

    const cutoffStr = chartCutoff.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    // Pre-cancel credit card payment transfers: align matching credit card
    // payments and bank withdrawals to the same date to avoid net-worth humps.
    const acctTypeMap = new Map(accts.map((a) => [a.id, a.type]));
    const dateOverrides = new Map<string, string>();
    const creditPayments = txns.filter(
      (t) =>
        acctTypeMap.get(t.account_id) === 'credit' && parseFloat(t.amount) < 0 && !t.is_excluded
    );
    const bankWithdrawals = txns.filter(
      (t) =>
        acctTypeMap.get(t.account_id) !== 'credit' && parseFloat(t.amount) < 0 && !t.is_excluded
    );
    const usedBankIds = new Set<string>();
    for (const cp of creditPayments) {
      const cpAmt = parseFloat(cp.amount);
      for (const bw of bankWithdrawals) {
        if (usedBankIds.has(bw.id)) continue;
        if (Math.abs(cpAmt - parseFloat(bw.amount)) > 0.01) continue;
        const dayDiff =
          Math.abs(new Date(cp.date).getTime() - new Date(bw.date).getTime()) / 86_400_000;
        if (dayDiff <= 3) {
          const earlier = cp.date < bw.date ? cp.date : bw.date;
          dateOverrides.set(cp.id, earlier);
          dateOverrides.set(bw.id, earlier);
          usedBankIds.add(bw.id);
          break;
        }
      }
    }

    // Build per-account sparse timelines
    const timelines: {
      isDebt: boolean;
      snapshots: Map<string, number>;
      balAtCutoff: number;
    }[] = [];

    const allDates = new Set<string>();
    allDates.add(cutoffStr);
    allDates.add(todayStr);

    for (const acct of accts) {
      const currentBal =
        parseFloat(
          acct.type === 'credit'
            ? (acct.balance_ledger ?? acct.balance_available ?? '0')
            : (acct.balance_available ?? acct.balance_ledger ?? '0')
        ) || 0;

      const acctTxns = txns
        .filter((t) => t.account_id === acct.id && !t.is_excluded)
        .map((t) => ({ ...t, date: dateOverrides.get(t.id) ?? t.date }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const totalTxnSum = acctTxns.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
      let running = currentBal - totalTxnSum;

      let i = 0;
      while (i < acctTxns.length && acctTxns[i].date < cutoffStr) {
        running += parseFloat(acctTxns[i].amount) || 0;
        i++;
      }

      const balAtCutoff = running;
      const snapshots = new Map<string, number>();
      snapshots.set(cutoffStr, running);

      while (i < acctTxns.length && acctTxns[i].date <= todayStr) {
        const txnDate = acctTxns[i].date;
        running += parseFloat(acctTxns[i].amount) || 0;
        i++;
        if (i >= acctTxns.length || acctTxns[i]?.date !== txnDate) {
          snapshots.set(txnDate, running);
          allDates.add(txnDate);
        }
      }

      snapshots.set(todayStr, currentBal);
      timelines.push({ isDebt: acct.type === 'credit', snapshots, balAtCutoff });
    }

    // Sum all accounts per date with carry-forward
    const sortedDates = Array.from(allDates).sort();
    const lastKnown = timelines.map((tl) => tl.balAtCutoff);
    const data: ChartDataPoint[] = [];

    for (const date of sortedDates) {
      let netWorth = 0;
      for (let a = 0; a < timelines.length; a++) {
        const snapshot = timelines[a].snapshots.get(date);
        if (snapshot !== undefined) lastKnown[a] = snapshot;
        // Assets add, debts subtract
        netWorth += timelines[a].isDebt ? -Math.abs(lastKnown[a]) : lastKnown[a];
      }
      data.push({ date, value: netWorth });
    }

    if (data.length === 0) return [];

    return [
      {
        label: 'Net Worth',
        color: '#e8b94a',
        data
      }
    ];
  });

  // ==========================================================================
  //                      BUDGET CHART DATA
  // ==========================================================================

  /** Budget items for the single global budget. */
  const budgetItems = $derived(($budgetItemsStore ?? []) as BudgetItem[]);
  const totalBudget = $derived(budgetItems.reduce((s, b) => s + (parseFloat(b.amount) || 0), 0));
  const hasBudget = $derived(budgetItems.length > 0 && totalBudget > 0);
  const budgetCategoryIds = $derived(new Set(budgetItems.map((b) => b.category_id)));

  /** Recurring transactions — monthly total for deduction line. */
  const recurringDeduction = $derived.by(() => {
    const items = ($recurringTransactionsStore ?? []).filter(
      (r) => r.status === 'active' && !r.deleted
    );
    return items.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  });

  /** Current month info for the budget chart. */
  const currentMonthNow = $derived.by(() => {
    const now = new Date();
    return {
      prefix: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      currentDay: now.getDate(),
      daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    };
  });

  /** Cumulative daily spending for the current month (budget categories only). */
  const budgetDailySpending = $derived.by(() => {
    if (!hasBudget) return [];
    const txns = $transactionsStore ?? [];
    const { prefix } = currentMonthNow;
    const acctMap = new Map(accounts.map((a) => [a.id, a.type]));

    const byDate = new Map<string, number>();
    for (const t of txns) {
      if (!t.date.startsWith(prefix) || t.is_excluded || t.deleted) continue;
      if (!t.category_id || !budgetCategoryIds.has(t.category_id)) continue;
      const amt = parseFloat(t.amount) || 0;
      const type = acctMap.get(t.account_id);
      const spent = type === 'credit' ? (amt > 0 ? amt : 0) : amt < 0 ? Math.abs(amt) : 0;
      if (spent > 0) byDate.set(t.date, (byDate.get(t.date) ?? 0) + spent);
    }

    const sorted = Array.from(byDate.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    let cumulative = 0;
    return sorted.map(([date, value]) => {
      cumulative += value;
      return { date, value: cumulative };
    });
  });

  // ==========================================================================
  //                           LIFECYCLE
  // ==========================================================================

  onMount(() => {
    // Trigger entrance animations
    requestAnimationFrame(() => {
      mounted = true;
    });

    // Load data stores for the dashboard
    Promise.all([
      accountsStore.load(),
      transactionsStore.load(),
      budgetItemsStore.load(),
      recurringTransactionsStore.load()
    ]).then(() => {
      dataLoaded = true;
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
        {#if hasAccounts && dataLoaded}
          <span class="net-label">Net this month:</span>
          <span class="net-value" class:positive={monthlyNet >= 0} class:negative={monthlyNet < 0}>
            {monthlyNet >= 0 ? '+' : ''}{formatCurrency(monthlyNet)}
          </span>
        {:else if hasAccounts}
          Your finances at a glance
        {:else}
          Connect an account to get started
        {/if}
      </p>
    </div>
  </header>

  <!-- ─────────────────────────────────────────────────────────────────────
       NET WORTH CHART
       ───────────────────────────────────────────────────────────────────── -->
  {#if !dataLoaded || (hasAccounts && netWorthLines.length > 0)}
    <div class="anim-item" style="--delay: 1">
      <GemChart
        title="Net Worth"
        lines={dataLoaded ? netWorthLines : []}
        timeRanges={chartTimeRanges}
        selectedRange={chartRange}
        onRangeChange={(r) => (chartRange = r)}
        height={180}
        formatValue={formatCurrencyCompact}
        loading={!dataLoaded}
      />
    </div>
  {/if}

  <!-- ─────────────────────────────────────────────────────────────────────
       BUDGET PROGRESS CHART
       ───────────────────────────────────────────────────────────────────── -->
  {#if dataLoaded && hasBudget}
    <div class="anim-item" style="--delay: 2">
      <div class="budget-card">
        <div class="budget-card-header">
          <span class="budget-card-label">Budget Progress</span>
          <a href="/budget" class="budget-card-link">Details</a>
        </div>
        <BudgetLineChart
          spendingData={budgetDailySpending}
          budgetTotal={totalBudget}
          {recurringDeduction}
          currentDay={currentMonthNow.currentDay}
          daysInMonth={currentMonthNow.daysInMonth}
          formatValue={formatCurrencyCompact}
          height={160}
        />
      </div>
    </div>
  {/if}
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

  .net-label {
    color: var(--gem-text-muted);
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-size: 0.72rem;
    margin-right: 6px;
  }

  .net-value {
    font-weight: 700;
    font-size: 0.88rem;
    letter-spacing: -0.01em;
  }

  .net-value.positive {
    color: var(--gem-emerald);
  }

  .net-value.negative {
    color: var(--gem-ruby);
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
     BUDGET CARD
     ────────────────────────────────────────────────────────────────────────── */
  .budget-card {
    background: var(--gem-obsidian);
    border: 1px solid var(--gem-border);
    border-radius: var(--radius);
    padding: 16px;
    overflow: hidden;
  }

  .budget-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .budget-card-label {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--gem-citrine);
  }

  .budget-card-link {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--gem-text-dim);
    text-decoration: none;
    transition: color 0.2s;
  }

  .budget-card-link:hover {
    color: var(--gem-citrine);
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
