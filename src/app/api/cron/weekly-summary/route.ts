import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sendWeeklySummary } from '@/lib/notifications';

/**
 * Weekly digest fan-out.
 *
 * Called by a scheduler, not by a browser. Azure Web Apps has no built-in cron, so this is
 * driven externally — a GitHub Actions schedule, an Azure Logic App, or any uptime pinger
 * that can set a header.
 *
 * Auth is a shared secret in a header rather than a query string: a URL with the secret in
 * it ends up in access logs, referrers and browser history, and this endpoint can email
 * every merchant on the platform.
 *
 * With CRON_SECRET unset the endpoint refuses outright rather than defaulting open. An
 * unauthenticated mass-mail trigger is a worse failure than a digest that does not send.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error('[cron/weekly-summary] CRON_SECRET is not set; refusing to run');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  const provided = request.headers.get('x-cron-secret');
  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const since = new Date(Date.now() - 7 * 86400_000);

  // Only stores that switched the digest on. Selecting every active store and filtering in
  // memory would work today and stop working at scale; the settings table already knows.
  const optedIn = await db.storeSetting.findMany({
    where: { key: 'notify.weeklySummary', value: 'true' },
    select: { storeId: true },
  });

  const results = { considered: optedIn.length, sent: 0, skipped: 0, failed: 0 };

  for (const { storeId } of optedIn) {
    const store = await db.store.findUnique({
      where: { id: storeId },
      select: { isActive: true },
    });
    if (!store?.isActive) {
      results.skipped++;
      continue;
    }

    const result = await sendWeeklySummary(storeId, since);
    if (result.sent) results.sent++;
    else if (result.reason === 'failed') results.failed++;
    else results.skipped++;
  }

  console.log('[cron/weekly-summary]', results);
  return NextResponse.json({ success: true, ...results });
}
