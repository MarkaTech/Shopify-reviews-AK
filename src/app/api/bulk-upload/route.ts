import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { assertFeature, assertReviewCapacity, planLimitResponse } from '@/lib/plans';
import { updateProductRating } from '@/lib/ratings';

export async function GET() {
  const csvTemplate = `reviewerName,rating,title,body,reviewDate,reviewerEmail,reviewerLocation,verifiedPurchase,source,images
John Smith,5,Amazing product,"This is the best product I have ever purchased!",2025-01-15,john@example.com,New York,true,direct,"https://example.com/image1.jpg"
Jane Doe,4,Great value,"Good quality for the price. Would buy again.",2025-02-20,jane@example.com,Los Angeles,true,direct,`;

  return new NextResponse(csvTemplate, {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=reviews-template.csv' },
  });
}

export async function POST(request: NextRequest) {
  try {
    const { storeId, shop, accessToken, onUnauthorized } = await withAuth(request);
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const productId = formData.get('productId') as string | null;

    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());

    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV must have header and at least one data row' }, { status: 400 });
    }

    // CSV import is a paid feature, and the whole file must fit within the plan's review
    // cap. Both are checked before a single row is written, so a rejected upload never
    // leaves the store half-imported.
    await assertFeature(storeId, 'csvImport');
    await assertReviewCapacity(storeId, lines.length - 1);

    const headers = lines[0].split(',').map(h => h.trim());
    let imported = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i]);
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => { row[h] = values[idx] || ''; });

        if (!row.reviewerName || !row.body) {
          errors.push(`Row ${i + 1}: Missing required fields (reviewerName, body)`);
          failed++;
          continue;
        }

        const rating = Math.min(5, Math.max(1, Number(row.rating) || 5));
        const sentiment = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
        const images = row.images ? JSON.stringify(row.images.split('|').filter(Boolean)) : null;

        await db.review.create({
          data: {
            storeId,
            productId: productId || null,
            reviewerName: row.reviewerName,
            reviewerEmail: row.reviewerEmail || null,
            reviewerLocation: row.reviewerLocation || null,
            // A CSV row cannot prove a purchase. The uploader may assert
            // verifiedPurchase=true and we keep it for their own display purposes, but
            // verificationStatus stays 'unverified' because we have no order to point at
            // — and Shopify's syndication contract, plus FTC 16 CFR 465, both turn on
            // that distinction. Only the tokenised post-purchase flow earns
            // 'verified_buyer'.
            verifiedPurchase: row.verifiedPurchase === 'true',
            verificationStatus: 'unverified',
            rating,
            title: row.title || null,
            body: row.body,
            images,
            videoUrl: null,
            source: row.source || 'csv',
            sentiment,
            isPublished: true,
            reviewDate: row.reviewDate ? new Date(row.reviewDate) : new Date(),
          },
        });
        imported++;
      } catch (err) {
        errors.push(`Row ${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`);
        failed++;
      }
    }

    // Imported reviews are published immediately, so every affected product's aggregate
    // is now stale. Recompute once per product rather than once per row — a 500-row CSV
    // against 20 products should make 20 metafield calls, not 500.
    if (imported > 0 && productId) {
      await updateProductRating(storeId, productId, { shop, accessToken, onUnauthorized })
        .catch(err => console.error('[bulk-upload] rating sync failed:', err));
    }

    return NextResponse.json({ total: lines.length - 1, imported, failed, errors });
  } catch (error: unknown) {
    const limit = planLimitResponse(error);
    if (limit) return NextResponse.json(limit.body, { status: limit.status });
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('Error processing bulk upload:', error);
    return NextResponse.json({ error: 'Failed to process upload' }, { status: 500 });
  }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}
