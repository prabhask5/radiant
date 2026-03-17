# Radiant Finance: Backend Architecture & System Design

This document provides a comprehensive deep dive into Radiant's system architecture -- from the local-first data model to the sync engine, authentication layers, bank integration, and deployment infrastructure.

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Local-First Architecture](#2-local-first-architecture)
3. [Data Flow Pipeline](#3-data-flow-pipeline)
4. [Sync Engine Deep Dive](#4-sync-engine-deep-dive)
5. [Database Architecture](#5-database-architecture)
6. [Authentication Architecture](#6-authentication-architecture)
7. [Teller.io Integration Architecture](#7-tellerio-integration-architecture)
8. [PWA Architecture](#8-pwa-architecture)
9. [Real-Time Sync](#9-real-time-sync)
10. [Security Architecture](#10-security-architecture)
11. [Performance Architecture](#11-performance-architecture)
12. [Deployment Architecture](#12-deployment-architecture)
13. [Summary of Design Complexities](#13-summary-of-design-complexities)

---

## 1. System Overview

```
+-----------------------------------------------------------------------+
|                        CLIENT (Browser/PWA)                            |
|                                                                        |
|  +--------------+  +--------------+  +--------------------------+     |
|  |  Svelte 5    |  |  Reactive    |  |  Service Worker          |     |
|  |  Components  |<-|  Stores      |  |  +--------------------+  |     |
|  |              |  |  (collection |  |  | Cache-first assets |  |     |
|  |  Dashboard   |  |   + detail)  |  |  | Network-first nav  |  |     |
|  |  Transactions|  |              |  |  | Background precache|  |     |
|  |  Accounts    |  +------+-------+  |  +--------------------+  |     |
|  |              |         |          |                           |     |
|  +--------------+         |          +--------------------------+     |
|                           |                                           |
|  +------------------------v--------------------------------------+    |
|  |                    stellar-drive Engine                        |    |
|  |  +----------+  +----------+  +----------+  +------------+    |    |
|  |  | IndexedDB|  |  Sync    |  |  Auth    |  |  Real-time |    |    |
|  |  |  (Dexie) |  |  Queue   |  |  Manager |  |  Listener  |    |    |
|  |  |          |  |          |  |          |  |            |    |    |
|  |  | 5 tables|  | Pending  |  | PIN gate |  | WebSocket  |    |    |
|  |  | + indexes|  | changes  |  | + device |  | subscript. |    |    |
|  |  +----------+  +----+-----+  +----+-----+  +-----+------+    |    |
|  +-----------------------|------------|---------------|------------+    |
|                          |            |               |               |
+--------------------------|------------|---------------|---------------+
                           |            |               |
                     HTTPS |     HTTPS  |        WSS    |
                           |            |               |
+--------------------------|------------|---------------|---------------+
|                    SUPABASE CLOUD                     |               |
|  +-------------------v------------v---------------v-----------+      |
|  |                    PostgreSQL                               |      |
|  |  +----------+  +----------+  +----------+  +-----------+   |      |
|  |  |  Tables  |  |  RLS     |  |  Auth    |  |  Realtime |   |      |
|  |  | 5 + sys |  | Policies |  | (GoTrue) |  | (WebSocket|   |      |
|  |  +----------+  +----------+  +----------+  +-----------+   |      |
|  +-------------------------------------------------------------+      |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
|                    VERCEL (Serverless)                                  |
|  +--------------+  +--------------+  +--------------------------+     |
|  | /api/teller/ |  | /api/setup/  |  | /api/config              |     |
|  | sync         |  | validate     |  | (public config endpoint) |     |
|  | webhook      |  | deploy       |  |                          |     |
|  +------+-------+  +--------------+  +--------------------------+     |
+---------|-----------------------------------------------------------------+
          | mTLS
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
| `src/lib/schema.ts` | Single source of truth for all 5 tables, indexes, and types |
| `src/lib/types.generated.ts` | Auto-generated TypeScript types from schema |
| `src/lib/stores/` | Reactive Svelte 5 stores backed by IndexedDB |
| `src/routes/` | SvelteKit routes (dashboard, transactions, accounts, login, setup) |
| `src/routes/api/teller/` | Server-side mTLS proxy for Teller.io API |
| `src/routes/api/setup/` | Setup wizard endpoints (validate, deploy) |
| `src/routes/api/config/` | Public config endpoint for client-side env vars |
| `src/service-worker.ts` | PWA service worker (generated by stellarPWA plugin) |

### Key Design Principles

- **Local-first**: All reads from IndexedDB, never from the network
- **Optimistic writes**: UI updates instantly, sync happens asynchronously
- **Schema-driven**: One schema file generates types, SQL, and IndexedDB structure
- **Zero-trust sync**: Every sync operation is idempotent and conflict-safe
- **Defense in depth**: RLS + PIN gate + device verification + mTLS

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

### Conflict Resolution Strategy

Radiant uses a **last-writer-wins** strategy with field-level granularity:

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
|    Component calls:         |
|    update('transactions',   |
|      id, { category_id })   |
|    UI re-renders instantly   |
+-------------+---------------+
              |
              v
+-----------------------------+
| 2. INDEXEDDB WRITE          |
|    Dexie.table('transactions|
|      ').update(id, {        |
|        category_id,         |
|        updated_at: now(),   |
|        _version: v + 1,     |
|        device_id: thisDevice|
|      })                     |
+-------------+---------------+
              |
              v
+-----------------------------+
| 3. SYNC QUEUE ENTRY         |
|    Queue record created:    |
|    { table, id, operation,  |
|      payload, timestamp,    |
|      status: 'pending' }    |
+-------------+---------------+
              |
              v
+-----------------------------+
| 4. BACKGROUND SYNC          |
|    Queue processor picks up |
|    pending entries in FIFO  |
|    order                    |
+-------------+---------------+
              |
              v
+-----------------------------+
| 5. SUPABASE UPSERT          |
|    supabase.from('transac-  |
|      tions').upsert(payload) |
|    On conflict: merge fields|
|    Status --> 'synced'       |
+-------------+---------------+
              |
              v
+-----------------------------+
| 6. REAL-TIME BROADCAST      |
|    Supabase Realtime emits  |
|    postgres_changes event   |
|    to all subscribed clients|
+-------------+---------------+
              |
              v
+-----------------------------+
| 7. OTHER DEVICES UPDATE     |
|    stellar-drive receives   |
|    WebSocket event -->       |
|    writes to local IndexedDB|
|    --> reactive stores emit  |
|    --> UI updates            |
+-----------------------------+
```

### Timing Characteristics

| Step | Typical Latency | Blocking? |
|------|----------------|-----------|
| Optimistic UI update | < 5ms | No |
| IndexedDB write | 5-20ms | No (async) |
| Sync queue entry | < 1ms | No |
| Background sync | 100-500ms | No (background) |
| Supabase upsert | 50-200ms | No (background) |
| Real-time broadcast | 50-150ms | No (push) |
| Remote device update | 5-20ms | No (reactive) |

**Total perceived latency for the user: < 5ms**. Everything else happens asynchronously.

---

## 4. Sync Engine Deep Dive

The sync engine is implemented by stellar-drive. See the [stellar-drive repository](https://github.com/prabhask5/stellar-drive) for engine internals including queue processing, conflict resolution algorithms, and the reactive store layer.

### Queue Processing

The sync queue is an IndexedDB table managed by stellar-drive. Each entry represents a pending change:

```ts
interface SyncQueueEntry {
  id: string;           // Queue entry ID
  table: string;        // Target table name
  record_id: string;    // Record being modified
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: Record<string, unknown>;
  timestamp: string;    // ISO 8601 timestamp
  status: 'pending' | 'processing' | 'failed';
  retry_count: number;
  device_id: string;    // Originating device
}
```

Queue processing rules:
- **FIFO order** -- entries processed in chronological order
- **Per-record deduplication** -- multiple updates to the same record within the sync interval are coalesced
- **Retry with backoff** -- failed entries retry with exponential backoff (1s, 2s, 4s, 8s, max 60s)
- **Offline accumulation** -- when offline, entries accumulate without processing
- **Online flush** -- when connectivity returns, the entire queue processes in batch

### Conflict Resolution

When two devices edit the same record concurrently, stellar-drive resolves conflicts at the field level:

```
+---------------------------------------------------+
|              CONFLICT RESOLUTION                   |
|                                                    |
|  Local:  { a: 1, b: 2, c: 3 }  updated_at: T1   |
|  Remote: { a: 1, b: 5, c: 6 }  updated_at: T2   |
|                                                    |
|  Step 1: Compare updated_at                        |
|    T2 > T1 --> remote is newer overall             |
|                                                    |
|  Step 2: Field-level merge                         |
|    a: 1 (same) --> keep                            |
|    b: local=2, remote=5 --> remote wins (newer)    |
|    c: local=3, remote=6 --> remote wins (newer)    |
|                                                    |
|  Step 3: Grace period check                        |
|    If |T2 - T1| < grace_period:                    |
|      Use device_id as tiebreaker                   |
|      (deterministic ordering)                      |
|                                                    |
|  Result: { a: 1, b: 5, c: 6 }                     |
+---------------------------------------------------+
```

### Grace Period & Device Tiebreaking

When two devices make changes within a short time window (the "grace period"), timestamp comparison alone is unreliable due to clock skew. stellar-drive uses **device-ID tiebreaking**:

1. Both devices' timestamps fall within the grace period
2. Device IDs are compared lexicographically
3. The "higher" device ID wins consistently
4. This ensures deterministic resolution regardless of which device processes the conflict

### Tombstone Cleanup

Soft deletes (`deleted: true`) create tombstones that persist for a configurable period:

1. `remove()` sets `deleted: true` and `updated_at` to now
2. Reactive stores filter out `deleted` records automatically
3. Tombstones sync to Supabase (so other devices learn about the deletion)
4. After the retention period, tombstones are hard-deleted from both IndexedDB and Supabase

### Version Tracking

Every record carries a `_version` field:

```
_version: 1  -->  Created
_version: 2  -->  Updated (category changed)
_version: 3  -->  Updated (amount corrected)
_version: 4  -->  Deleted (soft delete)
```

The version increments on every local write. During sync, if the remote version is higher than expected, a conflict resolution pass runs before the write is applied.

---

## 5. Database Architecture

### Entity Relationship Model

```
+------------------+       +------------------+
| teller_enrollments|       |  user_settings   |
|------------------|       |------------------|
| institution_name |       | currency         |
| access_token     |       | teller_config    |
| status           |       | sync_settings    |
| enrolled_at      |       | (singleton)      |
+--------+---------+       +------------------+
         |
         | 1:N
         v
+------------------+       +------------------+
|    accounts      |       |   categories     |
|------------------|       |------------------|
| name             |       | name             |
| institution      |       | color            |
| type (enum)      |       | icon             |
| balance          |       +------------------+
| currency         |                |
| teller_account_id|                |
+--------+---------+                |
         |                          |
         | 1:N                      |
         v                          |
+------------------+                |
|  transactions    |                |
|------------------|                |
| description      |                |
| amount           |                |
| date             |                |
| account_id   ----+----> accounts  |
| category_id  ----+----> categories
| teller_txn_id    |
| is_recurring     |
| notes            |
+------------------+
```

### Schema Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Soft deletes everywhere** | Required for sync -- tombstones propagate deletions to other devices |
| **UUID primary keys** | Offline-safe -- devices generate IDs without coordination |
| **`updated_at` on all records** | Field-level conflict resolution relies on timestamps |
| **`device_id` on all records** | Tiebreaking for concurrent edits within grace period |
| **`_version` counter** | Detects stale writes and triggers conflict resolution |
| **Denormalized `balance` on accounts** | Avoids summing all transactions for display; updated on sync |
| **`user_settings` as singleton** | Single-user app -- one row, always present, no joins needed |
| **JSON fields for flexible data** | `teller_config` in settings -- avoids schema rigidity for nested data |

### Indexing Strategy

Indexes are declared in `schema.ts` and auto-created in both IndexedDB and PostgreSQL:

| Table | Indexed Fields | Query Pattern |
|-------|---------------|---------------|
| `transactions` | `account_id`, `category_id`, `date` | Filter by account, category; sort by date |
| `accounts` | `type`, `enrollment_id` | Filter by account type; join to enrollments |

---

## 6. Authentication Architecture

### Multi-Layer Authentication

Radiant implements defense-in-depth authentication with four distinct layers:

```
+-----------------------------------------------------+
|  Layer 1: SUPABASE SESSION                           |
|  +------------------------------------------------+  |
|  | Email + password --> JWT token                  |  |
|  | Token stored in httpOnly cookie                 |  |
|  | Auto-refresh via Supabase client                |  |
|  | Required for: cloud sync, real-time             |  |
|  +------------------------------------------------+  |
|                                                       |
|  Layer 2: PIN GATE                                    |
|  +------------------------------------------------+  |
|  | 4-8 digit PIN --> bcrypt hash comparison         |  |
|  | Stored locally (works offline)                  |  |
|  | Required for: accessing any app route           |  |
|  | Modes: setup (first time), unlock, link         |  |
|  +------------------------------------------------+  |
|                                                       |
|  Layer 3: DEVICE VERIFICATION                         |
|  +------------------------------------------------+  |
|  | Unique device_id generated per browser          |  |
|  | Trusted device list stored in user_settings     |  |
|  | New devices require email verification          |  |
|  | Required for: first access on new device        |  |
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

### Auth Flow: First-Time Setup

```
User visits / (no PIN configured)
  --> Redirect to /login?mode=setup
  --> User creates PIN
  --> PIN hashed (bcrypt) and stored in IndexedDB
  --> User enters email for Supabase auth
  --> Supabase sends confirmation email
  --> User confirms --> Supabase session created
  --> Device ID generated and added to trusted list
  --> Redirect to / (dashboard)
```

### Auth Flow: Returning User

```
User visits / (PIN configured, locked)
  --> Redirect to /login?mode=unlock
  --> User enters PIN
  --> bcrypt.compare(input, storedHash)
  --> Match --> Check Supabase session
    --> Session valid --> Redirect to /
    --> Session expired --> Auto-refresh token
    --> Offline --> Allow access with offline auth mode
  --> No match --> Increment failed attempts
    --> Under limit --> "Incorrect PIN" message
    --> Over limit --> Lockout with countdown timer
```

### Auth Flow: New Device

```
User visits / on new device
  --> Redirect to /login?mode=link
  --> User enters PIN
  --> PIN verified against Supabase-synced hash
  --> New device_id generated
  --> Email verification sent
  --> User confirms --> Device added to trusted list
  --> Full access granted
```

### Offline Authentication

When offline, Radiant authenticates using locally stored credentials:

- PIN hash stored in IndexedDB (encrypted)
- Device ID stored in localStorage
- Auth state set to `authMode: 'offline'`
- Full read/write access to local data
- Sync queue accumulates changes for when connectivity returns
- Supabase session refreshed automatically when back online

---

## 7. Teller.io Integration Architecture

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

The server-side handler:
1. Reads the mTLS certificate and private key from environment variables
2. Creates an HTTPS agent with the client certificate
3. Authenticates with Teller using the enrollment's access token
4. Fetches accounts, transactions, and balances
5. Writes data directly to Supabase using `createServerAdminClient('radiant')` from `stellar-drive/kit` (service_role key, bypasses RLS)
6. Returns the data to the client for immediate IndexedDB write

### Data Flow Architecture

Radiant uses a **server-writes-to-Supabase** model for all Teller data. There are three paths by which bank data enters the system:

#### 1. Initial Enrollment

When a user connects a bank via Teller Connect:

```
+-----------+    +-----------------+    +--------------+
| User      |    | Teller Connect  |    | Teller API   |
|           |    | (Client Widget) |    |              |
+-----+-----+    +--------+--------+    +------+-------+
      |                   |                     |
      |  Click "Connect"  |                     |
      +------------------>|                     |
      |                   |                     |
      |    Widget opens   |                     |
      |<------------------+                     |
      |                   |                     |
      |  Select bank +    |                     |
      |  authenticate     |                     |
      +------------------>|                     |
      |                   |   Create enrollment |
      |                   +------------------->|
      |                   |                     |
      |                   |   access_token      |
      |                   |<-------------------+
      |   enrollment +    |                     |
      |   access_token    |                     |
      |<------------------+                     |
      |                   |                     |
      |  POST /api/teller/sync                  |
      +--------------------------------------->|
      |                   |    Fetch accounts,  |
      |                   |    transactions,    |
      |                   |    balances via mTLS|
      |              +----+----+                |
      |              | Server  |<---------------+
      |              | writes  |
      |              | to      |
      |              | Supabase|  (createServerAdminClient,
      |              | directly|   service_role key)
      |              +----+----+
      |                   |
      |   JSON response   |
      |<------------------+
      |                   |
      |  Client writes to |
      |  IndexedDB via    |
      |  getDb().table()  |
      |  .bulkPut()       |
      |  (immediate UI)   |
      |                   |
      |  Other devices    |
      |  receive data via |
      |  stellar-drive    |
      |  realtime WS      |
```

#### 2. Webhook-Driven Updates

The `/api/teller/webhook` endpoint processes two event types:

```
Teller sends POST /api/teller/webhook
  |
  v
+-----------------------------+
| 1. HMAC VERIFICATION        |
|    Compute HMAC-SHA256 of   |
|    request body using       |
|    TELLER_WEBHOOK_SECRET    |
|    Compare to Teller-       |
|    Signature header         |
|    Mismatch --> 401          |
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
| Look up enroll-| | Update enrollment   |
| ment in Supa-  | | status to           |
| base by Teller | | 'disconnected' in   |
| enrollment_id  | | Supabase            |
+-------+--------+ +----------+----------+
        |                      |
        v                      |
+----------------+             |
| Fetch new data |             |
| from Teller    |             |
| via mTLS       |             |
+-------+--------+             |
        |                      |
        v                      |
+----------------+             |
| Upsert accounts|             |
| + transactions |             |
| + balances to  |             |
| Supabase       |             |
| (service_role) |             |
+-------+--------+             |
        |                      |
        v                      v
+-----------------------------+
| REAL-TIME PROPAGATION       |
| Supabase Realtime emits     |
| changes to all connected    |
| clients automatically via   |
| stellar-drive WebSocket     |
+-----------------------------+
```

**Expired access tokens**: If the Teller API returns a 401 during webhook processing, the server automatically marks the enrollment as `disconnected` in Supabase, and all clients see the status change via realtime.

#### 3. Manual Refresh

The retry/refresh button on the accounts page calls `POST /api/teller/sync` -- the same endpoint and flow as initial enrollment. This lets users manually re-fetch data without waiting for a webhook.

### No Polling

Radiant does **not** auto-sync Teller data on page load or on a timer. Data stays fresh via webhooks. Balances update whenever a `transactions.processed` webhook fires. The only client-initiated fetch is the explicit manual refresh.

### Cross-Device Sync

All Teller data is written server-side to Supabase (via service_role key). stellar-drive's realtime WebSocket propagates those changes to every connected client automatically. No device needs to independently fetch from Teller -- the server is the single writer.

### Key Technical Details

| Detail | Implementation |
|--------|---------------|
| **Server Supabase client** | `createServerAdminClient('radiant')` from `stellar-drive/kit` (service_role key, bypasses RLS) |
| **Stable IDs** | Server looks up existing records by `teller_account_id` / `teller_transaction_id` to reuse UUIDs, ensuring idempotent upserts |
| **Batch size** | Transactions upserted in batches of 200 (Supabase payload limits) |
| **Client-side write** | Client writes to IndexedDB via `getDb().table().bulkPut()` for immediate UI, bypassing the sync queue |
| **Local enrichments preserved** | Category assignments, notes, and other user edits are not overwritten by Teller data |

### Transaction Sync Strategy

Teller provides transactions as a paginated list. Radiant uses **date-range reconciliation** to efficiently sync:

1. **Determine sync window** -- find the last sync timestamp for the enrollment
2. **Fetch from Teller** -- request transactions from `last_sync_date` to now
3. **Match by `teller_transaction_id`** -- find existing local records by looking up the `teller_transaction_id` in Supabase to reuse the existing UUID
4. **Upsert new/changed** -- insert new transactions, update changed ones (batched in groups of 200)
5. **Preserve local enrichments** -- category assignments, notes, and other user edits are not overwritten by Teller data
6. **Update sync timestamp** -- record the new high-water mark

```
Local DB:     [--------------------------|------]
              ^                          ^      ^
              oldest                  last_sync  now
                                         |
Teller fetch: ---------------------------[------]
              Only fetch this window  --->
```

---

## 8. PWA Architecture

### Service Worker Lifecycle

The service worker is generated by the `stellarPWA` Vite plugin during build. It manages offline capability and caching:

```
+--------------------------------------------------------+
|                 SERVICE WORKER LIFECYCLE                 |
|                                                         |
|  INSTALL                                                |
|  +-- Precache all assets from build manifest            |
|  +-- Content-hashed files --> immutable cache            |
|  +-- Shell files (HTML, manifest) --> versioned cache    |
|  +-- skipWaiting() --> activate immediately              |
|                                                         |
|  ACTIVATE                                               |
|  +-- Delete old cache versions                          |
|  +-- clients.claim() --> control all open tabs           |
|  +-- Ready to intercept fetch events                    |
|                                                         |
|  FETCH INTERCEPTION                                     |
|  +-- /_app/immutable/* --> Cache-first                   |
|  |   (content-hashed, never changes)                    |
|  +-- Navigation requests --> Network-first               |
|  |   (try network, fall back to cached shell)           |
|  +-- Static assets --> Stale-while-revalidate            |
|  |   (serve cached, update in background)               |
|  +-- API requests --> Network-only                       |
|      (dynamic data, never cached)                       |
|                                                         |
|  UPDATE DETECTION                                       |
|  +-- Browser checks for new SW on navigation            |
|  +-- Byte-for-byte comparison with current SW           |
|  +-- New SW found --> install event fires                |
|  +-- skipWaiting --> immediate activation                |
+--------------------------------------------------------+
```

### Caching Strategy Detail

| Strategy | Resources | Behavior | Cache Name |
|----------|-----------|----------|------------|
| **Cache-first** | `/_app/immutable/**` | Serve from cache; never re-fetch (hash guarantees freshness) | `immutable-v{N}` |
| **Stale-while-revalidate** | Icons, manifest, fonts | Serve cached version immediately; fetch update in background | `shell-v{N}` |
| **Network-first** | HTML pages, navigation | Try network; fall back to cached shell if offline | `shell-v{N}` |
| **Network-only** | `/api/**` | Always hit the network; no caching for dynamic data | N/A |

### Background Precaching

During the install phase, the service worker precaches all assets listed in the build manifest:

```ts
// Generated asset manifest (simplified)
const ASSETS = [
  '/_app/immutable/chunks/index.abc123.js',
  '/_app/immutable/chunks/stores.def456.js',
  '/_app/immutable/entry/start.ghi789.js',
  // ... all route chunks
];

// Precache during install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(`immutable-v${VERSION}`)
      .then(cache => cache.addAll(ASSETS))
  );
});
```

---

## 9. Real-Time Sync

### WebSocket Subscriptions

stellar-drive subscribes to Supabase Realtime channels for each table:

```
Client connects to Supabase Realtime (WSS)
  |
  +-- Subscribe: postgres_changes, table=transactions, event=*
  +-- Subscribe: postgres_changes, table=accounts, event=*
  +-- Subscribe: postgres_changes, table=categories, event=*
  +-- Subscribe: postgres_changes, table=* (all synced tables)
```

### Remote Change Processing

When a remote change arrives via WebSocket:

```
WebSocket event received
  |
  v
+-------------------------------------+
| 1. DEDUPLICATION                     |
|    Check if this change originated   |
|    from this device (device_id)      |
|    If yes --> ignore (already applied)|
+-------------+-----------------------+
              | No (remote change)
              v
+-------------------------------------+
| 2. CONFLICT CHECK                    |
|    Compare remote _version with      |
|    local _version                    |
|    If remote > local --> apply        |
|    If equal --> field-level merge     |
|    If remote < local --> ignore       |
+-------------+-----------------------+
              |
              v
+-------------------------------------+
| 3. INDEXEDDB UPDATE                  |
|    Write merged record to Dexie      |
|    This triggers reactive store      |
|    subscriptions                     |
+-------------+-----------------------+
              |
              v
+-------------------------------------+
| 4. UI UPDATE                         |
|    Reactive stores re-emit           |
|    Components re-render with         |
|    new data (potential animation     |
|    for remote changes)               |
+-------------------------------------+
```

### Fallback Polling

If the WebSocket connection drops, stellar-drive falls back to periodic polling:

1. Connection loss detected via heartbeat timeout
2. Polling interval activates (configurable, default 30s)
3. Fetch all records with `updated_at > last_sync_timestamp`
4. Apply changes using the same conflict resolution logic
5. When WebSocket reconnects, polling stops automatically

### Deferred Changes

Changes received while the app is in the background (service worker context) are deferred:

1. Service worker receives push notification or background sync event
2. Changes stored in a deferred queue
3. When the app becomes visible, deferred changes are applied in batch
4. UI updates with optional animation to highlight new/changed data

---

## 10. Security Architecture

### Defense in Depth

```
+-----------------------------------------------------+
|  NETWORK LAYER                                       |
|  +-- HTTPS/TLS everywhere (enforced by Vercel)       |
|  +-- mTLS for Teller API (certificate pinning)       |
|  +-- HMAC-SHA256 webhook verification                |
|  +-- CORS headers (same-origin for API routes)       |
+-----------------------------------------------------+
|  APPLICATION LAYER                                   |
|  +-- PIN gate (bcrypt-hashed, rate-limited)           |
|  +-- Device verification (trusted device list)        |
|  +-- SvelteKit CSRF protection (origin checking)     |
|  +-- Content Security Policy headers                 |
|  +-- XSS prevention (Svelte auto-escapes output)     |
+-----------------------------------------------------+
|  DATABASE LAYER                                      |
|  +-- Row Level Security on every table                |
|  +-- Supabase Auth JWT verification                  |
|  +-- Service role key never exposed to client         |
|  +-- Column-level access control via RLS policies     |
+-----------------------------------------------------+
|  DATA LAYER                                          |
|  +-- Soft deletes (audit trail)                       |
|  +-- Version tracking (tamper detection)             |
|  +-- Device ID tracking (change attribution)         |
|  +-- Timestamp tracking (conflict resolution)         |
+-----------------------------------------------------+
```

### Row Level Security Policies

Every table enforces user-scoped access:

```sql
-- All tables follow this pattern
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Users can only SELECT their own records
CREATE POLICY "select_own" ON transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Users can only INSERT with their own user_id
CREATE POLICY "insert_own" ON transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only UPDATE their own records
CREATE POLICY "update_own" ON transactions
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can only DELETE their own records
CREATE POLICY "delete_own" ON transactions
  FOR DELETE USING (auth.uid() = user_id);
```

### PIN Security

- **Hashing**: PINs hashed with bcrypt (cost factor 10)
- **Storage**: Hash stored in IndexedDB, synced to Supabase for multi-device
- **Rate limiting**: Exponential lockout on failed attempts (1min --> 5min --> 15min --> 1hr)
- **No recovery**: PIN cannot be recovered -- only reset via authenticated email

### Webhook Verification

```ts
// HMAC-SHA256 verification
const signature = request.headers.get('Teller-Signature');
const expectedSignature = crypto
  .createHmac('sha256', TELLER_WEBHOOK_SECRET)
  .update(rawBody)
  .digest('hex');

if (signature !== expectedSignature) {
  return new Response('Unauthorized', { status: 401 });
}
```

### Environment Variable Security

| Variable | Exposure | Protection |
|----------|----------|------------|
| `PUBLIC_SUPABASE_URL` | Client-side | Protected by RLS -- safe to expose |
| `PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Client-side | Protected by RLS -- safe to expose |
| `DATABASE_URL` | Build-time only | Never bundled into client code |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side only | Bypasses RLS -- must remain secret |
| `TELLER_CERTIFICATE` | Server-side only | mTLS identity -- must remain secret |
| `TELLER_PRIVATE_KEY` | Server-side only | mTLS identity -- must remain secret |
| `TELLER_WEBHOOK_SECRET` | Server-side only | HMAC verification -- must remain secret |

---

## 11. Performance Architecture

### Chunk Splitting Strategy

SvelteKit automatically code-splits by route. Radiant optimizes further:

```
Initial load:
  +-- _app/immutable/entry/start.js      (~15KB)  Framework bootstrap
  +-- _app/immutable/entry/app.js        (~8KB)   App shell
  +-- _app/immutable/chunks/index.js     (~25KB)  Shared utilities
  +-- _app/immutable/nodes/0.js          (~5KB)   Layout node

Dashboard route (/):
  +-- _app/immutable/nodes/2.js          (~40KB)  Dashboard components

Transactions route (/transactions):
  +-- _app/immutable/nodes/3.js          (~30KB)  Transaction list
```

Each route loads only its required chunks. Shared code is extracted into common chunks that are cached across routes.

### Optimistic Updates

Every user action reflects in the UI within < 5ms:

1. **No loading spinners for writes** -- data appears instantly in IndexedDB
2. **Reactive stores** re-emit on IndexedDB changes -- no manual cache invalidation
3. **Sync status** shown subtly (not blocking) -- users know sync is happening but are not slowed by it

### IndexedDB Query Optimization

- **Compound indexes** for common filter+sort patterns
- **Cursor-based pagination** for large transaction lists
- **Selective loading** -- stores only query visible data, not entire tables
- **Debounced re-queries** -- multiple rapid IndexedDB changes batch into one store update

### Debounced Effects

Svelte 5 `$effect` calls that trigger expensive operations are debounced:

```svelte
<script lang="ts">
  let searchQuery = $state('');
  let debouncedQuery = $state('');

  $effect(() => {
    const timeout = setTimeout(() => {
      debouncedQuery = searchQuery;
    }, 300);
    return () => clearTimeout(timeout);
  });
</script>
```

---

## 12. Deployment Architecture

### Vercel Serverless Architecture

```
+------------------------------------------------+
|  VERCEL EDGE NETWORK                            |
|                                                  |
|  +------------------------------------------+   |
|  |  Static Assets (CDN)                      |   |
|  |  +-- /_app/immutable/** (forever cache)   |   |
|  |  +-- /manifest.json                       |   |
|  |  +-- /sw.js                               |   |
|  |  +-- /icons/**                            |   |
|  +------------------------------------------+   |
|                                                  |
|  +------------------------------------------+   |
|  |  Serverless Functions                     |   |
|  |  +-- /api/config        (GET)             |   |
|  |  +-- /api/setup/validate (POST)           |   |
|  |  +-- /api/setup/deploy   (POST)           |   |
|  |  +-- /api/teller/sync    (POST)  <-- mTLS |   |
|  |  +-- /api/teller/webhook (POST)  <-- HMAC |   |
|  +------------------------------------------+   |
|                                                  |
|  +------------------------------------------+   |
|  |  SSR Functions                            |   |
|  |  +-- / (dashboard)                        |   |
|  |  +-- /transactions                        |   |
|  |  +-- /accounts                            |   |
|  |  +-- /login                               |   |
|  |  +-- /setup                               |   |
|  +------------------------------------------+   |
+------------------------------------------------+
```

### Schema Auto-Migration on Deploy

Every Vercel build automatically syncs the database schema:

```
vercel build triggers
  |
  v
Vite buildStart hook fires
  |
  v
stellarPWA plugin reads src/lib/schema.ts
  |
  +-- Generate TypeScript types --> src/lib/types.generated.ts
  |
  +-- Connect to DATABASE_URL (Postgres)
      |
      +-- CREATE TABLE IF NOT EXISTS (5 tables)
      +-- ALTER TABLE ADD COLUMN IF NOT EXISTS (new fields)
      +-- CREATE INDEX IF NOT EXISTS (declared indexes)
      +-- ENABLE ROW LEVEL SECURITY (all tables)
      +-- CREATE POLICY IF NOT EXISTS (CRUD policies)
      +-- CREATE OR REPLACE FUNCTION (updated_at triggers)
```

This is fully idempotent -- safe to run on every deployment. No migration files, no version tracking, no manual SQL. The schema file is the single source of truth.

### Environment Variable Management

```
Development:   .env file (local, gitignored)
Production:    Vercel dashboard --> Environment Variables
Validation:    /setup wizard validates credentials before saving
Runtime:       /api/config serves public vars to the client
```

### CI/CD Pipeline

```
Push to main
  |
  v
Vercel detects push --> triggers build
  |
  +-- npm install
  +-- vite build
  |   +-- Schema types generated
  |   +-- Schema SQL pushed to Supabase
  |   +-- Service worker generated
  |   +-- SvelteKit routes compiled
  |   +-- Assets content-hashed
  |
  +-- Deploy to Vercel edge
  |   +-- Static assets --> CDN (immutable headers)
  |   +-- Server routes --> Serverless functions
  |   +-- API routes --> Serverless functions
  |
  +-- Live at production URL
```

---

## 13. Summary of Design Complexities

| Area | Complexity | Why It Exists |
|------|-----------|---------------|
| **Field-level conflict resolution** | Last-writer-wins merge with grace period tiebreaking | Two devices editing the same transaction offline must converge to the same result |
| **Tombstone lifecycle** | Soft delete --> sync --> retention period --> hard delete | Deletions must propagate to all devices before permanent removal |
| **Version tracking** | Monotonic `_version` counter per record | Detects stale writes and prevents lost updates during concurrent edits |
| **mTLS proxy** | Server-side certificate-authenticated proxy for Teller API | Browsers cannot perform mutual TLS; bank API requires client certificates |
| **HMAC webhook verification** | SHA-256 signature validation on every incoming webhook | Prevents forged webhook payloads from triggering unauthorized data writes |
| **PIN gate + device verification** | Local bcrypt auth layered with trusted device list | Financial data requires stronger-than-password protection, even offline |
| **Schema-driven auto-migration** | Single `schema.ts` generates types, IndexedDB, and PostgreSQL DDL | Eliminates migration files and ensures client/server schema never diverge |
| **Service worker caching** | Four-strategy cache with content-hashed immutable assets | PWA must work fully offline while still receiving updates when online |
| **Singleton `user_settings`** | Single-row table with JSON fields for flexible config | Single-user app avoids joins and complex queries for app-wide settings |
| **Denormalized account balances** | `balance` stored directly on accounts, updated on sync | Avoids expensive SUM(transactions) on every dashboard render |
| **Exponential rate limiting** | Progressive lockout on failed PIN attempts | Prevents brute-force attacks on the local PIN gate |
| **Fallback polling** | 30s polling interval when WebSocket drops | Real-time sync must degrade gracefully when persistent connections fail |

---

For details on the sync engine internals (queue processing, conflict resolution algorithms, reactive store layer, and IndexedDB abstraction), see the [stellar-drive](https://github.com/prabhask5/stellar-drive) package documentation.
