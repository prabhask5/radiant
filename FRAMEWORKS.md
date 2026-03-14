# Frameworks & Technology Reference

This document covers every technology in Radiant's stack — how it works, why it was chosen, and how it's used in this codebase.

---

## SvelteKit 2

SvelteKit is the full-stack framework powering Radiant. It provides file-based routing, server-side rendering, API endpoints, and the adapter system for deployment.

### Routing

SvelteKit uses file-system routing under `src/routes/`. Each directory maps to a URL path:

```
src/routes/
├── +page.svelte          → /
├── +layout.svelte        → Wraps all child routes
├── +layout.ts            → Root load function
├── (app)/                → Route group (no URL segment)
│   ├── +page.svelte      → / (dashboard, inside app layout)
│   ├── transactions/
│   │   └── +page.svelte  → /transactions
│   ├── budgets/
│   │   └── +page.svelte  → /budgets
│   └── accounts/
│       └── +page.svelte  → /accounts
├── login/
│   └── +page.svelte      → /login
├── api/
│   ├── config/
│   │   └── +server.ts    → GET /api/config
│   └── teller/
│       ├── sync/
│       │   └── +server.ts → POST /api/teller/sync
│       └── webhook/
│           └── +server.ts → POST /api/teller/webhook
```

Route groups `(app)` organize authenticated routes without adding a URL segment. The parenthesized name is stripped from the final URL.

### Load Functions

Load functions (`+page.ts`, `+layout.ts`) run before rendering and provide data to components:

```ts
// +layout.ts — runs on every navigation
export const load: LayoutLoad = async ({ depends }) => {
  const engine = await initEngine(config);
  depends('app:auth');
  return { authMode: engine.authMode, session: engine.session };
};
```

- **Universal load** (`+page.ts`): Runs on both server and client
- **Server load** (`+page.server.ts`): Runs only on the server, can access secrets
- `depends()` enables fine-grained invalidation via `invalidate('app:auth')`

### SSR & Adapters

Radiant uses `adapter-auto` which auto-detects Vercel and configures serverless functions. SvelteKit pre-renders static routes and server-renders dynamic ones.

### Server Endpoints

`+server.ts` files export HTTP method handlers (`GET`, `POST`, etc.) for API routes:

```ts
// api/teller/sync/+server.ts
export const POST: RequestHandler = async ({ request, locals }) => {
  // mTLS-authenticated Teller API calls
  const data = await fetchTellerTransactions(enrollmentToken);
  return json({ transactions: data });
};
```

---

## Svelte 5 Runes

Svelte 5 replaces the Svelte 3/4 reactivity model with explicit **runes** — compiler-recognized function calls that declare reactive state.

### `$state` — Reactive State

Declares mutable reactive state. Any assignment triggers re-renders in components that read it:

```svelte
<script>
  let count = $state(0);
  let user = $state({ name: 'Alice', balance: 1000 });
</script>

<button onclick={() => count++}>{count}</button>
```

Deep reactivity: `$state` creates proxies for objects and arrays, so `user.name = 'Bob'` triggers updates automatically.

### `$derived` — Computed Values

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

### `$effect` — Side Effects

Runs side effects when reactive dependencies change. Automatically tracks which `$state` / `$derived` values are read:

```svelte
<script>
  let searchQuery = $state('');

  $effect(() => {
    // Re-runs whenever searchQuery changes
    const results = searchTransactions(searchQuery);
    updateResults(results);
  });
</script>
```

Cleanup: return a function from `$effect` for teardown (subscriptions, timers, etc.):

```svelte
<script>
  $effect(() => {
    const interval = setInterval(syncData, 30000);
    return () => clearInterval(interval);
  });
</script>
```

`$effect.pre()` runs before DOM updates (useful for scroll position preservation).

### `$props` — Component Props

Declares component inputs. Replaces `export let`:

```svelte
<script>
  let { transaction, onDelete, children } = $props();
</script>
```

With TypeScript:

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

### Snippets

Snippets replace slots for content composition. They are typed, can receive parameters, and are passed as props:

```svelte
<!-- Parent -->
<TransactionList {transactions}>
  {#snippet row(transaction)}
    <div class="row">{transaction.description} — ${transaction.amount}</div>
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

## stellar-drive Overview

`stellar-drive` (`@prabhask5/stellar-engine`) is the offline-first sync engine that powers all data operations in Radiant. It provides IndexedDB storage, Supabase sync, authentication, and PWA infrastructure.

### Engine Initialization

The engine is initialized once in the root `+layout.ts`:

```ts
import { initEngine } from '@prabhask5/stellar-engine';
import { schema } from '$lib/schema';
import { demoConfig } from '$lib/demo/config';

export const load: LayoutLoad = async () => {
  const engine = await initEngine({
    name: 'radiant',
    schema,
    demo: demoConfig,
    // Supabase config resolved at runtime
  });
  return { authMode: engine.authMode };
};
```

### Sync Lifecycle

1. **Write** — User performs a CRUD operation
2. **Optimistic update** — Data written immediately to IndexedDB
3. **Queue** — Change record added to the sync queue
4. **Process** — Background sync processes the queue in order
5. **Push** — Changes sent to Supabase via upsert/delete
6. **Confirm** — Queue entry removed on success, retried on failure
7. **Real-time** — Other devices receive the change via WebSocket subscription

### CRUD Operations

stellar-drive exposes typed CRUD functions:

```ts
import { create, update, remove, findAll, findOne } from '@prabhask5/stellar-engine';

// Create
await create('transactions', { description: 'Coffee', amount: 4.50, category_id: '...' });

// Read
const transactions = await findAll('transactions', { where: { category_id: catId } });
const transaction = await findOne('transactions', id);

// Update
await update('transactions', id, { category_id: newCategoryId });

// Delete (soft delete — sets `deleted: true`)
await remove('transactions', id);
```

All operations are optimistic — they return immediately after writing to IndexedDB, and sync in the background.

---

## Schema System

`src/lib/schema.ts` is the **single source of truth** for the entire database. It drives three systems simultaneously:

### Schema Definition

```ts
import { defineSchema } from '@prabhask5/stellar-engine';

export const schema = defineSchema({
  accounts: {
    fields: {
      name: 'string',
      institution: 'string',
      type: ['checking', 'savings', 'credit', 'investment'],
      balance: 'number',
      currency: 'string',
      teller_account_id: 'string?',
      enrollment_id: 'string?',
    },
    indexes: ['type', 'enrollment_id'],
  },
  transactions: {
    fields: {
      description: 'string',
      amount: 'number',
      date: 'date',
      account_id: 'uuid',
      category_id: 'uuid?',
      teller_transaction_id: 'string?',
      is_recurring: 'boolean',
      notes: 'string?',
    },
    indexes: ['account_id', 'category_id', 'date'],
  },
  // ... 9 more tables
});
```

### Auto-Generation Pipeline

1. **TypeScript types** — generated at `src/lib/types.generated.ts` with system columns:
   ```ts
   // Auto-generated — do not edit
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

2. **Supabase SQL** — full idempotent DDL pushed on every dev save / build:
   - `CREATE TABLE IF NOT EXISTS`
   - `ALTER TABLE ADD COLUMN IF NOT EXISTS`
   - `CREATE INDEX IF NOT EXISTS`
   - RLS policies (`ENABLE ROW LEVEL SECURITY`, `CREATE POLICY`)
   - `updated_at` trigger functions

3. **IndexedDB (Dexie)** — version auto-detected via schema hash. When the hash changes, Dexie auto-upgrades the local database.

### Field Types

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

### Type Narrowing

Generated types use wide types. Narrow them in `src/lib/types.ts`:

```ts
import type { Transaction as GenTransaction } from './types.generated';

export type AccountType = 'checking' | 'savings' | 'credit' | 'investment';
export interface Transaction extends Omit<GenTransaction, 'type'> {
  type: AccountType;
}
```

---

## Store Patterns

stellar-drive provides reactive store factories for Svelte 5 integration.

### `createCollectionStore`

Creates a reactive store for a table that auto-syncs with IndexedDB:

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

The store automatically re-queries when the underlying IndexedDB data changes (via sync or local writes).

### `createDetailStore`

Creates a reactive store for a single record:

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

### Reactive Patterns

Stores integrate with Svelte 5 runes:

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

---

## IndexedDB / Dexie

Radiant uses [Dexie.js](https://dexie.org) as the IndexedDB wrapper, managed entirely by stellar-drive.

### How Offline Storage Works

- **All reads** come from IndexedDB — never from the network
- **All writes** go to IndexedDB first, then queue for sync
- **Dexie** provides a Promise-based API over the raw IndexedDB API
- **Auto-versioning** — schema hash changes trigger Dexie version upgrades
- **Compound indexes** — defined in `schema.ts` for efficient queries

### Query Performance

Dexie queries are optimized via defined indexes:

```ts
// Uses the 'date' index — fast range query
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

### Demo Mode Isolation

Demo mode creates a separate database (`radiant_demo`) so the real database is never touched. The demo database is populated fresh on each page load by the `seedData()` callback.

---

## Supabase Integration

Supabase provides three services for Radiant: authentication, PostgreSQL database, and real-time subscriptions.

### Authentication

Radiant uses Supabase Auth with email provider, layered with stellar-drive's PIN gate:

1. **Supabase session** — email-based authentication creates a JWT session
2. **PIN gate** — single-user PIN lock screen before accessing the app
3. **Device verification** — trusted device management with device IDs
4. **Offline auth** — PIN verification works offline using locally stored hash

### Real-Time Subscriptions

stellar-drive subscribes to Supabase Realtime for multi-device sync:

```
Supabase Realtime (WebSocket)
  → postgres_changes channel
  → INSERT / UPDATE / DELETE events
  → stellar-drive processes remote changes
  → IndexedDB updated
  → Reactive stores re-emit
  → UI updates
```

### Row Level Security (RLS)

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

## Teller.io Integration

Teller.io provides bank data aggregation through a REST API with mTLS authentication.

### mTLS Authentication

Teller requires mutual TLS — every API request includes a client certificate:

```ts
const agent = new https.Agent({
  cert: tellerCertificate,  // Client certificate
  key: tellerPrivateKey,    // Client private key
});

const response = await fetch('https://api.teller.io/accounts', {
  headers: { Authorization: `Basic ${encodedToken}` },
  agent,
});
```

### Teller Connect

The client-side Teller Connect widget handles the bank enrollment flow:

1. User clicks "Connect Bank" → Teller Connect opens
2. User selects institution and authenticates
3. Teller returns an enrollment token
4. Token stored in `teller_enrollments` table
5. Server-side API uses token for data fetching

### Webhook Processing

Teller sends webhooks for transaction updates:

1. `POST /api/teller/webhook` receives the payload
2. HMAC signature verified against `TELLER_WEBHOOK_SECRET`
3. New/updated transactions fetched via Teller API
4. Data upserted to Supabase → syncs to all devices

### Access Tokens

Each enrollment has an access token for API calls. Tokens are stored server-side and used for:
- Fetching account balances
- Pulling transaction history
- Monitoring account status

---

## PWA Architecture

The service worker is generated by the `stellarPWA` Vite plugin from `@prabhask5/stellar-engine`.

### Caching Strategies

| Resource Type | Strategy | Rationale |
|--------------|----------|-----------|
| Content-hashed assets (`/_app/immutable/`) | Cache-first | Immutable — hash guarantees freshness |
| Shell resources (HTML, manifest, icons) | Stale-while-revalidate | Versioned, updated in background |
| Navigation requests | Network-first, offline fallback | Always try for fresh content |
| API requests | Network-only | Dynamic data, no caching |

### Service Worker Lifecycle

1. **Install** — precache all assets from the build manifest
2. **Activate** — clean up old cache versions
3. **Fetch** — intercept requests and apply caching strategy
4. **Update** — new service worker detected → `skipWaiting` + `clients.claim`

### Manifest

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

## Type System

### Generated Types

`types.generated.ts` provides one interface per schema table with system columns automatically included:

- `id: string` — UUID primary key
- `created_at: string` — ISO timestamp
- `updated_at: string` — ISO timestamp
- `deleted: boolean` — soft delete flag
- `_version: number` — conflict resolution version
- `device_id: string` — originating device

### Composite Types

App-specific types in `src/lib/types.ts` compose generated types with domain logic:

```ts
export interface TransactionWithCategory extends Transaction {
  category?: Category;
}

export interface BudgetWithProgress extends Budget {
  spent: number;
  remaining: number;
  percentUsed: number;
}
```

---

## CSS Design System

Radiant uses CSS custom properties for a **gem/crystal** design theme.

### Theme Tokens

CSS custom properties define the design system, enabling consistent theming:

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

### Component Styling

Components use scoped styles with CSS custom properties for themability:

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

## Build & Development

### Vite Configuration

Radiant uses Vite (via SvelteKit) with the `stellarPWA` plugin:

```ts
// vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import { stellarPWA } from '@prabhask5/stellar-engine/vite';

export default defineConfig({
  plugins: [
    sveltekit(),
    stellarPWA({
      schema: true,     // Enable schema watching + auto-generation
      serviceWorker: true, // Generate service worker
    }),
  ],
});
```

### Chunk Splitting

SvelteKit auto-splits code by route. Additional optimization:

- Route-level code splitting — each page loads only its dependencies
- Shared chunks — common libraries extracted to shared bundles
- Dynamic imports — heavy components loaded on demand
- Content-hashed filenames — enable aggressive caching

### Development Workflow

```bash
npm run dev          # Start dev server with HMR
                     # → Schema changes auto-generate types (500ms debounce)
                     # → Schema auto-pushes to Supabase (if DATABASE_URL set)
                     # → Service worker rebuilds

npm run cleanup      # Format (Prettier) + lint fix (ESLint)
npm run validate     # Type check + lint + dead code detection
npm run build        # Production build (includes schema sync)
```

### Dev Tools

| Tool | Purpose | Config |
|------|---------|--------|
| **ESLint** | Linting | `eslint.config.js` (flat config, TypeScript + Svelte) |
| **Prettier** | Formatting | `.prettierrc` with Svelte plugin |
| **Knip** | Dead code detection | `knip.json` |
| **svelte-check** | Type checking | Uses `tsconfig.json` |
| **TypeScript** | Strict mode | `tsconfig.json` with `strict: true` |
