import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Google Merchant Center product ratings feed.
 *
 * This is one of the few features with directly measurable merchant ROI: it puts star
 * ratings on Shopping listings, which lifts click-through. The research put it firmly in
 * the "competitive" tier and it is a genuine paid-plan justification.
 *
 * The policy constraint that shapes the whole implementation
 * ---------------------------------------------------------
 * Google's Product Ratings programme requires you to submit **all** reviews, including
 * low-star ones. Filtering to flatter the merchant is a policy violation that gets the
 * whole feed rejected — and it is independently illegal under the FTC rule, the EU
 * Omnibus Directive and the UK DMCC Act. So this endpoint has no rating filter and no
 * setting to add one. The only exclusions are structural:
 *
 *   - unpublished reviews (not visible to shoppers either, so not part of the corpus)
 *   - reviews with no product link (nothing to attribute them to)
 *
 * `is_incentivized_review` is emitted honestly rather than omitted. Google asks for it,
 * and the FTC requires incentivised reviews to be identified.
 *
 * Served unauthenticated at a per-store token URL because Google's crawler fetches it on a
 * schedule with no ability to log in. The token is the access control.
 */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Strip control characters — XML 1.0 forbids them and one stray byte in a review body
    // invalidates the entire feed.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shop = searchParams.get('shop');
    const token = searchParams.get('token');

    if (!shop || !token) {
      return new NextResponse('shop and token are required', { status: 400 });
    }

    const store = await db.store.findUnique({
      where: { shopifyDomain: shop },
      select: { id: true, name: true, domain: true, shopifyDomain: true, isActive: true },
    });
    if (!store?.isActive) return new NextResponse('Not found', { status: 404 });

    const setting = await db.storeSetting.findUnique({
      where: { storeId_key: { storeId: store.id, key: 'google_feed_token' } },
    });
    // Constant-time-ish comparison is overkill for a feed token, but a plain mismatch must
    // return 404 rather than 403 so the endpoint does not confirm which stores exist.
    if (!setting?.value || setting.value !== token) {
      return new NextResponse('Not found', { status: 404 });
    }

    const reviews = await db.review.findMany({
      where: { storeId: store.id, isPublished: true, productId: { not: null } },
      orderBy: { reviewDate: 'desc' },
      take: 5000,
      select: {
        id: true,
        reviewerName: true,
        rating: true,
        title: true,
        body: true,
        reviewDate: true,
        isIncentivized: true,
        verificationStatus: true,
        product: { select: { shopifyId: true, handle: true, title: true } },
      },
    });

    const siteUrl = `https://${store.domain || store.shopifyDomain}`;
    const parts: string[] = [];

    parts.push('<?xml version="1.0" encoding="UTF-8"?>');
    parts.push('<feed xmlns:vc="http://www.w3.org/2007/XMLSchema-versioning" xsi:noNamespaceSchemaLocation="http://www.google.com/shopping/reviews/schema/product/2.3/product_reviews.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">');
    parts.push('<version>2.3</version>');
    parts.push(`<aggregator><name>${xmlEscape(store.name || 'ReviewMaster')}</name></aggregator>`);
    parts.push(`<publisher><name>${xmlEscape(store.name || 'Store')}</name><favicon>${xmlEscape(siteUrl)}/favicon.ico</favicon></publisher>`);
    parts.push('<reviews>');

    for (const r of reviews) {
      if (!r.product?.shopifyId) continue;
      const url = r.product.handle ? `${siteUrl}/products/${r.product.handle}` : siteUrl;

      parts.push('<review>');
      parts.push(`<review_id>${xmlEscape(r.id)}</review_id>`);
      parts.push(`<reviewer><name>${xmlEscape(r.reviewerName)}</name></reviewer>`);
      parts.push(`<review_timestamp>${r.reviewDate.toISOString()}</review_timestamp>`);
      if (r.title) parts.push(`<title>${xmlEscape(r.title)}</title>`);
      parts.push(`<content>${xmlEscape(r.body)}</content>`);
      parts.push(`<review_url type="singleton">${xmlEscape(url)}#reviewmaster-reviews</review_url>`);
      parts.push(`<ratings><overall min="1" max="5">${r.rating}</overall></ratings>`);
      parts.push('<products><product>');
      parts.push(`<product_ids><gtins/><mpns/><skus/></product_ids>`);
      parts.push(`<product_name>${xmlEscape(r.product.title)}</product_name>`);
      parts.push(`<product_url>${xmlEscape(url)}</product_url>`);
      parts.push('</product></products>');
      // Honest disclosure, per Google's spec and the FTC rule.
      parts.push(`<is_incentivized_review>${r.isIncentivized ? 'true' : 'false'}</is_incentivized_review>`);
      parts.push(`<collection_method>${r.verificationStatus === 'verified_buyer' ? 'post_fulfillment' : 'unsolicited'}</collection_method>`);
      parts.push('</review>');
    }

    parts.push('</reviews>');
    parts.push('</feed>');

    return new NextResponse(parts.join('\n'), {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        // Google fetches daily at most; an hour of cache costs nothing and protects the
        // database from a crawler retry storm.
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('[feeds/google]', error);
    return new NextResponse('Feed generation failed', { status: 500 });
  }
}
