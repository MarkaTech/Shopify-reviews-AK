import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { assertFeature, assertReviewCapacity, planLimitResponse } from '@/lib/plans';
import { updateProductRating } from '@/lib/ratings';
import {
  parseCSV,
  detectColumns,
  detectSource,
  buildMatchIndex,
  mapRows,
} from '@/lib/import';

/**
 * CSV import, with automatic column detection and product matching.
 *
 * The template below is for merchants with no export to work from. Anyone migrating from
 * another review app uploads that app's export unchanged — detectColumns maps around
 * ninety common column names onto our fields, so "Reviewer Name", "author" and
 * "customer_name" all land in the same place.
 */
export async function GET() {
  const csvTemplate = `reviewerName,rating,title,body,reviewDate,reviewerEmail,reviewerLocation,productHandle,images
John Smith,5,Amazing product,"This is the best product I have ever purchased!",2026-01-15,john@example.com,New York,my-product-handle,https://example.com/photo.jpg
Jane Doe,4,Great value,"Good quality for the price. Would buy again.",2026-02-20,jane@example.com,Los Angeles,my-product-handle,`;

  return new NextResponse(csvTemplate, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename=reviews-template.csv',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const { storeId, shop, accessToken, onUnauthorized } = await withAuth(request);
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const fallbackProductId = (formData.get('productId') as string | null) || null;
    const dryRun = formData.get('dryRun') === 'true';

    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const text = await file.text();
    const { headers, rows } = parseCSV(text);

    if (!headers.length || !rows.length) {
      return NextResponse.json(
        { error: 'That file needs a header row and at least one review row.' },
        { status: 400 }
      );
    }

    const columns = detectColumns(headers);
    const detectedSource = detectSource(headers);

    // Without these two nothing is importable. Failing here, naming the columns we did
    // find, beats importing 500 blank reviews and leaving the merchant to work out why.
    if (!columns.reviewerName || !columns.body) {
      return NextResponse.json(
        {
          error:
            'Could not find a reviewer name and review text column. ' +
            `Found: ${headers.slice(0, 12).join(', ')}${headers.length > 12 ? '…' : ''}`,
          headers,
          detected: columns,
        },
        { status: 400 }
      );
    }

    await assertFeature(storeId, 'csvImport');
    await assertReviewCapacity(storeId, rows.length);

    // Load the catalogue once and match in memory. Querying per row would be hundreds of
    // round trips for a large file.
    const products = await db.product.findMany({
      where: { storeId },
      select: { id: true, shopifyId: true, handle: true, title: true },
    });
    const index = buildMatchIndex(products);

    const { reviews, errors } = mapRows(rows, columns, index, {
      fallbackProductId,
      defaultSource: 'csv',
    });

    const matched = reviews.filter((r) => r.productId).length;
    const unmatched = reviews.length - matched;

    // A dry run shows what WOULD happen before committing. Migrating reviews is not
    // easily undone, and "1,847 reviews, 1,802 matched to products" is exactly the
    // reassurance a merchant needs before pulling the trigger.
    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        detectedSource,
        columns,
        headers,
        total: rows.length,
        importable: reviews.length,
        failed: errors.length,
        matched,
        unmatched,
        errors: errors.slice(0, 20),
        sample: reviews.slice(0, 3).map((r) => ({
          reviewerName: r.reviewerName,
          rating: r.rating,
          title: r.title,
          body: r.body.slice(0, 120),
          matchedBy: r.matchedBy,
        })),
      });
    }

    let imported = 0;
    const touchedProducts = new Set<string>();

    for (const r of reviews) {
      try {
        await db.review.create({
          data: {
            storeId,
            productId: r.productId,
            reviewerName: r.reviewerName,
            reviewerEmail: r.reviewerEmail,
            reviewerLocation: r.reviewerLocation,
            rating: r.rating,
            title: r.title,
            body: r.body,
            images: r.images.length ? JSON.stringify(r.images) : null,
            videoUrl: r.videoUrl,
            reply: r.reply,
            repliedAt: r.reply ? r.reviewDate : null,
            source: r.source,
            sentiment: r.rating >= 4 ? 'positive' : r.rating <= 2 ? 'negative' : 'neutral',
            isPublished: r.isPublished,
            reviewDate: r.reviewDate,
            // An import cannot prove a purchase. Whatever the source file asserts, there
            // is no order behind these, so they stay 'unverified' — republishing another
            // app's "verified" flag as a Verified Purchase badge would be an FTC
            // 16 CFR 465 misrepresentation.
            verifiedPurchase: false,
            verificationStatus: 'unverified',
          },
        });
        imported++;
        if (r.productId && r.isPublished) touchedProducts.add(r.productId);
      } catch (err) {
        errors.push({
          row: 0,
          reason: err instanceof Error ? err.message.slice(0, 120) : 'Insert failed',
        });
      }
    }

    // Recompute once per affected product, not once per row. A 500-row file spanning 20
    // products makes 20 metafield calls, not 500.
    for (const productId of touchedProducts) {
      await updateProductRating(storeId, productId, { shop, accessToken, onUnauthorized }).catch(
        (err) => console.error('[bulk-upload] rating sync failed:', err)
      );
    }

    await db.importJob
      .create({
        data: {
          storeId,
          source: detectedSource || 'csv',
          status: 'completed',
          totalReviews: rows.length,
          importedReviews: imported,
          failedReviews: errors.length,
          errorMessage: errors.length ? errors.slice(0, 5).map((e) => e.reason).join('; ') : null,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({
      total: rows.length,
      imported,
      failed: errors.length,
      matched,
      unmatched,
      detectedSource,
      productsUpdated: touchedProducts.size,
      errors: errors.slice(0, 20).map((e) => (e.row ? `Row ${e.row}: ${e.reason}` : e.reason)),
    });
  } catch (error: unknown) {
    const limit = planLimitResponse(error);
    if (limit) return NextResponse.json(limit.body, { status: limit.status });
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('Error processing bulk upload:', error);
    return NextResponse.json({ error: 'Failed to process upload' }, { status: 500 });
  }
}
