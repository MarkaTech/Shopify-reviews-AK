import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { assertReviewCapacity, getRemainingReviewCapacity, planLimitResponse } from '@/lib/plans';
import {
  extractReviews,
  fetchPage,
  validateSourceUrl,
  ImportError,
  SUPPORTED_PLATFORMS,
  type Platform,
} from '@/lib/importers';

export async function GET(request: Request) {
  try {
    const { storeId } = await withAuth(request);
    const jobs = await db.importJob.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    return NextResponse.json({ jobs });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[Failed to fetch import jobs]', error);
    return NextResponse.json({ error: 'Failed to fetch import jobs' }, { status: 500 });
  }
}

/**
 * Import genuine reviews from a marketplace product page.
 *
 * This previously generated fake reviews with random names and reported them as imported.
 * It now extracts real review data or fails with an explanation — it never invents any.
 *
 * The merchant may supply page HTML directly (copied from their own browser) when a
 * server-side fetch is blocked, which marketplaces commonly do for datacentre traffic.
 */
export async function POST(request: NextRequest) {
  const startedAt = new Date();
  let storeId = '';

  try {
    ({ storeId } = await withAuth(request));
    const body = (await request.json()) as {
      source?: string;
      config?: { url?: string; productId?: string; html?: string };
    };

    const source = String(body.source || '') as Platform;
    if (!(source in SUPPORTED_PLATFORMS)) {
      return NextResponse.json(
        { error: `Unsupported platform. Supported: ${Object.keys(SUPPORTED_PLATFORMS).join(', ')}.` },
        { status: 400 }
      );
    }

    const rawUrl = body.config?.url?.trim() || '';
    const pastedHtml = body.config?.html?.trim() || '';
    const productId = body.config?.productId || null;

    if (!rawUrl) {
      return NextResponse.json(
        { error: 'A product page URL is required.', code: 'URL_REQUIRED' },
        { status: 400 }
      );
    }

    const url = validateSourceUrl(source, rawUrl);

    // Capacity first — no point fetching a page we cannot store anything from.
    const remaining = await getRemainingReviewCapacity(storeId);
    if (remaining === 0) await assertReviewCapacity(storeId, 1);

    // Merchant-supplied HTML wins: it comes from their own authenticated browser session
    // and avoids the blocking that affects server-side requests entirely.
    const html = pastedHtml || (await fetchPage(url));

    const extracted = extractReviews(html, url.toString());

    if (extracted.length === 0) {
      await db.importJob.create({
        data: {
          storeId, source, status: 'failed',
          totalReviews: 0, importedReviews: 0, failedReviews: 0,
          errorMessage: 'No structured review data found on the page',
          config: JSON.stringify({ url: url.toString() }),
          startedAt, completedAt: new Date(),
        },
      });
      return NextResponse.json(
        {
          error: 'No reviews could be read from that page.',
          code: 'NO_REVIEWS_FOUND',
          hint: 'The page may not publish structured review data, or the content may load only for signed-in visitors. Open the page in your browser, save or copy the page source, and paste it into the HTML field.',
        },
        { status: 422 }
      );
    }

    // Honour the plan's review cap; import what fits rather than rejecting the batch.
    const toImport = remaining === null ? extracted : extracted.slice(0, remaining);
    const trimmed = toImport.length < extracted.length;

    const created = await db.review.createMany({
      data: toImport.map(r => ({
        storeId,
        productId,
        reviewerName: r.reviewerName,
        rating: r.rating,
        title: r.title,
        body: r.body,
        source,                    // attribution, required for honest display
        sourceUrl: r.sourceUrl,
        verifiedPurchase: r.verifiedPurchase,
        reviewDate: r.reviewDate ?? new Date(),
        sentiment: r.rating >= 4 ? 'positive' : r.rating <= 2 ? 'negative' : 'neutral',
        isPublished: false,        // imported reviews start unpublished for merchant review
      })),
    });

    const job = await db.importJob.create({
      data: {
        storeId, source, status: 'completed',
        totalReviews: extracted.length,
        importedReviews: created.count,
        failedReviews: extracted.length - created.count,
        config: JSON.stringify({ url: url.toString() }),
        startedAt, completedAt: new Date(),
      },
    });

    return NextResponse.json(
      {
        job,
        importedReviews: created.count,
        foundReviews: extracted.length,
        trimmed,
        remainingAfter: remaining === null ? null : Math.max(0, remaining - created.count),
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    const limit = planLimitResponse(error);
    if (limit) return NextResponse.json(limit.body, { status: limit.status });

    if (error instanceof ImportError) {
      return NextResponse.json(
        { error: error.message, code: error.code, hint: error.hint },
        { status: 422 }
      );
    }
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();

    console.error('[Failed to import reviews]', error);
    return NextResponse.json({ error: 'Failed to import reviews' }, { status: 500 });
  }
}
