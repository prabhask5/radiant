# 💎 Radiant Finance

**A self-hosted, offline-first personal finance tracker that puts you in control of your data.**

[![SvelteKit](https://img.shields.io/badge/SvelteKit-2.0-FF3E00?logo=svelte&logoColor=white)](https://kit.svelte.dev)
[![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-Auth%20%2B%20DB-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![PWA](https://img.shields.io/badge/PWA-Installable-5A0FC8?logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Radiant connects to your bank accounts via [Teller.io](https://teller.io), syncs transactions in real-time, and provides budgeting, spending insights, and net worth tracking — all while keeping your financial data under your control. Works offline, syncs across devices, and runs entirely on your own infrastructure.

> See [ARCHITECTURE.md](./ARCHITECTURE.md) for system design deep dive.
> See [FRAMEWORKS.md](./FRAMEWORKS.md) for tech stack reference.

---

## 📸 Screenshots

<!-- TODO: Add screenshots -->
| Dashboard | Transactions | Budgets | Accounts |
|:---------:|:------------:|:-------:|:--------:|
| *Coming soon* | *Coming soon* | *Coming soon* | *Coming soon* |

---

## ✨ Features

### 🏦 Bank Integration
- **Real-time transaction sync** via Teller.io — connects to 5,000+ US financial institutions
- **Automatic account balance updates** for checking, savings, credit cards, and investment accounts
- **Webhook-driven sync** — new transactions arrive automatically without polling
- **Secure mTLS authentication** — bank credentials never touch your server

### 📊 Budgeting & Analytics
- **Monthly budgets** with per-category spending limits and progress tracking
- **Auto-categorization** of transactions with customizable rules
- **Spending insights** — pre-computed analytics on where your money goes
- **Net worth tracking** — historical snapshots charting your financial trajectory
- **Recurring transaction detection** — identify bills and subscriptions automatically
- **Budget rollover** — unused budget carries forward to the next month

### 🔒 Privacy & Security
- **Self-hosted** — your financial data lives on your own infrastructure
- **PIN-based security** — single-user auth gate with device verification
- **Row Level Security** — Supabase RLS policies enforce data isolation at the database level
- **mTLS bank connections** — certificate-based mutual authentication with Teller
- **HMAC webhook verification** — cryptographic validation of incoming bank data
- **No third-party analytics** — zero tracking, zero telemetry

### 📱 Offline-First PWA
- **Works without internet** — full read/write access to all data offline
- **Optimistic updates** — UI responds instantly, syncs in the background
- **Multi-device sync** — field-level conflict resolution handles concurrent edits
- **Installable** — add to home screen on any device for a native app experience
- **Cache-first assets** — instant loads from service worker cache

### 🎮 Demo Mode
- **Try before you deploy** — explore all features with sample data
- **No account required** — instant access, no configuration needed
- **Full isolation** — separate IndexedDB database, zero network requests
- **Data resets on refresh** — mock data is re-seeded each session

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org) 20+
- [Supabase](https://supabase.com) account (free tier works)
- [Teller.io](https://teller.io) developer account (for bank connections)
- [Vercel](https://vercel.com) account (recommended for deployment)

### 1. Clone & Install

```bash
git clone https://github.com/your-username/radiant.git
cd radiant
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials (see [Configuration Reference](#%EF%B8%8F-configuration-reference) below).

### 3. Set Up Supabase

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Copy your project URL and publishable key into `.env`
3. Add your `DATABASE_URL` for auto schema sync
4. The schema auto-migrates on `npm run dev` and `npm run build` — no manual SQL needed

### 4. Set Up Teller.io

1. Sign up at [teller.io](https://teller.io) and create an application
2. Download your mTLS certificate and private key
3. Configure your Teller application ID and certificate in `.env`
4. Set your webhook signing secret for secure transaction delivery

### 5. Run Locally

```bash
npm run dev
```

Visit `http://localhost:5173` — types auto-generate and Supabase auto-migrates on first run.

### 6. Deploy to Vercel

```bash
npm run build
vercel deploy --prod
```

Or use the built-in setup wizard at `/setup` for guided deployment with validation.

---

## 🏠 Self-Hosting Guide

### Supabase Setup

1. **Create a project** at [supabase.com/dashboard](https://supabase.com/dashboard)
2. **Note your credentials** from Settings > API:
   - Project URL: `https://xxxxx.supabase.co`
   - Publishable (anon) key
   - Database connection string (Settings > Database > URI)
3. **Configure auth providers:**
   - Enable email auth in Authentication > Providers
   - Set your site URL in Authentication > URL Configuration
4. **Schema auto-deploys** — no manual SQL needed. The `stellarPWA` Vite plugin pushes idempotent DDL (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`) on every build via direct Postgres connection. RLS policies, triggers, and indexes are all included.

### Teller.io Setup

1. **Register** at [teller.io](https://teller.io) for a developer account
2. **Create an application** in the Teller dashboard
3. **Download certificates:**
   - You'll receive a `.pem` certificate and private key for mTLS authentication
   - In serverless environments, base64-encode them for environment variables
4. **Configure webhook:**
   - Set your webhook URL: `https://your-domain.com/api/teller/webhook`
   - Note the webhook signing secret for HMAC verification
5. **Test in sandbox mode** — Teller provides a sandbox environment for development with simulated bank data

### Vercel Deployment

1. **Import your repository** at [vercel.com/new](https://vercel.com/new)
2. **Set environment variables** in the Vercel dashboard:

   | Variable | Type | Notes |
   |----------|------|-------|
   | `PUBLIC_SUPABASE_URL` | Plain | Public — protected by RLS |
   | `PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Plain | Public — protected by RLS |
   | `DATABASE_URL` | Secret | Server-side only, used during build |
   | `TELLER_APP_ID` | Plain | Teller application identifier |
   | `TELLER_CERTIFICATE` | Secret | Base64-encoded mTLS cert |
   | `TELLER_PRIVATE_KEY` | Secret | Base64-encoded mTLS key |
   | `TELLER_WEBHOOK_SECRET` | Secret | HMAC signing secret |

3. **Deploy** — Vercel auto-detects SvelteKit and configures `adapter-auto`
4. **Verify** — visit `/api/config` to confirm server config is loaded

> **Security Note:** `DATABASE_URL` is only used server-side during the build step. It is never bundled into client code. The public Supabase keys are safe to expose — they are protected by Row Level Security.

### Using the Setup Wizard

Radiant includes a built-in setup wizard at `/setup` that guides you through:

1. **Supabase credential validation** — tests your URL and keys before saving
2. **Teller configuration** — validates certificate and connection
3. **Vercel deployment** — one-click deploy with environment variable injection

---

## 🎮 Demo Mode

Radiant includes a full demo mode for evaluating the app without any backend configuration:

1. Navigate to `/demo` on any running instance
2. Click **Start Demo**
3. Explore with pre-populated sample data:
   - Multiple bank accounts with realistic balances
   - Months of transaction history across categories
   - Pre-configured budgets with progress tracking
   - Spending insights and net worth snapshots

### How Demo Mode Works

- **Separate database** — uses `${name}_demo` IndexedDB, never touches real data
- **No network requests** — Supabase connections, sync queue, and real-time are all disabled
- **Mock auth** — `authMode === 'demo'` enables protected routes without real authentication
- **Auto-seeded** — `seedData(db)` callback populates fresh data on each page load
- **Full isolation** — toggling demo mode triggers a page reload for complete engine teardown

### Customizing Demo Data

Edit `src/lib/demo/mockData.ts` to populate the demo database with custom sample data.
Edit `src/lib/demo/config.ts` to customize the mock user profile.

---

## 🛠 Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | SvelteKit 2 + Svelte 5 | Full-stack web framework with SSR + file-based routing |
| **Sync Engine** | stellar-drive (`@prabhask5/stellar-engine`) | Offline-first CRUD, sync queue, conflict resolution |
| **Database** | Supabase (PostgreSQL) | Cloud database with real-time subscriptions + RLS |
| **Local Storage** | IndexedDB (Dexie) | Client-side database for offline-first reads/writes |
| **Auth** | Supabase Auth + PIN gate | Email auth, PIN security, device verification |
| **Banking** | Teller.io | Bank data aggregation via mTLS REST API |
| **Deployment** | Vercel (adapter-auto) | Serverless hosting with edge functions |
| **Language** | TypeScript (strict) | End-to-end type safety with generated types |
| **PWA** | Service Worker (stellarPWA) | Offline support, caching, installability |
| **Design** | CSS Custom Properties | Gem/crystal-themed design system |

---

## ⚙️ Configuration Reference

### Core Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | Supabase publishable (anon) key | Yes |
| `DATABASE_URL` | Supabase Postgres connection string (URI) | Yes (for schema sync) |

### Teller.io Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TELLER_APP_ID` | Teller application ID | Yes (for bank connections) |
| `TELLER_CERTIFICATE` | mTLS certificate (PEM or base64) | Yes (for bank connections) |
| `TELLER_PRIVATE_KEY` | mTLS private key (PEM or base64) | Yes (for bank connections) |
| `TELLER_WEBHOOK_SECRET` | Webhook HMAC signing secret | Yes (for webhooks) |
| `TELLER_ENVIRONMENT` | Teller API environment (`sandbox` or `production`) | No (defaults to `sandbox`) |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PUBLIC_APP_NAME` | Application display name | `Radiant` |
| `SYNC_INTERVAL_MS` | Background sync interval in milliseconds | `30000` |

---

## 📱 Install as an App

Radiant is a PWA (Progressive Web App) — install it on any device for quick access and an app-like experience.

### iOS (Safari)

1. Open the app in **Safari**
2. Tap the **Share** button (square with arrow)
3. Scroll down and tap **Add to Home Screen**
4. Tap **Add**

### Android (Chrome)

1. Open the app in **Chrome**
2. Tap the **three-dot menu** (top right)
3. Tap **Add to Home screen** or **Install app**
4. Confirm the installation

### Desktop (Chrome / Edge)

1. Open the app in your browser
2. Click the **install icon** in the address bar (or look for an install prompt)
3. Click **Install**

Once installed, the app runs as a standalone window with full offline support.

---

## 🗂 Project Structure

```
src/
├── lib/
│   ├── schema.ts              # Single source of truth (database schema)
│   ├── types.ts               # App types (re-exports + narrowings)
│   ├── types.generated.ts     # Auto-generated entity types (do not edit)
│   ├── components/            # Svelte 5 components
│   ├── stores/                # Reactive stores (collection + detail)
│   └── demo/                  # Demo mode config and mock data
├── routes/
│   ├── +layout.ts             # Root load function (engine init, auth)
│   ├── +layout.svelte         # App shell
│   ├── (app)/                 # Authenticated routes
│   │   ├── +page.svelte       # Dashboard (net worth, balances, budgets)
│   │   ├── transactions/      # Filterable transaction list
│   │   ├── budgets/           # Budget management + progress
│   │   ├── accounts/          # Connected accounts + Teller Connect
│   │   └── profile/           # Settings, PIN, devices, diagnostics
│   ├── login/                 # PIN auth (setup/unlock/link modes)
│   ├── setup/                 # Configuration wizard
│   ├── demo/                  # Demo mode toggle
│   ├── confirm/               # Email verification
│   ├── policy/                # Privacy policy
│   └── api/                   # Server endpoints
│       ├── config/            # Server config check
│       ├── setup/             # Credential validation + deployment
│       └── teller/            # Teller sync proxy + webhooks
├── service-worker.ts          # PWA service worker
static/
├── sw.js                      # Generated service worker
├── manifest.json              # PWA manifest
.env.example                   # Environment variable template
```

---

## ❓ FAQ

<details>
<summary><strong>Is my financial data safe?</strong></summary>

Yes. Radiant is self-hosted — your data lives in your own Supabase instance on infrastructure you control. Bank credentials are handled entirely by Teller.io using mutual TLS authentication; your server never sees login credentials. All database access is protected by Row Level Security policies, and the PIN gate prevents unauthorized access even if someone has your device.
</details>

<details>
<summary><strong>Does it work offline?</strong></summary>

Absolutely. Radiant is built offline-first using stellar-drive. All reads come from IndexedDB, and writes are queued for sync when connectivity returns. You can view transactions, update budgets, categorize spending, and check your net worth entirely offline. Changes sync automatically when you're back online.
</details>

<details>
<summary><strong>Which banks are supported?</strong></summary>

Radiant supports any bank available through Teller.io, which covers 5,000+ US financial institutions including major banks, credit unions, and brokerages. Teller uses direct API integrations (not screen scraping) for reliable, real-time data.
</details>

<details>
<summary><strong>How much does it cost to run?</strong></summary>

Radiant itself is free and open source. Running costs depend on your infrastructure:
- **Supabase**: Free tier includes 500MB database and 50,000 monthly active users
- **Vercel**: Free tier supports hobby projects with generous limits
- **Teller.io**: Free developer tier for personal use

For a single user, you can run Radiant entirely within free tiers.
</details>

<details>
<summary><strong>Can multiple people use one instance?</strong></summary>

Radiant is designed as a single-user application with PIN-based auth. Each deployment is intended for one person (or household sharing a single account). For multiple users, deploy separate instances.
</details>

<details>
<summary><strong>How does multi-device sync work?</strong></summary>

stellar-drive handles sync via a background queue. Changes made on any device are written optimistically to IndexedDB, then synced to Supabase. Other devices receive updates via real-time WebSocket subscriptions. Conflicts are resolved using field-level merging with timestamp comparison, grace periods, and device-ID tiebreaking.
</details>

<details>
<summary><strong>Can I import data from other finance apps?</strong></summary>

Currently, Radiant pulls data directly from your banks via Teller.io. CSV/OFX import from other finance apps is on the roadmap.
</details>

<details>
<summary><strong>What happens if Teller.io goes down?</strong></summary>

Radiant continues to work normally. All your existing data is stored locally in IndexedDB and in your Supabase database. You can view, categorize, and budget against existing transactions. New bank data simply pauses until Teller is available again.
</details>

---

## 📜 Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server (types auto-generate, schema auto-syncs) |
| `npm run build` | Production build (includes schema sync) |
| `npm run check` | Type-check with svelte-check |
| `npm run lint` | Lint with ESLint |
| `npm run format` | Format with Prettier |
| `npm run dead-code` | Dead code detection with Knip |
| `npm run cleanup` | Auto-fix lint + format |
| `npm run validate` | Full validation (check + lint + dead-code) |

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create a feature branch:** `git checkout -b feature/my-feature`
3. **Install dependencies:** `npm install`
4. **Make your changes** and verify:
   ```bash
   npm run cleanup    # Auto-fix formatting + lint
   npm run validate   # Type check + lint + dead-code detection
   ```
5. **Commit** with a descriptive message
6. **Push** and open a Pull Request

### Schema Changes

If your change modifies `src/lib/schema.ts`:
1. Types auto-generate at `src/lib/types.generated.ts` on save
2. Supabase schema auto-syncs if `DATABASE_URL` is set
3. IndexedDB auto-upgrades on next page load via hash-based version detection
4. Never edit `types.generated.ts` manually — it's overwritten on every save

---

## 📄 License

[MIT](LICENSE) — use it, modify it, self-host it. Your finances, your rules.

---

<div align="center">

**💎 Radiant** — *Your finances, crystal clear.*

</div>
