/**
 * Builds the Google Merchant Center product ratings feed document.
 *
 * Separated from the route so it can be tested. It takes plain data and returns a
 * string: no database, no request, no environment. That matters more here than in most
 * places, because the failure mode is not an exception — an invalid document is accepted
 * by the HTTP layer, served with a 200, fetched by Google and rejected *in full*. A
 * single misplaced element silently costs a merchant every star rating they have.
 *
 * The policy constraint that shapes the whole thing
 * -------------------------------------------------
 * Google's Product Ratings programme requires you to submit **all** reviews, including
 * low-star ones. Filtering to flatter the merchant is a policy violation that gets the
 * whole feed rejected — and it is independently illegal under the FTC rule, the EU
 * Omnibus Directive and the UK DMCC Act. So there is no rating filter here and no
 * setting to add one. The only exclusions are structural:
 *
 *   - unpublished reviews (not visible to shoppers either, so not part of the corpus)
 *   - reviews with no product link (nothing to attribute them to)
 */

export interface FeedStore {
  name: string | null;
  domain: string | null;
  shopifyDomain: string | null;
}

export interface FeedReview {
  id: string;
  reviewerName: string;
  rating: number;
  title: string | null;
  body: string;
  reviewDate: Date;
  isIncentivized: boolean;
  verificationStatus: string | null;
  product: { shopifyId: string | null; handle: string | null; title: string } | null;
}

export function xmlEscape(s: string): string {
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

/**
 * The order of elements inside `<review>`.
 *
 * `review` is an `xs:sequence`, so this is a correctness constraint, not a style one, and
 * it is the least obvious thing in this file — `is_incentivized_review` reads like it
 * belongs next to `collection_method` and does not. Written down here so the test can
 * assert against the same list the builder follows, and so the next person changing this
 * sees the constraint before they reorder anything.
 *
 * Matches Google's published sample feed.
 */
export const REVIEW_ELEMENT_ORDER = [
  'review_id',
  'reviewer',
  'is_verified_purchase',
  'is_incentivized_review',
  'review_timestamp',
  'title',
  'content',
  'review_url',
  'ratings',
  'products',
  'collection_method',
] as const;

export function buildProductReviewsFeed(store: FeedStore, reviews: FeedReview[]): string {
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
    const verified = r.verificationStatus === 'verified_buyer';

    parts.push('<review>');
    parts.push(`<review_id>${xmlEscape(r.id)}</review_id>`);
    parts.push(`<reviewer><name>${xmlEscape(r.reviewerName)}</name></reviewer>`);
    // See REVIEW_ELEMENT_ORDER: these two belong here, directly after the reviewer, and
    // `collection_method` belongs after `products`.
    parts.push(`<is_verified_purchase>${verified ? 'true' : 'false'}</is_verified_purchase>`);
    // Emitted honestly rather than omitted. Google asks for it, and the FTC requires
    // incentivised reviews to be identified.
    parts.push(`<is_incentivized_review>${r.isIncentivized ? 'true' : 'false'}</is_incentivized_review>`);
    parts.push(`<review_timestamp>${r.reviewDate.toISOString()}</review_timestamp>`);
    if (r.title) parts.push(`<title>${xmlEscape(r.title)}</title>`);
    parts.push(`<content>${xmlEscape(r.body)}</content>`);
    parts.push(`<review_url type="singleton">${xmlEscape(url)}#reviewmaster-reviews</review_url>`);
    parts.push(`<ratings><overall min="1" max="5">${r.rating}</overall></ratings>`);
    parts.push('<products><product>');
    // No `product_ids`. It is optional in the 2.3 schema, and the identifier containers
    // it holds (`gtins`, `mpns`, `skus`) each require at least one child — so emitting
    // them empty, as an earlier version did, is schema-invalid and risks Google rejecting
    // the whole feed rather than one review. We hold no GTIN or SKU (Product carries
    // neither), so matching is on `product_url`, which is the identifier Google falls
    // back to and the one that lines up with `link` in the merchant's Shopping feed.
    parts.push(`<product_name>${xmlEscape(r.product.title)}</product_name>`);
    parts.push(`<product_url>${xmlEscape(url)}</product_url>`);
    parts.push('</product></products>');
    parts.push(`<collection_method>${verified ? 'post_fulfillment' : 'unsolicited'}</collection_method>`);
    parts.push('</review>');
  }

  parts.push('</reviews>');
  parts.push('</feed>');

  return parts.join('\n');
}
