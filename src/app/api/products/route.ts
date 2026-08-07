import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import type { Prisma } from '@prisma/client';

/**
 * The merchant's synced catalogue.
 *
 * Two defects fixed here, both of which made the page lie rather than fail loudly.
 *
 * **Sorting could 500 the page.** `sortBy` came straight off the query string into
 * `orderBy[sortBy]`. Two of the five options the UI offers — `reviews_count` and
 * `avg_rating` — are not columns on this model, so Prisma threw, the route returned 500,
 * and the grid fell back to its empty state: a merchant saw "No products synced yet" and
 * concluded their catalogue had been deleted, because they used a dropdown. It was also
 * an open door — any column name could be passed, including ones the response never
 * exposes, which leaks ordering information about them.
 *
 * **The "No reviews" filter did nothing.** Only `hasReviews === 'true'` was handled, so
 * selecting "No reviews" silently returned everything.
 *
 * Per-product review rows are no longer loaded either. The old code pulled every review
 * of every product on the page purely to average them in JavaScript; the aggregate is
 * already maintained in ProductRating, and where it is missing the count still comes from
 * a grouped count rather than the rows themselves.
 */

/**
 * Sort keys the UI offers, mapped to something Prisma can execute.
 *
 * An allow-list rather than a passthrough: the set of orderable fields is a deliberate
 * part of the API surface, not whatever happens to exist on the model.
 */
function buildOrderBy(
  sortBy: string,
  dir: Prisma.SortOrder
): Prisma.ProductOrderByWithRelationInput {
  switch (sortBy) {
    case 'title':
      return { title: dir };
    case 'price':
      return { price: dir };
    // Ordering by a relation's row count — the form Prisma supports for `_count`.
    case 'reviews_count':
      return { reviews: { _count: dir } };
    // The maintained aggregate, not an average computed over the review rows. Products
    // with no ProductRating row sort as if zero, which is what "no reviews" should mean.
    case 'avg_rating':
      return { rating: { average: dir } };
    case 'createdAt':
    default:
      return { createdAt: dir };
  }
}

export async function GET(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const searchParams = request.nextUrl.searchParams;

    const where: Prisma.ProductWhereInput = { storeId };

    const search = searchParams.get('search');
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { vendor: { contains: search, mode: 'insensitive' } },
        { productType: { contains: search, mode: 'insensitive' } },
      ];
    }

    const hasReviews = searchParams.get('hasReviews');
    if (hasReviews === 'true') where.reviews = { some: {} };
    else if (hasReviews === 'false') where.reviews = { none: {} };

    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const dir: Prisma.SortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    // Capped. The Import screen asks for 250 to populate a product picker, and without a
    // ceiling a hand-edited limit could ask for the entire catalogue in one response.
    const limit = Math.min(250, Math.max(1, Number(searchParams.get('limit')) || 20));
    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      db.product.findMany({
        where,
        include: {
          _count: { select: { reviews: true } },
          // The maintained aggregate: two numbers, rather than every review row.
          rating: { select: { average: true, count: true } },
        },
        orderBy: buildOrderBy(sortBy, dir),
        skip,
        take: limit,
      }),
      db.product.count({ where }),
    ]);

    const productsWithStats = products.map((p) => ({
      id: p.id,
      shopifyId: p.shopifyId,
      title: p.title,
      handle: p.handle,
      description: p.description,
      image: p.image,
      price: p.price,
      vendor: p.vendor,
      productType: p.productType,
      tags: p.tags,
      isVisible: p.isVisible,
      createdAt: p.createdAt,
      // `_count` counts every review; ProductRating counts only published ones. The card
      // shows what the merchant has collected, so the raw count is the right one here,
      // and the average comes from the aggregate that the storefront also uses — so the
      // number on this page and the number on the product page cannot disagree.
      reviewCount: p._count.reviews,
      averageRating: p.rating ? Math.round(p.rating.average * 10) / 10 : 0,
    }));

    return NextResponse.json({
      products: productsWithStats,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('Error fetching products:', error);
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}
