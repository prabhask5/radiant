# Radiant - Personal Finance Tracker with Offline-First Architecture

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
personal-finance, finance-tracker, bank-sync, teller-io, transaction-viewer,
offline-first, local-first, pwa, progressive-web-app, sveltekit, svelte-5,
supabase, indexeddb, typescript, self-hosted, privacy, open-source,
real-time-sync, conflict-resolution, schema-driven, mtls, webhook

---

## A) GitHub "About" - Summary
```
Self-hosted, offline-first personal finance tracker PWA. Connect bank and credit card accounts via Teller.io, view transactions, organize by category. Built with SvelteKit 2, Svelte 5, Supabase, IndexedDB.
```
(203 characters)

## B) Social Sharing - Summary
```
Radiant is a self-hosted personal finance tracker that syncs with your bank and credit card accounts, lets you view and categorize transactions, and works entirely offline. Your financial data stays under your control.
```
(217 characters)

## C) README Tagline
```
Self-hosted, offline-first personal finance tracker with real-time bank sync and full data ownership.
```
(101 characters)

## D) GitHub - Full Description
```
Radiant is a self-hosted personal finance tracker that connects to your bank
and credit card accounts via Teller.io, providing real-time transaction sync
and category-based organization. Built offline-first with SvelteKit 2 and
Svelte 5, it works without internet and syncs seamlessly across devices --
all while keeping your financial data entirely under your control.

KEY FEATURES:
- Real-time bank sync via Teller.io with mTLS authentication and webhook
  processing
- Offline-first architecture with all reads from IndexedDB, optimistic
  writes, and a background sync queue
- Transaction viewer with category-based organization
- Multi-device sync with field-level conflict resolution using
  last-writer-wins merging, grace periods, and device-ID tiebreaking
- PWA with smart caching -- cache-first for immutable assets,
  network-first for navigation, background precaching

HOW TO USE:
1. Deploy your own Supabase instance and configure environment variables
2. Build and deploy the SvelteKit application to your hosting platform
3. Create an account and set up PIN-based authentication
4. Connect your bank accounts through the Teller.io integration
5. Transactions sync automatically -- view and organize them by category
   from any device
6. Install as a PWA for native-like access with full offline support

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
  shared engine package
- Multi-layer authentication -- Supabase session + PIN gate + device
  verification + rate limiting

STACK:
- SvelteKit 2 / Svelte 5 (runes, snippets, fine-grained reactivity)
- Supabase (Postgres, Auth, Realtime)
- IndexedDB (offline storage, optimistic reads)
- Teller.io (bank connectivity, mTLS, webhooks)
- TypeScript throughout
- PWA with service worker and smart caching strategies
```
