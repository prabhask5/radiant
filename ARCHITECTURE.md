# Radiant Finance: System Architecture & Design

This document provides a comprehensive deep dive into every layer of Radiant's system architecture -- from the local-first data model and sync engine internals to the ML automation pipeline, bank integration, conflict resolution algorithms, and deployment infrastructure.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Local-First Architecture](#2-local-first-architecture)
3. [Data Flow Pipeline](#3-data-flow-pipeline)
4. [Sync Engine Deep Dive](#4-sync-engine-deep-dive)
5. [Conflict Resolution](#5-conflict-resolution)
6. [Database Architecture](#6-database-architecture)
7. [Authentication Architecture](#7-authentication-architecture)
8. [Teller.io Integration Architecture](#8-tellerio-integration-architecture)
9. [ML Pipeline Architecture](#9-ml-pipeline-architecture)
10. [CSV Import Architecture](#10-csv-import-architecture)
11. [PWA Architecture](#11-pwa-architecture)
12. [Real-Time Sync](#12-real-time-sync)
13. [Security Architecture](#13-security-architecture)
14. [Performance Architecture](#14-performance-architecture)
15. [Deployment Architecture](#15-deployment-architecture)
16. [Demo Mode Architecture](#16-demo-mode-architecture)
17. [Summary of Design Complexities](#17-summary-of-design-complexities)

---

## 1. System Overview

```
+-----------------------------------------------------------------------+
|                        CLIENT (Browser / PWA)                          |
|                                                                        |
|  +--------------+  +--------------+  +--------------------------+     |
|  |  Svelte 5    |  |  Reactive    |  |  Service Worker          |     |
|  |  Components  |<-|  Stores      |  |  +--------------------+  |     |
|  |              |  |  (collection |  |  | Cache-first assets |  |     |
|  |  Dashboard   |  |   + detail)  |  |  | Network-first nav  |  |     |
|  |  Transactions|  |              |  |  | Background precache|  |     |
|  |  Budget      |  +------+-------+  |  +--------------------+  |     |
|  |  Accounts    |         |          |                           |     |
|  +--------------+         |          +--------------------------+     |
|                           |                                           |
|  +------------------------v--------------------------------------+    |
|  |                    stellar-drive Engine                        |    |
|  |  +----------+  +----------+  +----------+  +------------+    |    |
|  |  | IndexedDB|  |  Sync    |  |  Auth    |  |  Realtime  |    |    |
|  |  |  (Dexie) |  |  Queue   |  |  Manager |  |  Listener  |    |    |
|  |  |          |  |  (outbox)|  |          |  |            |    |    |
|  |  | 5 app   |  | Intent-  |  | PIN gate |  | WebSocket  |    |    |
|  |  | tables  |  | based ops|  | + device |  | subscript. |    |    |
|  |  | + system|  | + coalesce|  | + email  |  | + echo sup.|    |    |
|  |  +----------+  +----+-----+  +----+-----+  +-----+------+    |    |
|  +---+-------------------|-----------|--------------|-----------+    |
|      |                   |           |              |                 |
|  +---v------------------+|           |              |                 |
|  |  ML Pipeline         ||           |              |                 |
|  |  +Categorizer (NB)   ||           |              |                 |
|  |  +Propagation (fuzzy)||           |              |                 |
|  |  +Recurring (exact)  ||           |              |                 |
|  +-----------------------+           |              |                 |
+--------------------------------------|--------------|--+--------------+
                                       |              |
                                 HTTPS |       WSS    |
                                       |              |
+--------------------------------------|--------------|--+--------------+
|                    SUPABASE CLOUD                                     |
|  +-------------------------------------------------------------------+
|  |                    PostgreSQL                                      |
|  |  +----------+  +----------+  +----------+  +-----------+         |
|  |  | 5 Tables |  |  RLS     |  |  Auth    |  |  Realtime |         |
|  |  | + system |  | Policies |  | (GoTrue) |  | (CDC +    |         |
|  |  | tables   |  | per-user |  | JWT/PIN  |  |  WebSocket)|        |
|  |  +----------+  +----------+  +----------+  +-----------+         |
|  +-------------------------------------------------------------------+
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
|                    VERCEL (Serverless)                                  |
|  +--------------+  +--------------+  +--------------------------+     |
|  | /api/teller/ |  | /api/setup/  |  | /api/config              |     |
|  | sync         |  | validate     |  | (public config endpoint) |     |
|  | webhook      |  | deploy       |  |                          |     |
|  +------+-------+  +--------------+  +--------------------------+     |
+---------|-----------------------------------------------------------------+
          | mTLS (client certificate)
+---------v-----------------------------------------------------------------+
|                    TELLER.IO                                               |
|  +--------------+  +--------------+  +--------------------------+         |
|  |  Accounts    |  | Transactions |  |  Webhooks                |         |
|  |  API         |  | API          |  |  (transaction updates)   |         |
|  +--------------+  +--------------+  +--------------------------+         |
+-----------------------------------------------------------------------+
```

### File Map

| Path | Purpose |
|------|---------|
| `src/lib/schema.ts` | Single source of truth for all 5 tables, indexes, types, constraints |
| `src/lib/types.generated.ts` | Auto-generated TypeScript types from schema |
| `src/lib/types.ts` | App-specific type narrowings and composites |
| `src/lib/stores/data.ts` | 5 reactive Svelte stores wrapping IndexedDB |
| `src/lib/stores/toast.ts` | Toast notification store |
| `src/lib/ml/classifier.ts` | Naive Bayes classification engine |
| `src/lib/ml/categorizer.ts` | Categorization orchestrator |
| `src/lib/ml/categorizationSync.ts` | Auto-categorization sync layer |
| `src/lib/ml/propagation.ts` | Fuzzy-match category propagation |
| `src/lib/ml/recurringDetector.ts` | Exact-interval recurring detection algorithm |
| `src/lib/ml/recurringSync.ts` | Recurring transaction sync layer |
| `src/lib/teller/client.ts` | mTLS Teller API client |
| `src/lib/teller/autoSync.ts` | Background bank sync orchestration |
| `src/lib/utils/csv.ts` | CSV parsing, column detection, import mapping |
| `src/lib/utils/currency.ts` | Currency formatting, date utilities |
| `src/routes/api/teller/sync/` | Server-side Teller sync proxy |
| `src/routes/api/teller/webhook/` | Webhook handler with HMAC verification |
| `src/routes/api/setup/` | Setup wizard API (validate, deploy) |
| `src/routes/api/config/` | Public config endpoint |

### Key Design Principles

- **Local-first**: All reads from IndexedDB, never from the network
- **Optimistic writes**: UI updates instantly, sync happens asynchronously
- **Schema-driven**: One schema file generates types, SQL, and IndexedDB structure
- **Zero-trust sync**: Every sync operation is idempotent and conflict-safe
- **Defense in depth**: RLS + PIN gate + device verification + mTLS
- **Intent-based operations**: Sync queue stores operation intents, not state snapshots
- **ML automation**: Three-layer pipeline that learns from user behavior without overwriting manual choices

---

## 2. Local-First Architecture

### Why Local-First?

Traditional client-server architectures fail when the network is unavailable -- the app becomes unusable. For a personal finance tracker, this is unacceptable. Users need to check balances, review transactions, and manage accounts regardless of connectivity.

Radiant's local-first architecture inverts the dependency:

```
Traditional:    Client --request--> Server --response--> Client renders
Local-first:    Client reads/writes IndexedDB --async--> Server (eventually)
```

### How It Works

1. **IndexedDB is the source of truth for the UI**. Every read operation queries Dexie directly. The UI never waits for a network response to display data.

2. **Writes are optimistic**. When a user categorizes a transaction or updates an account, the change is written to IndexedDB immediately. The UI reflects the change within milliseconds.

3. **Sync is asynchronous**. A background sync queue processes pending changes and pushes them to Supabase. If the network is unavailable, changes accumulate in the queue and process when connectivity returns.

4. **Remote changes merge seamlessly**. Supabase real-time subscriptions deliver changes from other devices. stellar-drive applies them to IndexedDB using field-level conflict resolution.

### Conflict Resolution Overview

Radiant uses **last-writer-wins** with field-level granularity:

```
Device A:  { description: "Coffee", amount: 4.50, category: "food" }
                                                   ^ changed at T1

Device B:  { description: "Starbucks", amount: 4.50, category: "food" }
              ^ changed at T2

Merged:    { description: "Starbucks", amount: 4.50, category: "food" }
              ^ T2 > T1, B wins        ^ unchanged    ^ T1, A wins (no conflict)
```

This avoids the "whole-row overwrite" problem where Device B's edit to `description` would clobber Device A's edit to `category`.

---

## 3. Data Flow Pipeline

### Complete Flow: User Action --> All Devices Updated

```
User taps "Categorize as Groceries"
  |
  v
+-----------------------------+
| 1. OPTIMISTIC UI UPDATE     |
|    Store calls engineUpdate  |
|    UI re-renders instantly   |
+-------------+---------------+
              |
              v
+-----------------------------+
| 2. INDEXEDDB WRITE          |
|    Dexie table.update()     |
|    updated_at: now()        |
|    _version: v + 1          |
|    device_id: thisDevice    |
+-------------+---------------+
              |
              v
+-----------------------------+
| 3. SYNC QUEUE ENTRY         |
|    Intent-based operation:  |
|    { type: 'set',           |
|      table, entityId,       |
|      field, value,          |
|      timestamp }            |
+-------------+---------------+
              |
              v
+-----------------------------+
| 4. COALESCE + PUSH          |
|    6-step pipeline reduces  |
|    redundant operations     |
|    Batch upsert to Supabase |
|    (500 items per request)  |
+-------------+---------------+
              |
              v
+-----------------------------+
| 5. SUPABASE CONFIRMS        |
|    Queue entry removed      |
|    on success               |
|    Retry with backoff       |
|    on failure               |
+-------------+---------------+
              |
              v
+-----------------------------+
| 6. REAL-TIME BROADCAST      |
|    Supabase CDC emits       |
|    postgres_changes event   |
|    to all subscribed clients|
+-------------+---------------+
              |
              v
+-----------------------------+
| 7. OTHER DEVICES UPDATE     |
|    stellar-drive receives   |
|    WebSocket event -->      |
|    echo suppression check   |
|    --> conflict resolution  |
|    --> IndexedDB write      |
|    --> reactive store emit  |
|    --> UI updates           |
+-----------------------------+
```

### Timing Characteristics

| Step | Typical Latency | Blocking? |
|------|----------------|-----------|
| Optimistic UI update | < 5ms | No |
| IndexedDB write | 5-20ms | No (async) |
| Sync queue entry | < 1ms | No |
| Coalesce + push | 100-500ms | No (background) |
| Supabase upsert | 50-200ms | No (background) |
| Real-time broadcast | 50-150ms | No (push) |
| Remote device update | 5-20ms | No (reactive) |

**Total perceived latency for the user: < 5ms.** Everything else happens asynchronously.

---

## 4. Sync Engine Deep Dive

The sync engine is implemented by stellar-drive. It uses an **outbox pattern** with **intent-based operations** and a **six-step coalescing pipeline** to minimize network usage while preserving user intent.

### 4.1 Intent-Based Operations

The sync queue stores **four operation types** that preserve user intent rather than capturing state snapshots:

| Type | Purpose | Coalesceable? |
|------|---------|---------------|
| `create` | Insert new entity | Subsequent sets merge into payload |
| `set` | Overwrite field(s) | Later sets win (field-level) |
| `increment` | Add numeric delta | Deltas sum algebraically |
| `delete` | Soft-delete entity | CREATE + DELETE cancel entirely |

**SyncOperationItem structure:**

```ts
{
  id?: number;              // Auto-increment PK from IndexedDB
  table: string;            // Supabase table name
  entityId: string;         // UUID of target entity
  operationType: 'create' | 'set' | 'increment' | 'delete';
  field?: string;           // For increment/single-field set
  value?: unknown;          // Delta, new value, or full payload
  timestamp: string;        // ISO 8601 (immutable, preserves order)
  retries: number;          // Failed push attempt counter
  lastRetryAt?: string;     // ISO 8601 of last retry
}
```

**Why intent-based?**

- **Algebraic reduction**: 50 increment operations sum to a single delta
- **Smarter conflict resolution**: Can inspect intent ("increment by 3") vs just final value
- **Aggressive coalescing**: Redundant operations collapse before server transmission

### 4.2 Six-Step Coalescing Pipeline

Before pushing to Supabase, `coalescePendingOps()` aggressively reduces redundant operations:

```
Raw queue: 50 operations across 12 entities
                    |
                    v
+-------------------------------------------+
| Step 1: GROUP BY ENTITY                   |
| Composite key: table:entityId             |
| Prevents cross-table collisions           |
+-------------------------------------------+
                    |
                    v
+-------------------------------------------+
| Step 2: ENTITY-LEVEL REDUCTION            |
| 4 mutually exclusive cases:               |
|   CREATE + DELETE → cancel (net zero)     |
|   DELETE only → drop preceding ops        |
|   CREATE only → fold sets into payload    |
|   Updates only → delegate to field-level  |
+-------------------------------------------+
                    |
                    v
+-------------------------------------------+
| Step 3: INCREMENT COALESCING              |
| Same field, same entity → sum deltas      |
| Example: +1, +1, +1 → +3                 |
+-------------------------------------------+
                    |
                    v
+-------------------------------------------+
| Step 4: SET COALESCING                    |
| Same entity → merge partial updates       |
| into single combined set                  |
+-------------------------------------------+
                    |
                    v
+-------------------------------------------+
| Step 5: NO-OP PRUNING                     |
| Remove: zero-delta increments,            |
| empty sets, updated_at-only sets          |
+-------------------------------------------+
                    |
                    v
+-------------------------------------------+
| Step 6: BATCH PERSIST                     |
| Flush all deletions and updates to        |
| IndexedDB in a single transaction         |
+-------------------------------------------+
                    |
                    v
Coalesced result: 8 operations (84% reduction)
```

**Performance**: O(n) memory, O(1) IndexedDB reads (single fetch), O(k) writes (k changed rows).

### 4.3 Push Phase (Upload)

**Auth validation (pre-flight):**
- Check active Supabase session exists and is not expired
- Attempt token refresh if expired
- Cache `getUser()` result for 1 hour (egress optimization -- avoids repeated network calls)

**Operation processing:**
1. Coalesce pending operations in memory
2. Batch by table (group creates for bulk insert)
3. Respect parent→child ordering (satisfy FK constraints: enrollments before accounts before transactions)
4. Upsert in batches of 500 (Supabase limit)

**Error handling:**
- **Duplicate key (Postgres 23505)**: Query which IDs exist, filter them out, retry with only new items
- **RLS error**: Fall back to individual processing to identify the problem row
- **Network failure**: Return items to queue, retry on next cycle

### 4.4 Pull Phase (Download)

**Cursor-based change tracking:**
```ts
// Per-user localStorage key prevents cross-user sync issues
const cursor = localStorage.getItem(`lastSyncCursor_${userId}`)
  || '1970-01-01T00:00:00.000Z';
```

**Paginated fetching (1000 rows per page):**
```
For each table:
  Fetch WHERE updated_at > cursor
  ORDER BY updated_at ASC
  LIMIT 1000, paginate until exhausted
  Apply conflict resolution on each row
  Advance cursor to max(updated_at)
```

**Egress optimizations:**
- **Selective column fetching**: `SELECT id,title,updated_at` not `SELECT *`
- **Push-only mode**: When realtime WebSocket is healthy, skip pull phase entirely (remote changes arrive via WebSocket)
- **Visibility-aware sync**: Skip sync if tab was only hidden briefly (reconnect cooldown)

### 4.5 Sync Lock & Watchdog

A mutex prevents concurrent sync cycles from corrupting state:

```
acquireSyncLock()
  ├─ Lock free? → acquire, return true
  ├─ Lock held < 60s? → return false (sync in progress)
  └─ Lock held > 60s? → force-release (stale lock), acquire

Watchdog timer (every 15 seconds):
  └─ If lock held > 60s → force-release
     (prevents permanent stalls from unhandled rejections)
```

### 4.6 Retry & Backoff

- **Exponential backoff**: 2^(retries-1) seconds between attempts
- **Max retries**: 5 attempts (~15 seconds cumulative wait)
- **Failed items**: Permanently removed from queue and reported via `cleanupFailedItems()`

---

## 5. Conflict Resolution

stellar-drive implements a **three-tier** conflict resolution system with progressively finer granularity.

### Tier 1: Non-Overlapping Entities (Auto-Merge)

Different entities changed on different devices → no conflict. Each side's changes accepted wholesale. This is the common case -- most sync cycles have zero conflicts.

### Tier 2: Different Fields on Same Entity (Auto-Merge Fields)

Device A edited `title`, Device B edited `description` → merge both changes. Only emit a conflict resolution entry when field values actually differ from local state.

### Tier 3: Same Field on Same Entity (Strategy-Based)

When both sides modified the exact same field, apply resolution strategies in priority order:

```
+------------------------------------------------------+
| Priority 1: LOCAL_PENDING                             |
|   Field has unsynced local operations                |
|   → Local value wins (preserve user intent)          |
|   → Never silently discard user changes              |
+------------------------------------------------------+
| Priority 2: NUMERIC_MERGE                             |
|   Declared numericMergeFields                        |
|   → Reserved for delta-merge (currently last-write)  |
+------------------------------------------------------+
| Priority 3: DELETE_WINS                               |
|   Delete on either side trumps edits                 |
|   → Prevents accidental entity resurrection          |
|   → Critical for tombstone semantics                 |
+------------------------------------------------------+
| Priority 4: LAST_WRITE (default fallback)             |
|   Newer updated_at timestamp wins                    |
|   → Deterministic device-ID tiebreaker for ties      |
|   → Lexicographic comparison ensures all devices     |
|     converge on the same winner                      |
+------------------------------------------------------+
```

### Version Bumping

After conflict resolution, the merged entity's `_version` is set to `max(local, remote) + 1`. This ensures downstream systems recognize the merged result as strictly newer than either input.

### Audit Trail

Every field-level conflict is recorded in the `conflictHistory` IndexedDB table:

```ts
{
  entityId: string;
  entityType: string;       // Table name
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  resolvedValue: unknown;
  winner: 'local' | 'remote' | 'merged';
  strategy: 'last_write' | 'numeric_merge' | 'delete_wins' | 'local_pending';
  timestamp: string;
}
```

**Retention**: 30-day auto-cleanup via `cleanupConflictHistory()`.

### Recently-Modified Entity Protection

During pull, if a remote change arrives for an entity modified within the last **2 seconds** (`RECENTLY_MODIFIED_TTL_MS`), the pull update is skipped. This prevents the pull from reverting fresh local changes before they reach the server via push.

---

## 6. Database Architecture

### Entity Relationship Model

```
+---------------------+       +-------------------+
| teller_enrollments  |       |   categories      |
|---------------------|       |-------------------|
| enrollment_id       |       | name              |
| institution_name    |       | icon (emoji)      |
| access_token        |       | color             |
| status              |       | budget_amount     |
| last_synced_at      |       | order             |
+--------+------------+       +--------+----------+
         |                              |
         | 1:N                          | 1:N
         v                              |
+---------------------+                |
|    accounts         |                |
|---------------------|                |
| enrollment_id (FK)  |                |
| name                |                |
| institution_name    |                |
| type (enum)         |                |
| subtype (enum)      |                |
| balance_available   |                |
| balance_ledger      |                |
| source (teller/manual)|              |
| is_hidden           |                |
+--------+------------+                |
         |                              |
         | 1:N (ownership FK)           |
         v                              |
+---------------------+                |
|  transactions       |                |
|---------------------|                |
| account_id (FK) ----+----> accounts  |
| category_id (FK) ---+----> categories
| teller_transaction_id|
| amount (string)     |
| date                |
| description         |
| counterparty_name   |
| status (posted/pending)
| is_recurring        |
| is_excluded         |
| category_source     |
| csv_import_hash     |
| notes               |
+---------------------+

+---------------------+
| recurring_transactions|
|---------------------|
| name                |
| amount              |
| category_id (FK) ---+----> categories
| account_id (FK) ----+----> accounts
| frequency           |
| source (auto/manual)|
| status (active/ended)|
| merchant_pattern    |
| last_detected_date  |
| next_date           |
+---------------------+
```

### System Columns (Every Table)

Every row in every table carries these system-managed columns:

| Column | Type | Purpose |
|--------|------|---------|
| `id` | `uuid` | Primary key (generated offline, no coordination needed) |
| `user_id` | `uuid` | Owner (set by Supabase trigger, used in RLS) |
| `created_at` | `timestamptz` | Row creation time |
| `updated_at` | `timestamptz` | Last modification (drives conflict resolution) |
| `deleted` | `boolean` | Tombstone flag (soft delete) |
| `_version` | `integer` | Monotonic counter (stale write detection) |
| `device_id` | `text` | Originating device (echo suppression, tiebreaking) |

### Schema Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Soft deletes everywhere** | Required for sync -- tombstones propagate deletions to other devices |
| **UUID primary keys** | Offline-safe -- devices generate IDs without coordination |
| **`updated_at` on all records** | Field-level conflict resolution relies on timestamps |
| **`device_id` on all records** | Tiebreaking for concurrent edits; echo suppression for realtime |
| **`_version` counter** | Detects stale writes and triggers conflict resolution |
| **Amounts as strings** | Avoids floating-point precision issues with financial data |
| **Denormalized balances** | Avoids SUM(transactions) on every dashboard render |
| **`category_source` tracking** | Distinguishes manual/auto/propagation assignments so ML never overwrites user intent |
| **`csv_import_hash`** | Deterministic dedup key for idempotent CSV re-imports |

### Unique Constraints

```sql
-- Prevent duplicate Teller transactions
UNIQUE (teller_transaction_id) WHERE teller_transaction_id IS NOT NULL

-- Prevent duplicate CSV imports per account
UNIQUE (account_id, csv_import_hash) WHERE csv_import_hash IS NOT NULL
```

### Indexing Strategy

| Table | Indexed Fields | Query Pattern |
|-------|---------------|---------------|
| `teller_enrollments` | `institution_name`, `status` | Filter by bank, connection health |
| `accounts` | `enrollment_id`, `type`, `subtype`, `status`, `institution_name`, `source` | Filter by type, group by institution |
| `transactions` | `account_id`, `date`, `category_id`, `status`, `[account_id+date]`, `csv_import_hash`, `teller_transaction_id` | Per-account date queries, dedup lookups |
| `categories` | `order` | Maintain display order |
| `recurring_transactions` | `category_id`, `status` | Filter active, aggregate per category |

### System Tables (managed by stellar-drive)

| Table | Purpose |
|-------|---------|
| `syncQueue` | Pending sync operations (outbox) |
| `conflictHistory` | Audit trail of resolved conflicts |
| `offlineCredentials` | Cached PIN hash for offline auth |
| `offlineSession` | Cached session for offline access |
| `singleUserConfig` | PIN configuration, gate type |

---

## 7. Authentication Architecture

### Multi-Layer Authentication

Radiant implements defense-in-depth authentication with four distinct layers:

```
+-----------------------------------------------------+
|  Layer 1: SUPABASE SESSION                           |
|  +------------------------------------------------+  |
|  | Email-based auth --> JWT token                  |  |
|  | Auto-refresh via Supabase client                |  |
|  | Required for: cloud sync, real-time             |  |
|  +------------------------------------------------+  |
|                                                       |
|  Layer 2: PIN GATE                                    |
|  +------------------------------------------------+  |
|  | 6-digit PIN --> bcrypt hash (cost factor 10)    |  |
|  | Stored locally in IndexedDB (works offline)     |  |
|  | Required for: accessing any app route           |  |
|  | Modes: setup (first time), unlock, link device  |  |
|  +------------------------------------------------+  |
|                                                       |
|  Layer 3: DEVICE VERIFICATION                         |
|  +------------------------------------------------+  |
|  | Unique device_id generated per browser          |  |
|  | Trusted device list stored in user metadata     |  |
|  | New devices require email verification          |  |
|  | Cross-tab sync via BroadcastChannel             |  |
|  +------------------------------------------------+  |
|                                                       |
|  Layer 4: RATE LIMITING                               |
|  +------------------------------------------------+  |
|  | Failed PIN attempts tracked per device          |  |
|  | Exponential lockout: 1min, 5min, 15min, 1hr     |  |
|  | Reset on successful authentication              |  |
|  +------------------------------------------------+  |
+-----------------------------------------------------+
```

### Auth Flows

**First-Time Setup:**
```
User visits / (no PIN configured)
  → Redirect to /login?mode=setup
  → User enters email
  → User creates 6-digit PIN
  → PIN hashed (bcrypt) and stored in IndexedDB
  → Supabase sends confirmation email
  → User confirms → Supabase session created
  → Device ID generated and added to trusted list
  → Redirect to / (dashboard)
```

**Returning User:**
```
User visits / (PIN configured, locked)
  → Redirect to /login?mode=unlock
  → User enters PIN
  → bcrypt.compare(input, storedHash)
  → Match → Check Supabase session
    → Session valid → Redirect to /
    → Session expired → Auto-refresh token
    → Offline → Allow access with offline auth mode
  → No match → Increment failed attempts
    → Under limit → "Incorrect PIN" message
    → Over limit → Lockout with countdown timer
```

**New Device:**
```
User visits / on new device
  → Redirect to /login?mode=linkDevice
  → User enters email
  → Server sends verification email
  → User clicks link → /confirm page verifies token
  → BroadcastChannel relays confirmation to original tab
  → Device added to trusted list, PIN synced
  → Full access granted
```

### Offline Authentication

When offline, Radiant authenticates using locally stored credentials:
- PIN hash stored in IndexedDB (`offlineCredentials` table)
- Device ID stored in localStorage
- Auth state set to `authMode: 'offline'`
- Full read/write access to local data
- Sync queue accumulates changes for when connectivity returns
- Supabase session refreshed automatically when back online

### Cross-Tab Communication

Email verification uses `BroadcastChannel('auth-channel')` for instant feedback:
1. Login tab starts polling for verification
2. User clicks email link, which opens `/confirm` in a new tab
3. `/confirm` verifies the token with Supabase
4. `/confirm` broadcasts `radiant:email-confirmed` via BroadcastChannel
5. Login tab receives the message and completes authentication
6. No polling delay -- instant cross-tab coordination

---

## 8. Teller.io Integration Architecture

### mTLS Proxy Pattern

Teller requires mutual TLS authentication -- every API request must present a client certificate. Since browsers cannot perform mTLS, Radiant proxies all Teller requests through server-side endpoints:

```
+----------+     HTTPS      +--------------+    mTLS     +----------+
|  Client  |--------------->|  /api/teller/ |------------>| Teller   |
| (Browser)|                |  sync         |  cert+key   | API      |
|          |<---------------|  (Vercel fn)  |<------------|          |
|          |   JSON response|              |  JSON        |          |
+----------+                +------+-------+              +----------+
                                   |
                                   | service_role key
                                   v
                            +--------------+
                            |  Supabase    |
                            |  (direct     |
                            |   write)     |
                            +--------------+
```

### Teller Ingestion Paths

Teller data reaches Radiant through four distinct paths. Only three of them
fetch from Teller directly. The fourth is realtime fan-out, where one
Teller-driven write is pushed into already-open clients.

| Path | Trigger | How often it happens | Where Teller data lands first | Notes |
|------|---------|----------------------|-------------------------------|-------|
| Initial enrollment sync | User completes Teller Connect for a brand new bank link | Once per new enrollment | Browser local DB first (IndexedDB + sync queue), then Supabase | Full fetch via `/api/teller/sync`, then `processTellerSyncData()` writes locally |
| Manual refresh / reconnect sync | User clicks re-sync, or completes reconnect after token expiry | Only when user explicitly triggers it | Browser local DB first, then Supabase | Same code path as initial sync, but for an existing enrollment |
| Background auto-sync | App bootstraps authenticated UI and finds active enrollments | Once per app boot / hard page load in that browser session | Browser local DB first, then Supabase | Runs silently after local data is shown; not polling on an interval |
| Webhook-driven server sync | Teller sends webhook events such as `transactions.processed` | Whenever Teller emits an event | Supabase first, then connected browsers via realtime | Browser does not need to be open for this path to run |

#### Path 1: Initial Enrollment Sync

```
User clicks "Connect Bank" → Teller Connect widget opens
  → User selects bank, authenticates with credentials
  → Widget returns access_token + enrollment metadata
  → Client creates local teller_enrollments row
  → Client sends POST /api/teller/sync
  → Server: fetch accounts + transactions via mTLS
  → Server: return raw JSON only (no DB writes in this route)
  → Client: processTellerSyncData() writes IndexedDB + sync queue
  → Sync engine pushes resulting local changes to Supabase
  → Other devices: receive those DB changes via stellar-drive realtime
```

- Triggered by `handleEnrollmentSuccess()` on the Accounts page.
- Frequency: once per new bank connection.
- Scope: full account fetch plus full transaction fetch unless a later incremental window is supplied.

#### Path 2: Manual Refresh and Reconnect

```
User clicks "Re-sync" or finishes reconnect flow
  → Client sends POST /api/teller/sync with stored/new access token
  → Server fetches fresh Teller accounts + transactions via mTLS
  → Client runs processTellerSyncData()
  → Only true account / transaction diffs are written locally
  → Sync queue forwards those diffs to Supabase
```

- Triggered by `retrySyncEnrollment()` and `handleReconnectSuccess()` on the Accounts page.
- Frequency: only when the user explicitly asks for it, plus reconnect after a 401/disconnected state.
- Purpose: user-forced freshness and recovery from expired credentials.

#### Path 3: Webhook-Driven Updates

```
Teller sends POST /api/teller/webhook
  |
  v
+-----------------------------+
| 1. HMAC-SHA256 VERIFICATION |
|    Header: t=<ts>,v1=<sig>  |
|    Signed: <timestamp>.<body>|
|    Replay protection: 3 min  |
|    Supports secret rotation  |
|    Mismatch → 401            |
+-------------+---------------+
              | Valid
              v
+-----------------------------+
| 2. PARSE EVENT TYPE         |
+------+-------------+-------+
       |             |
       v             v
  transactions.  enrollment.
  processed      disconnected
       |             |
       v             v
+----------------+ +---------------------+
| Fetch from     | | Update enrollment   |
| Teller via mTLS| | status →            |
| (7-day buffer) | | 'disconnected'      |
+-------+--------+ +---------------------+
        |
        v
+------------------------------+
| Upsert to Supabase           |
| (200-txn batches)            |
| Preserve user-editable fields|
| (category, notes, excluded)  |
+------------------------------+
        |
        v
+------------------------------+
| REALTIME PROPAGATION         |
| All connected clients see    |
| changes via WebSocket        |
+------------------------------+
```

- Triggered by Teller, not by the browser UI.
- Frequency: event-driven. It happens whenever Teller emits a configured webhook event.
- `transactions.processed` performs a server-side incremental refetch from Teller and writes directly to Supabase.
- `enrollment.disconnected` marks the enrollment disconnected in Supabase.
- `webhook.test` verifies configuration but does not ingest financial data.

#### Path 4: Background Auto-Sync (Browser)

```
Authenticated app layout renders
  → initializeApp() loads IndexedDB immediately for fast UI
  → startBackgroundSync() runs in the background
  → autoSyncEnrollments() loops through connected/error enrollments
  → Client sends POST /api/teller/sync for each enrollment
  → Server fetches incremental Teller data via mTLS
  → Client runs processTellerSyncData()
  → Local stores reload so balances / transactions update without hard refresh
```

- Triggered from the root layout after app initialization.
- Frequency: once per authenticated app bootstrap in that browser tab/page lifetime.
- It is not timer-based polling. There is no `setInterval` or recurring background poll loop.
- It runs silently and does not block page render.
- Incremental window: 3-day buffer before `last_synced_at` to catch pending-to-posted changes.
- Retry behavior: transient failures retry with exponential backoff up to 5 attempts.
- Concurrency guard: module-level mutex prevents overlapping auto-sync runs.

### How New Teller Data Reaches the UI Without a Hard Refresh

There are two ways fresh Teller data can appear while the user stays on the app:

1. **This browser fetches Teller itself**
   The root layout starts `startBackgroundSync()` after loading cached local data.
   That background task fetches Teller data, writes only real diffs into IndexedDB,
   then reloads the local stores. The page is already visible, so the UI updates
   reactively without a full browser refresh.

2. **Another process writes Teller data and this browser receives realtime**
   A webhook or another device/browser can write Teller-driven changes into Supabase.
   stellar-drive's realtime subscription receives those row changes over WebSocket,
   merges them into IndexedDB, and the Svelte stores update the UI reactively.

In short: Radiant does not need a hard refresh because the visible UI is driven by
reactive stores backed by IndexedDB, and IndexedDB can be updated either by the
current browser's background sync or by Supabase realtime events.

### Important Cadence Notes

- There is no fixed 30-second or 5-minute Teller polling loop.
- Auto-sync happens on app bootstrap, not continuously.
- Manual sync happens only on explicit user action.
- Reconnect sync happens only after the user re-authenticates a broken enrollment.
- Webhook sync happens whenever Teller emits supported events.
- Realtime propagation happens whenever Supabase receives a write from any of the above paths.

### Multi-Layer Deduplication

1. **Pre-sync**: Check IndexedDB for existing `teller_transaction_id`
2. **Change detection**: Only write if Teller-managed fields actually changed (status, amount, description, counterparty, etc.)
3. **Freshness recheck**: Right before batch write, re-read IndexedDB to catch transactions that arrived via webhook during the fetch
4. **User deletion respect**: Never re-create transactions marked as `deleted`
5. **Database constraints**: Unique index on `teller_transaction_id` prevents server-level duplicates

### Local Enrichment Preservation

When Teller data refreshes, user-editable fields are **never overwritten**:
- `category_id` (user-assigned or ML-assigned category)
- `category_source` (manual/auto/propagation)
- `notes` (user annotations)
- `is_excluded` (budget exclusion flag)
- `is_recurring` (recurring badge)

---

## 9. ML Pipeline Architecture

Radiant implements a three-layer ML automation system that learns from user behavior. Every layer respects a strict hierarchy: **manual assignments are never overwritten**.

```
+-----------------------------------------------------------+
|                    ML PIPELINE                              |
|                                                             |
|  Layer 1: AUTO-CATEGORIZATION (Naive Bayes)                |
|  Trained on user's categorization history                  |
|  Assigns categories to uncategorized transactions          |
|  Threshold: 70% confidence                                 |
|                        |                                    |
|                        v                                    |
|  Layer 2: CATEGORY PROPAGATION (Fuzzy Matching)            |
|  Triggered on manual category assignment                   |
|  Propagates to similar transactions (50% token overlap)    |
|  Feeds training data back to Layer 1                       |
|                        |                                    |
|                        v                                    |
|  Layer 3: RECURRING DETECTION (Exact Interval Matching)    |
|  Identifies subscriptions from transaction patterns        |
|  Creates/updates/ends recurring_transactions entries       |
|  Marks matched transactions with is_recurring flag         |
+-----------------------------------------------------------+
```

### 9.1 Layer 1: Auto-Categorization (Naive Bayes Classifier)

**Engine**: `FrequencyCategorizer` class implementing Naive Bayes with word-frequency features.

**Tokenizer pipeline:**
1. Lowercase the description
2. Strip non-alphanumeric characters
3. Filter stop words: "the", "and", "for", "with", "from", "com", "www", "inc", "llc", "ltd", "corp", "pos", "debit", "credit"
4. Filter tokens shorter than 2 characters
5. Deduplicate remaining tokens

**Training data:**
- All non-deleted transactions with `category_id !== null` OR `category_source === 'manual'`
- Includes propagated categories (so similar assignments teach the model)
- Special `'__uncategorized__'` class trains the "no category" concept

**Prediction:**
- Log-space Naive Bayes with Laplace smoothing
- Softmax normalization for confidence scores
- **Threshold: 0.7** -- only auto-assign if confidence >= 70%
- Below threshold: transaction left untouched (will retry on next sync with more data)

**Persistence**: Model serialized to `localStorage` (key: `radiant_nb_model`). Survives page reloads without retraining.

**Category source tracking:**
- Auto-assigned: `category_source = 'auto'`
- Manual assignments (`category_source = 'manual'`): **never overwritten** by the classifier

### 9.2 Layer 2: Category Propagation

**Trigger**: Whenever a user manually categorizes a transaction.

**Algorithm:**
1. Tokenize the source transaction's description (same tokenizer as classifier)
2. For each candidate transaction (not manually categorized):
   - Tokenize its description
   - Compute overlap coefficient: `|intersection| / min(|A|, |B|)`
   - If overlap >= 0.5 (`SIMILARITY_THRESHOLD`): propagate the category
3. Set `category_source = 'propagation'` on matched transactions

**Example:**
```
Source:    "STARBUCKS SEATTLE WA"     tokens: [starbucks, seattle, wa]
Candidate: "STARBUCKS BELLEVUE WA"   tokens: [starbucks, bellevue, wa]
Overlap: |{starbucks, wa}| / min(3, 3) = 2/3 = 0.67 ≥ 0.5 → MATCH
```

**Rules:**
- Never overwrites `category_source = 'manual'` (user intent always wins)
- Legacy data (`category_source = null && category_id !== null`): treated as manual
- **Supports null propagation**: When uncategorizing, clears auto/propagation-set categories on similar transactions
- Propagated categories feed back into the classifier's training data (virtuous cycle)

### 9.3 Layer 3: Recurring Detection (Exact Interval Matching)

This is the most algorithmically complex layer. It identifies subscription-like patterns from raw transaction data.

**Step 1: Filter to charges only**
- Depository accounts: `amount < 0` (withdrawals)
- Credit card accounts: `amount > 0` (purchases)
- Exclude: `deleted`, `is_excluded` transactions

**Step 2: Group by normalized merchant name**

`normalizeMerchant()` strips noise from transaction descriptions:
```
"PAYPAL *NETFLIX.COM"                 → "netflix"
"AMAZON PRIME*VY7FF9KK3 Amzn.com"    → "amazon prime"
"GOOGLE *YouTubePremium g.co/helppay" → "youtubepremium"
"SQ *COFFEE SHOP #1234"              → "coffee shop"
```

Strips: processor prefixes (PAYPAL, GOOGLE, APPLE, SQ), phone numbers, trailing digits, domains, transaction IDs.

**Step 3: Split by billing cycle (temporal alignment)**

Handles multiple subscriptions from the same merchant (e.g., $5 Patreon on the 10th, $15 Patreon on the 4th):
- Primary signal: temporal fit -- each transaction assigned to cycle matching its frequency best
- Secondary signal: amount similarity (tiebreaker, hard cap >50% difference)
- Established cycles (2+ transactions) preferred over nascent (1 transaction)
- Skip < 3-day intervals (near-duplicates)

**Step 4: Exact interval matching**

Requires **3+ transactions** per sub-group. Every interval between successive transactions must match a known frequency:

| Frequency | Expected Period | Tolerance | Scaled Tolerance (2× period) |
|-----------|----------------|-----------|------------------------------|
| Weekly | 7 days | ± 2 days | ± 2.8 days |
| Biweekly | 14 days | ± 3 days | ± 4.2 days |
| Monthly | 30 days | ± 5 days | ± 7.1 days |
| Quarterly | 90 days | ± 10 days | ± 14.1 days |
| Yearly | 365 days | ± 15 days | ± 21.2 days |

Tolerance scales with `√N` for skipped billing cycles (e.g., a 2-month gap uses 1.41× base tolerance). This handles occasional billing variations without false positives.

**Step 5: Validation**
- **Recency**: Last transaction within 2.5× expected period (stale patterns excluded)
- **Amount consistency**: Coefficient of variation < 0.25 (stddev/mean)

**Step 6: Confidence scoring**
```
intervalTightness = 1 - (maxDeviation / tolerance)
amountTightness   = 1 - (amountCV / 0.25)
rawConfidence     = intervalTightness × 0.5 + amountTightness × 0.5
samplePenalty     = min(1, 0.4 + count × 0.15)
finalConfidence   = rawConfidence × samplePenalty

Threshold: finalConfidence > 0.3
```

### 9.4 Recurring Sync Layer

Connects the detection algorithm to the database:

**Gate**: Requires 1+ non-deleted categories (skips if budget not set up).

**Create new entries:**
- For unmatched detections (no existing entry with same `merchant_pattern`)
- Skip if already stale (next_date + grace period in the past)
- Grace periods: weekly/biweekly = 7d, monthly = 10d, quarterly = 20d, yearly = 30d

**Update existing entries:**
- If detection has newer `last_detected_date`, update `next_date`
- Re-activate `ended` auto-detected entries when detector finds recent data
- Sync category from matched transactions (auto-detected entries only)

**Auto-end unrefreshed entries:**
- Auto-detected entries NOT found by detector this run → `status = 'ended'`
- Manual entries: never auto-ended
- The detector's exact-interval matching is the source of truth

**Transaction flag sync:**
- Set `is_recurring = true` on all matched transaction IDs
- Clear `is_recurring = false` on transactions previously marked but not in current detection set
- **Zero stale flags** -- sync runs on both create and delete of recurring entries

### 9.5 ML Sync Orchestration

```
Data sync completes (Teller sync, store load, etc.)
  → scheduleMLSync() called (500ms debounce)
  → categorizationSync() runs:
      Train classifier on all categorized transactions
      Batch-predict uncategorized transactions
      Write auto-assignments (confidence ≥ 0.7)
  → recurringSync() runs:
      Detect recurring patterns
      Create/update/end recurring entries
      Sync is_recurring flags on transactions
```

Also triggered by:
- Category deletion (clears assignments, re-syncs ML)
- Recurring transaction deletion (re-syncs is_recurring flags)
- Manual category assignment (triggers propagation, then schedules ML sync)

---

## 10. CSV Import Architecture

### Parsing Pipeline

```
Raw CSV text
  → parseCSV(): handle quoted fields, commas/newlines in quotes, CRLF
  → autoDetectMapping(): match headers to semantic roles
  → User reviews/adjusts mapping in UI
  → mapCSVToTransactions(): apply sign conventions, generate hashes
  → bulkCreateFromCSV(): dedup + insert
```

### Column Auto-Detection

Pattern matching against common header names:
- **Date**: "date", "transaction date", "posting date", "post date", "trans date"
- **Description**: "description", "memo", "narrative", "details", "payee"
- **Amount**: "amount", "transaction amount", "total"
- **Credit**: "credit", "credits", "deposit", "deposits"
- **Debit**: "debit", "debits", "withdrawal", "charge"

Detects **split mode** (separate credit/debit columns) vs **single amount column**.

### Date Parsing

Supports multiple formats:
- `MM/DD/YYYY`, `MM-DD-YYYY`, `YYYY-MM-DD`
- `M/D/YYYY`, `M/D/YY` (2-digit year)
- `Jan 15, 2026`, `January 15, 2026`
- Normalizes all to `YYYY-MM-DD`

### Amount Parsing

- Strips currency symbols (`$`, `€`, `£`), commas, spaces
- Accounting notation: `(123.45)` → `-123.45`

### Sign Convention by Account Type

| Account Type | Credit Column | Debit Column | Single Amount |
|-------------|---------------|-------------|---------------|
| Depository | Positive (money in) | Negative (money out) | As-is |
| Credit Card | Negative (payment/refund) | Positive (charge) | Inverted |

### Idempotent Deduplication

```ts
csv_import_hash = djb2(accountId + '|' + date + '|' + amount + '|' + description)
```

**Three-layer dedup:**
1. **Unique constraint**: `UNIQUE (account_id, csv_import_hash) WHERE csv_import_hash IS NOT NULL`
2. **Pre-check IndexedDB**: Query existing hashes before insert
3. **Pre-check Supabase**: Paginated query for accounts with 1000+ transactions

Returns `{ inserted, skipped }` counts for user feedback.

---

## 11. PWA Architecture

### Service Worker Lifecycle

```
+--------------------------------------------------------+
|                 SERVICE WORKER LIFECYCLE                 |
|                                                         |
|  INSTALL                                                |
|  +-- Precache all assets from build manifest            |
|  +-- Content-hashed files → immutable cache             |
|  +-- Shell files (HTML, manifest) → versioned cache     |
|  +-- skipWaiting() → activate immediately               |
|                                                         |
|  ACTIVATE                                               |
|  +-- Delete old cache versions                          |
|  +-- clients.claim() → control all open tabs            |
|                                                         |
|  FETCH INTERCEPTION                                     |
|  +-- /_app/immutable/* → Cache-first                    |
|  |   (content-hashed, never changes)                    |
|  +-- Navigation requests → Network-first                |
|  |   (try network with 1.5s timeout, fall back to cache)|
|  +-- Static assets → Stale-while-revalidate             |
|  |   (serve cached, update in background)               |
|  +-- API requests → Network-only                        |
|      (dynamic data, never cached)                       |
|                                                         |
|  UPDATE DETECTION (6 signals)                           |
|  +-- statechange on installing service worker           |
|  +-- updatefound on registration                        |
|  +-- visibilitychange (tab becomes visible)             |
|  +-- online event (connectivity restored)               |
|  +-- Periodic interval check                            |
|  +-- Initial check on app load                          |
+--------------------------------------------------------+
```

### Caching Strategy Detail

| Strategy | Resources | Behavior | Cache Name |
|----------|-----------|----------|------------|
| Cache-first | `/_app/immutable/**` | Serve from cache; never re-fetch | `immutable-v{N}` |
| Stale-while-revalidate | Icons, manifest, fonts | Serve cached; fetch update in background | `shell-v{N}` |
| Network-first | HTML pages, navigation | Try network (1.5s timeout); fall back to cache | `shell-v{N}` |
| Network-only | `/api/**` | Always hit network; no caching | N/A |

### Offline Bridge

The service worker communicates network status to the app:
- Monitors `online`/`offline` events
- Uses Cache API as a connectivity probe
- Relays status to the layout via message passing
- App adjusts behavior (skip sync, show offline indicators)

---

## 12. Real-Time Sync

### WebSocket Subscriptions

stellar-drive subscribes to Supabase Realtime channels for all app tables:

```
Client connects to Supabase Realtime (WSS)
  +-- Subscribe: postgres_changes, table=*, event=*
  +-- Filter: schema=public
```

### Remote Change Processing

```
WebSocket event received
  |
  v
+-------------------------------------+
| 1. ECHO SUPPRESSION                  |
|    Compare event device_id to own    |
|    If match → discard (own echo)     |
+-------------+-----------------------+
              | Remote change
              v
+-------------------------------------+
| 2. DEDUP WITH POLLING                |
|    Check recentlyProcessedByRealtime |
|    map (2-second TTL)                |
|    If exists → skip                  |
+-------------+-----------------------+
              |
              v
+-------------------------------------+
| 3. RECENTLY-MODIFIED CHECK           |
|    Entity modified < 2s ago locally? |
|    If yes → skip (local push pending)|
+-------------+-----------------------+
              |
              v
+-------------------------------------+
| 4. CONFLICT RESOLUTION               |
|    Compare versions, apply 3-tier    |
|    resolution strategy               |
+-------------+-----------------------+
              |
              v
+-------------------------------------+
| 5. SOFT DELETE HANDLING               |
|    Record in remoteChangesStore       |
|    BEFORE Dexie write                 |
|    (enables removal animation in UI)  |
+-------------+-----------------------+
              |
              v
+-------------------------------------+
| 6. INDEXEDDB WRITE + UI UPDATE        |
|    Write merged record to Dexie       |
|    Reactive stores re-emit            |
|    Components re-render               |
+-------------------------------------+
```

### Reconnection Strategy

- Exponential backoff: 1s, 2s, 4s, 8s, 16s
- Max 5 attempts (~31 seconds total wait)
- Paused entirely when browser offline (no wasted timers)
- When WebSocket reconnects, fallback polling stops automatically

---

## 13. Security Architecture

### Defense in Depth

```
+-----------------------------------------------------+
|  NETWORK LAYER                                       |
|  +-- HTTPS/TLS everywhere (enforced by Vercel)       |
|  +-- mTLS for Teller API (client certificates)       |
|  +-- HMAC-SHA256 webhook verification                |
|  +-- CORS headers (same-origin for API routes)       |
|  +-- Replay protection (3-min timestamp window)      |
+-----------------------------------------------------+
|  APPLICATION LAYER                                   |
|  +-- PIN gate (bcrypt cost 10, rate-limited)          |
|  +-- Device verification (trusted device list)        |
|  +-- SvelteKit CSRF protection (origin checking)     |
|  +-- XSS prevention (Svelte auto-escapes output)     |
|  +-- Open redirect prevention (URL validation)       |
+-----------------------------------------------------+
|  DATABASE LAYER                                      |
|  +-- Row Level Security on every table                |
|  +-- Supabase Auth JWT verification                  |
|  +-- Service role key never exposed to client         |
|  +-- Column-level access via RLS policies             |
|  +-- set_user_id trigger (auto-assigns owner)         |
+-----------------------------------------------------+
|  DATA LAYER                                          |
|  +-- Soft deletes (audit trail)                       |
|  +-- Version tracking (tamper detection)             |
|  +-- Device ID tracking (change attribution)         |
|  +-- Timestamp tracking (conflict resolution)         |
|  +-- Tombstone garbage collection (7-day retention)   |
+-----------------------------------------------------+
```

### Environment Variable Security

| Variable | Exposure | Protection |
|----------|----------|------------|
| `PUBLIC_SUPABASE_URL` | Client-side | Protected by RLS -- safe to expose |
| `PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Client-side | Protected by RLS -- safe to expose |
| `DATABASE_URL` | Build-time only | Never bundled into client code |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side only | Bypasses RLS -- must remain secret |
| `TELLER_CERT` | Server-side only | mTLS identity -- must remain secret |
| `TELLER_KEY` | Server-side only | mTLS identity -- must remain secret |
| `TELLER_WEBHOOK_SECRET` | Server-side only | HMAC verification -- must remain secret |

---

## 14. Performance Architecture

### Egress Optimization

| Technique | Savings | Implementation |
|-----------|---------|----------------|
| Selective column fetching | ~40-60% fewer bytes | `SELECT id,amount,date` not `SELECT *` |
| Operation coalescing | ~80-90% fewer requests | 50 rapid edits → 1 coalesced push |
| Push-only mode | Skip entire pull phase | When realtime WebSocket is healthy |
| Cached auth validation | 1 call/hour vs 1/sync | `getUser()` result cached 1 hour |
| Visibility-aware sync | Skip unnecessary syncs | Only sync if tab was hidden > 15 minutes |
| Batch upserts | 1 request per 500 rows | vs 500 individual requests |
| Dedup with realtime | Avoid double-processing | `recentlyProcessedByRealtime` map |
Engine-level egress optimizations (realtime teardown, TOKEN_REFRESHED handling, timeout architecture, reconnect grace period, visibility-aware sync) are documented in [stellar-drive's ARCHITECTURE.md](../stellar-drive/ARCHITECTURE.md#68-egress-optimization-strategies).

#### Teller Sync Strategy

Teller sync runs on every page load for all connected enrollments (no stale threshold). This does NOT increase Supabase egress because: if Teller returns nothing new (95% of the time), zero IndexedDB writes occur → zero sync queue entries → zero Supabase requests. Enrollments in transient `error` state are automatically retried on next page load; only `disconnected` (expired token) requires manual reconnection.

### Chunk Splitting Strategy

```
Initial load:
  +-- entry/start.js           (~15KB)  Framework bootstrap
  +-- entry/app.js             (~8KB)   App shell
  +-- chunks/index.js          (~25KB)  Shared utilities
  +-- vendor-supabase.js       (~100KB) @supabase (cached separately)
  +-- vendor-dexie.js           (~30KB) Dexie.js (cached separately)

Per-route (code-split, loaded on demand):
  +-- Dashboard                (~40KB)
  +-- Transactions             (~30KB)
  +-- Budget                   (~45KB)
  +-- Accounts                 (~35KB)
```

Content-hashed filenames enable infinite cache TTL on immutable assets.

### Optimistic UI Performance

| Operation | Perceived Latency | Actual Network Latency |
|-----------|-------------------|----------------------|
| Categorize transaction | < 5ms | 200-500ms (background) |
| Edit notes | < 5ms | 200-500ms (background) |
| Create category | < 5ms | 200-500ms (background) |
| Delete transaction | < 5ms | 200-500ms (background) |
| Bulk CSV import (100 rows) | ~50ms | 1-2s (background) |

---

## 15. Deployment Architecture

### Vercel Serverless Architecture

```
+------------------------------------------------+
|  VERCEL EDGE NETWORK                            |
|                                                  |
|  +------------------------------------------+   |
|  |  Static Assets (CDN)                      |   |
|  |  +-- /_app/immutable/** (forever cache)   |   |
|  |  +-- /manifest.json                       |   |
|  |  +-- /sw.js (service worker)              |   |
|  |  +-- /icons/**                            |   |
|  +------------------------------------------+   |
|                                                  |
|  +------------------------------------------+   |
|  |  Serverless Functions                     |   |
|  |  +-- /api/config        (GET)             |   |
|  |  +-- /api/setup/validate (POST)           |   |
|  |  +-- /api/setup/deploy   (POST)           |   |
|  |  +-- /api/teller/sync    (POST, mTLS)     |   |
|  |  +-- /api/teller/webhook (POST, HMAC)     |   |
|  +------------------------------------------+   |
|                                                  |
|  +------------------------------------------+   |
|  |  SSR Functions                            |   |
|  |  +-- / (dashboard)                        |   |
|  |  +-- /transactions                        |   |
|  |  +-- /budget                              |   |
|  |  +-- /accounts                            |   |
|  |  +-- /login, /setup, /profile             |   |
|  +------------------------------------------+   |
+------------------------------------------------+
```

### Schema Auto-Migration on Build

```
vercel build triggers
  |
  v
Vite buildStart hook fires
  |
  v
stellarPWA plugin reads src/lib/schema.ts
  |
  +-- Generate TypeScript types → src/lib/types.generated.ts
  |
  +-- Connect to DATABASE_URL (PostgreSQL)
      |
      +-- CREATE TABLE IF NOT EXISTS (5 tables)
      +-- ALTER TABLE ADD COLUMN IF NOT EXISTS (new fields)
      +-- CREATE INDEX IF NOT EXISTS (declared indexes)
      +-- ENABLE ROW LEVEL SECURITY (all tables)
      +-- CREATE POLICY IF NOT EXISTS (per-table CRUD)
      +-- CREATE OR REPLACE FUNCTION (updated_at triggers, set_user_id)
```

Fully idempotent -- safe to run on every deployment. No migration files, no version tracking, no manual SQL.

### CI/CD Pipeline

```
Push to main
  → Vercel detects push → triggers build
  → npm install
  → vite build
  │   +-- Schema types generated
  │   +-- Schema SQL pushed to Supabase
  │   +-- Service worker generated (with new APP_VERSION)
  │   +-- SvelteKit routes compiled
  │   +-- Assets content-hashed
  → Deploy to Vercel edge
  │   +-- Static assets → CDN (immutable headers)
  │   +-- Server routes → Serverless functions
  │   +-- API routes → Serverless functions
  → Live at production URL
  → Connected clients detect new SW → update prompt
```

---

## 16. Demo Mode Architecture

### Isolation Strategy

Demo mode runs a completely isolated instance:

```
Production mode:
  IndexedDB: "radiant"
  Supabase: connected, syncing
  Auth: Supabase session + PIN
  Realtime: WebSocket active

Demo mode:
  IndexedDB: "radiant_demo"        ← separate database
  Supabase: disconnected            ← no cloud sync
  Auth: authMode = 'demo'          ← mock auth, no PIN
  Realtime: disabled                ← no WebSocket
```

### Seed Data

Deterministic IDs (all prefixed with `demo-`) enable idempotent re-seeding:

- **2 enrollments**: Chase, Bank of America
- **5 accounts**: Chase Checking, Chase Savings, Chase Sapphire Preferred, BofA Checking, BofA Cash Rewards
- **18 categories**: Groceries ($600), Dining ($300), Coffee ($80), Rent ($2200), Utilities ($250), etc.
- **~60 transactions**: Spanning 90 days, realistic amounts, mix of posted/pending
- **8 recurring entries**: Netflix, Spotify, Rent, Equinox, OpenAI, PG&E, AT&T

### Activation Flow

1. User navigates to `/demo` route
2. Cinematic activation animation plays
3. Engine teardown → reinitialize with `demo: true`
4. `seedDemoData(db)` populates separate IndexedDB
5. Redirect to dashboard with demo data

---

## 17. Summary of Design Complexities

| Area | Complexity | Why It Exists |
|------|-----------|---------------|
| **Intent-based outbox** | 4 operation types with 6-step coalescing pipeline | 50 rapid edits must become 1 network request; state snapshots lose algebraic reducibility |
| **Three-tier conflict resolution** | Field-level merge with 4 strategy priorities | Two devices editing the same record offline must converge deterministically |
| **Device-ID tiebreaking** | Lexicographic comparison when timestamps match | Clock skew between devices makes timestamp-only comparison unreliable |
| **Version tracking** | Monotonic `_version` counter per record | Detects stale writes and prevents lost updates during concurrent edits |
| **Tombstone lifecycle** | Soft delete → sync → 7-day retention → hard delete | Deletions must propagate to all devices before permanent removal |
| **mTLS proxy** | Server-side certificate-authenticated proxy for Teller API | Browsers cannot perform mutual TLS; bank API requires client certificates |
| **HMAC webhook verification** | SHA-256 with timestamp replay protection and secret rotation | Prevents forged webhook payloads from triggering unauthorized data writes |
| **PIN gate + device verification** | 4-layer auth with bcrypt, email verification, exponential lockout | Financial data requires defense-in-depth, must work offline |
| **Schema-driven auto-migration** | Single `schema.ts` generates types, IndexedDB, and PostgreSQL DDL | Eliminates migration files; ensures client/server schema never diverge |
| **Naive Bayes auto-categorization** | Per-user classifier with Laplace smoothing and softmax confidence | Transactions should auto-categorize without manual ML configuration |
| **Category propagation** | Fuzzy token matching with overlap coefficient ≥ 0.5 | One manual categorization should fix dozens of similar transactions |
| **Exact interval matching** | √N-scaled tolerances across 5 frequency bands | Subscription detection must handle billing jitter without false positives |
| **Recurring auto-lifecycle** | Create, re-activate, update, auto-end based on detection results | Cancelled subscriptions should disappear; resumed ones should reappear |
| **CSV idempotent import** | djb2 hash + unique constraint + dual IndexedDB/Supabase check | Uploading overlapping CSVs must never create duplicate transactions |
| **Category source tracking** | `manual` / `auto` / `propagation` / `null` hierarchy | ML must never overwrite user intent; propagation must feed classifier training |
| **Echo suppression** | device_id comparison + recentlyProcessedByRealtime TTL map | Devices must not process their own outgoing changes received back via WebSocket |
| **Push-only optimization** | Skip pull when realtime healthy | Avoids redundant SELECT queries when WebSocket already delivers changes |
| **Service worker caching** | Four-strategy cache with content-hashed immutable assets | PWA must work fully offline while receiving updates when online |
| **Cross-tab BroadcastChannel** | Email verification relay between /confirm and /login tabs | Instant auth completion without polling; works across browser tabs |
| **Recently-modified protection** | 2-second TTL skip during pull | Prevents pull from reverting fresh local changes before they reach server |

---

For details on the stellar-drive sync engine source code, see the [stellar-drive npm package](https://www.npmjs.com/package/stellar-drive).
