<!--
  @fileoverview Accounts page — bank account management with Teller Connect
  integration and crystal-faceted UI design.

  Displays connected financial accounts grouped by institution, manages
  Teller Connect enrollment flow, and shows account totals summary.
-->
<script lang="ts">
  /**
   * @fileoverview Accounts page script — Teller Connect SDK loading,
   * enrollment management, account display, and balance calculations.
   */

  // ==========================================================================
  //                                IMPORTS
  // ==========================================================================

  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import {
    accountsStore,
    enrollmentsStore,
    transactionsStore,
    preloadAllStores
  } from '$lib/stores/data';
  import { isDemoMode, showDemoBlocked } from 'stellar-drive/demo';
  import { remoteChangesStore } from 'stellar-drive/stores';
  import { getConfig } from 'stellar-drive/config';
  import { debug } from 'stellar-drive/utils';
  import { formatCurrency, formatCurrencyCompact } from '$lib/utils/currency';
  import { remoteChangeAnimation, truncateTooltip } from 'stellar-drive/actions';
  import GemChart from '$lib/components/GemChart.svelte';
  import type { ChartDataPoint } from '$lib/components/GemChart.svelte';
  import type { TellerConnectStatic, TellerConnectEnrollment } from '$lib/teller/types';
  import type { Account, TellerEnrollment } from '$lib/types';
  import {
    parseCSV,
    autoDetectMapping,
    mapCSVToTransactions,
    type CSVColumnMapping
  } from '$lib/utils/csv';
  import { processTellerSyncData } from '$lib/teller/autoSync';
  import { addToast } from '$lib/stores/toast';

  // ==========================================================================
  //                           COMPONENT STATE
  // ==========================================================================

  /** Whether data has been loaded initially. */
  let loaded = $state(false);

  /** Whether Teller Connect SDK is loaded and ready. */
  let _tellerReady = $state(false);

  /** Whether we're currently loading the Teller Connect SDK. */
  let tellerLoading = $state(false);

  /** Whether Teller Connect UI is currently visible. */
  let tellerOpen = $state(false);

  /** Whether a sync operation is in progress after enrollment. */
  let syncing = $state(false);

  /** Enrollment ID pending disconnection confirmation. */
  let confirmDisconnectId = $state<string | null>(null);

  /** Whether a disconnect operation is in progress. */
  let disconnecting = $state(false);

  /** Account ID whose balance visibility is being toggled. */
  let togglingHidden = $state<string | null>(null);

  /** Whether the manual account creation modal is open. */
  let showManualModal = $state(false);

  /** Manual account form fields. */
  let manualInstitution = $state('');
  let manualName = $state('');
  let manualType = $state<'depository' | 'credit'>('depository');
  let manualSubtype = $state('checking');
  let manualLastFour = $state('');
  let manualCreditLimit = $state(0.0);
  let creatingManual = $state(false);

  /** Account name editing state. */
  let editingAccountId = $state<string | null>(null);
  let editingAccountName = $state('');
  let savingAccountName = $state(false);

  /** Whether the CSV import modal is open. */
  let showCSVModal = $state(false);

  /** The account ID receiving the CSV import. */
  let csvImportAccountId = $state<string | null>(null);

  /** The account type for sign normalisation during CSV import. */
  let csvImportAccountType = $state('depository');

  /** Current step in the CSV import flow (1=upload, 2=map, 3=review). */
  let csvStep = $state(1);

  /** Parsed CSV data. */
  let csvHeaders = $state<string[]>([]);
  let csvRows = $state<string[][]>([]);

  /** CSV column mapping. */
  let csvMapping = $state<Partial<CSVColumnMapping>>({});
  let csvSplitMode = $state(false);

  /** Mapped transactions ready for import. */
  let csvMappedTransactions = $state<
    Array<{ date: string; description: string; amount: string; csv_import_hash: string }>
  >([]);

  /** CSV import result feedback. */
  let csvImporting = $state(false);
  let csvImportResult = $state<{ inserted: number; skipped: number } | null>(null);

  /** Institution name pending manual deletion confirmation. */
  let confirmDeleteManualInst = $state<string | null>(null);
  let deletingManual = $state(false);

  /** Account ID pending individual deletion confirmation. */
  let confirmDeleteAccountId = $state<string | null>(null);
  let deletingAccount = $state(false);

  /** Edit modal state (manual accounts only). */
  let showEditModal = $state(false);
  let editingAccount = $state<Account | null>(null);
  let editInstitution = $state('');
  let editName = $state('');
  let editType = $state<'depository' | 'credit'>('depository');
  let editSubtype = $state('checking');
  let editLastFour = $state('');
  let editBalance = $state('');
  let editCreditLimit = $state('');
  let savingEdit = $state(false);

  /** Institution name smart-dropdown state for Add Manual modal. */
  let instDropdownOpen = $state(false);

  /** Institution name smart-dropdown state for Edit Account modal. */
  let editInstDropdownOpen = $state(false);

  /** Inline rename state for manual institution groups. */
  let renamingManualInst = $state<string | null>(null);
  let renameManualInstValue = $state('');
  let savingRename = $state(false);

  /** File input reference for CSV upload. */
  let csvFileInput: HTMLInputElement | undefined = $state(undefined);

  /** Whether the drag-drop zone is actively hovered. */
  let csvDragOver = $state(false);

  // ==========================================================================
  //                         DERIVED STATE
  // ==========================================================================

  /** All accounts from the store. */
  const accounts: Account[] = $derived($accountsStore ?? []);

  /** All enrollments from the store. */
  const enrollments: TellerEnrollment[] = $derived($enrollmentsStore ?? []);

  /** Teller configuration from runtime config (served by /api/config). */
  const tellerAppId = getConfig()?.extra?.PUBLIC_TELLER_APP_ID || '';
  const tellerEnvironment =
    (getConfig()?.extra?.PUBLIC_TELLER_ENVIRONMENT as 'sandbox' | 'development' | 'production') ||
    'sandbox';

  /**
   * Accounts grouped by institution name.
   * Each group includes the enrollment info and its accounts.
   * Manual accounts (no enrollment) are grouped by institution_name.
   */
  const accountsByInstitution = $derived.by(() => {
    const groups = new Map<
      string,
      {
        institutionName: string;
        enrollmentId: string;
        enrollmentStatus: string;
        lastSynced: string | null;
        accounts: typeof accounts;
      }
    >();

    // Teller enrollment groups
    for (const enrollment of enrollments) {
      groups.set(enrollment.id, {
        institutionName: enrollment.institution_name,
        enrollmentId: enrollment.id,
        enrollmentStatus: enrollment.status,
        lastSynced: enrollment.last_synced_at,
        accounts: []
      });
    }

    for (const account of accounts) {
      if (account.source === 'manual') {
        // Group manual accounts by institution_name
        const groupKey = `manual_${account.institution_name}`;
        if (!groups.has(groupKey)) {
          groups.set(groupKey, {
            institutionName: account.institution_name,
            enrollmentId: groupKey,
            enrollmentStatus: 'manual',
            lastSynced: null,
            accounts: []
          });
        }
        const g = groups.get(groupKey)!;
        g.accounts.push(account);
        // Track most recent balance_updated_at as the group's lastSynced
        if (account.balance_updated_at) {
          if (!g.lastSynced || account.balance_updated_at > g.lastSynced) {
            g.lastSynced = account.balance_updated_at;
          }
        }
      } else {
        const group = groups.get(account.enrollment_id ?? '');
        if (group) {
          group.accounts.push(account);
        }
      }
    }

    // Sort accounts within each group: visible first, then by name
    for (const group of groups.values()) {
      group.accounts.sort((a, b) => {
        if (a.is_hidden !== b.is_hidden) return a.is_hidden ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
    }

    return Array.from(groups.values()).sort((a, b) =>
      a.institutionName.localeCompare(b.institutionName)
    );
  });

  /** Unique institution names across all accounts (for smart-fill dropdown). */
  const existingInstitutionNames = $derived(
    [...new Set(accounts.map((a) => a.institution_name))].sort()
  );

  /** Institution names filtered by what the user has typed. */
  const instDropdownFiltered = $derived.by(() => {
    if (!manualInstitution.trim()) return existingInstitutionNames;
    const lower = manualInstitution.toLowerCase();
    return existingInstitutionNames.filter((n) => n.toLowerCase().includes(lower));
  });

  /** Institution names filtered by what the user has typed in the edit modal. */
  const editInstDropdownFiltered = $derived.by(() => {
    if (!editInstitution.trim()) return existingInstitutionNames;
    const lower = editInstitution.toLowerCase();
    return existingInstitutionNames.filter((n) => n.toLowerCase().includes(lower));
  });

  /** Set of existing transaction CSV import hashes (for pre-import duplicate detection). */
  const csvExistingHashes = $derived.by(() => {
    const txns = $transactionsStore ?? [];
    const hashes = new Set<string>();
    for (const t of txns as Array<{ csv_import_hash?: string }>) {
      if (t.csv_import_hash) hashes.add(t.csv_import_hash);
    }
    return hashes;
  });

  /** Number of new (non-duplicate) transactions in the pending CSV import. */
  const csvNewCount = $derived(
    csvMappedTransactions.filter((t) => !csvExistingHashes.has(t.csv_import_hash)).length
  );

  /** Number of duplicate transactions in the pending CSV import. */
  const csvDuplicateCount = $derived(
    csvMappedTransactions.filter((t) => csvExistingHashes.has(t.csv_import_hash)).length
  );

  /** Count of Teller-connected accounts. */
  const connectedCount = $derived(accounts.filter((a) => a.source !== 'manual').length);

  /** Count of manual accounts. */
  const manualCount = $derived(accounts.filter((a) => a.source === 'manual').length);

  /**
   * Total assets: sum of balances from depository accounts (checking, savings, etc).
   * Uses manual_balance_override when set, otherwise falls back to stored balance.
   */
  const totalAssets = $derived.by(() => {
    return accounts
      .filter((a) => a.type === 'depository' && !a.is_hidden)
      .reduce((sum, a) => {
        const balance = a.manual_balance_override
          ? parseFloat(a.manual_balance_override)
          : parseFloat(a.balance_available ?? a.balance_ledger ?? '0.00');
        return sum + (isNaN(balance) ? 0 : balance);
      }, 0);
  });

  /**
   * Total liabilities: sum of balances from credit accounts.
   * Credit card balances represent money owed, so they are liabilities.
   * Uses manual_balance_override when set, otherwise falls back to stored balance.
   */
  const totalLiabilities = $derived.by(() => {
    return accounts
      .filter((a) => a.type === 'credit' && !a.is_hidden)
      .reduce((sum, a) => {
        const balance = a.manual_balance_override
          ? parseFloat(a.manual_balance_override)
          : parseFloat(a.balance_ledger ?? a.balance_available ?? '0.00');
        return sum + (isNaN(balance) ? 0 : balance);
      }, 0);
  });

  /** Net position: assets minus liabilities. */
  const netPosition = $derived(totalAssets - totalLiabilities);

  /** Whether the Teller app ID is configured. */
  const hasTellerConfig = $derived(!!tellerAppId);

  // ==========================================================================
  //                     BALANCE HISTORY CHART DATA
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

  /** Cutoff date for the selected time range. */
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
   * Reconstruct daily balance history from current balances + transactions.
   *
   * Strategy: Build per-account sparse balance timelines, collect all unique
   * dates, then for each date sum every account's balance (carrying forward
   * the last known balance for accounts without a transaction that day).
   */
  const chartLines = $derived.by(() => {
    const txns = $transactionsStore ?? [];
    const accts = accounts.filter((a) => !a.is_hidden && a.status === 'open');
    if (accts.length === 0) return [];

    const cutoffStr = chartCutoff.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);

    // Pre-cancel credit card payment transfers: when a credit card payment
    // (negative on credit) matches a bank withdrawal (negative on depository)
    // of the same amount within 3 days, align both to the earlier date so
    // they don't create a temporary net-worth hump.
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

    // Step 1: Build per-account sparse balance snapshots
    const accountTimelines: {
      isDebt: boolean;
      snapshots: Map<string, number>;
      balanceAtCutoff: number;
    }[] = [];

    const allDates = new Set<string>();
    allDates.add(cutoffStr);
    allDates.add(todayStr);

    for (const acct of accts) {
      // Transaction-computed balance: used to anchor the historical reconstruction.
      // This is always the balance_available/balance_ledger from CSV imports or Teller sync.
      const txnComputedBal =
        parseFloat(
          acct.type === 'credit'
            ? (acct.balance_ledger ?? acct.balance_available ?? '0.00')
            : (acct.balance_available ?? acct.balance_ledger ?? '0.00')
        ) || 0;

      // Today's displayed balance: if the user has set a manual override, use that
      // for today's chart point. This creates a "step at today" effect — the historical
      // trajectory is still driven by transaction sums (anchored to txnComputedBal),
      // while today's point jumps to the manually-set balance. The offset between the
      // two appears as an immediate step at the rightmost point of the chart.
      const todayBal = acct.manual_balance_override
        ? parseFloat(acct.manual_balance_override) || 0
        : txnComputedBal;

      const acctTxns = txns
        .filter((t) => t.account_id === acct.id && !t.is_excluded)
        .map((t) => ({ ...t, date: dateOverrides.get(t.id) ?? t.date }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Starting balance = txnComputedBal minus all transactions ever.
      // We anchor to the transaction-computed balance (not the manual override) so
      // that the historical trajectory is unaffected by the manual balance edit.
      const totalTxnSum = acctTxns.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
      let running = txnComputedBal - totalTxnSum;

      // Fast-forward through pre-cutoff transactions
      let i = 0;
      while (i < acctTxns.length && acctTxns[i].date < cutoffStr) {
        running += parseFloat(acctTxns[i].amount) || 0;
        i++;
      }

      const balanceAtCutoff = running;
      const snapshots = new Map<string, number>();
      snapshots.set(cutoffStr, running);

      // Walk through in-range transactions
      while (i < acctTxns.length && acctTxns[i].date <= todayStr) {
        const txnDate = acctTxns[i].date;
        running += parseFloat(acctTxns[i].amount) || 0;
        i++;
        // Record after processing all txns for this day
        if (i >= acctTxns.length || acctTxns[i].date !== txnDate) {
          snapshots.set(txnDate, running);
          allDates.add(txnDate);
        }
      }

      // Force today's point to the manual override (if set) — this is where the
      // "step" between transaction-computed history and the override appears.
      snapshots.set(todayStr, todayBal);
      accountTimelines.push({ isDebt: acct.type === 'credit', snapshots, balanceAtCutoff });
    }

    // Step 2: For each date, sum all accounts (carry forward last known balance)
    const sortedDates = Array.from(allDates).sort();
    const assetsData: ChartDataPoint[] = [];
    const debtsData: ChartDataPoint[] = [];
    const lastKnown = accountTimelines.map((tl) => tl.balanceAtCutoff);

    for (const date of sortedDates) {
      let assetSum = 0;
      let debtSum = 0;

      for (let a = 0; a < accountTimelines.length; a++) {
        const snapshot = accountTimelines[a].snapshots.get(date);
        if (snapshot !== undefined) lastKnown[a] = snapshot;

        if (accountTimelines[a].isDebt) {
          // Trust the stored sign. An overpaid credit card has a negative
          // balance, which correctly *reduces* debtSum (user is owed money).
          debtSum += lastKnown[a];
        } else {
          assetSum += lastKnown[a];
        }
      }

      assetsData.push({ date, value: assetSum });
      debtsData.push({ date, value: debtSum });
    }

    const result = [];
    if (assetsData.some((d) => d.value !== 0)) {
      result.push({ label: 'Assets', color: '#3dd68c', data: assetsData });
    }
    if (debtsData.some((d) => d.value !== 0)) {
      result.push({ label: 'Debts', color: '#e85470', data: debtsData });
    }
    return result;
  });

  // ==========================================================================
  //                     TELLER SYNC DATA PROCESSING
  // ==========================================================================

  // processTellerSyncData is imported from $lib/teller/autoSync

  // ==========================================================================
  //                     TELLER CONNECT INTEGRATION
  // ==========================================================================

  /**
   * Load the Teller Connect SDK script dynamically.
   * Resolves when the script is loaded and ready.
   */
  function loadTellerConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[src*="teller.io"]')) {
        _tellerReady = true;
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.teller.io/connect/connect.js';
      script.onload = () => {
        _tellerReady = true;
        resolve();
      };
      script.onerror = () => reject(new Error('Failed to load Teller Connect'));
      document.body.appendChild(script);
    });
  }

  /**
   * Open the Teller Connect widget for linking a new financial institution,
   * or re-authenticating an existing enrollment whose access token has
   * expired. When `reconnectEnrollmentId` is supplied, the Teller Connect
   * modal opens in re-auth mode against that enrollment's Teller `enr_xxx`
   * id — the user re-enters bank credentials, Teller mints a fresh access
   * token, and we update the existing local enrollment in place (no data
   * loss, no duplicate accounts or transactions).
   */
  async function openTellerConnect(reconnectEnrollmentId?: string) {
    if (isDemoMode()) {
      showDemoBlocked('Connecting bank accounts is not available in demo mode');
      return;
    }
    if (!tellerAppId) {
      showFeedback('error', 'Teller app ID not configured. Deploy with PUBLIC_TELLER_APP_ID set.');
      return;
    }

    // For reconnects: look up the remote Teller enrollment id (enr_xxx) off
    // the local enrollment so Teller Connect knows which enrollment to reauth.
    let tellerEnrollmentId: string | undefined;
    if (reconnectEnrollmentId) {
      const localEnrollment = enrollments.find((e) => e.id === reconnectEnrollmentId);
      if (!localEnrollment) {
        showFeedback('error', 'Enrollment not found.');
        return;
      }
      tellerEnrollmentId = localEnrollment.enrollment_id;
    }

    tellerLoading = true;
    tellerOpen = true;

    try {
      await loadTellerConnect();

      const TellerConnect = (window as unknown as { TellerConnect: TellerConnectStatic })
        .TellerConnect;
      if (!TellerConnect) {
        throw new Error('TellerConnect not available after script load');
      }

      const tellerConnect = TellerConnect.setup({
        applicationId: tellerAppId,
        products: ['balance', 'transactions'],
        environment: tellerEnvironment,
        ...(tellerEnrollmentId ? { enrollmentId: tellerEnrollmentId } : {}),
        onSuccess: async (enrollment: TellerConnectEnrollment) => {
          tellerOpen = false;
          if (reconnectEnrollmentId) {
            await handleReconnectSuccess(reconnectEnrollmentId, enrollment);
          } else {
            await handleEnrollmentSuccess(enrollment);
          }
        },
        onInit: () => {
          tellerLoading = false;
        },
        onExit: () => {
          tellerLoading = false;
          tellerOpen = false;
        },
        onFailure: (error: { message: string }) => {
          tellerLoading = false;
          tellerOpen = false;
          showFeedback('error', `Connection failed: ${error.message}`);
        }
      });

      tellerConnect.open();
    } catch (err) {
      tellerLoading = false;
      tellerOpen = false;
      showFeedback('error', err instanceof Error ? err.message : 'Failed to open Teller Connect');
    }
  }

  /**
   * Handle successful re-authentication of an existing enrollment.
   * Updates the stored access token in place and kicks off a fresh sync —
   * no enrollment is created and no accounts or transactions are touched
   * beyond the normal sync upsert path.
   */
  async function handleReconnectSuccess(
    localEnrollmentId: string,
    enrollment: TellerConnectEnrollment
  ) {
    debug('log', '[ACCOUNTS] handleReconnectSuccess — enrollmentId:', localEnrollmentId);
    syncing = true;
    showFeedback('success', `Reconnected to ${enrollment.enrollment.institution.name}. Syncing...`);

    try {
      // Swap in the fresh access token (status cleared to 'connected' after sync)
      await enrollmentsStore.updateAccessToken(localEnrollmentId, enrollment.accessToken);

      // Fetch fresh data with the new token
      const response = await fetch('/api/teller/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: enrollment.accessToken })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Sync failed with status ${response.status}`);
      }

      const rawData = await response.json();
      const syncResult = await processTellerSyncData(rawData, localEnrollmentId);

      // Flip status back to 'connected' now that sync succeeded
      await enrollmentsStore.updateStatus(localEnrollmentId, 'connected');

      await Promise.all([
        accountsStore.refresh(),
        transactionsStore.refresh(),
        enrollmentsStore.refresh()
      ]);

      const parts: string[] = [];
      if (syncResult.newTransactions > 0)
        parts.push(
          `${syncResult.newTransactions} new transaction${syncResult.newTransactions !== 1 ? 's' : ''}`
        );
      if (syncResult.updatedTransactions > 0)
        parts.push(`${syncResult.updatedTransactions} updated`);
      const detail = parts.length > 0 ? ` — ${parts.join(', ')}` : '';
      showFeedback('success', `${enrollment.enrollment.institution.name} reconnected${detail}.`);
    } catch (err) {
      debug('error', '[ACCOUNTS] Reconnect sync error:', err);
      showFeedback(
        'error',
        err instanceof Error ? err.message : 'Reconnect sync failed. Please try again.'
      );
    } finally {
      syncing = false;
    }
  }

  /**
   * Handle successful enrollment from Teller Connect.
   * Stores the enrollment locally, fetches data via mTLS proxy, and
   * writes everything to IndexedDB via engine functions (offline-first).
   */
  async function handleEnrollmentSuccess(enrollment: TellerConnectEnrollment) {
    debug(
      'log',
      '[ACCOUNTS] handleEnrollmentSuccess — institution:',
      enrollment.enrollment.institution.name
    );
    syncing = true;
    showFeedback(
      'success',
      `Connected to ${enrollment.enrollment.institution.name}. Syncing accounts...`
    );

    try {
      // Save the enrollment locally first (IndexedDB → sync queue → Supabase)
      debug('log', '[ACCOUNTS] Creating enrollment in IndexedDB...');
      const localEnrollmentId = await enrollmentsStore.create({
        enrollment_id: enrollment.enrollment.id,
        institution_name: enrollment.enrollment.institution.name,
        institution_id: '',
        access_token: enrollment.accessToken,
        status: 'connected',
        last_synced_at: null,
        error_message: null
      });

      // Fetch raw Teller data via mTLS proxy (server is just a proxy, no DB writes)
      debug('log', '[ACCOUNTS] Fetching Teller data via /api/teller/sync...');
      const response = await fetch('/api/teller/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: enrollment.accessToken
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        debug('error', '[ACCOUNTS] Sync proxy failed:', response.status, errData);
        throw new Error(errData.error || `Sync failed with status ${response.status}`);
      }

      const rawData = await response.json();
      debug('log', '[ACCOUNTS] Teller data received:', {
        accounts: rawData.accounts?.length ?? 0,
        transactions: rawData.transactions?.length ?? 0
      });

      // Process data client-side: IndexedDB + sync queue (offline-first)
      const syncResult = await processTellerSyncData(rawData, localEnrollmentId);

      // Update enrollment last_synced_at
      await enrollmentsStore.updateStatus(localEnrollmentId, 'connected');

      // Refresh stores to pick up new data
      await Promise.all([
        accountsStore.refresh(),
        transactionsStore.refresh(),
        enrollmentsStore.refresh()
      ]);

      debug('log', '[ACCOUNTS] Enrollment sync complete');
      const parts: string[] = [];
      if (syncResult.newAccounts > 0)
        parts.push(
          `${syncResult.newAccounts} account${syncResult.newAccounts !== 1 ? 's' : ''} linked`
        );
      if (syncResult.updatedAccounts > 0)
        parts.push(
          `${syncResult.updatedAccounts} account${syncResult.updatedAccounts !== 1 ? 's' : ''} refreshed`
        );
      if (syncResult.newTransactions > 0)
        parts.push(
          `${syncResult.newTransactions} new transaction${syncResult.newTransactions !== 1 ? 's' : ''}`
        );
      if (syncResult.updatedTransactions > 0)
        parts.push(
          `${syncResult.updatedTransactions} transaction${syncResult.updatedTransactions !== 1 ? 's' : ''} updated`
        );
      const detail = parts.length > 0 ? ` — ${parts.join(', ')}` : '';
      showFeedback('success', `${enrollment.enrollment.institution.name} synced${detail}.`);
    } catch (err) {
      debug('error', '[ACCOUNTS] Enrollment sync error:', err);
      console.error('Enrollment sync error:', err);
      showFeedback('error', err instanceof Error ? err.message : 'Sync failed. Please try again.');
    } finally {
      syncing = false;
    }
  }

  /**
   * Retry sync for an existing enrollment using its stored access token.
   * Fetches fresh data via mTLS proxy and writes to IndexedDB (offline-first).
   */
  async function retrySyncEnrollment(enrollmentId: string) {
    debug('log', '[ACCOUNTS] retrySyncEnrollment —', enrollmentId);
    if (isDemoMode()) {
      showDemoBlocked('Syncing with banks is not available in demo mode');
      return;
    }
    const enrollment = enrollments.find((e) => e.id === enrollmentId);
    if (!enrollment?.access_token) {
      debug('warn', '[ACCOUNTS] No access token for enrollment', enrollmentId);
      showFeedback('error', 'No access token stored for this enrollment.');
      return;
    }

    syncing = true;
    showFeedback('success', `Re-syncing ${enrollment.institution_name}...`);

    try {
      // Fetch raw Teller data via mTLS proxy
      debug('log', '[ACCOUNTS] Fetching Teller data for retry sync...');
      const response = await fetch('/api/teller/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: enrollment.access_token
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Sync failed with status ${response.status}`);
      }

      const rawData = await response.json();

      // Process data client-side: IndexedDB + sync queue (offline-first)
      const syncResult = await processTellerSyncData(rawData, enrollment.id);

      // Always force-update last_synced_at so manual syncs are always reflected in the UI
      await enrollmentsStore.updateStatus(enrollment.id, 'connected', undefined, true);

      await Promise.all([
        accountsStore.refresh(),
        transactionsStore.refresh(),
        enrollmentsStore.refresh()
      ]);
      debug('log', '[ACCOUNTS] retrySyncEnrollment complete —', enrollment.institution_name);
      const parts: string[] = [];
      if (syncResult.updatedAccounts > 0)
        parts.push(
          `${syncResult.updatedAccounts} account${syncResult.updatedAccounts !== 1 ? 's' : ''} refreshed`
        );
      if (syncResult.newTransactions > 0)
        parts.push(
          `${syncResult.newTransactions} new transaction${syncResult.newTransactions !== 1 ? 's' : ''}`
        );
      if (syncResult.updatedTransactions > 0)
        parts.push(`${syncResult.updatedTransactions} updated`);
      if (
        syncResult.newTransactions === 0 &&
        syncResult.updatedTransactions === 0 &&
        syncResult.updatedAccounts === 0
      )
        parts.push('already up to date');
      showFeedback('success', `${enrollment.institution_name} — ${parts.join(', ')}.`);
    } catch (err) {
      debug('error', '[ACCOUNTS] retrySyncEnrollment failed:', err);
      console.error('Retry sync error:', err);
      showFeedback('error', err instanceof Error ? err.message : 'Sync failed. Please try again.');
    } finally {
      syncing = false;
    }
  }

  /**
   * Disconnect an enrollment (remove all associated data).
   */
  async function disconnectEnrollment(enrollmentId: string) {
    disconnecting = true;
    debug('log', '[ACCOUNTS] disconnectEnrollment —', enrollmentId);
    try {
      // Cascade: delete all accounts (and their transactions) for this enrollment
      const enrollmentAccounts = accounts.filter((a) => a.enrollment_id === enrollmentId);
      debug(
        'log',
        '[ACCOUNTS] Cascade deleting',
        enrollmentAccounts.length,
        'accounts for enrollment',
        enrollmentId
      );
      for (const acct of enrollmentAccounts) {
        await accountsStore.deleteAccount(acct.id);
      }
      await enrollmentsStore.remove(enrollmentId);
      await Promise.all([accountsStore.refresh(), enrollmentsStore.refresh()]);
      confirmDisconnectId = null;
      showFeedback('success', 'Institution disconnected and all data removed.');
    } catch (err) {
      console.error('Disconnect error:', err);
      showFeedback('error', 'Failed to disconnect. Please try again.');
    } finally {
      disconnecting = false;
    }
  }

  /**
   * Toggle an account's hidden/visible state.
   */
  async function toggleAccountHidden(accountId: string, currentlyHidden: boolean) {
    togglingHidden = accountId;
    debug('log', '[ACCOUNTS] toggleAccountHidden —', accountId, 'hidden:', !currentlyHidden);
    try {
      const { engineUpdate } = await import('stellar-drive');
      remoteChangesStore.recordLocalChange(accountId, 'accounts', 'toggle');
      await engineUpdate('accounts', accountId, { is_hidden: !currentlyHidden });
      await accountsStore.refresh();
      addToast(
        !currentlyHidden ? 'Account hidden from totals' : 'Account visible in totals',
        'sapphire'
      );
    } catch (err) {
      console.error('Toggle hidden error:', err);
      addToast('Failed to update account visibility', 'ruby');
    } finally {
      togglingHidden = null;
    }
  }

  // ==========================================================================
  //                           HELPERS
  // ==========================================================================

  /**
   * Display a feedback message via the global gem toast system.
   * Maps success → emerald, error → ruby.
   */
  function showFeedback(type: 'success' | 'error', message: string) {
    addToast(message, type === 'success' ? 'emerald' : 'ruby');
  }

  /**
   * Get a display label for the account subtype.
   */
  function subtypeLabel(subtype: string): string {
    const labels: Record<string, string> = {
      checking: 'Checking',
      savings: 'Savings',
      money_market: 'Money Market',
      certificate_of_deposit: 'CD',
      treasury: 'Treasury',
      sweep: 'Sweep',
      credit_card: 'Credit Card'
    };
    return labels[subtype] ?? subtype;
  }

  /**
   * Get the primary balance to display for an account.
   * Uses manual_balance_override when set, otherwise uses stored balance fields.
   * For bank accounts: shows available balance.
   * For credit cards: shows current balance owed (ledger).
   */
  function displayBalance(account: (typeof accounts)[0]): string {
    if (account.manual_balance_override) {
      const val = parseFloat(account.manual_balance_override);
      if (!isNaN(val)) return formatCurrency(val);
    }
    if (account.type === 'credit') {
      const ledger = account.balance_ledger;
      if (!ledger) return '--';
      return formatCurrency(parseFloat(ledger));
    }
    const balance = account.balance_available ?? account.balance_ledger;
    if (!balance) return '--';
    return formatCurrency(balance);
  }

  /**
   * Get the credit limit for a credit card account.
   * Uses manual_credit_limit when set, otherwise computes limit = available + ledger.
   */
  function creditLimit(account: (typeof accounts)[0]): string | null {
    if (account.type !== 'credit') return null;
    if (account.manual_credit_limit) {
      const val = parseFloat(account.manual_credit_limit);
      if (!isNaN(val) && val > 0) return formatCurrency(val);
    }
    const ledger = parseFloat(account.balance_ledger ?? '0.00');
    const available = parseFloat(account.balance_available ?? '0.00');
    if (!ledger && !available) return null;
    return formatCurrency(available + ledger);
  }

  /**
   * Format a timestamp to a relative or absolute time string.
   */
  function formatLastSync(timestamp: string | null): string {
    if (!timestamp) return 'Never synced';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /**
   * Get the status badge color class for an enrollment status.
   */
  function statusClass(status: string): string {
    if (status === 'connected') return 'status-connected';
    if (status === 'manual') return 'status-manual';
    if (status === 'error') return 'status-error';
    return 'status-disconnected';
  }

  /**
   * Get the account type icon SVG based on account type.
   */
  function accountTypeIcon(type: string, subtype: string): string {
    if (type === 'credit' || subtype === 'credit_card') return 'credit';
    if (subtype === 'savings' || subtype === 'money_market' || subtype === 'certificate_of_deposit')
      return 'savings';
    return 'checking';
  }

  // ==========================================================================
  //                    MANUAL ACCOUNTS & CSV IMPORT
  // ==========================================================================

  /** Available subtypes filtered by the selected account type. */
  const manualSubtypes = $derived(
    manualType === 'depository'
      ? [
          { value: 'checking', label: 'Checking' },
          { value: 'savings', label: 'Savings' },
          { value: 'money_market', label: 'Money Market' }
        ]
      : [{ value: 'credit_card', label: 'Credit Card' }]
  );

  // When type changes, reset subtype to first valid option
  $effect(() => {
    if (manualType === 'depository' && manualSubtype === 'credit_card') {
      manualSubtype = 'checking';
    } else if (manualType === 'credit' && manualSubtype !== 'credit_card') {
      manualSubtype = 'credit_card';
    }
  });

  /** Reset manual form to defaults. */
  function resetManualForm() {
    manualInstitution = '';
    manualName = '';
    manualType = 'depository';
    manualSubtype = 'checking';
    manualLastFour = '';
    manualCreditLimit = 0.0;
  }

  /** Create a new manual account. */
  async function createManualAccount() {
    if (!manualInstitution.trim() || !manualName.trim()) return;
    creatingManual = true;
    debug('log', '[ACCOUNTS] createManualAccount —', {
      institution: manualInstitution.trim(),
      name: manualName.trim(),
      type: manualType,
      subtype: manualSubtype
    });
    try {
      const id = await accountsStore.createManualAccount({
        institution_name: manualInstitution.trim(),
        name: manualName.trim(),
        type: manualType,
        subtype: manualSubtype,
        currency: 'USD',
        last_four: manualLastFour.trim() ? manualLastFour.trim().slice(-4) : null,
        status: 'open',
        balance_available: manualType === 'credit' ? manualCreditLimit.toFixed(2) : '0.00',
        balance_ledger: '0.00',
        balance_updated_at: new Date().toISOString(),
        is_hidden: false
      });
      const accountName = manualName.trim();
      debug('log', '[ACCOUNTS] Manual account created — id:', id);
      showManualModal = false;
      resetManualForm();
      showFeedback(
        'success',
        `Account "${accountName}" created. You can now import transactions via CSV.`
      );

      // Optionally open CSV import for the new account
      csvImportAccountId = id;
      csvImportAccountType = manualType;
      openCSVModal();
    } catch (err) {
      debug('error', '[ACCOUNTS] createManualAccount failed:', err);
      console.error('Create manual account error:', err);
      showFeedback('error', err instanceof Error ? err.message : 'Failed to create account.');
    } finally {
      creatingManual = false;
    }
  }

  /** Delete all manual accounts for an institution. */
  async function deleteManualInstitution(institutionName: string) {
    deletingManual = true;
    debug('log', '[ACCOUNTS] deleteManualInstitution —', institutionName);
    try {
      const manualAccounts = accounts.filter(
        (a) => a.source === 'manual' && a.institution_name === institutionName
      );
      debug('log', '[ACCOUNTS] Deleting', manualAccounts.length, 'accounts for', institutionName);
      for (const acct of manualAccounts) {
        debug('log', '[ACCOUNTS] Deleting account (with cascade)', acct.id);
        await accountsStore.deleteAccount(acct.id);
      }
      confirmDeleteManualInst = null;
      showFeedback('success', `"${institutionName}" and all its accounts removed.`);
    } catch (err) {
      debug('error', '[ACCOUNTS] deleteManualInstitution failed:', err);
      console.error('Delete manual institution error:', err);
      showFeedback('error', 'Failed to delete institution. Please try again.');
    } finally {
      deletingManual = false;
    }
  }

  /** Rename a manual institution group (updates all accounts in that group). */
  async function renameManualInstitution(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) {
      renamingManualInst = null;
      return;
    }
    savingRename = true;
    debug('log', '[ACCOUNTS] renameManualInstitution —', oldName, '->', trimmed);
    try {
      const { engineUpdate } = await import('stellar-drive');
      const manualAccounts = accounts.filter(
        (a) => a.source === 'manual' && a.institution_name === oldName
      );
      for (const acct of manualAccounts) {
        remoteChangesStore.recordLocalChange(acct.id, 'accounts', 'update');
        await engineUpdate('accounts', acct.id, { institution_name: trimmed });
      }
      await accountsStore.refresh();
      renamingManualInst = null;
      showFeedback('success', `Institution renamed to "${trimmed}".`);
    } catch (err) {
      debug('error', '[ACCOUNTS] renameManualInstitution failed:', err);
      console.error('Rename institution error:', err);
      showFeedback('error', 'Failed to rename institution. Please try again.');
    } finally {
      savingRename = false;
    }
  }

  /** Delete a single account (with its transactions and recurring references). */
  async function deleteAccount(accountId: string) {
    deletingAccount = true;
    debug('log', '[ACCOUNTS] deleteAccount —', accountId);
    try {
      await accountsStore.deleteAccount(accountId);
      await Promise.all([accountsStore.refresh()]);
      confirmDeleteAccountId = null;
      showFeedback('success', 'Account and all its data removed.');
    } catch (err) {
      debug('error', '[ACCOUNTS] deleteAccount failed:', err);
      console.error('Delete account error:', err);
      showFeedback('error', 'Failed to delete account. Please try again.');
    } finally {
      deletingAccount = false;
    }
  }

  /** Open the edit modal for a manual account. */
  function openEditModal(account: Account) {
    editingAccount = account;
    editInstitution = account.institution_name;
    editName = account.name;
    editType = account.type as 'depository' | 'credit';
    editSubtype = account.subtype;
    editLastFour = account.last_four ?? '';
    if (account.type === 'credit') {
      editBalance = account.manual_balance_override
        ? account.manual_balance_override
        : (account.balance_ledger ?? '0');
      const limitStr = account.manual_credit_limit
        ? account.manual_credit_limit
        : (
            parseFloat(account.balance_ledger ?? '0') + parseFloat(account.balance_available ?? '0')
          ).toFixed(2);
      editCreditLimit = limitStr;
    } else {
      editBalance = account.manual_balance_override
        ? account.manual_balance_override
        : (account.balance_available ?? account.balance_ledger ?? '0');
      editCreditLimit = '';
    }
    showEditModal = true;
  }

  /** Available subtypes for the edit form filtered by type. */
  const editSubtypes = $derived(
    editType === 'depository'
      ? [
          { value: 'checking', label: 'Checking' },
          { value: 'savings', label: 'Savings' },
          { value: 'money_market', label: 'Money Market' }
        ]
      : [{ value: 'credit_card', label: 'Credit Card' }]
  );

  // When edit type changes, reset subtype to first valid option
  $effect(() => {
    if (editType === 'depository' && editSubtype === 'credit_card') {
      editSubtype = 'checking';
    } else if (editType === 'credit' && editSubtype !== 'credit_card') {
      editSubtype = 'credit_card';
    }
  });

  /** Save all edits from the edit modal to the account. */
  async function saveAccountEdit() {
    if (!editingAccount || savingEdit) return;
    if (!editInstitution.trim() || !editName.trim()) return;

    savingEdit = true;
    const account = editingAccount;
    debug('log', '[ACCOUNTS] saveAccountEdit —', account.id);

    try {
      const { engineUpdate: eng } = await import('stellar-drive');
      const fields: Record<string, unknown> = {
        institution_name: editInstitution.trim(),
        name: editName.trim(),
        type: editType,
        subtype: editSubtype,
        last_four: editLastFour.trim() ? editLastFour.trim().slice(-4) : null
      };

      if (editType === 'credit') {
        const creditUsed = parseFloat(editBalance) || 0;
        const limit = parseFloat(editCreditLimit) || 0;
        // Store credit used as manual override (for chart step-at-today behavior)
        fields.manual_balance_override = creditUsed.toFixed(2);
        fields.manual_credit_limit = limit > 0 ? limit.toFixed(2) : null;
      } else {
        const balance = parseFloat(editBalance) || 0;
        // Store the manually-set balance as override (for chart step-at-today behavior).
        // balance_available/balance_ledger remain as transaction-computed anchors.
        fields.manual_balance_override = balance.toFixed(2);
        fields.manual_credit_limit = null;
      }

      remoteChangesStore.recordLocalChange(account.id, 'accounts', 'update');
      await eng('accounts', account.id, fields);
      await accountsStore.refresh();

      showEditModal = false;
      editingAccount = null;
      showFeedback('success', 'Account updated.');
    } catch (err) {
      debug('error', '[ACCOUNTS] saveAccountEdit failed:', err);
      console.error('Save account edit error:', err);
      showFeedback('error', 'Failed to save changes. Please try again.');
    } finally {
      savingEdit = false;
    }
  }

  /** Start editing an account name. Only for manual accounts. */
  function startEditingName(account: Account) {
    if (account.source !== 'manual') return;
    editingAccountId = account.id;
    editingAccountName = account.name;
  }

  /** Save account name edit. */
  async function saveAccountName(accountId: string) {
    if (!editingAccountName.trim() || savingAccountName) return;
    savingAccountName = true;
    debug('log', '[ACCOUNTS] saveAccountName —', accountId, '→', editingAccountName.trim());
    try {
      const { engineUpdate } = await import('stellar-drive');
      remoteChangesStore.recordLocalChange(accountId, 'accounts', 'rename');
      await engineUpdate('accounts', accountId, { name: editingAccountName.trim() });
      await accountsStore.refresh();
      editingAccountId = null;
    } catch (err) {
      console.error('Save account name error:', err);
      showFeedback('error', 'Failed to update account name.');
    } finally {
      savingAccountName = false;
    }
  }

  /** Open CSV import for a specific account. */
  function openCSVForAccount(account: Account) {
    csvImportAccountId = account.id;
    csvImportAccountType = account.type;
    openCSVModal();
  }

  /** Open the CSV import modal. */
  function openCSVModal() {
    csvStep = 1;
    csvHeaders = [];
    csvRows = [];
    csvMapping = {};
    csvSplitMode = false;
    csvMappedTransactions = [];
    csvImportResult = null;
    showCSVModal = true;
  }

  /** Handle CSV file selection (from input or drag-drop). */
  function handleCSVFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;
      const result = parseCSV(text);
      csvHeaders = result.headers;
      csvRows = result.rows;

      // Auto-detect mapping
      const detected = autoDetectMapping(result.headers);
      csvMapping = detected.mapping;
      csvSplitMode = detected.splitMode;
    };
    reader.readAsText(file);
  }

  /** Handle file input change. */
  function onCSVFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) handleCSVFile(file);
  }

  /** Handle drag-drop. */
  function onCSVDrop(e: DragEvent) {
    e.preventDefault();
    csvDragOver = false;
    const file = e.dataTransfer?.files[0];
    if (file && file.name.endsWith('.csv')) handleCSVFile(file);
  }

  /** Advance to column mapping step. */
  function goToMapStep() {
    csvStep = 2;
  }

  /** Build mapped transactions and advance to review. */
  function goToReviewStep() {
    if (!csvImportAccountId) return;
    const fullMapping: CSVColumnMapping = {
      date: csvMapping.date ?? '',
      description: csvMapping.description ?? '',
      ...(csvSplitMode
        ? { credit: csvMapping.credit ?? '', debit: csvMapping.debit ?? '' }
        : { amount: csvMapping.amount ?? '' })
    };
    csvMappedTransactions = mapCSVToTransactions(
      csvRows,
      csvHeaders,
      fullMapping,
      csvImportAccountId,
      csvImportAccountType
    );
    csvStep = 3;
  }

  /** Whether the current mapping is complete enough to proceed. */
  const csvMappingValid = $derived(
    !!(
      csvMapping.date &&
      csvMapping.description &&
      (csvSplitMode ? csvMapping.credit && csvMapping.debit : csvMapping.amount)
    )
  );

  /** Preview rows for the mapping step (up to 3). */
  const csvPreviewMapped = $derived.by(() => {
    if (!csvImportAccountId || !csvMappingValid) return [];
    const fullMapping: CSVColumnMapping = {
      date: csvMapping.date ?? '',
      description: csvMapping.description ?? '',
      ...(csvSplitMode
        ? { credit: csvMapping.credit ?? '', debit: csvMapping.debit ?? '' }
        : { amount: csvMapping.amount ?? '' })
    };
    return mapCSVToTransactions(
      csvRows.slice(0, 3),
      csvHeaders,
      fullMapping,
      csvImportAccountId,
      csvImportAccountType
    );
  });

  /** Run the CSV import. */
  async function importCSV() {
    if (!csvImportAccountId || csvMappedTransactions.length === 0) return;
    csvImporting = true;
    debug(
      'log',
      '[ACCOUNTS] importCSV — accountId:',
      csvImportAccountId,
      'transactions:',
      csvMappedTransactions.length
    );
    try {
      const result = await transactionsStore.bulkCreateFromCSV(
        csvMappedTransactions,
        csvImportAccountId
      );
      debug('log', '[ACCOUNTS] CSV import result:', result);
      csvImportResult = result;

      // Recompute balance from all transactions for this account
      await transactionsStore.refresh();
      const allTxns = ($transactionsStore ?? []).filter(
        (t: { account_id: string; is_excluded?: boolean }) =>
          t.account_id === csvImportAccountId && !t.is_excluded
      );
      const balance = allTxns.reduce(
        (sum: number, t: { amount: string }) => sum + (parseFloat(t.amount) || 0),
        0
      );
      debug(
        'log',
        '[ACCOUNTS] Recomputed balance for account:',
        csvImportAccountId,
        '=',
        balance.toFixed(2),
        '(from',
        allTxns.length,
        'txns)'
      );
      await accountsStore.updateBalance(csvImportAccountId!, balance.toFixed(2));

      showFeedback(
        'success',
        `Imported ${result.inserted} transactions${result.skipped > 0 ? ` (${result.skipped} duplicates skipped)` : ''}.`
      );
    } catch (err) {
      debug('error', '[ACCOUNTS] importCSV failed:', err);
      console.error('CSV import error:', err);
      showFeedback('error', err instanceof Error ? err.message : 'Import failed.');
    } finally {
      csvImporting = false;
    }
  }

  // ==========================================================================
  //                           LIFECYCLE
  // ==========================================================================

  /** Lock body scroll when any modal is open. */
  const anyModalOpen = $derived(showManualModal || showCSVModal || tellerOpen || showEditModal);

  $effect(() => {
    if (browser && anyModalOpen) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  });

  onMount(async () => {
    await preloadAllStores();
    loaded = true;

    // Pre-load Teller Connect SDK in the background if configured
    if (browser && tellerAppId) {
      loadTellerConnect().catch(() => {
        // Silent fail — will retry when user clicks Connect
      });
    }
  });
</script>

<svelte:head>
  <title>Accounts - Radiant Finance</title>
</svelte:head>

<!-- ═══════════════════════════════════════════════════════════════════════════
     PAGE TEMPLATE
     ═══════════════════════════════════════════════════════════════════════════ -->

<div class="accounts-page">
  <!-- ── Header ─────────────────────────────────────────────────────── -->
  <header class="page-header">
    <div class="header-left">
      <div class="title-gem">
        <div class="title-flare f1"></div>
        <div class="title-flare f2"></div>
        <h1 class="page-title">Accounts</h1>
      </div>
      <p class="page-subtitle">
        {#if connectedCount > 0 && manualCount > 0}
          {connectedCount} connected, {manualCount} manual
        {:else if manualCount > 0}
          {manualCount} manual account{manualCount !== 1 ? 's' : ''}
        {:else}
          {connectedCount} account{connectedCount !== 1 ? 's' : ''} connected
        {/if}
      </p>
    </div>
    <div class="header-actions">
      <button
        class="connect-btn"
        onclick={() => openTellerConnect()}
        disabled={tellerLoading || syncing}
      >
        {#if tellerLoading || syncing}
          <div class="btn-spinner"></div>
          {syncing ? 'Syncing...' : 'Connecting...'}
        {:else}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path
              d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
            /></svg
          >
          Link Bank
        {/if}
      </button>
      <button class="manual-btn" onclick={() => (showManualModal = true)}>
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
        Add Manual
      </button>
    </div>
  </header>

  {#if !loaded}
    <!-- ── Loading State ─────────────────────────────────────────── -->
    <div class="loading-state">
      <div class="crystal-loader">
        <div class="loader-shard"></div>
        <div class="loader-shard"></div>
        <div class="loader-shard"></div>
        <div class="loader-shard"></div>
      </div>
      <p class="loading-text">Retrieving your accounts...</p>
    </div>
  {:else if accountsByInstitution.length === 0}
    <!-- ── Empty State ───────────────────────────────────────────── -->
    <div class="empty-state">
      <div class="empty-crystal">
        <svg width="96" height="96" viewBox="0 0 96 96" fill="none">
          <!-- Crystal cluster -->
          <path
            d="M48 12L62 36L48 60L34 36L48 12Z"
            stroke="url(#crystGrad1)"
            stroke-width="1.5"
            fill="url(#crystGrad1)"
            fill-opacity="0.08"
          />
          <path
            d="M30 28L42 48L30 68L18 48L30 28Z"
            stroke="url(#crystGrad2)"
            stroke-width="1.5"
            fill="url(#crystGrad2)"
            fill-opacity="0.06"
          />
          <path
            d="M66 28L78 48L66 68L54 48L66 28Z"
            stroke="url(#crystGrad2)"
            stroke-width="1.5"
            fill="url(#crystGrad2)"
            fill-opacity="0.06"
          />
          <!-- Facet lines -->
          <line
            x1="48"
            y1="12"
            x2="48"
            y2="60"
            stroke="url(#crystGrad1)"
            stroke-width="0.8"
            opacity="0.3"
          />
          <line
            x1="34"
            y1="36"
            x2="62"
            y2="36"
            stroke="url(#crystGrad1)"
            stroke-width="0.8"
            opacity="0.3"
          />
          <!-- Connection dots -->
          <circle cx="48" cy="72" r="2" fill="url(#crystGrad1)" opacity="0.5" />
          <circle cx="38" cy="76" r="1.5" fill="url(#crystGrad2)" opacity="0.4" />
          <circle cx="58" cy="76" r="1.5" fill="url(#crystGrad2)" opacity="0.4" />
          <line
            x1="38"
            y1="76"
            x2="48"
            y2="72"
            stroke="url(#crystGrad2)"
            stroke-width="0.8"
            opacity="0.2"
          />
          <line
            x1="58"
            y1="76"
            x2="48"
            y2="72"
            stroke="url(#crystGrad2)"
            stroke-width="0.8"
            opacity="0.2"
          />
          <defs>
            <linearGradient id="crystGrad1" x1="34" y1="12" x2="62" y2="60">
              <stop offset="0%" stop-color="#67e8f9" />
              <stop offset="100%" stop-color="#2ec4a6" />
            </linearGradient>
            <linearGradient id="crystGrad2" x1="18" y1="28" x2="78" y2="68">
              <stop offset="0%" stop-color="#e8b94a" />
              <stop offset="100%" stop-color="#b8862e" />
            </linearGradient>
          </defs>
        </svg>
      </div>
      <h2 class="empty-title">Connect your first account</h2>
      <p class="empty-desc">
        Link your bank accounts and credit cards to see all your finances in one crystal-clear view.
      </p>
      {#if !hasTellerConfig}
        <p class="empty-config-hint">First, add your Teller App ID in Settings.</p>
      {/if}
      <button
        class="connect-btn empty-cta"
        onclick={() => openTellerConnect()}
        disabled={tellerLoading || syncing}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          ><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path
            d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"
          /></svg
        >
        Connect with Teller
      </button>
    </div>
  {:else}
    <!-- ── Account Totals Summary ────────────────────────────────── -->
    <div class="totals-bar">
      <div class="total-item">
        <span class="total-label">Total Assets</span>
        <span class="total-value assets">{formatCurrency(totalAssets)}</span>
      </div>
      <div class="total-divider"></div>
      <div class="total-item">
        <span class="total-label">Total Liabilities</span>
        <span class="total-value liabilities">{formatCurrency(totalLiabilities)}</span>
      </div>
      <div class="total-divider"></div>
      <div class="total-item">
        <span class="total-label">Net Position</span>
        <span
          class="total-value"
          class:positive={netPosition >= 0}
          class:negative={netPosition < 0}
        >
          {formatCurrency(netPosition)}
        </span>
      </div>
    </div>

    <!-- ── Balance History Chart ──────────────────────────────────── -->
    <div class="chart-section">
      <GemChart
        title="Balance History"
        lines={chartLines}
        timeRanges={chartTimeRanges}
        selectedRange={chartRange}
        onRangeChange={(r) => (chartRange = r)}
        height={200}
        formatValue={formatCurrencyCompact}
      />
    </div>

    <!-- ── Institution Groups ────────────────────────────────────── -->
    <div class="institutions-list">
      {#each accountsByInstitution as group, gi (group.enrollmentId)}
        <div class="institution-group" style="--group-delay: {gi * 80}ms">
          <!-- Institution Header -->
          <div class="institution-header">
            <div class="inst-info">
              <div class="inst-icon">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path
                    d="M9 21v-4h6v4"
                  /><path d="M9 9h.01" /><path d="M15 9h.01" /><path d="M9 13h.01" /><path
                    d="M15 13h.01"
                  /></svg
                >
              </div>
              <div class="inst-text">
                {#if renamingManualInst === group.institutionName}
                  <div class="inst-rename-wrap">
                    <input
                      class="inst-rename-input"
                      type="text"
                      bind:value={renameManualInstValue}
                      onkeydown={(e) => {
                        if (e.key === 'Enter')
                          renameManualInstitution(group.institutionName, renameManualInstValue);
                        if (e.key === 'Escape') renamingManualInst = null;
                      }}
                      aria-label="Rename institution"
                    />
                    <button
                      class="inst-rename-confirm"
                      onclick={() =>
                        renameManualInstitution(group.institutionName, renameManualInstValue)}
                      disabled={savingRename}
                      aria-label="Save rename"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg
                      >
                    </button>
                    <button
                      class="inst-rename-cancel"
                      onclick={() => (renamingManualInst = null)}
                      aria-label="Cancel rename"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        ><line x1="18" y1="6" x2="6" y2="18" /><line
                          x1="6"
                          y1="6"
                          x2="18"
                          y2="18"
                        /></svg
                      >
                    </button>
                  </div>
                {:else}
                  <h2 class="inst-name" use:truncateTooltip>{group.institutionName}</h2>
                  {#if group.enrollmentStatus !== 'manual'}
                    <span class="inst-sync">{formatLastSync(group.lastSynced)}</span>
                  {/if}
                {/if}
              </div>
            </div>
            <div class="inst-actions">
              <span class="status-badge {statusClass(group.enrollmentStatus)}">
                {group.enrollmentStatus === 'manual' ? 'Manual' : group.enrollmentStatus}
              </span>
              {#if group.enrollmentStatus === 'manual'}
                <!-- Manual institution actions -->
                {#if confirmDeleteManualInst === group.institutionName}
                  <div class="disconnect-confirm">
                    <button
                      class="btn-danger-sm"
                      onclick={() => deleteManualInstitution(group.institutionName)}
                      disabled={deletingManual}
                    >
                      {deletingManual ? 'Removing...' : 'Confirm'}
                    </button>
                    <button class="btn-ghost-sm" onclick={() => (confirmDeleteManualInst = null)}>
                      Cancel
                    </button>
                  </div>
                {:else}
                  <button
                    class="inst-rename-btn"
                    onclick={() => {
                      renamingManualInst = group.institutionName;
                      renameManualInstValue = group.institutionName;
                      confirmDeleteManualInst = null;
                    }}
                    aria-label="Rename {group.institutionName}"
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
                      ><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path
                        d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"
                      /></svg
                    >
                  </button>
                  <button
                    class="disconnect-btn"
                    onclick={() => (confirmDeleteManualInst = group.institutionName)}
                    aria-label="Delete {group.institutionName}"
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
                      ><line x1="18" y1="6" x2="6" y2="18" /><line
                        x1="6"
                        y1="6"
                        x2="18"
                        y2="18"
                      /></svg
                    >
                  </button>
                {/if}
              {:else if confirmDisconnectId === group.enrollmentId}
                <div class="disconnect-confirm">
                  <button
                    class="btn-danger-sm"
                    onclick={() => disconnectEnrollment(group.enrollmentId)}
                    disabled={disconnecting}
                  >
                    {disconnecting ? 'Removing...' : 'Confirm'}
                  </button>
                  <button class="btn-ghost-sm" onclick={() => (confirmDisconnectId = null)}>
                    Cancel
                  </button>
                </div>
              {:else}
                {#if group.enrollmentStatus === 'connected'}
                  <button
                    class="sync-btn"
                    onclick={() => retrySyncEnrollment(group.enrollmentId)}
                    disabled={syncing}
                    aria-label="Re-sync {group.institutionName}"
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
                      ><polyline points="23 4 23 10 17 10" /><path
                        d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"
                      /></svg
                    >
                  </button>
                {/if}
                <button
                  class="disconnect-btn"
                  onclick={() => (confirmDisconnectId = group.enrollmentId)}
                  aria-label="Disconnect {group.institutionName}"
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
                    ><line x1="18" y1="6" x2="6" y2="18" /><line
                      x1="6"
                      y1="6"
                      x2="18"
                      y2="18"
                    /></svg
                  >
                </button>
              {/if}
            </div>
          </div>

          {#if group.enrollmentStatus === 'disconnected' || group.enrollmentStatus === 'error'}
            {@const isAuth = group.enrollmentStatus === 'disconnected'}
            <div
              class="reconnect-banner"
              class:reconnect-banner-auth={isAuth}
              class:reconnect-banner-error={!isAuth}
              role="alert"
            >
              <div class="reconnect-aura" aria-hidden="true"></div>
              <div class="reconnect-content">
                <div class="reconnect-icon" aria-hidden="true">
                  {#if isAuth}
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                    </svg>
                  {:else}
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path
                        d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                      />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                  {/if}
                </div>
                <div class="reconnect-text">
                  <div class="reconnect-title">
                    {isAuth ? 'Connection needs re-authorization' : 'Sync temporarily unavailable'}
                  </div>
                  <div class="reconnect-desc">
                    {isAuth
                      ? 'Your bank expired this link — new transactions won\u2019t appear until you sign in again.'
                      : 'We can\u2019t reach your bank right now because of an error. Your data is safe; wait a bit and reconnect to resume syncing.'}
                  </div>
                </div>
                <button
                  class="reconnect-btn"
                  onclick={() => openTellerConnect(group.enrollmentId)}
                  disabled={tellerLoading || syncing}
                  aria-label="Reconnect {group.institutionName}"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M21 2v6h-6" />
                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                    <path d="M3 22v-6h6" />
                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  </svg>
                  <span>Reconnect</span>
                </button>
              </div>
            </div>
          {/if}

          <!-- Account Cards -->
          <div class="accounts-list">
            {#each group.accounts as account, ai (account.id)}
              {@const iconType = accountTypeIcon(account.type, account.subtype)}
              <div
                class="account-card"
                class:hidden-account={account.is_hidden}
                style="--acct-delay: {gi * 80 + ai * 50}ms"
                use:remoteChangeAnimation={{ entityId: account.id, entityType: 'accounts' }}
              >
                <!-- Account type icon -->
                <div class="acct-icon acct-icon-{iconType}">
                  {#if iconType === 'credit'}
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line
                        x1="1"
                        y1="10"
                        x2="23"
                        y2="10"
                      /></svg
                    >
                  {:else if iconType === 'savings'}
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><path
                        d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-3.5c1.3-.8 2-2.2 2-3.5 0-.3-.1-2.7 0-3 .1-.3.3-1 .5-1.5.2-.7.5-1.5.5-2.5s-1-2-2-2z"
                      /><path d="M2 9.5a1 1 0 011-1 5 5 0 014 2c1 .5 2 .5 3 0" /></svg
                    >
                  {:else}
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><rect x="2" y="5" width="20" height="14" rx="2" /><line
                        x1="2"
                        y1="10"
                        x2="22"
                        y2="10"
                      /><line x1="7" y1="15" x2="7" y2="15.01" /><line
                        x1="11"
                        y1="15"
                        x2="13"
                        y2="15"
                      /></svg
                    >
                  {/if}
                </div>

                <!-- Account info -->
                <div class="acct-info">
                  <div class="acct-top">
                    {#if editingAccountId === account.id && account.source === 'manual'}
                      <input
                        class="acct-name-input"
                        type="text"
                        bind:value={editingAccountName}
                        onblur={() => saveAccountName(account.id)}
                        onkeydown={(e) => {
                          if (e.key === 'Enter') saveAccountName(account.id);
                          if (e.key === 'Escape') editingAccountId = null;
                        }}
                        onclick={(e) => e.stopPropagation()}
                      />
                    {:else}
                      <!-- svelte-ignore a11y_no_static_element_interactions -->
                      <span
                        class="acct-name"
                        class:muted={account.is_hidden}
                        class:acct-name-editable={account.source === 'manual'}
                        use:truncateTooltip
                        onclick={(e) => {
                          if (account.source === 'manual') {
                            e.stopPropagation();
                            startEditingName(account);
                          }
                        }}
                        onkeydown={(e) => {
                          if (account.source === 'manual' && (e.key === 'Enter' || e.key === ' ')) {
                            e.stopPropagation();
                            startEditingName(account);
                          }
                        }}
                      >
                        {account.name}
                        {#if account.last_four}
                          <span class="acct-last4">{account.last_four}</span>
                        {/if}
                        {#if account.manual_balance_override}
                          <span class="acct-override-badge" title="Balance manually set">✦</span>
                        {/if}
                      </span>
                    {/if}
                    <span class="acct-type-badge type-{account.type}">
                      {subtypeLabel(account.subtype)}
                    </span>
                  </div>
                  <div class="acct-bottom">
                    <span class="acct-balance" class:muted={account.is_hidden}>
                      {displayBalance(account)}
                      {#if creditLimit(account)}
                        <span class="acct-limit">/ {creditLimit(account)}</span>
                      {/if}
                    </span>
                    {#if account.balance_updated_at}
                      <span class="acct-updated">{formatLastSync(account.balance_updated_at)}</span>
                    {/if}
                  </div>
                </div>

                <!-- Manual account actions: edit + import CSV -->
                {#if account.source === 'manual'}
                  <button
                    class="acct-action-btn acct-edit-btn"
                    onclick={(e) => {
                      e.stopPropagation();
                      openEditModal(account);
                    }}
                    aria-label="Edit {account.name}"
                    title="Edit account"
                  >
                    <svg
                      width="15"
                      height="15"
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
                  <button
                    class="acct-action-btn acct-import-btn"
                    onclick={(e) => {
                      e.stopPropagation();
                      openCSVForAccount(account);
                    }}
                    aria-label="Import CSV for {account.name}"
                    title="Import CSV"
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline
                        points="17 8 12 3 7 8"
                      /><line x1="12" y1="3" x2="12" y2="15" /></svg
                    >
                  </button>
                {/if}

                <!-- Per-account delete (with inline confirmation) -->
                {#if confirmDeleteAccountId === account.id}
                  <div class="acct-delete-confirm">
                    <button
                      class="btn-danger-sm"
                      onclick={(e) => {
                        e.stopPropagation();
                        deleteAccount(account.id);
                      }}
                      disabled={deletingAccount}
                    >
                      {deletingAccount ? '...' : 'Delete'}
                    </button>
                    <button
                      class="btn-ghost-sm"
                      onclick={(e) => {
                        e.stopPropagation();
                        confirmDeleteAccountId = null;
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                {:else}
                  <button
                    class="acct-action-btn acct-delete-btn"
                    onclick={(e) => {
                      e.stopPropagation();
                      confirmDeleteAccountId = account.id;
                    }}
                    aria-label="Delete {account.name}"
                    title="Delete account"
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><polyline points="3 6 5 6 21 6" /><path
                        d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                      /><path d="M10 11v6" /><path d="M14 11v6" /><path
                        d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"
                      /></svg
                    >
                  </button>
                {/if}

                <!-- Hide toggle -->
                <button
                  class="hide-toggle"
                  class:is-hidden={account.is_hidden}
                  onclick={(e) => {
                    e.stopPropagation();
                    toggleAccountHidden(account.id, account.is_hidden);
                  }}
                  disabled={togglingHidden === account.id}
                  aria-label={account.is_hidden ? 'Show account' : 'Hide account'}
                >
                  {#if togglingHidden === account.id}
                    <div class="toggle-spinner"></div>
                  {:else if account.is_hidden}
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><path
                        d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"
                      /><line x1="1" y1="1" x2="23" y2="23" /></svg
                    >
                  {:else}
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      ><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle
                        cx="12"
                        cy="12"
                        r="3"
                      /></svg
                    >
                  {/if}
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     TELLER CONNECT BACKDROP
     ═══════════════════════════════════════════════════════════════════════════ -->

{#if tellerOpen}
  <div class="teller-backdrop">
    {#if tellerLoading}
      <div class="teller-loader">
        <div class="btn-spinner teller-spinner"></div>
        <span class="teller-loader-text">Connecting...</span>
      </div>
    {/if}
  </div>
{/if}

<!-- ═══════════════════════════════════════════════════════════════════════════
     MANUAL ACCOUNT CREATION MODAL
     ═══════════════════════════════════════════════════════════════════════════ -->

{#if showManualModal}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-backdrop"
    onclick={() => (showManualModal = false)}
    onkeydown={(e) => e.key === 'Escape' && (showManualModal = false)}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal-panel" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <h2 class="modal-title">Add Manual Account</h2>
        <button class="modal-close" onclick={() => (showManualModal = false)} aria-label="Close">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
          >
        </button>
      </div>

      <div class="modal-body">
        <label class="form-label">
          Institution Name
          <div class="inst-input-wrap">
            <input
              class="form-input"
              type="text"
              bind:value={manualInstitution}
              placeholder="e.g. Chase, Fidelity"
              autocomplete="off"
              onfocus={() => (instDropdownOpen = true)}
              onblur={() => setTimeout(() => (instDropdownOpen = false), 180)}
            />
            {#if instDropdownOpen && instDropdownFiltered.length > 0}
              <div class="inst-dropdown" role="listbox" aria-label="Existing institutions">
                {#each instDropdownFiltered as name (name)}
                  <button
                    class="inst-dropdown-item"
                    role="option"
                    aria-selected={manualInstitution === name}
                    onmousedown={() => {
                      manualInstitution = name;
                      instDropdownOpen = false;
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="inst-dd-icon"
                      ><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path
                        d="M9 21v-4h6v4"
                      /></svg
                    >
                    {name}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </label>

        <label class="form-label">
          Account Name
          <input
            class="form-input"
            type="text"
            bind:value={manualName}
            placeholder="e.g. Personal Checking"
          />
        </label>

        <label class="form-label">
          Account Number
          <input
            class="form-input"
            type="text"
            bind:value={manualLastFour}
            placeholder="Last 4 digits (optional)"
            maxlength="4"
          />
          <span class="form-hint">Only the last 4 digits are stored</span>
        </label>

        <div class="form-row">
          <label class="form-label form-half">
            Type
            <select class="form-input" bind:value={manualType}>
              <option value="depository">Depository</option>
              <option value="credit">Credit</option>
            </select>
          </label>

          <label class="form-label form-half">
            Subtype
            <select class="form-input" bind:value={manualSubtype}>
              {#each manualSubtypes as st (st.value)}
                <option value={st.value}>{st.label}</option>
              {/each}
            </select>
          </label>
        </div>

        {#if manualType === 'credit'}
          <label class="form-label">
            Credit Limit
            <input
              class="form-input"
              type="number"
              step="0.01"
              bind:value={manualCreditLimit}
              placeholder="0.00"
            />
            <span class="form-hint">
              Current balance will be derived from imported transactions.
            </span>
          </label>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="btn-ghost-sm" onclick={() => (showManualModal = false)}>Cancel</button>
        <button
          class="btn-primary"
          onclick={createManualAccount}
          disabled={creatingManual ||
            !manualInstitution.trim() ||
            !manualName.trim() ||
            (manualType === 'credit' && manualCreditLimit === 0.0)}
        >
          {#if creatingManual}
            <div class="btn-spinner"></div>
            Creating...
          {:else}
            Create Account
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ═══════════════════════════════════════════════════════════════════════════
     CSV IMPORT MODAL
     ═══════════════════════════════════════════════════════════════════════════ -->

{#if showCSVModal}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-backdrop"
    onclick={() => (showCSVModal = false)}
    onkeydown={(e) => e.key === 'Escape' && (showCSVModal = false)}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal-panel modal-csv" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <h2 class="modal-title">Import CSV Transactions</h2>
        <button class="modal-close" onclick={() => (showCSVModal = false)} aria-label="Close">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
          >
        </button>
      </div>

      <!-- Step Indicators -->
      <div class="csv-steps">
        <div class="csv-step" class:step-active={csvStep === 1} class:step-done={csvStep > 1}>
          <div class="step-circle">{csvStep > 1 ? '\u2713' : '1'}</div>
          <span class="step-label">Upload</span>
        </div>
        <div class="step-line" class:line-done={csvStep > 1}></div>
        <div class="csv-step" class:step-active={csvStep === 2} class:step-done={csvStep > 2}>
          <div class="step-circle">{csvStep > 2 ? '\u2713' : '2'}</div>
          <span class="step-label">Map</span>
        </div>
        <div class="step-line" class:line-done={csvStep > 2}></div>
        <div
          class="csv-step"
          class:step-active={csvStep === 3}
          class:step-done={csvImportResult !== null}
        >
          <div class="step-circle">{csvImportResult ? '\u2713' : '3'}</div>
          <span class="step-label">Import</span>
        </div>
      </div>

      <div class="modal-body">
        {#if csvStep === 1}
          <!-- Step 1: Upload -->
          <div
            class="csv-dropzone"
            class:dropzone-active={csvDragOver}
            ondragover={(e) => {
              e.preventDefault();
              csvDragOver = true;
            }}
            ondragleave={() => (csvDragOver = false)}
            ondrop={onCSVDrop}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && csvFileInput?.click()}
            onclick={() => csvFileInput?.click()}
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="dropzone-icon"
              ><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline
                points="17 8 12 3 7 8"
              /><line x1="12" y1="3" x2="12" y2="15" /></svg
            >
            <p class="dropzone-text">Drop a .csv file here or click to browse</p>
            <input
              bind:this={csvFileInput}
              type="file"
              accept=".csv"
              class="sr-only"
              onchange={onCSVFileChange}
            />
          </div>

          {#if csvHeaders.length > 0}
            <div class="csv-preview-section">
              <h3 class="csv-preview-title">Preview ({csvRows.length} rows detected)</h3>
              <div class="csv-table-wrap">
                <table class="csv-table">
                  <thead>
                    <tr>
                      {#each csvHeaders as h (h)}
                        <th>{h}</th>
                      {/each}
                    </tr>
                  </thead>
                  <tbody>
                    {#each csvRows.slice(0, 5) as row, ri (ri)}
                      <tr style="animation-delay: {ri * 60}ms">
                        {#each row as cell, ci (ci)}
                          <td>{cell}</td>
                        {/each}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>

            <div class="modal-footer">
              <button class="btn-ghost-sm" onclick={() => (showCSVModal = false)}>Cancel</button>
              <button class="btn-primary" onclick={goToMapStep}> Continue to Mapping </button>
            </div>
          {/if}
        {:else if csvStep === 2}
          <!-- Step 2: Map Columns -->
          <div class="csv-map-section">
            <div class="csv-split-toggle">
              <label class="form-label toggle-label">
                <input type="checkbox" bind:checked={csvSplitMode} class="toggle-check" />
                <span>Split debit/credit columns</span>
              </label>
            </div>

            <label class="form-label">
              Date Column
              <select class="form-input" bind:value={csvMapping.date}>
                <option value="">-- Select --</option>
                {#each csvHeaders as h (h)}
                  <option value={h}>{h}</option>
                {/each}
              </select>
            </label>

            <label class="form-label">
              Description Column
              <select class="form-input" bind:value={csvMapping.description}>
                <option value="">-- Select --</option>
                {#each csvHeaders as h (h)}
                  <option value={h}>{h}</option>
                {/each}
              </select>
            </label>

            {#if csvSplitMode}
              <div class="form-row">
                <label class="form-label form-half">
                  Credit Column
                  <select class="form-input" bind:value={csvMapping.credit}>
                    <option value="">-- Select --</option>
                    {#each csvHeaders as h (h)}
                      <option value={h}>{h}</option>
                    {/each}
                  </select>
                </label>
                <label class="form-label form-half">
                  Debit Column
                  <select class="form-input" bind:value={csvMapping.debit}>
                    <option value="">-- Select --</option>
                    {#each csvHeaders as h (h)}
                      <option value={h}>{h}</option>
                    {/each}
                  </select>
                </label>
              </div>
            {:else}
              <label class="form-label">
                Amount Column
                <select class="form-input" bind:value={csvMapping.amount}>
                  <option value="">-- Select --</option>
                  {#each csvHeaders as h (h)}
                    <option value={h}>{h}</option>
                  {/each}
                </select>
              </label>
            {/if}

            {#if csvPreviewMapped.length > 0}
              <div class="csv-preview-section">
                <h3 class="csv-preview-title">Mapped Preview</h3>
                <div class="csv-table-wrap">
                  <table class="csv-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each csvPreviewMapped as row, ri (ri)}
                        <tr style="animation-delay: {ri * 60}ms">
                          <td>{row.date}</td>
                          <td>{row.description}</td>
                          <td
                            class:csv-positive={parseFloat(row.amount) >= 0}
                            class:csv-negative={parseFloat(row.amount) < 0}
                          >
                            {formatCurrency(parseFloat(row.amount))}
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>
            {/if}
          </div>

          <div class="modal-footer">
            <button class="btn-ghost-sm" onclick={() => (csvStep = 1)}>Back</button>
            <button class="btn-primary" onclick={goToReviewStep} disabled={!csvMappingValid}>
              Review Import
            </button>
          </div>
        {:else if csvStep === 3}
          <!-- Step 3: Review & Import -->
          {#if csvImportResult}
            <div class="csv-success">
              <div class="success-icon">
                <svg
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  ><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline
                    points="22 4 12 14.01 9 11.01"
                  /></svg
                >
              </div>
              <h3 class="success-title">Import Complete</h3>
              <p class="success-detail">
                {csvImportResult.inserted} transaction{csvImportResult.inserted !== 1 ? 's' : ''} imported
                {#if csvImportResult.skipped > 0}
                  <br /><span class="success-skipped"
                    >{csvImportResult.skipped} duplicate{csvImportResult.skipped !== 1 ? 's' : ''} skipped</span
                  >
                {/if}
              </p>
            </div>
            <div class="modal-footer">
              <button class="btn-primary" onclick={() => (showCSVModal = false)}>Done</button>
            </div>
          {:else}
            <div class="csv-review">
              <div class="review-stats">
                <div class="review-stat">
                  <span class="review-stat-value">{csvMappedTransactions.length}</span>
                  <span class="review-stat-label">Valid</span>
                </div>
                <div class="review-stat review-stat-new">
                  <span class="review-stat-value">{csvNewCount}</span>
                  <span class="review-stat-label">New</span>
                </div>
                <div class="review-stat review-stat-dup">
                  <span class="review-stat-value">{csvDuplicateCount}</span>
                  <span class="review-stat-label">Duplicates</span>
                </div>
                <div class="review-stat review-stat-skip">
                  <span class="review-stat-value"
                    >{csvRows.length - csvMappedTransactions.length}</span
                  >
                  <span class="review-stat-label">Invalid</span>
                </div>
              </div>

              {#if csvMappedTransactions.length > 0}
                <div class="csv-preview-section">
                  <h3 class="csv-preview-title">Sample Transactions</h3>
                  <div class="csv-table-wrap">
                    <table class="csv-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Description</th>
                          <th>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {#each csvMappedTransactions.slice(0, 5) as row, ri (ri)}
                          <tr style="animation-delay: {ri * 60}ms">
                            <td>{row.date}</td>
                            <td>{row.description}</td>
                            <td
                              class:csv-positive={parseFloat(row.amount) >= 0}
                              class:csv-negative={parseFloat(row.amount) < 0}
                            >
                              {formatCurrency(parseFloat(row.amount))}
                            </td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                </div>
              {/if}
            </div>
            <div class="modal-footer">
              <button class="btn-ghost-sm" onclick={() => (csvStep = 2)}>Back</button>
              <button
                class="btn-primary btn-import"
                class:importing={csvImporting}
                onclick={importCSV}
                disabled={csvImporting || csvMappedTransactions.length === 0}
              >
                {#if csvImporting}
                  <div class="btn-spinner"></div>
                  Importing...
                {:else}
                  Import {csvMappedTransactions.length} Transaction{csvMappedTransactions.length !==
                  1
                    ? 's'
                    : ''}
                {/if}
              </button>
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

<!-- ═══════════════════════════════════════════════════════════════════════════
     EDIT MANUAL ACCOUNT MODAL
     ═══════════════════════════════════════════════════════════════════════════ -->

{#if showEditModal && editingAccount}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="modal-backdrop"
    onclick={() => (showEditModal = false)}
    onkeydown={(e) => e.key === 'Escape' && (showEditModal = false)}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal-panel modal-edit" onclick={(e) => e.stopPropagation()}>
      <!-- Prismatic shimmer edge -->
      <div class="edit-modal-shimmer" aria-hidden="true"></div>

      <div class="modal-header">
        <div class="edit-modal-title-wrap">
          <div class="edit-modal-gem" aria-hidden="true"></div>
          <h2 class="modal-title">Edit Account</h2>
        </div>
        <button class="modal-close" onclick={() => (showEditModal = false)} aria-label="Close">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg
          >
        </button>
      </div>

      <div class="modal-body">
        <!-- Institution name (editable for manual accounts) -->
        <label class="form-label">
          Institution Name
          <div class="inst-input-wrap">
            <input
              class="form-input"
              type="text"
              bind:value={editInstitution}
              placeholder="e.g. Chase, Fidelity"
              autocomplete="off"
              onfocus={() => (editInstDropdownOpen = true)}
              onblur={() => setTimeout(() => (editInstDropdownOpen = false), 180)}
            />
            {#if editInstDropdownOpen && editInstDropdownFiltered.length > 0}
              <div class="inst-dropdown" role="listbox" aria-label="Existing institutions">
                {#each editInstDropdownFiltered as name (name)}
                  <button
                    class="inst-dropdown-item"
                    role="option"
                    aria-selected={editInstitution === name}
                    onmousedown={() => {
                      editInstitution = name;
                      editInstDropdownOpen = false;
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      class="inst-dd-icon"
                      ><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path
                        d="M9 21v-4h6v4"
                      /></svg
                    >
                    {name}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
          <span class="form-hint"
            >Changing this moves the account to a different institution group.</span
          >
        </label>

        <!-- Account name -->
        <label class="form-label">
          Account Name
          <input
            class="form-input"
            type="text"
            bind:value={editName}
            placeholder="e.g. Personal Checking"
          />
        </label>

        <!-- Last four -->
        <label class="form-label">
          Last 4 Digits
          <input
            class="form-input"
            type="text"
            bind:value={editLastFour}
            placeholder="Optional"
            maxlength="4"
          />
        </label>

        <!-- Type + Subtype -->
        <div class="form-row">
          <label class="form-label form-half">
            Type
            <select class="form-input" bind:value={editType}>
              <option value="depository">Depository</option>
              <option value="credit">Credit</option>
            </select>
          </label>
          <label class="form-label form-half">
            Subtype
            <select class="form-input" bind:value={editSubtype}>
              {#each editSubtypes as st (st.value)}
                <option value={st.value}>{st.label}</option>
              {/each}
            </select>
          </label>
        </div>

        <!-- Balance section -->
        <div class="edit-balance-section">
          <div class="edit-balance-header">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              ><line x1="12" y1="1" x2="12" y2="23" /><path
                d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
              /></svg
            >
            <span class="edit-balance-title">Balance Override</span>
          </div>
          <p class="edit-balance-desc">
            {#if editType === 'credit'}
              Set the current amount owed and credit limit. Your transaction history is preserved —
              today's chart point will reflect this balance.
            {:else}
              Set the current balance. Transaction history is preserved — today's chart point will
              jump to this value.
            {/if}
          </p>

          {#if editType === 'credit'}
            <div class="form-row">
              <label class="form-label form-half">
                Amount Owed
                <input
                  class="form-input"
                  type="number"
                  step="0.01"
                  min="0"
                  bind:value={editBalance}
                  placeholder="0.00"
                />
              </label>
              <label class="form-label form-half">
                Credit Limit
                <input
                  class="form-input"
                  type="number"
                  step="0.01"
                  min="0"
                  bind:value={editCreditLimit}
                  placeholder="0.00"
                />
              </label>
            </div>
          {:else}
            <label class="form-label">
              Current Balance
              <input
                class="form-input"
                type="number"
                step="0.01"
                bind:value={editBalance}
                placeholder="0.00"
              />
            </label>
          {/if}
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-ghost-sm" onclick={() => (showEditModal = false)}>Cancel</button>
        <button
          class="btn-primary btn-edit-save"
          onclick={saveAccountEdit}
          disabled={savingEdit || !editInstitution.trim() || !editName.trim()}
        >
          {#if savingEdit}
            <div class="btn-spinner"></div>
            Saving...
          {:else}
            Save Changes
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ═══════════════════════════════════════════════════════════════════════════
     SCOPED STYLES
     ═══════════════════════════════════════════════════════════════════════════ -->

<style>
  /* ── Design Tokens ──────────────────────────────────────────────────────── */
  .accounts-page {
    --cyan: #2ec4a6;
    --cyan-dim: #083344;
    --cyan-glow: rgba(46, 196, 166, 0.3);
    --amethyst: #e8b94a;
    --amethyst-dim: #2e1065;
    --amethyst-glow: rgba(232, 185, 74, 0.3);
    --emerald: #34d399;
    --emerald-glow: rgba(52, 211, 153, 0.3);
    --ruby: #f87171;
    --ruby-glow: rgba(248, 113, 113, 0.3);
    --gold: #fbbf24;

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
    padding: 0;
    background: transparent;
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    color: var(--text-primary);
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
  }

  /* ── Emerald gem title ── */
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
    animation: acctFlareIn 0.8s 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  .f1 {
    width: 60px;
    height: 60px;
    top: -14px;
    left: -12px;
    background: radial-gradient(circle, rgba(46, 196, 166, 0.5), transparent 70%);
  }

  .f2 {
    width: 40px;
    height: 40px;
    top: -6px;
    right: -8px;
    background: radial-gradient(circle, rgba(52, 211, 153, 0.35), transparent 70%);
    animation-delay: 0.3s !important;
  }

  @keyframes acctFlareIn {
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
    font-family: var(--font-display);
    font-size: 1.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    background: linear-gradient(
      135deg,
      var(--text-primary) 0%,
      var(--cyan) 60%,
      var(--emerald) 100%
    );
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    background-size: 200% auto;
    animation: emeraldTitleShimmer 8s ease-in-out infinite;
    margin: 0;
    line-height: 1.2;
  }

  @keyframes emeraldTitleShimmer {
    0%,
    100% {
      background-position: 0% center;
    }
    50% {
      background-position: 100% center;
    }
  }

  .page-subtitle {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin: 0.25rem 0 0;
    font-weight: 400;
    letter-spacing: 0.04em;
  }

  /* ── Header Actions ────────────────────────────────────────────────────── */
  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* ── Connect Button ─────────────────────────────────────────────────────── */
  .connect-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 1.15rem;
    background: linear-gradient(135deg, var(--cyan-dim), rgba(46, 196, 166, 0.18));
    border: 1px solid rgba(46, 196, 166, 0.3);
    border-radius: 10px;
    color: var(--cyan);
    font-family: var(
      --font-body,
      'SF Pro Text',
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

  .connect-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, rgba(46, 196, 166, 0.22), rgba(46, 196, 166, 0.12));
    border-color: rgba(46, 196, 166, 0.5);
    box-shadow: 0 0 24px var(--cyan-glow);
    transform: translateY(-1px);
  }

  .connect-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .manual-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 1.15rem;
    background: rgba(232, 185, 74, 0.08);
    border: 1px solid rgba(232, 185, 74, 0.2);
    border-radius: 10px;
    color: var(--amethyst);
    font-family: var(
      --font-body,
      'SF Pro Text',
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

  .manual-btn:hover {
    background: rgba(232, 185, 74, 0.14);
    border-color: rgba(232, 185, 74, 0.4);
    box-shadow: 0 0 24px rgba(232, 185, 74, 0.15);
    transform: translateY(-1px);
  }

  .btn-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid transparent;
    border-top-color: currentColor;
    border-radius: 50%;
    animation: spinner 0.6s linear infinite;
  }

  @keyframes spinner {
    to {
      transform: rotate(360deg);
    }
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
    gap: 0.4rem;
    align-items: flex-end;
  }

  .loader-shard {
    width: 6px;
    background: var(--cyan);
    border-radius: 3px;
    animation: shard-grow 1.2s ease-in-out infinite;
  }

  .loader-shard:nth-child(1) {
    height: 16px;
    animation-delay: 0s;
  }
  .loader-shard:nth-child(2) {
    height: 24px;
    animation-delay: 0.15s;
    background: var(--amethyst);
  }
  .loader-shard:nth-child(3) {
    height: 20px;
    animation-delay: 0.3s;
  }
  .loader-shard:nth-child(4) {
    height: 14px;
    animation-delay: 0.45s;
    background: var(--amethyst);
  }

  @keyframes shard-grow {
    0%,
    100% {
      transform: scaleY(0.6);
      opacity: 0.4;
    }
    50% {
      transform: scaleY(1.2);
      opacity: 1;
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
    padding: 4rem 2rem;
    gap: 1rem;
  }

  .empty-crystal {
    margin-bottom: 0.5rem;
    animation: crystal-float 5s ease-in-out infinite;
  }

  @keyframes crystal-float {
    0%,
    100% {
      transform: translateY(0) rotate(0deg);
    }
    33% {
      transform: translateY(-6px) rotate(1deg);
    }
    66% {
      transform: translateY(-3px) rotate(-1deg);
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
    max-width: 360px;
    line-height: 1.6;
    margin: 0;
  }

  .empty-config-hint {
    font-size: 0.8rem;
    color: var(--gold);
    margin: 0;
    opacity: 0.8;
  }

  .empty-cta {
    margin-top: 0.75rem;
    padding: 0.65rem 1.5rem;
    font-size: 0.9rem;
  }

  /* ── Totals Summary Bar ─────────────────────────────────────────────────── */
  .chart-section {
    margin-bottom: 1.5rem;
  }

  .totals-bar {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    padding: 1.25rem 1.5rem;
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: 16px;
    margin-bottom: 2rem;
    flex-wrap: wrap;
    overflow: hidden;
  }

  .totals-bar::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      135deg,
      rgba(46, 196, 166, 0.03) 0%,
      transparent 40%,
      rgba(232, 185, 74, 0.03) 100%
    );
    pointer-events: none;
  }

  .total-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
    min-width: 100px;
  }

  .total-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    font-weight: 500;
  }

  .total-value {
    font-size: 1.2rem;
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .total-value.assets {
    color: var(--emerald);
  }

  .total-value.liabilities {
    color: var(--ruby);
  }

  .total-value.positive {
    color: var(--cyan);
  }

  .total-value.negative {
    color: var(--ruby);
  }

  .total-divider {
    width: 1px;
    height: 36px;
    background: var(--border-subtle);
    flex-shrink: 0;
  }

  /* ── Institution Groups ─────────────────────────────────────────────────── */
  .institutions-list {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .institution-group {
    animation: group-enter 0.4s ease-out both;
    animation-delay: var(--group-delay);
  }

  @keyframes group-enter {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
  }

  /* ── Institution Header ─────────────────────────────────────────────────── */
  .institution-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: 14px 14px 4px 4px;
    flex-wrap: wrap;
  }

  .inst-info {
    display: flex;
    align-items: center;
    gap: 0.65rem;
  }

  .inst-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    color: var(--amethyst);
  }

  .inst-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .inst-name {
    font-family: var(--font-display);
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: 0.03em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .inst-sync {
    font-size: 0.72rem;
    color: var(--text-muted);
    letter-spacing: 0.02em;
  }

  .inst-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  /* ── Status Badge ───────────────────────────────────────────────────────── */
  .status-badge {
    font-size: 0.68rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.25rem 0.6rem;
    border-radius: 6px;
  }

  .status-connected {
    background: rgba(52, 211, 153, 0.12);
    color: var(--emerald);
    border: 1px solid rgba(52, 211, 153, 0.2);
  }

  .status-disconnected {
    background: rgba(251, 191, 36, 0.1);
    color: var(--gold);
    border: 1px solid rgba(251, 191, 36, 0.2);
  }

  .status-error {
    background: rgba(248, 113, 113, 0.1);
    color: var(--ruby);
    border: 1px solid rgba(248, 113, 113, 0.2);
  }

  .status-badge.status-manual {
    color: #5c8ce8;
    background: rgba(92, 140, 232, 0.1);
    border-color: rgba(92, 140, 232, 0.2);
    font-size: 0.68rem;
    padding: 0.25rem 0.6rem;
  }

  /* ── Reconnect Banner ───────────────────────────────────────────────────── */
  /* Cinematic alert surface that appears beneath the institution header when
     an enrollment is in a 'disconnected' (auth expired) or 'error' state.
     Design language: obsidian card + colored aura glow, prismatic shimmer
     edge, and a single high-conviction reconnect CTA. Colors lean gold for
     the auth-expired case (actionable, warm) and ruby for errors (urgent).  */

  .reconnect-banner {
    position: relative;
    margin: 0 0 0.75rem;
    padding: 0.95rem 1.1rem;
    border-radius: 12px;
    background: linear-gradient(135deg, rgba(26, 22, 16, 0.9) 0%, rgba(20, 16, 10, 0.92) 100%);
    border: 1px solid var(--banner-border);
    overflow: hidden;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    box-shadow:
      0 1px 0 rgba(255, 255, 255, 0.03) inset,
      0 8px 32px rgba(0, 0, 0, 0.35),
      0 0 24px var(--banner-glow);
    animation: reconnect-banner-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  .reconnect-banner-auth {
    --banner-accent: var(--gold);
    --banner-accent-glow: rgba(251, 191, 36, 0.32);
    --banner-accent-dim: rgba(251, 191, 36, 0.08);
    --banner-border: rgba(251, 191, 36, 0.22);
    --banner-glow: rgba(251, 191, 36, 0.1);
  }

  .reconnect-banner-error {
    --banner-accent: var(--ruby);
    --banner-accent-glow: rgba(248, 113, 113, 0.34);
    --banner-accent-dim: rgba(248, 113, 113, 0.08);
    --banner-border: rgba(248, 113, 113, 0.24);
    --banner-glow: rgba(248, 113, 113, 0.12);
  }

  /* Layered aura — prismatic gradient sweeping behind the content */
  .reconnect-aura {
    position: absolute;
    inset: -40%;
    pointer-events: none;
    background:
      radial-gradient(ellipse 60% 80% at 0% 50%, var(--banner-accent-glow) 0%, transparent 55%),
      radial-gradient(ellipse 50% 70% at 100% 50%, var(--banner-accent-dim) 0%, transparent 60%);
    opacity: 0.7;
    animation: reconnect-aura-drift 9s ease-in-out infinite alternate;
  }

  /* Shimmering top edge — subtle prism-like highlight */
  .reconnect-banner::before {
    content: '';
    position: absolute;
    top: 0;
    left: 10%;
    right: 10%;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--banner-accent-glow), transparent);
    opacity: 0.6;
    pointer-events: none;
  }

  .reconnect-content {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.85rem;
    z-index: 1;
  }

  .reconnect-icon {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--banner-accent-dim);
    border: 1px solid var(--banner-border);
    color: var(--banner-accent);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 0 16px var(--banner-glow);
    animation: reconnect-icon-pulse 2.8s ease-in-out infinite;
  }

  .reconnect-text {
    flex: 1;
    min-width: 0;
  }

  .reconnect-title {
    color: var(--text-primary);
    font-size: 0.88rem;
    font-weight: 600;
    letter-spacing: 0.005em;
    line-height: 1.3;
  }

  .reconnect-desc {
    margin-top: 0.2rem;
    color: var(--text-secondary);
    font-size: 0.78rem;
    font-weight: 400;
    line-height: 1.4;
  }

  .reconnect-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.55rem 0.95rem;
    border-radius: 10px;
    background: linear-gradient(
      135deg,
      var(--banner-accent-dim) 0%,
      var(--banner-accent-glow) 100%
    );
    border: 1px solid var(--banner-border);
    color: var(--banner-accent);
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.82rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    cursor: pointer;
    transition:
      transform 0.25s cubic-bezier(0.22, 1, 0.36, 1),
      box-shadow 0.25s ease,
      background 0.25s ease,
      border-color 0.25s ease;
    white-space: nowrap;
  }

  .reconnect-btn svg {
    transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .reconnect-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: var(--banner-accent);
    background: linear-gradient(
      135deg,
      var(--banner-accent-glow) 0%,
      var(--banner-accent-dim) 100%
    );
    box-shadow:
      0 6px 20px var(--banner-glow),
      0 0 24px var(--banner-accent-glow);
  }

  .reconnect-btn:hover:not(:disabled) svg {
    transform: rotate(-120deg);
  }

  .reconnect-btn:active:not(:disabled) {
    transform: translateY(0);
  }

  .reconnect-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @keyframes reconnect-banner-in {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.995);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes reconnect-aura-drift {
    0% {
      transform: translate(-2%, 0) scale(1);
      opacity: 0.6;
    }
    100% {
      transform: translate(2%, -1%) scale(1.08);
      opacity: 0.9;
    }
  }

  @keyframes reconnect-icon-pulse {
    0%,
    100% {
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.04),
        0 0 16px var(--banner-glow);
    }
    50% {
      box-shadow:
        inset 0 1px 0 rgba(255, 255, 255, 0.06),
        0 0 22px var(--banner-accent-glow);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .reconnect-banner,
    .reconnect-aura,
    .reconnect-icon,
    .reconnect-btn svg {
      animation: none;
      transition: none;
    }
  }

  @media (max-width: 640px) {
    .reconnect-banner {
      padding: 0.85rem 0.9rem;
    }

    .reconnect-content {
      flex-wrap: wrap;
      gap: 0.7rem;
    }

    .reconnect-text {
      flex: 1 1 calc(100% - 48px);
    }

    .reconnect-btn {
      flex: 1 1 100%;
      justify-content: center;
      padding: 0.65rem 1rem;
    }
  }

  /* ── Disconnect Button ──────────────────────────────────────────────────── */
  .sync-btn {
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
  }

  .sync-btn:hover {
    background: rgba(212, 160, 57, 0.08);
    border-color: rgba(212, 160, 57, 0.2);
    color: var(--gold);
  }

  .sync-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* ── Manual institution rename button ────────────────────────────────────── */
  .inst-rename-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 7px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.18s;
  }

  .inst-rename-btn:hover {
    background: rgba(232, 185, 74, 0.08);
    border-color: rgba(232, 185, 74, 0.2);
    color: var(--citrine, #dbb044);
  }

  /* Inline rename field */
  .inst-rename-wrap {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .inst-rename-input {
    flex: 1;
    min-width: 0;
    padding: 0.2rem 0.5rem;
    font-size: 0.88rem;
    font-weight: 600;
    color: var(--text-primary);
    background: var(--surface-raised);
    border: 1px solid rgba(232, 185, 74, 0.3);
    border-radius: 6px;
    outline: none;
    font-family: inherit;
  }

  .inst-rename-input:focus {
    border-color: rgba(232, 185, 74, 0.55);
    box-shadow: 0 0 0 2px rgba(232, 185, 74, 0.08);
  }

  .inst-rename-confirm,
  .inst-rename-cancel {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s;
  }

  .inst-rename-confirm {
    background: rgba(74, 222, 128, 0.12);
    color: #4ade80;
  }

  .inst-rename-confirm:hover:not(:disabled) {
    background: rgba(74, 222, 128, 0.22);
  }

  .inst-rename-confirm:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .inst-rename-cancel {
    background: rgba(248, 113, 113, 0.1);
    color: #f87171;
  }

  .inst-rename-cancel:hover {
    background: rgba(248, 113, 113, 0.2);
  }

  .disconnect-btn {
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
  }

  .disconnect-btn:hover {
    background: rgba(248, 113, 113, 0.08);
    border-color: rgba(248, 113, 113, 0.2);
    color: var(--ruby);
  }

  .disconnect-confirm {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .btn-danger-sm {
    padding: 0.3rem 0.7rem;
    background: rgba(248, 113, 113, 0.12);
    border: 1px solid rgba(248, 113, 113, 0.3);
    border-radius: 6px;
    color: var(--ruby);
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-danger-sm:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.2);
  }

  .btn-danger-sm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-ghost-sm {
    padding: 0.3rem 0.6rem;
    background: transparent;
    border: 1px solid var(--border-interactive);
    border-radius: 6px;
    color: var(--text-secondary);
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-ghost-sm:hover {
    background: var(--surface-raised);
  }

  /* ── Accounts List ──────────────────────────────────────────────────────── */
  .accounts-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .account-card {
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 1rem 1.25rem;
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-top: none;
    transition:
      background 0.2s ease,
      transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
      box-shadow 0.3s ease;
    animation: acct-enter 0.35s ease-out both;
    animation-delay: var(--acct-delay);
  }

  .account-card::before {
    content: '';
    position: absolute;
    left: 0;
    top: 20%;
    bottom: 20%;
    width: 2px;
    background: linear-gradient(180deg, var(--cyan, #2ec4a6), var(--acct-amethyst, #e8b94a));
    border-radius: 2px;
    opacity: 0.4;
    transition:
      opacity 0.3s ease,
      box-shadow 0.3s ease;
  }

  .account-card:hover::before {
    opacity: 0.8;
    box-shadow: 0 0 8px rgba(46, 196, 166, 0.3);
  }

  @keyframes acct-enter {
    from {
      opacity: 0;
    }
  }

  .account-card:last-child {
    border-radius: 0 0 14px 14px;
  }

  .account-card:hover {
    background: var(--surface-raised);
    transform: translateY(-2px);
    box-shadow:
      0 8px 24px rgba(0, 0, 0, 0.3),
      0 0 20px rgba(46, 196, 166, 0.06);
  }

  .account-card.hidden-account {
    opacity: 0.5;
  }

  /* ── Account Type Icon ──────────────────────────────────────────────────── */
  .acct-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    flex-shrink: 0;
    border: 1px solid var(--border-subtle);
  }

  .acct-icon-checking {
    background: rgba(46, 196, 166, 0.08);
    color: var(--cyan);
  }

  .acct-icon-savings {
    background: rgba(52, 211, 153, 0.08);
    color: var(--emerald);
  }

  .acct-icon-credit {
    background: rgba(232, 185, 74, 0.08);
    color: var(--amethyst);
  }

  /* ── Account Info ───────────────────────────────────────────────────────── */
  .acct-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .acct-top {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  /* .acct-name is now a <span> — base styles defined in the new CSS block below */
  .acct-name.muted {
    color: var(--text-muted);
  }

  .acct-name-input {
    all: unset;
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--text-primary);
    background: var(--surface-raised);
    border: 1px solid var(--amethyst);
    border-radius: 6px;
    padding: 2px 8px;
    box-shadow: 0 0 0 2px rgba(232, 185, 74, 0.15);
    animation: nameEditGlow 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    min-width: 0;
    width: 100%;
  }

  @keyframes nameEditGlow {
    from {
      box-shadow: 0 0 0 0 rgba(232, 185, 74, 0);
      transform: scale(0.98);
    }
    to {
      box-shadow: 0 0 0 2px rgba(232, 185, 74, 0.15);
      transform: scale(1);
    }
  }

  .acct-last4 {
    font-weight: 400;
    color: var(--text-muted);
    font-size: 0.8rem;
    margin-left: 0.15rem;
    font-variant-numeric: tabular-nums;
  }

  .acct-last4::before {
    content: '\2022\2022\2022\2022';
    font-size: 0.5rem;
    vertical-align: middle;
    margin-right: 0.15rem;
    letter-spacing: 0.05em;
  }

  .acct-type-badge {
    font-size: 0.65rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.15rem 0.45rem;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .type-depository {
    background: rgba(46, 196, 166, 0.1);
    color: var(--cyan);
  }

  .type-credit {
    background: rgba(232, 185, 74, 0.1);
    color: var(--amethyst);
  }

  .acct-bottom {
    display: flex;
    align-items: baseline;
    gap: 0.65rem;
  }

  .acct-balance {
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .acct-balance.muted {
    color: var(--text-muted);
  }

  .acct-limit {
    font-size: 0.8rem;
    font-weight: 400;
    color: var(--text-muted);
  }

  .acct-updated {
    font-size: 0.7rem;
    color: var(--text-muted);
    letter-spacing: 0.02em;
  }

  /* ── Hide Toggle ────────────────────────────────────────────────────────── */
  .hide-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
    opacity: 0.4;
  }

  .account-card:hover .hide-toggle {
    opacity: 1;
  }

  .hide-toggle:hover {
    background: var(--surface-overlay);
    border-color: var(--border-interactive);
    color: var(--text-secondary);
  }

  .hide-toggle.is-hidden {
    opacity: 0.8;
    color: var(--gold);
  }

  .hide-toggle:disabled {
    cursor: not-allowed;
  }

  .toggle-spinner {
    width: 14px;
    height: 14px;
    border: 2px solid transparent;
    border-top-color: var(--text-muted);
    border-radius: 50%;
    animation: spinner 0.6s linear infinite;
  }

  /* ── Responsive ─────────────────────────────────────────────────────────── */
  @media (max-width: 640px) {
    .page-header {
      flex-direction: column;
      gap: 0.75rem;
    }

    .page-header .connect-btn {
      align-self: flex-start;
    }

    .page-title {
      font-size: 1.5rem;
    }

    .totals-bar {
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
    }

    .total-divider {
      width: 60px;
      height: 1px;
    }

    .total-value {
      font-size: 1.1rem;
    }

    .header-actions {
      width: 100%;
    }

    .header-actions .connect-btn,
    .header-actions .manual-btn {
      flex: 1;
      justify-content: center;
    }

    .institution-header {
      flex-wrap: nowrap;
      gap: 0.5rem;
      padding: 0.65rem 0.85rem;
    }

    .inst-info {
      min-width: 0;
      flex: 1;
    }

    .inst-actions {
      flex-shrink: 0;
    }

    .acct-top {
      flex-wrap: nowrap;
      gap: 0.35rem;
      min-width: 0;
    }

    .acct-name {
      min-width: 0;
      flex-shrink: 1;
    }

    .acct-last4 {
      flex-shrink: 0;
    }

    .account-card {
      padding: 0.85rem 0.85rem;
      gap: 0.65rem;
    }

    .acct-icon {
      width: 36px;
      height: 36px;
    }

    .acct-name {
      font-size: 0.85rem;
    }

    .acct-balance {
      font-size: 0.95rem;
    }
  }

  @media (max-width: 480px) {
    .total-item {
      min-width: 70px;
    }

    .total-divider {
      display: none;
    }

    .inst-name {
      font-size: 0.9rem;
    }
  }

  @media (max-width: 380px) {
    .acct-type-badge {
      display: none;
    }

    .connect-btn {
      font-size: 0.8rem;
      padding: 0.45rem 0.85rem;
    }

    .disconnect-confirm {
      flex-direction: column;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     REAL-TIME ANIMATION KEYFRAMES
     ═══════════════════════════════════════════════════════════════════════════ */

  /* ── Teller Connect Backdrop — identical to modal-backdrop ─────────────── */
  .teller-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    animation: backdrop-in 0.25s ease-out;
  }

  .teller-loader {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .teller-spinner {
    width: 28px;
    height: 28px;
    border-width: 2.5px;
  }

  .teller-loader-text {
    font-size: 0.82rem;
    color: var(--text-muted);
    letter-spacing: 0.03em;
  }

  /* ── Teller Connect iframe — centered modal ──────────────────────────── */
  :global(.teller-connect-iframe),
  :global(iframe[src*='teller.io']) {
    position: fixed !important;
    top: 50% !important;
    left: 50% !important;
    transform: translate(-50%, -50%) !important;
    z-index: 201 !important;
    max-width: calc(100vw - 2rem) !important;
    max-height: calc(
      100vh - env(safe-area-inset-top, 47px) - env(safe-area-inset-bottom, 0px) - 2rem
    ) !important;
    border-radius: 16px !important;
    box-shadow:
      0 24px 48px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(180, 150, 80, 0.08) !important;
  }

  :global(.syncable-item) {
    transition:
      opacity 0.3s ease,
      transform 0.3s ease,
      background 0.3s ease,
      box-shadow 0.3s ease;
  }

  :global(.item-created) {
    animation: acctSlideIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes acctSlideIn {
    0% {
      opacity: 0;
      transform: translateY(12px) scale(0.96);
      box-shadow: 0 0 0 0 rgba(232, 185, 74, 0);
    }
    40% {
      box-shadow:
        0 0 20px 4px rgba(232, 185, 74, 0.2),
        inset 0 0 16px rgba(232, 200, 122, 0.06);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1);
      box-shadow: 0 0 0 0 rgba(232, 185, 74, 0);
    }
  }

  :global(.item-changed) {
    animation: acctShimmer 1.6s ease-out forwards;
  }

  @keyframes acctShimmer {
    0% {
      background: linear-gradient(110deg, transparent 0%, transparent 100%) no-repeat;
      background-size: 250% 100%;
      background-position: 200% 0;
    }
    15% {
      background: linear-gradient(
          110deg,
          transparent 0%,
          rgba(200, 160, 60, 0.06) 35%,
          rgba(232, 200, 122, 0.1) 50%,
          rgba(46, 196, 166, 0.04) 65%,
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
          rgba(200, 160, 60, 0.06) 35%,
          rgba(232, 200, 122, 0.1) 50%,
          rgba(46, 196, 166, 0.04) 65%,
          transparent 100%
        )
        no-repeat;
      background-size: 250% 100%;
      background-position: -100% 0;
    }
  }

  :global(.item-deleting) {
    animation: acctFadeOut 0.5s cubic-bezier(0.55, 0, 1, 0.45) forwards;
    pointer-events: none;
  }

  @keyframes acctFadeOut {
    0% {
      opacity: 1;
      transform: scale(1);
    }
    100% {
      opacity: 0;
      transform: scale(0.92);
    }
  }

  :global(.text-changed) {
    animation: acctTextFlash 0.7s ease-out forwards;
  }

  @keyframes acctTextFlash {
    0% {
      background-color: rgba(232, 185, 74, 0.15);
    }
    100% {
      background-color: transparent;
    }
  }

  :global(.item-toggled) {
    animation: acctPulse 0.6s ease-out forwards;
  }

  @keyframes acctPulse {
    0%,
    100% {
      transform: scale(1);
    }
    25% {
      transform: scale(1.01);
      box-shadow: 0 0 12px rgba(232, 185, 74, 0.15);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     MODAL STYLES
     ═══════════════════════════════════════════════════════════════════════════ */

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(12px);
    animation: backdrop-in 0.25s ease-out;
    padding: 1rem;
  }

  @keyframes backdrop-in {
    from {
      opacity: 0;
    }
  }

  .modal-panel {
    position: relative;
    width: 100%;
    max-width: 460px;
    max-height: 85vh;
    overflow-y: auto;
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: 16px;
    box-shadow:
      0 24px 48px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(180, 150, 80, 0.08);
    animation: modal-enter 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .modal-csv {
    max-width: 580px;
  }

  @keyframes modal-enter {
    from {
      opacity: 0;
      transform: translateY(24px) scale(0.96);
    }
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem 0.75rem;
  }

  .modal-title {
    font-family: var(--font-display);
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: 0.04em;
  }

  .modal-close {
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
  }

  .modal-close:hover {
    background: var(--surface-raised);
    border-color: var(--border-interactive);
    color: var(--text-secondary);
  }

  .modal-body {
    padding: 0.75rem 1.5rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem 1.25rem;
  }

  /* ── Form Elements ───────────────────────────────────────────────────────── */

  .form-label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--text-secondary);
    letter-spacing: 0.03em;
  }

  .form-input {
    height: 44px;
    padding: 0 14px;
    background: var(--surface-raised);
    border: 1px solid var(--border-subtle);
    border-radius: 10px;
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.88rem;
    transition: all 0.2s ease;
    outline: none;
    -webkit-appearance: none;
    appearance: none;
  }

  .form-input:focus {
    border-color: var(--amethyst);
    box-shadow: 0 0 0 2px rgba(232, 185, 74, 0.15);
  }

  .form-input::placeholder {
    color: var(--text-muted);
  }

  select.form-input {
    cursor: pointer;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23a09478' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 36px;
  }

  .form-row {
    display: flex;
    gap: 0.75rem;
  }

  .form-half {
    flex: 1;
    min-width: 0;
  }

  .form-hint {
    font-size: 0.72rem;
    color: var(--text-muted);
    margin-top: 0.25rem;
    font-weight: 400;
  }

  .btn-primary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 1.15rem;
    background: rgba(232, 185, 74, 0.08);
    border: 1px solid rgba(232, 185, 74, 0.2);
    border-radius: 10px;
    color: var(--amethyst);
    font-family: inherit;
    font-size: 0.85rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.25s;
    letter-spacing: 0.02em;
  }

  .btn-primary:hover:not(:disabled) {
    background: rgba(232, 185, 74, 0.14);
    border-color: rgba(232, 185, 74, 0.4);
    box-shadow: 0 0 24px rgba(232, 185, 74, 0.15);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-import {
    position: relative;
    overflow: hidden;
  }

  .btn-import.importing::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      110deg,
      transparent 0%,
      rgba(232, 185, 74, 0.12) 40%,
      rgba(232, 200, 122, 0.18) 50%,
      rgba(232, 185, 74, 0.12) 60%,
      transparent 100%
    );
    background-size: 250% 100%;
    animation: shimmer-sweep 1.5s ease-in-out infinite;
  }

  @keyframes shimmer-sweep {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }

  /* ── CSV Step Indicators ─────────────────────────────────────────────────── */

  .csv-steps {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    padding: 0 1.5rem 0.5rem;
  }

  .csv-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.3rem;
  }

  .step-circle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    font-size: 0.72rem;
    font-weight: 600;
    background: var(--surface-overlay);
    border: 1px solid var(--border-subtle);
    color: var(--text-muted);
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .step-active .step-circle {
    background: rgba(232, 185, 74, 0.15);
    border-color: var(--amethyst);
    color: var(--amethyst);
    box-shadow: 0 0 12px rgba(232, 185, 74, 0.2);
  }

  .step-done .step-circle {
    background: rgba(52, 211, 153, 0.15);
    border-color: var(--emerald);
    color: var(--emerald);
  }

  .step-label {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    font-weight: 500;
    transition: color 0.3s;
  }

  .step-active .step-label {
    color: var(--amethyst);
  }

  .step-done .step-label {
    color: var(--emerald);
  }

  .step-line {
    width: 40px;
    height: 1px;
    background: var(--border-subtle);
    margin: 0 0.5rem;
    margin-bottom: 1.2rem;
    transition: background 0.3s;
  }

  .step-line.line-done {
    background: var(--emerald);
  }

  /* ── CSV Dropzone ────────────────────────────────────────────────────────── */

  .csv-dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    min-height: 160px;
    padding: 2rem;
    border: 2px dashed var(--border-interactive);
    border-radius: 12px;
    background: var(--surface-raised);
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .csv-dropzone:hover,
  .dropzone-active {
    border-color: var(--amethyst);
    box-shadow: 0 0 20px rgba(232, 185, 74, 0.1);
    background: rgba(232, 185, 74, 0.03);
  }

  .dropzone-icon {
    color: var(--text-muted);
    transition: color 0.3s;
  }

  .csv-dropzone:hover .dropzone-icon,
  .dropzone-active .dropzone-icon {
    color: var(--amethyst);
  }

  .dropzone-text {
    font-size: 0.85rem;
    color: var(--text-secondary);
    text-align: center;
    margin: 0;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* ── CSV Preview Table ───────────────────────────────────────────────────── */

  .csv-preview-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .csv-preview-title {
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--text-secondary);
    margin: 0;
    letter-spacing: 0.04em;
  }

  .csv-table-wrap {
    position: relative;
    overflow-x: auto;
    border-radius: 10px;
    border: 1px solid var(--border-subtle);
  }

  .csv-table-wrap::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 32px;
    background: linear-gradient(90deg, transparent, var(--surface-card));
    pointer-events: none;
    border-radius: 0 10px 10px 0;
  }

  .csv-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.78rem;
    white-space: nowrap;
  }

  .csv-table thead tr {
    background: var(--surface-overlay);
  }

  .csv-table th {
    padding: 0.5rem 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-align: left;
  }

  .csv-table tbody tr {
    animation: csv-row-in 0.3s ease-out both;
  }

  .csv-table tbody tr:nth-child(even) {
    background: rgba(180, 150, 80, 0.02);
  }

  @keyframes csv-row-in {
    from {
      opacity: 0;
      transform: translateX(-8px);
    }
  }

  .csv-table td {
    padding: 0.45rem 0.75rem;
    color: var(--text-primary);
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .csv-positive {
    color: var(--emerald);
  }

  .csv-negative {
    color: var(--ruby);
  }

  /* ── CSV Map Section ─────────────────────────────────────────────────────── */

  .csv-map-section {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .csv-split-toggle {
    display: flex;
    align-items: center;
  }

  .toggle-label {
    display: flex !important;
    flex-direction: row !important;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .toggle-check {
    width: 16px;
    height: 16px;
    accent-color: var(--amethyst);
  }

  /* ── CSV Review & Success ────────────────────────────────────────────────── */

  .csv-review {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .review-stats {
    display: flex;
    justify-content: center;
    gap: 2rem;
  }

  .review-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  .review-stat-value {
    font-size: 1.4rem;
    font-weight: 700;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .review-stat-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    font-weight: 500;
  }

  .review-stat-new .review-stat-value {
    color: #4ade80;
  }

  .review-stat-dup .review-stat-value {
    color: var(--citrine, #dbb044);
  }

  .review-stat-skip .review-stat-value {
    color: var(--text-muted);
  }

  .csv-success {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.75rem;
    padding: 2rem 1rem;
  }

  .success-icon {
    color: var(--emerald);
    animation: success-scale-in 0.5s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes success-scale-in {
    from {
      opacity: 0;
      transform: scale(0.5);
    }
    50% {
      transform: scale(1.1);
    }
  }

  .success-title {
    font-family: var(--font-display);
    font-size: 1.15rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .success-detail {
    font-size: 0.88rem;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.6;
  }

  .success-skipped {
    color: var(--text-muted);
    font-size: 0.8rem;
  }

  /* ── Responsive for modals & new components ─────────────────────────────── */

  @media (max-width: 640px) {
    .header-actions {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.4rem;
    }

    .header-actions .connect-btn,
    .header-actions .manual-btn {
      width: 100%;
      justify-content: center;
    }

    .modal-panel {
      max-height: 90vh;
      margin: 0.5rem;
    }

    .modal-header {
      padding: 1rem 1rem 0.5rem;
    }

    .modal-body {
      padding: 0.5rem 1rem 0.75rem;
    }

    .modal-footer {
      padding: 0.5rem 1rem 1rem;
    }

    .form-row {
      flex-direction: column;
      gap: 0;
    }

    .csv-dropzone {
      min-height: 120px;
      padding: 1.25rem;
    }

    .review-stats {
      gap: 1rem;
    }

    .step-line {
      width: 24px;
    }

    .step-label {
      font-size: 0.58rem;
    }

    .csv-table {
      font-size: 0.72rem;
    }
  }

  @media (max-width: 380px) {
    .manual-btn {
      font-size: 0.8rem;
      padding: 0.45rem 0.85rem;
    }

    .csv-steps {
      padding: 0 0.5rem 0.5rem;
    }

    .step-line {
      width: 16px;
      margin: 0 0.25rem;
      margin-bottom: 1.2rem;
    }

    .step-circle {
      width: 24px;
      height: 24px;
      font-size: 0.65rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .title-flare {
      animation: none !important;
      opacity: 0.6;
    }

    .page-title {
      animation: none;
    }
  }

  /* ── Institution Smart Dropdown ─────────────────────────────────────────── */
  .inst-input-wrap {
    position: relative;
    display: block;
    width: 100%;
  }

  .inst-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 50;
    background: var(--surface-raised);
    border: 1px solid var(--border-interactive);
    border-radius: 10px;
    box-shadow:
      0 8px 24px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(180, 150, 80, 0.06);
    overflow: hidden;
    animation: dropdown-in 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    max-height: 200px;
    overflow-y: auto;
  }

  @keyframes dropdown-in {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.98);
    }
  }

  .inst-dropdown-item {
    all: unset;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.6rem 0.85rem;
    font-size: 0.85rem;
    /* Explicit background so `all:unset` doesn't leave items transparent */
    background: var(--surface-raised);
    color: var(--text-secondary);
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
    box-sizing: border-box;
  }

  .inst-dropdown-item:hover,
  .inst-dropdown-item[aria-selected='true'] {
    background: rgba(232, 185, 74, 0.1);
    color: var(--text-primary);
  }

  .inst-dd-icon {
    color: var(--amethyst);
    flex-shrink: 0;
    opacity: 0.7;
  }

  /* ── Account action buttons (edit, csv, delete) ─────────────────────────── */
  .acct-action-btn {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    cursor: pointer;
    transition:
      color 0.2s ease,
      background 0.2s ease;
    flex-shrink: 0;
    opacity: 0;
    color: var(--text-muted);
  }

  .account-card:hover .acct-action-btn {
    opacity: 1;
  }

  .acct-edit-btn:hover {
    color: var(--cyan);
    background: rgba(46, 196, 166, 0.08);
  }

  .acct-import-btn:hover {
    color: var(--amethyst);
    background: rgba(232, 185, 74, 0.08);
  }

  .acct-delete-btn:hover {
    color: var(--ruby);
    background: rgba(248, 113, 113, 0.08);
  }

  .acct-delete-confirm {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-shrink: 0;
    animation: dropdown-in 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }

  /* ── Account name styles ────────────────────────────────────────────────── */
  .acct-name {
    font-weight: 600;
    font-size: 0.9rem;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-radius: 4px;
    padding: 1px 4px;
    margin: -1px -4px;
    display: inline-block;
    max-width: 100%;
  }

  .acct-name.muted {
    color: var(--text-muted);
  }

  .acct-name-editable {
    cursor: text;
    transition:
      background 0.2s ease,
      box-shadow 0.2s ease;
  }

  .acct-name-editable:hover {
    background: rgba(180, 150, 80, 0.06);
  }

  /* ── Manual balance override indicator ──────────────────────────────────── */
  .acct-override-badge {
    display: inline-block;
    font-size: 0.55rem;
    color: var(--amethyst);
    vertical-align: super;
    margin-left: 0.2rem;
    opacity: 0.8;
    animation: override-pulse 3s ease-in-out infinite;
  }

  @keyframes override-pulse {
    0%,
    100% {
      opacity: 0.6;
    }
    50% {
      opacity: 1;
    }
  }

  /* ── Edit Modal ─────────────────────────────────────────────────────────── */
  .modal-edit {
    max-width: 480px;
    overflow: visible;
  }

  .edit-modal-shimmer {
    position: absolute;
    top: 0;
    left: 10%;
    right: 10%;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(46, 196, 166, 0.5),
      rgba(232, 185, 74, 0.4),
      rgba(46, 196, 166, 0.3),
      transparent
    );
    border-radius: 0 0 2px 2px;
    pointer-events: none;
    animation: edit-shimmer-slide 4s ease-in-out infinite;
  }

  @keyframes edit-shimmer-slide {
    0%,
    100% {
      opacity: 0.5;
      transform: scaleX(0.7);
    }
    50% {
      opacity: 1;
      transform: scaleX(1);
    }
  }

  .edit-modal-title-wrap {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .edit-modal-gem {
    width: 10px;
    height: 10px;
    background: linear-gradient(135deg, var(--cyan), var(--amethyst));
    clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
    animation: gem-spin 6s linear infinite;
  }

  @keyframes gem-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ── Balance override section ───────────────────────────────────────────── */
  .edit-balance-section {
    background: var(--surface-overlay);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    position: relative;
    overflow: hidden;
  }

  .edit-balance-section::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(46, 196, 166, 0.25), transparent);
    pointer-events: none;
  }

  .edit-balance-header {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--cyan);
  }

  .edit-balance-title {
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--cyan);
  }

  .edit-balance-desc {
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0;
  }

  .btn-edit-save {
    background: linear-gradient(135deg, rgba(46, 196, 166, 0.1), rgba(52, 211, 153, 0.08));
    border-color: rgba(46, 196, 166, 0.3);
    color: var(--cyan);
  }

  .btn-edit-save:hover:not(:disabled) {
    background: linear-gradient(135deg, rgba(46, 196, 166, 0.18), rgba(52, 211, 153, 0.14));
    border-color: rgba(46, 196, 166, 0.5);
    box-shadow: 0 0 24px rgba(46, 196, 166, 0.2);
  }
</style>
