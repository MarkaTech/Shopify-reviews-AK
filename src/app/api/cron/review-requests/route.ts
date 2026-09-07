import { NextRequest, NextResponse } from 'next/server';
import { sweepDueRequests } from '@/lib/request-sender';
import { reconcileSomeStores } from '@/lib/webhook-health';
import { recordJobRun } from '@/lib/job-run';

/**
 * Hourly sweep of due review-request emails (initial sends and reminders).
 *
 * Same authentication posture as the other cron routes: shared secret in a header, and a
 * hard refusal when it is unset — a mass-mail trigger that defaults open is the worst
 * possible failure here.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error('[cron/review-requests] CRON_SECRET is not set; refusing to run');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }
  if (request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const counts = await recordJobRun('review-requests', () => sweepDueRequests(200));
    console.log('[cron/review-requests]', JSON.stringify(counts));

    // Verify a slice of stores' webhook subscriptions against Shopify while we are here.
    //
    // The local `webhooks.registeredAt` marker proves registration once succeeded; it cannot
    // see a subscription deleted from Shopify's side afterwards, and the symptom of that is
    // identical to never having registered — orders/fulfilled stops arriving and no review
    // invitation is ever created again, silently. Nothing in the app asked Shopify the
    // question until now.
    //
    // Deliberately a few stores per run, oldest-checked first: it is one extra Admin API
    // call per store, this job runs hourly, and the condition it catches is rare. Every
    // store gets checked within a day or so without adding a burst of API traffic.
    const repaired = await recordJobRun('webhooks:reconcile', () => reconcileSomeStores(5))
      .catch((err) => {
        // Never allowed to fail the sweep — the invitations are the job, this is the extra.
        console.error('[cron/review-requests] webhook reconciliation failed:', err);
        return null;
      });

    return NextResponse.json({ ok: true, ...counts, webhooks: repaired });
  } catch (error) {
    console.error('[cron/review-requests] failed:', error);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
