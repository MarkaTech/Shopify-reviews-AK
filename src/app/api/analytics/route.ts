import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { getStorePlan } from '@/lib/plans';

/**
 * Dashboard analytics.
 *
 * This route used to do `db.review.findMany({ where: { storeId } })` — every review the
 * store had ever collected, every column, on every dashboard load — and then count them
 * up in JavaScript. It also loaded every rating of every product to find the top five.
 *
 * At a hundred reviews that is invisible. At fifty thousand it is tens of megabytes of
 * review text crossing the wire and being churned through on each page view, per merchant,
 * concurrently. It degrades gradually and then fails suddenly, and the store it fails for
 * first is the largest one — the reference customer.
 *
 * Everything below is now answered by the database with aggregate queries, which return a
 * handful of rows regardless of store size. Two deliberate exceptions:
 *
 *   - **The 30-day trend** reads one column for one bounded window. Bucketing by day in
 *     SQL means either a raw query per dialect or a date-truncation extension; reading
 *     ~30 days of a single timestamp column is cheap, portable and obviously correct.
 *   - **Top products** groups reviews by product first and only then fetches the five
 *     product rows it needs, rather than fetching every product and its ratings.
 *
 * The response shape is unchanged. The dashboard did not need to know.
 */
export async function GET(request: Request) {
  try {
    const { storeId } = await withAuth(request);

    // The 30-day window, in UTC.
    //
    // Getting this consistent matters more than which basis is chosen. An earlier pass
    // set the window boundary at LOCAL midnight and then bucketed rows by their UTC date
    // string — so for any server not running on UTC the first and last buckets were
    // wrong, and rows near a boundary landed in a bucket the axis never rendered.
    //
    // UTC throughout, and calendar days rather than the previous rolling 24-hour windows
    // anchored to whenever the request happened to arrive. Two merchants loading the
    // dashboard an hour apart now see the same chart, and no bucket can be skipped by a
    // daylight-saving transition, because UTC has none.
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const since = new Date(todayUtc);
    since.setUTCDate(since.getUTCDate() - 29);

    const [
      totalReviews,
      publishedReviews,
      pendingReviews,
      ratingGroups,
      sourceGroups,
      verifiedCount,
      repliedCount,
      featuredCount,
      reviewsWithImages,
      ratingAgg,
      productGroups,
      recentReviews,
      trendRows,
      plan,
    ] = await Promise.all([
      db.review.count({ where: { storeId } }),
      db.review.count({ where: { storeId, isPublished: true } }),
      db.review.count({ where: { storeId, isPublished: false } }),

      db.review.groupBy({ by: ['rating'], where: { storeId }, _count: { _all: true } }),
      db.review.groupBy({ by: ['source'], where: { storeId }, _count: { _all: true } }),

      db.review.count({ where: { storeId, verifiedPurchase: true } }),
      // Not just `not: null`. The review editor supports clearing a reply back to an
      // empty string, and the old JS counted `reply` by truthiness — so a merchant who
      // deleted a reply used to see their response rate fall, and briefly did not.
      db.review.count({
        where: { storeId, AND: [{ reply: { not: null } }, { reply: { not: '' } }] },
      }),
      db.review.count({ where: { storeId, isFeatured: true } }),
      // `images` holds a JSON array as text. A review with no media is null; one whose
      // upload produced nothing can hold the empty array, which must not count as a photo
      // review — the old code caught that by parsing, this catches it by excluding the
      // two ways an empty array is written.
      db.review.count({
        where: {
          storeId,
          // Spelled out as an explicit AND rather than `NOT: [...]`, whose list form has
          // subtle semantics, and rather than `notIn`, which would rely on SQL's
          // NULL-comparison behaviour to exclude nulls. Three plain conditions cannot be
          // misread by the next person or by a Prisma upgrade.
          AND: [
            { images: { not: null } },
            { images: { not: '[]' } },
            { images: { not: '' } },
          ],
        },
      }),

      db.review.aggregate({ where: { storeId }, _avg: { rating: true } }),

      db.review.groupBy({
        by: ['productId'],
        where: { storeId, productId: { not: null } },
        _count: { _all: true },
        _avg: { rating: true },
        orderBy: { _count: { productId: 'desc' } },
        take: 5,
      }),

      db.review.findMany({
        where: { storeId },
        include: { product: { select: { id: true, title: true, image: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),

      // One column, one bounded window. See the note above.
      db.review.findMany({
        where: { storeId, reviewDate: { gte: since } },
        select: { reviewDate: true },
      }),

      getStorePlan(storeId),
    ]);

    // ── Distributions ──

    const ratingDistribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const g of ratingGroups) {
      if (g.rating >= 1 && g.rating <= 5) ratingDistribution[g.rating] = g._count._all;
    }

    const reviewsBySource: Record<string, number> = {};
    for (const g of sourceGroups) reviewsBySource[g.source] = g._count._all;

    // ── Sentiment ──
    //
    // Derived from the ratings we already grouped, not from `Review.sentiment`.
    //
    // That column is written in exactly one place — the storefront submit route — so a
    // review from CSV import, AliExpress, Etsy, the emailed review form or manual entry
    // has none. The old code folded null into "neutral", which meant a store with a 4.8
    // average and 125 reviews was shown "10% positive, 111 neutral": not a rounding
    // problem but a straight misreading of its own data, on a card captioned "Derived
    // from star ratings" while deriving nothing.
    //
    // Deriving it here makes the caption true for every review whatever its origin, needs
    // no backfill of existing rows, and costs nothing — `ratingGroups` is already loaded.
    // The thresholds match what the submit route stores, so nothing shifts for reviews
    // that do have the column set.
    const sentimentDistribution: Record<string, number> = { positive: 0, neutral: 0, negative: 0 };
    for (const g of ratingGroups) {
      const bucket = g.rating >= 4 ? 'positive' : g.rating <= 2 ? 'negative' : 'neutral';
      sentimentDistribution[bucket] += g._count._all;
    }

    const averageRating = ratingAgg._avg.rating
      ? Math.round(ratingAgg._avg.rating * 10) / 10
      : 0;

    // ── 30-day trend ──
    //
    // Exactly 30 buckets, derived from the same UTC midnight the window starts at, so the
    // keys here and the rows returned above cannot disagree.
    const buckets = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(since);
      d.setUTCDate(d.getUTCDate() + i);
      buckets.set(d.toISOString().split('T')[0], 0);
    }
    for (const row of trendRows) {
      const key = new Date(row.reviewDate).toISOString().split('T')[0];
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const reviewsOverTime = [...buckets].map(([date, count]) => ({ date, count }));

    // ── Top products ──
    //
    // Grouped first, so only the five product rows that actually appear are fetched.
    const topProductIds = productGroups
      .map((g) => g.productId)
      .filter((id): id is string => !!id);

    const topProductRows = topProductIds.length
      ? await db.product.findMany({
          where: { id: { in: topProductIds } },
          select: { id: true, title: true, image: true, price: true },
        })
      : [];

    const productById = new Map(topProductRows.map((p) => [p.id, p]));
    const topProducts = productGroups
      .map((g) => {
        const product = g.productId ? productById.get(g.productId) : undefined;
        if (!product) return null;
        return {
          product,
          reviewCount: g._count._all,
          avgRating: Math.round((g._avg.rating ?? 0) * 10) / 10,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    const verifiedPercentage = totalReviews ? Math.round((verifiedCount / totalReviews) * 100) : 0;
    const responseRate = totalReviews ? Math.round((repliedCount / totalReviews) * 100) : 0;

    return NextResponse.json({
      totalReviews, publishedReviews, pendingReviews, averageRating,
      ratingDistribution, reviewsBySource, reviewsOverTime, topProducts,
      recentReviews, verifiedPercentage, responseRate,
      sentimentDistribution, reviewsWithImages, featuredCount,
      plan,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('Error fetching analytics:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
}
