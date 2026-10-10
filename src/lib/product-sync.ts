import { db } from './db';
import { fetchShopCurrency, fetchShopifyProducts } from './shopify';

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
 * Not a page size — `fetchShopifyProducts` follows cursors internally, SYNC_PAGE_SIZE (100)
 * at a time, so this ceiling is reached in 50 round trips. This
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
  /** Existing products whose title, handle or image changed in Shopify. */
  updated: number;
  /** The store's currency after the sync (ISO 4217), or null while it is unknown. */
  currency: string | null;
}

export interface SyncOptions {
  /**
   * The shop's currency, when the caller read it from Shopify moments ago. The install path
   * has: its shop-info query carries currencyCode, so asking again here would be a second
   * round trip for the same answer.
   */
  knownCurrency?: string | null;
}

export async function syncProducts(
  storeId: string,
  shop: string,
  accessToken: string,
  onUnauthorized?: () => Promise<string | null>,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const products = await fetchShopifyProducts(shop, accessToken, MAX_PRODUCTS, onUnauthorized);

  // The prices below are in the shop's default currency and carry no unit of their own, so
  // the sync records which currency that is. refreshStoreCurrency never throws: a sync that
  // fetched its products must not fail because a one-scalar query did not come back.
  //
  // After the products rather than alongside them. Both would share `onUnauthorized`, which
  // refreshes the token with no single-flight guard (tokenRefresherFor), so two concurrent
  // 401s would spend the same refresh token twice.
  const currency = options.knownCurrency
    ? options.knownCurrency
    : await refreshStoreCurrency(storeId, shop, accessToken, onUnauthorized);

  if (products.length === 0) {
    return { created: 0, updated: 0, alreadyPresent: 0, fetched: 0, truncated: false, currency };
  }

  // One query for what we already hold, rather than one per product. The previous version
  // issued a findFirst per product, so a 250-product catalogue meant 250 round trips to a
  // database on a Burstable tier — slow enough to time out, which then triggered the
  // fallback that invented products.
  const existing = await db.product.findMany({
    where: { storeId, shopifyId: { in: products.map((p) => String(p.id)) } },
    select: { id: true, shopifyId: true, title: true, handle: true, image: true },
  });
  const known = new Map(existing.map((e) => [e.shopifyId, e]));
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
        // In the shop's default currency (Store.currency, recorded above), not a fixed one.
        price: p.variants?.[0]?.price ? parseFloat(p.variants[0].price) : null,
        vendor: p.vendor || null,
        productType: p.product_type || null,
        tags: p.tags || null,
      })),
      skipDuplicates: true,
    });
  }

  // A product already here keeps up with Shopify too. This used to add new products and
  // leave the rest alone, so a renamed product kept its old title in every dropdown and
  // every review page forever — the sync button said "already synced" while showing a
  // name the merchant had changed weeks ago. Only the three fields a merchant sees are
  // compared, and only rows that differ are written.
  const changed = products.filter((p) => {
    const k = known.get(String(p.id));
    if (!k) return false;
    return k.title !== p.title || (k.handle ?? '') !== (p.handle ?? '') || (k.image ?? null) !== (p.image?.src || null);
  });
  for (let i = 0; i < changed.length; i += 25) {
    await Promise.all(
      changed.slice(i, i + 25).map((p) =>
        db.product.update({
          where: { id: known.get(String(p.id))!.id },
          data: { title: p.title, handle: p.handle, image: p.image?.src || null },
        })
      )
    );
  }

  return {
    created: fresh.length,
    updated: changed.length,
    alreadyPresent: products.length - fresh.length,
    fetched: products.length,
    truncated: products.length >= MAX_PRODUCTS,
    currency,
  };
}

/**
 * Ask Shopify for the shop's default currency and record it on the store.
 *
 * Best effort, and never throws: a currency that could not be refreshed leaves the stored
 * one in place, which is at worst as stale as it already was. Returns the currency the
 * store holds afterwards (the fresh one, or the stored one when Shopify could not be
 * asked), or null when neither is known.
 */
export async function refreshStoreCurrency(
  storeId: string,
  shop: string,
  accessToken: string,
  onUnauthorized?: () => Promise<string | null>
): Promise<string | null> {
  let fresh: string | null = null;
  try {
    fresh = await fetchShopCurrency(shop, accessToken, onUnauthorized);
  } catch (err) {
    console.error('[product-sync] could not read the shop currency for', shop, '- keeping the stored one', err);
  }

  try {
    if (fresh) {
      // Written only when it changed, so a routine sync does not restamp Store.updatedAt,
      // which the operator portal shows. The explicit null arm is needed: `not` compiles to
      // <>, and in SQL NULL <> 'INR' is not true, so a store with no currency yet would never
      // match without it. updateMany rather than update because matching nothing is the
      // normal case (the currency has not changed), and update would throw P2025 for it.
      await db.store.updateMany({
        where: { id: storeId, OR: [{ currency: null }, { currency: { not: fresh } }] },
        data: { currency: fresh },
      });
      return fresh;
    }
    const row = await db.store.findUnique({ where: { id: storeId }, select: { currency: true } });
    return row?.currency ?? null;
  } catch (err) {
    console.error('[product-sync] could not record the shop currency for', shop, err);
    return fresh;
  }
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
  accessToken: string,
  options: SyncOptions = {}
): void {
  syncProducts(storeId, shop, accessToken, undefined, options).then(
    (result) => console.log(`[product-sync] ${shop}: created ${result.created} of ${result.fetched}`),
    (err) => console.error('[product-sync] initial sync failed for', shop, err)
  );
}
