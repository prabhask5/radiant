/**
 * @fileoverview Vercel deploy endpoint.
 *
 * Delegates entirely to stellar-drive's `createDeployHandler()` which
 * deploys Supabase credentials to Vercel and includes built-in security
 * guards (already-configured check + CSRF origin validation).
 */

import { createDeployHandler } from 'stellar-drive/kit';
import type { RequestHandler } from './$types';

/** POST /api/setup/deploy — Deploy Supabase config to Vercel. */
export const POST: RequestHandler = createDeployHandler({ prefix: 'radiant' });
