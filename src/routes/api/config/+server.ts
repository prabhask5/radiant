/**
 * @fileoverview Config API endpoint.
 *
 * Delegates entirely to stellar-drive's `createConfigHandler()` which
 * reads Supabase env vars and returns them with security headers
 * (Cache-Control, X-Content-Type-Options).
 */

import { createConfigHandler } from 'stellar-drive/kit';
import type { RequestHandler } from './$types';

/** GET /api/config — Retrieve the current Supabase configuration. */
export const GET: RequestHandler = createConfigHandler();
