import { json } from '@sveltejs/kit';
import { deleteEnrollment, TellerApiError } from '$lib/teller/client';
import type { RequestHandler } from './$types';

/**
 * DELETE /api/teller/enrollment
 * Revokes a Teller enrollment, stopping future webhook events for it.
 * Body: { accessToken: string, enrollmentId: string }
 */
export const DELETE: RequestHandler = async ({ request }) => {
  try {
    const { accessToken, enrollmentId } = await request.json();

    if (!accessToken || !enrollmentId) {
      return json({ error: 'Missing accessToken or enrollmentId' }, { status: 400 });
    }

    await deleteEnrollment(accessToken, enrollmentId);
    return json({ deleted: true });
  } catch (err) {
    if (err instanceof TellerApiError && err.status === 404) {
      // Already deleted on Teller's side — treat as success
      return json({ deleted: true });
    }
    console.error(
      `[TELLER] Failed to delete enrollment: ${err instanceof Error ? err.message : 'unknown'}`
    );
    return json({ error: 'Failed to delete enrollment' }, { status: 500 });
  }
};
