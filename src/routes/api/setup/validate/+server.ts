/**
 * Supabase Credential Validation Endpoint — `POST /api/setup/validate`
 *
 * Accepts a Supabase URL and publishable key, attempts a lightweight query
 * against the project, and returns whether the credentials are valid.
 * Used by the setup wizard before saving config.
 */

import { createValidateHandler } from 'stellar-drive/kit';
import type { RequestHandler } from './$types';

/** Validate Supabase credentials — delegates to stellar-drive's handler factory. */
export const POST: RequestHandler = createValidateHandler();
