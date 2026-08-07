import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getStorePlan, PLANS } from '@/lib/plans';
import { buildProductReviewsFeed } from '@/lib/google-feed';

/**
 * Google Merchant Center product ratings feed.
 *
 * This is one of the few features with directly measurable merchant ROI: it puts star
 * ratings on Shopping listings, which lifts click-through. The research put it firmly in
 * the "competitive" tier and it is a genuine paid-plan justification.
 *
 * The route does authentication, entitlement and the query. The document itself is built
 * by `buildProductReviewsFeed`, which is a pure function so it can be tested — see
 * `tests/google-feed.test.ts`. Worth the separation because an invalid feed does not
 * throw: it is served with a 200, fetched by Google, and rejected in full, taking every
 * one of that merchant's star ratings with it.
 *
 * Served unauthenticated at a per-store token URL because Google's crawler fetches it on
 * a schedule with no ability to log in. The token is the access control.
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shop = searchParams.get('shop');
    const token = searchParams.get('token');

    if (!shop || !token) {
      return new NextResponse('shop and token are required', { status: 400 });
    }

    const store = await db.store.findUnique({
      where: { shopifyDomain: shop },
      select: { id: true, name: true, domain: true, shopifyDomain: true, isActive: true },
    });
    if (!store?.isActive) return new NextResponse('Not found', { status: 404 });

    const setting = await db.storeSetting.findUnique({
      where: { storeId_key: { storeId: store.id, key: 'google_feed_token' } },
    });
    // Constant-time-ish comparison is overkill for a feed token, but a plain mismatch must
    // return 404 rather than 403 so the endpoint does not confirm which stores exist.
    if (!setting?.value || setting.value !== token) {
      return new NextResponse('Not found', { status: 404 });
    }

    // Checked here as well as at issuance.
    //
    // The token route gates on `googleFeed`, so a Free store can never mint a URL — but
    // the token it minted on Growth kept working forever afterwards, because this
    // endpoint asked only whether the token matched. One month of Growth bought the
    // feature permanently. Entitlement has to be checked where the feature is used, not
    // only where it is granted; the same reasoning applies to every flag in `plans.ts`.
    //
    // 404 rather than 403, for the same reason as above and because Google's crawler
    // does nothing useful with either — the merchant sees a fetch error in Merchant
    // Center and the app tells them why.
    if (!PLANS[await getStorePlan(store.id)].googleFeed) {
      return new NextResponse('Not found', { status: 404 });
    }

    const reviews = await db.review.findMany({
      where: { storeId: store.id, isPublished: true, productId: { not: null } },
      orderBy: { reviewDate: 'desc' },
      take: 5000,
      select: {
        id: true,
        reviewerName: true,
        rating: true,
        title: true,
        body: true,
        reviewDate: true,
        isIncentivized: true,
        verificationStatus: true,
        product: { select: { shopifyId: true, handle: true, title: true } },
      },
    });

    const xml = buildProductReviewsFeed(store, reviews);

    return new NextResponse(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        // Google fetches daily at most; an hour of cache costs nothing and protects the
        // database from a crawler retry storm.
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('[feeds/google]', error);
    return new NextResponse('Feed generation failed', { status: 500 });
  }
}
