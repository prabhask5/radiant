# Radiant Finance -- Tech Stack & Framework Documentation

Radiant Finance is an offline-first personal finance tracker built with SvelteKit 2, Svelte 5, and stellar-drive, featuring bank aggregation via Teller.io, Supabase-powered sync, and a crystal-themed PWA interface.

This document is self-contained. A reader with no prior experience with any of these technologies should be able to understand every framework, library, and architectural pattern used in Radiant just by reading this document from start to finish.

---

## Table of Contents

1. [SvelteKit 2 (Full-Stack Framework)](#1-sveltekit-2-full-stack-framework)
2. [Svelte 5 (UI Framework / Runes)](#2-svelte-5-ui-framework--runes)
3. [stellar-drive (Offline-First Sync Engine)](#3-stellar-drive-offline-first-sync-engine)
4. [IndexedDB / Dexie.js (Client-Side Storage)](#4-indexeddb--dexiejs-client-side-storage)
5. [Supabase (Backend-as-a-Service)](#5-supabase-backend-as-a-service)
6. [Teller.io (Bank Aggregation)](#6-tellerio-bank-aggregation)
7. [Vite (Build Tool)](#7-vite-build-tool)
8. [TypeScript (Type System)](#8-typescript-type-system)
9. [PWA / Service Worker](#9-pwa--service-worker)
10. [CSS Design System](#10-css-design-system)
11. [Architectural Patterns](#11-architectural-patterns)
12. [Developer Tooling (ESLint, Prettier, Knip, Husky)](#12-developer-tooling-eslint-prettier-knip-husky)
13. [Dependencies Reference](#13-dependencies-reference)

---

## 1. SvelteKit 2 (Full-Stack Framework)

### What is SvelteKit?

Most web applications need two programs: a **frontend** (the interactive page the user sees in a browser) and a **backend** (a server that stores data, authenticates users, and talks to third-party APIs). Traditionally these are separate codebases written in different languages. SvelteKit combines both into a single project.

SvelteKit is a **full-stack web framework** built on top of Svelte (the UI library described in section 2). It provides:

- **File-based routing** -- the directory structure of your source code directly maps to URLs in the browser. No router configuration files needed.
- **Server-side rendering (SSR)** -- the server can pre-render HTML before sending it to the browser, improving initial load speed and SEO.
- **API endpoints** -- you can write server-side request handlers (like a REST API) in the same project, in files called `+server.ts`.
- **Load functions** -- special functions that run before a page renders, fetching the data the page needs.
- **Deployment adapters** -- a plugin system that packages your app for any hosting platform (Vercel, Netlify, Node.js, etc.) without changing your code.

The key insight: SvelteKit uses the **filesystem** as an API. Instead of writing configuration to map URLs to code, you simply create files in the right directory, and SvelteKit generates the routing automatically.

### How Radiant Uses SvelteKit

Radiant uses SvelteKit as its application shell. File-system routing defines all pages (dashboard, transactions, accounts, login), route groups organize authenticated routes, and `+server.ts` endpoints handle Teller.io API calls and webhook processing. Universal load functions in `+layout.ts` initialize the stellar-drive engine and provide auth state to the entire app.

#### Routing Structure

```
src/routes/
  +page.svelte            --> /
  +layout.svelte          --> Wraps all child routes
  +layout.ts              --> Root load function
  (app)/                  --> Route group (no URL segment)
    +page.svelte          --> / (dashboard, inside app layout)
    transactions/
      +page.svelte        --> /transactions
    accounts/
      +page.svelte        --> /accounts
  login/
    +page.svelte          --> /login
  api/
    config/
      +server.ts          --> GET /api/config
    teller/
      sync/
        +server.ts        --> POST /api/teller/sync
      webhook/
        +server.ts        --> POST /api/teller/webhook
```

**Route groups** like `(app)` are a SvelteKit convention: parenthesized directory names are stripped from the final URL. They exist purely for organizational purposes -- grouping authenticated routes together, sharing a layout, etc. A file at `src/routes/(app)/transactions/+page.svelte` produces the URL `/transactions`, not `/(app)/transactions`.

#### Load Functions

Load functions are the bridge between data and UI. They run *before* a page or layout renders, and whatever they return becomes available to the component via the `data` prop.

```ts
// +layout.ts -- runs on every navigation
export const load: LayoutLoad = async ({ depends }) => {
  const engine = await initEngine(config);
  depends('app:auth');
  return { authMode: engine.authMode, session: engine.session };
};
```

| Load Type | File | Runs On | Use Case |
|-----------|------|---------|----------|
| Universal | `+page.ts` | Server and client | Data that does not need secrets |
| Server-only | `+page.server.ts` | Server only | Access to secrets, database |
| Layout | `+layout.ts` | Server and client | Shared data for child routes |

Universal load functions run on both server and client. Server-only load functions (`+page.server.ts`) run exclusively on the server, making them safe for accessing API keys or database connections.

#### Server Endpoints

Files named `+server.ts` define API endpoints that handle raw HTTP requests. They export functions named after HTTP methods:

```ts
// src/routes/api/teller/sync/+server.ts
export async function POST({ request }) {
  const body = await request.json();
  // Process the request server-side
  return new Response(JSON.stringify(result), { status: 200 });
}
```

Radiant uses server endpoints for Teller.io mTLS proxy calls and webhook handlers, because these operations require server-side secrets (certificates, API keys) that must never be exposed to the browser.

### Configuration

**File:** `svelte.config.js`

```js
import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter()
  }
};

export default config;
```

| Setting | Value | Purpose |
|---------|-------|---------|
| `preprocess` | `vitePreprocess()` | Handles `<script lang="ts">` and `<style>` blocks via Vite pipeline |
| `adapter` | `adapter-auto` | Auto-detects deployment target (Vercel, Netlify, Node, etc.) |

---

## 2. Svelte 5 (UI Framework / Runes)

### What is Svelte?

In web development, a **UI framework** helps you build interactive user interfaces by managing the relationship between data and what the user sees on screen. When data changes, the UI should update to reflect it -- this is called **reactivity**.

Most UI frameworks (React, Vue, Angular) ship a runtime library that runs in the browser alongside your code, performing change detection and DOM updates at runtime. Svelte takes a fundamentally different approach: it is a **compiler**. At build time, Svelte analyzes your components and generates optimized imperative JavaScript that directly manipulates the DOM. There is no framework runtime in the browser, no virtual DOM diffing, no overhead -- just the minimal code needed to update exactly what changed.

A Svelte component is a single `.svelte` file containing three sections:

```svelte
<script lang="ts">
  // JavaScript/TypeScript logic
</script>

<!-- HTML template -->
<p>Hello world</p>

<style>
  /* CSS, scoped to this component by default */
  p { color: gold; }
</style>
```

### Svelte 5 Runes

Svelte 5 introduced **runes** -- special compiler-recognized function calls that explicitly declare reactive behavior. Runes replaced the implicit reactivity model of earlier Svelte versions (where `let` was automatically reactive) with explicit declarations that are clearer and more predictable.

#### `$state()` -- Reactive Mutable State

`$state()` declares a piece of mutable reactive state. Whenever the value changes, any part of the UI that reads it will automatically re-render:

```svelte
<script>
  let count = $state(0);
  let user = $state({ name: 'Alice', balance: 1000 });
</script>

<button onclick={() => count++}>{count}</button>
```

**Deep reactivity:** When you pass an object or array to `$state()`, Svelte creates a deep proxy. This means mutations like `user.name = 'Bob'` or `items.push(newItem)` are automatically detected and trigger UI updates, without needing to reassign the entire variable.

#### `$derived()` / `$derived.by()` -- Computed Values

`$derived()` declares a value that is automatically computed from other reactive state. It re-computes whenever any of its dependencies change:

```svelte
<script>
  let transactions = $state([]);
  let totalSpent = $derived(transactions.reduce((sum, t) => sum + t.amount, 0));
  let overBudget = $derived(totalSpent > 500);
</script>
```

For complex derivations that need multiple statements, use `$derived.by()` which takes a function:

```svelte
<script>
  let filteredTransactions = $derived.by(() => {
    const filtered = transactions.filter(t => t.category === selectedCategory);
    return filtered.sort((a, b) => b.date.localeCompare(a.date));
  });
</script>
```

The key property of `$derived` is that it is **read-only** and **lazy** -- you cannot assign to it, and it only recomputes when something actually reads it after a dependency changes.

#### `$effect()` -- Side Effects

`$effect()` runs a function whenever the reactive values it reads change. Svelte automatically tracks which `$state` and `$derived` values are accessed inside the function:

```svelte
<script>
  let searchQuery = $state('');

  $effect(() => {
    const results = searchTransactions(searchQuery);
    updateResults(results);
  });
</script>
```

**Cleanup:** Return a function from `$effect` to perform teardown when the effect re-runs or the component is destroyed (useful for timers, subscriptions, event listeners):

```svelte
<script>
  $effect(() => {
    const interval = setInterval(syncData, 30000);
    return () => clearInterval(interval);
  });
</script>
```

Effects run after the DOM has updated. They are the Svelte 5 equivalent of React's `useEffect`, but with automatic dependency tracking (no dependency array needed).

#### `$props()` -- Component Inputs

`$props()` declares the inputs a component accepts from its parent. It replaces `export let` from earlier Svelte versions:

```svelte
<script lang="ts">
  interface Props {
    transaction: Transaction;
    onDelete?: (id: string) => void;
    children: Snippet;
  }
  let { transaction, onDelete, children }: Props = $props();
</script>
```

Props use destructuring, so you can set defaults: `let { count = 0 }: Props = $props()`. The `interface Props` declaration provides TypeScript type checking for the component's API.

#### Snippets -- Content Composition

Snippets are Svelte 5's replacement for slots (a mechanism for passing renderable content between components). Unlike slots, snippets are typed, can receive parameters, and are passed as regular props:

```svelte
<!-- Parent -->
<TransactionList {transactions}>
  {#snippet row(transaction)}
    <div class="row">{transaction.description} -- ${transaction.amount}</div>
  {/snippet}
</TransactionList>

<!-- TransactionList.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { transactions, row }: { transactions: Transaction[]; row: Snippet<[Transaction]> } = $props();
</script>

{#each transactions as t}
  {@render row(t)}
{/each}
```

The `{@render snippet(args)}` syntax calls a snippet, similar to calling a function. The `Snippet<[Transaction]>` type declares that the snippet receives one parameter of type `Transaction`.

---

## 3. stellar-drive (Offline-First Sync Engine)

### What is stellar-drive?

stellar-drive is an npm package (`stellar-drive`) that provides a complete offline-first data layer for web applications. Instead of each app implementing its own IndexedDB access, Supabase sync logic, authentication flow, and PWA infrastructure, stellar-drive bundles all of these into a single library with a unified API.

Think of it as the "backend SDK" for local-first apps: you define your data schema once, call `initEngine()`, and stellar-drive handles everything -- local storage, cloud sync, conflict resolution, authentication, real-time updates, and service worker generation.

### How Radiant Uses stellar-drive

Radiant initializes stellar-drive once in the root `+layout.ts`. All data operations -- creating transactions, managing accounts, updating categories -- go through stellar-drive's CRUD functions. Data is written to IndexedDB first (instant, offline-capable), then queued for background sync to Supabase.

#### Engine Initialization

```ts
// src/routes/+layout.ts
import { initEngine } from 'stellar-drive';
import { schema } from '$lib/schema';
import { demoConfig } from '$lib/demo/config';

export const load: LayoutLoad = async () => {
  const engine = await initEngine({
    name: 'radiant',
    schema,
    demo: demoConfig,
  });
  return { authMode: engine.authMode };
};
```

The `initEngine()` call:
1. Opens (or creates) the IndexedDB database based on the schema
2. Sets up Supabase client and real-time subscriptions
3. Initializes the sync queue processor
4. Restores authentication state from the previous session
5. Returns the current auth mode so the UI can render accordingly

#### CRUD Operations

stellar-drive provides typed functions for all data operations:

```ts
import { create, update, remove, findAll, findOne } from 'stellar-drive';

// Create -- returns immediately after writing to IndexedDB
await create('transactions', { description: 'Coffee', amount: 4.50, category_id: '...' });

// Read -- always reads from local IndexedDB, never the network
const transactions = await findAll('transactions', { where: { category_id: catId } });
const transaction = await findOne('transactions', id);

// Update -- writes locally, queues sync
await update('transactions', id, { category_id: newCategoryId });

// Delete -- soft delete (sets deleted: true), queues sync
await remove('transactions', id);
```

All operations are **optimistic** -- they return immediately after writing to IndexedDB. The sync to Supabase happens asynchronously in the background.

#### Sync Lifecycle

1. **Write** -- User performs a CRUD operation
2. **Optimistic update** -- Data written immediately to IndexedDB
3. **Queue** -- Intent-based change record added to the sync queue
4. **Coalesce** -- Background processor groups and reduces operations (50 rapid edits become 1 request)
5. **Push** -- Coalesced changes sent to Supabase via upsert/delete
6. **Confirm** -- Queue entry removed on success, retried with exponential backoff on failure
7. **Real-time** -- Other devices receive the change via WebSocket subscription

#### Reactive Stores

stellar-drive provides reactive store factories that integrate with Svelte 5:

```svelte
<script lang="ts">
  import { createCollectionStore } from 'stellar-drive';

  const transactions = createCollectionStore('transactions', {
    where: { account_id: accountId },
    orderBy: { date: 'desc' },
    limit: 50,
  });
</script>

{#each $transactions as transaction}
  <div>{transaction.description}</div>
{/each}
```

The `createDetailStore` function provides a reactive store for a single record:

```svelte
<script lang="ts">
  import { createDetailStore } from 'stellar-drive';
  const account = createDetailStore('accounts', accountId);
</script>

{#if $account}
  <h1>{$account.name}</h1>
  <p>Balance: ${$account.balance}</p>
{/if}
```

Stores auto-refresh when sync completes (via an internal `onSyncComplete` hook), meaning the UI always reflects the latest data without manual refetching. Stores integrate naturally with Svelte 5 runes:

```svelte
<script lang="ts">
  let selectedCategory = $state('all');
  let transactions = createCollectionStore('transactions');

  let filtered = $derived(
    selectedCategory === 'all'
      ? $transactions
      : $transactions.filter(t => t.category_id === selectedCategory)
  );

  let totalSpent = $derived(filtered.reduce((sum, t) => sum + Math.abs(t.amount), 0));
</script>
```

#### Authentication

stellar-drive provides a complete auth system for single-user apps:

- `setupSingleUser` -- initial account creation (email + PIN)
- `unlockSingleUser` -- PIN-based unlock on return visits
- Device verification -- email-based verification for new devices
- Trusted devices -- remember verified devices to skip re-verification
- Offline auth -- PIN verification works offline using a locally cached bcrypt hash

#### Schema Configuration

**File:** `src/lib/schema.ts`

The schema file is the **single source of truth** for the entire database. It drives TypeScript type generation, Supabase SQL DDL, and IndexedDB (Dexie) versioning simultaneously.

```ts
import type { SchemaDefinition } from 'stellar-drive/types';

export const schema: SchemaDefinition = {
  teller_enrollments: {
    indexes: 'institution_name, status',
    fields: {
      enrollment_id: 'string',
      institution_name: 'string',
      institution_id: 'string',
      access_token: 'string',
      status: 'string',
      last_synced_at: 'timestamp?',
      error_message: 'string?'
    }
  },
  accounts: {
    indexes: 'enrollment_id, type, subtype, status, institution_name',
    fields: {
      enrollment_id: 'uuid',
      teller_account_id: 'string',
      institution_name: 'string',
      name: 'string',
      type: 'string',
      subtype: 'string',
      currency: 'string',
      last_four: 'string?',
      status: 'string',
      balance_available: 'string?',
      balance_ledger: 'string?',
      balance_updated_at: 'timestamp?',
      is_hidden: 'boolean'
    }
  },
  transactions: {
    indexes: 'account_id, date, category_id, status, [account_id+date]',
    ownership: { parent: 'accounts', fk: 'account_id' },
    fields: {
      account_id: 'uuid',
      teller_transaction_id: 'string',
      amount: 'string',
      date: 'date',
      description: 'string',
      counterparty_name: 'string?',
      counterparty_type: 'string?',
      teller_category: 'string?',
      category_id: 'uuid?',
      status: 'string',
      type: 'string?',
      running_balance: 'string?',
      is_excluded: 'boolean',
      notes: 'string?'
    }
  },
  categories: {
    indexes: 'parent_id, type, order',
    fields: {
      name: 'string',
      icon: 'string',
      color: 'string',
      type: 'string',
      parent_id: 'uuid?',
      teller_categories: 'json?',
      order: 'number'
    }
  }
};
```

#### Field Type Mapping

| Schema Type | TypeScript | PostgreSQL | Notes |
|-------------|-----------|------------|-------|
| `'string'` | `string` | `text` | |
| `'number'` | `number` | `double precision` | |
| `'boolean'` | `boolean` | `boolean` | |
| `'uuid'` | `string` | `uuid` | Foreign key reference |
| `'date'` | `string` | `date` | ISO 8601 date string |
| `'timestamp'` | `string` | `timestamptz` | ISO 8601 datetime string |
| `'json'` | `unknown` | `jsonb` | Arbitrary JSON data |
| `'string?'` | `string \| null` | `text` (nullable) | Append `?` for nullable |
| `['a', 'b']` | `'a' \| 'b'` | enum type | String union / enum |

#### Auto-Generation Pipeline

1. **TypeScript types** -- generated at `src/lib/types.generated.ts` with system columns (`id`, `created_at`, `updated_at`, `deleted`, `_version`, `device_id`) automatically included
2. **Supabase SQL** -- full idempotent DDL pushed on every dev save / build (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`, RLS policies, triggers)
3. **IndexedDB (Dexie)** -- version auto-detected via schema hash; hash changes trigger Dexie auto-upgrade

---

## 4. IndexedDB / Dexie.js (Client-Side Storage)

### What is IndexedDB?

Every web browser includes a built-in database called **IndexedDB**. Unlike cookies or localStorage (which can only store small strings), IndexedDB is a full asynchronous key-value database capable of storing megabytes of structured data -- objects, arrays, blobs -- directly in the browser. Data persists across page reloads and browser restarts.

IndexedDB is the technology that makes offline-first applications possible: instead of fetching data from a remote server on every interaction, the app reads from a local database that is already on the user's device. This eliminates network latency and allows the app to function without any internet connection.

However, the raw IndexedDB API is notoriously low-level and callback-based. **Dexie.js** is a lightweight wrapper library that provides a modern Promise-based API over IndexedDB, with support for:

- **Indexes** -- define which fields can be efficiently queried
- **Compound indexes** -- indexes on multiple fields for complex queries (e.g., `[account_id+date]`)
- **Versioning** -- handle schema changes across app updates
- **Transactions** -- group multiple reads/writes atomically

### How Radiant Uses IndexedDB / Dexie.js

Radiant stores **all application data** locally in IndexedDB via Dexie, managed entirely by stellar-drive. This is the foundation of Radiant's offline-first architecture:

- **All reads come from IndexedDB** -- the UI never waits for a network response to display data
- **All writes go to IndexedDB first** -- then queue for background sync to Supabase
- **The app is fully functional offline** -- every feature works without internet

Key implementation details:

- **Auto-versioning** -- stellar-drive computes a hash of the schema definition. When the schema changes (fields added, indexes modified), the hash changes, triggering a Dexie version upgrade that alters the IndexedDB structure automatically. No manual migration files needed.
- **Compound indexes** -- defined in `schema.ts` (e.g., `[account_id+date]`) for efficient multi-field queries
- **Demo mode isolation** -- creates a separate database (`radiant_demo`) so demo data never touches the real database
- **Corruption recovery** -- if a corrupt database is detected, stellar-drive deletes it, recreates the structure, and re-hydrates all data from Supabase

#### Query Performance

Dexie queries are optimized via defined indexes:

```ts
// Uses the 'date' index -- fast range query
const recent = await db.table('transactions')
  .where('date')
  .aboveOrEqual('2026-01-01')
  .toArray();

// Uses the compound index [account_id+date]
const accountRecent = await db.table('transactions')
  .where('[account_id+date]')
  .between([accountId, '2026-01-01'], [accountId, '2026-12-31'])
  .toArray();
```

Without an index, IndexedDB must scan every record in the table (a "table scan"). With indexes, lookups are logarithmic -- fast even with tens of thousands of records.

---

## 5. Supabase (Backend-as-a-Service)

### What is Supabase?

Building a backend from scratch typically requires setting up a database, writing an API server, implementing authentication, and managing real-time connections. **Supabase** is an open-source platform that provides all of these as managed services built on top of **PostgreSQL** (one of the most mature relational databases in existence).

Supabase provides:

- **Authentication** -- email/password, OAuth, magic links, with JWT-based sessions
- **REST API** -- automatically generated from your database tables (every table gets CRUD endpoints)
- **Real-time WebSocket** -- subscribe to database changes and receive them instantly via WebSocket
- **Row Level Security (RLS)** -- database-level access control policies that run inside PostgreSQL, ensuring users can only access their own data regardless of how the API is called
- **PostgreSQL** -- the full power of a relational database (joins, indexes, triggers, functions)

The key benefit: Supabase eliminates the need to write and maintain a custom backend server for standard data operations.

### How Radiant Uses Supabase

Supabase provides three services for Radiant:

1. **Authentication** -- email-based with JWT sessions (the first layer of Radiant's multi-layer auth)
2. **PostgreSQL storage** -- the cloud sync target for stellar-drive (backup + multi-device access)
3. **Real-time subscriptions** -- multi-device sync via WebSocket channels

#### Authentication Flow

1. **Supabase session** -- email-based authentication creates a JWT session
2. **PIN gate** -- single-user PIN lock screen before accessing the app
3. **Device verification** -- trusted device management with device IDs
4. **Offline auth** -- PIN verification works offline using locally stored bcrypt hash

#### Real-Time Subscriptions

Supabase Realtime uses PostgreSQL's logical replication to detect changes and broadcast them over WebSocket connections:

```
Supabase Realtime (WebSocket)
  -> postgres_changes channel
  -> INSERT / UPDATE / DELETE events
  -> stellar-drive processes remote changes
  -> IndexedDB updated
  -> Reactive stores re-emit
  -> UI updates automatically
```

This is how multi-device sync works: when Device A writes data that syncs to Supabase, Supabase broadcasts the change over WebSocket, and Device B receives it, writes it to its local IndexedDB, and the UI updates.

#### Row Level Security (RLS)

Every table has RLS enabled with policies ensuring users only access their own data. Even if someone obtained a valid JWT and tried to query another user's data directly through the Supabase API, the database itself would reject the query:

```sql
-- Auto-generated by stellar-drive schema push
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own data"
  ON transactions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

`auth.uid()` is a PostgreSQL function provided by Supabase that extracts the user ID from the JWT token on the current request. The policy says: "for any operation on transactions, only allow it if the row's `user_id` matches the authenticated user."

---

## 6. Teller.io (Bank Aggregation)

### What is Teller.io?

**Bank aggregation** is the process of connecting to a user's bank accounts programmatically to retrieve balances and transaction history. This is what apps like Mint, YNAB, and Copilot use to automatically import financial data.

**Teller.io** is a bank data aggregation service that provides a REST API for accessing account balances, transaction history, and account metadata from financial institutions. Unlike most competitors (Plaid, MX), Teller uses **mutual TLS (mTLS) authentication** -- every API request must include a client certificate, not just an API key.

**mTLS explained:** Normal HTTPS (TLS) verifies that the *server* is who it claims to be (the browser checks the server's certificate). Mutual TLS adds a second check: the *server* also verifies the *client's* identity by requiring the client to present its own certificate. This is a stronger security model because stolen API keys alone are not sufficient to make requests -- you also need the private key for the client certificate.

### How Radiant Uses Teller.io

Radiant uses Teller.io to connect users' bank accounts, fetch transaction data, and receive webhook notifications for new transactions. The architecture has two parts:

1. **Client-side:** The Teller Connect widget (a JavaScript SDK) handles the bank enrollment flow -- the user selects their bank, enters credentials, and Teller returns an access token.
2. **Server-side:** SvelteKit `+server.ts` endpoints handle all actual API calls to Teller, because browsers cannot perform mTLS (they have no way to attach client certificates to fetch requests).

#### mTLS Authentication

```ts
const agent = new https.Agent({
  cert: tellerCertificate,  // Client certificate (PEM)
  key: tellerPrivateKey,     // Client private key (PEM)
});

const response = await fetch('https://api.teller.io/accounts', {
  headers: { Authorization: `Basic ${encodedToken}` },
  agent,
});
```

The `cert` and `key` are stored as environment variables on the server, never exposed to the browser.

#### Data Flow

All Teller data flows through three paths, all of which write server-side to Supabase using `createServerAdminClient('radiant')` from `stellar-drive/kit` (service_role key, bypasses RLS):

1. **Initial enrollment** -- User connects a bank via Teller Connect, client calls `POST /api/teller/sync`, server fetches from Teller via mTLS and writes accounts + transactions + balances directly to Supabase. Client also writes to local IndexedDB via `getDb().table().bulkPut()` for immediate UI. Other devices receive data via stellar-drive's realtime WebSocket.

2. **Webhook-driven updates** -- `POST /api/teller/webhook` processes two event types:
   - `transactions.processed`: Looks up enrollment in Supabase by Teller enrollment_id, fetches new data from Teller via mTLS, upserts accounts + transactions + balances into Supabase. All connected clients receive updates via realtime.
   - `enrollment.disconnected`: Updates enrollment status to `disconnected` in Supabase. All clients see it via realtime.
   - Expired access tokens (401 from Teller) automatically mark enrollments as disconnected.

3. **Manual refresh** -- The retry/refresh button on the accounts page calls `POST /api/teller/sync` (same as initial enrollment flow).

There is **no polling** -- no auto-sync on page load. Data stays fresh via webhooks. Balances update whenever `transactions.processed` fires. All connected clients receive updates automatically via stellar-drive's realtime WebSocket.

#### Key Technical Details

- **Stable IDs:** Server looks up existing records by `teller_account_id` / `teller_transaction_id` to reuse UUIDs, ensuring idempotent upserts
- **Batch processing:** Transactions upserted in batches of 200 (Supabase payload limits)
- **Immediate UI:** Client writes to IndexedDB via `getDb().table().bulkPut()` for instant display, bypassing the sync queue
- **Preservation:** Local enrichments (category assignments, notes) are preserved across Teller data refreshes

#### Webhook Verification

1. `POST /api/teller/webhook` receives the payload
2. **HMAC-SHA256** signature verified against `TELLER_WEBHOOK_SECRET`
3. **Replay protection** -- timestamp validation prevents replayed webhook deliveries
4. Event type determines processing path (`transactions.processed` or `enrollment.disconnected`)
5. Data upserted to Supabase server-side -- propagates to all devices via realtime

---

## 7. Vite (Build Tool)

### What is Vite?

When you write a web application using TypeScript, Svelte components, and CSS, browsers cannot execute that code directly. A **build tool** transforms your source code into optimized JavaScript, CSS, and HTML that browsers understand.

**Vite** (French for "fast") is a build tool that provides:

- **Instant dev server startup** -- instead of bundling your entire app before serving it (like Webpack does), Vite serves source files directly using the browser's native ES module support. Only the files actually requested by the browser are transformed, on demand.
- **Hot Module Replacement (HMR)** -- when you save a file during development, only that module is replaced in the browser, preserving application state. You see changes in milliseconds instead of waiting for a full rebuild.
- **Production builds** -- uses Rollup (a mature JavaScript bundler) to produce optimized, tree-shaken, code-split bundles for deployment.

SvelteKit uses Vite as its underlying build system. The Svelte compiler runs as a Vite plugin, transforming `.svelte` files during both development and production builds.

### How Radiant Uses Vite

Radiant's Vite configuration integrates two plugins (SvelteKit and stellarPWA), defines vendor chunk splitting for caching optimization, and targets modern browsers for smaller output.

### Configuration

**File:** `vite.config.ts`

```ts
import { sveltekit } from '@sveltejs/kit/vite';
import { stellarPWA } from 'stellar-drive/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    sveltekit(),
    stellarPWA({ prefix: 'radiant', name: 'Radiant Finance', schema: true })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('@supabase')) return 'vendor-supabase';
            if (id.includes('dexie')) return 'vendor-dexie';
          }
        }
      }
    },
    chunkSizeWarningLimit: 500,
    minify: 'esbuild',
    target: 'es2020'
  }
});
```

| Setting | Value | Purpose |
|---------|-------|---------|
| `plugins[0]` | `sveltekit()` | SvelteKit integration with Vite (Svelte compiler, routing, SSR) |
| `plugins[1]` | `stellarPWA(...)` | Service worker generation, schema watching, asset manifest |
| `manualChunks` | custom function | Isolates `@supabase` and `dexie` into vendor chunks for long-term caching |
| `chunkSizeWarningLimit` | `500` | Only warn for chunks above 500 KB |
| `minify` | `'esbuild'` | Faster minification than terser with comparable output |
| `target` | `'es2020'` | Modern browsers only, no legacy polyfills needed |

**Vendor chunk splitting** is a performance optimization. Libraries like `@supabase` and `dexie` rarely change between deployments. By isolating them into separate chunks, browsers can cache them indefinitely and only re-download the application code that actually changed.

---

## 8. TypeScript (Type System)

### What is TypeScript?

JavaScript is **dynamically typed** -- a variable can hold any type of value, and type errors only surface at runtime (when the code actually executes). **TypeScript** is a superset of JavaScript that adds a static type system. It lets you annotate variables, function parameters, and return values with types, and a compiler checks these types *before* the code runs.

```ts
// JavaScript -- this runs but crashes at runtime
function add(a, b) { return a + b; }
add(5, "hello"); // "5hello" -- not what you wanted

// TypeScript -- this is caught at compile time
function add(a: number, b: number): number { return a + b; }
add(5, "hello"); // ERROR: Argument of type 'string' is not assignable to parameter of type 'number'
```

TypeScript compiles to plain JavaScript -- browsers never see the type annotations. The types exist purely as a development-time safety net.

Key TypeScript concepts used in Radiant:

- **Interfaces** -- define the shape of an object (`interface Transaction { id: string; amount: number; }`)
- **Generics** -- type parameters that make functions/types reusable (`Store<Transaction>`)
- **Union types** -- a value that can be one of several types (`string | null`)
- **Strict mode** -- enables all strict type-checking flags, catching more errors

### How Radiant Uses TypeScript

Radiant uses TypeScript in strict mode across the entire codebase. The schema system auto-generates typed interfaces for every database table, and app-specific types compose generated types with domain logic.

#### Generated Types

`src/lib/types.generated.ts` provides one interface per schema table with system columns automatically included:

```ts
// Auto-generated -- do not edit
export interface Transaction {
  id: string;
  description: string;
  amount: number;
  date: string;
  account_id: string;
  category_id: string | null;
  // ... more fields
  created_at: string;
  updated_at: string;
  deleted: boolean;
  _version: number;
  device_id: string;
}
```

The system columns (`id`, `created_at`, `updated_at`, `deleted`, `_version`, `device_id`) are added by stellar-drive to every table and support sync, conflict resolution, and soft deletes.

#### Composite Types

App-specific types compose generated types with domain logic:

```ts
// src/lib/types.ts
export interface TransactionWithCategory {
  id: string;
  account_id: string;
  amount: string;
  date: string;
  description: string;
  counterparty_name: string | null;
  status: TransactionStatus;
  type: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  is_excluded: boolean;
  notes: string | null;
}

export interface AccountWithDetails {
  id: string;
  institution_name: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  last_four: string | null;
  status: AccountStatus;
  balance_available: string | null;
  balance_ledger: string | null;
  transaction_count: number;
  is_hidden: boolean;
}
```

These composite types represent the data shapes that UI components actually consume -- often a join or projection of multiple database tables.

### Configuration

**File:** `tsconfig.json`

```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "allowJs": true,
    "checkJs": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "strict": true,
    "moduleResolution": "bundler"
  }
}
```

| Setting | Value | Purpose |
|---------|-------|---------|
| `strict` | `true` | Enables all strict type-checking options (null checks, implicit any, etc.) |
| `moduleResolution` | `"bundler"` | Matches Vite's module resolution strategy (imports resolved by Vite, not Node) |
| `checkJs` | `true` | Type-checks JavaScript files alongside TypeScript |
| `skipLibCheck` | `true` | Skips type-checking declaration files for faster builds |

---

## 9. PWA / Service Worker

### What is a PWA?

A **Progressive Web App (PWA)** is a web application enhanced with technologies that make it behave like a native app installed on the user's device. The three pillars of a PWA are:

1. **Service Worker** -- a JavaScript file that runs in a separate thread from your app, intercepting every network request. It can serve cached responses when the network is unavailable, enabling full offline support.
2. **Web App Manifest** -- a JSON file that tells the browser how to display the app when "installed" (icon, name, splash screen, orientation, whether to show the browser's URL bar).
3. **HTTPS** -- PWAs require a secure connection (enforced by browsers).

When a user "installs" a PWA, the browser creates a standalone window without the URL bar, an icon on the home screen, and the app launches like a native application. Unlike native apps, PWAs update automatically (no app store review process) and share the same codebase as the website.

**Service workers** are the most complex piece. They operate on a lifecycle:

1. **Install** -- the service worker downloads and caches the app's assets
2. **Activate** -- the new service worker takes control, cleans up old caches
3. **Fetch** -- every network request from the app passes through the service worker, which decides whether to serve from cache or go to the network

### How Radiant Uses PWA

The service worker is generated by the `stellarPWA` Vite plugin from stellar-drive. It precaches build assets, applies strategy-based caching for different resource types, and enables full offline functionality.

#### Caching Strategies

Different resources need different caching behaviors:

| Resource Type | Strategy | How It Works |
|--------------|----------|-------------|
| Content-hashed assets (`/_app/immutable/`) | **Cache-first** | Check cache first. If found, return immediately (the content hash in the filename guarantees the cached version is correct). If not found, fetch from network and cache. |
| Shell resources (HTML, manifest, icons) | **Stale-while-revalidate** | Return the cached version immediately (fast), then fetch the latest version in the background and update the cache for next time. |
| Navigation requests | **Network-first, offline fallback** | Try the network first for fresh content. If the network fails (offline), serve the cached version. |
| API requests | **Network-only** | Always go to the network. API responses are dynamic and should not be cached by the service worker (data caching is handled by IndexedDB). |

#### Service Worker Lifecycle

1. **Install** -- precache all assets from the build manifest
2. **Activate** -- clean up old cache versions, call `clients.claim()` to take control immediately
3. **Fetch** -- intercept requests and apply the appropriate caching strategy based on the URL pattern
4. **Update** -- when a new build is deployed, the new service worker is detected. `skipWaiting()` is called to activate it immediately, and `clients.claim()` ensures all open tabs switch to the new version.

#### Offline Bridge

The service worker includes an **offline bridge** -- a communication channel between the service worker and the main app thread that reports network status. This allows the UI to show online/offline indicators and adjust behavior (e.g., showing "changes will sync when online" messages).

#### Web App Manifest

```json
{
  "name": "Radiant Finance",
  "short_name": "Radiant",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#0a0806",
  "background_color": "#0a0806"
}
```

`"display": "standalone"` removes the browser's URL bar and navigation controls, making the app look native. `"orientation": "portrait"` hints that the app is designed for portrait mode.

---

## 10. CSS Design System

### What is a CSS Design System?

A **design system** is a set of reusable design decisions (colors, spacing, typography, shadows, animations) that ensure visual consistency across an application. In CSS, these decisions are expressed as **custom properties** (also called CSS variables), defined once and referenced everywhere:

```css
:root {
  --color-primary: #d4a039;
}

.button {
  background: var(--color-primary);  /* References the variable */
}
```

This means changing `--color-primary` in one place updates every element that uses it. Custom properties also cascade through the DOM, so they can be overridden for specific sections of the page.

### Radiant's Design Language

Radiant uses a **gem/crystal aesthetic** -- dark, luxurious surfaces with luminous accents inspired by precious stones. The design is mobile-first (optimized for phone screens first, then adapted for larger screens) and follows a cinematic, premium feel.

#### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| Void | `#0a0806` | Deepest background, app shell |
| Obsidian | | Dark surface layer |
| Onyx | | Card backgrounds |
| Surface | | Elevated elements |
| Citrine (Primary) | `#d4a039` | Primary accent, CTAs, highlights |
| Emerald | | Positive values (income, gains) |
| Ruby | | Negative values (expenses, errors) |
| Sapphire | | Informational, links |

#### Typography

- **SF Pro Display** -- headings and large text (geometric, clean)
- **SF Pro Text** -- body copy and UI labels (optimized for legibility at small sizes)

#### Animation System

Radiant uses several animation techniques for its premium feel:

- **Entrance stagger** -- elements appear sequentially with slight delays, creating a cascading reveal effect
- **Shimmer gradients** -- loading placeholders with a traveling highlight animation
- **Float oscillation** -- subtle vertical movement on decorative elements
- **Spring curves** -- physics-based easing for interactions (more natural than linear or cubic-bezier)

#### Glass-morphism

Glass-morphism creates translucent, frosted-glass surfaces using CSS `backdrop-filter`:

```css
.glass-panel {
  background: rgba(10, 8, 6, 0.7);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(212, 160, 57, 0.1);
}
```

This effect layers the panel over content behind it, blurring the background to create depth.

#### Mobile-First Responsive Design

All styles are written for mobile screens first, then enhanced for larger screens using `min-width` media queries:

```css
.grid {
  display: grid;
  grid-template-columns: 1fr;  /* Mobile: single column */
}

@media (min-width: 768px) {
  .grid {
    grid-template-columns: 1fr 1fr;  /* Tablet+: two columns */
  }
}
```

#### Dynamic Island Safe Areas

On modern iPhones, the **Dynamic Island** (camera/sensor housing at the top of the screen) overlaps the display area. Fixed or fullscreen elements must account for this using CSS environment variables:

```css
.fixed-header {
  padding-top: env(safe-area-inset-top);
}
```

Radiant accounts for Dynamic Island safe areas on all fixed and fullscreen elements to prevent content from being hidden behind the hardware cutout.

#### Landscape Blocker

Since Radiant is a mobile-first finance app optimized for portrait mode, it displays a portrait-only hint when the device is rotated to landscape orientation, encouraging the user to rotate back.

---

## 11. Architectural Patterns

This section describes the high-level architectural patterns that Radiant implements. Each subsection first explains what the pattern is conceptually (independent of Radiant), then describes how Radiant specifically implements it.

---

### 11.1 Local-First Architecture

#### What is Local-First?

In a traditional web application, data lives on a server. Every time the user wants to read or write data, the app sends a network request to the server and waits for a response. This means:

- The app is useless without an internet connection
- Every interaction has latency (typically 100-500ms for a round trip)
- The server is a single point of failure

**Local-first** inverts this model. The app stores all data on the user's device (in Radiant's case, in IndexedDB). All reads and writes happen against the local database. The server exists only as a backup and sync mechanism -- not as a gatekeeper.

#### How Radiant Implements It

- **All reads come from IndexedDB.** When the dashboard shows your account balances or transaction list, it queries the local database. No network request is made.
- **All writes go to IndexedDB first.** When you categorize a transaction, the change is saved locally in under 5ms. The UI updates instantly.
- **Supabase is the cloud backup.** Changes sync to Supabase asynchronously in the background. If the network is down, changes queue up and sync when connectivity returns.
- **The app works fully offline.** Every feature -- viewing transactions, editing categories, adding notes -- works without internet. The only features that require a network are initial bank enrollment (Teller Connect) and initial Supabase auth setup.

**Result:** Perceived latency is under 5ms for all data operations. The app feels instant.

---

### 11.2 Outbox Pattern (Intent-Based Sync Queue)

#### What is the Outbox Pattern?

The **outbox pattern** comes from distributed systems. Instead of sending changes to a remote server immediately (which might fail, be slow, or happen too frequently), you write them to a local "outbox" (a queue). A background process reads from the outbox and sends changes to the server at its own pace.

The variant Radiant uses is **intent-based**: the queue stores *operations* (what the user intended to do), not *state snapshots* (what the data looks like now). This distinction matters: if a user edits a transaction's category 50 times in rapid succession, a state-based queue would store 50 snapshots. An intent-based queue stores 50 "set category" operations, which can be **coalesced** (reduced) into a single operation: "set category to the final value."

#### How Radiant Implements It

stellar-drive maintains a sync queue in IndexedDB. Every CRUD operation adds an entry to this queue with the operation type (`create`, `set`, `increment`, `delete`) and the affected fields.

A background processor runs on a timer, reading from the queue and sending changes to Supabase. Before sending, it runs a **6-step coalescing pipeline**:

1. **Group by entity** -- collect all pending operations for the same record
2. **Entity-level reduction** -- reduce multiple operations on the same entity (e.g., create + multiple updates = one create with final values)
3. **Increment coalescing** -- combine multiple increment operations into a single increment (e.g., +1, +3, -2 = +2)
4. **Set coalescing** -- for the same field set multiple times, keep only the last value
5. **No-op pruning** -- remove operations that have no net effect (e.g., increment by 0, set to current value)
6. **Batch persist** -- group the remaining operations into minimal API calls

**Result:** 50 rapid edits to the same transaction produce 1 network request, not 50. This dramatically reduces bandwidth usage and server load.

---

### 11.3 Field-Level Conflict Resolution

#### What is Conflict Resolution?

When an app runs on multiple devices, conflicts are inevitable. Imagine you edit a transaction's category on your phone (offline) while also editing its notes on your tablet (also offline). When both devices come back online and sync, the server receives two different versions of the same record. Which one wins?

**Row-level resolution** (the simplest approach) picks one version and discards the other. This means one of your edits is silently lost.

**Field-level resolution** is smarter: it compares the records field by field. Since you edited *different* fields (category on phone, notes on tablet), both changes can be merged without any conflict.

#### How Radiant Implements It

stellar-drive uses a three-tier resolution strategy:

1. **Non-overlapping entities** -- If two devices edited *different* records, there is no conflict. Both changes are applied. This is the most common case.

2. **Different fields, same entity** -- If two devices edited *different fields* of the *same* record, both changes are merged automatically. Your category edit and notes edit both survive.

3. **Same field, same entity** -- If two devices edited the *same field* of the *same record*, a strategy-based resolver kicks in:
   - `local_pending` -- if the local device has an unsynced change to that field, the local version wins (preserving the user's most recent intent)
   - `delete_wins` -- if one device deleted the record, the delete takes precedence
   - `last_write` -- if timestamps are available, the most recent write wins
   - **Device-ID tiebreaking** -- if timestamps are identical (simultaneous writes), a deterministic comparison of device IDs breaks the tie

stellar-drive maintains a **30-day audit trail** in a `conflictHistory` table, recording every conflict that occurred and how it was resolved. This provides transparency and debugging capability.

---

### 11.4 Optimistic UI Updates

#### What is Optimistic UI?

In a traditional web app, the flow is: user clicks a button -> app sends a request to the server -> app waits for the response -> app updates the UI. During the wait, the UI either freezes or shows a loading spinner. This creates a sluggish, unresponsive feel.

**Optimistic UI** assumes that the operation will succeed and updates the UI immediately, without waiting for server confirmation. The actual server communication happens in the background. If the server confirms success, nothing more needs to happen (the UI already shows the correct state). If the server rejects the change, the UI rolls back.

#### How Radiant Implements It

Every write operation in Radiant follows this flow:

1. User performs an action (e.g., assigns a category to a transaction)
2. stellar-drive writes to IndexedDB immediately (under 5ms)
3. The reactive store detects the change and the UI updates instantly
4. The change is added to the sync queue
5. The background processor sends it to Supabase asynchronously
6. If sync fails, it retries with **exponential backoff** (wait 1s, then 2s, then 4s, then 8s...) until it succeeds

The user never sees a loading spinner for data operations. The app feels as responsive as a native app.

---

### 11.5 Schema-Driven Development

#### What is Schema-Driven Development?

In most applications, the database schema, the TypeScript types, and the API layer are defined separately and must be kept in sync manually. This leads to a common class of bugs: you add a field to the database but forget to update the TypeScript interface, or vice versa.

**Schema-driven development** uses a single schema definition as the **source of truth** for everything. All other representations are automatically generated from it.

#### How Radiant Implements It

The file `src/lib/schema.ts` is the single source of truth. From this one file, stellar-drive generates:

1. **TypeScript types** -- `src/lib/types.generated.ts` contains typed interfaces for every table, with system columns automatically included. These types are used throughout the app for type safety.

2. **Supabase SQL DDL** -- idempotent SQL statements (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`) are pushed to Supabase on every build. This means there are no migration files to manage -- the DDL is always derived from the current schema. RLS policies and triggers are included.

3. **IndexedDB structure** -- Dexie table definitions and indexes are generated from the schema. stellar-drive computes a hash of the schema definition; when the hash changes (because you added a field or index), the IndexedDB version number increments automatically, triggering Dexie's upgrade mechanism.

**Result:** Add a field to `schema.ts`, and the TypeScript types, PostgreSQL columns, and IndexedDB indexes all update automatically. No manual migration files, no type mismatches, no forgotten updates.

---

### 11.6 Reactive Store Pattern

#### What is the Reactive Store Pattern?

UI frameworks need a way to keep the screen in sync with the underlying data. The **reactive store pattern** wraps a data source in an observable container (a "store") that notifies subscribers whenever the data changes. Components subscribe to stores and automatically re-render when the store's value updates.

This is different from manually fetching data and calling a "setState" function -- the store handles the notification automatically.

#### How Radiant Implements It

stellar-drive provides two store factory functions:

- **`createCollectionStore(table, query)`** -- wraps an IndexedDB query and returns a reactive Svelte store containing an array of records. The store automatically re-queries when sync completes (via an internal `onSyncComplete` hook).

- **`createDetailStore(table, id)`** -- wraps a single-record lookup and returns a reactive store containing one record (or null).

Components subscribe using Svelte's `$` prefix syntax:

```svelte
<script>
  const transactions = createCollectionStore('transactions');
  let total = $derived($transactions.reduce((sum, t) => sum + t.amount, 0));
</script>

<p>Total: {total}</p>
{#each $transactions as t}
  <div>{t.description}</div>
{/each}
```

The data flow is:

1. Component creates a store (one-time setup)
2. Store queries IndexedDB and emits the initial result
3. User performs a CRUD operation -> IndexedDB updates
4. Sync processor runs -> `onSyncComplete` fires
5. Store re-queries IndexedDB and emits the new result
6. Svelte reactivity propagates the change to the component
7. UI re-renders with the new data

Derived state (`$derived` runes) can compose store values with local state, creating computed views that update automatically whenever any dependency changes.

---

### 11.7 Real-Time Event-Driven Sync

#### What is Event-Driven Sync?

When data changes on one device, other devices need to learn about it. There are two approaches:

- **Polling** -- each device periodically asks the server "has anything changed?" This is simple but wasteful (most polls find nothing) and introduces delay (changes are not seen until the next poll interval).

- **Event-driven (push)** -- the server notifies devices when something changes, typically via a **WebSocket** (a persistent two-way connection between browser and server). Changes propagate in real time with no wasted requests.

#### How Radiant Implements It

Radiant uses Supabase Realtime, which is built on PostgreSQL's **Change Data Capture (CDC)** -- a feature that streams database changes as they happen.

The full pipeline:

1. Device A writes a change that syncs to Supabase
2. PostgreSQL detects the INSERT/UPDATE/DELETE via CDC
3. Supabase Realtime broadcasts the event over WebSocket to all subscribed clients
4. Device B's stellar-drive receives the event
5. **Echo suppression** -- stellar-drive checks the `device_id` field on the change. If it matches the current device's ID, the event is ignored (the device already has this change locally). This prevents a device from processing its own outgoing changes as incoming changes.
6. stellar-drive writes the change to Device B's IndexedDB
7. Reactive stores detect the change and re-emit
8. Device B's UI updates

**Fallback:** If the WebSocket connection drops (network instability, device sleep), stellar-drive falls back to polling with automatic reconnection attempts. When the WebSocket reconnects, it resumes real-time events.

---

### 11.8 Tombstone Soft Delete Pattern

#### What is Soft Delete?

When a user deletes a record, the naive approach is to immediately remove it from the database (a "hard delete"). In a multi-device offline system, this creates a problem: if Device A deletes a record while Device B is offline, how does Device B learn about the deletion when it comes back online? The record is already gone from the server -- there is nothing to sync.

**Soft delete** solves this by never actually removing records. Instead, a `deleted` flag is set to `true`. The record still exists in the database but is filtered out of all queries. Other devices see the `deleted: true` update via sync and hide the record locally too.

The term "tombstone" refers to this marker -- the record's "tombstone" remains in the database, indicating that it once existed but has been logically deleted.

#### How Radiant Implements It

1. User deletes a transaction (or account, category, etc.)
2. stellar-drive sets `deleted: true` on the record in IndexedDB
3. The change is queued for sync to Supabase
4. All reactive stores filter out `deleted: true` records, so the UI no longer shows them
5. Other devices receive the `deleted: true` update via real-time sync and also hide the record
6. After a **7-day retention period**, a garbage collection process hard-deletes the record from both Supabase and IndexedDB

The retention period prevents data loss in multi-device offline scenarios: if a device has been offline for several days, it still receives the tombstone when it reconnects, ensuring it knows to hide the record. Only after enough time has passed for all devices to have synced does the record get permanently removed.

---

### 11.9 Defense-in-Depth Authentication

#### What is Defense-in-Depth?

**Defense-in-depth** is a security strategy where multiple independent layers of protection are stacked. If one layer is compromised, the attacker still has to get through the remaining layers. This contrasts with relying on a single security mechanism (a single point of failure).

#### How Radiant Implements It

Radiant uses **four layers** of authentication, each protecting against different attack vectors:

1. **Supabase JWT Session** -- the first layer. The user authenticates with email and password via Supabase, receiving a JSON Web Token (JWT) that proves their identity. This token is required for all Supabase API calls and expires after a configurable period.

2. **PIN Gate (bcrypt)** -- even with a valid session, the user must enter a numeric PIN to access the app. The PIN is hashed using **bcrypt** (a deliberately slow hashing algorithm designed for passwords) and stored locally. This protects against someone who has physical access to an already-logged-in device.

3. **Device Verification (email)** -- when a new device attempts to access the account, an email verification step is required before the device is trusted. This prevents unauthorized devices from accessing the account even if they have the correct email and password.

4. **Rate Limiting (exponential lockout)** -- repeated failed PIN attempts trigger exponential backoff (each failed attempt increases the lockout period: 1s, 2s, 4s, 8s...). This makes brute-force PIN guessing impractical.

**Offline capability:** The PIN gate works offline because the bcrypt hash of the PIN is cached in IndexedDB. The user can unlock the app without network connectivity. The Supabase session is restored when the network returns.

---

### 11.10 ML Pipeline Pattern

#### What is the ML Pipeline Pattern?

Machine learning (ML) in production applications is rarely a single model making predictions. Instead, it is typically a **pipeline** -- a sequence of processing stages where each stage refines or extends the output of the previous one. Each stage is specialized for a different task, and they compose together to produce the final result.

#### How Radiant Implements It

Radiant uses a three-layer automation pipeline for automatically categorizing transactions:

1. **Classification (Naive Bayes)** -- the first layer uses a Naive Bayes classifier (a probabilistic ML model) trained on the user's previous category assignments. When a new transaction comes in, the classifier predicts which category it belongs to based on the transaction description. Naive Bayes is well-suited for text classification: it is fast, works well with small training sets, and improves as more data is labeled.

2. **Propagation (Fuzzy Token Matching)** -- the second layer looks at transactions that the classifier could not confidently categorize. It uses fuzzy token matching (comparing individual words/tokens in transaction descriptions, allowing for slight variations) to find similar transactions that have already been categorized, and propagates those categories. For example, if "STARBUCKS #1234" is categorized as "Coffee", then "STARBUCKS #5678" gets the same category.

3. **Recurring Detection (Exact Interval Matching)** -- the third layer identifies recurring transactions (subscriptions, rent, utilities) by finding transactions with the same description and amount that occur at regular intervals (weekly, biweekly, monthly). Once a pattern is detected, future occurrences are automatically categorized.

**Key design principle:** The pipeline runs automatically after data sync completes and **never overwrites manual user assignments**. If the user has manually categorized a transaction, the ML pipeline respects that decision. Automation only fills in gaps where the user has not made a choice.

---

## 12. Developer Tooling (ESLint, Prettier, Knip, Husky)

### ESLint (Linting)

#### What is ESLint?

**Linting** is the process of statically analyzing source code to find potential problems -- bugs, style violations, suspicious patterns -- without actually running the code. **ESLint** is the standard linter for JavaScript and TypeScript. It applies a set of rules to your code and reports violations.

For example, a lint rule might flag: using `var` instead of `let`/`const`, declaring a variable that is never used, comparing with `==` instead of `===`, or accessing a potentially null value.

#### How Radiant Uses ESLint

Radiant uses ESLint 9 with the **flat config** format (a single `eslint.config.js` file, replacing the older `.eslintrc` cascading configuration). The configuration combines:

- JavaScript recommended rules (`@eslint/js`)
- TypeScript rules (`typescript-eslint`)
- Svelte-specific rules (`eslint-plugin-svelte`)

**File:** `eslint.config.js`

```js
import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node }
    }
  },
  {
    files: ['**/*.svelte'],
    languageOptions: { parserOptions: { parser: ts.parser } },
    rules: { 'prefer-const': 'off' }
  },
  {
    files: ['**/*.ts', '**/*.js'],
    rules: { 'prefer-const': 'error' }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_'
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
      'no-var': 'error',
      'svelte/no-at-html-tags': 'warn',
      'svelte/valid-compile': ['error', { ignoreWarnings: true }],
      'svelte/require-each-key': 'warn',
      'svelte/no-navigation-without-resolve': 'off',
      'svelte/prefer-svelte-reactivity': 'off',
      'svelte/no-unused-svelte-ignore': 'warn'
    }
  },
  {
    ignores: ['.svelte-kit/**', 'build/**', 'dist/**', 'node_modules/**', 'static/**', '*.config.js', '*.config.ts']
  }
];
```

| Rule | Setting | Rationale |
|------|---------|-----------|
| `prefer-const` | `off` in `.svelte`, `error` in `.ts/.js` | Svelte 5 `$props()` destructuring requires `let`, but non-Svelte files should use `const` |
| `@typescript-eslint/no-unused-vars` | `warn` with `^_` ignore | Allow underscore-prefixed intentionally unused variables (common convention) |
| `@typescript-eslint/no-explicit-any` | `warn` | Discourage `any` without blocking builds |
| `svelte/no-navigation-without-resolve` | `off` | Too strict for app navigation patterns |

---

### Prettier (Formatting)

#### What is Prettier?

**Prettier** is an opinionated code formatter. Unlike ESLint (which finds problems), Prettier rewrites your code to follow consistent style rules. It parses the code into an AST (abstract syntax tree), discards all original formatting, and re-prints it according to its configuration. This eliminates all style debates (tabs vs spaces, semicolons, quote style) by making the decision once in configuration.

#### How Radiant Uses Prettier

**File:** `.prettierrc`

```json
{
  "useTabs": false,
  "tabWidth": 2,
  "singleQuote": true,
  "trailingComma": "none",
  "printWidth": 100,
  "plugins": ["prettier-plugin-svelte"],
  "overrides": [
    {
      "files": "*.svelte",
      "options": { "parser": "svelte" }
    }
  ]
}
```

| Setting | Value | Effect |
|---------|-------|--------|
| `useTabs` | `false` | Indent with spaces, not tabs |
| `tabWidth` | `2` | Two-space indentation |
| `singleQuote` | `true` | `'hello'` instead of `"hello"` |
| `trailingComma` | `"none"` | No trailing commas in arrays/objects |
| `printWidth` | `100` | Line wrap at 100 characters |

The `prettier-plugin-svelte` plugin enables Prettier to parse and format `.svelte` files, handling the `<script>`, template, and `<style>` sections correctly.

---

### Knip (Dead Code Detection)

#### What is Knip?

Over time, codebases accumulate **dead code** -- files that are no longer imported, functions that are never called, dependencies that are no longer used. Dead code increases bundle size, confuses developers, and creates maintenance burden. **Knip** (Dutch for "cut") analyzes your project's dependency graph from configured entry points and reports anything that is not reachable.

Knip finds:
- Unused files (not imported by anything)
- Unused exports (exported but never imported)
- Unused dependencies (in `package.json` but never imported)
- Unused dev dependencies

#### How Radiant Uses Knip

**File:** `knip.json`

```json
{
  "$schema": "https://unpkg.com/knip@latest/schema.json",
  "entry": [
    "src/routes/**/*.{svelte,ts,js}",
    "src/lib/**/*.{svelte,ts,js}"
  ],
  "project": [
    "src/**/*.{svelte,ts,js}"
  ],
  "sveltekit": {
    "config": "svelte.config.js"
  },
  "ignoreDependencies": [
    "dexie",
    "postgres",
    "stellar-drive"
  ]
}
```

The `sveltekit` configuration tells Knip to understand SvelteKit's file-based routing conventions (so `+page.svelte` files are recognized as entry points even though nothing explicitly imports them). The `ignoreDependencies` list includes packages that are used at runtime but not directly imported in application code (they are dependencies of stellar-drive or used via the schema push pipeline).

---

### Husky (Git Hooks)

#### What is Husky?

**Git hooks** are scripts that Git runs automatically at specific points in the Git workflow (before a commit, before a push, etc.). **Husky** makes it easy to set up and manage these hooks in a JavaScript project. The most common use is a **pre-commit hook** that runs linting and formatting checks before allowing a commit, preventing broken code from entering the repository.

#### How Radiant Uses Husky

Radiant uses Husky to run pre-commit quality checks. The `prepare` npm script installs Husky's Git hooks automatically after `npm install`:

```json
{
  "scripts": {
    "prepare": "husky"
  }
}
```

When a developer runs `git commit`, Husky's pre-commit hook executes, running linting and formatting checks. If any check fails, the commit is rejected until the issues are fixed.

---

## 13. Dependencies Reference

### NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `vite dev` | Start dev server with HMR, schema watching, and auto-generation |
| `build` | `vite build` | Production build (includes schema sync to Supabase) |
| `preview` | `vite preview` | Preview production build locally |
| `check` | `svelte-check --tsconfig ./tsconfig.json` | Run TypeScript and Svelte diagnostics |
| `check:watch` | `svelte-check --tsconfig ./tsconfig.json --watch` | Run type checking in watch mode |
| `lint` | `eslint src` | Lint source files |
| `lint:fix` | `eslint src --fix` | Lint and auto-fix source files |
| `format` | `prettier --write "src/**/*.{js,ts,svelte,css,html}"` | Format all source files |
| `format:check` | `prettier --check "src/**/*.{js,ts,svelte,css,html}"` | Check formatting without writing |
| `dead-code` | `knip` | Detect unused files, exports, and dependencies |
| `dead-code:fix` | `knip --fix` | Auto-remove detected dead code |
| `cleanup` | `npm run lint:fix && npm run format` | Fix linting and formatting in one pass |
| `validate` | `npm run check && npm run lint && npm run dead-code` | Full validation: types, lint, dead code |
| `prepare` | `husky` | Install Git hooks after npm install |

### Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `stellar-drive` | ^1.2.14 | Local-first sync engine (IndexedDB, Supabase sync, auth, PWA) |
| `postgres` | ^3.4.0 | PostgreSQL client for schema migrations (used by schema push pipeline) |

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@eslint/js` | ^9.39.2 | ESLint core JavaScript rules |
| `@sveltejs/adapter-auto` | ^4.0.0 | Auto-detecting deployment adapter for SvelteKit |
| `@sveltejs/kit` | ^2.21.0 | SvelteKit full-stack framework |
| `@sveltejs/vite-plugin-svelte` | ^5.0.0 | Svelte compiler integration for Vite |
| `eslint` | ^9.39.2 | Static analysis and linting |
| `eslint-plugin-svelte` | ^3.14.0 | ESLint rules for Svelte components |
| `globals` | ^17.2.0 | Global variable definitions for ESLint |
| `husky` | ^9.1.7 | Git hooks management |
| `knip` | ^5.82.1 | Dead code and unused dependency detection |
| `prettier` | ^3.8.1 | Code formatting |
| `prettier-plugin-svelte` | ^3.4.1 | Prettier support for Svelte files |
| `svelte` | ^5.0.0 | Svelte 5 compiler and runtime |
| `svelte-check` | ^4.3.5 | TypeScript and Svelte diagnostics |
| `typescript` | ^5.0.0 | TypeScript compiler |
| `typescript-eslint` | ^8.54.0 | TypeScript rules for ESLint |
| `vite` | ^6.0.0 | Build tool and dev server |
