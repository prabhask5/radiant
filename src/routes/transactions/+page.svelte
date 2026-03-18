<!--
  @fileoverview Transactions ledger page — browse, search, filter, and
  edit all financial transactions with gem-themed crystalline UI.

  Features:
    - Month-based navigation with prev/next arrows
    - Full-text search across description & counterparty
    - Multi-filter bar (account, category, status, date range)
    - Summary strip (income / expenses / net / count)
    - Date-grouped transaction list with expand-to-edit detail panels
    - Loading skeleton with prismatic shimmer
    - Empty state with gem-themed messaging
    - Load-more pagination
-->
<script lang="ts">
  /**
   * @fileoverview Transactions page script — filtering, grouping, pagination,
   * inline editing, and reactive data derivations.
   */

  // ===========================================================================
  //                                IMPORTS
  // ===========================================================================

  import { onMount } from 'svelte';
  import {
    transactionsStore,
    accountsStore,
    categoriesStore,
    enrollmentsStore
  } from '$lib/stores/data';
  import type { Account, Category, TellerEnrollment } from '$lib/types';
  import {
    formatCurrency,
    formatDateGroup,
    amountClass,
    isInflow,
    getCurrentMonth,
    formatMonth
  } from '$lib/utils/currency';
  import { remoteChangeAnimation, truncateTooltip } from 'stellar-drive/actions';
  import { debug } from 'stellar-drive/utils';
  import { autoSyncStaleEnrollments } from '$lib/teller/autoSync';
  import { categorizeTransaction } from '$lib/ml/categorizer';
  import { categorizer } from '$lib/ml/classifier';

  // ===========================================================================
  //                           COMPONENT STATE
  // ===========================================================================

  /* ── Data loading ── */
  let isLoading = $state(true);
  let hasLoaded = $state(false);

  /* ── Month navigation ── */
  let selectedMonth = $state(getCurrentMonth());

  /* ── Search & filters ── */
  let searchQuery = $state('');
  let accountFilter = $state('all');
  let categoryFilter = $state('all');
  let statusFilter = $state<'all' | 'posted' | 'pending'>('all');

  /* ── Pagination ── */
  const PAGE_SIZE = 50;
  let visibleCount = $state(PAGE_SIZE);

  /* ── Expanded transaction detail ── */
  let expandedId = $state<string | null>(null);

  /* ── Inline editing state ── */
  let editingNotes = $state<Record<string, string>>({});
  let editingCategory = $state<Record<string, string>>({});
  let savingField = $state<string | null>(null);

  /* ── Multi-select ── */
  let selectionMode = $state(false);
  let selectedIds = $state<Set<string>>(new Set());

  /* ── Auto-sync ── */
  let autoSyncBanner = $state<string | null>(null);
  let autoSyncBannerFading = $state(false);

  /* ── Categorization toast ── */
  let catToast = $state<{ message: string; type: 'success' | 'info' } | null>(null);
  let catToastFading = $state(false);
  let catToastTimer: ReturnType<typeof setTimeout> | null = null;

  function showCatToast(message: string, type: 'success' | 'info' = 'success') {
    if (catToastTimer) clearTimeout(catToastTimer);
    catToastFading = false;
    catToast = { message, type };
    catToastTimer = setTimeout(() => {
      catToastFading = true;
      setTimeout(() => {
        catToast = null;
        catToastFading = false;
      }, 500);
    }, 3000);
  }

  /* ── Page entrance ── */
  let mounted = $state(false);

  // ===========================================================================
  //                          DERIVED DATA
  // ===========================================================================

  /** All transactions from the store. */
  const allTransactions = $derived($transactionsStore ?? []);

  /** All accounts from the store, keyed by ID for fast lookup. */
  const accountsById = $derived(
    ($accountsStore ?? []).reduce(
      (map: Record<string, Account>, a: Account) => {
        map[a.id] = a;
        return map;
      },
      {} as Record<string, Account>
    )
  );

  /** All categories from the store, keyed by ID for fast lookup. */
  const categoriesById = $derived(
    ($categoriesStore ?? []).reduce(
      (map: Record<string, Category>, c: Category) => {
        map[c.id] = c;
        return map;
      },
      {} as Record<string, Category>
    )
  );

  /** Sorted categories list for the filter and re-categorize dropdowns. */
  const sortedCategories = $derived(
    [...($categoriesStore ?? [])]
      .filter((c: Category) => !c.deleted)
      .sort((a: Category, b: Category) => a.name.localeCompare(b.name))
  );

  /** Sorted accounts list for the filter dropdown. */
  const sortedAccounts = $derived(
    [...($accountsStore ?? [])].sort((a: Account, b: Account) => a.name.localeCompare(b.name))
  );

  /**
   * Parse the selected month into year/month start and end date strings
   * for filtering transactions by month.
   */
  const monthRange = $derived.by(() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
  });

  /**
   * Filtered transactions based on all active filters.
   * Sorted by date descending, then by amount descending within the same date.
   */
  const filteredTransactions = $derived.by(() => {
    const query = searchQuery.toLowerCase().trim();
    const rangeStart = monthRange.start;
    const rangeEnd = monthRange.end;

    return allTransactions
      .filter((t) => {
        // Date range
        if (t.date < rangeStart || t.date > rangeEnd) return false;

        // Account filter
        if (accountFilter !== 'all' && t.account_id !== accountFilter) return false;

        // Category filter
        if (categoryFilter !== 'all') {
          if (categoryFilter === 'uncategorized') {
            if (t.category_id) return false;
          } else if (t.category_id !== categoryFilter) {
            return false;
          }
        }

        // Status filter
        if (statusFilter !== 'all' && t.status !== statusFilter) return false;

        // Search query
        if (query) {
          const desc = (t.description || '').toLowerCase();
          const counter = (t.counterparty_name || '').toLowerCase();
          if (!desc.includes(query) && !counter.includes(query)) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const dateCmp = b.date.localeCompare(a.date);
        if (dateCmp !== 0) return dateCmp;
        return Math.abs(parseFloat(b.amount)) - Math.abs(parseFloat(a.amount));
      });
  });

  /** Transactions limited to the current visible page. */
  const visibleTransactions = $derived(filteredTransactions.slice(0, visibleCount));

  /** Whether there are more transactions to show. */
  const hasMore = $derived(visibleCount < filteredTransactions.length);

  /**
   * Group visible transactions by date for rendering with date headers.
   */
  const groupedTransactions = $derived.by(() => {
    const groups: Array<{ date: string; label: string; transactions: typeof visibleTransactions }> =
      [];
    let currentDate = '';
    let currentGroup: (typeof groups)[number] | null = null;

    for (const t of visibleTransactions) {
      if (t.date !== currentDate) {
        currentDate = t.date;
        currentGroup = {
          date: currentDate,
          label: formatDateGroup(currentDate),
          transactions: []
        };
        groups.push(currentGroup);
      }
      currentGroup!.transactions.push(t);
    }

    return groups;
  });

  /** Summary statistics for the filtered transactions. */
  const summary = $derived.by(() => {
    let inflow = 0;
    let outflow = 0;
    let count = 0;

    for (const t of filteredTransactions) {
      if (t.is_excluded) continue;
      const amt = parseFloat(t.amount) || 0;
      if (amt === 0) {
        count++;
        continue;
      }
      const acctType = accountsById[t.account_id]?.type ?? 'credit';
      if (isInflow(amt, acctType)) {
        inflow += Math.abs(amt);
      } else {
        outflow += Math.abs(amt);
      }
      count++;
    }

    return {
      inflow,
      outflow,
      net: inflow - outflow,
      count
    };
  });

  // ===========================================================================
  //                          LIFECYCLE
  // ===========================================================================

  onMount(async () => {
    try {
      await Promise.all([
        transactionsStore.refresh(),
        accountsStore.refresh(),
        categoriesStore.refresh(),
        enrollmentsStore.refresh()
      ]);
    } finally {
      isLoading = false;
      hasLoaded = true;
    }

    // Trigger entrance animation after a tick
    requestAnimationFrame(() => {
      mounted = true;
    });

    // Auto-sync stale Teller enrollments in the background
    const allEnrollments = ($enrollmentsStore ?? []) as TellerEnrollment[];
    autoSyncStaleEnrollments(allEnrollments, (id, status) =>
      enrollmentsStore.updateStatus(id, status)
    )
      .then(async (newCount) => {
        if (newCount > 0) {
          await Promise.all([transactionsStore.refresh(), accountsStore.refresh()]);
          autoSyncBanner = `${newCount} new transaction${newCount !== 1 ? 's' : ''} synced`;
          // Auto-dismiss after 4 seconds with fade
          setTimeout(() => {
            autoSyncBannerFading = true;
            setTimeout(() => {
              autoSyncBanner = null;
              autoSyncBannerFading = false;
            }, 500);
          }, 4000);
        }
      })
      .catch((err) => {
        debug('warn', '[TRANSACTIONS] Background auto-sync failed:', err);
      });
  });

  // ===========================================================================
  //                          MONTH NAVIGATION
  // ===========================================================================

  /** Navigate to the previous month. */
  function prevMonth() {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    selectedMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    visibleCount = PAGE_SIZE;
    expandedId = null;
  }

  /** Navigate to the next month. */
  function nextMonth() {
    const [y, m] = selectedMonth.split('-').map(Number);
    const d = new Date(y, m, 1);
    selectedMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    visibleCount = PAGE_SIZE;
    expandedId = null;
  }

  /** Whether the selected month is the current month (disable "next"). */
  const isCurrentMonth = $derived(selectedMonth === getCurrentMonth());

  // ===========================================================================
  //                       INTERACTION HANDLERS
  // ===========================================================================

  /** Toggle the expanded detail panel for a transaction row. */
  function toggleExpand(id: string) {
    if (expandedId === id) {
      expandedId = null;
    } else {
      expandedId = id;
      // Pre-populate editing fields
      const t = allTransactions.find((tx) => tx.id === id);
      if (t) {
        editingNotes[id] = t.notes ?? '';
        editingCategory[id] = t.category_id ?? '';
      }
    }
  }

  /** Toggle selection of a transaction. */
  function toggleSelect(id: string, e?: Event) {
    e?.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
  }

  /** Select all visible transactions. */
  function selectAllVisible() {
    selectedIds = new Set(visibleTransactions.map((t) => t.id));
  }

  /** Clear selection and exit selection mode. */
  function clearSelection() {
    selectedIds = new Set();
    selectionMode = false;
  }

  /** Bulk delete all selected transactions. */
  async function bulkDeleteSelected() {
    const ids = [...selectedIds];
    debug('log', '[TRANSACTIONS] bulkDeleteSelected —', ids.length, 'transactions');
    clearSelection();
    await transactionsStore.bulkDelete(ids);
  }

  /** Load more transactions. */
  function loadMore() {
    visibleCount += PAGE_SIZE;
  }

  /** Clear all filters and search. */
  function clearFilters() {
    searchQuery = '';
    accountFilter = 'all';
    categoryFilter = 'all';
    statusFilter = 'all';
    visibleCount = PAGE_SIZE;
  }

  /** Whether any filter is active beyond the default month view. */
  const hasActiveFilters = $derived(
    searchQuery !== '' ||
      accountFilter !== 'all' ||
      categoryFilter !== 'all' ||
      statusFilter !== 'all'
  );

  // ===========================================================================
  //                       INLINE EDITING
  // ===========================================================================

  /**
   * Tokenize a transaction description for similarity matching.
   * Strips numbers, special chars, lowercases, splits into unique tokens.
   * "STARBUCKS #10432 SEATTLE WA" → ["starbucks", "seattle", "wa"]
   */
  function tokenizeDesc(desc: string): Set<string> {
    const tokens = desc
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    return new Set(tokens);
  }

  /**
   * Compute similarity between two token sets using overlap coefficient:
   * |intersection| / min(|A|, |B|). Returns 1.0 when one set is a subset
   * of the other (e.g. "starbucks" matches "starbucks seattle wa").
   */
  function descSimilarity(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let overlap = 0;
    const smaller = a.size <= b.size ? a : b;
    const larger = a.size <= b.size ? b : a;
    for (const token of smaller) {
      if (larger.has(token)) overlap++;
    }
    return overlap / smaller.size;
  }

  /** Minimum similarity for fuzzy matching (0–1 scale). */
  const SIMILARITY_THRESHOLD = 0.5;

  /**
   * Find the category for a description by fuzzy-matching against all
   * categorized transactions. Returns the best match above the threshold,
   * preferring manual categorizations over auto.
   */
  function lookupCategoryByDescription(
    description: string,
    txns: typeof allTransactions
  ): string | null {
    const tokens = tokenizeDesc(description);
    if (tokens.size === 0) return null;

    let bestCatId: string | null = null;
    let bestScore = 0;
    let bestIsManual = false;

    for (const t of txns) {
      if (!t.category_id || t.deleted) continue;
      const tTokens = tokenizeDesc(t.description);
      const sim = descSimilarity(tokens, tTokens);
      if (sim < SIMILARITY_THRESHOLD) continue;

      const isManual = !t.is_auto_categorized;
      // Prefer: higher similarity, then manual over auto
      if (sim > bestScore || (sim === bestScore && isManual && !bestIsManual)) {
        bestScore = sim;
        bestCatId = t.category_id;
        bestIsManual = isManual;
      }
    }

    return bestCatId;
  }

  /** Save a category change for a transaction. */
  async function saveCategory(transactionId: string) {
    savingField = `cat-${transactionId}`;
    const newCat = editingCategory[transactionId] || null;
    debug('log', '[TRANSACTIONS] saveCategory —', transactionId, '→', newCat);
    try {
      const propagatedCount = await transactionsStore.updateCategory(transactionId, newCat);
      await transactionsStore.refresh();

      if (propagatedCount > 0) {
        showCatToast(
          `Updated ${propagatedCount} similar transaction${propagatedCount !== 1 ? 's' : ''}`
        );
      }
    } finally {
      savingField = null;
    }
  }

  /** Save notes for a transaction. */
  async function saveNotes(transactionId: string) {
    savingField = `notes-${transactionId}`;
    debug('log', '[TRANSACTIONS] saveNotes —', transactionId);
    try {
      await transactionsStore.updateNotes(transactionId, editingNotes[transactionId] ?? '');
      await transactionsStore.refresh();
    } finally {
      savingField = null;
    }
  }

  /** Save an edited description. */
  async function saveDescription(transactionId: string, value: string) {
    const trimmed = value.trim();
    const t = allTransactions.find((tx) => tx.id === transactionId);
    if (!trimmed || trimmed === t?.description) return;
    savingField = `desc-${transactionId}`;
    debug('log', '[TRANSACTIONS] saveDescription —', transactionId, '→', trimmed);
    try {
      await transactionsStore.updateDescription(transactionId, trimmed);
    } finally {
      savingField = null;
    }
  }

  /** Save an edited date. */
  async function saveDate(transactionId: string, value: string) {
    if (!value) return;
    const t = allTransactions.find((tx) => tx.id === transactionId);
    if (value === t?.date) return;
    savingField = `date-${transactionId}`;
    debug('log', '[TRANSACTIONS] saveDate —', transactionId, '→', value);
    try {
      await transactionsStore.updateDate(transactionId, value);
    } finally {
      savingField = null;
    }
  }

  /** Delete a single transaction from the expanded detail panel. */
  async function deleteSingle(transactionId: string) {
    debug('log', '[TRANSACTIONS] deleteSingle —', transactionId);
    expandedId = null;
    await transactionsStore.deleteTransaction(transactionId);
  }

  /** Re-run ML categorization on a single transaction. */
  async function recategorize(transactionId: string) {
    const t = allTransactions.find((tx) => tx.id === transactionId);
    if (!t) return;
    savingField = `recat-${transactionId}`;
    debug('log', '[TRANSACTIONS] recategorize —', transactionId);
    try {
      let categoryId: string | null = null;

      // Layer 0: Description match — check if any other transaction with the
      // same normalized description has already been categorized by the user.
      // This is the most reliable signal and works with a single example.
      categoryId = lookupCategoryByDescription(t.description, allTransactions);

      // Layer 1: ML classifier as fallback
      if (!categoryId) {
        const categorized = allTransactions.filter((tx) => tx.category_id !== null && !tx.deleted);
        if (categorized.length > 0) {
          categorizer.train(
            categorized.map((tx) => ({
              description: tx.description,
              category_id: tx.category_id!
            }))
          );
          categorizer.save();
        } else {
          categorizer.load();
        }

        const result = categorizeTransaction(t.description);
        if (result) {
          categoryId = result.categoryId;
        }
      }

      if (categoryId) {
        editingCategory[transactionId] = categoryId;
        await transactionsStore.updateCategory(transactionId, categoryId);
        await transactionsStore.refresh();
        const cat = categoriesById[categoryId];
        showCatToast(`Categorized as ${cat?.icon ?? ''} ${cat?.name ?? 'Unknown'}`);
      } else {
        showCatToast('Could not auto-categorize — try setting it manually', 'info');
      }
    } finally {
      savingField = null;
    }
  }

  /** Toggle the excluded flag on a transaction. */
  async function toggleExcluded(transactionId: string, currentValue: boolean) {
    savingField = `excl-${transactionId}`;
    debug('log', '[TRANSACTIONS] toggleExcluded —', transactionId, '→', !currentValue);
    try {
      await transactionsStore.toggleExcluded(transactionId, !currentValue);
      await transactionsStore.refresh();
    } finally {
      savingField = null;
    }
  }

  // ===========================================================================
  //                        HELPERS
  // ===========================================================================

  /** Get category info for a transaction, if it has one. */
  function getCategoryForTransaction(categoryId: string | null | undefined) {
    if (!categoryId) return null;
    return categoriesById[categoryId] ?? null;
  }

  /** Get account name for a transaction. */
  function getAccountName(accountId: string): string {
    const acct = accountsById[accountId];
    return acct ? acct.name : 'Unknown';
  }

  /** Get a short institution + account label for the badge. */
  function getAccountBadge(accountId: string): string {
    const acct = accountsById[accountId];
    if (!acct) return '---';
    const last4 = acct.last_four ? ` ••${acct.last_four}` : '';
    return `${acct.name}${last4}`;
  }
</script>

<svelte:head>
  <title>Transactions - Radiant Finance</title>
</svelte:head>

<!-- ========================================================================= -->
<!--                           PAGE TEMPLATE                                   -->
<!-- ========================================================================= -->

<div class="txn-page" class:mounted>
  <!-- ─── Header ─── -->
  <header class="page-header">
    <div class="title-gem">
      <div class="title-flare f1"></div>
      <div class="title-flare f2"></div>
      <h1 class="page-title">Transactions</h1>
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

  <!-- ─── Search & Filter Bar ─── -->
  <div class="filter-bar">
    <div class="search-row">
      <div class="search-field">
        <svg class="search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5.25" stroke="currentColor" stroke-width="1.3" />
          <path d="M11 11L14 14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
        </svg>
        <input
          type="text"
          class="search-input"
          placeholder="Search transactions..."
          bind:value={searchQuery}
        />
        {#if searchQuery}
          <button class="search-clear" onclick={() => (searchQuery = '')} aria-label="Clear search">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M4 4L10 10M10 4L4 10"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
              />
            </svg>
          </button>
        {/if}
      </div>

      {#if hasActiveFilters}
        <button class="clear-filters-btn" onclick={clearFilters}> Clear all </button>
      {/if}
    </div>

    <div class="filter-row">
      <select class="filter-select" bind:value={accountFilter} aria-label="Filter by account">
        <option value="all">All accounts</option>
        {#each sortedAccounts as account (account.id)}
          <option value={account.id}>{account.name}</option>
        {/each}
      </select>

      <select class="filter-select" bind:value={categoryFilter} aria-label="Filter by category">
        <option value="all">All categories</option>
        <option value="uncategorized">Uncategorized</option>
        {#each sortedCategories as cat (cat.id)}
          <option value={cat.id}>{cat.icon} {cat.name}</option>
        {/each}
      </select>

      <select
        class="filter-select filter-status"
        bind:value={statusFilter}
        aria-label="Filter by status"
      >
        <option value="all">All status</option>
        <option value="posted">Posted</option>
        <option value="pending">Pending</option>
      </select>

      <button
        class="select-mode-btn"
        class:active={selectionMode}
        onclick={() => {
          if (selectionMode) clearSelection();
          else selectionMode = true;
        }}
        aria-label={selectionMode ? 'Exit selection' : 'Select transactions'}
      >
        {#if selectionMode}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 4L12 12M12 4L4 12"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect
              x="2"
              y="2"
              width="5"
              height="5"
              rx="1"
              stroke="currentColor"
              stroke-width="1.3"
            />
            <rect
              x="9"
              y="2"
              width="5"
              height="5"
              rx="1"
              stroke="currentColor"
              stroke-width="1.3"
            />
            <rect
              x="2"
              y="9"
              width="5"
              height="5"
              rx="1"
              stroke="currentColor"
              stroke-width="1.3"
            />
            <rect
              x="9"
              y="9"
              width="5"
              height="5"
              rx="1"
              stroke="currentColor"
              stroke-width="1.3"
            />
          </svg>
        {/if}
      </button>
    </div>
  </div>

  <!-- ─── Summary Strip ─── -->
  {#if hasLoaded && filteredTransactions.length > 0}
    <div class="summary-strip">
      <div class="summary-item inflow">
        <span class="summary-label">In</span>
        <span class="summary-value">{formatCurrency(summary.inflow)}</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-item outflow">
        <span class="summary-label">Out</span>
        <span class="summary-value">{formatCurrency(summary.outflow)}</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-item {summary.net >= 0 ? 'net-positive' : 'net-negative'}">
        <span class="summary-label">Net</span>
        <span class="summary-value">{formatCurrency(Math.abs(summary.net))}</span>
      </div>
      <div class="summary-divider"></div>
      <div class="summary-item count">
        <span class="summary-label">Count</span>
        <span class="summary-value">{summary.count.toLocaleString()}</span>
      </div>
    </div>
  {/if}

  <!-- ─── Loading Skeleton ─── -->
  {#if isLoading}
    <div class="skeleton-list">
      {#each { length: 8 } as _, i (i)}
        <div class="skeleton-row" style="animation-delay: {i * 0.06}s">
          <div class="skeleton-dot"></div>
          <div class="skeleton-text-group">
            <div class="skeleton-line skeleton-line-primary"></div>
            <div class="skeleton-line skeleton-line-secondary"></div>
          </div>
          <div class="skeleton-amount"></div>
        </div>
      {/each}
    </div>

    <!-- ─── Empty State ─── -->
  {:else if filteredTransactions.length === 0}
    <div class="empty-state">
      <div class="empty-gem">
        <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
          <path
            d="M32 4L58 22L48 58H16L6 22L32 4Z"
            stroke="url(#emptyGrad)"
            stroke-width="1.5"
            fill="none"
          />
          <path
            d="M32 4L6 22H58L32 4Z"
            stroke="url(#emptyGrad)"
            stroke-width="1"
            opacity="0.5"
            fill="none"
          />
          <path
            d="M6 22L16 58L32 32L6 22Z"
            stroke="url(#emptyGrad)"
            stroke-width="1"
            opacity="0.3"
            fill="none"
          />
          <path
            d="M58 22L48 58L32 32L58 22Z"
            stroke="url(#emptyGrad)"
            stroke-width="1"
            opacity="0.3"
            fill="none"
          />
          <path
            d="M16 58H48L32 32L16 58Z"
            stroke="url(#emptyGrad)"
            stroke-width="1"
            opacity="0.4"
            fill="none"
          />
          <defs>
            <linearGradient id="emptyGrad" x1="6" y1="4" x2="58" y2="58">
              <stop offset="0%" stop-color="#e8b94a" />
              <stop offset="50%" stop-color="#e8c87a" />
              <stop offset="100%" stop-color="#e8b94a" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <p class="empty-title">
        {#if hasActiveFilters}
          No matching facets
        {:else}
          No transactions yet
        {/if}
      </p>
      <p class="empty-sub">
        {#if hasActiveFilters}
          Try adjusting your filters or search to reveal hidden gems.
        {:else}
          Connect an account to start tracking your financial crystals.
        {/if}
      </p>
      {#if hasActiveFilters}
        <button class="empty-action" onclick={clearFilters}>Clear filters</button>
      {/if}
    </div>

    <!-- ─── Transaction List ─── -->
  {:else}
    <div class="txn-list">
      {#each groupedTransactions as group, gi (group.date)}
        <!-- Date Group Header -->
        <div class="date-header" style="animation-delay: {gi * 0.04}s">
          <span class="date-header-text">{group.label}</span>
          <span class="date-header-line"></span>
        </div>

        <!-- Transaction Rows -->
        {#each group.transactions as txn, ti (txn.id)}
          {@const cat = getCategoryForTransaction(txn.category_id)}
          {@const amt = parseFloat(txn.amount) || 0}
          {@const acctType = accountsById[txn.account_id]?.type ?? 'credit'}
          {@const cls = amountClass(amt, acctType)}
          {@const isPending = txn.status === 'pending'}
          {@const isExpanded = expandedId === txn.id}

          <button
            class="txn-row"
            class:expanded={isExpanded}
            class:pending={isPending}
            class:excluded={txn.is_excluded}
            style="animation-delay: {(gi * 3 + ti) * 0.03}s"
            onclick={() => (selectionMode ? toggleSelect(txn.id) : toggleExpand(txn.id))}
            aria-expanded={isExpanded}
            use:remoteChangeAnimation={{ entityId: txn.id, entityType: 'transactions' }}
          >
            {#if selectionMode}
              <span
                class="select-check"
                class:checked={selectedIds.has(txn.id)}
                role="checkbox"
                aria-checked={selectedIds.has(txn.id)}
              >
                {#if selectedIds.has(txn.id)}
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M2.5 6L5 8.5L9.5 3.5"
                      stroke="currentColor"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                {/if}
              </span>
            {/if}

            <!-- Category Dot -->
            <div class="txn-dot" style="--dot-color: {cat?.color ?? '#555'}">
              {#if cat?.icon}
                <span class="txn-dot-icon">{cat.icon}</span>
              {:else}
                <span class="txn-dot-fallback"></span>
              {/if}
            </div>

            <!-- Description & Counterparty -->
            <div class="txn-info">
              <span class="txn-desc" use:truncateTooltip>
                {txn.description}
                {#if txn.is_recurring}
                  <span class="recurring-badge" title="Recurring">🔄</span>
                {/if}
              </span>
              {#if txn.counterparty_name}
                <span class="txn-counterparty">{txn.counterparty_name}</span>
              {/if}
            </div>

            <!-- Account Badge -->
            <span class="txn-account-badge">{getAccountBadge(txn.account_id)}</span>

            <!-- Status -->
            {#if isPending}
              <span class="txn-pending-dot" title="Pending"></span>
            {/if}

            <!-- Amount -->
            <span class="txn-amount {cls}">
              {#if txn.is_excluded}
                <span class="excluded-strike">{formatCurrency(Math.abs(amt))}</span>
              {:else}
                {formatCurrency(Math.abs(amt))}
              {/if}
            </span>
          </button>

          <!-- ─── Expanded Detail Panel ─── -->
          {#if isExpanded}
            <div class="txn-detail">
              <div class="detail-grid">
                <!-- Full Description -->
                <div class="detail-row detail-row-interactive">
                  <span class="detail-label">Description</span>
                  <div class="detail-control">
                    <input
                      type="text"
                      class="detail-input"
                      value={txn.description}
                      onblur={(e) => saveDescription(txn.id, (e.target as HTMLInputElement).value)}
                      onclick={(e) => e.stopPropagation()}
                    />
                    {#if savingField === `desc-${txn.id}`}
                      <span class="saving-indicator"></span>
                    {/if}
                  </div>
                </div>

                <!-- Date -->
                <div class="detail-row detail-row-interactive">
                  <span class="detail-label">Date</span>
                  <div class="detail-control">
                    <input
                      type="date"
                      class="detail-input"
                      value={txn.date}
                      onchange={(e) => saveDate(txn.id, (e.target as HTMLInputElement).value)}
                      onclick={(e) => e.stopPropagation()}
                    />
                    {#if savingField === `date-${txn.id}`}
                      <span class="saving-indicator"></span>
                    {/if}
                  </div>
                </div>

                <!-- Account -->
                <div class="detail-row">
                  <span class="detail-label">Account</span>
                  <span class="detail-value">{getAccountName(txn.account_id)}</span>
                </div>

                <!-- Status -->
                <div class="detail-row">
                  <span class="detail-label">Status</span>
                  <span class="detail-value status-value" class:pending={isPending}>
                    {txn.status}
                  </span>
                </div>

                <!-- Running Balance -->
                {#if txn.running_balance}
                  <div class="detail-row">
                    <span class="detail-label">Balance</span>
                    <span class="detail-value">{formatCurrency(txn.running_balance)}</span>
                  </div>
                {/if}

                <!-- Category Selector -->
                <div class="detail-row detail-row-interactive">
                  <span class="detail-label">Category</span>
                  <div class="detail-control detail-control-cat">
                    <select
                      class="detail-select"
                      value={editingCategory[txn.id] ?? txn.category_id ?? ''}
                      onchange={(e) => {
                        editingCategory[txn.id] = (e.target as HTMLSelectElement).value;
                        saveCategory(txn.id);
                      }}
                      disabled={savingField === `cat-${txn.id}`}
                    >
                      <option value="">Uncategorized</option>
                      {#each sortedCategories as c (c.id)}
                        <option value={c.id}>{c.icon} {c.name}</option>
                      {/each}
                    </select>
                    <button
                      class="recat-btn"
                      class:spinning={savingField === `recat-${txn.id}`}
                      title="Auto-categorize"
                      onclick={(e) => {
                        e.stopPropagation();
                        recategorize(txn.id);
                      }}
                      disabled={savingField === `recat-${txn.id}`}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path
                          d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.2M22 12.5a10 10 0 0 1-18.8 4.2"
                        />
                      </svg>
                    </button>
                    {#if savingField === `cat-${txn.id}`}
                      <span class="saving-indicator"></span>
                    {/if}
                  </div>
                </div>

                <!-- Notes -->
                <div class="detail-row detail-row-notes">
                  <span class="detail-label">Notes</span>
                  <div class="detail-control">
                    <textarea
                      class="detail-textarea"
                      placeholder="Add a note..."
                      value={editingNotes[txn.id] ?? txn.notes ?? ''}
                      oninput={(e) => {
                        editingNotes[txn.id] = (e.target as HTMLTextAreaElement).value;
                      }}
                      onblur={() => saveNotes(txn.id)}
                      rows="2"
                    ></textarea>
                    {#if savingField === `notes-${txn.id}`}
                      <span class="saving-indicator"></span>
                    {/if}
                  </div>
                </div>

                <!-- Exclude Toggle -->
                <div class="detail-row detail-row-interactive">
                  <span class="detail-label">Exclude</span>
                  <div class="detail-control">
                    <button
                      class="exclude-toggle"
                      class:active={txn.is_excluded}
                      onclick={(e) => {
                        e.stopPropagation();
                        toggleExcluded(txn.id, txn.is_excluded);
                      }}
                      disabled={savingField === `excl-${txn.id}`}
                      aria-label={txn.is_excluded ? 'Include transaction' : 'Exclude transaction'}
                    >
                      <span class="exclude-track">
                        <span class="exclude-knob"></span>
                      </span>
                      <span class="exclude-label">{txn.is_excluded ? 'Excluded' : 'Included'}</span>
                    </button>
                  </div>
                </div>

                <!-- Delete Transaction -->
                <div class="detail-row detail-row-delete">
                  <button
                    class="delete-txn-btn"
                    onclick={(e) => {
                      e.stopPropagation();
                      deleteSingle(txn.id);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M2.5 3.5H11.5M5 3.5V2.5C5 2.224 5.224 2 5.5 2H8.5C8.776 2 9 2.224 9 2.5V3.5M5.5 6V10.5M8.5 6V10.5M3.5 3.5L4 11.5C4 11.776 4.224 12 4.5 12H9.5C9.776 12 10 11.776 10 11.5L10.5 3.5"
                        stroke="currentColor"
                        stroke-width="1.1"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                    Delete transaction
                  </button>
                </div>
              </div>
            </div>
          {/if}
        {/each}
      {/each}

      <!-- ─── Load More ─── -->
      {#if hasMore}
        <div class="load-more-zone">
          <button class="load-more-btn" onclick={loadMore}>
            Load more
            <span class="load-more-count">
              ({filteredTransactions.length - visibleCount} remaining)
            </span>
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- ─── Floating Selection Bar (outside page container to avoid clipping) ─── -->
<!-- ─── Auto-sync floating toast ─── -->
{#if autoSyncBanner}
  <div class="auto-sync-toast" class:fading={autoSyncBannerFading}>
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
    {autoSyncBanner}
  </div>
{/if}

<!-- ─── Categorization toast ─── -->
{#if catToast}
  <div class="cat-toast" class:info={catToast.type === 'info'} class:fading={catToastFading}>
    {#if catToast.type === 'success'}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    {:else}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    {/if}
    {catToast.message}
  </div>
{/if}

{#if selectionMode && selectedIds.size > 0}
  <div class="selection-bar">
    <div class="selection-bar-inner">
      <span class="selection-count">{selectedIds.size}</span>
      <button class="selection-select-all" onclick={selectAllVisible}>
        {selectedIds.size === visibleTransactions.length ? 'Deselect all' : 'Select all'}
      </button>
      <div class="selection-spacer"></div>
      <button class="selection-delete" onclick={bulkDeleteSelected}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M2.5 3.5H11.5M5 3.5V2.5C5 2.224 5.224 2 5.5 2H8.5C8.776 2 9 2.224 9 2.5V3.5M5.5 6V10.5M8.5 6V10.5M3.5 3.5L4 11.5C4 11.776 4.224 12 4.5 12H9.5C9.776 12 10 11.776 10 11.5L10.5 3.5"
            stroke="currentColor"
            stroke-width="1.1"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        Delete
      </button>
      <button class="selection-cancel" onclick={clearSelection}>Cancel</button>
    </div>
  </div>
{/if}

<!-- ========================================================================= -->
<!--                            SCOPED STYLES                                  -->
<!-- ========================================================================= -->

<style>
  /* ═══════════════════════════════════════════════════════════════════════════
     DESIGN TOKENS — Gem / Crystal palette
     ═══════════════════════════════════════════════════════════════════════════ */

  :root {
    --txn-void: #0a0806;
    --txn-obsidian: #12100c;
    --txn-surface: #1a1610;
    --txn-surface-raised: #221e18;
    --txn-border: rgba(180, 150, 80, 0.1);
    --txn-border-subtle: rgba(180, 150, 80, 0.06);
    --txn-text: #f0e8d0;
    --txn-text-muted: #a09478;
    --txn-text-dim: #706450;
    --txn-emerald: #3dd68c;
    --txn-ruby: #e85470;
    --txn-gold: #e8c87a;
    --txn-citrine: #dbb044;
    --txn-sapphire: #5c8ce8;
    --txn-frost: rgba(200, 180, 120, 0.06);
    --txn-frost-hover: rgba(200, 180, 120, 0.1);
    --txn-glass-bg: rgba(14, 12, 8, 0.75);
    --txn-glass-border: rgba(180, 150, 80, 0.12);
    --txn-radius: 10px;
    --txn-radius-sm: 6px;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     PAGE CONTAINER
     ═══════════════════════════════════════════════════════════════════════════ */

  .txn-page {
    padding: 0;
    opacity: 0;
    transform: translateY(12px);
    transition:
      opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1),
      transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  }

  /* ── Auto-sync floating toast ── */
  .auto-sync-toast {
    position: fixed;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9000;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0.55rem 1rem;
    background: var(--txn-glass-bg);
    backdrop-filter: blur(24px) saturate(1.4);
    -webkit-backdrop-filter: blur(24px) saturate(1.4);
    border: 1px solid rgba(61, 214, 140, 0.2);
    border-radius: var(--txn-radius);
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(61, 214, 140, 0.06);
    color: var(--txn-emerald);
    font-size: 0.82rem;
    font-weight: 500;
    letter-spacing: 0.01em;
    white-space: nowrap;
    animation: toastSlideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .auto-sync-toast.fading {
    animation: toastFadeOut 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }
  @keyframes toastSlideUp {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(16px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }
  }
  @keyframes toastFadeOut {
    from {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }
    to {
      opacity: 0;
      transform: translateX(-50%) translateY(20px) scale(0.95);
    }
  }

  /* ── Categorization toast ── */
  .cat-toast {
    position: fixed;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9000;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0.55rem 1rem;
    background: var(--txn-glass-bg);
    backdrop-filter: blur(24px) saturate(1.4);
    -webkit-backdrop-filter: blur(24px) saturate(1.4);
    border: 1px solid rgba(61, 214, 140, 0.2);
    border-radius: var(--txn-radius);
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(61, 214, 140, 0.06);
    color: var(--txn-emerald);
    font-size: 0.82rem;
    font-weight: 500;
    letter-spacing: 0.01em;
    white-space: nowrap;
    animation: toastSlideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .cat-toast.info {
    border-color: rgba(180, 150, 80, 0.2);
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(180, 150, 80, 0.06);
    color: var(--txn-gold);
  }
  .cat-toast.fading {
    animation: toastFadeOut 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }

  .txn-page::before {
    content: '';
    position: fixed;
    inset: 0;
    /* Prismatic refraction band — diagonal light sweep like a gem's internal fire */
    background: linear-gradient(
      150deg,
      transparent 0%,
      rgba(232, 185, 74, 0.035) 25%,
      transparent 40%,
      rgba(232, 200, 122, 0.03) 55%,
      transparent 70%,
      rgba(46, 196, 166, 0.025) 85%,
      transparent 100%
    );
    background-size: 200% 200%;
    z-index: -1;
    pointer-events: none;
    animation: txnPrismSweep 14s ease-in-out infinite alternate;
  }

  @keyframes txnPrismSweep {
    0% {
      background-position: 0% 100%;
    }
    100% {
      background-position: 100% 0%;
    }
  }

  .txn-page.mounted {
    opacity: 1;
    transform: translateY(0);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     HEADER
     ═══════════════════════════════════════════════════════════════════════════ */

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0 1rem;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  /* ── Citrine gem title ── */
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

  .txn-page.mounted .title-flare {
    animation: txnFlareIn 0.8s 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .f1 {
    width: 60px;
    height: 60px;
    top: -14px;
    left: -12px;
    background: radial-gradient(circle, rgba(219, 176, 68, 0.5), transparent 70%);
  }

  .f2 {
    width: 40px;
    height: 40px;
    top: -6px;
    right: -8px;
    background: radial-gradient(circle, rgba(232, 200, 122, 0.35), transparent 70%);
    animation-delay: 0.35s !important;
  }

  @keyframes txnFlareIn {
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
    background: linear-gradient(135deg, var(--txn-text) 0%, var(--txn-citrine) 60%, #c49a30 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    background-size: 200% auto;
    animation: citrineTitleShimmer 8s ease-in-out infinite;
  }

  @keyframes citrineTitleShimmer {
    0%,
    100% {
      background-position: 0% center;
    }
    50% {
      background-position: 100% center;
    }
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
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid var(--txn-border);
    background: var(--txn-frost);
    color: var(--txn-text-muted);
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
    background: var(--txn-frost-hover);
    color: var(--txn-text);
    border-color: var(--txn-glass-border);
  }

  .month-arrow:disabled {
    opacity: 0.25;
    cursor: default;
  }

  .month-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--txn-text-muted);
    min-width: 120px;
    text-align: center;
    letter-spacing: 0.01em;
  }

  .month-nav-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .today-btn {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--txn-citrine);
    background: rgba(200, 160, 60, 0.08);
    border: 1px solid rgba(200, 160, 60, 0.15);
    border-radius: 6px;
    padding: 0.3rem 0.6rem;
    cursor: pointer;
    transition:
      background 0.2s,
      border-color 0.2s;
    -webkit-tap-highlight-color: transparent;
  }

  .today-btn:hover {
    background: rgba(200, 160, 60, 0.15);
    border-color: rgba(200, 160, 60, 0.25);
  }

  @media (max-width: 640px) {
    .month-nav-group {
      width: 100%;
      justify-content: space-between;
    }

    .today-btn {
      order: 1;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     FILTER BAR — Frosted glass
     ═══════════════════════════════════════════════════════════════════════════ */

  .filter-bar {
    background: var(--txn-glass-bg);
    backdrop-filter: blur(20px) saturate(1.3);
    -webkit-backdrop-filter: blur(20px) saturate(1.3);
    border: 1px solid var(--txn-glass-border);
    border-radius: var(--txn-radius);
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .search-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .search-field {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 0.65rem;
    color: var(--txn-text-dim);
    pointer-events: none;
  }

  .search-input {
    width: 100%;
    height: 36px;
    padding: 0 2rem 0 2.25rem;
    border-radius: var(--txn-radius-sm);
    border: 1px solid var(--txn-border-subtle);
    background: var(--txn-frost);
    color: var(--txn-text);
    font-size: 0.82rem;
    font-family: inherit;
    outline: none;
    transition:
      border-color 0.2s,
      background 0.2s;
  }

  .search-input::placeholder {
    color: var(--txn-text-dim);
  }

  .search-input:focus {
    border-color: var(--txn-citrine);
    background: var(--txn-frost-hover);
  }

  .search-clear {
    position: absolute;
    right: 0.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    background: none;
    color: var(--txn-text-dim);
    cursor: pointer;
    border-radius: 50%;
    transition: color 0.15s;
  }

  .search-clear:hover {
    color: var(--txn-text);
  }

  .clear-filters-btn {
    white-space: nowrap;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    color: var(--txn-citrine);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: var(--txn-radius-sm);
    transition: background 0.15s;
    -webkit-tap-highlight-color: transparent;
  }

  .clear-filters-btn:hover {
    background: rgba(200, 160, 60, 0.1);
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .filter-select {
    flex: 1;
    height: 32px;
    border-radius: var(--txn-radius-sm);
    border: 1px solid var(--txn-border-subtle);
    background: var(--txn-frost);
    color: var(--txn-text-muted);
    font-size: 0.75rem;
    font-family: inherit;
    padding: 0 0.5rem;
    outline: none;
    cursor: pointer;
    transition: border-color 0.2s;
    -webkit-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%235c567a' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.5rem center;
    padding-right: 1.5rem;
    min-width: 0;
  }

  .filter-status {
    flex: 0.7;
  }

  .filter-select:focus {
    border-color: var(--txn-citrine);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SUMMARY STRIP
     ═══════════════════════════════════════════════════════════════════════════ */

  .summary-strip {
    display: flex;
    align-items: center;
    background: var(--txn-glass-bg);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--txn-glass-border);
    border-radius: var(--txn-radius);
    padding: 0.6rem 0.75rem;
    margin-bottom: 0.75rem;
    gap: 0;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }

  .summary-strip::-webkit-scrollbar {
    display: none;
  }

  .summary-item {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    padding: 0 0.25rem;
  }

  .summary-label {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--txn-text-dim);
  }

  .summary-value {
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }

  .summary-item.inflow .summary-value {
    color: var(--txn-emerald);
  }

  .summary-item.outflow .summary-value {
    color: var(--txn-text);
  }

  .summary-item.net-positive .summary-value {
    color: var(--txn-gold);
  }

  .summary-item.net-negative .summary-value {
    color: var(--txn-ruby);
  }

  .summary-item.count .summary-value {
    color: var(--txn-citrine);
  }

  .summary-divider {
    width: 1px;
    height: 28px;
    background: var(--txn-border);
    flex-shrink: 0;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     LOADING SKELETON — Prismatic shimmer
     ═══════════════════════════════════════════════════════════════════════════ */

  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding-top: 0.5rem;
  }

  .skeleton-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.85rem 0.75rem;
    border-radius: var(--txn-radius-sm);
    background: var(--txn-frost);
    opacity: 0;
    animation: skeletonFadeIn 0.4s ease forwards;
  }

  @keyframes skeletonFadeIn {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .skeleton-dot {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(
      110deg,
      var(--txn-border-subtle) 0%,
      rgba(200, 160, 60, 0.08) 40%,
      rgba(232, 200, 122, 0.06) 60%,
      var(--txn-border-subtle) 100%
    );
    background-size: 250% 100%;
    animation: prismaticShimmer 2s ease-in-out infinite;
    flex-shrink: 0;
  }

  .skeleton-text-group {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .skeleton-line {
    height: 10px;
    border-radius: 5px;
    background: linear-gradient(
      110deg,
      var(--txn-border-subtle) 0%,
      rgba(200, 160, 60, 0.1) 35%,
      rgba(232, 200, 122, 0.06) 55%,
      var(--txn-border-subtle) 100%
    );
    background-size: 250% 100%;
    animation: prismaticShimmer 2s ease-in-out infinite;
  }

  .skeleton-line-primary {
    width: 65%;
  }

  .skeleton-line-secondary {
    width: 40%;
    opacity: 0.6;
  }

  .skeleton-amount {
    width: 60px;
    height: 12px;
    border-radius: 6px;
    background: linear-gradient(
      110deg,
      var(--txn-border-subtle) 0%,
      rgba(200, 160, 60, 0.1) 35%,
      rgba(232, 200, 122, 0.06) 55%,
      var(--txn-border-subtle) 100%
    );
    background-size: 250% 100%;
    animation: prismaticShimmer 2s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes prismaticShimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     EMPTY STATE
     ═══════════════════════════════════════════════════════════════════════════ */

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 1.5rem;
    text-align: center;
  }

  .empty-gem {
    margin-bottom: 1.25rem;
    opacity: 0.5;
    animation: gemFloat 4s ease-in-out infinite;
  }

  @keyframes gemFloat {
    0%,
    100% {
      transform: translateY(0) rotate(0deg);
    }
    50% {
      transform: translateY(-8px) rotate(2deg);
    }
  }

  .empty-title {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--txn-text);
    margin: 0 0 0.4rem;
    letter-spacing: -0.01em;
  }

  .empty-sub {
    font-size: 0.82rem;
    color: var(--txn-text-dim);
    margin: 0 0 1.25rem;
    max-width: 280px;
    line-height: 1.5;
  }

  .empty-action {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--txn-citrine);
    background: rgba(200, 160, 60, 0.1);
    border: 1px solid rgba(200, 160, 60, 0.2);
    border-radius: var(--txn-radius-sm);
    padding: 0.45rem 1rem;
    cursor: pointer;
    transition:
      background 0.2s,
      border-color 0.2s;
    -webkit-tap-highlight-color: transparent;
  }

  .empty-action:hover {
    background: rgba(200, 160, 60, 0.18);
    border-color: rgba(200, 160, 60, 0.35);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     TRANSACTION LIST
     ═══════════════════════════════════════════════════════════════════════════ */

  .txn-list {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* ── Date Group Header ── */

  .date-header {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.85rem 0.25rem 0.35rem;
    opacity: 0;
    animation: rowSlideIn 0.35s ease forwards;
  }

  .date-header::before {
    content: '';
    position: absolute;
    left: -12px;
    top: 50%;
    transform: translateY(-50%);
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--txn-citrine, #e8b94a);
    box-shadow: 0 0 6px rgba(232, 185, 74, 0.4);
  }

  .date-header-text {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--txn-text-dim);
    white-space: nowrap;
  }

  .date-header-line {
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, var(--txn-border), transparent);
  }

  /* ── Transaction Row ── */

  .txn-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.7rem 0.6rem;
    border-radius: var(--txn-radius-sm);
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    transition:
      background 0.2s,
      border-color 0.2s,
      box-shadow 0.3s;
    width: 100%;
    text-align: left;
    font-family: inherit;
    color: inherit;
    -webkit-tap-highlight-color: transparent;
    position: relative;
    opacity: 0;
    animation: rowSlideIn 0.35s ease forwards;
  }

  @keyframes rowSlideIn {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .txn-row::before {
    content: '';
    position: absolute;
    left: 0;
    top: 20%;
    bottom: 20%;
    width: 2px;
    background: var(--txn-citrine, #e8b94a);
    border-radius: 2px;
    opacity: 0;
    transform: scaleY(0.5);
    transition:
      opacity 0.2s ease,
      transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .txn-row:hover::before {
    opacity: 1;
    transform: scaleY(1);
  }

  .txn-row:hover {
    background: var(--txn-frost-hover);
    border-color: var(--txn-border-subtle);
    box-shadow:
      0 0 0 1px rgba(200, 160, 60, 0.03),
      inset 0 0 20px rgba(200, 180, 120, 0.02);
  }

  .txn-row.expanded {
    background: var(--txn-frost);
    border-color: var(--txn-glass-border);
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }

  .txn-row.excluded {
    opacity: 0.45;
  }

  .txn-row.pending {
    border-left: 2px solid rgba(232, 200, 122, 0.3);
  }

  /* ── Category Dot ── */

  .txn-dot {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: radial-gradient(
      circle,
      color-mix(in srgb, var(--dot-color) 20%, transparent) 0%,
      transparent 70%
    );
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    filter: drop-shadow(0 0 6px color-mix(in srgb, var(--dot-color) 50%, transparent));
    transition:
      filter 0.3s ease,
      transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .txn-row:hover .txn-dot {
    filter: drop-shadow(0 0 10px color-mix(in srgb, var(--dot-color) 60%, transparent));
    transform: scale(1.05);
  }

  .txn-dot-icon {
    font-size: 1rem;
    line-height: 1;
  }

  .txn-dot-fallback {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--dot-color);
    opacity: 0.6;
  }

  /* ── Recurring Badge ── */

  .recurring-badge {
    font-size: 0.65rem;
    opacity: 0.5;
    margin-left: 4px;
    vertical-align: middle;
  }

  /* ── Description & Counterparty ── */

  .txn-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .txn-desc {
    font-size: 0.82rem;
    font-weight: 500;
    color: var(--txn-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }

  .txn-counterparty {
    font-size: 0.7rem;
    color: var(--txn-text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }

  /* ── Account Badge ── */

  .txn-account-badge {
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--txn-text-dim);
    background: var(--txn-frost);
    border: 1px solid var(--txn-border-subtle);
    border-radius: 4px;
    padding: 0.15rem 0.4rem;
    white-space: nowrap;
    flex-shrink: 0;
    display: none;
  }

  /* ── Pending Dot ── */

  .txn-pending-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--txn-gold);
    flex-shrink: 0;
    animation: pendingPulse 2s ease-in-out infinite;
    box-shadow: 0 0 6px rgba(232, 200, 122, 0.4);
  }

  @keyframes pendingPulse {
    0%,
    100% {
      opacity: 0.6;
      box-shadow: 0 0 4px rgba(232, 200, 122, 0.2);
    }
    50% {
      opacity: 1;
      box-shadow: 0 0 10px rgba(232, 200, 122, 0.5);
    }
  }

  /* ── Amount ── */

  .txn-amount {
    font-size: 0.85rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .txn-amount.credit {
    color: var(--txn-emerald);
  }

  .txn-amount.debit {
    color: var(--txn-text);
  }

  .txn-amount.zero {
    color: var(--txn-text-dim);
  }

  .excluded-strike {
    text-decoration: line-through;
    text-decoration-color: var(--txn-text-dim);
    color: var(--txn-text-dim);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     EXPANDED DETAIL PANEL
     ═══════════════════════════════════════════════════════════════════════════ */

  .txn-detail {
    background: var(--txn-frost);
    border: 1px solid var(--txn-glass-border);
    border-top: none;
    border-radius: 0 0 var(--txn-radius-sm) var(--txn-radius-sm);
    padding: 0.75rem 0.85rem 0.85rem;
    margin-bottom: 0.25rem;
    animation: detailExpand 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    transform-origin: top center;
  }

  @keyframes detailExpand {
    from {
      opacity: 0;
      transform: scaleY(0.92);
    }
    to {
      opacity: 1;
      transform: scaleY(1);
    }
  }

  .detail-grid {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .detail-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .detail-label {
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--txn-text-dim);
    min-width: 70px;
    padding-top: 0.15rem;
    flex-shrink: 0;
  }

  .detail-value {
    font-size: 0.8rem;
    color: var(--txn-text);
    line-height: 1.4;
    word-break: break-word;
  }

  .status-value {
    text-transform: capitalize;
  }

  .status-value.pending {
    color: var(--txn-gold);
  }

  .detail-control {
    flex: 1;
    min-width: 0;
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .detail-control-cat {
    gap: 0.35rem;
  }

  .recat-btn {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--txn-radius-sm);
    border: 1px solid var(--txn-border);
    background: var(--txn-surface);
    color: var(--txn-text-dim);
    cursor: pointer;
    transition:
      color 0.2s,
      border-color 0.2s,
      background 0.2s;
  }

  .recat-btn:hover:not(:disabled) {
    color: var(--txn-gold);
    border-color: color-mix(in srgb, var(--txn-gold) 40%, transparent);
    background: color-mix(in srgb, var(--txn-gold) 6%, transparent);
  }

  .recat-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .recat-btn.spinning svg {
    animation: recat-spin 0.8s linear infinite;
  }

  @keyframes recat-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .detail-select {
    width: 100%;
    height: 28px;
    border-radius: var(--txn-radius-sm);
    border: 1px solid var(--txn-border);
    background: var(--txn-surface);
    color: var(--txn-text);
    font-size: 0.75rem;
    font-family: inherit;
    padding: 0 1.5rem 0 0.5rem;
    outline: none;
    cursor: pointer;
    -webkit-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%238a84a0' stroke-width='1.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 0.5rem center;
    transition: border-color 0.2s;
  }

  .detail-select:focus {
    border-color: var(--txn-citrine);
  }

  .detail-textarea {
    width: 100%;
    border-radius: var(--txn-radius-sm);
    border: 1px solid var(--txn-border);
    background: var(--txn-surface);
    color: var(--txn-text);
    font-size: 0.78rem;
    font-family: inherit;
    padding: 0.4rem 0.5rem;
    outline: none;
    resize: vertical;
    min-height: 2.5rem;
    transition: border-color 0.2s;
    line-height: 1.4;
  }

  .detail-textarea::placeholder {
    color: var(--txn-text-dim);
  }

  .detail-textarea:focus {
    border-color: var(--txn-citrine);
  }

  .detail-row-notes {
    align-items: flex-start;
  }

  /* ── Saving Indicator ── */

  .saving-indicator {
    width: 14px;
    height: 14px;
    border: 2px solid var(--txn-border);
    border-top-color: var(--txn-citrine);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ── Exclude Toggle ── */

  .exclude-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.2rem 0;
    font-family: inherit;
    -webkit-tap-highlight-color: transparent;
  }

  .exclude-toggle:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .exclude-track {
    position: relative;
    width: 36px;
    height: 20px;
    border-radius: 10px;
    background: var(--txn-surface);
    border: 1px solid var(--txn-border);
    transition:
      background 0.25s,
      border-color 0.25s;
  }

  .exclude-toggle.active .exclude-track {
    background: rgba(232, 84, 112, 0.2);
    border-color: rgba(232, 84, 112, 0.35);
  }

  .exclude-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--txn-text-dim);
    transition:
      transform 0.25s cubic-bezier(0.68, -0.15, 0.27, 1.15),
      background 0.25s;
  }

  .exclude-toggle.active .exclude-knob {
    transform: translateX(16px);
    background: var(--txn-ruby);
  }

  .exclude-label {
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--txn-text-dim);
    transition: color 0.2s;
  }

  .exclude-toggle.active .exclude-label {
    color: var(--txn-ruby);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     LOAD MORE
     ═══════════════════════════════════════════════════════════════════════════ */

  .load-more-zone {
    display: flex;
    justify-content: center;
    padding: 1.5rem 0;
  }

  .load-more-btn {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--txn-citrine);
    background: rgba(200, 160, 60, 0.08);
    border: 1px solid rgba(200, 160, 60, 0.15);
    border-radius: var(--txn-radius);
    padding: 0.55rem 1.5rem;
    cursor: pointer;
    transition:
      background 0.2s,
      border-color 0.2s,
      box-shadow 0.3s;
    -webkit-tap-highlight-color: transparent;
    font-family: inherit;
  }

  .load-more-btn:hover {
    background: rgba(200, 160, 60, 0.15);
    border-color: rgba(200, 160, 60, 0.3);
    box-shadow: 0 0 16px rgba(200, 160, 60, 0.08);
  }

  .load-more-count {
    font-weight: 400;
    color: var(--txn-text-dim);
    margin-left: 0.25rem;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     REDUCED MOTION
     ═══════════════════════════════════════════════════════════════════════════ */

  @media (prefers-reduced-motion: reduce) {
    .txn-page {
      transition: none;
      opacity: 1;
      transform: none;
    }

    .skeleton-row,
    .txn-row,
    .date-header {
      animation: none;
      opacity: 1;
      transform: none;
    }

    .skeleton-dot,
    .skeleton-line,
    .skeleton-amount {
      animation: none;
    }

    .txn-detail {
      animation: none;
    }

    .txn-pending-dot {
      animation: none;
      opacity: 1;
    }

    .empty-gem {
      animation: none;
    }

    .saving-indicator {
      animation: none;
    }

    .txn-page::before {
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

  /* ═══════════════════════════════════════════════════════════════════════════
     RESPONSIVE — Tablet and larger
     ═══════════════════════════════════════════════════════════════════════════ */

  @media (min-width: 520px) {
    .txn-account-badge {
      display: block;
    }

    .filter-row {
      gap: 0.5rem;
    }

    .summary-value {
      font-size: 0.95rem;
    }

    .txn-row {
      padding: 0.75rem 0.75rem;
    }

    .detail-label {
      min-width: 85px;
    }
  }

  @media (min-width: 768px) {
    .page-title {
      font-size: 1.75rem;
    }

    .filter-bar {
      padding: 0.85rem;
    }

    .txn-row {
      padding: 0.8rem 0.85rem;
      gap: 0.85rem;
    }

    .txn-desc {
      font-size: 0.85rem;
    }

    .txn-amount {
      font-size: 0.9rem;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     RESPONSIVE — Narrow screens
     ═══════════════════════════════════════════════════════════════════════════ */

  @media (max-width: 480px) {
    .filter-row {
      flex-wrap: wrap;
    }

    .filter-select {
      flex: 1 1 calc(50% - 0.2rem);
      min-width: calc(50% - 0.2rem);
    }

    .summary-item {
      min-width: 60px;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     RESPONSIVE — Small phones
     ═══════════════════════════════════════════════════════════════════════════ */

  @media (max-width: 380px) {
    .page-title {
      font-size: 1.25rem;
    }

    .month-label {
      font-size: 0.78rem;
      min-width: 100px;
    }

    .month-arrow {
      width: 28px;
      height: 28px;
    }

    .filter-row {
      flex-wrap: wrap;
    }

    .filter-select {
      flex: 1 1 calc(50% - 0.2rem);
      min-width: calc(50% - 0.2rem);
    }

    .summary-value {
      font-size: 0.78rem;
    }

    .summary-label {
      font-size: 0.55rem;
    }

    .txn-row {
      padding: 0.6rem 0.4rem;
      gap: 0.5rem;
    }

    .txn-dot {
      width: 28px;
      height: 28px;
    }

    .txn-dot-icon {
      font-size: 0.75rem;
    }

    .txn-desc {
      font-size: 0.78rem;
    }

    .txn-amount {
      font-size: 0.8rem;
    }

    .detail-row {
      flex-direction: column;
      gap: 0.2rem;
    }

    .detail-label {
      min-width: unset;
    }

    .search-input {
      font-size: 16px;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MULTI-SELECT
     ═══════════════════════════════════════════════════════════════════════════ */

  .select-mode-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    min-width: 36px;
    height: 36px;
    min-height: 36px;
    max-height: 36px;
    flex: 0 0 36px;
    align-self: center;
    border-radius: 50%;
    box-sizing: border-box;
    border: 1px solid var(--txn-border);
    background: var(--txn-frost);
    color: var(--txn-text-muted);
    cursor: pointer;
    transition:
      background 0.2s,
      color 0.2s,
      border-color 0.2s;
    -webkit-tap-highlight-color: transparent;
    margin-left: 0.5rem;
    padding: 0;
  }

  .select-mode-btn:hover,
  .select-mode-btn.active {
    background: var(--txn-frost-hover);
    color: var(--txn-citrine);
    border-color: rgba(219, 176, 68, 0.3);
  }

  .select-check {
    width: 20px;
    height: 20px;
    border-radius: var(--txn-radius-sm);
    border: 1.5px solid var(--txn-border);
    background: var(--txn-surface);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      background 0.25s cubic-bezier(0.68, -0.15, 0.27, 1.15),
      border-color 0.25s,
      transform 0.25s cubic-bezier(0.68, -0.15, 0.27, 1.15),
      box-shadow 0.25s;
    color: #fff;
  }

  .select-check.checked {
    background: var(--txn-citrine);
    border-color: var(--txn-citrine);
    transform: scale(1.08);
    box-shadow: 0 0 10px rgba(219, 176, 68, 0.35);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     FLOATING SELECTION BAR
     ═══════════════════════════════════════════════════════════════════════════ */

  .selection-bar {
    position: fixed;
    bottom: 1rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9000;
    animation: selectionBarSlideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes selectionBarSlideUp {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(16px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
    }
  }

  .selection-bar-inner {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: var(--txn-glass-bg);
    backdrop-filter: blur(24px) saturate(1.4);
    -webkit-backdrop-filter: blur(24px) saturate(1.4);
    border: 1px solid var(--txn-glass-border);
    border-radius: var(--txn-radius);
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(180, 150, 80, 0.06);
  }

  .selection-count {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 24px;
    height: 24px;
    padding: 0 0.4rem;
    border-radius: 12px;
    background: var(--txn-citrine);
    color: var(--txn-void);
    font-size: 0.72rem;
    font-weight: 700;
  }

  .selection-select-all {
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--txn-citrine);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.2rem 0.4rem;
    border-radius: var(--txn-radius-sm);
    transition: background 0.15s;
    white-space: nowrap;
    font-family: inherit;
    -webkit-tap-highlight-color: transparent;
  }

  .selection-select-all:hover {
    background: rgba(200, 160, 60, 0.1);
  }

  .selection-spacer {
    width: 1px;
    height: 20px;
    background: var(--txn-border);
    flex-shrink: 0;
  }

  .selection-delete {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: #fff;
    background: rgba(232, 84, 112, 0.85);
    border: 1px solid rgba(232, 84, 112, 0.4);
    border-radius: var(--txn-radius-sm);
    padding: 0.35rem 0.65rem;
    cursor: pointer;
    font-family: inherit;
    transition:
      background 0.2s,
      box-shadow 0.3s;
    -webkit-tap-highlight-color: transparent;
  }

  .selection-delete:hover {
    background: rgba(232, 84, 112, 1);
    box-shadow: 0 0 16px rgba(232, 84, 112, 0.3);
  }

  .selection-cancel {
    font-size: 0.72rem;
    font-weight: 500;
    color: var(--txn-text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.2rem 0.4rem;
    font-family: inherit;
    -webkit-tap-highlight-color: transparent;
    transition: color 0.15s;
  }

  .selection-cancel:hover {
    color: var(--txn-text);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     INLINE EDIT — Detail input
     ═══════════════════════════════════════════════════════════════════════════ */

  .detail-input {
    width: 100%;
    height: 28px;
    border-radius: var(--txn-radius-sm);
    border: 1px solid var(--txn-border);
    background: var(--txn-surface);
    color: var(--txn-text);
    font-size: 0.75rem;
    font-family: inherit;
    padding: 0 0.5rem;
    outline: none;
    transition:
      border-color 0.2s,
      box-shadow 0.3s;
  }

  .detail-input:focus {
    border-color: var(--txn-citrine);
    box-shadow:
      0 0 0 2px rgba(219, 176, 68, 0.12),
      0 0 12px rgba(219, 176, 68, 0.08);
  }

  .detail-input[type='date'] {
    color-scheme: dark;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     DELETE BUTTON
     ═══════════════════════════════════════════════════════════════════════════ */

  .detail-row-delete {
    margin-top: 0.4rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--txn-border-subtle);
  }

  .delete-txn-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.55rem 0.75rem;
    border-radius: var(--txn-radius-sm);
    border: 1px solid rgba(232, 84, 112, 0.25);
    background: rgba(232, 84, 112, 0.12);
    color: var(--txn-ruby);
    font-size: 0.78rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition:
      background 0.2s,
      border-color 0.2s,
      box-shadow 0.3s;
    -webkit-tap-highlight-color: transparent;
  }

  .delete-txn-btn:hover {
    background: rgba(232, 84, 112, 0.22);
    border-color: rgba(232, 84, 112, 0.4);
    box-shadow: 0 0 16px rgba(232, 84, 112, 0.12);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     REAL-TIME ANIMATION KEYFRAMES
     ═══════════════════════════════════════════════════════════════════════════ */

  /* Base transition for all syncable items */
  :global(.syncable-item) {
    transition:
      opacity 0.3s ease,
      transform 0.3s ease,
      background 0.3s ease,
      box-shadow 0.3s ease;
  }

  /* New transaction — golden slide-in with burst glow */
  :global(.item-created) {
    animation: txnSlideIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes txnSlideIn {
    0% {
      opacity: 0;
      transform: translateX(-24px) scale(0.94);
      box-shadow: 0 0 0 0 rgba(232, 185, 74, 0);
      background: rgba(232, 185, 74, 0.12);
    }
    40% {
      box-shadow:
        0 0 24px 6px rgba(232, 185, 74, 0.25),
        inset 0 0 20px rgba(232, 200, 122, 0.08);
    }
    100% {
      opacity: 1;
      transform: translateX(0) scale(1);
      box-shadow: 0 0 0 0 rgba(232, 185, 74, 0);
      background: transparent;
    }
  }

  /* Delete — ruby flash + slide-out + collapse */
  :global(.item-deleting) {
    animation: txnSlideOut 0.5s cubic-bezier(0.55, 0, 1, 0.45) forwards;
    pointer-events: none;
  }

  @keyframes txnSlideOut {
    0% {
      opacity: 1;
      transform: translateX(0) scale(1);
      max-height: 80px;
      background: rgba(232, 84, 112, 0.08);
    }
    30% {
      background: rgba(232, 84, 112, 0.15);
      box-shadow: inset 0 0 16px rgba(232, 84, 112, 0.1);
    }
    100% {
      opacity: 0;
      transform: translateX(40px) scale(0.88);
      max-height: 0;
      padding-top: 0;
      padding-bottom: 0;
      margin: 0;
      overflow: hidden;
    }
  }

  /* Field update — prismatic shimmer sweep */
  :global(.item-changed) {
    animation: txnPrismaticSweep 1.6s ease-out forwards;
  }

  @keyframes txnPrismaticSweep {
    0% {
      background: linear-gradient(110deg, transparent 0%, transparent 100%) no-repeat;
      background-size: 250% 100%;
      background-position: 200% 0;
    }
    15% {
      background: linear-gradient(
          110deg,
          transparent 0%,
          rgba(200, 160, 60, 0.08) 35%,
          rgba(232, 200, 122, 0.12) 50%,
          rgba(46, 196, 166, 0.06) 65%,
          transparent 100%
        )
        no-repeat;
      background-size: 250% 100%;
      background-position: 200% 0;
    }
    100% {
      background: linear-gradient(
          110deg,
          transparent 0%,
          rgba(200, 160, 60, 0.08) 35%,
          rgba(232, 200, 122, 0.12) 50%,
          rgba(46, 196, 166, 0.06) 65%,
          transparent 100%
        )
        no-repeat;
      background-size: 250% 100%;
      background-position: -100% 0;
    }
  }

  /* Description/rename — golden highlight flash */
  :global(.text-changed) {
    animation: txnTextFlash 0.7s ease-out forwards;
  }

  @keyframes txnTextFlash {
    0% {
      background-color: rgba(232, 185, 74, 0.18);
      box-shadow: inset 0 0 12px rgba(232, 200, 122, 0.1);
    }
    100% {
      background-color: transparent;
      box-shadow: none;
    }
  }

  /* Toggle (excluded) — scale pulse with glow */
  :global(.item-toggled) {
    animation: txnTogglePulse 0.6s ease-out forwards;
  }

  @keyframes txnTogglePulse {
    0%,
    100% {
      transform: scale(1);
      box-shadow: none;
    }
    25% {
      transform: scale(1.015);
      box-shadow:
        0 0 16px rgba(232, 185, 74, 0.18),
        inset 0 0 8px rgba(232, 200, 122, 0.04);
    }
  }
</style>
