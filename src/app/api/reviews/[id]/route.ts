import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { assertProductInStore, ownershipErrorResponse } from '@/lib/ownership';
import { updateProductRating } from '@/lib/ratings';
import { syncReviewToShop, unsyndicateReview, isSyndicationEnabled } from '@/lib/syndication';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { storeId } = await withAuth(request);
    const { id } = await params;
    const review = await db.review.findFirst({
      where: { id, storeId },
      include: {
        product: { select: { id: true, title: true, image: true, handle: true } },
        store: { select: { id: true, name: true, domain: true } },
      },
    });
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });
    return NextResponse.json(review);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[Failed to fetch review]', error);
    return NextResponse.json({ error: 'Failed to fetch review' }, { status: 500 });
  }
}

/**
 * Fields a merchant is allowed to change on a review.
 *
 * This used to be `{ ...body }` — the entire request body spread straight into a Prisma
 * update. That let any authenticated merchant write ANY column, including `storeId`
 * (moving a review to another merchant's store), `verificationStatus` (fabricating a
 * "Verified Purchase" badge, which is precisely the FTC misrepresentation this app is
 * built to avoid), `metaobjectId`, and `createdAt`. An allowlist is the fix; adding a
 * field here should be a deliberate act.
 *
 * Notably absent and intentionally so: `verificationStatus` and `verifiedPurchase`.
 * Verification is derived from whether an order was matched at submission time. It is a
 * factual claim about provenance, not an editorial decision, so nothing in the admin UI
 * may set it.
 */
const EDITABLE_FIELDS = [
  'title',
  'body',
  'rating',
  'reviewerName',
  'reviewerLocation',
  'isPublished',
  'isFeatured',
  'isPinned',
  'reply',
  'videoUrl',
  'productId',
] as const;

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { storeId, shop, accessToken, onUnauthorized } = await withAuth(request);
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    const existing = await db.review.findFirst({ where: { id, storeId } });
    if (!existing) return NextResponse.json({ error: 'Review not found' }, { status: 404 });

    const data: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (field in body) data[field] = body[field];
    }

    // productId is editable (a merchant reassigning an unmatched imported review), but the
    // ownership check above only proved the REVIEW belongs to this store. Moving it onto
    // another merchant's product rewrites that merchant's star rating and, if the review is
    // unpublished in the same call, deletes their reviews.rating metafield.
    if ('productId' in data) {
      data.productId = await assertProductInStore(storeId, data.productId);
    }

    if (typeof data.rating === 'number') {
      data.rating = Math.min(5, Math.max(1, Math.round(data.rating)));
      // Keep the cheap rule-based sentiment in step with the rating. The AI sentiment in
      // `aiSentiment` is separate and is not recomputed here.
      const r = data.rating as number;
      data.sentiment = r >= 4 ? 'positive' : r <= 2 ? 'negative' : 'neutral';
    }

    if (Array.isArray(body.images)) {
      data.images = JSON.stringify(body.images.filter((u) => typeof u === 'string'));
    }
    if (body.customFields && typeof body.customFields === 'object') {
      data.customFields = JSON.stringify(body.customFields);
    }

    // Stamp the reply timestamp when a reply first appears or changes.
    if (typeof data.reply === 'string' && data.reply !== existing.reply) {
      data.repliedAt = data.reply.trim() ? new Date() : null;
    }

    const updated = await db.review.update({
      where: { id },
      data,
      include: { product: { select: { id: true, title: true, image: true } } },
    });

    // ── Aggregate maintenance ──
    //
    // A rating change or a publish-status change alters the public average, and both
    // Shopify's syndication program and the FTC/CMA rules require the displayed aggregate
    // to reflect reality immediately. Awaited rather than fired-and-forgotten: a merchant
    // who unpublishes a 1-star review and immediately reloads must not see the old
    // average, and a metafield left stale is visible to Google.
    const ratingChanged = 'rating' in data && data.rating !== existing.rating;
    const publishChanged = 'isPublished' in data && data.isPublished !== existing.isPublished;
    const productChanged = 'productId' in data && data.productId !== existing.productId;

    if (ratingChanged || publishChanged || productChanged) {
      const ctx = { shop, accessToken, onUnauthorized };
      const affected = new Set<string>();
      if (existing.productId) affected.add(existing.productId);
      if (updated.productId) affected.add(updated.productId);
      for (const pid of affected) {
        await updateProductRating(storeId, pid, ctx);
      }
    }

    // Push the change to the Shop app. Best-effort — never blocks the merchant.
    if (await isSyndicationEnabled(storeId)) {
      await syncReviewToShop(storeId, id, { shop, accessToken, onUnauthorized });
    }

    return NextResponse.json(updated);
  } catch (error: unknown) {
    const owned = ownershipErrorResponse(error);
    if (owned) return NextResponse.json(owned.body, { status: owned.status });
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[Failed to update review]', error);
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { storeId, shop, accessToken, onUnauthorized } = await withAuth(request);
    const { id } = await params;

    const review = await db.review.findFirst({ where: { id, storeId } });
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });

    // Remove from the Shop app first. Doing this after the local delete would lose the
    // metaobject id and orphan the review inside Shop, where we could no longer reach it.
    if (review.metaobjectId) {
      await unsyndicateReview(shop, accessToken, review.metaobjectId, onUnauthorized);
    }

    await db.review.delete({ where: { id } });

    // Removing a review must flow through to the average. The CMA's fake-review guidance
    // makes this explicit and the FTC rule implies it: an aggregate that still counts a
    // deleted review misrepresents the body of reviews.
    if (review.productId) {
      await updateProductRating(storeId, review.productId, { shop, accessToken, onUnauthorized });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[Failed to delete review]', error);
    return NextResponse.json({ error: 'Failed to delete review' }, { status: 500 });
  }
}
