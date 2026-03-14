/**
 * @fileoverview Teller API type definitions — mirrors the Teller REST API schemas.
 *
 * These types represent the raw JSON responses from the Teller API.
 * They are used by the server-side Teller client and API route handlers.
 *
 * @see https://teller.io/docs/api
 */

/* ═══════════════════════════════════════════════════════════════════════════
   ACCOUNTS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface TellerAccount {
  id: string;
  enrollment_id: string;
  name: string;
  type: 'depository' | 'credit';
  subtype:
    | 'checking'
    | 'savings'
    | 'money_market'
    | 'certificate_of_deposit'
    | 'treasury'
    | 'sweep'
    | 'credit_card';
  currency: string;
  last_four: string | null;
  status: 'open' | 'closed';
  institution: {
    id: string;
    name: string;
  };
  links: {
    self: string;
    details: string;
    balances: string;
    transactions: string;
  };
}

export interface TellerAccountBalances {
  account_id: string;
  ledger: string | null;
  available: string | null;
  links: {
    self: string;
    account: string;
  };
}

export interface TellerAccountDetails {
  account_id: string;
  account_number: string;
  routing_numbers: {
    ach: string | null;
    wire: string | null;
  };
  links: {
    self: string;
    account: string;
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRANSACTIONS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface TellerTransaction {
  id: string;
  account_id: string;
  amount: string;
  date: string;
  description: string;
  status: 'posted' | 'pending';
  type: string;
  running_balance: string | null;
  details: {
    processing_status: 'pending' | 'complete';
    category: string | null;
    counterparty: {
      name: string | null;
      type: 'organization' | 'person' | null;
    };
  };
  links: {
    self: string;
    account: string;
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   IDENTITY
   ═══════════════════════════════════════════════════════════════════════════ */

export interface TellerIdentity {
  id: string;
  full_name: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  email: string | null;
  phone: string | null;
  ssn: string | null;
  address: {
    street: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    country: string | null;
  } | null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   WEBHOOKS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface TellerWebhook {
  id: string;
  type:
    | 'enrollment.disconnected'
    | 'transactions.processed'
    | 'account.number_verification.processed'
    | 'webhook.test';
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface TellerEnrollmentDisconnectedPayload {
  enrollment_id: string;
  reason:
    | 'account_locked'
    | 'credentials_invalid'
    | 'mfa_required'
    | 'enrollment_inactive'
    | 'user_action_required';
}

/* ═══════════════════════════════════════════════════════════════════════════
   TELLER CONNECT — Frontend enrollment widget
   ═══════════════════════════════════════════════════════════════════════════ */

export interface TellerConnectConfig {
  applicationId: string;
  products: Array<'verify' | 'balance' | 'transactions' | 'identity'>;
  environment: 'sandbox' | 'development' | 'production';
  onSuccess: (enrollment: TellerConnectEnrollment) => void;
  onInit?: () => void;
  onExit?: () => void;
  onFailure?: (error: { type: string; code: string; message: string }) => void;
  selectAccount?: 'disabled' | 'single' | 'multiple';
  enrollmentId?: string;
  nonce?: string;
}

export interface TellerConnectEnrollment {
  accessToken: string;
  user: {
    id: string;
  };
  enrollment: {
    id: string;
    institution: {
      name: string;
    };
  };
  signatures: string[] | null;
}

/** Global TellerConnect object injected by the Teller Connect SDK script */
export interface TellerConnectInstance {
  open: () => void;
  destroy: () => void;
}

export interface TellerConnectStatic {
  setup: (config: TellerConnectConfig) => TellerConnectInstance;
}
