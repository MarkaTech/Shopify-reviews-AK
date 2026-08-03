import { NextRequest, NextResponse } from 'next/server';
import { sweepDueRequests } from '@/lib/request-sender';

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
    const counts = await sweepDueRequests(200);
    console.log('[cron/review-requests]', JSON.stringify(counts));
    return NextResponse.json({ ok: true, ...counts });
  } catch (error) {
    console.error('[cron/review-requests] failed:', error);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
