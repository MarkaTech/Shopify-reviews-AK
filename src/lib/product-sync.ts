import { db } from './db';
import { fetchShopifyProducts } from './shopify';

/**
 * Catalogue sync — pull a merchant's products from Shopify into our own table.
 *
 * Why this exists as a library rather than living in the route
 * -----------------------------------------------------------
 * It has two callers with different urgency: the install path, which runs it once so a
 * merchant's first view of the app is not empty, and the manual button, which runs it when
 * they think something is missing. Duplicating it produced the failure it was meant to
 * prevent — a store where reviews could not attach to products because nobody had pressed
 * a button they never saw.
 *
 * Products are why the rest of the app works. A review with `productId: null` is created,
 * counted against the plan, and then displayed nowhere: not on the product page widget, not
 * in the rating metafields, not in the feed. That failure is completely silent, which is
 * what makes an unsynced catalogue so much worse than it sounds.
 *
 * What this deliberately does NOT do
 * ----------------------------------
 * It does not invent products. An earlier version fell back to a hardcoded sample
 * catalogue whenever the Shopify call threw — a throttled response on a merchant's first
 * click left ten fictional products in their app, permanently, with no way to remove them.
 * A sync that cannot reach Shopify must fail and say so.
 */

/**
 * Upper bound on a single sync.
 *
 * Not a page size — `fetchShopifyProducts` follows cursors internally, 250 at a time. This
 * is the point at which we stop, so that a store with a six-figure catalogue cannot hold a
 * request open indefinitely or exhaust memory. Stores past this get the first 5,000 and
 * their remaining products arrive through `products/create` and `products/update` webhooks.
 */
const MAX_PRODUCTS = 5000;

export interface SyncResult {
  created: number;
  alreadyPresent: number;
  fetched: number;
  truncated: boolean;
}

export async function syncProducts(
  storeId: string,
  shop: string,
  accessToken: string,
  onUnauthorized?: () => Promise<string | null>
): Promise<SyncResult> {
  const products = await fetchShopifyProducts(shop, accessToken, MAX_PRODUCTS, onUnauthorized);

  if (products.length === 0) {
    return { created: 0, alreadyPresent: 0, fetched: 0, truncated: false };
  }

  // One query for what we already hold, rather than one per product. The previous version
  // issued a findFirst per product, so a 250-product catalogue meant 250 round trips to a
  // database on a Burstable tier — slow enough to time out, which then triggered the
  // fallback that invented products.
  const existing = await db.product.findMany({
    where: { storeId, shopifyId: { in: products.map((p) => String(p.id)) } },
    select: { shopifyId: true },
  });
  const known = new Set(existing.map((e) => e.shopifyId));

  const fresh = products.filter((p) => !known.has(String(p.id)));

  if (fresh.length > 0) {
    await db.product.createMany({
      data: fresh.map((p) => ({
        storeId,
        shopifyId: String(p.id),
        title: p.title,
        handle: p.handle,
        description: p.body_html || null,
        image: p.image?.src || null,
        price: p.variants?.[0]?.price ? parseFloat(p.variants[0].price) : null,
        vendor: p.vendor || null,
        productType: p.product_type || null,
        tags: p.tags || null,
      })),
      // A concurrent webhook may have created the same product between the read above and
      // this write. Skipping is correct: the row exists either way.
      skipDuplicates: true,
    });
  }

  return {
    created: fresh.length,
    alreadyPresent: products.length - fresh.length,
    fetched: products.length,
    truncated: products.length >= MAX_PRODUCTS,
  };
}

/**
 * Fire a sync without making the caller wait, and without letting a failure propagate.
 *
 * Used on the install path: a merchant should see their dashboard immediately, and a
 * catalogue that arrives a few seconds later is a better trade than a spinner. The manual
 * sync button remains as the recovery path, and it reports errors properly.
 */
export function syncProductsInBackground(
  storeId: string,
  shop: string,
  accessToken: string
): void {
  syncProducts(storeId, shop, accessToken).then(
    (result) => console.log(`[product-sync] ${shop}: created ${result.created} of ${result.fetched}`),
    (err) => console.error('[product-sync] initial sync failed for', shop, err)
  );
}
