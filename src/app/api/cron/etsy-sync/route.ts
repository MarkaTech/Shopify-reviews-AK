import { NextRequest, NextResponse } from 'next/server';
import { storesDueEtsySync, syncEtsyReviews } from '@/lib/etsy';
import { recordJobRun } from '@/lib/job-run';

/**
 * Weekly background resync for every connected store — the parity feature with
 * Judge.me's 7-day Etsy sync. Runs daily; only stores whose last sync is older than
 * ~7 days actually do work, so a failure one day self-heals the next.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error('[cron/etsy-sync] CRON_SECRET is not set; refusing to run');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }
  if (request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { due, results } = await recordJobRun(
    'etsy-sync',
    async () => {
      const dueStores = await storesDueEtsySync();
      const out: Array<{ storeId: string; ok: boolean; imported?: number; error?: string }> = [];
      for (const storeId of dueStores) {
        try {
          const r = await syncEtsyReviews(storeId);
          out.push({ storeId, ok: true, imported: r.imported });
        } catch (error) {
          // One store's revoked token must not stop the rest of the fleet syncing.
          out.push({ storeId, ok: false, error: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
        }
      }
      return { due: dueStores, results: out };
    },
    { summarise: (r) => ({ due: r.due.length, synced: r.results.filter((x) => x.ok).length, failed: r.results.filter((x) => !x.ok).length }) }
  );
  console.log('[cron/etsy-sync]', JSON.stringify({ due: due.length, results }));
  return NextResponse.json({ ok: true, due: due.length, results });
}
