import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { syncProducts } from '@/lib/product-sync';

/**
 * Manual catalogue sync.
 *
 * The install path already runs this once, so in normal operation this button is a
 * recovery action: the merchant added products elsewhere, or the initial sync failed and
 * they want to try again.
 *
 * There is no sample-data fallback here, and there must never be one again. The previous
 * version caught every error from the Shopify call and inserted a hardcoded catalogue of
 * ten invented products — leather bags, matcha powder, stock photography — into whatever
 * store had just failed to sync. A single throttled GraphQL response on a real merchant's
 * first click left them with permanent inventory they had never sold, and no delete
 * endpoint existed to remove it. A sync that cannot reach Shopify must say so and stop.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const { storeId, shop, accessToken, onUnauthorized } = await withAuth(request);

    const result = await syncProducts(storeId, shop, accessToken, onUnauthorized);

    return NextResponse.json({
      synced: result.created,
      alreadyPresent: result.alreadyPresent,
      total: result.fetched,
      truncated: result.truncated,
      source: 'shopify',
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();

    // 502 rather than 500: the failure is upstream, and the distinction matters to whoever
    // reads the logs at 2am. The merchant-facing message says what to do about it.
    console.error('[products/sync] failed:', error);
    return NextResponse.json(
      {
        error:
          'Could not reach Shopify to sync your products. This is usually temporary — ' +
          'wait a moment and try again. If it keeps happening, reinstalling the app ' +
          'refreshes the connection.',
      },
      { status: 502 }
    );
  }
}
