import crypto from 'crypto';
import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { assertProductInStore, ownershipErrorResponse } from '@/lib/ownership';
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

/**
 * Ceiling on an uploaded CSV, checked before the body is buffered.
 *
 * `request.formData()` reads the whole multipart body into memory, and `file.text()` then
 * makes a second copy as a string — so an upload was bounded by nothing but the container's
 * memory, on a route where the plan gate sits after the parse and cannot help. 10 MB is
 * roughly 60,000 review rows, far past any real import; the row ceiling below catches the
 * pathological case of a small file that expands into millions of rows.
 */
const MAX_CSV_BYTES = 10 * 1024 * 1024;
const MAX_CSV_ROWS = 50_000;

export async function POST(request: NextRequest) {
  try {
    const { storeId, shop, accessToken, onUnauthorized } = await withAuth(request);

    // Content-Length first, so an oversized body is refused before it is buffered. A caller
    // can lie or omit it, which is why `file.size` is checked again below — but an honest
    // client gets a clean 413 without the bytes ever being read.
    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_CSV_BYTES) {
      return NextResponse.json(
        { error: 'That file is too large. The limit is 10 MB — split it and upload in parts.' },
        { status: 413 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    // Every imported row without its own product match lands on this product, and imported
    // rows default to published — so an unvalidated value here rewrites another merchant's
    // aggregate rating from a one-row CSV.
    const fallbackProductId = await assertProductInStore(
      storeId,
      (formData.get('productId') as string | null) || null
    );
    const dryRun = formData.get('dryRun') === 'true';

    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    // The real check. Content-Length above is caller-supplied; this is the parsed size.
    if (file.size > MAX_CSV_BYTES) {
      return NextResponse.json(
        { error: 'That file is too large. The limit is 10 MB — split it and upload in parts.' },
        { status: 413 }
      );
    }

    const text = await file.text();
    const { headers, rows } = parseCSV(text);

    if (rows.length > MAX_CSV_ROWS) {
      return NextResponse.json(
        {
          error: `That file has ${rows.length.toLocaleString()} rows. The limit is ${MAX_CSV_ROWS.toLocaleString()} per upload — split it and import in batches.`,
        },
        { status: 413 }
      );
    }

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

    // ── Idempotency ──
    //
    // A CSV import used to be a plain insert per row with no dedupe key, so re-uploading the
    // same file inserted every review a second time. That is not a hypothetical: the obvious
    // reaction to "imported 1,802 of 1,847" is to fix the file and upload it again, and the
    // obvious reaction to a timeout is to retry — both silently doubled the merchant's
    // catalogue of reviews and their star averages, with no way back except deleting rows by
    // hand. The WelcomeScreen copy also promises imports are deduplicated.
    //
    // Review already carries `@@unique([storeId, source, sourceReviewKey])`, which the
    // platform importers use for exactly this. CSV rows have no upstream id, so the key is a
    // hash of the content that identifies the review: who wrote it, what they said, and
    // when. Re-uploading the same file now writes nothing; editing a row's text makes it a
    // genuinely new review, which is the correct reading.
    const rowKey = (r: { reviewerName: string; rating: number; body: string; reviewDate: Date }) =>
      crypto
        .createHash('sha256')
        .update(`${r.reviewerName}|${r.rating}|${r.body}|${r.reviewDate.toISOString()}`)
        .digest('hex')
        .slice(0, 32);

    // Recorded BEFORE the inserts, not after.
    //
    // The ImportJob row was created once the loop finished, so an import that timed out or
    // crashed mid-way left no trace at all — the merchant saw reviews appear with no job in
    // their history explaining where they came from, and no failure to point at.
    const job = await db.importJob
      .create({
        data: {
          storeId,
          source: detectedSource || 'csv',
          status: 'processing',
          totalReviews: rows.length,
          importedReviews: 0,
          failedReviews: 0,
        },
      })
      .catch(() => null);

    let imported = 0;
    let duplicates = 0;
    const touchedProducts = new Set<string>();

    for (const r of reviews) {
      try {
        await db.review.create({
          data: {
            sourceReviewKey: rowKey(r),
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
        // A unique-constraint violation is the dedupe working, not a failure. Counted
        // separately and reported as such, so "nothing happened" reads as "you already
        // have these" rather than as a broken import.
        if (err && typeof err === 'object' && (err as { code?: string }).code === 'P2002') {
          duplicates++;
          continue;
        }
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

    if (job) {
      await db.importJob
        .update({
          where: { id: job.id },
          data: {
            status: 'completed',
            importedReviews: imported,
            failedReviews: errors.length,
            errorMessage: errors.length
              ? errors.slice(0, 5).map((e) => e.reason).join('; ')
              : duplicates
              ? `${duplicates} row(s) already imported and skipped`
              : null,
          },
        })
        .catch(() => undefined);
    }

    return NextResponse.json({
      total: rows.length,
      imported,
      duplicates,
      failed: errors.length,
      matched,
      unmatched,
      detectedSource,
      productsUpdated: touchedProducts.size,
      errors: errors.slice(0, 20).map((e) => (e.row ? `Row ${e.row}: ${e.reason}` : e.reason)),
    });
  } catch (error: unknown) {
    const owned = ownershipErrorResponse(error);
    if (owned) return NextResponse.json(owned.body, { status: owned.status });
    const limit = planLimitResponse(error);
    if (limit) return NextResponse.json(limit.body, { status: limit.status });
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('Error processing bulk upload:', error);
    return NextResponse.json({ error: 'Failed to process upload' }, { status: 500 });
  }
}
