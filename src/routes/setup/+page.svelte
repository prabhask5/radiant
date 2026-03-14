<!--
  @fileoverview Five-step Supabase + Teller.io configuration wizard.

  Guides the user through entering Supabase credentials, validating them
  against the server, optionally deploying environment variables to Vercel,
  and reloading the app with the new config active.
-->
<script lang="ts">
  /**
   * @fileoverview Setup wizard page — first-time Supabase configuration.
   *
   * Guides the user through a five-step process to connect their own
   * Supabase backend to Radiant Finance:
   *
   * 1. Create a Supabase project (instructions only).
   * 2. Initialize the database (automatic — informational step).
   * 3. Enter and validate Supabase credentials (URL + publishable key).
   * 4. Persist configuration via Vercel API (set env vars + redeploy).
   * 5. Configure Teller.io for bank data (optional).
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
  //  Form State — Teller.io credentials (Step 5)
  // =============================================================================

  /** Teller Application ID */
  let tellerAppId = $state('');

  /** Teller environment: sandbox | development | production */
  let tellerEnvironment = $state<'sandbox' | 'development' | 'production'>('sandbox');

  /** Path to mTLS certificate for Teller API */
  let tellerCertPath = $state('');

  /** Teller webhook secret */
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

  /** Whether the Teller config is being saved */
  let savingTeller = $state(false);

  /** Error from saving Teller config, if any */
  let tellerSaveError = $state<string | null>(null);

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

    try {
      const res = await fetch('/api/setup/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supabaseUrl, supabasePublishableKey, vercelToken })
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

  // =============================================================================
  //  Teller Configuration — Step 5
  // =============================================================================

  /**
   * Save Teller.io configuration to user_settings via the settings API
   * endpoint and redirect to the home page.
   */
  async function handleSaveTeller() {
    tellerSaveError = null;
    savingTeller = true;

    try {
      const res = await fetch('/api/settings/teller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teller_app_id: tellerAppId || null,
          teller_environment: tellerEnvironment,
          teller_cert_path: tellerCertPath || null,
          teller_webhook_secret: tellerWebhookSecret || null
        })
      });

      const data = await res.json();

      if (data.success) {
        window.location.href = '/';
      } else {
        tellerSaveError = data.error || 'Failed to save Teller configuration';
      }
    } catch (e) {
      tellerSaveError = e instanceof Error ? e.message : 'Network error';
    }

    savingTeller = false;
  }

  /** Skip Teller configuration and redirect to home. */
  function handleSkipTeller() {
    window.location.href = '/';
  }
</script>

<svelte:head>
  <title>Setup - Radiant Finance</title>
</svelte:head>

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
          Radiant Finance stores data in your own Supabase project. Create one if you don't have one
          already — the free tier is more than enough.
        </p>
        <ol>
          <li>
            Go to <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer"
              >supabase.com/dashboard</a
            >
          </li>
          <li>
            Click <strong>New Project</strong>, choose a name and database password, then click
            <strong>Create new project</strong>.
          </li>
          <li>Wait for provisioning to finish (usually under a minute).</li>
        </ol>
        <p class="info-note">
          <strong>Note:</strong> Supabase's built-in SMTP works for development. For production you may
          want to configure a custom SMTP provider under Authentication &gt; Settings.
        </p>
      {:else if currentStep === 2}
        <h2>Step 2: Initialize the Database</h2>
        <p>
          The required tables and RLS policies are created automatically during the build process.
          When your app deploys to Vercel, the schema is pushed to your Supabase database &mdash; no
          manual SQL is needed.
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
        <h2>Step 4: Deploy to Vercel</h2>
        <p>
          Provide a one-time Vercel API token so Radiant Finance can set the environment variables
          on your project and trigger a redeployment.
        </p>
        <div class="form-group">
          <label for="vercel-token">Vercel API Token</label>
          <input
            id="vercel-token"
            type="password"
            placeholder="Paste your Vercel token"
            bind:value={vercelToken}
          />
        </div>

        <button class="btn btn-primary" onclick={handleDeploy} disabled={deploying || !vercelToken}>
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
            Deployment complete! Click <strong>Continue</strong> to configure Teller.io, or go
            straight to <a href="/">Radiant Finance</a>.
          </div>
        {/if}
      {:else if currentStep === 5}
        <h2>Step 5: Configure Teller.io (Optional)</h2>
        <p>
          Teller.io provides real-time bank data. You can skip this step and configure it later in <strong
            >Settings</strong
          >.
        </p>

        <div class="form-group">
          <label for="teller-app-id">Teller Application ID</label>
          <input
            id="teller-app-id"
            type="text"
            placeholder="app_xxxxxxxxxx"
            bind:value={tellerAppId}
          />
        </div>

        <div class="form-group">
          <label for="teller-environment">Environment</label>
          <select id="teller-environment" bind:value={tellerEnvironment}>
            <option value="sandbox">Sandbox</option>
            <option value="development">Development</option>
            <option value="production">Production</option>
          </select>
        </div>

        <div class="form-group">
          <label for="teller-cert-path">Certificate Path (for mTLS)</label>
          <input
            id="teller-cert-path"
            type="text"
            placeholder="/path/to/teller/certificate.pem"
            bind:value={tellerCertPath}
          />
          <span class="hint">Required for development and production environments.</span>
        </div>

        <div class="form-group">
          <label for="teller-webhook-secret">Webhook Secret</label>
          <input
            id="teller-webhook-secret"
            type="password"
            placeholder="Paste your Teller webhook secret"
            bind:value={tellerWebhookSecret}
          />
        </div>

        <div class="teller-actions">
          <button
            class="btn btn-primary"
            onclick={handleSaveTeller}
            disabled={savingTeller || !tellerAppId}
          >
            {#if savingTeller}Saving...{:else}Save Teller Configuration{/if}
          </button>

          <button class="btn btn-skip" onclick={handleSkipTeller}> Skip </button>
        </div>

        {#if tellerSaveError}
          <div class="message message-error">{tellerSaveError}</div>
        {/if}

        <div class="info-note" style="margin-top: 1rem;">
          <strong>Note:</strong> Teller.io provides real-time bank data. You can skip this step and configure
          it later in Settings.
        </div>
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
      {:else if currentStep === 4 && deployStage === 'ready'}
        <button class="btn btn-primary" onclick={() => currentStep++}>Continue</button>
      {/if}
    </div>

    <!-- Security notice (first-time setup only) -->
    {#if isFirstSetup}
      <div class="security-notice">
        <strong>Security:</strong> Your Supabase credentials are stored as environment variables on Vercel
        and are never sent to any third-party service. The Vercel token is used once and is not persisted.
      </div>
    {/if}
  </div>
</div>

<style>
  .setup-page {
    display: flex;
    justify-content: center;
    padding: 2rem 1rem;
    min-height: 100vh;
    background: var(--color-bg, #fafafa);
  }

  .setup-container {
    max-width: 640px;
    width: 100%;
  }

  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.75rem;
  }

  .subtitle {
    margin: 0 0 1.5rem;
    color: var(--color-text-muted, #666);
  }

  /* Step indicator */
  .step-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0;
    margin-bottom: 2rem;
  }

  .step-dot {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 2px solid var(--color-border, #ccc);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--color-text-muted, #666);
    background: var(--color-bg, #fff);
    flex-shrink: 0;
  }

  .step-dot.active {
    border-color: var(--color-primary, #3b82f6);
    color: var(--color-primary, #3b82f6);
    background: var(--color-primary-light, #eff6ff);
  }

  .step-dot.completed {
    border-color: var(--color-success, #22c55e);
    background: var(--color-success, #22c55e);
    color: #fff;
  }

  .checkmark {
    font-size: 0.875rem;
  }

  .step-line {
    width: 40px;
    height: 2px;
    background: var(--color-border, #ccc);
    flex-shrink: 0;
  }

  .step-line.completed {
    background: var(--color-success, #22c55e);
  }

  /* Step card */
  .step-card {
    padding: 1.5rem;
    border: 1px solid var(--color-border, #e2e2e2);
    border-radius: 8px;
    background: var(--color-surface, #fff);
    margin-bottom: 1.5rem;
  }

  .step-card h2 {
    margin: 0 0 0.75rem;
    font-size: 1.25rem;
  }

  .step-card p {
    margin: 0 0 1rem;
    line-height: 1.5;
  }

  .step-card ol {
    margin: 0 0 1rem;
    padding-left: 1.25rem;
    line-height: 1.7;
  }

  .info-note {
    padding: 0.75rem 1rem;
    background: var(--color-info-bg, #f0f9ff);
    border-radius: 6px;
    font-size: 0.875rem;
  }

  /* Form */
  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.25rem;
    font-weight: 600;
    font-size: 0.875rem;
  }

  .form-group input {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-border, #ccc);
    border-radius: 4px;
    font-size: 0.875rem;
    box-sizing: border-box;
  }

  .form-group select {
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--color-border, #ccc);
    border-radius: 4px;
    font-size: 0.875rem;
    box-sizing: border-box;
    background: var(--color-bg, #fff);
  }

  .hint {
    display: block;
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: var(--color-text-muted, #888);
  }

  /* Buttons */
  .btn {
    padding: 0.5rem 1.25rem;
    border: none;
    border-radius: 4px;
    font-size: 0.875rem;
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background: var(--color-primary, #3b82f6);
    color: #fff;
  }

  .btn-secondary {
    background: var(--color-secondary, #6b7280);
    color: #fff;
  }

  .btn-back {
    background: transparent;
    color: var(--color-text-muted, #666);
    border: 1px solid var(--color-border, #ccc);
  }

  .btn-skip {
    background: transparent;
    color: var(--color-text-muted, #666);
    border: 1px solid var(--color-border, #ccc);
  }

  .teller-actions {
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  /* Messages */
  .message {
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-top: 0.75rem;
    font-size: 0.875rem;
  }

  .message-error {
    background: var(--color-error-bg, #fef2f2);
    color: var(--color-error, #dc2626);
  }

  .message-success {
    background: var(--color-success-bg, #f0fdf4);
    color: var(--color-success, #16a34a);
  }

  /* Deploy stages */
  .deploy-stages {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .deploy-stage {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--color-text-muted, #999);
  }

  .deploy-stage.active {
    color: var(--color-primary, #3b82f6);
    font-weight: 600;
  }

  .deploy-stage.done {
    color: var(--color-success, #22c55e);
  }

  .stage-icon {
    width: 1.25rem;
    text-align: center;
  }

  /* Step navigation */
  .step-nav {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  /* Security notice */
  .security-notice {
    padding: 0.75rem 1rem;
    background: var(--color-info-bg, #f9fafb);
    border: 1px solid var(--color-border, #e5e7eb);
    border-radius: 6px;
    font-size: 0.8rem;
    color: var(--color-text-muted, #666);
    line-height: 1.5;
  }

  /* Responsive */
  @media (max-width: 480px) {
    .setup-page {
      padding: 1rem 0.5rem;
    }

    .step-card {
      padding: 1rem;
    }

    .step-line {
      width: 24px;
    }
  }
</style>
