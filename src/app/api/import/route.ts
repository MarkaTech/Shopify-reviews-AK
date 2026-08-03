import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withAuth, unauthorizedResponse } from '@/lib/auth';

/**
 * Import job history.
 *
 * The POST handler that lived here fetched a marketplace product page (Amazon, Alibaba),
 * scraped reviews out of it, and republished them on the merchant's storefront. It has
 * been removed, for two independent reasons:
 *
 *  1. It could not work. Amazon's robots.txt disallows automated fetches of /dp/ pages,
 *     both sites gate review content behind bot detection, and neither publishes
 *     per-review schema.org markup — only an aggregateRating. The extractor had nothing
 *     to read, so every real-world attempt failed.
 *
 *  2. It should not work. Presenting reviews written about another seller's listing as
 *     reviews of the merchant's own product is misrepresentation under the FTC Rule on
 *     Consumer Reviews and Testimonials (16 CFR Part 465) and the EU Omnibus Directive,
 *     and it breaches Amazon's Conditions of Use. Shipping it would have exposed
 *     merchants to legal risk and failed Shopify App Store review.
 *
 * One marketplace exception has since been made, deliberately and narrowly: AliExpress
 * (see ./aliexpress). Its feedback is served from a public JSON endpoint rather than
 * scraped from protected pages, and the use case is dropshipping — the merchant sells
 * the same physical item, attests to exactly that on every import, and the reviews land
 * unverified and source-labelled. Neither of those properties holds for Amazon, eBay or
 * Etsy, so the reasoning above still applies to them in full.
 *
 * The other sources are unchanged: a CSV of reviews the merchant already owns
 * (see /api/bulk-upload), and first-party review requests sent after a real order
 * (see /api/review-request/[token]).
 *
 * This GET stays because ImportJob rows are worth showing, and both the CSV and
 * AliExpress paths record them.
 */
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
