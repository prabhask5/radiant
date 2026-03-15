<!--
  @fileoverview Five-step Supabase + Teller.io configuration wizard.

  Guides the user through entering Supabase credentials, validating them
  against the server, optionally deploying environment variables to Vercel,
  and reloading the app with the new config active.
-->
<script lang="ts">
  /**
   * @fileoverview Setup wizard page — first-time configuration.
   *
   * Guides the user through a five-step process to connect their own
   * Supabase backend and Teller.io bank integration to Radiant Finance:
   *
   * 1. Create a Supabase project (instructions only).
   * 2. Initialize the database (automatic — informational step).
   * 3. Enter and validate Supabase credentials (URL + publishable key).
   * 4. Configure Teller.io for bank data (client + server credentials).
   * 5. Persist configuration via Vercel API (set env vars + redeploy).
   *
   * After a successful deploy the page polls for a new service-worker
   * version — once detected the user is prompted to refresh.
   *
   * Access is controlled by the companion \`+page.ts\` load function:
   * - Unconfigured → anyone can reach this page (\`isFirstSetup: true\`).
   * - Configured → authenticated users only (\`isFirstSetup: false\`).
   */

  import { page } from '$app/stores';
  import { setConfig } from 'stellar-drive/config';
  import { isOnline } from 'stellar-drive/stores';
  import { pollForNewServiceWorker } from 'stellar-drive/kit';
  import Reconfigure from './Reconfigure.svelte';

  // =============================================================================
  //  Wizard State
  // =============================================================================

  /** Current step (1-5) */
  let currentStep = $state(1);

  // =============================================================================
  //  Form State — Supabase + Vercel credentials
  // =============================================================================

  /** Supabase project URL entered by the user */
  let supabaseUrl = $state('');

  /** Supabase publishable key entered by the user */
  let supabasePublishableKey = $state('');

  /** One-time Vercel API token for setting env vars */
  let vercelToken = $state('');

  // =============================================================================
  //  Form State — Teller.io credentials (Step 4)
  // =============================================================================

  /** Teller Application ID (client-side — used by Teller Connect SDK) */
  let tellerAppId = $state('');

  /**
   * Teller environment — hardcoded to 'development' which is free,
   * uses real bank data, and allows up to 100 enrollments (bank logins).
   */
  const tellerEnvironment = 'development';

  /** Teller mTLS certificate PEM content (server-side env var) */
  let tellerCert = $state('');

  /** Teller mTLS private key PEM content (server-side env var) */
  let tellerKey = $state('');

  /** Teller webhook signing secret (server-side env var) */
  let tellerWebhookSecret = $state('');

  // =============================================================================
  //  UI State — Validation & Deployment feedback
  // =============================================================================

  /** Whether the "Test Connection" request is in-flight */
  let validating = $state(false);

  /** Whether the deploy/redeploy flow is in-flight */
  let deploying = $state(false);

  /** Error from credential validation, if any */
  let validateError = $state<string | null>(null);

  /** \`true\` after credentials have been successfully validated */
  let validateSuccess = $state(false);

  /** Error from the deployment step, if any */
  let deployError = $state<string | null>(null);

  /** Current deployment pipeline stage — drives the progress UI */
  let deployStage = $state<'idle' | 'setting-env' | 'deploying' | 'ready'>('idle');

  /** URL returned by Vercel for the triggered deployment (informational) */
  let _deploymentUrl = $state('');

  // =============================================================================
  //  Derived State
  // =============================================================================

  /** Whether this is a first-time setup (public) or reconfiguration */
  const isFirstSetup = $derived(($page.data as { isFirstSetup?: boolean }).isFirstSetup ?? false);

  /**
   * Snapshot of the credentials at validation time — used to detect
   * if the user edits the inputs *after* a successful validation.
   */
  let validatedUrl = $state('');
  let validatedKey = $state('');

  /**
   * \`true\` when the user changes credentials after a successful
   * validation — the "Continue" button should be re-disabled.
   */
  const credentialsChanged = $derived(
    validateSuccess && (supabaseUrl !== validatedUrl || supabasePublishableKey !== validatedKey)
  );

  /** Whether the Continue button on step 3 should be enabled */
  const canContinueStep3 = $derived(validateSuccess && !credentialsChanged);

  /** Whether the Continue button on step 4 should be enabled (all Teller fields required) */
  const canContinueStep4 = $derived(
    !!tellerAppId && !!tellerCert && !!tellerKey && !!tellerWebhookSecret
  );

  // =============================================================================
  //  Effects
  // =============================================================================

  /**
   * Auto-reset validation state when the user modifies credentials
   * after they were already validated — forces re-validation.
   */
  $effect(() => {
    if (credentialsChanged) {
      validateSuccess = false;
      validateError = null;
    }
  });

  // =============================================================================
  //  Validation — "Test Connection"
  // =============================================================================

  /**
   * Send the entered Supabase credentials to \`/api/setup/validate\`
   * and update UI state based on the result. On success, also
   * cache the config locally via \`setConfig\` so the app is usable
   * immediately after the deployment finishes.
   */
  async function handleValidate() {
    validateError = null;
    validateSuccess = false;
    validating = true;

    try {
      const res = await fetch('/api/setup/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supabaseUrl, supabasePublishableKey })
      });

      const data = await res.json();

      if (data.valid) {
        validateSuccess = true;
        validatedUrl = supabaseUrl;
        validatedKey = supabasePublishableKey;
        /* Cache config locally so the app works immediately after deploy */
        setConfig({
          supabaseUrl,
          supabasePublishableKey,
          configured: true
        });
      } else {
        validateError = data.error || 'Validation failed';
      }
    } catch (e) {
      validateError = e instanceof Error ? e.message : 'Network error';
    }

    validating = false;
  }

  // =============================================================================
  //  Deployment Polling
  // =============================================================================

  /**
   * Poll for a new service-worker version to detect when the Vercel
   * redeployment has finished. Uses the engine's \`pollForNewServiceWorker\`
   * helper which checks \`registration.update()\` at regular intervals.
   *
   * Resolves a Promise when a new SW is detected in the waiting state.
   */
  function pollForDeployment(): Promise<void> {
    return new Promise((resolve) => {
      pollForNewServiceWorker({
        intervalMs: 3000,
        maxAttempts: 200,
        onFound: () => {
          deployStage = 'ready';
          resolve();
        }
      });
    });
  }

  // =============================================================================
  //  Deployment — Set env vars + trigger Vercel redeploy
  // =============================================================================

  /**
   * Send credentials and the Vercel token to \`/api/setup/deploy\`,
   * which sets the environment variables on the Vercel project and
   * triggers a fresh deployment. Then poll until the new build is live.
   */
  async function handleDeploy() {
    deployError = null;
    deploying = true;
    deployStage = 'setting-env';

    // Build extra env vars from Teller config (only include non-empty values)
    const extraEnvVars: Record<string, string> = {};
    if (tellerAppId) extraEnvVars['PUBLIC_TELLER_APP_ID'] = tellerAppId;
    extraEnvVars['PUBLIC_TELLER_ENVIRONMENT'] = tellerEnvironment;
    if (tellerCert) extraEnvVars['TELLER_CERT'] = tellerCert;
    if (tellerKey) extraEnvVars['TELLER_KEY'] = tellerKey;
    if (tellerWebhookSecret) extraEnvVars['TELLER_WEBHOOK_SECRET'] = tellerWebhookSecret;

    try {
      const res = await fetch('/api/setup/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supabaseUrl,
          supabasePublishableKey,
          vercelToken,
          extraEnvVars: Object.keys(extraEnvVars).length > 0 ? extraEnvVars : undefined
        })
      });

      const data = await res.json();

      if (data.success) {
        deployStage = 'deploying';
        _deploymentUrl = data.deploymentUrl || '';
        /* Poll for the new SW version → marks \`deployStage = 'ready'\` */
        await pollForDeployment();
      } else {
        deployError = data.error || 'Deployment failed';
        deployStage = 'idle';
      }
    } catch (e) {
      deployError = e instanceof Error ? e.message : 'Network error';
      deployStage = 'idle';
    }

    deploying = false;
  }
</script>

<svelte:head>
  <title>Setup - Radiant Finance</title>
</svelte:head>

{#if !isFirstSetup}
  <!-- ═══ Reconfigure Mode ═══ -->
  <div class="setup-page">
    <div class="setup-container">
      <h1>Reconfigure Radiant Finance</h1>
      <p class="subtitle">Update your credentials and redeploy</p>
      <Reconfigure />
    </div>
  </div>
{:else}
  <div class="setup-page">
    <div class="setup-container">
      <!-- Header -->
      <h1>Set Up Radiant Finance</h1>
      <p class="subtitle">Configure Radiant Finance to connect to your own Supabase backend</p>

      <!-- Step indicator -->
      <div class="step-indicator">
        {#each [1, 2, 3, 4, 5] as step (step)}
          {#if step > 1}
            <div class="step-line" class:completed={currentStep > step - 1}></div>
          {/if}
          <div
            class="step-dot"
            class:active={currentStep === step}
            class:completed={currentStep > step}
          >
            {#if currentStep > step}
              <span class="checkmark">&#10003;</span>
            {:else}
              {step}
            {/if}
          </div>
        {/each}
      </div>

      <!-- Offline warning -->
      {#if !$isOnline}
        <div class="message message-error">
          You are currently offline. An internet connection is required to complete setup.
        </div>
      {/if}

      <!-- Step cards -->
      <div class="step-card">
        {#if currentStep === 1}
          <h2>Step 1: Create a Supabase Project</h2>
          <p>
            Radiant Finance stores data in your own Supabase project. Create one if you don't have
            one already — the free tier is more than enough.
          </p>
          <ol>
            <li>
              Go to <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noopener noreferrer">supabase.com/dashboard</a
              >
            </li>
            <li>
              Click <strong>New Project</strong>, choose a name and database password, then click
              <strong>Create new project</strong>.
            </li>
            <li>Wait for provisioning to finish (usually under a minute).</li>
          </ol>
          <p class="info-note">
            <strong>Note:</strong> Supabase's built-in SMTP works for development. For production you
            may want to configure a custom SMTP provider under Authentication &gt; Settings.
          </p>
        {:else if currentStep === 2}
          <h2>Step 2: Initialize the Database</h2>
          <p>
            The required tables and RLS policies are created automatically during the build process.
            When your app deploys to Vercel, the schema is pushed to your Supabase database &mdash;
            no manual SQL is needed.
          </p>
        {:else if currentStep === 3}
          <h2>Step 3: Connect Your Supabase Project</h2>
          <p>
            Find these values in your Supabase dashboard under <strong>Settings &gt; API</strong>.
          </p>

          <div class="form-group">
            <label for="supabase-url">Project URL</label>
            <input
              id="supabase-url"
              type="url"
              placeholder="https://your-project.supabase.co"
              bind:value={supabaseUrl}
            />
          </div>

          <div class="form-group">
            <label for="supabase-key">Publishable Key (anon / public)</label>
            <input
              id="supabase-key"
              type="text"
              placeholder="eyJhbGciOiJIUzI1NiIs..."
              bind:value={supabasePublishableKey}
            />
            <span class="hint">This is the `anon` key — safe to expose in the browser.</span>
          </div>

          <button
            class="btn btn-secondary"
            onclick={handleValidate}
            disabled={validating || !supabaseUrl || !supabasePublishableKey}
          >
            {#if validating}Testing...{:else}Test Connection{/if}
          </button>

          {#if validateError}
            <div class="message message-error">{validateError}</div>
          {/if}
          {#if validateSuccess}
            <div class="message message-success">Connection successful! Credentials are valid.</div>
          {/if}
        {:else if currentStep === 4}
          <h2>Step 4: Connect Teller.io</h2>
          <p>
            <a href="https://teller.io" target="_blank" rel="noopener noreferrer">Teller.io</a> connects
            Radiant to your bank accounts for automatic transaction syncing. You'll need a Teller account
            with an application and mTLS certificate.
          </p>

          <div class="info-note" style="margin-bottom: 1.25rem;">
            <strong>How to get your Teller credentials:</strong>
            <ol style="margin: 0.5rem 0 0; padding-left: 1.25rem;">
              <li>
                Sign up at <a
                  href="https://teller.io/signup"
                  target="_blank"
                  rel="noopener noreferrer">teller.io/signup</a
                > and create an application.
              </li>
              <li>
                Find your <strong>Application ID</strong> on the
                <a href="https://teller.io/dashboard" target="_blank" rel="noopener noreferrer"
                  >Teller Dashboard</a
                >
                (looks like <code>app_xxxxxxxxxx</code>).
              </li>
              <li>
                Download your <strong>mTLS certificate</strong> and <strong>private key</strong>
                from the dashboard under <strong>Certificates</strong>. Open each file in a text
                editor and paste the full PEM content below.
              </li>
              <li>
                Under <strong>Webhooks</strong> in the dashboard, set your webhook URL to
                <code>https://[YOUR_DOMAIN]/api/teller/webhook</code>. Enable all three event types
                (<strong>enrollment.disconnected</strong>,
                <strong>transactions.processed</strong>, and
                <strong>account.number_verification.processed</strong>). Then copy the
                <strong>Signing Secret</strong> — Radiant uses it to verify that incoming webhooks are
                genuinely from Teller.
              </li>
            </ol>
          </div>

          <div class="info-note" style="margin-bottom: 1.25rem;">
            <strong>About the Development environment:</strong> Radiant uses Teller's Development environment,
            which is free and connects to real banks. It supports up to 100 enrollments — an enrollment
            is a single bank login (e.g. your Chase login), which can include multiple accounts (checking,
            savings, credit card) under the same login. 100 enrollments is more than enough for personal
            use.
          </div>

          <div class="form-group">
            <label for="teller-app-id">Application ID</label>
            <input
              id="teller-app-id"
              type="text"
              placeholder="app_xxxxxxxxxx"
              bind:value={tellerAppId}
            />
            <span class="hint"
              >Found on your <a
                href="https://teller.io/dashboard"
                target="_blank"
                rel="noopener noreferrer">Teller Dashboard</a
              >.</span
            >
          </div>

          <div class="form-group">
            <label for="teller-cert">Client Certificate (PEM)</label>
            <textarea
              id="teller-cert"
              placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
              bind:value={tellerCert}
              rows="4"
            ></textarea>
            <span class="hint"
              >Paste the full PEM content of your mTLS certificate from the Teller dashboard.</span
            >
          </div>

          <div class="form-group">
            <label for="teller-key">Private Key (PEM)</label>
            <textarea
              id="teller-key"
              placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
              bind:value={tellerKey}
              rows="4"
            ></textarea>
            <span class="hint">The private key that matches your client certificate above.</span>
          </div>

          <div class="form-group">
            <label for="teller-webhook-secret">Webhook Signing Secret</label>
            <input
              id="teller-webhook-secret"
              type="text"
              placeholder="Paste your Teller signing secret"
              bind:value={tellerWebhookSecret}
            />
            <span class="hint"
              >Found under Webhooks > Signing secrets on your Teller Dashboard. Used to verify that
              incoming webhooks are from Teller.</span
            >
          </div>
        {:else if currentStep === 5}
          <h2>Step 5: Deploy to Vercel</h2>
          <p>
            Provide a one-time <a
              href="https://vercel.com/account/tokens"
              target="_blank"
              rel="noopener noreferrer">Vercel API token</a
            >
            so Radiant can set environment variables on your project and trigger a redeployment.
          </p>

          <div class="info-note" style="margin-bottom: 1.25rem;">
            <strong>How to create a Vercel token:</strong>
            <ol style="margin: 0.5rem 0 0; padding-left: 1.25rem;">
              <li>
                Go to <a
                  href="https://vercel.com/account/tokens"
                  target="_blank"
                  rel="noopener noreferrer">vercel.com/account/tokens</a
                >.
              </li>
              <li>
                Click <strong>Create Token</strong>, give it a name (e.g. "Radiant Setup"), and set
                an expiration. A short expiration (1 day) is fine — this token is only used once.
              </li>
              <li>Copy the token and paste it below.</li>
            </ol>
          </div>

          <div class="form-group">
            <label for="vercel-token">Vercel API Token</label>
            <input
              id="vercel-token"
              type="password"
              placeholder="Paste your Vercel token"
              bind:value={vercelToken}
            />
            <span class="hint"
              >Used once to set env vars and trigger a deploy. Not stored anywhere.</span
            >
          </div>

          <button
            class="btn btn-primary"
            onclick={handleDeploy}
            disabled={deploying || !vercelToken}
          >
            {#if deploying}Deploying...{:else}Deploy{/if}
          </button>

          {#if deployError}
            <div class="message message-error">{deployError}</div>
          {/if}

          <!-- Deployment pipeline stages -->
          {#if deployStage !== 'idle'}
            <div class="deploy-stages">
              <div
                class="deploy-stage"
                class:active={deployStage === 'setting-env'}
                class:done={deployStage === 'deploying' || deployStage === 'ready'}
              >
                <span class="stage-icon"
                  >{#if deployStage === 'setting-env'}&#9675;{:else}&#10003;{/if}</span
                >
                Setting environment variables
              </div>
              <div
                class="deploy-stage"
                class:active={deployStage === 'deploying'}
                class:done={deployStage === 'ready'}
              >
                <span class="stage-icon"
                  >{#if deployStage === 'deploying'}&#9675;{:else if deployStage === 'ready'}&#10003;{:else}&#8226;{/if}</span
                >
                Deploying to Vercel
              </div>
              <div class="deploy-stage" class:active={deployStage === 'ready'}>
                <span class="stage-icon"
                  >{#if deployStage === 'ready'}&#10003;{:else}&#8226;{/if}</span
                >
                Ready
              </div>
            </div>
          {/if}

          {#if deployStage === 'ready'}
            <div class="message message-success">
              Deployment complete! Go to <a href="/">Radiant Finance</a> to get started.
            </div>
          {/if}
        {/if}
      </div>

      <!-- Step navigation -->
      <div class="step-nav">
        {#if currentStep > 1}
          <button class="btn btn-back" onclick={() => currentStep--}>Back</button>
        {:else}
          <div></div>
        {/if}

        {#if currentStep < 3}
          <button class="btn btn-primary" onclick={() => currentStep++}>Continue</button>
        {:else if currentStep === 3}
          <button class="btn btn-primary" onclick={() => currentStep++} disabled={!canContinueStep3}
            >Continue</button
          >
        {:else if currentStep === 4}
          <button class="btn btn-primary" onclick={() => currentStep++} disabled={!canContinueStep4}
            >Continue</button
          >
        {/if}
      </div>

      <!-- Security notice (first-time setup only) -->
      {#if isFirstSetup}
        <div class="security-notice">
          <strong>Security:</strong> Your Supabase and Teller credentials are stored as environment variables
          on Vercel and are never sent to any third-party service. The Vercel token is used once and is
          not persisted.
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* ═══════════════════════════════════════════════════════════════════════════════════
     SETUP PAGE — Crystal Forge / Gem Vault Theme
     Matches Stellar's CSS architecture: hardcoded fallbacks, full self-contained
     visual identity, cinematic animations, glassmorphism, spring easing.
     ═══════════════════════════════════════════════════════════════════════════════════ */

  .setup-page {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    padding: 2rem 1rem;
    background:
      radial-gradient(ellipse at 25% 15%, rgba(120, 80, 20, 0.5) 0%, transparent 50%),
      radial-gradient(ellipse at 75% 85%, rgba(100, 60, 15, 0.3) 0%, transparent 50%),
      linear-gradient(180deg, #0a0806 0%, #0e0c08 30%, #141210 60%, #0c0a08 100%);
    color: var(--color-text, #f5efe0);
    overflow: hidden;
  }

  /* ═══ Crystal Lattice Background — angular facet refractions + prismatic clouds ═══ */

  .setup-page::before {
    content: '';
    position: fixed;
    inset: 0;
    background-image:
      /* Angular facet-edge refractions — sharp light lines at gem-cut angles */
      linear-gradient(
        127deg,
        transparent 0%,
        transparent 23.8%,
        rgba(212, 160, 57, 0.16) 24%,
        rgba(212, 160, 57, 0.16) 24.3%,
        transparent 24.5%
      ),
      linear-gradient(
        53deg,
        transparent 0%,
        transparent 67.5%,
        rgba(232, 93, 117, 0.12) 67.8%,
        rgba(232, 93, 117, 0.12) 68.1%,
        transparent 68.3%
      ),
      linear-gradient(
        172deg,
        transparent 0%,
        transparent 41.5%,
        rgba(255, 255, 255, 0.14) 41.7%,
        rgba(255, 255, 255, 0.14) 42%,
        transparent 42.2%
      ),
      linear-gradient(
        98deg,
        transparent 0%,
        transparent 80.5%,
        rgba(16, 185, 129, 0.1) 80.7%,
        rgba(16, 185, 129, 0.1) 81%,
        transparent 81.2%
      ),
      linear-gradient(
        145deg,
        transparent 0%,
        transparent 54.5%,
        rgba(245, 158, 11, 0.09) 54.7%,
        rgba(245, 158, 11, 0.09) 55%,
        transparent 55.2%
      ),
      linear-gradient(
        34deg,
        transparent 0%,
        transparent 36%,
        rgba(46, 196, 166, 0.08) 36.2%,
        rgba(46, 196, 166, 0.08) 36.5%,
        transparent 36.7%
      ),
      /* Geometric lattice — crystal structure lines */
      repeating-linear-gradient(
          60deg,
          transparent,
          transparent 100px,
          rgba(212, 160, 57, 0.02) 100px,
          rgba(212, 160, 57, 0.02) 101px
        ),
      repeating-linear-gradient(
        -60deg,
        transparent,
        transparent 100px,
        rgba(232, 93, 117, 0.015) 100px,
        rgba(232, 93, 117, 0.015) 101px
      );
    animation: gemFacetBreathe 8s ease-in-out infinite;
    pointer-events: none;
    z-index: 0;
  }

  /* Prismatic gem clouds — amethyst + rose quartz + aquamarine */
  .setup-page::after {
    content: '';
    position: fixed;
    inset: 0;
    background:
      radial-gradient(600px 600px at 20% 10%, rgba(212, 160, 57, 0.08) 0%, transparent 70%),
      radial-gradient(500px 500px at 85% 90%, rgba(232, 93, 117, 0.06) 0%, transparent 70%),
      radial-gradient(400px 400px at 50% 50%, rgba(46, 196, 166, 0.04) 0%, transparent 70%);
    animation: prismCloudDrift 20s ease-in-out infinite alternate;
    pointer-events: none;
    z-index: 0;
  }

  @keyframes gemFacetBreathe {
    0%,
    100% {
      opacity: 0.85;
    }
    50% {
      opacity: 1;
    }
  }

  @keyframes prismCloudDrift {
    0% {
      transform: translate(0, 0) scale(1);
    }
    50% {
      transform: translate(15px, -8px) scale(1.03);
    }
    100% {
      transform: translate(-8px, 12px) scale(0.97);
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════════════
     CONTAINER — Content layer above the background
     ═══════════════════════════════════════════════════════════════════════════════════ */

  .setup-container {
    width: 100%;
    max-width: 640px;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    position: relative;
    z-index: 1;
  }

  /* ═══════════════════════════════════════════════════════════════════════════════════
     HEADER — Title with prismatic shimmer
     ═══════════════════════════════════════════════════════════════════════════════════ */

  h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin: 0;
    color: var(--color-text, #f5efe0);
    background: linear-gradient(135deg, #f5efe0, #e8b94a, #e85d75, #f5efe0);
    background-size: 200% auto;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    animation: shimmer 3s linear infinite;
    font-family: var(--font-display, 'SF Pro Display', Georgia, serif);
  }

  @keyframes shimmer {
    0% {
      background-position: 0% center;
    }
    100% {
      background-position: 200% center;
    }
  }

  .subtitle {
    font-size: 0.9375rem;
    color: var(--color-text-muted, #8a7e68);
    margin: 0;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  /* ═══════════════════════════════════════════════════════════════════════════════════
     STEP INDICATOR — Numbered gem nodes connected by crystal veins
     ═══════════════════════════════════════════════════════════════════════════════════ */

  .step-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .step-dot {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8125rem;
    font-weight: 700;
    border: 2px solid rgba(212, 160, 57, 0.25);
    color: var(--color-text-muted, #8a7e68);
    background: rgba(14, 12, 8, 0.8);
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    flex-shrink: 0;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  .step-dot.active {
    border-color: var(--color-primary, #d4a039);
    color: var(--color-primary-light, #e8b94a);
    background: rgba(212, 160, 57, 0.15);
    box-shadow: 0 0 16px rgba(212, 160, 57, 0.35);
  }

  .step-dot.completed {
    border-color: #10b981;
    background: #10b981;
    color: white;
    box-shadow: 0 0 10px rgba(16, 185, 129, 0.3);
  }

  .checkmark {
    font-size: 0.875rem;
  }

  .step-line {
    width: 44px;
    height: 2px;
    background: rgba(212, 160, 57, 0.15);
    transition: background 0.3s ease;
    flex-shrink: 0;
  }

  .step-line.completed {
    background: #10b981;
    box-shadow: 0 0 6px rgba(16, 185, 129, 0.3);
  }

  /* ═══════════════════════════════════════════════════════════════════════════════════
     STEP CARD — Glassmorphism panel with top glow accent
     ═══════════════════════════════════════════════════════════════════════════════════ */

  .step-card {
    background: linear-gradient(165deg, rgba(14, 12, 8, 0.92) 0%, rgba(18, 14, 10, 0.88) 100%);
    border: 1px solid rgba(212, 160, 57, 0.25);
    border-radius: 16px;
    padding: 1.25rem 1.5rem 1.5rem;
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    box-shadow:
      0 16px 48px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(255, 255, 255, 0.03) inset;
    overflow: hidden;
    position: relative;
  }

  /* Top glow line — prismatic accent */
  .step-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 10%;
    right: 10%;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(212, 160, 57, 0.5),
      rgba(255, 255, 255, 0.3),
      rgba(232, 93, 117, 0.4),
      transparent
    );
  }

  .step-card h2 {
    font-size: 1.0625rem;
    font-weight: 700;
    color: var(--color-text, #f5efe0);
    margin: 0 0 1rem;
    font-family: var(--font-display, 'SF Pro Display', Georgia, serif);
  }

  .step-card p {
    font-size: 0.875rem;
    color: var(--color-text-muted, #8a7e68);
    margin: 0 0 1rem;
    line-height: 1.6;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  .step-card p strong {
    color: var(--color-text, #f5efe0);
    font-weight: 600;
  }

  .step-card ol {
    margin: 0 0 1rem;
    padding-left: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    font-size: 0.875rem;
    color: var(--color-text-muted, #8a7e68);
    line-height: 1.6;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  .step-card ol li::marker {
    color: rgba(212, 160, 57, 0.6);
    font-weight: 600;
  }

  .step-card ol strong {
    color: var(--color-text, #f5efe0);
    font-weight: 600;
  }

  .step-card a {
    color: var(--color-primary-light, #e8b94a);
    text-decoration: none;
    border-bottom: 1px solid rgba(232, 185, 74, 0.3);
    transition: all 0.2s;
  }

  .step-card a:hover {
    color: var(--color-primary, #d4a039);
    border-bottom-color: rgba(212, 160, 57, 0.6);
  }

  /* ═══════════════════════════════════════════════════════════════════════════════════
     INFO NOTE — Inline callout
     ═══════════════════════════════════════════════════════════════════════════════════ */

  .info-note {
    padding: 0.75rem 1rem;
    background: rgba(212, 160, 57, 0.08);
    border: 1px solid rgba(212, 160, 57, 0.2);
    border-radius: 8px;
    font-size: 0.8125rem;
    color: var(--color-text-muted, #8a7e68);
    line-height: 1.5;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  .info-note strong {
    color: var(--color-text, #f5efe0);
    font-weight: 600;
  }

  .info-note ol {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    line-height: 1.5;
  }

  .info-note a {
    color: var(--color-primary-light, #e8b94a);
    text-decoration: none;
    border-bottom: 1px solid rgba(232, 185, 74, 0.3);
    transition: all 0.2s;
  }

  .info-note a:hover {
    color: var(--color-primary, #d4a039);
    border-bottom-color: rgba(212, 160, 57, 0.6);
  }

  .info-note code {
    font-family: 'SF Mono', ui-monospace, monospace;
    font-size: 0.75rem;
    background: rgba(212, 160, 57, 0.1);
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    color: var(--color-primary-light, #e8b94a);
  }

  .hint a {
    color: var(--color-primary-light, #e8b94a);
    text-decoration: none;
    border-bottom: 1px solid rgba(232, 185, 74, 0.3);
  }

  .hint a:hover {
    color: var(--color-primary, #d4a039);
  }

  /* ═══════════════════════════════════════════════════════════════════════════════════
     FORM — Inputs, labels, selects, hints
     ═══════════════════════════════════════════════════════════════════════════════════ */

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .form-group label {
    font-weight: 700;
    color: var(--color-text-muted, #8a7e68);
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  .form-group input {
    width: 100%;
    padding: 0.875rem 1rem;
    font-size: 0.9375rem;
    color: var(--color-text, #f5efe0);
    background: rgba(14, 12, 8, 0.6);
    border: 1px solid rgba(212, 160, 57, 0.2);
    border-radius: 10px;
    transition: all 0.3s;
    font-family: inherit;
    box-sizing: border-box;
  }

  .form-group input:focus {
    outline: none;
    border-color: rgba(212, 160, 57, 0.5);
    box-shadow: 0 0 20px rgba(212, 160, 57, 0.15);
  }

  .form-group input:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .form-group input::placeholder {
    color: rgba(138, 126, 104, 0.5);
  }

  .form-group textarea {
    width: 100%;
    padding: 0.875rem 1rem;
    font-size: 0.8125rem;
    color: var(--color-text, #f5efe0);
    background: rgba(14, 12, 8, 0.6);
    border: 1px solid rgba(212, 160, 57, 0.2);
    border-radius: 10px;
    transition: all 0.3s;
    font-family: 'SF Mono', ui-monospace, monospace;
    box-sizing: border-box;
    resize: vertical;
    line-height: 1.5;
  }

  .form-group textarea:focus {
    outline: none;
    border-color: rgba(212, 160, 57, 0.5);
    box-shadow: 0 0 20px rgba(212, 160, 57, 0.15);
  }

  .form-group textarea::placeholder {
    color: rgba(138, 126, 104, 0.5);
    font-family: 'SF Mono', ui-monospace, monospace;
  }

  .hint {
    font-size: 0.75rem;
    color: var(--color-text-muted, #8a7e68);
    opacity: 0.7;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  /* ═══════════════════════════════════════════════════════════════════════════════════
     BUTTONS — Primary (gradient + lift) & secondary (outline) + back/skip
     ═══════════════════════════════════════════════════════════════════════════════════ */

  .btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.875rem 1.5rem;
    font-size: 0.9375rem;
    font-weight: 600;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    border: none;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  .btn-primary {
    background: var(--gradient-primary, linear-gradient(135deg, #d4a039, #e85d75));
    color: white;
    box-shadow: 0 4px 16px rgba(212, 160, 57, 0.25);
  }

  .btn-primary:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 6px 24px rgba(212, 160, 57, 0.4);
  }

  .btn-secondary {
    background: rgba(212, 160, 57, 0.15);
    color: var(--color-primary-light, #e8b94a);
    border: 1px solid rgba(212, 160, 57, 0.3);
  }

  .btn-secondary:hover:not(:disabled) {
    background: rgba(212, 160, 57, 0.25);
    border-color: rgba(212, 160, 57, 0.5);
  }

  .btn-back {
    background: transparent;
    color: var(--color-text-muted, #8a7e68);
    border: 1px solid rgba(212, 160, 57, 0.15);
  }

  .btn-back:hover {
    background: rgba(212, 160, 57, 0.08);
    border-color: rgba(212, 160, 57, 0.3);
    color: var(--color-text-secondary, #c8bfa8);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none !important;
    box-shadow: none !important;
  }

  /* ═══════════════════════════════════════════════════════════════════════════════════
     MESSAGES — Error (ruby) and success (emerald) feedback
     ═══════════════════════════════════════════════════════════════════════════════════ */

  .message {
    margin-top: 0.75rem;
    padding: 0.875rem 1rem;
    border-radius: 10px;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.5;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  .message-error {
    background: linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(239, 68, 68, 0.05) 100%);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .message-success {
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(16, 185, 129, 0.05) 100%);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .message-success a {
    color: #34d399;
    text-decoration: underline;
  }

  /* ═══════════════════════════════════════════════════════════════════════════════════
     DEPLOY STAGES — Crystal formation progress tracker
     ═══════════════════════════════════════════════════════════════════════════════════ */

  .deploy-stages {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .deploy-stage {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.875rem;
    color: var(--color-text-muted, #8a7e68);
    opacity: 0.5;
    transition: all 0.3s;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  .deploy-stage.active {
    opacity: 1;
    color: var(--color-primary-light, #e8b94a);
  }

  .deploy-stage.active .stage-icon {
    animation: stagePulse 1.2s ease-in-out infinite;
  }

  @keyframes stagePulse {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 1;
    }
  }

  .deploy-stage.done {
    opacity: 1;
    color: #34d399;
  }

  .stage-icon {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  /* ═══════════════════════════════════════════════════════════════════════════════════
     STEP NAVIGATION
     ═══════════════════════════════════════════════════════════════════════════════════ */

  .step-nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  /* ═══════════════════════════════════════════════════════════════════════════════════
     SECURITY NOTICE — Amber-tinted warning
     ═══════════════════════════════════════════════════════════════════════════════════ */

  .security-notice {
    padding: 1rem 1.25rem;
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.25);
    border-radius: 12px;
    font-size: 0.8125rem;
    color: #fbbf24;
    line-height: 1.5;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  .security-notice strong {
    color: #fbbf24;
    font-weight: 700;
  }

  /* ═══════════════════════════════════════════════════════════════════════════════════
     RESPONSIVE — Mobile & compact layouts
     ═══════════════════════════════════════════════════════════════════════════════════ */

  @media (max-width: 640px) {
    .setup-page {
      padding: 1rem 0.75rem;
    }

    h1 {
      font-size: 1.375rem;
    }

    .subtitle {
      font-size: 0.8125rem;
    }

    .step-card {
      padding: 1rem 1.25rem 1.25rem;
    }

    .form-group input,
    .form-group textarea {
      padding: 0.75rem 0.875rem;
      font-size: 16px; /* Prevents iOS zoom */
    }

    .step-dot {
      width: 30px;
      height: 30px;
    }

    .step-line {
      width: 32px;
    }
  }

  /* iPhone SE */
  @media (max-width: 375px) {
    .setup-page {
      padding: 0.75rem 0.5rem;
    }

    h1 {
      font-size: 1.25rem;
    }

    .step-card {
      padding: 0.875rem 1rem 1rem;
    }

    .step-dot {
      width: 28px;
      height: 28px;
      font-size: 0.75rem;
    }

    .step-line {
      width: 24px;
    }
  }

  /* iPhone 16 Pro (~402px) */
  @media (min-width: 400px) and (max-width: 430px) {
    .setup-page {
      padding: 1.25rem 1rem;
    }
  }

  /* iPhone Pro Max (430px+) */
  @media (min-width: 430px) and (max-width: 640px) {
    .setup-page {
      padding: 1.5rem 1rem;
    }

    .step-card {
      padding: 1rem 1.5rem 1.5rem;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════════════
     REDUCED MOTION
     ═══════════════════════════════════════════════════════════════════════════════════ */

  @media (prefers-reduced-motion: reduce) {
    .setup-page::before,
    .setup-page::after {
      animation: none;
    }

    h1 {
      animation: none;
      background: none;
      -webkit-text-fill-color: var(--color-text, #f5efe0);
    }

    .btn {
      transition: none;
    }

    .step-dot,
    .step-line,
    .deploy-stage {
      transition: none;
    }
  }
</style>
