/**
 * Product rating aggregates, and the Shopify metafields that expose them.
 *
 * Why this module exists
 * ----------------------
 * `reviews.rating` and `reviews.rating_count` are *reserved standard metafield
 * definitions* on Shopify. They are the interop contract for the whole ecosystem:
 *
 *   - Dawn-family themes read them to render star ratings without any app code
 *   - Shopify's product feed for Google and Meta channels reads them
 *   - The Shop app reads them
 *
 * They are deliberately API-only — not visible or editable in the Shopify admin —
 * precisely so a merchant cannot hand-edit an aggregate rating. Every serious review
 * app writes to this exact namespace. An app that does not is invisible to all three
 * of those surfaces no matter how good its own widget is.
 *
 * Accuracy is a legal obligation, not a nicety
 * --------------------------------------------
 * Shopify's Standard Product Review Syndication Program requires aggregates to stay in
 * sync "on every create, update, delete, and publish-status change". Independently, the
 * FTC Rule (16 CFR 465.7(b)) and the UK CMA's fake-review guidance both require that
 * removing or hiding a review flows through to the displayed average — an aggregate that
 * silently keeps a deleted 1-star review's absence is a misrepresentation.
 *
 * So: every path that mutates a review must call `recomputeProductRating`. There is no
 * lazy or eventual option here.
 *
 * Why aggregates are materialised rather than computed on demand
 * -------------------------------------------------------------
 * The storefront widget and the metafield both need this number. Running COUNT/AVG per
 * product on every storefront request does not survive real traffic, and the metafield
 * push needs a value to send regardless. One row per product, recomputed on write.
 */

import { db } from './db';
import { callShopifyGraphQL } from './shopify';

/** Star histogram plus the derived average. */
export interface RatingAggregate {
  average: number;
  count: number;
  distribution: { 1: number; 2: number; 3: number; 4: number; 5: number };
}

export const EMPTY_AGGREGATE: RatingAggregate = {
  average: 0,
  count: 0,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
};

/**
 * Recompute the aggregate for one product from published reviews only.
 *
 * Unpublished reviews — awaiting moderation, or hidden for a policy violation — must not
 * count toward the public average, because the public average has to describe what a
 * shopper can actually read.
 *
 * Returns the new aggregate. Does NOT push to Shopify; call `syncRatingMetafields` for
 * that, so the caller can batch pushes or defer them past the response.
 */
export async function recomputeProductRating(
  storeId: string,
  productId: string
): Promise<RatingAggregate> {
  const grouped = await db.review.groupBy({
    by: ['rating'],
    where: { storeId, productId, isPublished: true },
    _count: { rating: true },
  });

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  let sum = 0;

  for (const row of grouped) {
    const stars = Math.min(5, Math.max(1, row.rating)) as 1 | 2 | 3 | 4 | 5;
    const n = row._count.rating;
    distribution[stars] += n;
    total += n;
    sum += stars * n;
  }

  // Round to one decimal. Shopify's `rating` metafield accepts more precision, but a
  // displayed "4.2857142857" is noise, and rounding once here keeps the widget, the
  // metafield and the JSON-LD in exact agreement rather than each rounding differently.
  const average = total === 0 ? 0 : Math.round((sum / total) * 10) / 10;

  const counts = {
    average,
    count: total,
    count1: distribution[1],
    count2: distribution[2],
    count3: distribution[3],
    count4: distribution[4],
    count5: distribution[5],
  };

  // Store-scoped write, not a bare upsert on the globally-unique productId.
  //
  // `ProductRating.productId` is unique across the whole table, so `upsert({ where: {
  // productId } })` would happily take the update branch on a row belonging to a different
  // merchant if a caller ever passed a foreign product id. Callers now validate ownership
  // before they get here (see lib/ownership.ts), but this function is the sink every path
  // funnels through and it should not depend on all of them being careful forever.
  //
  // updateMany with both keys is the guard: a row owned by another store matches zero
  // records and changes nothing.
  const updated = await db.productRating.updateMany({
    where: { productId, storeId },
    data: counts,
  });

  if (updated.count === 0) {
    try {
      await db.productRating.create({ data: { storeId, productId, ...counts } });
    } catch (error) {
      // A unique-constraint failure here means a row exists for this productId under a
      // DIFFERENT storeId — which should be impossible now, and is worth knowing about
      // rather than swallowing. The aggregate is recomputed from scratch on every change,
      // so skipping this one write loses nothing permanent.
      console.error(
        `[ratings] could not create ProductRating for product ${productId} in store ${storeId}:`,
        error
      );
    }
  }

  return { average, count: total, distribution };
}

const METAFIELDS_SET = `
  mutation SetProductRating($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
      userErrors { field message code }
    }
  }
`;

const METAFIELDS_DELETE = `
  mutation DeleteProductRating($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields { key namespace ownerId }
      userErrors { field message }
    }
  }
`;

/**
 * Push an aggregate to Shopify's standard rating metafields.
 *
 * The `rating` metafield type is a JSON object with a declared scale — a bare number is
 * rejected:
 *
 *   {"scale_min":"1.0","scale_max":"5.0","value":"4.3"}
 *
 * When a product drops to zero published reviews the metafields are DELETED rather than
 * set to zero. A zero-value rating metafield renders as an honest-looking "0.0 stars" in
 * themes, which is worse than no rating at all — it makes a product with no reviews look
 * unanimously hated.
 */
export async function syncRatingMetafields(
  shop: string,
  accessToken: string,
  shopifyProductGid: string,
  aggregate: RatingAggregate,
  onUnauthorized?: () => Promise<string | null>
): Promise<void> {
  if (aggregate.count === 0) {
    await callShopifyGraphQL<{
      metafieldsDelete: { userErrors: Array<{ message: string }> };
    }>(
      shop,
      accessToken,
      METAFIELDS_DELETE,
      {
        metafields: [
          { ownerId: shopifyProductGid, namespace: 'reviews', key: 'rating' },
          { ownerId: shopifyProductGid, namespace: 'reviews', key: 'rating_count' },
        ],
      },
      onUnauthorized
    ).catch((err) => {
      // Deleting a metafield that was never set is not an error worth failing on.
      console.warn(`[ratings] metafield delete for ${shopifyProductGid}:`, err);
      return null;
    });
    return;
  }

  const data = await callShopifyGraphQL<{
    metafieldsSet: {
      userErrors: Array<{ field?: string[]; message: string; code?: string }>;
    };
  }>(
    shop,
    accessToken,
    METAFIELDS_SET,
    {
      metafields: [
        {
          ownerId: shopifyProductGid,
          namespace: 'reviews',
          key: 'rating',
          type: 'rating',
          value: JSON.stringify({
            scale_min: '1.0',
            scale_max: '5.0',
            value: aggregate.average.toFixed(1),
          }),
        },
        {
          ownerId: shopifyProductGid,
          namespace: 'reviews',
          key: 'rating_count',
          type: 'number_integer',
          value: String(aggregate.count),
        },
      ],
    },
    onUnauthorized
  );

  const errs = data.metafieldsSet.userErrors;
  if (errs?.length) {
    throw new Error(`metafieldsSet: ${errs.map((e) => e.message).join('; ')}`);
  }
}

/**
 * Recompute and push, in one call. This is what mutation handlers should use.
 *
 * Deliberately never throws. A metafield push failing is a sync problem, not a reason to
 * fail the merchant's "publish review" click — the local aggregate is already correct and
 * `metafieldError` records what went wrong for a later retry.
 */
export async function updateProductRating(
  storeId: string,
  productId: string,
  shopifyContext?: {
    shop: string;
    accessToken: string;
    onUnauthorized?: () => Promise<string | null>;
  }
): Promise<RatingAggregate> {
  const aggregate = await recomputeProductRating(storeId, productId);

  if (!shopifyContext) return aggregate;

  const product = await db.product.findUnique({
    where: { id: productId },
    select: { shopifyId: true },
  });
  if (!product?.shopifyId) return aggregate;

  const gid = `gid://shopify/Product/${product.shopifyId}`;

  try {
    await syncRatingMetafields(
      shopifyContext.shop,
      shopifyContext.accessToken,
      gid,
      aggregate,
      shopifyContext.onUnauthorized
    );
    await db.productRating.update({
      where: { productId },
      data: { metafieldSyncedAt: new Date(), metafieldError: null },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ratings] metafield sync failed for product ${productId}:`, message);
    await db.productRating
      .update({ where: { productId }, data: { metafieldError: message.slice(0, 500) } })
      .catch(() => undefined);
  }

  return aggregate;
}

/**
 * Rebuild every aggregate for a store and push them all.
 *
 * For backfilling after an import, and for repairing drift. Sequential on purpose:
 * Shopify's GraphQL API is cost-throttled and a parallel burst across a large catalogue
 * gets rate-limited into failures that then need their own retry logic.
 */
export async function rebuildStoreRatings(
  storeId: string,
  shopifyContext?: {
    shop: string;
    accessToken: string;
    onUnauthorized?: () => Promise<string | null>;
  }
): Promise<{ products: number; failed: number }> {
  const products = await db.product.findMany({
    where: { storeId },
    select: { id: true },
  });

  let failed = 0;
  for (const p of products) {
    try {
      await updateProductRating(storeId, p.id, shopifyContext);
    } catch {
      failed++;
    }
  }

  return { products: products.length, failed };
}

/** Read a cached aggregate without recomputing. For storefront reads. */
export async function getProductRating(productId: string): Promise<RatingAggregate> {
  const row = await db.productRating.findUnique({ where: { productId } });
  if (!row) return EMPTY_AGGREGATE;
  return {
    average: row.average,
    count: row.count,
    distribution: {
      1: row.count1,
      2: row.count2,
      3: row.count3,
      4: row.count4,
      5: row.count5,
    },
  };
}
