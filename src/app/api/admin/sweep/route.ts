import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';

/**
 * Run the review-request sweep on demand.
 *
 * The hourly cron is the normal path. This is for the moment after you have just fixed
 * the cause of a backlog — a rotated provider key, a resolved outage — and want the queue
 * drained now rather than at the top of the hour.
 *
 * It calls the sweep function directly rather than reaching for the cron HTTP endpoint,
 * so CRON_SECRET is neither needed nor handled here. The admin cookie is the authority.
 */
export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { sweepDueRequests } = await import('@/lib/request-sender');
    const counts = await sweepDueRequests();
    console.warn('[admin] review-request sweep run on demand by operator', counts);
    return NextResponse.json({ ok: true, counts });
  } catch (error) {
    console.error('[admin] on-demand sweep failed', error);
    return NextResponse.json({ error: 'Sweep failed — check the server logs' }, { status: 500 });
  }
}
