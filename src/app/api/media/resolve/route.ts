import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { resolvePendingMedia } from '@/lib/media-resolve';

/**
 * Manual trigger for pending-media resolution. The Reviews list GET also runs this
 * automatically (fire-and-forget) whenever the store has pending rows, so this endpoint
 * is a fallback rather than the mechanism.
 */
export async function POST(request: NextRequest) {
  try {
    const { storeId, shop, accessToken, onUnauthorized } = await withAuth(request);
    const result = await resolvePendingMedia(storeId, shop, accessToken, onUnauthorized);
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[media/resolve]', error);
    return NextResponse.json({ error: 'Failed to resolve media' }, { status: 500 });
  }
}
