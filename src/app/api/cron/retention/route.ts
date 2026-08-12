import { NextRequest, NextResponse } from 'next/server';
import { runRetention } from '@/lib/retention';
import { recordJobRun } from '@/lib/job-run';

/**
 * Scheduled enforcement of the retention policy.
 *
 * Same shape and same shared secret as the weekly summary: header rather than query string,
 * because a URL carrying the secret ends up in access logs and referrers, and this endpoint
 * deletes data.
 *
 * Refuses outright when CRON_SECRET is unset. A retention job that silently never runs is
 * the failure mode that matters here — the data quietly accumulates and the answer given to
 * Shopify stops being true — so it is better for the call to fail visibly.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error('[cron/retention] CRON_SECRET is not set; refusing to run');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  if (request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await recordJobRun('retention', () => runRetention());
    // Logged as well as returned, so the run leaves a trace even when nobody reads the
    // response. This log is the evidence that the policy is actually enforced.
    console.log('[cron/retention]', JSON.stringify(result));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[cron/retention] failed:', error);
    return NextResponse.json({ error: 'Retention run failed' }, { status: 500 });
  }
}
