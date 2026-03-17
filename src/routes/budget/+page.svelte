<!--
  @fileoverview Budget page — comprehensive monthly budget tracking with
  category breakdowns, cumulative spending chart, recurring transactions,
  historical comparison, and budget configuration.

  Features:
    - Month navigation with prev/next arrows
    - BudgetLineChart for cumulative spending vs pace
    - Summary metrics (spent / remaining) with GemPieChart category splits
    - Category list with progress bars and over-budget highlighting
    - Collapsible recurring transactions section
    - Historical monthly bar chart (last 6 months)
    - Budget Config Modal (bottom sheet) for managing categories + amounts
    - Add Recurring Modal for manual recurring entries
-->
<script lang="ts">
  /**
   * @fileoverview Budget page script — reactive budget derivations,
   * category spending, month navigation, recurring management,
   * modal state, and historical data computation.
   */

  // ==========================================================================
  //                                IMPORTS
  // ==========================================================================

  /* ── Svelte ── */
  import { onMount } from 'svelte';

  /* ── SvelteKit ── */
  import { browser } from '$app/environment';

  /* ── App Data Stores ── */
  import {
    accountsStore,
    transactionsStore,
    recurringTransactionsStore,
    categoriesStore
  } from '$lib/stores/data';

  /* ── Utilities ── */
  import {
    formatCurrency,
    formatCurrencyCompact,
    getCurrentMonth,
    getPreviousMonth,
    formatMonth
  } from '$lib/utils/currency';

  /* ── Components ── */
  import BudgetLineChart from '$lib/components/BudgetLineChart.svelte';
  import GemPieChart from '$lib/components/GemPieChart.svelte';
  import type { PieSegment } from '$lib/components/GemPieChart.svelte';
  import GemBarChart from '$lib/components/GemBarChart.svelte';
  import type { BarData, ThresholdConfig } from '$lib/components/GemBarChart.svelte';

  /* ── Emoji Picker ── */
  import { EMOJI_GROUPS, CATEGORY_COLORS } from '$lib/emojiPicker';

  /* ── Types ── */
  import type { Account, Transaction, RecurringTransaction, Category } from '$lib/types';

  // ==========================================================================
  //                          COMPONENT STATE
  // ==========================================================================

  /** Controls staggered entrance animation. */
  let mounted = $state(false);

  /** Whether stores have been loaded. */
  let dataLoaded = $state(false);

  /** Whether a save operation is in progress. */
  let saving = $state(false);

  // ==========================================================================
  //                        MONTH NAVIGATION
  // ==========================================================================

  let selectedMonth = $state(getCurrentMonth());
  const isCurrentMonth = $derived(selectedMonth === getCurrentMonth());

  function prevMonth() {
    selectedMonth = getPreviousMonth(selectedMonth);
  }

  function nextMonth() {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    selectedMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  // ==========================================================================
  //                         MODAL STATE
  // ==========================================================================

  /** Category Manager Modal */
  let showCategoryModal = $state(false);
  let categoryFormMode = $state<'list' | 'create' | 'edit'>('list');
  let editingCategoryId = $state<string | null>(null);
  let categoryForm = $state({ name: '', icon: '🛒', color: '#10b981', budget_amount: '' });
  let confirmDeleteId = $state<string | null>(null);

  /** Add Recurring Modal */
  let showRecurringModal = $state(false);
  let recurringForm = $state({
    name: '',
    amount: '',
    category_id: '',
    frequency: 'monthly' as 'weekly' | 'biweekly' | 'monthly' | 'yearly',
    account_id: '',
    next_date: ''
  });
  let recurringFormSaving = $state(false);

  /** Editing Recurring */
  let editingRecurringId = $state<string | null>(null);

  /** Recurring section collapsed state */
  let recurringCollapsed = $state(false);

  /** Lock body scroll when any modal is open. */
  const anyModalOpen = $derived(showCategoryModal || showRecurringModal);

  $effect(() => {
    if (browser && anyModalOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  });

  // ==========================================================================
  //                         DERIVED DATA
  // ==========================================================================

  /* ── Accounts ── */
  const accounts = $derived(
    ($accountsStore ?? []).filter((a: Account) => !a.is_hidden && a.status === 'open')
  );
  const acctTypeMap = $derived(new Map(accounts.map((a: Account) => [a.id, a.type])));

  /* ── Categories (= budget) ── */
  const categories = $derived(
    ($categoriesStore ?? [])
      .filter((c: Category) => !c.deleted)
      .sort((a: Category, b: Category) => a.order - b.order)
  );
  const categoryMap = $derived(new Map(categories.map((c: Category) => [c.id, c])));
  const totalBudget = $derived(
    categories.reduce((s: number, c: Category) => s + (parseFloat(c.budget_amount) || 0), 0)
  );
  const hasBudget = $derived(categories.length > 0);

  /* ── Selected month transactions ── */
  const selectedMonthTxns = $derived.by(() => {
    const txns = $transactionsStore ?? [];
    const prefix = selectedMonth;
    return txns.filter(
      (t: Transaction) => t.date.startsWith(prefix) && !t.is_excluded && !t.deleted
    );
  });

  /* ── Category spending for selected month ── */
  const categorySpending = $derived.by(() => {
    const spending = new Map<string, number>();
    for (const t of selectedMonthTxns) {
      if (!t.category_id || !categoryMap.has(t.category_id)) continue;
      const amt = parseFloat(t.amount) || 0;
      const type = acctTypeMap.get(t.account_id);
      const spent = type === 'credit' ? (amt > 0 ? amt : 0) : amt < 0 ? Math.abs(amt) : 0;
      if (spent > 0) spending.set(t.category_id, (spending.get(t.category_id) ?? 0) + spent);
    }
    return spending;
  });

  /* ── Total spent ── */
  const totalSpent = $derived(Array.from(categorySpending.values()).reduce((s, v) => s + v, 0));

  /* ── Remaining ── */
  const totalRemaining = $derived(totalBudget - totalSpent);
  const isOverBudget = $derived(totalSpent > totalBudget);
  const spentPercent = $derived(
    totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : 0
  );

  /* ── Daily spending for BudgetLineChart ── */
  const dailySpending = $derived.by(() => {
    const byDate = new Map<string, number>();
    for (const t of selectedMonthTxns) {
      if (!t.category_id || !categoryMap.has(t.category_id)) continue;
      const amt = parseFloat(t.amount) || 0;
      const type = acctTypeMap.get(t.account_id);
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

  /* ── Current month info for line chart ── */
  const selectedMonthInfo = $derived.by(() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const now = new Date();
    const isThisMonth = y === now.getFullYear() && m === now.getMonth() + 1;
    return {
      currentDay: isThisMonth ? now.getDate() : new Date(y, m, 0).getDate(),
      daysInMonth: new Date(y, m, 0).getDate()
    };
  });

  /* ── Recurring ── */
  const recurringItems = $derived(
    ($recurringTransactionsStore ?? []).filter(
      (r: RecurringTransaction) => r.status === 'active' && !r.deleted
    )
  );
  const recurringTotal = $derived(
    recurringItems.reduce(
      (s: number, r: RecurringTransaction) => s + (parseFloat(r.amount) || 0),
      0
    )
  );

  /* ── Pie segments ── */
  const pieSegments: PieSegment[] = $derived.by(() => {
    return categories
      .map((cat: Category) => {
        const spent = categorySpending.get(cat.id) ?? 0;
        return {
          label: cat.name,
          value: spent,
          color: cat.color,
          icon: cat.icon
        };
      })
      .filter((s: PieSegment) => s.value > 0);
  });

  /* ── Category rows for display ── */
  const categoryRows = $derived.by(() => {
    return categories
      .map((cat: Category) => {
        const budgetAmt = parseFloat(cat.budget_amount) || 0;
        const spent = categorySpending.get(cat.id) ?? 0;
        const pct = budgetAmt > 0 ? (spent / budgetAmt) * 100 : 0;
        const over = budgetAmt > 0 && spent > budgetAmt;
        return {
          id: cat.id,
          categoryId: cat.id,
          name: cat.name,
          icon: cat.icon,
          color: cat.color,
          budget: budgetAmt,
          spent,
          pct,
          over
        };
      })
      .sort((a, b) => b.spent - a.spent);
  });

  /* ── Historical monthly data for bar chart (last 6 months) ── */
  const historicalBars: BarData[] = $derived.by(() => {
    const txns = $transactionsStore ?? [];
    const bars: BarData[] = [];
    let month = getCurrentMonth();
    for (let i = 0; i < 6; i++) {
      const prefix = month;
      let monthSpent = 0;
      for (const t of txns) {
        if (!t.date.startsWith(prefix) || t.is_excluded || t.deleted) continue;
        if (!t.category_id || !categoryMap.has(t.category_id)) continue;
        const amt = parseFloat(t.amount) || 0;
        const type = acctTypeMap.get(t.account_id);
        const spent = type === 'credit' ? (amt > 0 ? amt : 0) : amt < 0 ? Math.abs(amt) : 0;
        monthSpent += spent;
      }
      const [y, m] = prefix.split('-');
      const label = new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-US', {
        month: 'short'
      });
      bars.unshift({ label, value: monthSpent });
      month = getPreviousMonth(month);
    }
    return bars;
  });

  /** Threshold for bar chart (current total budget). */
  const barThreshold: ThresholdConfig | undefined = $derived(
    totalBudget > 0 ? { value: totalBudget, label: 'Budget', color: '#dbb044' } : undefined
  );

  // ==========================================================================
  //                        ACTION HANDLERS
  // ==========================================================================

  /** Open the category manager modal. */
  function openCategoryModal() {
    categoryFormMode = 'list';
    editingCategoryId = null;
    confirmDeleteId = null;
    showCategoryModal = true;
  }

  /** Start creating a new category. */
  function startCreateCategory() {
    const colorIndex = categories.length % CATEGORY_COLORS.length;
    categoryForm = { name: '', icon: '🛒', color: CATEGORY_COLORS[colorIndex], budget_amount: '' };
    editingCategoryId = null;
    categoryFormMode = 'create';
  }

  /** Start editing an existing category. */
  function startEditCategory(id: string) {
    const cat = categoryMap.get(id);
    if (!cat) return;
    categoryForm = {
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      budget_amount: cat.budget_amount === '0' ? '' : cat.budget_amount
    };
    editingCategoryId = id;
    categoryFormMode = 'edit';
  }

  /** Save category form (create or update). */
  async function saveCategoryForm() {
    if (!categoryForm.name.trim()) return;
    saving = true;
    try {
      const data = {
        name: categoryForm.name.trim(),
        icon: categoryForm.icon,
        color: categoryForm.color,
        budget_amount: categoryForm.budget_amount || '0',
        order: editingCategoryId
          ? (categoryMap.get(editingCategoryId)?.order ?? categories.length + 1)
          : categories.length > 0
            ? Math.max(...categories.map((c: Category) => c.order)) + 1
            : 1
      };

      if (editingCategoryId) {
        await categoriesStore.update(editingCategoryId, data);
      } else {
        await categoriesStore.create(data);
      }
      await categoriesStore.refresh();
      categoryFormMode = 'list';
    } finally {
      saving = false;
    }
  }

  /** Delete a category (uncategorizes all its transactions via store). */
  async function deleteCategory(id: string) {
    saving = true;
    try {
      await categoriesStore.remove(id);
      await categoriesStore.refresh();
      confirmDeleteId = null;
      if (categoryFormMode === 'edit') categoryFormMode = 'list';
    } finally {
      saving = false;
    }
  }

  /** Category modal running total. */
  const categoryModalTotal = $derived(
    categories.reduce((s: number, c: Category) => s + (parseFloat(c.budget_amount) || 0), 0)
  );

  /** Open the add recurring modal. */
  function openRecurringModal(editId?: string) {
    if (editId) {
      const item = recurringItems.find((r: RecurringTransaction) => r.id === editId);
      if (item) {
        editingRecurringId = editId;
        recurringForm = {
          name: item.name,
          amount: item.amount,
          category_id: item.category_id ?? '',
          frequency: item.frequency as 'weekly' | 'biweekly' | 'monthly' | 'yearly',
          account_id: item.account_id ?? '',
          next_date: item.next_date ?? ''
        };
      }
    } else {
      editingRecurringId = null;
      recurringForm = {
        name: '',
        amount: '',
        category_id: '',
        frequency: 'monthly',
        account_id: '',
        next_date: ''
      };
    }
    showRecurringModal = true;
  }

  /** Save recurring transaction (create or update). */
  async function saveRecurring() {
    if (!recurringForm.name.trim() || !recurringForm.amount.trim()) return;
    recurringFormSaving = true;
    try {
      const data = {
        name: recurringForm.name.trim(),
        amount: recurringForm.amount.trim(),
        category_id: recurringForm.category_id || null,
        frequency: recurringForm.frequency,
        source: 'manual' as const,
        status: 'active' as const,
        account_id: recurringForm.account_id || null,
        merchant_pattern: null,
        last_detected_date: null,
        next_date: recurringForm.next_date || null
      };

      if (editingRecurringId) {
        await recurringTransactionsStore.update(editingRecurringId, data);
      } else {
        await recurringTransactionsStore.create(data);
      }

      showRecurringModal = false;
    } finally {
      recurringFormSaving = false;
    }
  }

  /** Remove a recurring transaction. */
  async function removeRecurring(id: string) {
    await recurringTransactionsStore.remove(id);
  }

  /** Format a recurring frequency for display. */
  function formatFrequency(freq: string): string {
    switch (freq) {
      case 'weekly':
        return '/wk';
      case 'biweekly':
        return '/2wk';
      case 'monthly':
        return '/mo';
      case 'yearly':
        return '/yr';
      default:
        return '';
    }
  }

  /** Format a date string for display (short). */
  function formatShortDate(dateStr: string | null): string {
    if (!dateStr) return '--';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ==========================================================================
  //                           LIFECYCLE
  // ==========================================================================

  onMount(async () => {
    try {
      await Promise.all([
        accountsStore.load(),
        transactionsStore.load(),
        recurringTransactionsStore.load(),
        categoriesStore.load()
      ]);
    } finally {
      dataLoaded = true;
    }

    requestAnimationFrame(() => {
      mounted = true;
    });
  });
</script>

<svelte:head>
  <title>Budget - Radiant Finance</title>
</svelte:head>

<!-- ═══════════════════════════════════════════════════════════════════════════
     BUDGET PAGE LAYOUT
     ═══════════════════════════════════════════════════════════════════════════ -->
<div class="budget-page" class:mounted>
  <!-- ─────────────────────────────────────────────────────────────────────
       HEADER + MONTH NAV
       ───────────────────────────────────────────────────────────────────── -->
  <header class="page-header anim-item" style="--delay: 0">
    <div class="header-row">
      <div class="title-gem">
        <div class="title-flare f1"></div>
        <div class="title-flare f2"></div>
        <h1 class="page-title">Budget</h1>
      </div>
      <button class="config-btn" onclick={openCategoryModal} aria-label="Manage categories">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path
            d="M8.325 2.317a1.5 1.5 0 013.35 0l.148.654a1.5 1.5 0 002.058.868l.592-.302a1.5 1.5 0 011.676 2.369l-.444.558a1.5 1.5 0 00.558 2.245l.594.297a1.5 1.5 0 010 2.685l-.594.297a1.5 1.5 0 00-.558 2.245l.444.558a1.5 1.5 0 01-1.676 2.37l-.592-.303a1.5 1.5 0 00-2.058.868l-.148.654a1.5 1.5 0 01-3.35 0l-.148-.654a1.5 1.5 0 00-2.058-.868l-.592.302a1.5 1.5 0 01-1.676-2.369l.444-.558a1.5 1.5 0 00-.558-2.245l-.594-.297a1.5 1.5 0 010-2.685l.594-.297a1.5 1.5 0 00.558-2.245l-.444-.558A1.5 1.5 0 015.527 3.537l.592.302a1.5 1.5 0 002.058-.868l.148-.654z"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.3" />
        </svg>
      </button>
    </div>
    <div class="month-nav-group">
      {#if !isCurrentMonth}
        <button class="today-btn" onclick={() => (selectedMonth = getCurrentMonth())}>
          Today
        </button>
      {/if}
      <div class="month-nav">
        <button class="month-arrow" onclick={prevMonth} aria-label="Previous month">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M12.5 15L7.5 10L12.5 5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <span class="month-label">{formatMonth(selectedMonth)}</span>
        <button
          class="month-arrow"
          onclick={nextMonth}
          disabled={isCurrentMonth}
          aria-label="Next month"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M7.5 15L12.5 10L7.5 5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  </header>

  <!-- ─────────────────────────────────────────────────────────────────────
       LOADING SKELETON
       ───────────────────────────────────────────────────────────────────── -->
  {#if !dataLoaded}
    <div class="skeleton-group anim-item" style="--delay: 1">
      <div class="skeleton-card skeleton-chart"></div>
      <div class="skeleton-card skeleton-summary"></div>
      <div class="skeleton-card skeleton-list">
        {#each Array(4) as _, i (i)}
          <div class="skeleton-row"></div>
        {/each}
      </div>
    </div>

    <!-- ─────────────────────────────────────────────────────────────────────
       EMPTY STATE (no budget configured)
       ───────────────────────────────────────────────────────────────────── -->
  {:else if !hasBudget}
    <div class="empty-state anim-item" style="--delay: 1">
      <div class="empty-icon">
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
          <circle
            cx="28"
            cy="28"
            r="27"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-dasharray="4 3"
          />
          <path
            d="M28 18v20M18 28h20"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        </svg>
      </div>
      <h2 class="empty-title">No budget categories yet</h2>
      <p class="empty-desc">Create your first category to start tracking spending.</p>
      <button
        class="empty-cta"
        onclick={() => {
          openCategoryModal();
          startCreateCategory();
        }}>Create Category</button
      >
    </div>

    <!-- ─────────────────────────────────────────────────────────────────────
       MAIN CONTENT (budget exists)
       ───────────────────────────────────────────────────────────────────── -->
  {:else}
    <!-- ── Budget Line Chart ── -->
    <div class="anim-item" style="--delay: 1">
      <div class="chart-card">
        <BudgetLineChart
          spendingData={dailySpending}
          budgetTotal={totalBudget}
          recurringDeduction={recurringTotal}
          currentDay={selectedMonthInfo.currentDay}
          daysInMonth={selectedMonthInfo.daysInMonth}
          formatValue={formatCurrencyCompact}
          height={180}
        />
      </div>
    </div>

    <!-- ── Summary Metrics + Pie ── -->
    <div class="summary-section anim-item" style="--delay: 2">
      <div class="summary-numbers">
        <div class="summary-metric">
          <span class="metric-label">Spent</span>
          <span class="metric-value" class:over={isOverBudget}>
            {formatCurrency(totalSpent)}
          </span>
        </div>
        <div class="summary-divider"></div>
        <div class="summary-metric">
          <span class="metric-label">Remaining</span>
          <span class="metric-value" class:over={isOverBudget} class:under={!isOverBudget}>
            {isOverBudget ? '-' : ''}{formatCurrency(Math.abs(totalRemaining))}
          </span>
        </div>
      </div>

      <div class="summary-bar-wrap">
        <div class="summary-bar">
          <div
            class="summary-bar-fill"
            class:over={isOverBudget}
            style="width: {spentPercent}%"
          ></div>
        </div>
        <div class="summary-bar-labels">
          <span>{formatCurrencyCompact(totalSpent)}</span>
          <span>of {formatCurrencyCompact(totalBudget)}</span>
        </div>
      </div>

      <div class="pie-wrap">
        <GemPieChart
          segments={pieSegments}
          formatValue={(v) => formatCurrency(v)}
          height={200}
          donut={true}
          centerLabel="Spent"
          centerValue={formatCurrencyCompact(totalSpent)}
        />
      </div>
    </div>

    <!-- ── Category List ── -->
    <div class="category-section anim-item" style="--delay: 3">
      <h2 class="section-title">Categories</h2>
      <div class="category-list">
        {#each categoryRows as row (row.id)}
          <div class="category-row" class:over-budget={row.over}>
            <div class="cat-icon-circle" style="--cat-color: {row.color}">
              <span class="cat-icon-emoji">{row.icon}</span>
            </div>
            <div class="cat-info">
              <div class="cat-name-row">
                <span class="cat-name">{row.name}</span>
                <span class="cat-amounts">
                  <span class="cat-spent" class:over={row.over}>
                    {formatCurrency(row.spent)}
                  </span>
                  <span class="cat-separator">/</span>
                  <span class="cat-budget">{formatCurrency(row.budget)}</span>
                </span>
              </div>
              <div class="cat-progress-bar">
                <div
                  class="cat-progress-fill"
                  class:over={row.over}
                  style="width: {Math.min(row.pct, 100)}%"
                ></div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>

    <!-- ── Recurring Transactions ── -->
    <div class="recurring-section anim-item" style="--delay: 4">
      <button
        class="section-header-btn"
        onclick={() => (recurringCollapsed = !recurringCollapsed)}
        aria-expanded={!recurringCollapsed}
      >
        <div class="section-header-left">
          <h2 class="section-title">Recurring</h2>
          {#if recurringItems.length > 0}
            <span class="recurring-badge">{recurringItems.length}</span>
          {/if}
        </div>
        <div class="section-header-right">
          {#if recurringTotal > 0}
            <span class="recurring-total">{formatCurrency(recurringTotal)}/mo</span>
          {/if}
          <svg
            class="chevron-icon"
            class:collapsed={recurringCollapsed}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path
              d="M4 6L8 10L12 6"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
      </button>

      {#if !recurringCollapsed}
        <div class="recurring-content">
          {#if recurringItems.length === 0}
            <p class="recurring-empty">No active recurring transactions.</p>
          {:else}
            <div class="recurring-list">
              {#each recurringItems as item (item.id)}
                {@const cat = categoryMap.get(item.category_id ?? '')}
                <div class="recurring-row">
                  <div class="cat-icon-circle small" style="--cat-color: {cat?.color ?? '#706450'}">
                    <span class="cat-icon-emoji">{cat?.icon ?? '?'}</span>
                  </div>
                  <div class="recurring-info">
                    <div class="recurring-name-row">
                      <span class="recurring-name">{item.name}</span>
                      {#if item.source === 'auto-detected'}
                        <span class="auto-badge">(auto)</span>
                      {/if}
                    </div>
                    <span class="recurring-meta">
                      {formatCurrency(item.amount)}{formatFrequency(item.frequency)}
                      {#if item.next_date}
                        <span class="recurring-next">
                          Next: {formatShortDate(item.next_date)}
                        </span>
                      {/if}
                    </span>
                  </div>
                  <div class="recurring-actions">
                    <button
                      class="recurring-edit-btn"
                      onclick={() => openRecurringModal(item.id)}
                      aria-label="Edit {item.name}"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M11.333 2a1.886 1.886 0 012.667 2.667L5.333 13.333 2 14l.667-3.333L11.333 2z"
                          stroke="currentColor"
                          stroke-width="1.2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      class="recurring-delete-btn"
                      onclick={() => removeRecurring(item.id)}
                      aria-label="Remove {item.name}"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z"
                          stroke="currentColor"
                          stroke-width="1.2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          <button class="add-recurring-btn" onclick={() => openRecurringModal()}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 3v10M3 8h10"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
            Add Recurring
          </button>
        </div>
      {/if}
    </div>

    <!-- ── Historical Bar Chart ── -->
    <div class="history-section anim-item" style="--delay: 5">
      <GemBarChart
        title="Monthly Spending"
        bars={historicalBars}
        formatValue={formatCurrencyCompact}
        height={200}
        threshold={barThreshold}
        overColor="#ef4444"
        underColor="#10b981"
      />
    </div>
  {/if}
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     CATEGORY MANAGER MODAL
     ═══════════════════════════════════════════════════════════════════════════ -->
{#if showCategoryModal}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => (showCategoryModal = false)}
    onkeydown={(e) => e.key === 'Escape' && (showCategoryModal = false)}
  >
    <div
      class="modal-sheet"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === 'Escape' && (showCategoryModal = false)}
      role="dialog"
      tabindex="-1"
      aria-label="Category Manager"
    >
      <div class="sheet-handle-bar">
        <div class="sheet-handle"></div>
      </div>

      <div class="sheet-header">
        <div class="sheet-header-left">
          {#if categoryFormMode !== 'list'}
            <button
              class="sheet-back"
              onclick={() => (categoryFormMode = 'list')}
              aria-label="Back"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                  d="M12.5 15L7.5 10L12.5 5"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          {/if}
          <h2 class="sheet-title">
            {#if categoryFormMode === 'create'}New Category{:else if categoryFormMode === 'edit'}Edit
              Category{:else}Budget Categories{/if}
          </h2>
        </div>
        <button class="sheet-close" onclick={() => (showCategoryModal = false)} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M5 5L15 15M15 5L5 15"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>

      <div class="sheet-body">
        {#if categoryFormMode === 'list'}
          <!-- Category List -->
          {#if categories.length === 0}
            <div class="cat-modal-empty">
              <p>No categories yet. Create your first one to start budgeting.</p>
            </div>
          {:else}
            <div class="cat-modal-list">
              {#each categories as cat (cat.id)}
                <div class="cat-modal-row">
                  <div class="cat-modal-row-left">
                    <div class="cat-icon-circle small" style="--cat-color: {cat.color}">
                      <span class="cat-icon-emoji">{cat.icon}</span>
                    </div>
                    <div class="cat-modal-info">
                      <span class="cat-modal-name">{cat.name}</span>
                      {#if parseFloat(cat.budget_amount) > 0}
                        <span class="cat-modal-budget"
                          >{formatCurrency(parseFloat(cat.budget_amount))}/mo</span
                        >
                      {/if}
                    </div>
                  </div>
                  <div class="cat-modal-actions">
                    <button
                      class="recurring-edit-btn"
                      onclick={() => startEditCategory(cat.id)}
                      aria-label="Edit {cat.name}"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <path
                          d="M11.333 2a1.886 1.886 0 012.667 2.667L5.333 13.333 2 14l.667-3.333L11.333 2z"
                          stroke="currentColor"
                          stroke-width="1.2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </button>
                    {#if confirmDeleteId === cat.id}
                      <button
                        class="confirm-delete-btn"
                        onclick={() => deleteCategory(cat.id)}
                        disabled={saving}
                      >
                        Confirm
                      </button>
                      <button class="cancel-delete-btn" onclick={() => (confirmDeleteId = null)}>
                        Cancel
                      </button>
                    {:else}
                      <button
                        class="recurring-delete-btn"
                        onclick={() => (confirmDeleteId = cat.id)}
                        aria-label="Delete {cat.name}"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <path
                            d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4m2 0v9.333a1.333 1.333 0 01-1.334 1.334H4.667a1.333 1.333 0 01-1.334-1.334V4h9.334z"
                            stroke="currentColor"
                            stroke-width="1.2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          />
                        </svg>
                      </button>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        {:else}
          <!-- Create / Edit Form -->
          <div class="form-group">
            <label class="form-label" for="cat-name">Name</label>
            <input
              id="cat-name"
              type="text"
              class="form-input"
              bind:value={categoryForm.name}
              placeholder="e.g. Groceries, Rent"
            />
          </div>

          <div class="form-group" role="group" aria-label="Icon">
            <span class="form-label">Icon</span>
            <div class="emoji-picker">
              {#each EMOJI_GROUPS as group (group.label)}
                <div class="emoji-group">
                  <span class="emoji-group-label">{group.label}</span>
                  <div class="emoji-grid">
                    {#each group.emojis as emoji (emoji)}
                      <button
                        class="emoji-btn"
                        class:selected={categoryForm.icon === emoji}
                        onclick={() => (categoryForm.icon = emoji)}
                        type="button"
                      >
                        {emoji}
                      </button>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>

          <div class="form-group" role="group" aria-label="Color">
            <span class="form-label">Color</span>
            <div class="color-picker">
              {#each CATEGORY_COLORS as color (color)}
                <button
                  class="color-btn"
                  class:selected={categoryForm.color === color}
                  style="background-color: {color}"
                  onclick={() => (categoryForm.color = color)}
                  type="button"
                  aria-label="Color {color}"
                ></button>
              {/each}
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="cat-budget">Monthly Budget</label>
            <div class="form-input-wrap">
              <span class="form-dollar">$</span>
              <input
                id="cat-budget"
                type="number"
                class="form-input with-prefix"
                bind:value={categoryForm.budget_amount}
                placeholder="0"
                min="0"
                step="1"
                inputmode="decimal"
              />
            </div>
          </div>

          {#if categoryFormMode === 'edit' && editingCategoryId}
            <button
              class="delete-category-inline"
              onclick={() => deleteCategory(editingCategoryId!)}
              disabled={saving}
            >
              Delete this category
            </button>
          {/if}
        {/if}
      </div>

      <div class="sheet-footer">
        {#if categoryFormMode === 'list'}
          <div class="config-total-row">
            <span class="config-total-label">Monthly Total</span>
            <span class="config-total-value">{formatCurrency(categoryModalTotal)}</span>
          </div>
          <button class="save-budget-btn" onclick={startCreateCategory}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 3v10M3 8h10"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
              />
            </svg>
            Add Category
          </button>
        {:else}
          <button
            class="save-budget-btn"
            onclick={saveCategoryForm}
            disabled={saving || !categoryForm.name.trim()}
          >
            {#if saving}Saving...{:else}{categoryFormMode === 'edit' ? 'Update' : 'Create'} Category{/if}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- ═══════════════════════════════════════════════════════════════════════════
     ADD / EDIT RECURRING MODAL
     ═══════════════════════════════════════════════════════════════════════════ -->
{#if showRecurringModal}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-overlay"
    onclick={() => (showRecurringModal = false)}
    onkeydown={(e) => e.key === 'Escape' && (showRecurringModal = false)}
  >
    <div
      class="modal-sheet recurring-sheet"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === 'Escape' && (showRecurringModal = false)}
      role="dialog"
      tabindex="-1"
      aria-label={editingRecurringId ? 'Edit Recurring Transaction' : 'Add Recurring Transaction'}
    >
      <div class="sheet-handle-bar">
        <div class="sheet-handle"></div>
      </div>

      <div class="sheet-header">
        <h2 class="sheet-title">
          {editingRecurringId ? 'Edit Recurring' : 'Add Recurring'}
        </h2>
        <button class="sheet-close" onclick={() => (showRecurringModal = false)} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M5 5L15 15M15 5L5 15"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>

      <div class="sheet-body">
        <div class="form-group">
          <label class="form-label" for="rec-name">Name</label>
          <input
            id="rec-name"
            type="text"
            class="form-input"
            bind:value={recurringForm.name}
            placeholder="e.g. Netflix, Rent"
          />
        </div>

        <div class="form-group">
          <label class="form-label" for="rec-amount">Amount</label>
          <div class="form-input-wrap">
            <span class="form-dollar">$</span>
            <input
              id="rec-amount"
              type="number"
              class="form-input with-prefix"
              bind:value={recurringForm.amount}
              placeholder="0.00"
              min="0"
              step="0.01"
              inputmode="decimal"
            />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="rec-freq">Frequency</label>
          <select id="rec-freq" class="form-select" bind:value={recurringForm.frequency}>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="rec-category">Category</label>
          <select id="rec-category" class="form-select" bind:value={recurringForm.category_id}>
            <option value="">None</option>
            {#each categories as cat (cat.id)}
              <option value={cat.id}>{cat.icon} {cat.name}</option>
            {/each}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="rec-account">Account</label>
          <select id="rec-account" class="form-select" bind:value={recurringForm.account_id}>
            <option value="">None</option>
            {#each accounts as acct (acct.id)}
              <option value={acct.id}>{acct.name}</option>
            {/each}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="rec-next">Next Date</label>
          <input
            id="rec-next"
            type="date"
            class="form-input"
            bind:value={recurringForm.next_date}
          />
        </div>
      </div>

      <div class="sheet-footer">
        {#if editingRecurringId}
          <button
            class="delete-recurring-btn"
            onclick={() => {
              if (editingRecurringId) removeRecurring(editingRecurringId);
              showRecurringModal = false;
            }}
          >
            Delete
          </button>
        {/if}
        <button
          class="save-budget-btn"
          onclick={saveRecurring}
          disabled={recurringFormSaving ||
            !recurringForm.name.trim() ||
            !recurringForm.amount.trim()}
        >
          {#if recurringFormSaving}
            Saving...
          {:else}
            {editingRecurringId ? 'Update' : 'Add'}
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ═══════════════════════════════════════════════════════════════════════════
     STYLES
     ═══════════════════════════════════════════════════════════════════════════ -->
<style>
  /* ══════════════════════════════════════════════════════════════════════════
     DESIGN TOKENS (Gem Radiant)
     ══════════════════════════════════════════════════════════════════════════ */
  .budget-page {
    --bg-surface: #161310;
    --bg-raised: #1e1a14;
    --bg-raised-2: #252018;
    --bg-void: #0e0c08;
    --ruby: #e85454;
    --ruby-bright: #f06868;
    --ruby-deep: #c23838;
    --ruby-dim: rgba(232, 84, 84, 0.12);
    --ruby-glow: rgba(232, 84, 84, 0.25);
    --citrine: #dbb044;
    --citrine-dim: rgba(219, 176, 68, 0.15);
    --citrine-glow: rgba(219, 176, 68, 0.25);
    --text: #f0e8d0;
    --text-muted: #a09478;
    --text-dim: #706450;
    --border: rgba(180, 150, 80, 0.1);
    --border-hover: rgba(180, 150, 80, 0.2);
    --emerald: #10b981;
    --emerald-dim: rgba(16, 185, 129, 0.15);
    --radius: 16px;
    --radius-sm: 10px;
    --frost: rgba(30, 26, 20, 0.6);
    --frost-hover: rgba(40, 34, 26, 0.8);
    --glass-border: rgba(180, 150, 80, 0.12);
    --gradient-shimmer: linear-gradient(
      110deg,
      transparent 25%,
      rgba(232, 84, 84, 0.05) 37%,
      rgba(232, 84, 84, 0.1) 50%,
      rgba(232, 84, 84, 0.05) 63%,
      transparent 75%
    );
  }

  /* ══════════════════════════════════════════════════════════════════════════
     LAYOUT
     ══════════════════════════════════════════════════════════════════════════ */
  .budget-page {
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 20px;
    box-sizing: border-box;
    opacity: 0;
    transform: translateY(12px);
    transition:
      opacity 0.4s ease,
      transform 0.4s ease;
  }

  .budget-page.mounted {
    opacity: 1;
    transform: translateY(0);
  }

  /* Ruby prismatic background sweep */
  .budget-page::before {
    content: '';
    position: fixed;
    inset: 0;
    background: linear-gradient(
      150deg,
      transparent 0%,
      rgba(232, 84, 84, 0.03) 20%,
      rgba(240, 104, 104, 0.025) 35%,
      transparent 45%,
      rgba(194, 56, 56, 0.02) 60%,
      transparent 75%,
      rgba(219, 176, 68, 0.02) 90%,
      transparent 100%
    );
    background-size: 200% 200%;
    z-index: -1;
    pointer-events: none;
    animation: rubyPrismSweep 16s ease-in-out infinite alternate;
  }

  @keyframes rubyPrismSweep {
    0% {
      background-position: 0% 100%;
    }
    100% {
      background-position: 100% 0%;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     ENTRANCE ANIMATIONS
     ══════════════════════════════════════════════════════════════════════════ */
  .anim-item {
    opacity: 0;
    transform: translateY(28px);
    transition:
      opacity 0.55s cubic-bezier(0.16, 1, 0.3, 1),
      transform 0.55s cubic-bezier(0.16, 1, 0.3, 1);
    transition-delay: calc(var(--delay) * 90ms);
  }

  .budget-page.mounted .anim-item {
    opacity: 1;
    transform: translateY(0);
  }

  @media (prefers-reduced-motion: reduce) {
    .anim-item,
    .budget-page {
      transition-duration: 0.01ms !important;
      transition-delay: 0.01ms !important;
    }

    .budget-page::before {
      animation: none;
    }

    .title-flare {
      animation: none !important;
      opacity: 0.6;
    }

    .page-title {
      animation: none;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     HEADER
     ══════════════════════════════════════════════════════════════════════════ */
  .page-header {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  /* ── Ruby gem title ── */
  .title-gem {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .title-flare {
    position: absolute;
    border-radius: 50%;
    filter: blur(18px);
    pointer-events: none;
    opacity: 0;
  }

  .budget-page.mounted .title-flare {
    animation: flareIn 0.8s 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .f1 {
    width: 60px;
    height: 60px;
    top: -14px;
    left: -12px;
    background: radial-gradient(circle, rgba(232, 84, 84, 0.5), transparent 70%);
  }

  .f2 {
    width: 40px;
    height: 40px;
    top: -6px;
    right: -8px;
    background: radial-gradient(circle, rgba(240, 140, 80, 0.35), transparent 70%);
    animation-delay: 0.35s !important;
  }

  @keyframes flareIn {
    0% {
      opacity: 0;
      transform: scale(0.5);
    }
    60% {
      opacity: 0.7;
    }
    100% {
      opacity: 1;
      transform: scale(1);
    }
  }

  .page-title {
    position: relative;
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    margin: 0;
    background: linear-gradient(
      135deg,
      var(--text) 0%,
      var(--ruby-bright) 60%,
      var(--ruby-deep) 100%
    );
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    background-size: 200% auto;
    animation: rubyTitleShimmer 8s ease-in-out infinite;
  }

  @keyframes rubyTitleShimmer {
    0%,
    100% {
      background-position: 0% center;
    }
    50% {
      background-position: 100% center;
    }
  }

  .config-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    aspect-ratio: 1;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--frost);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background 0.2s,
      color 0.2s,
      border-color 0.2s;
    -webkit-tap-highlight-color: transparent;
  }

  .config-btn:hover {
    background: var(--frost-hover);
    color: var(--ruby-bright);
    border-color: rgba(232, 84, 84, 0.25);
  }

  /* ── Month Navigation ── */
  .month-nav-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .month-nav {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .month-arrow {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--frost);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background 0.2s,
      color 0.2s,
      border-color 0.2s;
    -webkit-tap-highlight-color: transparent;
  }

  .month-arrow::after {
    content: '';
    position: absolute;
    inset: -6px;
  }

  .month-arrow:hover:not(:disabled) {
    background: var(--frost-hover);
    color: var(--text);
    border-color: var(--glass-border);
  }

  .month-arrow:disabled {
    opacity: 0.25;
    cursor: default;
  }

  .month-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-muted);
    min-width: 130px;
    text-align: center;
    letter-spacing: 0.01em;
  }

  .today-btn {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ruby);
    background: var(--ruby-dim);
    border: 1px solid rgba(232, 84, 84, 0.15);
    border-radius: 6px;
    padding: 0.3rem 0.6rem;
    cursor: pointer;
    transition:
      background 0.2s,
      border-color 0.2s;
    -webkit-tap-highlight-color: transparent;
  }

  .today-btn:hover {
    background: var(--ruby-glow);
    border-color: rgba(232, 84, 84, 0.3);
  }

  @media (max-width: 640px) {
    .month-nav-group {
      width: 100%;
      justify-content: space-between;
    }

    .today-btn {
      order: 1;
    }

    .month-label {
      font-size: 0.82rem;
      min-width: 110px;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     SKELETON LOADING
     ══════════════════════════════════════════════════════════════════════════ */
  .skeleton-group {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .skeleton-card {
    border-radius: var(--radius);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    position: relative;
    overflow: hidden;
  }

  .skeleton-card::after {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--gradient-shimmer);
    background-size: 200% 100%;
    animation: shimmer 1.8s ease-in-out infinite;
  }

  .skeleton-chart {
    height: 200px;
  }

  .skeleton-summary {
    height: 120px;
  }

  .skeleton-list {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .skeleton-row {
    height: 52px;
    border-radius: var(--radius-sm);
    background: var(--bg-raised-2);
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     EMPTY STATE
     ══════════════════════════════════════════════════════════════════════════ */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 56px 24px;
    gap: 16px;
  }

  .empty-icon {
    color: var(--text-dim);
    margin-bottom: 8px;
  }

  .empty-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text);
    margin: 0;
  }

  .empty-desc {
    font-size: 0.88rem;
    color: var(--text-muted);
    line-height: 1.5;
    max-width: 300px;
    margin: 0;
  }

  .empty-cta {
    margin-top: 8px;
    padding: 12px 28px;
    font-size: 0.88rem;
    font-weight: 600;
    color: #1a1500;
    background: linear-gradient(135deg, #f0c040 0%, #d4a030 50%, #c09020 100%);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      transform 0.15s,
      box-shadow 0.2s;
    -webkit-tap-highlight-color: transparent;
  }

  .empty-cta:hover {
    transform: scale(1.02);
    box-shadow: 0 4px 20px rgba(219, 176, 68, 0.3);
  }

  .empty-cta:active {
    transform: scale(0.98);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CHART CARD
     ══════════════════════════════════════════════════════════════════════════ */
  .chart-card {
    border-radius: var(--radius);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    padding: 16px;
    backdrop-filter: blur(20px);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     SUMMARY METRICS
     ══════════════════════════════════════════════════════════════════════════ */
  .summary-section {
    border-radius: var(--radius);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    padding: 20px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .summary-numbers {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
  }

  .summary-metric {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .metric-label {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
  }

  .metric-value {
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--text);
    letter-spacing: -0.02em;
  }

  .metric-value.over {
    color: var(--ruby);
  }

  .metric-value.under {
    color: var(--emerald);
  }

  .summary-divider {
    width: 1px;
    height: 40px;
    background: var(--border);
    flex-shrink: 0;
  }

  /* ── Summary Progress Bar ── */
  .summary-bar-wrap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .summary-bar {
    height: 8px;
    border-radius: 4px;
    background: rgba(112, 100, 80, 0.2);
    overflow: hidden;
  }

  .summary-bar-fill {
    height: 100%;
    border-radius: 4px;
    background: var(--emerald);
    transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .summary-bar-fill.over {
    background: var(--ruby);
  }

  .summary-bar-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.72rem;
    color: var(--text-dim);
    font-weight: 500;
  }

  .pie-wrap {
    margin-top: 4px;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CATEGORY LIST
     ══════════════════════════════════════════════════════════════════════════ */
  .category-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .section-title {
    font-size: 0.82rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-dim);
    margin: 0;
  }

  .category-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .category-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: var(--radius-sm);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    transition:
      border-color 0.2s,
      box-shadow 0.2s;
  }

  .category-row.over-budget {
    border-color: var(--ruby-dim);
    box-shadow: 0 0 12px var(--ruby-dim);
  }

  /* ── Category Icon Circle ── */
  .cat-icon-circle {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: radial-gradient(
      circle at 35% 35%,
      color-mix(in srgb, var(--cat-color) 30%, transparent),
      color-mix(in srgb, var(--cat-color) 10%, transparent)
    );
    filter: drop-shadow(0 0 6px color-mix(in srgb, var(--cat-color) 25%, transparent));
  }

  .cat-icon-circle.small {
    width: 28px;
    height: 28px;
  }

  .cat-icon-emoji {
    font-size: 16px;
    line-height: 1;
  }

  .cat-icon-circle.small .cat-icon-emoji {
    font-size: 13px;
  }

  .cat-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .cat-name-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .cat-name {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .cat-amounts {
    font-size: 0.78rem;
    font-weight: 500;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .cat-spent {
    color: var(--text);
  }

  .cat-spent.over {
    color: var(--ruby);
  }

  .cat-separator {
    color: var(--text-dim);
    margin: 0 2px;
  }

  .cat-budget {
    color: var(--text-dim);
  }

  /* ── Category Progress Bar ── */
  .cat-progress-bar {
    height: 5px;
    border-radius: 3px;
    background: rgba(112, 100, 80, 0.15);
    overflow: hidden;
  }

  .cat-progress-fill {
    height: 100%;
    border-radius: 3px;
    background: var(--emerald);
    transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .cat-progress-fill.over {
    background: var(--ruby);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     RECURRING SECTION
     ══════════════════════════════════════════════════════════════════════════ */
  .recurring-section {
    display: flex;
    flex-direction: column;
    border-radius: var(--radius);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    overflow: hidden;
  }

  .section-header-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 14px 16px;
    background: none;
    border: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .section-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .section-header-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .recurring-badge {
    font-size: 0.68rem;
    font-weight: 700;
    color: var(--citrine);
    background: var(--citrine-dim);
    border-radius: 10px;
    padding: 2px 7px;
    line-height: 1.3;
  }

  .recurring-total {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .chevron-icon {
    color: var(--text-dim);
    transition: transform 0.25s ease;
  }

  .chevron-icon.collapsed {
    transform: rotate(-90deg);
  }

  .recurring-content {
    padding: 0 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .recurring-empty {
    font-size: 0.82rem;
    color: var(--text-dim);
    text-align: center;
    padding: 12px 0;
    margin: 0;
  }

  .recurring-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .recurring-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: var(--bg-raised-2);
    border: 1px solid transparent;
    transition: border-color 0.2s;
  }

  .recurring-row:hover {
    border-color: var(--border);
  }

  .recurring-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .recurring-name-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .recurring-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .auto-badge {
    font-size: 0.65rem;
    color: var(--text-dim);
    font-weight: 500;
    white-space: nowrap;
  }

  .recurring-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .recurring-next {
    color: var(--text-dim);
  }

  .recurring-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .recurring-edit-btn,
  .recurring-delete-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
    -webkit-tap-highlight-color: transparent;
  }

  .recurring-edit-btn:hover {
    background: var(--citrine-dim);
    color: var(--citrine);
  }

  .recurring-delete-btn:hover {
    background: var(--ruby-dim);
    color: var(--ruby);
  }

  .add-recurring-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--citrine);
    background: var(--citrine-dim);
    border: 1px dashed rgba(219, 176, 68, 0.2);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      background 0.2s,
      border-color 0.2s;
    -webkit-tap-highlight-color: transparent;
    margin-top: 4px;
  }

  .add-recurring-btn:hover {
    background: var(--citrine-glow);
    border-color: rgba(219, 176, 68, 0.35);
  }

  /* ══════════════════════════════════════════════════════════════════════════
     HISTORICAL BAR CHART
     ══════════════════════════════════════════════════════════════════════════ */
  .history-section {
    border-radius: var(--radius);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    padding: 16px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     MODAL OVERLAY + BOTTOM SHEET
     ══════════════════════════════════════════════════════════════════════════ */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    animation: overlayFadeIn 0.25s ease-out;
  }

  @keyframes overlayFadeIn {
    from {
      opacity: 0;
    }
  }

  .modal-sheet {
    position: relative;
    width: 100%;
    max-width: 500px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow:
      0 24px 48px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(180, 150, 80, 0.08);
    animation: modalEnter 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    overflow: hidden;
  }

  @keyframes modalEnter {
    from {
      opacity: 0;
      transform: translateY(24px) scale(0.96);
    }
  }

  .sheet-handle-bar {
    display: none;
  }

  .sheet-handle {
    display: none;
  }

  .sheet-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem 0.75rem;
  }

  .sheet-title {
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text);
    margin: 0;
    letter-spacing: 0.04em;
  }

  .sheet-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    transition: all 0.2s;
    -webkit-tap-highlight-color: transparent;
  }

  .sheet-close:hover {
    background: var(--frost-hover);
    border-color: var(--border);
    color: var(--text);
  }

  .sheet-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 1.5rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 16px;
    -webkit-overflow-scrolling: touch;
  }

  .sheet-footer {
    padding: 12px 1.5rem;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-bottom: max(12px, env(safe-area-inset-bottom));
  }

  /* ══════════════════════════════════════════════════════════════════════════
     CATEGORY MANAGER MODAL
     ══════════════════════════════════════════════════════════════════════════ */
  .sheet-header-left {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .sheet-back {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 8px;
    transition:
      background 0.15s,
      color 0.15s;
    -webkit-tap-highlight-color: transparent;
  }

  .sheet-back:hover {
    background: var(--bg-raised-2);
    color: var(--text);
  }

  .cat-modal-empty {
    text-align: center;
    padding: 32px 16px;
    color: var(--text-dim);
    font-size: 0.85rem;
    line-height: 1.5;
  }

  .cat-modal-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .cat-modal-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 8px;
    border-radius: var(--radius-sm);
    transition: background 0.15s;
  }

  .cat-modal-row:hover {
    background: var(--bg-raised-2);
  }

  .cat-modal-row-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }

  .cat-modal-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .cat-modal-name {
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text);
  }

  .cat-modal-budget {
    font-size: 0.72rem;
    color: var(--text-dim);
    font-weight: 500;
  }

  .cat-modal-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .confirm-delete-btn {
    padding: 4px 10px;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--ruby);
    background: var(--ruby-dim);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 6px;
    cursor: pointer;
  }

  .cancel-delete-btn {
    padding: 4px 10px;
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
  }

  /* ── Emoji Picker ── */
  .emoji-picker {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-height: 200px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .emoji-group-label {
    display: block;
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    margin-bottom: 4px;
  }

  .emoji-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .emoji-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    transition:
      background 0.12s,
      border-color 0.12s,
      transform 0.12s;
    -webkit-tap-highlight-color: transparent;
  }

  .emoji-btn:hover {
    background: var(--bg-raised-2);
  }

  .emoji-btn:active {
    transform: scale(0.9);
  }

  .emoji-btn.selected {
    border-color: var(--citrine);
    background: var(--citrine-dim);
  }

  /* ── Color Picker ── */
  .color-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .color-btn {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition:
      transform 0.12s,
      border-color 0.12s;
    -webkit-tap-highlight-color: transparent;
  }

  .color-btn:hover {
    transform: scale(1.15);
  }

  .color-btn.selected {
    border-color: var(--text);
    box-shadow: 0 0 0 2px var(--bg-void);
  }

  .delete-category-inline {
    width: 100%;
    padding: 10px;
    margin-top: 8px;
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--ruby);
    background: transparent;
    border: 1px solid rgba(239, 68, 68, 0.15);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 0.15s;
  }

  .delete-category-inline:hover:not(:disabled) {
    background: var(--ruby-dim);
  }

  .delete-category-inline:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* ── Config Total ── */
  .config-total-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .config-total-label {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .config-total-value {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--citrine);
  }

  /* ── Save Button ── */
  .save-budget-btn {
    width: 100%;
    padding: 14px;
    font-size: 0.92rem;
    font-weight: 700;
    color: #1a1500;
    background: linear-gradient(135deg, #f0c040 0%, #d4a030 50%, #c09020 100%);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      transform 0.12s,
      box-shadow 0.2s,
      opacity 0.2s;
    -webkit-tap-highlight-color: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .save-budget-btn:hover:not(:disabled) {
    transform: scale(1.01);
    box-shadow: 0 4px 20px rgba(219, 176, 68, 0.3);
  }

  .save-budget-btn:active:not(:disabled) {
    transform: scale(0.98);
  }

  .save-budget-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     RECURRING MODAL — Form
     ══════════════════════════════════════════════════════════════════════════ */
  .recurring-sheet .sheet-footer {
    flex-direction: row;
    gap: 8px;
  }

  .delete-recurring-btn {
    padding: 14px 20px;
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--ruby);
    background: var(--ruby-dim);
    border: 1px solid rgba(239, 68, 68, 0.15);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s;
    -webkit-tap-highlight-color: transparent;
    white-space: nowrap;
  }

  .delete-recurring-btn:hover {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.3);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-dim);
  }

  .form-input,
  .form-select {
    height: 44px;
    padding: 0 12px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg-void);
    color: var(--text);
    font-size: 0.88rem;
    font-family: inherit;
    outline: none;
    transition: border-color 0.2s;
    -webkit-tap-highlight-color: transparent;
  }

  .form-input::placeholder {
    color: var(--text-dim);
  }

  .form-input:focus,
  .form-select:focus {
    border-color: var(--citrine);
  }

  .form-select {
    -webkit-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%23706450' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 32px;
  }

  .form-select option {
    background: var(--bg-raised);
    color: var(--text);
  }

  .form-input-wrap {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-void);
    padding: 0 12px;
    transition: border-color 0.2s;
  }

  .form-input-wrap:focus-within {
    border-color: var(--citrine);
  }

  .form-dollar {
    font-size: 0.88rem;
    color: var(--text-dim);
    font-weight: 500;
    margin-right: 4px;
  }

  .form-input.with-prefix {
    border: none;
    background: transparent;
    padding: 0;
    height: 42px;
  }

  .form-input.with-prefix:focus {
    border-color: transparent;
  }

  /* ══════════════════════════════════════════════════════════════════════════
     RESPONSIVE — Desktop
     ══════════════════════════════════════════════════════════════════════════ */
  @media (min-width: 768px) {
    .budget-page {
      gap: 24px;
    }

    .page-title {
      font-size: 1.65rem;
    }

    .month-arrow {
      width: 32px;
      height: 32px;
    }

    .modal-sheet {
      max-height: 80vh;
    }

    .emoji-grid {
      gap: 6px;
    }

    .summary-numbers {
      gap: 24px;
    }

    .metric-value {
      font-size: 1.6rem;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════════
     REDUCED MOTION
     ══════════════════════════════════════════════════════════════════════════ */
  @media (prefers-reduced-motion: reduce) {
    .modal-overlay,
    .modal-sheet,
    .recurring-sheet,
    .emoji-btn,
    .save-budget-btn,
    .empty-cta {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }

    @keyframes shimmer {
      0%,
      100% {
        background-position: 0 0;
      }
    }
  }
</style>
