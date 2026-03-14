<!--
  @fileoverview Budgets page — monthly budget management with gem-crystal UI.

  Displays budget allocations per category with animated progress bars,
  a monthly ring visualization, and a modal for creating/editing budgets.
-->
<script lang="ts">
  /**
   * @fileoverview Budgets page script — budget CRUD, month navigation,
   * spending calculations, and modal state management.
   */

  // ==========================================================================
  //                                IMPORTS
  // ==========================================================================

  import { onMount } from 'svelte';
  import { budgetsStore, categoriesStore, transactionsStore } from '$lib/stores/data';
  import type { Category, Budget, Transaction } from '$lib/types';
  import { formatCurrency, getCurrentMonth, formatMonth } from '$lib/utils/currency';

  // ==========================================================================
  //                           COMPONENT STATE
  // ==========================================================================

  /** Currently selected month in YYYY-MM format. */
  let selectedMonth = $state(getCurrentMonth());

  /** Whether the add/edit budget modal is open. */
  let showModal = $state(false);

  /** Budget being edited, or null for new budget creation. */
  let editingBudget = $state<string | null>(null);

  /** Whether data has been loaded initially. */
  let loaded = $state(false);

  /** Whether a save operation is in progress. */
  let saving = $state(false);

  /* ── Modal Form State ── */
  let formCategoryId = $state('');
  let formAmount = $state('');
  let formPeriodType = $state<'monthly' | 'weekly'>('monthly');
  let formIsActive = $state(true);
  let formRollover = $state(false);

  /* ── Deletion Confirmation ── */
  let confirmDeleteId = $state<string | null>(null);

  /* ── Breakdown Expansion ── */
  let expandedBudgetId = $state<string | null>(null);

  // ==========================================================================
  //                         DERIVED STATE
  // ==========================================================================

  /** All categories from the store, sorted by order. */
  const categories = $derived(
    ($categoriesStore ?? [])
      .slice()
      .sort((a: Category, b: Category) => (a.order ?? 0) - (b.order ?? 0))
  );

  /** Map of category ID -> category for fast lookups. */
  const categoryMap: Map<string, Category> = $derived(
    new Map(categories.map((c: Category) => [c.id, c]))
  );

  /** Active budgets from the store. */
  const budgets = $derived($budgetsStore ?? []);

  /** All transactions from the store. */
  const allTransactions = $derived($transactionsStore ?? []);

  /**
   * Transactions filtered to the selected month.
   * Parses the date field and matches against YYYY-MM prefix.
   */
  const monthTransactions = $derived(
    allTransactions.filter((t: Transaction) => t.date?.startsWith(selectedMonth) && !t.is_excluded)
  );

  /**
   * Spending totals per category for the selected month.
   * Aggregates absolute transaction amounts by category_id.
   */
  const spendingByCategory = $derived.by(() => {
    const map = new Map<string, number>();
    for (const t of monthTransactions) {
      if (!t.category_id) continue;
      const amount = Math.abs(parseFloat(t.amount) || 0);
      map.set(t.category_id, (map.get(t.category_id) ?? 0) + amount);
    }
    return map;
  });

  /**
   * Budgets enriched with spending data and category info.
   * Calculates spent, remaining, and percentage for each budget.
   */
  const budgetsWithSpend = $derived.by(() => {
    return budgets
      .filter((b: Budget) => b.is_active)
      .map((b: Budget) => {
        const cat = categoryMap.get(b.category_id);
        const budgeted = parseFloat(b.amount) || 0;
        const spent = spendingByCategory.get(b.category_id) ?? 0;
        const remaining = budgeted - spent;
        const percentage = budgeted > 0 ? (spent / budgeted) * 100 : 0;
        return {
          ...b,
          budgeted,
          spent,
          remaining,
          percentage,
          categoryName: cat?.name ?? 'Uncategorized',
          categoryIcon: cat?.icon ?? '📦',
          categoryColor: cat?.color ?? '#888888'
        };
      })
      .sort((a, b) => b.percentage - a.percentage);
  });

  /** Total budgeted across all active budgets for the month. */
  const totalBudgeted = $derived(
    budgetsWithSpend.reduce((sum: number, b: { budgeted: number }) => sum + b.budgeted, 0)
  );

  /** Total spent across all budgeted categories for the month. */
  const totalSpent = $derived(
    budgetsWithSpend.reduce((sum: number, b: { spent: number }) => sum + b.spent, 0)
  );

  /** Total remaining budget for the month. */
  const totalRemaining = $derived(totalBudgeted - totalSpent);

  /** Overall budget utilization percentage. */
  const overallPercentage = $derived(totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0);

  /**
   * Status tier based on overall utilization.
   * Controls color theming across the page.
   */
  const overallStatus = $derived<'emerald' | 'gold' | 'ruby'>(
    overallPercentage >= 100 ? 'ruby' : overallPercentage >= 75 ? 'gold' : 'emerald'
  );

  /**
   * Categories available for new budgets (not already assigned).
   */
  const availableCategories = $derived.by(() => {
    const usedCategoryIds = new Set(budgets.map((b: Budget) => b.category_id));
    return categories.filter(
      (c: Category) =>
        c.type === 'expense' && (!usedCategoryIds.has(c.id) || c.id === formCategoryId)
    );
  });

  /**
   * Transactions in the selected month for a specific category.
   */
  function getTransactionsForCategory(categoryId: string): Transaction[] {
    return monthTransactions
      .filter((t: Transaction) => t.category_id === categoryId)
      .sort((a: Transaction, b: Transaction) => b.date.localeCompare(a.date));
  }

  // ==========================================================================
  //                         MONTH NAVIGATION
  // ==========================================================================

  /** Navigate to the previous month. */
  function previousMonth() {
    const [year, month] = selectedMonth.split('-').map(Number);
    const d = new Date(year, month - 2, 1);
    selectedMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** Navigate to the next month. */
  function nextMonth() {
    const [year, month] = selectedMonth.split('-').map(Number);
    const d = new Date(year, month, 1);
    selectedMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** Check if the next month button should be disabled (can't go past current month). */
  const isCurrentMonth = $derived(selectedMonth === getCurrentMonth());

  // ==========================================================================
  //                         MODAL OPERATIONS
  // ==========================================================================

  /** Open the modal for creating a new budget. */
  function openCreateModal() {
    editingBudget = null;
    formCategoryId = '';
    formAmount = '';
    formPeriodType = 'monthly';
    formIsActive = true;
    formRollover = false;
    showModal = true;
  }

  /** Open the modal for editing an existing budget. */
  function openEditModal(budgetId: string) {
    const budget = budgets.find((b) => b.id === budgetId);
    if (!budget) return;
    editingBudget = budgetId;
    formCategoryId = budget.category_id;
    formAmount = budget.amount;
    formPeriodType = (budget.period_type as 'monthly' | 'weekly') || 'monthly';
    formIsActive = budget.is_active;
    formRollover = budget.rollover;
    showModal = true;
  }

  /** Close the modal and reset form state. */
  function closeModal() {
    showModal = false;
    editingBudget = null;
    saving = false;
  }

  /** Save the current modal form (create or update). */
  async function saveBudget() {
    if (!formCategoryId || !formAmount || saving) return;
    saving = true;

    try {
      const cat = categoryMap.get(formCategoryId);
      const payload = {
        category_id: formCategoryId,
        name: cat?.name ?? 'Budget',
        amount: formAmount,
        period_type: formPeriodType,
        start_date: null as string | null,
        is_active: formIsActive,
        rollover: formRollover,
        color: cat?.color ?? null,
        icon: cat?.icon ?? null,
        order: editingBudget
          ? (budgets.find((b) => b.id === editingBudget)?.order ?? 0)
          : budgets.length
      };

      if (editingBudget) {
        await budgetsStore.update(editingBudget, payload);
      } else {
        await budgetsStore.create(payload);
      }
      closeModal();
    } catch (err) {
      console.error('Failed to save budget:', err);
    } finally {
      saving = false;
    }
  }

  /** Delete a budget after confirmation. */
  async function deleteBudget(budgetId: string) {
    try {
      await budgetsStore.remove(budgetId);
      confirmDeleteId = null;
      if (editingBudget === budgetId) closeModal();
    } catch (err) {
      console.error('Failed to delete budget:', err);
    }
  }

  /** Toggle breakdown expansion for a budget card. */
  function toggleExpand(budgetId: string) {
    expandedBudgetId = expandedBudgetId === budgetId ? null : budgetId;
  }

  // ==========================================================================
  //                           HELPERS
  // ==========================================================================

  /**
   * Returns the gem-status class for a budget's utilization level.
   */
  function budgetStatus(percentage: number): 'emerald' | 'gold' | 'ruby' {
    if (percentage >= 100) return 'ruby';
    if (percentage >= 75) return 'gold';
    return 'emerald';
  }

  /**
   * Calculates the SVG arc path for the overview ring.
   * Used for the donut/ring chart visualization.
   */
  function describeArc(
    cx: number,
    cy: number,
    r: number,
    startAngle: number,
    endAngle: number
  ): string {
    const clampedEnd = Math.min(endAngle, 359.99);
    const startRad = ((startAngle - 90) * Math.PI) / 180;
    const endRad = ((clampedEnd - 90) * Math.PI) / 180;
    const x1 = cx + r * Math.cos(startRad);
    const y1 = cy + r * Math.sin(startRad);
    const x2 = cx + r * Math.cos(endRad);
    const y2 = cy + r * Math.sin(endRad);
    const largeArc = clampedEnd - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  }

  /** Format a date string for the breakdown list. */
  function formatShortDate(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ==========================================================================
  //                           LIFECYCLE
  // ==========================================================================

  onMount(async () => {
    await Promise.all([
      budgetsStore.refresh(),
      categoriesStore.refresh(),
      transactionsStore.refresh()
    ]);
    loaded = true;
  });
</script>

<svelte:head>
  <title>Budgets - Radiant Finance</title>
</svelte:head>

<!-- ═══════════════════════════════════════════════════════════════════════════
     PAGE TEMPLATE
     ═══════════════════════════════════════════════════════════════════════════ -->

<div class="budgets-page">
  <!-- Gem facet background texture -->
  <div class="facet-bg" aria-hidden="true"></div>

  <!-- ── Header ─────────────────────────────────────────────────────── -->
  <header class="page-header">
    <div class="header-left">
      <h1 class="page-title">Budgets</h1>
      <p class="page-subtitle">{formatMonth(selectedMonth)}</p>
    </div>
    <div class="header-actions">
      <div class="month-nav">
        <button class="month-btn" onclick={previousMonth} aria-label="Previous month">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"><polyline points="15 18 9 12 15 6" /></svg
          >
        </button>
        <span class="month-label">{formatMonth(selectedMonth)}</span>
        <button
          class="month-btn"
          onclick={nextMonth}
          disabled={isCurrentMonth}
          aria-label="Next month"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg
          >
        </button>
      </div>
      <button class="add-btn" onclick={openCreateModal}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg
        >
        Add Budget
      </button>
    </div>
  </header>

  {#if !loaded}
    <!-- ── Loading Skeleton ──────────────────────────────────────── -->
    <div class="loading-state">
      <div class="crystal-loader">
        <div class="loader-facet"></div>
        <div class="loader-facet"></div>
        <div class="loader-facet"></div>
      </div>
      <p class="loading-text">Polishing your budgets...</p>
    </div>
  {:else if budgetsWithSpend.length === 0}
    <!-- ── Empty State ───────────────────────────────────────────── -->
    <div class="empty-state">
      <div class="empty-gem">
        <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
          <path
            d="M40 8L60 24L52 68H28L20 24L40 8Z"
            stroke="url(#emptyGrad)"
            stroke-width="2"
            fill="none"
            opacity="0.6"
          />
          <path d="M40 8L20 24L40 40L60 24L40 8Z" fill="url(#emptyGrad)" opacity="0.15" />
          <path d="M20 24L28 68H52L60 24L40 40L20 24Z" fill="url(#emptyGrad)" opacity="0.08" />
          <line
            x1="40"
            y1="40"
            x2="28"
            y2="68"
            stroke="url(#emptyGrad)"
            stroke-width="1"
            opacity="0.3"
          />
          <line
            x1="40"
            y1="40"
            x2="52"
            y2="68"
            stroke="url(#emptyGrad)"
            stroke-width="1"
            opacity="0.3"
          />
          <defs>
            <linearGradient id="emptyGrad" x1="20" y1="8" x2="60" y2="68">
              <stop offset="0%" stop-color="#7dd3a8" />
              <stop offset="100%" stop-color="#34d399" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <h2 class="empty-title">No budgets yet</h2>
      <p class="empty-desc">
        Set spending limits for your categories to keep your finances gleaming.
      </p>
      <button class="add-btn empty-cta" onclick={openCreateModal}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg
        >
        Create Your First Budget
      </button>
    </div>
  {:else}
    <!-- ── Monthly Overview Card ─────────────────────────────────── -->
    <div class="overview-card status-{overallStatus}">
      <div class="overview-ring-container">
        <svg
          class="overview-ring"
          viewBox="0 0 160 160"
          aria-label="Budget utilization: {overallPercentage.toFixed(0)}%"
        >
          <!-- Background track -->
          <circle
            cx="80"
            cy="80"
            r="62"
            fill="none"
            stroke="var(--ring-track)"
            stroke-width="10"
            opacity="0.2"
          />
          <!-- Filled arc -->
          {#if overallPercentage > 0}
            <path
              d={describeArc(80, 80, 62, 0, Math.min(overallPercentage, 100) * 3.6)}
              fill="none"
              stroke="var(--ring-fill)"
              stroke-width="10"
              stroke-linecap="round"
              class="ring-arc"
            />
          {/if}
          <!-- Over-budget overlay arc -->
          {#if overallPercentage > 100}
            <path
              d={describeArc(80, 80, 62, 0, Math.min(overallPercentage - 100, 100) * 3.6)}
              fill="none"
              stroke="var(--ruby-glow)"
              stroke-width="10"
              stroke-linecap="round"
              opacity="0.5"
              class="ring-arc-over"
            />
          {/if}
        </svg>
        <div class="ring-center">
          <span class="ring-percent">{Math.round(overallPercentage)}%</span>
          <span class="ring-label">used</span>
        </div>
      </div>
      <div class="overview-details">
        <div class="overview-stat">
          <span class="stat-label">Total Budgeted</span>
          <span class="stat-value">{formatCurrency(totalBudgeted)}</span>
        </div>
        <div class="overview-divider"></div>
        <div class="overview-stat">
          <span class="stat-label">Total Spent</span>
          <span class="stat-value spent">{formatCurrency(totalSpent)}</span>
        </div>
        <div class="overview-divider"></div>
        <div class="overview-stat">
          <span class="stat-label">{totalRemaining >= 0 ? 'Remaining' : 'Over Budget'}</span>
          <span class="stat-value" class:over-budget={totalRemaining < 0}>
            {formatCurrency(Math.abs(totalRemaining))}
          </span>
        </div>
      </div>
    </div>

    <!-- ── Budget Cards Grid ─────────────────────────────────────── -->
    <div class="budgets-grid">
      {#each budgetsWithSpend as budget, i (budget.id)}
        {@const status = budgetStatus(budget.percentage)}
        <div
          class="budget-card status-{status}"
          style="--card-delay: {i * 60}ms; --cat-color: {budget.categoryColor}"
          role="button"
          tabindex="0"
          onclick={() => toggleExpand(budget.id)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleExpand(budget.id);
            }
          }}
        >
          <!-- Card shimmer layer -->
          <div class="card-shimmer" aria-hidden="true"></div>

          <div class="card-top">
            <div class="card-category">
              <span class="cat-icon">{budget.categoryIcon}</span>
              <div class="cat-info">
                <span class="cat-name">{budget.categoryName}</span>
                <span class="cat-period">{budget.period_type}</span>
              </div>
            </div>
            <button
              class="card-edit-btn"
              onclick={(e) => {
                e.stopPropagation();
                openEditModal(budget.id);
              }}
              aria-label="Edit {budget.categoryName} budget"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                ><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path
                  d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
                /></svg
              >
            </button>
          </div>

          <!-- Progress bar -->
          <div class="progress-track">
            <div
              class="progress-fill"
              style="width: {Math.min(budget.percentage, 100)}%"
              role="progressbar"
              aria-valuenow={Math.round(budget.percentage)}
              aria-valuemin={0}
              aria-valuemax={100}
            ></div>
            {#if budget.percentage > 100}
              <div
                class="progress-overflow"
                style="width: {Math.min(budget.percentage - 100, 100)}%"
              ></div>
            {/if}
          </div>

          <div class="card-amounts">
            <div class="amounts-row">
              <span class="amount-spent">{formatCurrency(budget.spent)}</span>
              <span class="amount-sep">of</span>
              <span class="amount-budgeted">{formatCurrency(budget.budgeted)}</span>
            </div>
            <div class="amounts-meta">
              <span class="amount-remaining" class:over-budget={budget.remaining < 0}>
                {budget.remaining >= 0
                  ? formatCurrency(budget.remaining) + ' left'
                  : formatCurrency(Math.abs(budget.remaining)) + ' over'}
              </span>
              <span class="amount-percent">{Math.round(budget.percentage)}%</span>
            </div>
          </div>

          <!-- Expanded breakdown -->
          {#if expandedBudgetId === budget.id}
            {@const txns = getTransactionsForCategory(budget.category_id)}
            <div class="card-breakdown">
              <div class="breakdown-divider"></div>
              {#if txns.length === 0}
                <p class="breakdown-empty">No transactions this month</p>
              {:else}
                <ul class="breakdown-list">
                  {#each txns.slice(0, 8) as txn (txn.id)}
                    <li class="breakdown-item">
                      <span class="breakdown-desc">{txn.description}</span>
                      <div class="breakdown-right">
                        <span class="breakdown-amount"
                          >{formatCurrency(Math.abs(parseFloat(txn.amount)))}</span
                        >
                        <span class="breakdown-date">{formatShortDate(txn.date)}</span>
                      </div>
                    </li>
                  {/each}
                  {#if txns.length > 8}
                    <li class="breakdown-more">+{txns.length - 8} more transactions</li>
                  {/if}
                </ul>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     ADD / EDIT BUDGET MODAL
     ═══════════════════════════════════════════════════════════════════════════ -->

{#if showModal}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal-backdrop" onclick={closeModal} role="presentation">
    <!-- svelte-ignore a11y_interactive_supports_focus a11y_click_events_have_key_events -->
    <div
      class="modal-panel"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={editingBudget ? 'Edit Budget' : 'Add Budget'}
    >
      <!-- Crystal top edge decoration -->
      <div class="modal-crystal-edge" aria-hidden="true"></div>

      <h2 class="modal-title">{editingBudget ? 'Edit Budget' : 'New Budget'}</h2>

      <form
        onsubmit={(e) => {
          e.preventDefault();
          saveBudget();
        }}
        class="modal-form"
      >
        <!-- Category Selector -->
        <label class="form-field">
          <span class="field-label">Category</span>
          <select bind:value={formCategoryId} class="field-select" required>
            <option value="" disabled>Select a category</option>
            {#each availableCategories as cat (cat.id)}
              <option value={cat.id}>{cat.icon} {cat.name}</option>
            {/each}
          </select>
        </label>

        <!-- Budget Amount -->
        <label class="form-field">
          <span class="field-label">Budget Amount</span>
          <div class="field-currency-wrap">
            <span class="currency-symbol">$</span>
            <input
              type="number"
              bind:value={formAmount}
              class="field-input currency-input"
              placeholder="0.00"
              min="0"
              step="0.01"
              required
            />
          </div>
        </label>

        <!-- Period Type -->
        <label class="form-field">
          <span class="field-label">Period</span>
          <div class="toggle-group">
            <button
              type="button"
              class="toggle-option"
              class:active={formPeriodType === 'monthly'}
              onclick={() => (formPeriodType = 'monthly')}>Monthly</button
            >
            <button
              type="button"
              class="toggle-option"
              class:active={formPeriodType === 'weekly'}
              onclick={() => (formPeriodType = 'weekly')}>Weekly</button
            >
          </div>
        </label>

        <!-- Toggles Row -->
        <div class="toggles-row">
          <label class="switch-field">
            <span class="switch-label">Active</span>
            <button
              type="button"
              class="switch-track"
              class:on={formIsActive}
              onclick={() => (formIsActive = !formIsActive)}
              role="switch"
              aria-checked={formIsActive}
              aria-label="Toggle active"
            >
              <span class="switch-thumb"></span>
            </button>
          </label>
          <label class="switch-field">
            <span class="switch-label">Rollover</span>
            <button
              type="button"
              class="switch-track"
              class:on={formRollover}
              onclick={() => (formRollover = !formRollover)}
              role="switch"
              aria-checked={formRollover}
              aria-label="Toggle rollover"
            >
              <span class="switch-thumb"></span>
            </button>
          </label>
        </div>

        <!-- Actions -->
        <div class="modal-actions">
          {#if editingBudget}
            {#if confirmDeleteId === editingBudget}
              <button type="button" class="btn-danger" onclick={() => deleteBudget(editingBudget!)}>
                Confirm Delete
              </button>
              <button type="button" class="btn-ghost" onclick={() => (confirmDeleteId = null)}>
                Cancel
              </button>
            {:else}
              <button
                type="button"
                class="btn-ghost danger-text"
                onclick={() => (confirmDeleteId = editingBudget)}
              >
                Delete
              </button>
            {/if}
          {/if}
          <div class="actions-right">
            <button type="button" class="btn-ghost" onclick={closeModal}>Cancel</button>
            <button
              type="submit"
              class="btn-primary"
              disabled={saving || !formCategoryId || !formAmount}
            >
              {#if saving}
                Saving...
              {:else}
                {editingBudget ? 'Update' : 'Create'}
              {/if}
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- ═══════════════════════════════════════════════════════════════════════════
     SCOPED STYLES
     ═══════════════════════════════════════════════════════════════════════════ -->

<style>
  /* ── Design Tokens ──────────────────────────────────────────────────────── */
  .budgets-page {
    --emerald: #34d399;
    --emerald-light: #6ee7b7;
    --emerald-dim: #065f46;
    --emerald-glow: rgba(52, 211, 153, 0.35);
    --gold: #fbbf24;
    --gold-dim: #78350f;
    --gold-glow: rgba(251, 191, 36, 0.35);
    --ruby: #f87171;
    --ruby-dim: #7f1d1d;
    --ruby-glow: rgba(248, 113, 113, 0.4);

    --surface-base: #0c0a06;
    --surface-card: #14100a;
    --surface-raised: #1a1610;
    --surface-overlay: #221e16;

    --text-primary: #f0e8d0;
    --text-secondary: #a09478;
    --text-muted: #706450;

    --border-subtle: rgba(180, 150, 80, 0.1);
    --border-interactive: rgba(180, 150, 80, 0.2);

    position: relative;
    min-height: 100dvh;
    padding: 1.5rem;
    padding-bottom: 6rem;
    background: var(--surface-base);
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    color: var(--text-primary);
    overflow-x: hidden;
  }

  /* ── Faceted Background ─────────────────────────────────────────────────── */
  .facet-bg {
    position: fixed;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(135deg, rgba(52, 211, 153, 0.03) 0%, transparent 40%),
      linear-gradient(225deg, rgba(251, 191, 36, 0.02) 0%, transparent 40%),
      radial-gradient(ellipse at 70% 20%, rgba(52, 211, 153, 0.04) 0%, transparent 50%);
    z-index: 0;
  }

  .facet-bg::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(
        60deg,
        transparent 48%,
        rgba(255, 255, 255, 0.008) 49%,
        rgba(255, 255, 255, 0.008) 51%,
        transparent 52%
      ),
      linear-gradient(
        120deg,
        transparent 48%,
        rgba(255, 255, 255, 0.006) 49%,
        rgba(255, 255, 255, 0.006) 51%,
        transparent 52%
      );
    background-size: 80px 80px;
  }

  /* ── Page Header ────────────────────────────────────────────────────────── */
  .page-header {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 2rem;
    flex-wrap: wrap;
  }

  .page-title {
    font-family: var(--font-display);
    font-size: 1.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    background: linear-gradient(
      135deg,
      var(--emerald) 0%,
      var(--emerald-light) 50%,
      var(--gold) 100%
    );
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin: 0;
    line-height: 1.2;
  }

  .page-subtitle {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0.25rem 0 0;
    font-weight: 400;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  /* ── Month Navigation ───────────────────────────────────────────────────── */
  .month-nav {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    padding: 0.25rem;
  }

  .month-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .month-btn:hover:not(:disabled) {
    background: var(--surface-raised);
    color: var(--text-primary);
  }

  .month-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .month-label {
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--text-primary);
    min-width: 120px;
    text-align: center;
    letter-spacing: 0.02em;
  }

  /* ── Add Button ─────────────────────────────────────────────────────────── */
  .add-btn {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    background: linear-gradient(135deg, var(--emerald-dim), rgba(52, 211, 153, 0.2));
    border: 1px solid rgba(52, 211, 153, 0.3);
    border-radius: 10px;
    color: var(--emerald);
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.25s;
    letter-spacing: 0.02em;
  }

  .add-btn:hover {
    background: linear-gradient(135deg, rgba(52, 211, 153, 0.25), rgba(52, 211, 153, 0.15));
    border-color: rgba(52, 211, 153, 0.5);
    box-shadow: 0 0 20px rgba(52, 211, 153, 0.15);
    transform: translateY(-1px);
  }

  /* ── Loading State ──────────────────────────────────────────────────────── */
  .loading-state {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 6rem 2rem;
    gap: 1.5rem;
  }

  .crystal-loader {
    display: flex;
    gap: 0.5rem;
  }

  .loader-facet {
    width: 12px;
    height: 12px;
    background: var(--emerald);
    clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
    animation: loader-pulse 1.4s ease-in-out infinite;
  }

  .loader-facet:nth-child(2) {
    animation-delay: 0.2s;
    background: var(--gold);
  }

  .loader-facet:nth-child(3) {
    animation-delay: 0.4s;
    background: var(--ruby);
  }

  @keyframes loader-pulse {
    0%,
    100% {
      opacity: 0.3;
      transform: scale(0.8);
    }
    50% {
      opacity: 1;
      transform: scale(1.2);
    }
  }

  .loading-text {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-style: italic;
    letter-spacing: 0.03em;
  }

  /* ── Empty State ────────────────────────────────────────────────────────── */
  .empty-state {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 5rem 2rem;
    gap: 1rem;
  }

  .empty-gem {
    margin-bottom: 0.5rem;
    animation: gem-float 4s ease-in-out infinite;
  }

  @keyframes gem-float {
    0%,
    100% {
      transform: translateY(0) rotate(0deg);
    }
    50% {
      transform: translateY(-8px) rotate(2deg);
    }
  }

  .empty-title {
    font-family: var(--font-display);
    font-size: 1.35rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: 0.04em;
  }

  .empty-desc {
    font-size: 0.9rem;
    color: var(--text-secondary);
    max-width: 320px;
    line-height: 1.6;
    margin: 0;
  }

  .empty-cta {
    margin-top: 0.5rem;
    padding: 0.65rem 1.5rem;
    font-size: 0.9rem;
  }

  /* ── Overview Card ──────────────────────────────────────────────────────── */
  .overview-card {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 2rem;
    padding: 1.75rem;
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: 20px;
    margin-bottom: 2rem;
    overflow: hidden;
    flex-wrap: wrap;
    justify-content: center;
  }

  .overview-card::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 20px;
    background: linear-gradient(135deg, var(--ring-fill-raw) 0%, transparent 60%);
    opacity: 0.04;
    pointer-events: none;
  }

  .overview-card.status-emerald {
    --ring-track: var(--emerald);
    --ring-fill: var(--emerald);
    --ring-fill-raw: var(--emerald);
    border-color: rgba(52, 211, 153, 0.15);
  }

  .overview-card.status-gold {
    --ring-track: var(--gold);
    --ring-fill: var(--gold);
    --ring-fill-raw: var(--gold);
    border-color: rgba(251, 191, 36, 0.15);
  }

  .overview-card.status-ruby {
    --ring-track: var(--ruby);
    --ring-fill: var(--ruby);
    --ring-fill-raw: var(--ruby);
    border-color: rgba(248, 113, 113, 0.15);
  }

  /* ── Ring Visualization ─────────────────────────────────────────────────── */
  .overview-ring-container {
    position: relative;
    width: 140px;
    height: 140px;
    flex-shrink: 0;
  }

  .overview-ring {
    width: 100%;
    height: 100%;
    transform: rotate(0deg);
  }

  .ring-arc {
    filter: drop-shadow(0 0 6px var(--ring-fill));
    animation: arc-draw 1s ease-out forwards;
    stroke-dasharray: 400;
    stroke-dashoffset: 400;
  }

  @keyframes arc-draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  .ring-arc-over {
    animation: arc-pulse 2s ease-in-out infinite;
  }

  @keyframes arc-pulse {
    0%,
    100% {
      opacity: 0.3;
    }
    50% {
      opacity: 0.6;
    }
  }

  .ring-center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }

  .ring-percent {
    font-family: var(--font-display);
    font-size: 1.6rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
  }

  .ring-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-top: 0.2rem;
  }

  /* ── Overview Details ───────────────────────────────────────────────────── */
  .overview-details {
    display: flex;
    gap: 1.5rem;
    align-items: center;
    flex-wrap: wrap;
    flex: 1;
    min-width: 0;
    justify-content: center;
  }

  .overview-stat {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 100px;
    text-align: center;
  }

  .stat-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    font-weight: 500;
  }

  .stat-value {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .stat-value.spent {
    color: var(--text-secondary);
  }

  .stat-value.over-budget {
    color: var(--ruby);
  }

  .overview-divider {
    width: 1px;
    height: 40px;
    background: var(--border-subtle);
    flex-shrink: 0;
  }

  /* ── Budget Cards Grid ──────────────────────────────────────────────────── */
  .budgets-grid {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1rem;
  }

  /* ── Budget Card ────────────────────────────────────────────────────────── */
  .budget-card {
    position: relative;
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: 16px;
    padding: 1.25rem;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.22, 1, 0.36, 1);
    overflow: hidden;
    animation: card-enter 0.4s ease-out both;
    animation-delay: var(--card-delay);
  }

  @keyframes card-enter {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .budget-card:hover {
    border-color: var(--border-interactive);
    transform: translateY(-2px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  .budget-card.status-emerald:hover {
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.3),
      0 0 20px var(--emerald-glow);
  }

  .budget-card.status-gold:hover {
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.3),
      0 0 20px var(--gold-glow);
  }

  .budget-card.status-ruby {
    border-color: rgba(248, 113, 113, 0.15);
  }

  .budget-card.status-ruby:hover {
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.3),
      0 0 20px var(--ruby-glow);
  }

  .budget-card::after {
    content: '';
    position: absolute;
    top: 0;
    left: 10%;
    right: 10%;
    height: 1px;
    border-radius: 1px;
    background: linear-gradient(90deg, transparent, var(--amethyst, #e8b94a), transparent);
    opacity: 0.4;
    transition: opacity 0.3s ease;
  }

  .budget-card:hover::after {
    opacity: 0.8;
  }

  .budget-card.status-emerald::after {
    background: linear-gradient(90deg, transparent, var(--emerald, #34d399), transparent);
  }

  .budget-card.status-gold::after {
    background: linear-gradient(90deg, transparent, var(--gold, #fbbf24), transparent);
  }

  .budget-card.status-ruby::after {
    background: linear-gradient(90deg, transparent, var(--ruby, #f87171), transparent);
  }

  /* ── Card Shimmer ───────────────────────────────────────────────────────── */
  .card-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      135deg,
      transparent 30%,
      rgba(255, 255, 255, 0.015) 45%,
      rgba(255, 255, 255, 0.03) 50%,
      rgba(255, 255, 255, 0.015) 55%,
      transparent 70%
    );
    pointer-events: none;
    transition: opacity 0.3s;
    opacity: 0;
  }

  .budget-card:hover .card-shimmer {
    opacity: 1;
  }

  /* ── Card Top Row ───────────────────────────────────────────────────────── */
  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .card-category {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .cat-icon {
    font-size: 1.4rem;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--surface-raised);
    border-radius: 10px;
    border: 1px solid var(--border-subtle);
  }

  .cat-info {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .cat-name {
    font-weight: 600;
    font-size: 0.95rem;
    color: var(--text-primary);
  }

  .cat-period {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: capitalize;
    letter-spacing: 0.04em;
  }

  .card-edit-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
    opacity: 0;
  }

  .budget-card:hover .card-edit-btn {
    opacity: 1;
  }

  .card-edit-btn:hover {
    background: var(--surface-raised);
    border-color: var(--border-interactive);
    color: var(--text-primary);
  }

  /* ── Progress Bar ───────────────────────────────────────────────────────── */
  .progress-track {
    position: relative;
    height: 8px;
    background: var(--surface-raised);
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 0.85rem;
  }

  .progress-fill {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    border-radius: 10px;
    transition: width 0.8s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .status-emerald .progress-fill {
    background: linear-gradient(90deg, var(--emerald-dim), var(--emerald));
    box-shadow: 0 0 8px var(--emerald-glow);
  }

  .status-gold .progress-fill {
    background: linear-gradient(90deg, var(--gold-dim), var(--gold));
    box-shadow: 0 0 8px var(--gold-glow);
  }

  .status-ruby .progress-fill {
    background: linear-gradient(90deg, var(--ruby-dim), var(--ruby));
    box-shadow: 0 0 8px var(--ruby-glow);
  }

  .progress-overflow {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: var(--ruby);
    opacity: 0.4;
    border-radius: 10px;
    animation: overflow-pulse 2s ease-in-out infinite;
  }

  @keyframes overflow-pulse {
    0%,
    100% {
      opacity: 0.25;
    }
    50% {
      opacity: 0.5;
    }
  }

  /* ── Card Amounts ───────────────────────────────────────────────────────── */
  .card-amounts {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .amounts-row {
    display: flex;
    align-items: baseline;
    gap: 0.35rem;
  }

  .amount-spent {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .amount-sep {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .amount-budgeted {
    font-size: 0.9rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .amounts-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .amount-remaining {
    font-size: 0.78rem;
    color: var(--text-secondary);
    font-weight: 400;
  }

  .amount-remaining.over-budget {
    color: var(--ruby);
    font-weight: 500;
  }

  .amount-percent {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 500;
  }

  /* ── Card Breakdown ─────────────────────────────────────────────────────── */
  .card-breakdown {
    animation: breakdown-enter 0.3s ease-out;
  }

  @keyframes breakdown-enter {
    from {
      opacity: 0;
      max-height: 0;
    }
    to {
      opacity: 1;
      max-height: 500px;
    }
  }

  .breakdown-divider {
    height: 1px;
    background: var(--border-subtle);
    margin: 1rem 0 0.75rem;
  }

  .breakdown-empty {
    font-size: 0.8rem;
    color: var(--text-muted);
    text-align: center;
    padding: 0.5rem 0;
    font-style: italic;
    margin: 0;
  }

  .breakdown-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .breakdown-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.35rem 0;
    font-size: 0.8rem;
  }

  .breakdown-desc {
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }

  .breakdown-right {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    flex-shrink: 0;
  }

  .breakdown-amount {
    font-weight: 500;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .breakdown-date {
    color: var(--text-muted);
    font-size: 0.72rem;
    min-width: 50px;
    text-align: right;
  }

  .breakdown-more {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-align: center;
    padding: 0.35rem 0;
    font-style: italic;
  }

  /* ── Modal ──────────────────────────────────────────────────────────────── */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(4, 6, 10, 0.8);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1.5rem;
    animation: backdrop-in 0.2s ease-out;
  }

  @keyframes backdrop-in {
    from {
      opacity: 0;
    }
  }

  .modal-panel {
    position: relative;
    width: 100%;
    max-width: 440px;
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: 20px;
    padding: 2rem 1.75rem;
    animation: panel-in 0.3s cubic-bezier(0.22, 1, 0.36, 1);
    overflow: hidden;
  }

  @keyframes panel-in {
    from {
      opacity: 0;
      transform: translateY(20px) scale(0.97);
    }
  }

  .modal-crystal-edge {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, var(--emerald), var(--gold), var(--emerald));
    opacity: 0.6;
  }

  .modal-title {
    font-family: var(--font-display);
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 1.5rem;
    letter-spacing: 0.04em;
  }

  /* ── Form Fields ────────────────────────────────────────────────────────── */
  .modal-form {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .field-label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .field-select,
  .field-input {
    background: var(--surface-raised);
    border: 1px solid var(--border-interactive);
    border-radius: 10px;
    padding: 0.65rem 0.85rem;
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.9rem;
    color: var(--text-primary);
    outline: none;
    transition:
      border-color 0.2s,
      box-shadow 0.2s;
    width: 100%;
  }

  .field-select:focus,
  .field-input:focus {
    border-color: var(--emerald);
    box-shadow: 0 0 0 3px var(--emerald-glow);
  }

  .field-select option {
    background: var(--surface-raised);
    color: var(--text-primary);
  }

  .field-currency-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .currency-symbol {
    position: absolute;
    left: 0.85rem;
    color: var(--text-muted);
    font-weight: 500;
    pointer-events: none;
  }

  .currency-input {
    padding-left: 1.75rem;
  }

  /* ── Toggle Group ───────────────────────────────────────────────────────── */
  .toggle-group {
    display: flex;
    gap: 0;
    background: var(--surface-raised);
    border-radius: 10px;
    border: 1px solid var(--border-interactive);
    overflow: hidden;
  }

  .toggle-option {
    flex: 1;
    padding: 0.55rem 1rem;
    background: transparent;
    border: none;
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.85rem;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
    font-weight: 400;
  }

  .toggle-option.active {
    background: rgba(52, 211, 153, 0.12);
    color: var(--emerald);
    font-weight: 500;
  }

  .toggle-option:not(.active):hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.02);
  }

  /* ── Switch Toggles ─────────────────────────────────────────────────────── */
  .toggles-row {
    display: flex;
    gap: 1.5rem;
  }

  .switch-field {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .switch-label {
    font-size: 0.82rem;
    color: var(--text-secondary);
    font-weight: 400;
  }

  .switch-track {
    position: relative;
    width: 40px;
    height: 22px;
    background: var(--surface-raised);
    border: 1px solid var(--border-interactive);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.25s;
    padding: 0;
  }

  .switch-track.on {
    background: rgba(52, 211, 153, 0.2);
    border-color: rgba(52, 211, 153, 0.4);
  }

  .switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--text-muted);
    transition: all 0.25s;
  }

  .switch-track.on .switch-thumb {
    left: 20px;
    background: var(--emerald);
    box-shadow: 0 0 6px var(--emerald-glow);
  }

  /* ── Modal Actions ──────────────────────────────────────────────────────── */
  .modal-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }

  .actions-right {
    display: flex;
    gap: 0.5rem;
    margin-left: auto;
  }

  .btn-primary {
    padding: 0.55rem 1.25rem;
    background: linear-gradient(135deg, var(--emerald-dim), rgba(52, 211, 153, 0.25));
    border: 1px solid rgba(52, 211, 153, 0.3);
    border-radius: 10px;
    color: var(--emerald);
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    letter-spacing: 0.02em;
  }

  .btn-primary:hover:not(:disabled) {
    box-shadow: 0 0 16px var(--emerald-glow);
    transform: translateY(-1px);
  }

  .btn-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-ghost {
    padding: 0.55rem 1rem;
    background: transparent;
    border: 1px solid var(--border-interactive);
    border-radius: 10px;
    color: var(--text-secondary);
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.85rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-ghost:hover {
    background: var(--surface-raised);
    color: var(--text-primary);
  }

  .btn-ghost.danger-text {
    color: var(--ruby);
    border-color: rgba(248, 113, 113, 0.2);
  }

  .btn-ghost.danger-text:hover {
    background: rgba(248, 113, 113, 0.08);
    border-color: rgba(248, 113, 113, 0.3);
  }

  .btn-danger {
    padding: 0.55rem 1.25rem;
    background: rgba(248, 113, 113, 0.12);
    border: 1px solid rgba(248, 113, 113, 0.3);
    border-radius: 10px;
    color: var(--ruby);
    font-family: var(
      --font-body,
      'Raleway',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-danger:hover {
    background: rgba(248, 113, 113, 0.2);
    box-shadow: 0 0 16px var(--ruby-glow);
  }

  /* ── Responsive ─────────────────────────────────────────────────────────── */
  @media (max-width: 640px) {
    .budgets-page {
      padding: 1rem;
      padding-bottom: 5rem;
    }

    .page-header {
      flex-direction: column;
      gap: 0.75rem;
    }

    .header-actions {
      width: 100%;
      justify-content: space-between;
    }

    .month-label {
      min-width: 90px;
      font-size: 0.75rem;
    }

    .overview-card {
      flex-direction: column;
      padding: 1.25rem;
      gap: 1.25rem;
    }

    .overview-ring-container {
      width: 120px;
      height: 120px;
    }

    .overview-details {
      flex-direction: column;
      gap: 0.75rem;
    }

    .overview-divider {
      width: 60px;
      height: 1px;
    }

    .budgets-grid {
      grid-template-columns: 1fr;
    }

    .modal-panel {
      padding: 1.5rem 1.25rem;
      border-radius: 16px;
    }

    .page-title {
      font-size: 1.5rem;
    }
  }

  @media (max-width: 380px) {
    .toggles-row {
      flex-direction: column;
      gap: 0.75rem;
    }

    .add-btn {
      font-size: 0.8rem;
      padding: 0.45rem 0.85rem;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     REDUCED MOTION
     ═══════════════════════════════════════════════════════════════════════════ */

  @media (prefers-reduced-motion: reduce) {
    .budget-card {
      animation: none;
      transition: none;
    }

    .progress-fill {
      transition: none;
    }

    .progress-overflow {
      animation: none;
    }
  }
</style>
