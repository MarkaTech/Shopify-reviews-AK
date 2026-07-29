import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getProductRating } from '@/lib/ratings';
import { buildProductStructuredData } from '@/lib/structured-data';
import { getStorefrontConfig } from '@/lib/storefront-config';

/**
 * Public storefront read API.
 *
 * This is what the theme app extension calls from a shopper's browser. Three properties
 * that are not optional:
 *
 *  1. **No authentication.** It runs on a shopper's browser on the merchant's domain.
 *     Only published reviews are ever returned, and only fields safe to render publicly —
 *     never reviewer email, never internal ids beyond the review id used for voting.
 *
 *  2. **CORS open.** The request originates from the merchant's storefront domain, which
 *     differs per merchant and includes custom domains, so an allowlist is impractical.
 *     Safe because the endpoint is read-only and exposes nothing private.
 *
 *  3. **Cached hard.** Storefront widgets sit on product pages, which is exactly where
 *     Shopify's Lighthouse scoring is weighted (83% of the storefront score comes from
 *     product and collection pages). `s-maxage` plus `stale-while-revalidate` keeps this
 *     off the critical path — the shopper gets an edge-cached response and a stale one
 *     while it refreshes rather than waiting on our database.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// 5 minutes fresh, 1 hour stale-while-revalidate. A review appearing up to five minutes
// late is invisible to shoppers; a slow product page is not.
const CACHE = 'public, s-maxage=300, stale-while-revalidate=3600';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shop = searchParams.get('shop');
    const shopifyProductId = searchParams.get('product_id');

    if (!shop) {
      return NextResponse.json({ error: 'shop is required' }, { status: 400, headers: CORS });
    }

    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const requestedLimit = Number(searchParams.get('limit'));
    const sortParam = searchParams.get('sort');
    // Where the block sits, so the merchant's widget for that placement is the one that
    // applies. Passed through even when null: a merchant with a single widget and no
    // placement set still expects to see it.
    const placement = searchParams.get('placement');
    const ratingFilter = Number(searchParams.get('rating')) || null;
    const mediaOnly = searchParams.get('media') === '1';

    const store = await db.store.findUnique({
      where: { shopifyDomain: shop },
      select: { id: true, isActive: true },
    });
    if (!store || !store.isActive) {
      return NextResponse.json({ error: 'Unknown store' }, { status: 404, headers: CORS });
    }

    // The merchant's layout, colours and copy ride along with the reviews. A separate
    // config request would be a second round trip on the most performance-sensitive page
    // in the store, for data that is a couple of kilobytes.
    const config = await getStorefrontConfig(store.id, placement);

    // The merchant's configured page size wins over the theme block's, because the theme
    // block's value is frozen at whatever the default was when it was added — which is
    // exactly why an old block kept showing ten per page after the default moved to five.
    // An explicit ?limit= from the widget still wins over both, so paging works.
    const limit = Math.min(
      50,
      Math.max(1, requestedLimit || config.behaviour.perPage || 10)
    );
    const sort = sortParam || config.behaviour.defaultSort || 'recent';

    const product = shopifyProductId
      ? await db.product.findUnique({
          where: { storeId_shopifyId: { storeId: store.id, shopifyId: shopifyProductId } },
          select: { id: true, title: true, image: true, handle: true },
        })
      : null;

    if (shopifyProductId && !product) {
      // Product not synced yet — an empty result, not an error. A widget on a brand new
      // product should render "no reviews", not a failure state.
      return NextResponse.json(
        { reviews: [], total: 0, aggregate: { average: 0, count: 0, distribution: {} }, config },
        { headers: { ...CORS, 'Cache-Control': CACHE } }
      );
    }

    const where = {
      storeId: store.id,
      isPublished: true,
      ...(product ? { productId: product.id } : {}),
      ...(ratingFilter ? { rating: ratingFilter } : {}),
      ...(mediaOnly ? { NOT: { images: null } } : {}),
    };

    const orderBy =
      sort === 'highest'
        ? [{ isPinned: 'desc' as const }, { rating: 'desc' as const }]
        : sort === 'lowest'
        ? [{ isPinned: 'desc' as const }, { rating: 'asc' as const }]
        : sort === 'helpful'
        ? [{ isPinned: 'desc' as const }, { helpfulCount: 'desc' as const }]
        : [{ isPinned: 'desc' as const }, { reviewDate: 'desc' as const }];

    const [rows, total] = await Promise.all([
      db.review.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          reviewerName: true,
          reviewerLocation: true,
          rating: true,
          title: true,
          body: true,
          images: true,
          videoUrl: true,
          reviewDate: true,
          verificationStatus: true,
          verifiedPurchase: true,
          isIncentivized: true,
          helpfulCount: true,
          reply: true,
          repliedAt: true,
          source: true,
          // Deliberately NOT selected: reviewerEmail, shopifyOrderId, customFields,
          // syncError. None of it belongs on a public page.
        },
      }),
      db.review.count({ where }),
    ]);

    const aggregate = product
      ? await getProductRating(product.id)
      : { average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };

    const reviews = rows.map((r) => ({
      id: r.id,
      author: r.reviewerName,
      location: r.reviewerLocation,
      rating: r.rating,
      title: r.title,
      body: r.body,
      images: r.images ? safeParseUrls(r.images) : [],
      video: r.videoUrl,
      date: r.reviewDate.toISOString(),
      // Only 'verified_buyer' earns the badge. Displaying "Verified Purchase" for a
      // review with no matching order is exactly the misrepresentation the FTC rule
      // targets, so the badge is driven by the strict status, not the legacy boolean.
      verified: r.verificationStatus === 'verified_buyer',
      verificationStatus: r.verificationStatus,
      // FTC 16 CFR 465.4 requires incentivised reviews to be disclosed to the shopper.
      // The flag travels with the review so the widget cannot forget to render it.
      incentivized: r.isIncentivized,
      helpful: r.helpfulCount,
      reply: r.reply,
      repliedAt: r.repliedAt?.toISOString() ?? null,
      source: r.source,
    }));

    const structuredData =
      product && aggregate.count > 0
        ? buildProductStructuredData({
            productName: product.title,
            productImage: product.image,
            average: aggregate.average,
            count: aggregate.count,
            // Only mark up reviews this response actually returns — structured data must
            // describe visible content or it is a spam violation.
            reviews: rows.slice(0, 10).map((r) => ({
              reviewerName: r.reviewerName,
              rating: r.rating,
              title: r.title,
              body: r.body,
              reviewDate: r.reviewDate,
            })),
          })
        : null;

    return NextResponse.json(
      { reviews, total, page, limit, aggregate, structuredData, config },
      { headers: { ...CORS, 'Cache-Control': CACHE } }
    );
  } catch (error) {
    console.error('[storefront/reviews]', error);
    return NextResponse.json({ error: 'Failed to load reviews' }, { status: 500, headers: CORS });
  }
}

function safeParseUrls(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((u) => typeof u === 'string') : [];
  } catch {
    return [];
  }
}
