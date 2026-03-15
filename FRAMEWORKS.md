# Radiant Finance -- Tech Stack & Framework Documentation

Radiant Finance is an offline-first personal finance tracker built with SvelteKit 2, Svelte 5, and stellar-drive, featuring bank aggregation via Teller.io, Supabase-powered sync, and a crystal-themed PWA interface.

---

## Table of Contents

1. [SvelteKit 2 (Full-Stack Framework)](#1-sveltekit-2-full-stack-framework)
2. [Svelte 5 (UI Framework)](#2-svelte-5-ui-framework)
3. [stellar-drive (Offline-First Sync Engine)](#3-stellar-drive-offline-first-sync-engine)
4. [IndexedDB / Dexie (Client-Side Storage)](#4-indexeddb--dexie-client-side-storage)
5. [Supabase (Backend-as-a-Service)](#5-supabase-backend-as-a-service)
6. [Teller.io (Bank Aggregation)](#6-tellerio-bank-aggregation)
7. [Vite (Build Tool)](#7-vite-build-tool)
8. [TypeScript (Type System)](#8-typescript-type-system)
9. [PWA / Service Worker (Offline Support)](#9-pwa--service-worker-offline-support)
10. [CSS Design System (Styling)](#10-css-design-system-styling)
11. [ESLint (Linting)](#11-eslint-linting)
12. [Prettier (Formatting)](#12-prettier-formatting)
13. [Knip (Dead Code Detection)](#13-knip-dead-code-detection)
14. [Husky (Git Hooks)](#14-husky-git-hooks)
15. [Development Dependencies](#15-development-dependencies)
16. [NPM Scripts](#16-npm-scripts)
17. [Runtime Dependencies](#17-runtime-dependencies)

---

## 1. SvelteKit 2 (Full-Stack Framework)

### What is SvelteKit?

SvelteKit is a full-stack web framework built on top of Svelte. It provides file-based routing, server-side rendering, API endpoints, and a deployment adapter system. SvelteKit handles both the frontend and backend of an application in a single project, using the filesystem to define routes and endpoints.

### How Radiant uses SvelteKit

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

Route groups like `(app)` organize authenticated routes without adding a URL segment -- the parenthesized name is stripped from the final URL.

#### Load Functions

Load functions (`+page.ts`, `+layout.ts`) run before rendering and provide data to components:

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

## 2. Svelte 5 (UI Framework)

### What is Svelte 5?

Svelte is a compiler-based UI framework that converts components into efficient imperative JavaScript at build time, producing no runtime framework overhead. Svelte 5 introduces runes -- explicit compiler-recognized function calls that declare reactive state, replacing the implicit reactivity model of Svelte 3/4.

### How Radiant uses Svelte 5

Every component in Radiant uses Svelte 5 runes for state management. Transaction lists, account summaries, and form inputs all rely on `$state`, `$derived`, `$effect`, and `$props` for reactivity.

#### `$state` -- Reactive State

Declares mutable reactive state. Any assignment triggers re-renders in components that read it:

```svelte
<script>
  let count = $state(0);
  let user = $state({ name: 'Alice', balance: 1000 });
</script>

<button onclick={() => count++}>{count}</button>
```

Deep reactivity: `$state` creates proxies for objects and arrays, so `user.name = 'Bob'` triggers updates automatically.

#### `$derived` -- Computed Values

Declares a value derived from other reactive state. Re-computes automatically when dependencies change:

```svelte
<script>
  let transactions = $state([]);
  let totalSpent = $derived(transactions.reduce((sum, t) => sum + t.amount, 0));
  let overBudget = $derived(totalSpent > 500);
</script>
```

For complex derivations, use `$derived.by()`:

```svelte
<script>
  let filteredTransactions = $derived.by(() => {
    const filtered = transactions.filter(t => t.category === selectedCategory);
    return filtered.sort((a, b) => b.date.localeCompare(a.date));
  });
</script>
```

#### `$effect` -- Side Effects

Runs side effects when reactive dependencies change. Automatically tracks which `$state` / `$derived` values are read:

```svelte
<script>
  let searchQuery = $state('');

  $effect(() => {
    const results = searchTransactions(searchQuery);
    updateResults(results);
  });
</script>
```

Cleanup: return a function from `$effect` for teardown (subscriptions, timers):

```svelte
<script>
  $effect(() => {
    const interval = setInterval(syncData, 30000);
    return () => clearInterval(interval);
  });
</script>
```

#### `$props` -- Component Props

Declares component inputs. Replaces `export let` from Svelte 3/4:

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

#### Snippets -- Content Composition

Snippets replace slots for passing renderable content between components. They are typed, can receive parameters, and are passed as props:

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

---

## 3. stellar-drive (Offline-First Sync Engine)

### What is stellar-drive?

stellar-drive (`@prabhask5/stellar-engine`) is an offline-first sync engine that manages local IndexedDB storage, Supabase cloud sync, authentication, and PWA infrastructure. It provides a single `initEngine()` call that sets up the entire data layer, and exposes typed CRUD functions and reactive Svelte stores.

### How Radiant uses stellar-drive

Radiant initializes stellar-drive once in the root `+layout.ts`. All data operations -- creating transactions, managing accounts -- go through stellar-drive's CRUD functions. Data is written to IndexedDB first (instant, offline-capable), then queued for background sync to Supabase.

#### Engine Initialization

```ts
// src/routes/+layout.ts
import { initEngine } from '@prabhask5/stellar-engine';
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

#### CRUD Operations

```ts
import { create, update, remove, findAll, findOne } from '@prabhask5/stellar-engine';

// Create
await create('transactions', { description: 'Coffee', amount: 4.50, category_id: '...' });

// Read
const transactions = await findAll('transactions', { where: { category_id: catId } });
const transaction = await findOne('transactions', id);

// Update
await update('transactions', id, { category_id: newCategoryId });

// Delete (soft delete -- sets deleted: true)
await remove('transactions', id);
```

All operations are optimistic -- they return immediately after writing to IndexedDB, and sync in the background.

#### Sync Lifecycle

1. **Write** -- User performs a CRUD operation
2. **Optimistic update** -- Data written immediately to IndexedDB
3. **Queue** -- Change record added to the sync queue
4. **Process** -- Background sync processes the queue in order
5. **Push** -- Changes sent to Supabase via upsert/delete
6. **Confirm** -- Queue entry removed on success, retried on failure
7. **Real-time** -- Other devices receive the change via WebSocket subscription

#### Reactive Stores

stellar-drive provides reactive store factories for Svelte 5 integration:

```svelte
<script lang="ts">
  import { createCollectionStore } from '@prabhask5/stellar-engine';

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
  import { createDetailStore } from '@prabhask5/stellar-engine';
  const account = createDetailStore('accounts', accountId);
</script>

{#if $account}
  <h1>{$account.name}</h1>
  <p>Balance: ${$account.balance}</p>
{/if}
```

Stores integrate with Svelte 5 runes for derived computations:

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

### Configuration

**File:** `src/lib/schema.ts`

The schema file is the single source of truth for the entire database. It drives TypeScript type generation, Supabase SQL DDL, and IndexedDB (Dexie) versioning simultaneously.

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

1. **TypeScript types** -- generated at `src/lib/types.generated.ts` with system columns (`id`, `created_at`, `updated_at`, `deleted`, `_version`, `device_id`)
2. **Supabase SQL** -- full idempotent DDL pushed on every dev save / build (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`, RLS policies, triggers)
3. **IndexedDB (Dexie)** -- version auto-detected via schema hash; hash changes trigger Dexie auto-upgrade

---

## 4. IndexedDB / Dexie (Client-Side Storage)

### What is IndexedDB?

IndexedDB is a browser-native, asynchronous key-value database for storing structured data on the client. Dexie.js is a lightweight wrapper that provides a Promise-based API over the raw IndexedDB API, with support for compound indexes, versioning, and transactions.

### How Radiant uses IndexedDB

Radiant stores all application data locally in IndexedDB via Dexie, managed entirely by stellar-drive. All reads come from IndexedDB (never from the network), and all writes go to IndexedDB first before queuing for sync. This makes the app fully functional offline.

- **Auto-versioning** -- schema hash changes trigger Dexie version upgrades
- **Compound indexes** -- defined in `schema.ts` for efficient queries
- **Demo mode isolation** -- creates a separate database (`radiant_demo`) so the real database is never touched

#### Query Performance

Dexie queries are optimized via defined indexes:

```ts
// Uses the 'date' index -- fast range query
const recent = await db.table('transactions')
  .where('date')
  .aboveOrEqual('2026-01-01')
  .toArray();

// Uses the 'category_id' index
const groceries = await db.table('transactions')
  .where('category_id')
  .equals(groceryCategoryId)
  .toArray();
```

---

## 5. Supabase (Backend-as-a-Service)

### What is Supabase?

Supabase is an open-source backend platform built on PostgreSQL. It provides authentication, a RESTful API over the database, real-time WebSocket subscriptions, and row-level security (RLS) policies -- all without writing custom backend code.

### How Radiant uses Supabase

Supabase provides three services for Radiant: authentication (email-based with PIN gate), PostgreSQL storage (sync target for stellar-drive), and real-time subscriptions (multi-device sync via WebSocket channels).

#### Authentication Flow

1. **Supabase session** -- email-based authentication creates a JWT session
2. **PIN gate** -- single-user PIN lock screen before accessing the app
3. **Device verification** -- trusted device management with device IDs
4. **Offline auth** -- PIN verification works offline using locally stored hash

#### Real-Time Subscriptions

```
Supabase Realtime (WebSocket)
  -> postgres_changes channel
  -> INSERT / UPDATE / DELETE events
  -> stellar-drive processes remote changes
  -> IndexedDB updated
  -> Reactive stores re-emit
  -> UI updates
```

#### Row Level Security (RLS)

Every table has RLS enabled with policies ensuring users only access their own data:

```sql
-- Auto-generated by stellar-drive schema push
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own data"
  ON transactions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

---

## 6. Teller.io (Bank Aggregation)

### What is Teller.io?

Teller.io is a bank data aggregation service that provides a REST API for accessing account balances, transaction history, and account metadata from financial institutions. It uses mutual TLS (mTLS) authentication, requiring a client certificate on every API request.

### How Radiant uses Teller.io

Radiant uses Teller.io to connect users' bank accounts, fetch transaction data, and receive webhook notifications for new transactions. The client-side Teller Connect widget handles bank enrollment, and server-side `+server.ts` endpoints handle mTLS-authenticated API calls and write data directly to Supabase.

#### mTLS Authentication

```ts
const agent = new https.Agent({
  cert: tellerCertificate,
  key: tellerPrivateKey,
});

const response = await fetch('https://api.teller.io/accounts', {
  headers: { Authorization: `Basic ${encodedToken}` },
  agent,
});
```

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

- Stable IDs: server looks up existing records by `teller_account_id` / `teller_transaction_id` to reuse UUIDs, ensuring idempotent upserts
- Transactions upserted in batches of 200 (Supabase payload limits)
- Client writes to IndexedDB via `getDb().table().bulkPut()` for immediate UI, bypassing the sync queue
- Local enrichments (category assignments, notes) are preserved across Teller data refreshes

#### Webhook Verification

1. `POST /api/teller/webhook` receives the payload
2. HMAC-SHA256 signature verified against `TELLER_WEBHOOK_SECRET`
3. Event type determines processing path (`transactions.processed` or `enrollment.disconnected`)
4. Data upserted to Supabase server-side -- propagates to all devices via realtime

---

## 7. Vite (Build Tool)

### What is Vite?

Vite is a build tool that provides instant dev server startup via native ES modules, hot module replacement (HMR), and a Rollup-based production build pipeline. SvelteKit uses Vite as its underlying build system.

### How Radiant uses Vite

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
| `plugins[0]` | `sveltekit()` | SvelteKit integration with Vite |
| `plugins[1]` | `stellarPWA(...)` | Service worker generation, schema watching, asset manifest |
| `manualChunks` | custom function | Isolates `@supabase` and `dexie` into vendor chunks for long-term caching |
| `chunkSizeWarningLimit` | `500` | Only warn for chunks above 500 KB |
| `minify` | `'esbuild'` | Faster minification than terser with comparable output |
| `target` | `'es2020'` | Modern browsers only, no legacy polyfills |

---

## 8. TypeScript (Type System)

### What is TypeScript?

TypeScript is a typed superset of JavaScript that compiles to plain JavaScript. It provides static type checking, interfaces, generics, and IDE tooling support, catching errors at compile time rather than runtime.

### How Radiant uses TypeScript

Radiant uses TypeScript in strict mode across the entire codebase. The schema system auto-generates typed interfaces for every database table, and app-specific types in `src/lib/types.ts` compose generated types with domain logic.

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
| `strict` | `true` | Enables all strict type-checking options |
| `moduleResolution` | `"bundler"` | Matches Vite's module resolution strategy |
| `checkJs` | `true` | Type-checks JavaScript files alongside TypeScript |
| `skipLibCheck` | `true` | Skips type-checking declaration files for faster builds |

---

## 9. PWA / Service Worker (Offline Support)

### What is a PWA?

A Progressive Web App (PWA) is a web application that uses service workers, a web app manifest, and caching strategies to provide an app-like experience -- including offline support, installability, and push notifications. The service worker intercepts network requests and serves cached responses when the network is unavailable.

### How Radiant uses PWA

The service worker is generated by the `stellarPWA` Vite plugin from stellar-drive. It precaches build assets, applies strategy-based caching for different resource types, and enables full offline functionality.

#### Caching Strategies

| Resource Type | Strategy | Rationale |
|--------------|----------|-----------|
| Content-hashed assets (`/_app/immutable/`) | Cache-first | Immutable -- hash guarantees freshness |
| Shell resources (HTML, manifest, icons) | Stale-while-revalidate | Versioned, updated in background |
| Navigation requests | Network-first, offline fallback | Always try for fresh content |
| API requests | Network-only | Dynamic data, no caching |

#### Service Worker Lifecycle

1. **Install** -- precache all assets from the build manifest
2. **Activate** -- clean up old cache versions
3. **Fetch** -- intercept requests and apply caching strategy
4. **Update** -- new service worker detected, `skipWaiting` + `clients.claim`

#### Web App Manifest

```json
{
  "name": "Radiant Finance",
  "short_name": "Radiant",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#...",
  "background_color": "#..."
}
```

---

## 10. CSS Design System (Styling)

### What is a CSS Design System?

A CSS design system is a collection of design tokens (colors, spacing, typography, shadows) defined as CSS custom properties. Components reference these tokens instead of hardcoded values, ensuring visual consistency and enabling theme changes from a single location.

### How Radiant uses CSS

Radiant uses CSS custom properties for a gem/crystal design theme. All colors, spacing, typography, and elevation values are defined as tokens in `:root` and consumed by scoped component styles.

#### Theme Tokens

```css
:root {
  /* Crystal palette */
  --color-primary: ...;
  --color-surface: ...;
  --color-accent: ...;

  /* Spacing */
  --space-xs: 0.25rem;
  --space-sm: 0.5rem;
  --space-md: 1rem;
  --space-lg: 1.5rem;

  /* Typography */
  --font-body: ...;
  --font-heading: ...;

  /* Elevation */
  --shadow-sm: ...;
  --shadow-md: ...;
  --shadow-lg: ...;
}
```

#### Component Styling

Components use scoped styles with CSS custom properties:

```svelte
<style>
  .card {
    background: var(--color-surface);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    padding: var(--space-md);
  }
</style>
```

---

## 11. ESLint (Linting)

### What is ESLint?

ESLint is a static analysis tool that identifies problematic patterns in JavaScript and TypeScript code. It enforces code quality rules, catches common errors, and ensures consistent coding conventions across a project.

### How Radiant uses ESLint

Radiant uses ESLint 9 with the flat config format, combining the recommended JavaScript ruleset, TypeScript-ESLint rules, and Svelte-specific rules. Notable configuration choices include disabling `prefer-const` in Svelte files (since `$props()` destructuring uses `let`) and warning on unused variables with underscore-prefix exceptions.

### Configuration

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
| `prefer-const` | `off` in `.svelte`, `error` in `.ts/.js` | Svelte 5 `$props()` destructuring requires `let` |
| `@typescript-eslint/no-unused-vars` | `warn` with `^_` ignore | Allow underscore-prefixed intentionally unused variables |
| `@typescript-eslint/no-explicit-any` | `warn` | Discourage `any` without blocking builds |
| `svelte/no-navigation-without-resolve` | `off` | Too strict for app navigation patterns |

---

## 12. Prettier (Formatting)

### What is Prettier?

Prettier is an opinionated code formatter that enforces a consistent style by parsing code and re-printing it according to its own rules. It supports JavaScript, TypeScript, CSS, HTML, and Svelte via plugins.

### How Radiant uses Prettier

Radiant uses Prettier with the Svelte plugin for formatting all source files. The `cleanup` npm script runs Prettier alongside ESLint fix to normalize the codebase.

### Configuration

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

| Setting | Value | Purpose |
|---------|-------|---------|
| `useTabs` | `false` | Indent with spaces |
| `tabWidth` | `2` | Two-space indentation |
| `singleQuote` | `true` | Use single quotes for strings |
| `trailingComma` | `"none"` | No trailing commas |
| `printWidth` | `100` | Line wrap at 100 characters |

---

## 13. Knip (Dead Code Detection)

### What is Knip?

Knip is a tool that finds unused files, dependencies, and exports in JavaScript/TypeScript projects. It analyzes the dependency graph from configured entry points and reports anything that is not reachable.

### How Radiant uses Knip

Radiant runs Knip via the `dead-code` npm script as part of the `validate` pipeline. It is configured with SvelteKit-aware entry points to correctly trace imports through route files and library modules.

### Configuration

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

---

## 14. Husky (Git Hooks)

### What is Husky?

Husky is a tool for managing Git hooks in JavaScript projects. It installs hook scripts (pre-commit, pre-push, etc.) that run automatically during Git operations, enforcing code quality checks before code enters the repository.

### How Radiant uses Husky

Radiant uses Husky to run pre-commit checks, ensuring that code passes linting and formatting standards before being committed. The `prepare` npm script installs Husky's Git hooks automatically after `npm install`.

### Configuration

Husky is initialized via the `prepare` script in `package.json`:

```json
{
  "scripts": {
    "prepare": "husky"
  }
}
```

---

## 15. Development Dependencies

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

---

## 16. NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `vite dev` | Start dev server with HMR, schema watching, and auto-generation |
| `build` | `vite build` | Production build (includes schema sync) |
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

---

## 17. Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `stellar-drive` | ^1.1.22 | Local-first sync engine (IndexedDB, Supabase sync, auth, PWA) |
| `postgres` | ^3.4.0 | PostgreSQL client for schema migrations |
