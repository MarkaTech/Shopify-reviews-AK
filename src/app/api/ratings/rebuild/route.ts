import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { rebuildStoreRatings } from '@/lib/ratings';
import { db } from '@/lib/db';

/**
 * Rebuild every product aggregate for the store and push them to Shopify metafields.
 *
 * Needed in three situations, all of them real:
 *
 *  1. **Backfill.** A store that installed before aggregates existed has reviews but no
 *     ProductRating rows and no metafields, so themes and Google see nothing.
 *  2. **After a bulk import.** A CSV can add hundreds of reviews across many products;
 *     recomputing per row would be wasteful, so the import recomputes once and this
 *     covers anything it missed.
 *  3. **Repair.** If a metafield push failed — expired token, rate limit, transient 5xx —
 *     the local aggregate is right but Shopify's copy is stale. Rerunning fixes it.
 *
 * Sequential rather than parallel: Shopify's GraphQL API is cost-throttled, and firing a
 * large catalogue at it concurrently produces rate-limit failures that need their own
 * retry logic. Slower and correct beats faster and flaky.
 */
export async function POST(request: NextRequest) {
  try {
    const { storeId, shop, accessToken, onUnauthorized } = await withAuth(request);

    const result = await rebuildStoreRatings(storeId, { shop, accessToken, onUnauthorized });

    // Report how many products actually carry a rating, so the merchant can tell
    // "nothing to do" apart from "it silently failed".
    const withRatings = await db.productRating.count({
      where: { storeId, count: { gt: 0 } },
    });
    const unassigned = await db.review.count({
      where: { storeId, productId: null, isPublished: true },
    });

    return NextResponse.json({
      success: true,
      productsProcessed: result.products,
      failed: result.failed,
      productsWithRatings: withRatings,
      // Reviews not linked to a product cannot contribute to any product aggregate and
      // will never appear on a product page. Surfacing the count stops this being a
      // silent dead end — it is the most likely reason a merchant sees "0 stars"
      // immediately after a CSV import.
      unassignedReviews: unassigned,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[ratings/rebuild]', error);
    return NextResponse.json({ error: 'Failed to rebuild ratings' }, { status: 500 });
  }
}

/** Current sync state, for the admin UI. */
export async function GET(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);

    const [total, withRatings, failed, unassigned] = await Promise.all([
      db.productRating.count({ where: { storeId } }),
      db.productRating.count({ where: { storeId, count: { gt: 0 } } }),
      db.productRating.count({ where: { storeId, metafieldError: { not: null } } }),
      db.review.count({ where: { storeId, productId: null, isPublished: true } }),
    ]);

    return NextResponse.json({ total, withRatings, failed, unassignedReviews: unassigned });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    return NextResponse.json({ error: 'Failed to read rating status' }, { status: 500 });
  }
}
