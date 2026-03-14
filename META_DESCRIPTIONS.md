# Meta Descriptions

Repository metadata for GitHub and other platforms.

---

## GitHub "About" Description

```
Self-hosted, offline-first personal finance tracker PWA. Bank sync via Teller.io, budgets, net worth tracking, spending insights. Built with SvelteKit 2, Svelte 5, Supabase, IndexedDB.
```

## Short Description

Radiant is a self-hosted personal finance tracker that connects to your bank accounts via Teller.io, providing real-time transaction sync, budgeting, spending analytics, and net worth tracking. Built offline-first with SvelteKit 2 and Svelte 5, it works without internet and syncs seamlessly across devices — all while keeping your financial data entirely under your control.

## Key Technical Highlights

- **Offline-first architecture** — all reads from IndexedDB, optimistic writes, background sync queue
- **Real-time bank sync** — Teller.io integration with mTLS authentication and webhook processing
- **Schema-driven development** — single schema file auto-generates TypeScript types, Supabase DDL, and IndexedDB structure
- **Field-level conflict resolution** — CRDT-inspired merging with grace periods and device-ID tiebreaking
- **Multi-layer authentication** — Supabase session + PIN gate + device verification + rate limiting
- **PWA with smart caching** — cache-first for immutable assets, network-first for navigation, background precaching
- **Auto-categorization engine** — rule-based transaction categorization with priority ordering
- **Pre-computed analytics** — spending insights and net worth snapshots for instant dashboard loads
- **Zero-config schema migration** — idempotent DDL pushed on every build, no migration files needed
- **Self-hosted, privacy-first** — zero telemetry, zero third-party analytics, user owns all data

## Topics / Tags

```
personal-finance, finance-tracker, budgeting, net-worth, bank-sync, teller-io,
offline-first, local-first, pwa, progressive-web-app, sveltekit, svelte-5,
supabase, indexeddb, typescript, self-hosted, privacy, open-source,
real-time-sync, conflict-resolution
```
