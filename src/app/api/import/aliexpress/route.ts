import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { assertFeature, assertReviewCapacity, planLimitResponse, getStorePlan, PLANS } from '@/lib/plans';
import { assertProductInStore, ownershipErrorResponse, OwnershipError } from '@/lib/ownership';
import {
  parseAliExpressUrl,
  fetchAliExpressReviews,
  AliExpressImportError,
  MAX_IMPORT,
} from '@/lib/aliexpress';
import { updateProductRating } from '@/lib/ratings';

/**
 * Import a listing's AliExpress reviews onto one of the merchant's products.
 *
 * The attestation is not decoration. The legal basis for this feature is that the
 * merchant sells the same physical item as the listing — dropshipping — so the reviews
 * describe what the shopper will actually receive. The merchant asserts that, we record
 * the assertion on the import job, and the reviews still land unverified and
 * source-labelled. Without the attestation the request is refused outright.
 *
 * Everything else is the same discipline as every other write path: the feature is
 * plan-gated, the target product must belong to the store, the plan's review cap is
 * enforced before anything is written, and a re-run of the same listing skips what it
 * already imported instead of duplicating it.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ImportRequest {
  url?: string;
  productId?: string;
  confirmSameProduct?: boolean;
}

export async function POST(request: NextRequest) {
  let jobId: string | null = null;
  try {
    const { storeId, shop, accessToken, onUnauthorized } = await withAuth(request);
    await assertFeature(storeId, 'platformImport');

    const body = (await request.json()) as ImportRequest;

    if (body.confirmSameProduct !== true) {
      return NextResponse.json(
        { error: 'Confirm that this AliExpress listing is the same product you sell. Reviews may only be imported onto the product they describe.' },
        { status: 400 }
      );
    }
    if (!body.productId) {
      return NextResponse.json({ error: 'Choose which product these reviews belong to.' }, { status: 400 });
    }

    const aliProductId = parseAliExpressUrl(body.url || '');
    await assertProductInStore(storeId, body.productId);

    // How much room the plan leaves decides how much we even fetch. Asking AliExpress
    // for 200 reviews to then refuse 180 of them would be rude in both directions.
    const headroom = await importHeadroom(storeId);
    if (headroom <= 0) {
      await assertReviewCapacity(storeId, 1); // throws the proper 402 with upgrade details
    }
    const budget = Math.min(headroom, MAX_IMPORT);

    const job = await db.importJob.create({
      data: {
        storeId,
        source: 'aliexpress',
        status: 'processing',
        startedAt: new Date(),
        config: JSON.stringify({
          aliProductId,
          url: body.url,
          productId: body.productId,
          confirmSameProduct: true,
        }),
      },
    });
    jobId = job.id;

    const { reviews, listingTotal } = await fetchAliExpressReviews(aliProductId, budget);

    // Dedup against previous runs of the same listing. Author + body is the identity a
    // re-fetched review keeps; ids from their side are not stable enough to trust.
    const existing = await db.review.findMany({
      where: { storeId, productId: body.productId, source: 'aliexpress' },
      select: { reviewerName: true, body: true },
    });
    const seen = new Set(existing.map((r) => `${r.reviewerName} ${r.body}`));

    let imported = 0;
    let skipped = 0;
    for (const r of reviews) {
      const key = `${r.author} ${r.body}`;
      if (seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);

      await db.review.create({
        data: {
          storeId,
          productId: body.productId,
          reviewerName: r.author,
          reviewerLocation: r.country,
          rating: r.rating,
          body: r.body,
          images: r.images.length ? JSON.stringify(r.images) : null,
          source: 'aliexpress',
          sourceUrl: `https://www.aliexpress.com/item/${aliProductId}.html`,
          sourceProductId: aliProductId,
          // Imported means unverifiable, permanently. No order of this merchant's backs
          // it, and the badge is reserved for reviews one does.
          verificationStatus: 'unverified',
          verifiedPurchase: false,
          isPublished: true,
          ...(r.date ? { reviewDate: r.date } : {}),
        },
      });
      imported++;
    }

    // The full sync, not just the local aggregate. The storefront widget's header is
    // rendered server-side by Liquid from Shopify's product metafields, so an import
    // that skips the metafield push leaves the page saying "No reviews yet" above a
    // histogram full of reviews — which is exactly what the first live import produced.
    // Run it even when everything was a duplicate: it is idempotent, and it makes
    // re-running an import the repair path for a product whose metafields are stale.
    await updateProductRating(storeId, body.productId, { shop, accessToken, onUnauthorized });

    await db.importJob.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        totalReviews: listingTotal,
        importedReviews: imported,
        failedReviews: skipped,
        completedAt: new Date(),
      },
    });

    return NextResponse.json({
      imported,
      skipped,
      fetched: reviews.length,
      listingTotal,
      truncated: listingTotal > reviews.length,
    });
  } catch (error: unknown) {
    if (jobId) {
      await db.importJob
        .update({
          where: { id: jobId },
          data: {
            status: 'failed',
            errorMessage: error instanceof Error ? error.message.slice(0, 500) : 'unknown',
            completedAt: new Date(),
          },
        })
        .catch(() => {});
    }

    if (error instanceof AliExpressImportError) {
      return NextResponse.json({ error: error.merchantMessage }, { status: 502 });
    }
    const limit = planLimitResponse(error);
    if (limit) return NextResponse.json(limit.body, { status: limit.status });
    if (error instanceof OwnershipError) return ownershipErrorResponse(error);
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();

    console.error('[import/aliexpress]', error);
    return NextResponse.json({ error: 'Import failed. Try again in a few minutes.' }, { status: 500 });
  }
}

/** Remaining review capacity under the store's plan, or MAX_IMPORT when unlimited. */
async function importHeadroom(storeId: string): Promise<number> {
  const plan = await getStorePlan(storeId);
  const cap = PLANS[plan].maxReviews;
  if (cap === null) return MAX_IMPORT;
  const used = await db.review.count({ where: { storeId } });
  return Math.max(0, cap - used);
}
