import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { assertFeature, planLimitResponse } from '@/lib/plans';
import { syncEtsyReviews, EtsyError } from '@/lib/etsy';

/** Manual "Sync now" from the Import page. */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    await assertFeature(storeId, 'platformImport');
    const result = await syncEtsyReviews(storeId);
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof EtsyError) return NextResponse.json({ error: error.merchantMessage }, { status: 502 });
    const limit = planLimitResponse(error);
    if (limit) return NextResponse.json(limit.body, { status: limit.status });
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[etsy/sync]', error);
    return NextResponse.json({ error: 'Etsy sync failed. Try again in a few minutes.' }, { status: 500 });
  }
}
