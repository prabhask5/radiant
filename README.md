# Radiant Finance

A self-hosted, offline-first personal finance app that keeps your money data under your control.

Radiant connects to 5,000+ US financial institutions via Teller.io, syncs transactions in real-time, and runs entirely on your own infrastructure. It works fully offline as an installable PWA, syncs across devices with field-level conflict resolution, and never sends your data to third parties.

**Try the demo:** [https://finance.prabhas.io/demo](https://finance.prabhas.io/demo)

---

### Documentation

| Document | Description |
|----------|-------------|
| [FRAMEWORKS.md](./FRAMEWORKS.md) | Complete guide to all frameworks and architectural patterns |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design, sync engine, conflict resolution, auth flows |
| [stellar-drive](https://www.npmjs.com/package/stellar-drive) | Offline-first sync engine powering the data layer |

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Features](#features)
3. [Setup Guide](#setup-guide)
4. [Mobile Installation](#mobile-installation)
5. [Demo Mode](#demo-mode)
6. [Configuration Reference](#configuration-reference)
7. [Admin & Debug Information](#admin--debug-information)
8. [Privacy](#privacy)
9. [License](#license)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | SvelteKit 2 + Svelte 5 (runes: `$state`, `$derived`, `$effect`, `$props`) |
| Sync Engine | [stellar-drive](https://www.npmjs.com/package/stellar-drive) (custom offline-first engine) |
| Database | Supabase (PostgreSQL + Auth + Realtime WebSocket) |
| Local Storage | IndexedDB via Dexie.js |
| Banking | Teller.io (mTLS authentication, webhook-driven sync) |
| Deployment | Vercel (adapter-auto) |
| Language | TypeScript (strict mode) |
| PWA | Service Worker with multi-strategy caching (stellarPWA Vite plugin) |
| Styling | CSS Custom Properties design system (Gem Radiant aesthetic -- obsidian, citrine, emerald, ruby, sapphire) |

---

## Features

### Bank Integration
- Real-time transaction sync via Teller.io connecting to 5,000+ US financial institutions
- Supports checking, savings, and credit card accounts
- Webhook-driven updates -- new transactions arrive automatically without polling
- mTLS authentication ensures bank credentials never touch your server
- Manual account creation for banks not on Teller
- CSV import with automatic column detection and idempotent deduplication (upload the same file twice safely)

### Budget Management
- Custom budget categories with emoji icons, colors, and monthly spending limits
- Monthly budget progress tracking with cumulative spending chart
- Budget pace line showing expected vs actual spending throughout the month
- Category-level progress bars with over-budget highlighting
- Historical 6-month spending comparison bar chart
- Category-based pie chart breakdown

### ML-Powered Automation
- **Auto-Categorization**: Naive Bayes classifier trained on your own categorization history. Learns from manual assignments and propagated categories. 70% confidence threshold before auto-assigning.
- **Category Propagation**: When you manually categorize a transaction, similar transactions (fuzzy token matching, 50% overlap threshold) are automatically categorized the same way. Never overwrites manual assignments.
- **Recurring Detection**: Exact-interval matching algorithm detects subscriptions and recurring charges. Requires 3+ transactions with consistent intervals (weekly, biweekly, monthly, quarterly, yearly). Automatically creates recurring entries, tracks next expected dates, and auto-ends cancelled subscriptions.
- The ML pipeline runs automatically after each data sync.

### Recurring Transactions
- Auto-detected subscriptions from transaction patterns
- Manual entry support (name, amount, frequency, account, merchant pattern)
- Status lifecycle: active, cancelling, ended
- Next charge date tracking with frequency-specific grace periods
- Pattern preview showing matched transactions
- Cancellation URLs for 20+ popular services (Netflix, Spotify, Hulu, Adobe, and more)
- Budget deduction integration -- recurring charges are factored into budget pace

### Dashboard
- Personalized greeting with your name
- Monthly net money change (inflows minus outflows)
- Interactive net worth line chart with time range selector (1W / 1M / 3M / 6M / 1Y / ALL)
- Monthly budget progress chart
- Credit card payment matching for accurate net worth (smooths transfer pairs)

### Transactions
- Full-text search across descriptions and counterparties
- Multi-filter: account, category, status (posted/pending), custom date range
- Month-based navigation
- Summary strip: income / expenses / net / count
- Date-grouped list with relative labels (Today, Yesterday, This Week)
- Inline editing for category and notes
- Multi-select mode for bulk operations
- Recurring transaction badges
- Pagination (50 items per page with staggered animations)

### Privacy & Security
- Self-hosted: all data lives on your own infrastructure
- PIN-based security (6-digit) with bcrypt hashing
- Multi-device management with email-based device verification
- Row Level Security on every Supabase table
- mTLS for bank connections
- HMAC-SHA256 webhook verification
- Rate limiting with exponential lockout on failed PIN attempts
- Zero third-party analytics, zero telemetry
- Works offline with cached credentials

### PWA & Offline
- Full offline read/write -- works without internet
- Installable on iOS, Android, and desktop as a native app
- Service worker with smart caching (cache-first for assets, network-first for pages)
- Automatic update detection with in-app prompt
- Background sync queue processes when connectivity returns

### Multi-Device Sync
- Real-time WebSocket sync via Supabase Realtime
- Field-level conflict resolution (last-writer-wins with device-ID tiebreaking)
- Optimistic writes -- UI updates in under 5ms, sync happens in background
- Offline changes queue and sync automatically when online
- Tombstone-based soft deletes propagate across all devices

---

## Setup Guide

### Prerequisites

- GitHub account
- [Supabase](https://supabase.com) account (free tier works)
- [Teller.io](https://teller.io) developer account
- [Vercel](https://vercel.com) account (recommended for deployment)
- [Node.js](https://nodejs.org) 20+ (for local development)

### Step 1: Fork and Clone

Fork the repository on GitHub, then clone it:

```bash
git clone https://github.com/YOUR-USERNAME/radiant.git
cd radiant
npm install
```

### Step 2: Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your **project URL** and **anon (publishable) key** from Settings > API
3. Note the **DATABASE_URL** (connection string) from Settings > Database > Connection string > URI
4. The database schema auto-migrates on build -- no manual SQL needed

### Step 3: Set Up Teller.io

1. Sign up at [teller.io](https://teller.io) and create an application
2. Download your mTLS certificate (`.pem`) and private key (`.pem`)
3. Note your Application ID
4. Configure the webhook URL to point to your deployed app's `/api/teller/webhook`
5. Note the webhook signing secret
6. Start in sandbox mode for testing with simulated bank data

### Step 4: Configure Environment

```bash
cp .env.example .env
```

Fill in all variables. See the [Configuration Reference](#configuration-reference) section for details.

### Step 5: Run Locally

```bash
npm run dev
```

Visit `http://localhost:5173`. Types auto-generate and the Supabase schema auto-migrates on first run.

### Step 6: Deploy to Vercel

**Option A** -- Use the built-in setup wizard at `/setup` for guided deployment with validation.

**Option B** -- Manual deployment:
1. Import your repository at [vercel.com/new](https://vercel.com/new)
2. Set all environment variables in the Vercel dashboard
3. Deploy -- Vercel auto-detects SvelteKit
4. Verify at `/api/config` to confirm server config is loaded

### Step 7: First Login

1. Visit your deployed app
2. Create a 6-digit PIN
3. Enter your email for Supabase authentication
4. Confirm via the email verification link
5. Connect your bank accounts on the Accounts page

**Security note:** `DATABASE_URL` is only used server-side during the build step. It is never bundled into client code. The `PUBLIC_` keys are safe to expose -- they are protected by Row Level Security.

---

## Mobile Installation

### iOS (Safari)
1. Open the app in Safari
2. Tap Share > Add to Home Screen > Add

### Android (Chrome)
1. Open the app in Chrome
2. Tap the three-dot menu > Install app > Install

### Desktop
1. Click the install icon in your browser's address bar > Install

Once installed, the app runs as a standalone window with full offline support.

---

## Demo Mode

Navigate to `/demo` on any running instance and click **Start Demo** to explore with pre-populated sample data.

- Uses a separate IndexedDB database -- never touches real data
- Pre-populated with realistic accounts, transactions, and categories
- All sync and authentication are disabled in demo mode
- Edit `src/lib/demo/mockData.ts` to customize the sample data

---

## Configuration Reference

### Core (Required)

| Variable | Description |
|----------|-------------|
| `PUBLIC_SUPABASE_URL` | Supabase project URL |
| `PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Supabase anon key |
| `DATABASE_URL` | PostgreSQL connection string (build-time only) |

### Teller.io (Required for bank connections)

| Variable | Description |
|----------|-------------|
| `PUBLIC_TELLER_APP_ID` | Teller application ID |
| `PUBLIC_TELLER_ENVIRONMENT` | `sandbox` or `production` |
| `TELLER_CERT` | mTLS certificate (PEM or base64) |
| `TELLER_KEY` | mTLS private key (PEM or base64) |
| `TELLER_WEBHOOK_SECRET` | Webhook HMAC signing secret |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `PUBLIC_APP_NAME` | Display name | `Radiant` |

---

## Admin & Debug Information

### Single-User Architecture

Radiant is a single-user application. The first user to set up a PIN becomes the sole owner. All data is scoped to that user via Supabase Row Level Security. There is no multi-user admin panel -- each deployment serves one person.

### Debug Mode

Navigate to Profile and toggle **Debug Mode**. This enables:

- Sync queue diagnostics (cycle count, egress bytes, queue depth)
- Manual sync trigger
- Sync queue repair
- Tombstone viewer and cleanup
- Database reset (destructive)
- Real-time diagnostics polling

### Trusted Devices

View and manage trusted devices from Profile > Trusted Devices. Each device has a unique ID. You can revoke access from any device. New devices require email verification.

### Email & PIN Changes

- **Change email**: Profile > enter new email > verify via email link
- **Change PIN**: Profile > enter old PIN > enter new PIN > confirm

---

## Project Structure

```
src/
  lib/
    schema.ts              -> Single source of truth (database schema)
    types.ts               -> App types and type narrowings
    types.generated.ts     -> Auto-generated (do not edit)
    components/            -> Chart components (GemChart, GemPieChart, etc.)
    stores/                -> Reactive Svelte 5 stores
    ml/                    -> ML pipeline (classifier, propagation, recurring)
    teller/                -> Teller.io integration (client, autoSync, types)
    utils/                 -> CSV parsing, currency formatting
    demo/                  -> Demo mode config and mock data
  routes/
    +layout.ts             -> Engine init, auth, route guarding
    +layout.svelte         -> App shell (nav, toasts, update prompt)
    +page.svelte           -> Dashboard
    transactions/          -> Transaction list + filters
    budget/                -> Budget management + recurring
    accounts/              -> Bank connections + CSV import
    profile/               -> Settings, PIN, devices, debug
    login/                 -> Authentication (setup/unlock/link)
    setup/                 -> Configuration wizard
    demo/                  -> Demo mode toggle
    confirm/               -> Email verification
    api/                   -> Server endpoints (config, setup, teller)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (HMR, schema watching, auto-types) |
| `npm run build` | Production build with schema sync |
| `npm run check` | Type-check with svelte-check |
| `npm run lint` | Lint with ESLint |
| `npm run cleanup` | Auto-fix lint + format |
| `npm run validate` | Full validation (types + lint + dead code) |

---

## Privacy

Radiant is self-hosted. Your financial data lives in your own Supabase instance on infrastructure you control. Bank credentials are handled entirely by Teller.io using mutual TLS -- your server never sees login credentials. There is no third-party analytics, no tracking, and no telemetry.

---

## License

[MIT](LICENSE)
