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
          <strong>Financial data</strong> — Bank accounts, transactions, balances, and categories synced
          via Teller.io
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
    background: transparent;
    color: var(--color-text);
    animation: policyFadeIn 0.7s var(--ease-out) both;
  }

  .policy-container {
    max-width: 680px;
    margin: 0 auto;
    animation: policySlideUp 0.8s var(--ease-out) 0.1s both;
  }

  h1 {
    font-size: 2rem;
    font-weight: 700;
    font-family: var(--font-display);
    letter-spacing: var(--tracking-tight);
    margin: 0 0 0.25rem;
    background: linear-gradient(
      120deg,
      var(--color-primary-light) 0%,
      var(--color-accent) 30%,
      var(--color-cyan) 60%,
      var(--color-primary-light) 100%
    );
    background-size: 300% 100%;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: policyShimmer 8s linear infinite;
  }

  .updated {
    color: var(--color-text-muted);
    font-size: 0.85rem;
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    margin: 0 0 2rem;
  }

  section {
    margin-bottom: 2rem;
    padding: 1.25rem 1.5rem;
    background: var(--color-glass);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    position: relative;
  }

  section::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(212, 160, 57, 0.3) 50%,
      transparent 100%
    );
  }

  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    font-family: var(--font-display);
    letter-spacing: 0.02em;
    margin: 0 0 0.75rem;
    color: var(--color-text);
  }

  h3 {
    font-size: 1rem;
    font-weight: 600;
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    margin: 1rem 0 0.5rem;
    color: var(--color-primary-light);
  }

  p {
    line-height: 1.7;
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    color: var(--color-text-secondary);
    margin: 0 0 0.75rem;
  }

  ul {
    padding-left: 1.25rem;
    margin: 0 0 0.75rem;
  }

  li {
    line-height: 1.7;
    font-family: var(
      --font-body,
      'SF Pro Text',
      -apple-system,
      BlinkMacSystemFont,
      'Segoe UI',
      system-ui,
      sans-serif
    );
    color: var(--color-text-secondary);
    margin-bottom: 0.25rem;
  }

  li strong {
    color: var(--color-text);
  }

  @keyframes policyFadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes policySlideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes policyShimmer {
    0% {
      background-position: 0% 50%;
    }
    100% {
      background-position: 300% 50%;
    }
  }

  @media (max-width: 640px) {
    .policy-page {
      padding: 1.5rem 1rem;
    }

    h1 {
      font-size: 1.5rem;
    }

    section {
      padding: 1rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .policy-page,
    .policy-container {
      animation: none;
    }

    h1 {
      animation: none;
      -webkit-text-fill-color: var(--color-primary-light);
    }
  }
</style>
