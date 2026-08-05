import { db } from '@/lib/db';
import { NextRequest, NextResponse, after } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { assertProductInStore, ownershipErrorResponse } from '@/lib/ownership';
import { assertReviewCapacity, assertFeature, planLimitResponse } from '@/lib/plans';
import { resolvePendingMedia } from '@/lib/media-resolve';

export async function GET(request: NextRequest) {
  try {
    const { storeId, shop, accessToken, onUnauthorized } = await withAuth(request);
    const searchParams = request.nextUrl.searchParams;

    const where: Record<string, unknown> = { storeId };

    const search = searchParams.get('search');
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { body: { contains: search } },
        { reviewerName: { contains: search } },
      ];
    }

    const ratingParam = searchParams.get('rating');
    if (ratingParam) {
      where.rating = { in: ratingParam.split(',').map(Number) };
    }

    const source = searchParams.get('source');
    if (source) where.source = source;

    const productId = searchParams.get('productId');
    if (productId) where.productId = productId;

    const isPublished = searchParams.get('isPublished');
    if (isPublished !== null && isPublished !== '') where.isPublished = isPublished === 'true';

    const isFeatured = searchParams.get('isFeatured');
    if (isFeatured !== null && isFeatured !== '') where.isFeatured = isFeatured === 'true';

    const verifiedPurchase = searchParams.get('verifiedPurchase');
    if (verifiedPurchase !== null && verifiedPurchase !== '') where.verifiedPurchase = verifiedPurchase === 'true';

    const sentiment = searchParams.get('sentiment');
    if (sentiment) where.sentiment = sentiment;

    const minRating = searchParams.get('minRating');
    const maxRating = searchParams.get('maxRating');
    if (minRating || maxRating) {
      where.rating = {};
      if (minRating) (where.rating as Record<string, unknown>).gte = Number(minRating);
      if (maxRating) (where.rating as Record<string, unknown>).lte = Number(maxRating);
    }

    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    if (dateFrom || dateTo) {
      where.reviewDate = {};
      if (dateFrom) (where.reviewDate as Record<string, unknown>).gte = new Date(dateFrom);
      if (dateTo) (where.reviewDate as Record<string, unknown>).lte = new Date(dateTo);
    }

    const hasImages = searchParams.get('hasImages');
    if (hasImages !== null && hasImages !== '') {
      if (hasImages === 'true') where.images = { not: null };
      else where.images = null;
    }

    const hasReply = searchParams.get('hasReply');
    if (hasReply !== null && hasReply !== '') {
      if (hasReply === 'true') where.reply = { not: null };
      else where.reply = null;
    }

    const sortBy = searchParams.get('sortBy') || 'reviewDate';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const orderBy: Record<string, string> = {};
    orderBy[sortBy] = sortOrder;

    const page = Number(searchParams.get('page')) || 1;
    const limit = Number(searchParams.get('limit')) || 20;
    const skip = (page - 1) * limit;

    const [reviews, total] = await Promise.all([
      db.review.findMany({
        where,
        include: { product: { select: { id: true, title: true, image: true } } },
        orderBy,
        skip,
        take: limit,
      }),
      db.review.count({ where }),
    ]);

    // Self-healing for media that was still processing at submit time. Videos take
    // minutes to transcode on Shopify's side, so submit parks the file GIDs in
    // `pendingMedia` — and the merchant opening their review list is the natural
    // "someone is about to look at these" moment to finish the job. Off the response
    // path: the list must render instantly whether or not Shopify has caught up.
    const anyPending = await db.review.findFirst({
      where: { storeId, pendingMedia: { not: null } },
      select: { id: true },
    });
    if (anyPending) {
      after(async () => {
        try {
          const r = await resolvePendingMedia(storeId, shop, accessToken, onUnauthorized);
          if (r.resolved) console.info('[reviews] resolved pending media:', r);
        } catch (err) {
          console.error('[reviews] pending media resolution failed:', err);
        }
      });
    }

    return NextResponse.json({ reviews, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return unauthorizedResponse();
    }
    console.error('Error fetching reviews:', error);
    return NextResponse.json({ error: 'Failed to fetch reviews' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);

    // Enforce the plan's review cap before writing anything.
    await assertReviewCapacity(storeId, 1);

    const body = await request.json();

    // Photo and video reviews are a paid feature.
    if ((body.images && body.images.length) || body.videoUrl) {
      await assertFeature(storeId, 'photoReviews');
    }

    let sentiment = 'neutral';
    if (body.rating >= 4) sentiment = 'positive';
    else if (body.rating <= 2) sentiment = 'negative';

    // A productId from the request body is a value we are being handed, not the record
    // being addressed — so the usual "does this record belong to the caller" check in the
    // handler does not cover it. Unvalidated, it foreign-keys this store's review to
    // another merchant's product, which then leaks that product's title and image in the
    // response below and arms a cross-store aggregate rewrite on the next rating update.
    const productId = await assertProductInStore(storeId, body.productId);

    const review = await db.review.create({
      data: {
        storeId,
        productId,
        reviewableType: body.reviewableType || 'product',
        reviewableId: body.reviewableId || null,
        reviewerName: body.reviewerName || 'Anonymous',
        reviewerEmail: body.reviewerEmail || null,
        reviewerAvatar: body.reviewerAvatar || null,
        reviewerLocation: body.reviewerLocation || null,
        verifiedPurchase: body.verifiedPurchase || false,
        rating: body.rating || 5,
        title: body.title || null,
        body: body.body || '',
        images: body.images ? JSON.stringify(body.images) : null,
        videoUrl: body.videoUrl || null,
        source: body.source || 'direct',
        sourceUrl: body.sourceUrl || null,
        sourceProductId: body.sourceProductId || null,
        sentiment,
        isFeatured: body.isFeatured || false,
        isPublished: body.isPublished !== undefined ? body.isPublished : true,
        isPinned: body.isPinned || false,
        customFields: body.customFields ? JSON.stringify(body.customFields) : null,
        reviewDate: body.reviewDate ? new Date(body.reviewDate) : new Date(),
      },
      include: { product: { select: { id: true, title: true, image: true } } },
    });

    return NextResponse.json(review, { status: 201 });
  } catch (error: unknown) {
    const owned = ownershipErrorResponse(error);
    if (owned) return NextResponse.json(owned.body, { status: owned.status });
    const limit = planLimitResponse(error);
    if (limit) return NextResponse.json(limit.body, { status: limit.status });
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return unauthorizedResponse();
    }
    console.error('Error creating review:', error);
    return NextResponse.json({ error: 'Failed to create review' }, { status: 500 });
  }
}
