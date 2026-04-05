# Radiant - Self-Hosted Personal Finance with ML Auto-Categorization & Budget Management

---

## Quick Reference
| Platform | Character Limit | Key Focus |
|---|---|---|
| GitHub "About" | ~350 chars | Technical stack, key capabilities |
| GitHub Topics | 20 topics max | Discoverability keywords |
| Social Sharing (og:description) | ~200 chars | Value proposition, user benefit |
| README Tagline | ~120 chars | One-line elevator pitch |

---

## Keywords for Discoverability
**Radiant:**
personal-finance, budget-tracker, expense-tracker, subscription-tracker,
recurring-payments, bank-sync, teller-io, machine-learning, naive-bayes,
auto-categorization, offline-first, local-first, pwa, progressive-web-app,
sveltekit, svelte-5, supabase, indexeddb, typescript, self-hosted, privacy,
open-source, real-time-sync, conflict-resolution, schema-driven, mtls,
webhook, csv-import

---

## A) GitHub "About" - Summary
```
Self-hosted, offline-first personal finance PWA with ML auto-categorization, budget management, recurring transaction detection, and bank sync via Teller.io (5,000+ institutions). Built with SvelteKit 2, Svelte 5, Supabase, IndexedDB. Zero telemetry, full data ownership.
```
(280 characters)

## B) Social Sharing - Summary
```
Radiant is a self-hosted finance app that auto-categorizes transactions with ML, tracks budgets, detects recurring payments, and syncs with 5,000+ banks. Works offline. Your data stays yours.
```
(192 characters)

## C) README Tagline
```
Self-hosted, offline-first personal finance tracker with ML auto-categorization, budgets, and real-time bank sync.
```
(114 characters)

## D) GitHub - Full Description
```
Radiant is a self-hosted personal finance application that connects to 5,000+
bank and credit card accounts via Teller.io, automatically categorizes
transactions using machine learning, tracks budgets, and detects recurring
payments -- all while keeping your financial data entirely under your control.

Built offline-first with SvelteKit 2 and Svelte 5, Radiant works without
internet and syncs seamlessly across devices using a custom sync engine with
field-level conflict resolution. Install it as a PWA for native-like access
on any device.

KEY FEATURES:
- Real-time bank sync via Teller.io with mTLS authentication, webhook
  processing, and support for 5,000+ financial institutions
- ML auto-categorization using a Naive Bayes classifier that learns from
  your categorization patterns and improves over time
- Category propagation -- categorize one transaction and similar ones are
  automatically updated across your history
- Budget management with custom categories, spending tracking, and
  interactive progress charts
- Recurring transaction detection using an exact interval matching algorithm
  to surface subscriptions and regular payments
- CSV import with idempotent deduplication for bringing in historical data
  from other sources without creating duplicates
- Interactive charts including net worth trends, budget progress, and
  spending breakdowns
- Offline-first architecture with all reads from IndexedDB, optimistic
  writes, and a background sync queue
- Multi-device sync with field-level conflict resolution using
  last-writer-wins merging, grace periods, and device-ID tiebreaking
- Real-time WebSocket sync for instant updates across connected devices
- PWA with smart caching -- cache-first for immutable assets,
  network-first for navigation, background precaching

HOW TO USE:
1. Deploy your own Supabase instance and configure environment variables
2. Build and deploy the SvelteKit application to your hosting platform
3. Create an account and set up PIN-based authentication
4. Connect your bank accounts through the Teller.io integration, or import
   transactions via CSV
5. Radiant auto-categorizes transactions using ML -- review and correct to
   improve accuracy over time
6. Set up budgets by category and track spending with interactive charts
7. Recurring payments are detected automatically so you can monitor
   subscriptions
8. Install as a PWA for native-like access with full offline support

PRIVACY:
- All financial data is stored in your own Supabase instance
- Zero telemetry and zero third-party analytics
- No data leaves your infrastructure
- PIN gate, device verification, and rate limiting protect access
- mTLS secures the bank sync communication channel
```

## E) Technical Highlights
```
ARCHITECTURE:
- Schema-driven development -- single schema file auto-generates
  TypeScript types, Supabase DDL, and IndexedDB structure
- Zero-config schema migration with idempotent DDL pushed on every build,
  no migration files needed
- Factory pattern for SvelteKit endpoints and load functions via
  shared engine package (stellar-engine)
- Multi-layer authentication -- Supabase session + PIN gate + device
  verification + rate limiting
- stellar-drive sync engine powering offline-first data layer and
  multi-device conflict resolution

ML & ALGORITHMS:
- Naive Bayes classifier for transaction auto-categorization, trained
  per-user on their categorization history
- Category propagation applies learned categories to similar uncategorized
  transactions automatically
- Exact interval matching algorithm for recurring transaction detection
  across variable-length billing cycles
- Idempotent CSV import with deduplication logic to prevent duplicate
  transactions on re-import

STACK:
- SvelteKit 2 / Svelte 5 (runes, snippets, fine-grained reactivity)
- Supabase (Postgres, Auth, Realtime WebSocket)
- IndexedDB via Dexie (offline storage, optimistic reads)
- Teller.io (bank connectivity, mTLS, webhooks, 5,000+ institutions)
- TypeScript throughout
- PWA with service worker and smart caching strategies
- Interactive charting for net worth, budgets, and spending analysis
```
