<!--
  @fileoverview Home / Dashboard — cinematic financial overview with
  gem-crystal design language and staggered entrance choreography.
-->
<script lang="ts">
  /**
   * @fileoverview Dashboard script — derives all financial summaries
   * from local-first stores and renders a gem-themed overview.
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
    budgetsStore,
    netWorthStore,
    categoriesStore
  } from '$lib/stores/data';

  /* ── Types ── */
  import type { Account, Transaction, Budget, Category, NetWorthSnapshot } from '$lib/types';

  /* ── Utilities ── */
  import {
    formatCurrency,
    formatPercent,
    formatDate,
    getCurrentMonth,
    amountClass
  } from '$lib/utils/currency';

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

  // ==========================================================================
  //                      DERIVED FINANCIAL DATA
  // ==========================================================================

  /** All visible accounts. */
  const visibleAccounts = $derived(
    ($accountsStore ?? []).filter((a: Account) => !a.is_hidden && a.status === 'open')
  );

  /** Depository accounts (checking, savings). */
  const depositoryAccounts = $derived(
    visibleAccounts.filter((a: Account) => a.type === 'depository')
  );

  /** Credit accounts. */
  const creditAccounts = $derived(visibleAccounts.filter((a: Account) => a.type === 'credit'));

  /** Total balance across depository accounts. */
  const totalBalance = $derived(
    depositoryAccounts.reduce((sum: number, a: Account) => {
      return sum + parseFloat(a.balance_available || a.balance_ledger || '0');
    }, 0)
  );

  /** Total credit liability. */
  const totalCredit = $derived(
    creditAccounts.reduce((sum: number, a: Account) => {
      return sum + Math.abs(parseFloat(a.balance_ledger || '0'));
    }, 0)
  );

  /** Current month string (YYYY-MM). */
  const currentMonth = getCurrentMonth();

  /** All transactions as array. */
  const allTransactions = $derived($transactionsStore ?? []);

  /** Transactions for the current month. */
  const monthTransactions = $derived(
    allTransactions.filter((t: Transaction) => t.date?.startsWith(currentMonth))
  );

  /** Monthly spending (negative amounts = expenses in Teller). */
  const monthlySpending = $derived(
    monthTransactions.reduce((sum: number, t: Transaction) => {
      const amt = parseFloat(t.amount || '0');
      // In Teller, negative amounts are debits (expenses)
      return amt < 0 ? sum + Math.abs(amt) : sum;
    }, 0)
  );

  /** Monthly income (positive amounts). */
  const monthlyIncome = $derived(
    monthTransactions.reduce((sum: number, t: Transaction) => {
      const amt = parseFloat(t.amount || '0');
      return amt > 0 ? sum + amt : sum;
    }, 0)
  );

  /** Recent transactions (last 7, sorted by date descending). */
  const recentTransactions = $derived(
    [...allTransactions]
      .sort((a: Transaction, b: Transaction) => (b.date ?? '').localeCompare(a.date ?? ''))
      .slice(0, 7)
  );

  /** Categories lookup map. */
  const categoriesMap = $derived(
    ($categoriesStore ?? []).reduce((map: Map<string, Category>, c: Category) => {
      map.set(c.id, c);
      return map;
    }, new Map<string, Category>())
  );

  /** Resolve category for a transaction. */
  function getCategory(t: Transaction): { name: string; icon: string; color: string } | null {
    if (!t.category_id) return null;
    const cat = categoriesMap.get(t.category_id);
    if (!cat) return null;
    return { name: cat.name, icon: cat.icon, color: cat.color };
  }

  /** Active budgets with computed spend. */
  const activeBudgets = $derived.by(() => {
    const budgets = ($budgetsStore ?? []).filter((b: Budget) => b.is_active);
    return budgets.slice(0, 4).map((b: Budget) => {
      const budgeted = parseFloat(b.amount || '0');
      // Sum transactions in this category for current month
      const spent = monthTransactions
        .filter((t: Transaction) => t.category_id === b.category_id)
        .reduce((sum: number, t: Transaction) => {
          const amt = parseFloat(t.amount || '0');
          return amt < 0 ? sum + Math.abs(amt) : sum;
        }, 0);
      const percentage = budgeted > 0 ? (spent / budgeted) * 100 : 0;
      const cat = categoriesMap.get(b.category_id);
      return {
        id: b.id,
        name: b.name,
        icon: b.icon || cat?.icon || '●',
        color: b.color || cat?.color || '#a78bfa',
        spent,
        budgeted,
        remaining: Math.max(0, budgeted - spent),
        percentage: Math.min(percentage, 100),
        overBudget: spent > budgeted,
        categoryName: cat?.name || b.name
      };
    });
  });

  /** Spending by category for the current month. */
  const spendingByCategory = $derived.by(() => {
    const categoryTotals = new Map<
      string,
      { name: string; icon: string; color: string; amount: number }
    >();

    for (const t of monthTransactions) {
      const amt = parseFloat(t.amount || '0');
      if (amt >= 0) continue; // only expenses

      const cat = getCategory(t);
      const key = t.category_id || '__uncategorized';
      const existing = categoryTotals.get(key);

      if (existing) {
        existing.amount += Math.abs(amt);
      } else {
        categoryTotals.set(key, {
          name: cat?.name || 'Uncategorized',
          icon: cat?.icon || '○',
          color: cat?.color || '#64748b',
          amount: Math.abs(amt)
        });
      }
    }

    return [...categoryTotals.values()].sort((a, b) => b.amount - a.amount).slice(0, 6);
  });

  /** Total for category spending (for percentages). */
  const categorySpendingTotal = $derived(spendingByCategory.reduce((s, c) => s + c.amount, 0));

  /** Net worth from snapshots. */
  const netWorthData = $derived.by(() => {
    const snapshots = [...($netWorthStore ?? [])].sort((a: NetWorthSnapshot, b: NetWorthSnapshot) =>
      (b.date ?? '').localeCompare(a.date ?? '')
    );
    if (snapshots.length === 0) {
      // Compute from accounts if no snapshots
      const assets = totalBalance;
      const liabilities = totalCredit;
      return {
        current: assets - liabilities,
        change: 0,
        changePercent: 0,
        hasData: visibleAccounts.length > 0
      };
    }
    const latest = snapshots[0];
    const previous = snapshots.length > 1 ? snapshots[1] : null;
    const current = parseFloat(latest.net_worth || '0');
    const prev = previous ? parseFloat(previous.net_worth || '0') : current;
    const change = current - prev;
    const changePercent = prev !== 0 ? (change / Math.abs(prev)) * 100 : 0;
    return { current, change, changePercent, hasData: true };
  });

  /** Whether we have any data at all. */
  const hasAccounts = $derived(visibleAccounts.length > 0);
  const hasTransactions = $derived(allTransactions.length > 0);
  const hasBudgets = $derived(activeBudgets.length > 0);

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
       SECTION 1 · GREETING HERO
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

  <!-- ─────────────────────────────────────────────────────────────────────
       SECTION 2 · FINANCIAL OVERVIEW CARDS
       ───────────────────────────────────────────────────────────────────── -->
  <section class="overview-cards anim-item" style="--delay: 1">
    <!-- Net Worth -->
    <div class="overview-card card-networth">
      <div class="card-shimmer"></div>
      <div class="card-inner">
        <div class="card-header">
          <span class="card-icon">◆</span>
          <span class="card-label">Net Worth</span>
        </div>
        {#if netWorthData.hasData}
          <p class="card-value card-value-lg">
            {formatCurrency(netWorthData.current, 'USD', false)}
          </p>
          {#if netWorthData.change !== 0}
            <p class="card-change {netWorthData.change >= 0 ? 'up' : 'down'}">
              <span class="change-arrow">{netWorthData.change >= 0 ? '▲' : '▼'}</span>
              {formatPercent(netWorthData.changePercent)}
            </p>
          {/if}
        {:else}
          <p class="card-empty">—</p>
        {/if}
      </div>
    </div>

    <!-- Total Balance -->
    <div class="overview-card card-balance">
      <div class="card-shimmer"></div>
      <div class="card-inner">
        <div class="card-header">
          <span class="card-icon">◈</span>
          <span class="card-label">Total Balance</span>
        </div>
        {#if hasAccounts}
          <p class="card-value">{formatCurrency(totalBalance)}</p>
          <p class="card-meta">
            {depositoryAccounts.length} account{depositoryAccounts.length !== 1 ? 's' : ''}
          </p>
        {:else}
          <p class="card-empty">No accounts</p>
        {/if}
      </div>
    </div>

    <!-- Monthly Spending -->
    <div class="overview-card card-spending">
      <div class="card-shimmer"></div>
      <div class="card-inner">
        <div class="card-header">
          <span class="card-icon">▽</span>
          <span class="card-label">Spending</span>
        </div>
        {#if hasTransactions}
          <p class="card-value">{formatCurrency(monthlySpending)}</p>
          <p class="card-meta">This month</p>
        {:else}
          <p class="card-empty">No data yet</p>
        {/if}
      </div>
    </div>

    <!-- Monthly Income -->
    <div class="overview-card card-income">
      <div class="card-shimmer"></div>
      <div class="card-inner">
        <div class="card-header">
          <span class="card-icon">△</span>
          <span class="card-label">Income</span>
        </div>
        {#if hasTransactions}
          <p class="card-value">{formatCurrency(monthlyIncome)}</p>
          <p class="card-meta">This month</p>
        {:else}
          <p class="card-empty">No data yet</p>
        {/if}
      </div>
    </div>
  </section>

  <!-- ─────────────────────────────────────────────────────────────────────
       SECTION 3 · RECENT TRANSACTIONS
       ───────────────────────────────────────────────────────────────────── -->
  <section class="section-panel anim-item" style="--delay: 2">
    <div class="section-head">
      <h2 class="section-title">Recent Transactions</h2>
      {#if hasTransactions}
        <a href="/transactions" class="section-link">View All</a>
      {/if}
    </div>

    {#if recentTransactions.length > 0}
      <ul class="txn-list">
        {#each recentTransactions as txn, i (txn.id)}
          {@const cat = getCategory(txn)}
          {@const amt = parseFloat(txn.amount || '0')}
          <li class="txn-row" style="--row-delay: {i}">
            <!-- Category indicator -->
            <div class="txn-icon" style="--cat-color: {cat?.color || '#64748b'}">
              <span>{cat?.icon || '○'}</span>
            </div>

            <!-- Description -->
            <div class="txn-details">
              <p class="txn-desc">{txn.counterparty_name || txn.description || 'Transaction'}</p>
              <p class="txn-date">{formatDate(txn.date)}{cat ? ` · ${cat.name}` : ''}</p>
            </div>

            <!-- Amount -->
            <p class="txn-amount {amountClass(amt)}">
              {amt > 0 ? '+' : ''}{formatCurrency(amt)}
            </p>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="empty-state">
        <span class="empty-icon">◇</span>
        <p>No transactions yet</p>
        <p class="empty-hint">Connect a bank account to see your transactions</p>
      </div>
    {/if}
  </section>

  <!-- ─────────────────────────────────────────────────────────────────────
       SECTION 4 · BUDGET PROGRESS
       ───────────────────────────────────────────────────────────────────── -->
  <section class="section-panel anim-item" style="--delay: 3">
    <div class="section-head">
      <h2 class="section-title">Budget Progress</h2>
      {#if hasBudgets}
        <a href="/budgets" class="section-link">View All</a>
      {/if}
    </div>

    {#if activeBudgets.length > 0}
      <div class="budget-list">
        {#each activeBudgets as budget (budget.id)}
          <div class="budget-row">
            <div class="budget-header">
              <div class="budget-info">
                <span class="budget-icon" style="color: {budget.color}">{budget.icon}</span>
                <span class="budget-name">{budget.categoryName}</span>
              </div>
              <span class="budget-amounts">
                <span class={budget.overBudget ? 'over-budget' : ''}
                  >{formatCurrency(budget.spent, 'USD', false)}</span
                >
                <span class="budget-sep">/</span>
                <span>{formatCurrency(budget.budgeted, 'USD', false)}</span>
              </span>
            </div>
            <div class="budget-bar-track">
              <div
                class="budget-bar-fill"
                class:warn={budget.percentage >= 75 && budget.percentage < 95}
                class:danger={budget.percentage >= 95}
                style="--fill: {budget.percentage}%; --bar-color: {budget.color}"
              ></div>
            </div>
            {#if budget.overBudget}
              <p class="budget-over-label">Over budget</p>
            {:else}
              <p class="budget-remaining">
                {formatCurrency(budget.remaining, 'USD', false)} remaining
              </p>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty-state">
        <span class="empty-icon">◈</span>
        <p>No budgets set</p>
        <p class="empty-hint">Create budgets to track your spending limits</p>
      </div>
    {/if}
  </section>

  <!-- ─────────────────────────────────────────────────────────────────────
       SECTION 5 · SPENDING BY CATEGORY
       ───────────────────────────────────────────────────────────────────── -->
  <section class="section-panel anim-item" style="--delay: 4">
    <div class="section-head">
      <h2 class="section-title">Spending Breakdown</h2>
    </div>

    {#if spendingByCategory.length > 0}
      <div class="category-breakdown">
        {#each spendingByCategory as cat, i (cat.name)}
          {@const pct = categorySpendingTotal > 0 ? (cat.amount / categorySpendingTotal) * 100 : 0}
          <div class="cat-row" style="--cat-delay: {i}">
            <div class="cat-left">
              <span class="cat-dot" style="background: {cat.color}"></span>
              <span class="cat-icon">{cat.icon}</span>
              <span class="cat-name">{cat.name}</span>
            </div>
            <div class="cat-right">
              <div class="cat-bar-track">
                <div class="cat-bar-fill" style="width: {pct}%; background: {cat.color}"></div>
              </div>
              <span class="cat-amount">{formatCurrency(cat.amount, 'USD', false)}</span>
              <span class="cat-pct">{pct.toFixed(0)}%</span>
            </div>
          </div>
        {/each}

        <!-- Total row -->
        <div class="cat-total">
          <span>Total</span>
          <span>{formatCurrency(categorySpendingTotal)}</span>
        </div>
      </div>
    {:else}
      <div class="empty-state">
        <span class="empty-icon">▽</span>
        <p>No spending data</p>
        <p class="empty-hint">Transactions will appear here once synced</p>
      </div>
    {/if}
  </section>

  <!-- ─────────────────────────────────────────────────────────────────────
       SECTION 6 · ACCOUNTS SUMMARY
       ───────────────────────────────────────────────────────────────────── -->
  <section class="section-panel anim-item" style="--delay: 5">
    <div class="section-head">
      <h2 class="section-title">Accounts</h2>
      {#if hasAccounts}
        <a href="/accounts" class="section-link">Manage</a>
      {/if}
    </div>

    {#if visibleAccounts.length > 0}
      <ul class="accounts-list">
        {#each visibleAccounts as acct (acct.id)}
          {@const bal = parseFloat(acct.balance_available || acct.balance_ledger || '0')}
          <li class="account-row">
            <div class="account-icon-wrap" class:credit-icon={acct.type === 'credit'}>
              <span class="account-type-icon">{acct.type === 'credit' ? '◇' : '◆'}</span>
            </div>
            <div class="account-info">
              <p class="account-name">{acct.institution_name}</p>
              <p class="account-meta">
                {acct.name}{acct.last_four ? ` ···${acct.last_four}` : ''}
              </p>
            </div>
            <p class="account-balance {acct.type === 'credit' ? 'negative' : ''}">
              {formatCurrency(bal)}
            </p>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="empty-state">
        <span class="empty-icon">◆</span>
        <p>No accounts connected</p>
        <p class="empty-hint">Link your bank to start tracking finances</p>
      </div>
    {/if}
  </section>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     STYLES
     ═══════════════════════════════════════════════════════════════════════════ -->
<style>
  /* ──────────────────────────────────────────────────────────────────────────
     DESIGN TOKENS (gem / crystal palette)
     ────────────────────────────────────────────────────────────────────────── */
  .dashboard {
    --gem-void: #050510;
    --gem-obsidian: #0a0a1e;
    --gem-onyx: #12122e;
    --gem-surface: #1a1a3e;
    --gem-surface-2: #222250;
    --gem-border: rgba(167, 139, 250, 0.12);
    --gem-border-hover: rgba(167, 139, 250, 0.25);
    --gem-text: #e8e4f0;
    --gem-text-dim: #9590a8;
    --gem-text-muted: #6b6580;
    --gem-amethyst: #a78bfa;
    --gem-amethyst-glow: rgba(167, 139, 250, 0.15);
    --gem-topaz: #f59e0b;
    --gem-topaz-warm: #d97706;
    --gem-emerald: #34d399;
    --gem-ruby: #f87171;
    --gem-sapphire: #60a5fa;
    --gem-rose-quartz: #f9a8d4;
    --gem-citrine: #fbbf24;
    --gem-jade: #6ee7b7;
    --gem-gradient-gold: linear-gradient(135deg, #f59e0b 0%, #d97706 50%, #b45309 100%);
    --gem-gradient-crystal: linear-gradient(135deg, #a78bfa 0%, #818cf8 50%, #60a5fa 100%);
    --gem-gradient-shimmer: linear-gradient(
      110deg,
      transparent 25%,
      rgba(167, 139, 250, 0.06) 37%,
      rgba(167, 139, 250, 0.12) 50%,
      rgba(167, 139, 250, 0.06) 63%,
      transparent 75%
    );
    --radius: 16px;
    --radius-sm: 10px;
  }

  /* ──────────────────────────────────────────────────────────────────────────
     LAYOUT
     ────────────────────────────────────────────────────────────────────────── */
  .dashboard {
    max-width: 960px;
    margin: 0 auto;
    padding: 0 16px 100px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  @media (min-width: 768px) {
    .dashboard {
      padding: 0 24px 80px;
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
    transition-delay: calc(var(--delay, 0) * 90ms);
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
    background: radial-gradient(circle, rgba(167, 139, 250, 0.35), transparent 70%);
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
    color: var(--gem-amethyst);
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
    background: var(--gem-gradient-crystal);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .hero-subtitle {
    font-size: 0.85rem;
    color: var(--gem-text-dim);
    margin: 0;
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
     OVERVIEW CARDS — horizontal scroll on mobile, grid on desktop
     ────────────────────────────────────────────────────────────────────────── */
  .overview-cards {
    display: flex;
    gap: 12px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding: 4px 0;
  }

  .overview-cards::-webkit-scrollbar {
    display: none;
  }

  @media (min-width: 768px) {
    .overview-cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      overflow: visible;
      gap: 16px;
    }
  }

  @media (min-width: 960px) {
    .overview-cards {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  .overview-card {
    position: relative;
    flex: 0 0 auto;
    width: 200px;
    min-height: 120px;
    scroll-snap-align: start;
    background: var(--gem-obsidian);
    border: 1px solid var(--gem-border);
    border-radius: var(--radius);
    overflow: hidden;
    transition:
      border-color 0.3s ease,
      box-shadow 0.3s ease;
  }

  .overview-card:hover {
    border-color: var(--gem-border-hover);
    box-shadow: 0 4px 24px rgba(167, 139, 250, 0.08);
  }

  @media (min-width: 768px) {
    .overview-card {
      width: auto;
      min-height: 130px;
    }
  }

  /* Shimmer overlay on hover */
  .card-shimmer {
    position: absolute;
    inset: 0;
    background: var(--gem-gradient-shimmer);
    background-size: 300% 100%;
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
  }

  .overview-card:hover .card-shimmer {
    opacity: 1;
    animation: shimmer-slide 2s linear infinite;
  }

  @keyframes shimmer-slide {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .card-inner {
    position: relative;
    z-index: 1;
    padding: 18px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    height: 100%;
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .card-icon {
    font-size: 0.8rem;
    color: var(--gem-amethyst);
  }

  .card-label {
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--gem-text-dim);
  }

  .card-value {
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--gem-text);
    margin: 0;
    letter-spacing: -0.02em;
    line-height: 1.1;
  }

  .card-value-lg {
    font-size: 1.5rem;
  }

  .card-change {
    font-size: 0.75rem;
    font-weight: 600;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .card-change.up {
    color: var(--gem-emerald);
  }

  .card-change.down {
    color: var(--gem-ruby);
  }

  .change-arrow {
    font-size: 0.6rem;
  }

  .card-meta {
    font-size: 0.72rem;
    color: var(--gem-text-muted);
    margin: 0;
  }

  .card-empty {
    font-size: 1.1rem;
    color: var(--gem-text-muted);
    margin: auto 0;
  }

  /* Net worth card — gold accent border */
  .card-networth {
    border-color: rgba(245, 158, 11, 0.2);
  }

  .card-networth:hover {
    border-color: rgba(245, 158, 11, 0.35);
    box-shadow: 0 4px 24px rgba(245, 158, 11, 0.08);
  }

  .card-networth .card-icon {
    color: var(--gem-topaz);
  }

  .card-networth .card-value {
    background: var(--gem-gradient-gold);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  /* Balance card */
  .card-balance .card-icon {
    color: var(--gem-sapphire);
  }

  /* Spending card */
  .card-spending .card-icon {
    color: var(--gem-ruby);
  }

  /* Income card */
  .card-income .card-icon {
    color: var(--gem-emerald);
  }

  /* ──────────────────────────────────────────────────────────────────────────
     SECTION PANELS — shared panel style
     ────────────────────────────────────────────────────────────────────────── */
  .section-panel {
    background: var(--gem-obsidian);
    border: 1px solid var(--gem-border);
    border-radius: var(--radius);
    padding: 20px;
    overflow: hidden;
  }

  @media (min-width: 768px) {
    .section-panel {
      padding: 24px;
    }
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  .section-title {
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--gem-text);
    margin: 0;
    letter-spacing: -0.01em;
  }

  .section-link {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--gem-amethyst);
    text-decoration: none;
    letter-spacing: 0.04em;
    transition: color 0.2s;
  }

  .section-link:hover {
    color: var(--gem-sapphire);
  }

  /* ──────────────────────────────────────────────────────────────────────────
     TRANSACTIONS LIST
     ────────────────────────────────────────────────────────────────────────── */
  .txn-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .txn-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid rgba(167, 139, 250, 0.06);
    transition: background 0.2s;
  }

  .txn-row:last-child {
    border-bottom: none;
  }

  .txn-row:hover {
    background: rgba(167, 139, 250, 0.03);
    margin: 0 -12px;
    padding-left: 12px;
    padding-right: 12px;
    border-radius: var(--radius-sm);
  }

  .txn-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--cat-color) 12%, transparent);
    color: var(--cat-color);
    font-size: 0.95rem;
    flex-shrink: 0;
  }

  .txn-details {
    flex: 1;
    min-width: 0;
  }

  .txn-desc {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--gem-text);
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .txn-date {
    font-size: 0.7rem;
    color: var(--gem-text-muted);
    margin: 2px 0 0;
  }

  .txn-amount {
    font-size: 0.88rem;
    font-weight: 700;
    margin: 0;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .txn-amount.positive {
    color: var(--gem-emerald);
  }

  .txn-amount.negative {
    color: var(--gem-ruby);
  }

  .txn-amount.zero {
    color: var(--gem-text-dim);
  }

  /* ──────────────────────────────────────────────────────────────────────────
     BUDGET PROGRESS
     ────────────────────────────────────────────────────────────────────────── */
  .budget-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .budget-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .budget-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .budget-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .budget-icon {
    font-size: 1rem;
  }

  .budget-name {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--gem-text);
  }

  .budget-amounts {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--gem-text-dim);
    font-variant-numeric: tabular-nums;
  }

  .budget-sep {
    margin: 0 2px;
    color: var(--gem-text-muted);
  }

  .over-budget {
    color: var(--gem-ruby);
  }

  .budget-bar-track {
    width: 100%;
    height: 6px;
    border-radius: 3px;
    background: var(--gem-surface);
    overflow: hidden;
  }

  .budget-bar-fill {
    height: 100%;
    width: var(--fill);
    border-radius: 3px;
    background: var(--bar-color, var(--gem-amethyst));
    transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .budget-bar-fill.warn {
    background: var(--gem-topaz);
  }

  .budget-bar-fill.danger {
    background: var(--gem-ruby);
  }

  .budget-remaining {
    font-size: 0.68rem;
    color: var(--gem-text-muted);
    margin: 0;
  }

  .budget-over-label {
    font-size: 0.68rem;
    color: var(--gem-ruby);
    font-weight: 600;
    margin: 0;
  }

  /* ──────────────────────────────────────────────────────────────────────────
     SPENDING BY CATEGORY — horizontal bar breakdown
     ────────────────────────────────────────────────────────────────────────── */
  .category-breakdown {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .cat-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .cat-left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex-shrink: 0;
  }

  .cat-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .cat-icon {
    font-size: 0.85rem;
    flex-shrink: 0;
  }

  .cat-name {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--gem-text);
    white-space: nowrap;
  }

  .cat-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
    justify-content: flex-end;
  }

  .cat-bar-track {
    flex: 1;
    max-width: 160px;
    height: 5px;
    border-radius: 3px;
    background: var(--gem-surface);
    overflow: hidden;
    display: none;
  }

  @media (min-width: 480px) {
    .cat-bar-track {
      display: block;
    }
  }

  .cat-bar-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .cat-amount {
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--gem-text);
    font-variant-numeric: tabular-nums;
    min-width: 60px;
    text-align: right;
  }

  .cat-pct {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--gem-text-muted);
    min-width: 32px;
    text-align: right;
  }

  .cat-total {
    display: flex;
    justify-content: space-between;
    padding-top: 12px;
    border-top: 1px solid var(--gem-border);
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--gem-text);
    font-variant-numeric: tabular-nums;
  }

  /* ──────────────────────────────────────────────────────────────────────────
     ACCOUNTS LIST
     ────────────────────────────────────────────────────────────────────────── */
  .accounts-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .account-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid rgba(167, 139, 250, 0.06);
  }

  .account-row:last-child {
    border-bottom: none;
  }

  .account-icon-wrap {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--gem-amethyst-glow);
    color: var(--gem-amethyst);
    font-size: 0.9rem;
    flex-shrink: 0;
  }

  .credit-icon {
    background: rgba(248, 113, 113, 0.1);
    color: var(--gem-ruby);
  }

  .account-info {
    flex: 1;
    min-width: 0;
  }

  .account-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--gem-text);
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .account-meta {
    font-size: 0.7rem;
    color: var(--gem-text-muted);
    margin: 2px 0 0;
  }

  .account-balance {
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--gem-text);
    margin: 0;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .account-balance.negative {
    color: var(--gem-ruby);
  }

  /* ──────────────────────────────────────────────────────────────────────────
     EMPTY STATES
     ────────────────────────────────────────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    text-align: center;
    gap: 6px;
  }

  .empty-icon {
    font-size: 1.6rem;
    color: var(--gem-amethyst);
    opacity: 0.4;
    margin-bottom: 4px;
  }

  .empty-state p {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--gem-text-dim);
  }

  .empty-hint {
    font-size: 0.75rem !important;
    font-weight: 500 !important;
    color: var(--gem-text-muted) !important;
  }

  /* ──────────────────────────────────────────────────────────────────────────
     TWO-COLUMN GRID ON DESKTOP
     ────────────────────────────────────────────────────────────────────────── */
  @media (min-width: 768px) {
    .dashboard {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    /* Hero and overview span full width */
    .hero {
      grid-column: 1 / -1;
    }

    .overview-cards {
      grid-column: 1 / -1;
    }

    /* Transactions and budgets side by side */
    .section-panel:nth-of-type(1) {
      grid-column: 1 / 2;
    }

    .section-panel:nth-of-type(2) {
      grid-column: 2 / 3;
    }

    /* Spending and accounts side by side */
    .section-panel:nth-of-type(3) {
      grid-column: 1 / 2;
    }

    .section-panel:nth-of-type(4) {
      grid-column: 2 / 3;
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
    background: radial-gradient(ellipse at center, rgba(167, 139, 250, 0.04) 0%, transparent 70%);
    pointer-events: none;
    z-index: -1;
  }

  /* ──────────────────────────────────────────────────────────────────────────
     REDUCED MOTION
     ────────────────────────────────────────────────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    .anim-item {
      opacity: 1;
      transform: none;
      transition: none;
    }

    .crystal-refraction {
      animation: none;
    }

    .card-shimmer {
      display: none;
    }
  }
</style>
