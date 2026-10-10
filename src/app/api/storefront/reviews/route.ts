import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { getProductRating } from '@/lib/ratings';
import { buildProductStructuredData } from '@/lib/structured-data';
import { getStorefrontConfig } from '@/lib/storefront-config';
import { getStorePlan, PLANS } from '@/lib/plans';
import { describeActiveIncentive } from '@/lib/incentives';
import {
  clampHighlightLimit,
  parseHighlightSource,
  parseOffset,
  pickHighlights,
  RANDOM_POOL,
} from '@/lib/storefront-reviews';

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
 *
 * Two modes. The default is a page of the review list. `highlights=1` is the "Review
 * highlights" box beside Add to cart: a handful of reviews chosen by pickHighlights, in
 * the same public shape as the list's, under the same three rules.
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
    // "See more" asks for the rows after the ones on screen by position, which a page
    // number cannot express once the step (10) differs from the first page (5). When an
    // offset is sent it wins over the page, and the reply echoes it: the widget reads a
    // reply without `offset` as a server that only pages by number.
    const offset = parseOffset(searchParams.get('offset'));
    // Floored: a fractional take reaches Prisma as a validation error, which was a 500.
    const requestedLimit = Math.floor(Number(searchParams.get('limit')));
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

    if (searchParams.get('highlights') === '1') {
      return await highlightsResponse(searchParams, store.id, shopifyProductId, config);
    }

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
        {
          reviews: [], total: 0, aggregate: { average: 0, count: 0, distribution: {} }, config,
          ...(offset === null ? {} : { offset }),
        },
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

    // Every branch ends in a unique tiebreaker. Ordering by rating alone leaves 100 five-
    // star reviews in database-chosen order, which Postgres does not promise to keep stable
    // between queries — so page 2 could repeat rows from page 1 and skip others entirely.
    const tail = [{ reviewDate: 'desc' as const }, { id: 'desc' as const }];
    const orderBy =
      sort === 'highest'
        ? [{ isPinned: 'desc' as const }, { rating: 'desc' as const }, ...tail]
        : sort === 'lowest'
        ? [{ isPinned: 'desc' as const }, { rating: 'asc' as const }, ...tail]
        : sort === 'helpful'
        ? [{ isPinned: 'desc' as const }, { helpfulCount: 'desc' as const }, ...tail]
        : [{ isPinned: 'desc' as const }, ...tail];

    const [rows, total] = await Promise.all([
      db.review.findMany({
        where,
        orderBy,
        skip: offset ?? (page - 1) * limit,
        take: limit,
        select: PUBLIC_REVIEW_SELECT,
      }),
      db.review.count({ where }),
    ]);

    const aggregate = product
      ? await getProductRating(product.id)
      : { average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };

    const reviews = rows.map(toPublicReview);

    const structuredData =
      product && aggregate.count > 0
        ? buildProductStructuredData({
            productName: product.title,
            productImage: product.image,
            // One decimal, rounded half-up here. The stored average now carries two, and
            // the formatter's toFixed(1) reads a stored 4.85 as the binary fraction just
            // below it and writes 4.8, where the same product used to say 4.9.
            average: Math.round(aggregate.average * 10) / 10,
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

    // The incentive offer, plan-gated exactly as grantIncentive is, so a downgraded store
    // never advertises a reward it will not pay. describeActiveIncentive had no caller at
    // all: merchants configured an offer and no shopper was ever told about it, which is the
    // half of an incentive that produces the reviews.
    const offer = PLANS[await getStorePlan(store.id)].incentives
      ? await describeActiveIncentive(store.id)
      : null;

    // `offset` only when one was used, so a reply to an ordinary page request is exactly
    // what it was. `page` then names the page the first row falls on.
    const paging =
      offset === null
        ? { page, limit }
        : { page: Math.floor(offset / limit) + 1, limit, offset };

    return NextResponse.json(
      { reviews, total, ...paging, aggregate, structuredData, config, offer },
      { headers: { ...CORS, 'Cache-Control': CACHE } }
    );
  } catch (error) {
    console.error('[storefront/reviews]', error);
    return NextResponse.json({ error: 'Failed to load reviews' }, { status: 500, headers: CORS });
  }
}

/**
 * The review fields a shopper may see, and the only ones either mode reads for display.
 *
 * Deliberately NOT selected: reviewerEmail, shopifyOrderId, customFields, syncError. None
 * of it belongs on a public page.
 */
const PUBLIC_REVIEW_SELECT = {
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
} satisfies Prisma.ReviewSelect;

type PublicReviewRow = Prisma.ReviewGetPayload<{ select: typeof PUBLIC_REVIEW_SELECT }>;

/** One review as the storefront receives it, in the list and in the highlights box alike. */
function toPublicReview(r: PublicReviewRow) {
  return {
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
  };
}

/**
 * What the highlights rules read on top of the public fields: productId and the product's
 * title for productTitle, isFeatured and isPublished for pickHighlights. None of it is
 * sent as it is.
 */
const HIGHLIGHT_SELECT = {
  ...PUBLIC_REVIEW_SELECT,
  productId: true,
  isFeatured: true,
  isPublished: true,
  product: { select: { title: true } },
} satisfies Prisma.ReviewSelect;

type HighlightRow = Prisma.ReviewGetPayload<{ select: typeof HIGHLIGHT_SELECT }>;

/**
 * Rows read per pool. Every query below is bounded, so a store with fifty thousand
 * reviews costs the same as one with fifty.
 *
 * Featured reviews are hand-picked and few; twice the box's largest size leaves room for
 * any with no text to quote. The quotable pools read the newest 4-5 star reviews and keep
 * those with enough text, which the database cannot filter by length; twice the random
 * pool covers a store where half its recent reviews are one-liners.
 */
const FEATURED_TAKE = 24;
const QUOTABLE_TAKE = RANDOM_POOL * 2;

/**
 * The `highlights=1` mode: { highlights, total, config }.
 *
 * Reads in priority order and stops as soon as the box is full, so the common case (a
 * product with enough of its own) is one or two small queries. Each step re-runs
 * pickHighlights over everything read so far; the rules live there, not in these queries.
 *
 * `total` is the number of highlights returned. The box shows no "of N", and counting the
 * product's reviews for it would be a query on every product page for a number nobody sees.
 */
async function highlightsResponse(
  searchParams: URLSearchParams,
  storeId: string,
  shopifyProductId: string | null,
  config: Awaited<ReturnType<typeof getStorefrontConfig>>
) {
  const source = parseHighlightSource(searchParams.get('source'));
  const limit = clampHighlightLimit(searchParams.get('limit'));

  // A product not synced yet has no reviews of its own, but the box is still on its page,
  // so the store's reviews it shows must each be nameable.
  const product = shopifyProductId
    ? await db.product.findUnique({
        where: { storeId_shopifyId: { storeId, shopifyId: shopifyProductId } },
        select: { id: true },
      })
    : null;
  const productPage = Boolean(shopifyProductId);

  const live: Prisma.ReviewWhereInput = { storeId, isPublished: true };
  const own: Prisma.ReviewWhereInput | null = product ? { productId: product.id } : null;
  // The rest of the store. On a product page, only reviews that belong to some product:
  // see pickHighlights for why one with none is left out there.
  const elsewhere: Prisma.ReviewWhereInput = product
    ? { productId: { not: null }, NOT: { productId: product.id } }
    : productPage
      ? { productId: { not: null } }
      : {};
  const featured: Prisma.ReviewWhereInput = { isFeatured: true };
  const quotable: Prisma.ReviewWhereInput = { rating: { gte: 4 } };

  const steps: Array<{ where: Prisma.ReviewWhereInput; take: number }> = [];
  if (source === 'featured') {
    if (own) steps.push({ where: { ...live, ...featured, ...own }, take: FEATURED_TAKE });
    steps.push({ where: { ...live, ...featured, ...elsewhere }, take: FEATURED_TAKE });
  }
  if (own) steps.push({ where: { ...live, ...quotable, ...own }, take: QUOTABLE_TAKE });
  steps.push({ where: { ...live, ...quotable, ...elsewhere }, take: QUOTABLE_TAKE });

  const read: HighlightRow[] = [];
  let picked: HighlightRow[] = [];
  for (const step of steps) {
    read.push(
      ...(await db.review.findMany({
        where: step.where,
        orderBy: [{ reviewDate: 'desc' }, { id: 'desc' }],
        take: step.take,
        select: HIGHLIGHT_SELECT,
      }))
    );
    picked = pickHighlights(read, {
      source,
      limit,
      productId: product?.id ?? null,
      productPage,
      random: Math.random,
    });
    if (picked.length >= limit) break;
  }

  const highlights = picked.map((r) => ({
    ...toPublicReview(r),
    // The product a store-wide review is about, so the box can say "on <product>" rather
    // than let it pass as a review of the one on this page. Null for this product's own.
    // Product titles are public; nothing else about the product is sent.
    productTitle: r.productId && r.productId !== product?.id ? (r.product?.title ?? null) : null,
  }));

  return NextResponse.json(
    { highlights, total: highlights.length, config },
    { headers: { ...CORS, 'Cache-Control': CACHE } }
  );
}

function safeParseUrls(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((u) => typeof u === 'string') : [];
  } catch {
    return [];
  }
}
