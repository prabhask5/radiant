# Radiant Finance

A self-hosted, offline-first personal finance PWA for tracking spending, budgets, and net worth. Built with SvelteKit, Dexie.js, and Supabase, Radiant connects to your bank accounts via Teller.io, syncs transactions in real-time, and provides budgeting and spending insights -- all while keeping your financial data under your control. Works offline, syncs across devices, and runs entirely on your own infrastructure.

---

## Documentation

| Document | Description |
|----------|-------------|
| [FRAMEWORKS.md](./FRAMEWORKS.md) | Complete guide to all frameworks and architectural patterns |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System design, sync engine, conflict resolution, auth flows |
| [stellar-drive](https://www.npmjs.com/package/@prabhask5/stellar-engine) | Offline-first sync engine powering the data layer |

---

## Table of Contents

1. [Features](#features)
2. [Setup Guide to Self-Host](#setup-guide-to-self-host)
3. [Mobile Installation](#mobile-installation)
4. [Demo Mode](#demo-mode)
5. [Configuration](#configuration)
6. [Tech Stack](#tech-stack)
7. [Project Structure](#project-structure)
8. [Scripts](#scripts)
9. [Local Development](#local-development)
10. [Contributing](#contributing)
11. [Privacy](#privacy)
12. [License](#license)

---

## Features

### Bank Integration
- **Real-time transaction sync**: Connects to 5,000+ US financial institutions via Teller.io.
- **Automatic account balance updates**: Supports checking, savings, credit cards, and investment accounts.
- **Webhook-driven sync**: New transactions arrive automatically without polling.
- **Secure mTLS authentication**: Bank credentials never touch your server.

### Budgeting and Analytics
- **Monthly budgets**: Per-category spending limits with progress tracking.
- **Auto-categorization**: Transactions categorized automatically with customizable rules.
- **Spending insights**: Pre-computed analytics on where your money goes.
- **Net worth tracking**: Historical snapshots charting your financial trajectory.
- **Recurring transaction detection**: Identifies bills and subscriptions automatically.
- **Budget rollover**: Unused budget carries forward to the next month.

### Privacy and Security
- **Self-hosted**: Your financial data lives on your own infrastructure.
- **PIN-based security**: Single-user auth gate with device verification.
- **Row Level Security**: Supabase RLS policies enforce data isolation at the database level.
- **mTLS bank connections**: Certificate-based mutual authentication with Teller.
- **HMAC webhook verification**: Cryptographic validation of incoming bank data.
- **No third-party analytics**: Zero tracking, zero telemetry.

### Offline-First PWA
- **Works without internet**: Full read/write access to all data offline.
- **Optimistic updates**: UI responds instantly, syncs in the background.
- **Multi-device sync**: Field-level conflict resolution handles concurrent edits.
- **Installable**: Add to home screen on any device for a native app experience.
- **Cache-first assets**: Instant loads from service worker cache.

---

## Setup Guide to Self-Host

### Prerequisites

- [Node.js](https://nodejs.org) 20+
- [Supabase](https://supabase.com) account (free tier works)
- [Teller.io](https://teller.io) developer account (for bank connections)
- [Vercel](https://vercel.com) account (recommended for deployment)

### Step 1: Clone and Install

```bash
git clone https://github.com/your-username/radiant.git
cd radiant
npm install
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials. See the [Configuration](#configuration) section below for a full reference.

### Step 3: Set Up Supabase

1. Create a new Supabase project at [supabase.com](https://supabase.com)
2. Copy your project URL and publishable key into `.env`
3. Add your `DATABASE_URL` for auto schema sync
4. The schema auto-migrates on `npm run dev` and `npm run build` -- no manual SQL needed

### Step 4: Set Up Teller.io

1. Sign up at [teller.io](https://teller.io) and create an application
2. Download your mTLS certificate and private key
3. Configure your Teller application ID and certificate in `.env`
4. Set your webhook signing secret for secure transaction delivery
5. Test in sandbox mode -- Teller provides a sandbox environment with simulated bank data

### Step 5: Run Locally

```bash
npm run dev
```

Visit `http://localhost:5173`. Types auto-generate and Supabase auto-migrates on first run.

### Step 6: Deploy to Vercel

1. Import your repository at [vercel.com/new](https://vercel.com/new)
2. Set environment variables in the Vercel dashboard (see [Configuration](#configuration))
3. Deploy -- Vercel auto-detects SvelteKit and configures `adapter-auto`
4. Verify by visiting `/api/config` to confirm server config is loaded

Or use the built-in setup wizard at `/setup` for guided deployment with validation.

**Security note:** `DATABASE_URL` is only used server-side during the build step. It is never bundled into client code. The public Supabase keys are safe to expose -- they are protected by Row Level Security.

---

## Mobile Installation

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

## Demo Mode

Radiant includes a full demo mode for evaluating the app without any backend configuration.

**How it works:**

- Navigate to `/demo` on any running instance and click **Start Demo** to explore with pre-populated sample data.
- Uses a separate IndexedDB database (`${name}_demo`), never touches real data.
- All Supabase connections, sync queue, and real-time subscriptions are disabled.
- Mock auth (`authMode === 'demo'`) enables protected routes without real authentication.
- Data is auto-seeded on each page load via `seedData(db)`.

**What's included:**

- Multiple bank accounts with realistic balances
- Months of transaction history across categories
- Pre-configured budgets with progress tracking
- Spending insights and net worth snapshots

**For developers:**

- Edit `src/lib/demo/mockData.ts` to customize the sample data.
- Edit `src/lib/demo/config.ts` to customize the mock user profile.
- Toggling demo mode triggers a page reload for complete engine teardown.

---

## Configuration

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

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | SvelteKit 2 + Svelte 5 |
| Sync Engine | stellar-drive (`@prabhask5/stellar-engine`) |
| Database | Supabase (PostgreSQL) |
| Local Storage | IndexedDB (Dexie) |
| Auth | Supabase Auth + PIN gate |
| Banking | Teller.io |
| Deployment | Vercel (adapter-auto) |
| Language | TypeScript (strict) |
| PWA | Service Worker (stellarPWA) |
| Design | CSS Custom Properties |

---

## Project Structure

```
src/
  lib/
    schema.ts              --> Single source of truth (database schema)
    types.ts               --> App types (re-exports + narrowings)
    types.generated.ts     --> Auto-generated entity types (do not edit)
    components/            --> Svelte 5 components
    stores/                --> Reactive stores (collection + detail)
    demo/                  --> Demo mode config and mock data
  routes/
    +layout.ts             --> Root load function (engine init, auth)
    +layout.svelte         --> App shell
    (app)/                 --> Authenticated routes
      +page.svelte         --> Dashboard (net worth, balances, budgets)
      transactions/        --> Filterable transaction list
      budgets/             --> Budget management + progress
      accounts/            --> Connected accounts + Teller Connect
      profile/             --> Settings, PIN, devices, diagnostics
    login/                 --> PIN auth (setup/unlock/link modes)
    setup/                 --> Configuration wizard
    demo/                  --> Demo mode toggle
    confirm/               --> Email verification
    policy/                --> Privacy policy
    api/                   --> Server endpoints
      config/              --> Server config check
      setup/               --> Credential validation + deployment
      teller/              --> Teller sync proxy + webhooks
  service-worker.ts        --> PWA service worker
static/
  sw.js                    --> Generated service worker
  manifest.json            --> PWA manifest
.env.example               --> Environment variable template
```

---

## Scripts

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

## Local Development

```bash
npm install
npm run dev
```

### Build Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Production build with schema sync |
| `npm run cleanup` | Auto-fix formatting and lint issues |
| `npm run validate` | Full validation (type check + lint + dead-code detection) |

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Install dependencies: `npm install`
4. Make your changes and verify:
   ```bash
   npm run cleanup
   npm run validate
   ```
5. Commit with a descriptive message
6. Push and open a Pull Request

If your change modifies `src/lib/schema.ts`, types auto-generate at `src/lib/types.generated.ts` on save, Supabase schema auto-syncs if `DATABASE_URL` is set, and IndexedDB auto-upgrades on next page load via hash-based version detection. Never edit `types.generated.ts` manually.

---

## Privacy

Radiant is self-hosted. Your financial data lives in your own Supabase instance on infrastructure you control. Bank credentials are handled entirely by Teller.io using mutual TLS authentication; your server never sees login credentials. There is no third-party analytics, no tracking, and no telemetry.

---

## License

[MIT](LICENSE)
