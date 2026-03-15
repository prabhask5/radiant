<!--
  @fileoverview Reconfigure settings page for Radiant Finance.

  Shown when `isFirstSetup: false` — a flat settings page where the
  user can update Supabase credentials, Teller configuration, and
  redeploy without stepping through the full wizard.
-->
<script lang="ts">
  import { getConfig, setConfig } from 'stellar-drive/config';
  import { isOnline } from 'stellar-drive/stores';
  import { pollForNewServiceWorker, monitorSwLifecycle } from 'stellar-drive/kit';
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  // ===========================================================================
  //  Form State
  // ===========================================================================

  let supabaseUrl = $state('');
  let supabasePublishableKey = $state('');
  let supabaseServiceRoleKey = $state('');

  let tellerAppId = $state('');
  let tellerCert = $state('');
  let tellerKey = $state('');
  let tellerWebhookSecret = $state('');
  let tellerEnvironment = 'development';

  let vercelToken = $state('');

  // Initial values for change detection
  let initialSupabaseUrl = $state('');
  let initialSupabaseKey = $state('');
  let initialServiceRoleKey = $state('');
  let initialTellerAppId = $state('');
  let initialTellerCert = $state('');
  let initialTellerKey = $state('');
  let initialTellerWebhookSecret = $state('');

  // ===========================================================================
  //  UI State
  // ===========================================================================

  let loading = $state(true);
  let validating = $state(false);
  let validateError = $state<string | null>(null);
  let validateSuccess = $state(false);
  let validatedUrl = $state('');
  let validatedKey = $state('');
  let deploying = $state(false);
  let deployError = $state<string | null>(null);
  let deployStage = $state<'idle' | 'setting-env' | 'deploying' | 'ready'>('idle');

  // ===========================================================================
  //  Derived State
  // ===========================================================================

  const supabaseChanged = $derived(
    supabaseUrl !== initialSupabaseUrl ||
      supabasePublishableKey !== initialSupabaseKey ||
      supabaseServiceRoleKey !== initialServiceRoleKey
  );

  const tellerChanged = $derived(
    tellerAppId !== initialTellerAppId ||
      tellerCert !== initialTellerCert ||
      tellerKey !== initialTellerKey ||
      tellerWebhookSecret !== initialTellerWebhookSecret
  );

  const anyChanged = $derived(supabaseChanged || tellerChanged);

  const credentialsChanged = $derived(
    validateSuccess && (supabaseUrl !== validatedUrl || supabasePublishableKey !== validatedKey)
  );

  const supabaseNeedsValidation = $derived(supabaseChanged && !validateSuccess);

  const canDeploy = $derived(
    anyChanged &&
      !supabaseNeedsValidation &&
      !credentialsChanged &&
      !!vercelToken &&
      !deploying &&
      deployStage === 'idle'
  );

  // ===========================================================================
  //  Effects
  // ===========================================================================

  $effect(() => {
    if (credentialsChanged) {
      validateSuccess = false;
      validateError = null;
    }
  });

  // ===========================================================================
  //  Lifecycle
  // ===========================================================================

  onMount(() => {
    if (!browser) return;

    const config = getConfig();
    if (config) {
      supabaseUrl = config.supabaseUrl || '';
      supabasePublishableKey = config.supabasePublishableKey || '';
      initialSupabaseUrl = supabaseUrl;
      initialSupabaseKey = supabasePublishableKey;
    }

    // Read public Teller config from runtime config (served by /api/config)
    const envAppId = config?.extra?.PUBLIC_TELLER_APP_ID;
    const envEnvironment = config?.extra?.PUBLIC_TELLER_ENVIRONMENT;

    if (envAppId) {
      tellerAppId = envAppId;
      initialTellerAppId = envAppId;
    }
    if (envEnvironment) {
      tellerEnvironment = envEnvironment;
    }

    // Server-only env vars (TELLER_CERT, TELLER_KEY, TELLER_WEBHOOK_SECRET)
    // are not readable on the client — initial values remain empty.

    loading = false;
  });

  // ===========================================================================
  //  Validation
  // ===========================================================================

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
        setConfig({ supabaseUrl, supabasePublishableKey, configured: true });
      } else {
        validateError = data.error || 'Validation failed';
      }
    } catch (e) {
      validateError = e instanceof Error ? e.message : 'Network error';
    }

    validating = false;
  }

  // ===========================================================================
  //  Deployment
  // ===========================================================================

  function pollForDeployment(): Promise<void> {
    return new Promise((resolve) => {
      let resolved = false;

      const done = () => {
        if (resolved) return;
        resolved = true;
        stopPoll();
        stopMonitor();
        deployStage = 'ready';
        resolve();
      };

      const stopMonitor = monitorSwLifecycle({ onUpdateAvailable: done });

      const stopPoll = pollForNewServiceWorker({
        intervalMs: 3000,
        maxAttempts: 200,
        onFound: done
      });

      if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
      }

      setTimeout(() => {
        if (!resolved) done();
      }, 180_000);
    });
  }

  async function handleDeploy() {
    deployError = null;
    deploying = true;
    deployStage = 'setting-env';

    try {
      const extraEnvVars: Record<string, string> = {
        PUBLIC_TELLER_APP_ID: tellerAppId,
        PUBLIC_TELLER_ENVIRONMENT: tellerEnvironment
      };

      if (tellerCert) extraEnvVars.TELLER_CERT = tellerCert;
      if (tellerKey) extraEnvVars.TELLER_KEY = tellerKey;
      if (tellerWebhookSecret) extraEnvVars.TELLER_WEBHOOK_SECRET = tellerWebhookSecret;
      if (supabaseServiceRoleKey) extraEnvVars.SUPABASE_SERVICE_ROLE_KEY = supabaseServiceRoleKey;

      const res = await fetch('/api/setup/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supabaseUrl,
          supabasePublishableKey,
          vercelToken,
          extraEnvVars
        })
      });

      const data = await res.json();

      if (data.success) {
        deployStage = 'deploying';
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

<div class="reconfigure-page">
  {#if loading}
    <div class="loading-state">
      <span class="loading-spinner"></span>
      Loading configuration...
    </div>
  {:else}
    <!-- Supabase Connection Card -->
    <section class="config-card">
      <div class="card-header">
        <h2>Supabase Connection</h2>
        {#if !supabaseChanged && initialSupabaseUrl}
          <span class="status-badge status-connected">Connected</span>
        {/if}
      </div>

      <p class="card-description">
        Find these values in your Supabase dashboard under <strong>Settings &gt; API</strong>.
      </p>

      <div class="form-group">
        <label for="reconfig-supabase-url">Supabase URL</label>
        <input
          id="reconfig-supabase-url"
          type="url"
          placeholder="https://your-project.supabase.co"
          bind:value={supabaseUrl}
          autocomplete="off"
          spellcheck="false"
        />
      </div>

      <div class="form-group">
        <label for="reconfig-supabase-key">Supabase Publishable Key</label>
        <input
          id="reconfig-supabase-key"
          type="text"
          placeholder="eyJhbGciOiJIUzI1NiIs..."
          bind:value={supabasePublishableKey}
          autocomplete="off"
          spellcheck="false"
        />
        <span class="input-hint"
          >This is your public (anon) key. Row-Level Security policies enforce access control.</span
        >
      </div>

      <div class="form-group">
        <label for="reconfig-supabase-service-role-key">Service Role Key (secret)</label>
        <input
          id="reconfig-supabase-service-role-key"
          type="password"
          placeholder="eyJhbGciOiJIUzI1NiIs..."
          bind:value={supabaseServiceRoleKey}
          autocomplete="off"
          spellcheck="false"
        />
        <span class="input-hint"
          >Found under Settings &gt; API &gt; service_role. Used by the server for bank data writes.
          Leave blank to keep existing value.</span
        >
      </div>

      <div class="message info">
        Server-side credentials (service role key) cannot be displayed for security. Leave blank to
        keep existing value.
      </div>

      <button
        class="btn btn-secondary"
        onclick={handleValidate}
        disabled={!supabaseUrl || !supabasePublishableKey || validating}
      >
        {#if validating}
          <span class="loading-spinner small"></span>
          Testing connection...
        {:else}
          Test Connection
        {/if}
      </button>

      {#if validateError}
        <div class="message error">{validateError}</div>
      {/if}
      {#if validateSuccess && !credentialsChanged}
        <div class="message success">Connection successful — credentials are valid.</div>
      {/if}
    </section>

    <!-- Teller Configuration Card -->
    <section class="config-card">
      <div class="card-header">
        <h2>Teller Configuration</h2>
        {#if !tellerChanged && initialTellerAppId}
          <span class="status-badge status-connected">Configured</span>
        {/if}
      </div>

      <p class="card-description">
        <a href="https://teller.io" target="_blank" rel="noopener noreferrer">Teller.io</a>
        connects to your bank accounts for real-time transaction data. Configure your Teller credentials
        to enable bank account linking.
      </p>

      <div class="form-group">
        <label for="reconfig-teller-app-id">Application ID</label>
        <input
          id="reconfig-teller-app-id"
          type="text"
          placeholder="app_xxxxxxxxxx"
          bind:value={tellerAppId}
          autocomplete="off"
          spellcheck="false"
        />
        <span class="input-hint">
          Find your Application ID in the
          <a href="https://teller.io/dashboard" target="_blank" rel="noopener noreferrer">
            Teller Dashboard</a
          >.
        </span>
      </div>

      <div class="form-group">
        <label for="reconfig-teller-cert">Client Certificate (PEM)</label>
        <textarea
          id="reconfig-teller-cert"
          rows="4"
          placeholder="-----BEGIN CERTIFICATE-----"
          bind:value={tellerCert}
          autocomplete="off"
          spellcheck="false"
        ></textarea>
        <span class="input-hint">
          Paste the full PEM content of your mTLS certificate from the Teller Dashboard.
        </span>
      </div>

      <div class="form-group">
        <label for="reconfig-teller-key">Private Key (PEM)</label>
        <textarea
          id="reconfig-teller-key"
          rows="4"
          placeholder="-----BEGIN PRIVATE KEY-----"
          bind:value={tellerKey}
          autocomplete="off"
          spellcheck="false"
        ></textarea>
        <span class="input-hint"> The private key corresponding to your client certificate. </span>
      </div>

      <div class="form-group">
        <label for="reconfig-teller-webhook">Webhook Signing Secret</label>
        <input
          id="reconfig-teller-webhook"
          type="password"
          placeholder="whsec_..."
          bind:value={tellerWebhookSecret}
          autocomplete="off"
          spellcheck="false"
        />
        <span class="input-hint"> Used to verify incoming webhook payloads from Teller. </span>
      </div>

      <div class="message info">
        Server-side credentials (certificate, key, webhook secret) cannot be displayed for security.
        Leave blank to keep existing values.
      </div>
    </section>

    <!-- Deploy Changes Card -->
    <section class="config-card">
      <div class="card-header">
        <h2>Deploy Changes</h2>
      </div>

      {#if !$isOnline}
        <div class="message error">
          You are currently offline. Deployment requires an internet connection.
        </div>
      {/if}

      <div class="form-group">
        <label for="reconfig-vercel-token">Vercel API Token</label>
        <input
          id="reconfig-vercel-token"
          type="password"
          placeholder="Paste your Vercel token"
          bind:value={vercelToken}
          autocomplete="off"
          disabled={deploying || deployStage !== 'idle'}
        />
        <span class="input-hint">
          Create a token at
          <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener noreferrer">
            vercel.com/account/tokens</a
          >. It is used once and never stored.
        </span>
      </div>

      {#if deployStage === 'idle'}
        <button class="btn btn-primary" onclick={handleDeploy} disabled={!canDeploy}>
          {#if deploying}
            <span class="loading-spinner small"></span>
            Deploying...
          {:else}
            Deploy Changes
          {/if}
        </button>
      {/if}

      {#if deployError}
        <div class="message error">{deployError}</div>
      {/if}

      {#if deployStage !== 'idle'}
        <div class="deploy-steps">
          <div
            class="deploy-step"
            class:active={deployStage === 'setting-env'}
            class:complete={deployStage === 'deploying' || deployStage === 'ready'}
          >
            <div class="deploy-step-indicator">
              {#if deployStage === 'setting-env'}
                <span class="loading-spinner small"></span>
              {:else}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              {/if}
            </div>
            <span>Setting environment variables...</span>
          </div>

          <div
            class="deploy-step"
            class:active={deployStage === 'deploying'}
            class:complete={deployStage === 'ready'}
          >
            <div class="deploy-step-indicator">
              {#if deployStage === 'deploying'}
                <span class="loading-spinner small"></span>
              {:else if deployStage === 'ready'}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              {:else}
                <div class="deploy-dot"></div>
              {/if}
            </div>
            <span>Deploying... (might take a bit)</span>
          </div>

          <div class="deploy-step" class:active={deployStage === 'ready'}>
            <div class="deploy-step-indicator">
              {#if deployStage === 'ready'}
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              {:else}
                <div class="deploy-dot"></div>
              {/if}
            </div>
            <span>Ready</span>
          </div>
        </div>

        {#if deployStage === 'ready'}
          <div class="message success">
            Your Radiant instance is configured and the new deployment is live. Use the notification
            at the bottom of the page to refresh and load the updated version.
          </div>
        {/if}
      {/if}
    </section>
  {/if}
</div>

<style>
  /* ===========================================================================
     Layout
     =========================================================================== */

  .reconfigure-page {
    max-width: 640px;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .loading-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    padding: 3rem;
    font-size: 0.9375rem;
    color: var(--color-text-muted, #8a7e68);
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  /* ===========================================================================
     Config Card
     =========================================================================== */

  .config-card {
    padding: 1.5rem;
    background: linear-gradient(165deg, rgba(14, 12, 8, 0.92) 0%, rgba(18, 14, 10, 0.88) 100%);
    border: 1px solid rgba(212, 160, 57, 0.25);
    border-radius: 16px;
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    box-shadow:
      0 16px 48px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(255, 255, 255, 0.03) inset;
    position: relative;
  }

  .config-card::before {
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

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .card-header h2 {
    margin: 0;
    font-size: 1.0625rem;
    font-weight: 700;
    color: var(--color-text, #f5efe0);
    font-family: var(--font-display, 'SF Pro Display', Georgia, serif);
  }

  .card-description {
    margin: 0 0 1rem;
    font-size: 0.875rem;
    color: var(--color-text-muted, #8a7e68);
    line-height: 1.6;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  .card-description strong {
    color: var(--color-text, #f5efe0);
    font-weight: 600;
  }

  .card-description a {
    color: var(--color-primary-light, #e8b94a);
    text-decoration: none;
    border-bottom: 1px solid rgba(232, 185, 74, 0.3);
    transition: all 0.2s;
  }

  .card-description a:hover {
    color: var(--color-primary, #d4a039);
    border-bottom-color: rgba(212, 160, 57, 0.6);
  }

  /* ===========================================================================
     Status Badges
     =========================================================================== */

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.2rem 0.5rem;
    font-size: 0.6875rem;
    font-weight: 600;
    border-radius: 4px;
    letter-spacing: 0.02em;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  .status-connected {
    background: rgba(38, 222, 129, 0.15);
    color: #26de81;
  }

  /* ===========================================================================
     Form Elements
     =========================================================================== */

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

  .input-hint {
    font-size: 0.75rem;
    color: var(--color-text-muted, #8a7e68);
    opacity: 0.7;
    line-height: 1.4;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  .input-hint a {
    color: var(--color-primary-light, #e8b94a);
    text-decoration: none;
    border-bottom: 1px solid rgba(232, 185, 74, 0.3);
    transition: all 0.2s;
  }

  .input-hint a:hover {
    color: var(--color-primary, #d4a039);
    border-bottom-color: rgba(212, 160, 57, 0.6);
  }

  /* ===========================================================================
     Messages
     =========================================================================== */

  .message {
    padding: 0.875rem 1rem;
    border-radius: 10px;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.5;
    margin-top: 0.75rem;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  .error {
    background: linear-gradient(
      135deg,
      rgba(255, 107, 107, 0.15) 0%,
      rgba(255, 107, 107, 0.05) 100%
    );
    color: #ff6b6b;
    border: 1px solid rgba(255, 107, 107, 0.3);
  }

  .success {
    background: linear-gradient(135deg, rgba(38, 222, 129, 0.15) 0%, rgba(38, 222, 129, 0.05) 100%);
    color: #26de81;
    border: 1px solid rgba(38, 222, 129, 0.3);
  }

  .info {
    background: linear-gradient(135deg, rgba(212, 160, 57, 0.1) 0%, rgba(212, 160, 57, 0.04) 100%);
    color: var(--color-text-muted, #8a7e68);
    border: 1px solid rgba(212, 160, 57, 0.2);
  }

  /* ===========================================================================
     Buttons
     =========================================================================== */

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
    box-shadow: 0 6px 24px rgba(212, 160, 57, 0.35);
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

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none !important;
    box-shadow: none !important;
  }

  /* ===========================================================================
     Loading Spinner
     =========================================================================== */

  .loading-spinner {
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }

  .loading-spinner.small {
    width: 14px;
    height: 14px;
    border-width: 2px;
  }

  .btn-secondary .loading-spinner {
    border-color: rgba(212, 160, 57, 0.3);
    border-top-color: var(--color-primary-light, #e8b94a);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* ===========================================================================
     Deploy Steps
     =========================================================================== */

  .deploy-steps {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .deploy-step {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.875rem;
    color: var(--color-text-muted, #8a7e68);
    opacity: 0.5;
    transition: all 0.3s;
    font-family: var(--font-body, 'SF Pro Text', system-ui, sans-serif);
  }

  .deploy-step.active {
    opacity: 1;
    color: var(--color-primary-light, #e8b94a);
  }

  .deploy-step.complete {
    opacity: 1;
    color: #26de81;
  }

  .deploy-step-indicator {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .deploy-dot {
    width: 8px;
    height: 8px;
    background: rgba(212, 160, 57, 0.3);
    border-radius: 50%;
  }

  /* ===========================================================================
     Responsive
     =========================================================================== */

  @media (max-width: 640px) {
    .config-card {
      padding: 1.25rem;
    }

    .form-group input,
    .form-group textarea {
      padding: 0.75rem 0.875rem;
      font-size: 16px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .loading-spinner {
      animation: none;
    }

    .btn {
      transition: none;
    }

    .deploy-step {
      transition: none;
    }
  }
</style>
