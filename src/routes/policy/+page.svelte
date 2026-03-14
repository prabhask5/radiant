<!--
  @fileoverview Privacy policy page.

  Static content page that displays the application's privacy policy.
  Since Radiant Finance is self-hosted, the policy emphasizes that
  all data stays on the user's own infrastructure.
-->

<svelte:head>
  <title>Privacy Policy - Radiant Finance</title>
</svelte:head>

<div class="policy-page">
  <div class="policy-container">
    <h1>Privacy Policy</h1>
    <p class="updated">Last updated: March 2026</p>

    <section>
      <h2>Self-Hosted Architecture</h2>
      <p>
        Radiant Finance is a self-hosted application. All financial data is stored exclusively in
        your own Supabase database instance and your device's local storage (IndexedDB). No data is
        sent to Radiant Finance servers or any third-party analytics services.
      </p>
    </section>

    <section>
      <h2>Data Collection</h2>
      <p>Radiant Finance collects and stores the following data in your own infrastructure:</p>
      <ul>
        <li>
          <strong>Account credentials</strong> — Your email and encrypted PIN for authentication
        </li>
        <li>
          <strong>Financial data</strong> — Bank accounts, transactions, balances, budgets, and categories
          synced via Teller.io
        </li>
        <li>
          <strong>Device identifiers</strong> — Randomly generated device IDs for trusted-device management
        </li>
        <li><strong>Application preferences</strong> — Your settings and configuration choices</li>
      </ul>
    </section>

    <section>
      <h2>Third-Party Services</h2>
      <h3>Supabase</h3>
      <p>
        Your data is stored in your own Supabase project. Supabase's privacy policy applies to how
        they handle your database hosting. You maintain full ownership and control of your data.
      </p>
      <h3>Teller.io</h3>
      <p>
        Bank account connections are facilitated through Teller.io. When you connect a bank account,
        Teller processes your banking credentials to establish a connection. Teller's privacy policy
        governs how they handle this data. Access tokens are stored in your Supabase database.
      </p>
      <h3>Vercel (Optional)</h3>
      <p>
        If deployed on Vercel, their infrastructure hosts the application. Vercel's privacy policy
        applies to request logs and deployment data.
      </p>
    </section>

    <section>
      <h2>Local Storage</h2>
      <p>
        Radiant Finance uses IndexedDB (browser storage) to enable offline access and instant
        interactions. This data remains on your device and is synced with your Supabase database
        when online.
      </p>
    </section>

    <section>
      <h2>Data Deletion</h2>
      <p>Since you control the infrastructure, you can delete all data at any time by:</p>
      <ul>
        <li>Clearing your browser's IndexedDB storage for this site</li>
        <li>Deleting data from your Supabase database directly</li>
        <li>Revoking Teller.io access tokens</li>
        <li>Deleting your Supabase project entirely</li>
      </ul>
    </section>

    <section>
      <h2>Security</h2>
      <p>
        All data in transit is encrypted via HTTPS/TLS. Supabase provides Row Level Security (RLS)
        policies to ensure data isolation. Bank connections use mTLS (mutual TLS) via Teller.io for
        additional security. Your PIN is hashed before storage.
      </p>
    </section>

    <section>
      <h2>Contact</h2>
      <p>
        Since Radiant Finance is self-hosted, you are both the data controller and the
        administrator. For questions about the software, refer to the project's GitHub repository.
      </p>
    </section>
  </div>
</div>

<style>
  .policy-page {
    min-height: 100vh;
    padding: 2rem 1rem;
    padding-top: max(2rem, calc(env(safe-area-inset-top, 0px) + 2rem));
    padding-bottom: max(2rem, calc(env(safe-area-inset-bottom, 0px) + 2rem));
    background: var(--color-bg, #0a0a16);
    color: var(--color-text, #f0eeff);
  }

  .policy-container {
    max-width: 680px;
    margin: 0 auto;
  }

  h1 {
    font-size: 2rem;
    font-weight: 700;
    margin: 0 0 0.25rem;
    background: linear-gradient(
      135deg,
      var(--color-primary, #8b5cf6),
      var(--color-accent, #f472b6)
    );
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .updated {
    color: var(--color-text-muted, #7874a0);
    font-size: 0.85rem;
    margin: 0 0 2rem;
  }

  section {
    margin-bottom: 2rem;
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    margin: 0 0 0.75rem;
    color: var(--color-text, #f0eeff);
  }

  h3 {
    font-size: 1rem;
    font-weight: 600;
    margin: 1rem 0 0.5rem;
    color: var(--color-text-secondary, #c4c0e0);
  }

  p {
    line-height: 1.7;
    color: var(--color-text-secondary, #c4c0e0);
    margin: 0 0 0.75rem;
  }

  ul {
    padding-left: 1.25rem;
    margin: 0 0 0.75rem;
  }

  li {
    line-height: 1.7;
    color: var(--color-text-secondary, #c4c0e0);
    margin-bottom: 0.25rem;
  }

  @media (max-width: 640px) {
    .policy-page {
      padding: 1.5rem 1rem;
    }

    h1 {
      font-size: 1.5rem;
    }
  }
</style>
