/**
 * Shop app syndication via Shopify's standard `product_review` metaobject.
 *
 * What this is
 * ------------
 * Shopify's Standard Product Review Syndication Program went generally available on
 * 6 June 2025. Writing reviews into the standard `product_review` metaobject is how a
 * review app gets a merchant's reviews to appear in the **Shop app**, and it is fast
 * becoming the price of admission for a serious review app rather than a differentiator.
 *
 * What it costs to participate
 * ----------------------------
 * This is not a scope you can simply request in code. The program requires:
 *
 *   1. Requesting test access in the Partner Dashboard (API Access -> standard product
 *      reviews scope card), which enables the scopes on a dev store and turns on the Shop
 *      channel for testing.
 *   2. Implementing and testing in the Shop app.
 *   3. Submitting for app review, naming the production app IDs to opt in.
 *   4. **Signing a review-specific amendment to the Shopify Partner Agreement.**
 *
 * Until step 4 completes, `write_product_reviews` is not granted and every call here
 * fails with an access-denied error. That is why `isSyndicationEnabled` exists and why
 * every entry point degrades quietly: the app must work perfectly without this, and
 * light up the moment the scope arrives.
 *
 * The obligations that come with it
 * ---------------------------------
 * Joining is a commitment, not a feature toggle:
 *
 *   - **Syndicate everything.** All valid reviews must be written as metaobject entries.
 *     Cherry-picking the flattering ones is precisely what the program forbids — and
 *     what the FTC, the EU Omnibus Directive and the UK DMCC Act each independently
 *     prohibit.
 *   - **Keep aggregates exact**, updated on every create, update, delete and
 *     publish-status change. See ratings.ts.
 *   - **Never send incentivised reviews.** Shop's merchant guidelines ban
 *     compensation-for-reviews outright, with no disclosure carve-out. This is stricter
 *     than the FTC, which permits incentives if disclosed. `isIncentivized` reviews are
 *     therefore excluded here even though they are perfectly legal to display on the
 *     merchant's own storefront.
 */

import { db } from './db';
import { getStorePlan, PLANS } from './plans';
import { callShopifyGraphQL } from './shopify';

export const PRODUCT_REVIEW_TYPE = 'product_review';

/** The three verification states Shopify accepts. Anything else is rejected. */
export type VerificationStatus = 'verified_buyer' | 'verified_reviewer' | 'unverified';

export const VERIFICATION_STATUSES: VerificationStatus[] = [
  'verified_buyer',
  'verified_reviewer',
  'unverified',
];

export function isVerificationStatus(v: string): v is VerificationStatus {
  return (VERIFICATION_STATUSES as string[]).includes(v);
}

/**
 * Map our stored status to Shopify's enum, defensively.
 *
 * A wrong value here is worse than a missing one: claiming `verified_buyer` for a review
 * with no matching order is a misrepresentation under FTC 16 CFR 465, so anything
 * unrecognised degrades to `unverified` rather than guessing upward.
 */
export function toShopifyVerification(
  status: string | null | undefined,
  legacyVerifiedPurchase: boolean,
  hasOrderMatch: boolean
): VerificationStatus {
  if (status && isVerificationStatus(status)) {
    // Never let a stored 'verified_buyer' survive without an order behind it.
    if (status === 'verified_buyer' && !hasOrderMatch) return 'verified_reviewer';
    return status;
  }
  // Legacy rows predate the three-state model. The old boolean meant "we believe this
  // came from a real customer", which is verified_reviewer — not verified_buyer, because
  // the old code set it in paths that had no order reference.
  if (legacyVerifiedPurchase) return hasOrderMatch ? 'verified_buyer' : 'verified_reviewer';
  return 'unverified';
}

const ENABLE_DEFINITION = `
  mutation EnableProductReview {
    standardMetaobjectDefinitionEnable(type: "${PRODUCT_REVIEW_TYPE}") {
      metaobjectDefinition { id type }
      userErrors { field code message }
    }
  }
`;

const METAOBJECT_UPSERT = `
  mutation UpsertProductReview($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject { id handle }
      userErrors { field code message }
    }
  }
`;

const METAOBJECT_DELETE = `
  mutation DeleteProductReview($id: ID!) {
    metaobjectDelete(id: $id) {
      deletedId
      userErrors { field code message }
    }
  }
`;

/**
 * Turn on the standard definition for a shop. Idempotent — "already enabled" is success.
 * Called once per install, after the scope has been granted.
 */
export async function enableSyndication(
  shop: string,
  accessToken: string,
  onUnauthorized?: () => Promise<string | null>
): Promise<boolean> {
  try {
    const data = await callShopifyGraphQL<{
      standardMetaobjectDefinitionEnable: {
        metaobjectDefinition: { id: string } | null;
        userErrors: Array<{ code?: string; message: string }>;
      };
    }>(shop, accessToken, ENABLE_DEFINITION, undefined, onUnauthorized);

    const errs = data.standardMetaobjectDefinitionEnable.userErrors ?? [];
    if (errs.length && !errs.some((e) => /already|taken|exists/i.test(e.message))) {
      console.warn(`[syndication] enable rejected for ${shop}:`, errs.map((e) => e.message).join('; '));
      return false;
    }
    return true;
  } catch (error) {
    // Missing scope lands here until the Partner Agreement amendment is signed. Expected,
    // not exceptional — log at info so it does not read as a fault in normal operation.
    console.info(`[syndication] not available for ${shop} (scope likely not granted):`, error);
    return false;
  }
}

/** Is syndication usable for this store right now? */
/**
 * Whether reviews should be pushed to the Shop app for this store.
 *
 * Two conditions, and it used to check only the second. The merchant's toggle said
 * whether they *want* syndication; nothing anywhere asked whether they are paying for
 * it. Settings sells this as "Shop app sync" on the Growth plan, so a Free store could
 * switch it on and get the feature — the flag existed in `plans.ts` and had no reader.
 *
 * Checked here rather than at the toggle because this is the choke point every caller
 * already goes through, and because entitlement has to hold at use time: gating only the
 * switch would leave a store that downgrades still syndicating, on a setting they turned
 * on while they were entitled to it.
 */
export async function isSyndicationEnabled(storeId: string): Promise<boolean> {
  const setting = await db.storeSetting.findUnique({
    where: { storeId_key: { storeId, key: 'syndication_enabled' } },
  });
  if (setting?.value !== 'true') return false;

  return PLANS[await getStorePlan(storeId)].shopSyndication;
}

export async function setSyndicationEnabled(storeId: string, enabled: boolean): Promise<void> {
  await db.storeSetting.upsert({
    where: { storeId_key: { storeId, key: 'syndication_enabled' } },
    create: { storeId, key: 'syndication_enabled', value: String(enabled) },
    update: { value: String(enabled) },
  });
}

interface SyndicatableReview {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  reviewerName: string;
  reviewDate: Date;
  publishedAt?: Date | null;
  isPublished: boolean;
  isIncentivized: boolean;
  verificationStatus: string;
  verifiedPurchase: boolean;
  shopifyOrderId: string | null;
  images: string | null;
  language: string | null;
  reply: string | null;
  repliedAt: Date | null;
  source: string;
  metaobjectId: string | null;
  product: { shopifyId: string | null } | null;
}

/**
 * Should this review go to Shop?
 *
 * Returns a reason string when the answer is no, so the merchant-facing UI can explain
 * an omission rather than silently dropping reviews — which would itself look like the
 * cherry-picking the program forbids.
 */
export function syndicationBlocker(review: SyndicatableReview): string | null {
  if (!review.product?.shopifyId) return 'Not linked to a Shopify product';
  if (review.isIncentivized) {
    return 'Incentivised reviews are not accepted by the Shop app';
  }
  if (!review.body?.trim()) return 'Review has no body text';
  if (review.rating < 1 || review.rating > 5) return 'Rating outside 1–5';
  return null;
}

/**
 * Write one review to Shopify as a `product_review` metaobject.
 *
 * Publication state maps to metaobject capability: published reviews are ACTIVE with a
 * `published_at`, unpublished are DRAFT with `published_at` null. That is how a review
 * pulled for moderation disappears from Shop without being deleted.
 */
export async function syndicateReview(
  shop: string,
  accessToken: string,
  review: SyndicatableReview,
  onUnauthorized?: () => Promise<string | null>
): Promise<{ ok: boolean; metaobjectId?: string; error?: string }> {
  const blocker = syndicationBlocker(review);
  if (blocker) return { ok: false, error: blocker };

  const verification = toShopifyVerification(
    review.verificationStatus,
    review.verifiedPurchase,
    Boolean(review.shopifyOrderId)
  );

  const publishedAt = review.publishedAt ?? review.reviewDate;

  const fields: Array<{ key: string; value: string }> = [
    {
      key: 'rating',
      value: JSON.stringify({
        scale_min: '1.0',
        scale_max: '5.0',
        value: String(review.rating.toFixed(1)),
      }),
    },
    { key: 'submitted_at', value: review.reviewDate.toISOString() },
    { key: 'source', value: review.source || 'direct' },
    { key: 'product', value: `gid://shopify/Product/${review.product!.shopifyId}` },
    { key: 'app_verification_status', value: verification },
    { key: 'author_display_name', value: review.reviewerName },
  ];

  if (review.title) fields.push({ key: 'title', value: review.title });
  if (review.body) fields.push({ key: 'body', value: review.body });
  if (review.shopifyOrderId) {
    fields.push({ key: 'order', value: `gid://shopify/Order/${review.shopifyOrderId}` });
  }
  if (review.reply) {
    fields.push({ key: 'merchant_reply', value: review.reply });
    if (review.repliedAt) {
      fields.push({ key: 'merchant_replied_at', value: review.repliedAt.toISOString() });
    }
  }
  if (review.language) fields.push({ key: 'language', value: review.language });
  if (review.isPublished) {
    fields.push({ key: 'published_at', value: publishedAt.toISOString() });
  }

  // media_urls is list.url — a JSON array of strings.
  if (review.images) {
    try {
      const urls = JSON.parse(review.images) as string[];
      const valid = urls.filter((u) => typeof u === 'string' && /^https?:\/\//.test(u));
      if (valid.length) fields.push({ key: 'media_urls', value: JSON.stringify(valid) });
    } catch {
      // Malformed image JSON should not sink the whole review.
    }
  }

  try {
    const data = await callShopifyGraphQL<{
      metaobjectUpsert: {
        metaobject: { id: string } | null;
        userErrors: Array<{ code?: string; message: string; field?: string[] }>;
      };
    }>(
      shop,
      accessToken,
      METAOBJECT_UPSERT,
      {
        // A stable handle derived from our own id makes this idempotent: re-running a
        // sync updates in place instead of creating duplicates.
        handle: { type: PRODUCT_REVIEW_TYPE, handle: `rm-${review.id}` },
        metaobject: {
          fields,
          capabilities: {
            publishable: { status: review.isPublished ? 'ACTIVE' : 'DRAFT' },
          },
        },
      },
      onUnauthorized
    );

    const errs = data.metaobjectUpsert.userErrors ?? [];
    if (errs.length) {
      return { ok: false, error: errs.map((e) => e.message).join('; ') };
    }
    const id = data.metaobjectUpsert.metaobject?.id;
    return id ? { ok: true, metaobjectId: id } : { ok: false, error: 'No metaobject returned' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Remove a syndicated review. Called when a review is deleted outright. */
export async function unsyndicateReview(
  shop: string,
  accessToken: string,
  metaobjectId: string,
  onUnauthorized?: () => Promise<string | null>
): Promise<boolean> {
  try {
    await callShopifyGraphQL(
      shop,
      accessToken,
      METAOBJECT_DELETE,
      { id: metaobjectId },
      onUnauthorized
    );
    return true;
  } catch (error) {
    console.error('[syndication] delete failed:', error);
    return false;
  }
}

/**
 * Sync one review by id, recording the outcome.
 *
 * Never throws. Syndication is best-effort relative to the merchant's own store: a Shop
 * app push failing must not block publishing a review on their storefront.
 */
export async function syncReviewToShop(
  storeId: string,
  reviewId: string,
  shopifyContext: {
    shop: string;
    accessToken: string;
    onUnauthorized?: () => Promise<string | null>;
  }
): Promise<void> {
  if (!(await isSyndicationEnabled(storeId))) return;

  const review = await db.review.findUnique({
    where: { id: reviewId },
    include: { product: { select: { shopifyId: true } } },
  });
  if (!review) return;

  const result = await syndicateReview(
    shopifyContext.shop,
    shopifyContext.accessToken,
    review as unknown as SyndicatableReview,
    shopifyContext.onUnauthorized
  );

  await db.review
    .update({
      where: { id: reviewId },
      data: result.ok
        ? { metaobjectId: result.metaobjectId, syncedAt: new Date(), syncError: null }
        : { syncError: (result.error ?? 'unknown').slice(0, 500) },
    })
    .catch(() => undefined);
}
