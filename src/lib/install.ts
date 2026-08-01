/**
 * Store provisioning, shared by both install paths.
 *
 * Two things can bring a store into existence:
 *
 *   1. **Managed installation** (the path Shopify wants). Shopify installs the app and
 *      loads our embedded page. The page presents a session token, we exchange it for an
 *      offline access token, and the store is created on that first request. No redirect,
 *      no `state` nonce, no callback HMAC.
 *   2. **The legacy OAuth callback**, kept while the managed flow beds in.
 *
 * Both end here so they cannot drift. A field added to one and not the other shows up as
 * "works when I install fresh, broken when I reinstall" — the kind of bug that only
 * appears in front of an app reviewer.
 */

import { db } from './db';
import { encryptToken } from './crypto';
import { markWebhooksRegistered } from './webhook-health';
import { syncProductsInBackground } from './product-sync';
import {
  exchangeSessionTokenForAccessToken,
  fetchShopifyShop,
  registerWebhooks,
  type ShopifyTokenSet,
} from './shopify';

export const SHOP_DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

/**
 * Create or refresh a store record from a freshly issued token set.
 *
 * Two things happen in the background afterwards, neither awaited, because a merchant
 * should see their dashboard rather than a spinner:
 *
 *   - **Webhook registration**, retried on the first request of every process until it
 *     succeeds once. Firing it and forgetting used to mean a single rate-limited call
 *     during install left a merchant with no `orders/fulfilled` subscription forever.
 *   - **Catalogue sync**, so the app is not empty on first open. Without it, reviews
 *     submitted before someone found the manual sync button were created with no product
 *     attached and displayed nowhere — silently.
 */
export async function provisionStore(shop: string, tokens: ShopifyTokenSet) {
  const accessToken = tokens.accessToken;
  const shopInfo = await fetchShopifyShop(shop, accessToken);

  // Both secrets encrypted at rest — see src/lib/crypto.ts. The refresh token is the more
  // sensitive of the pair: it mints new access tokens for 90 days.
  const storeFields = {
    name: shopInfo.name,
    domain: shopInfo.domain,
    shopifyUrl: `https://${shop}`,
    shopifyDomain: shop,
    accessToken: encryptToken(accessToken),
    refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
    tokenExpiresAt: tokens.expiresAt,
    refreshTokenExpiresAt: tokens.refreshExpiresAt,
    email: shopInfo.email || null,
    isActive: true,
    installedAt: new Date(),
  };

  const store = await db.store.upsert({
    where: { shopifyDomain: shop },
    update: storeFields,
    create: storeFields,
  });

  registerWebhooks(shop, accessToken).then(
    () => markWebhooksRegistered(store.id),
    (err) => {
      // No marker on failure — ensureWebhooks retries on the next request.
      console.error('[install] webhook registration failed for', shop, '— will retry', err);
    }
  );

  syncProductsInBackground(store.id, shop, accessToken);

  return store;
}

/**
 * Bootstrap a store from a verified session token.
 *
 * Called when a request arrives with a good session token but we have no usable
 * installation — a first load under managed install, a reinstall after uninstall, or a
 * store whose refresh token expired and needs a fresh grant.
 *
 * The caller MUST have verified the session token's signature first. This function trusts
 * `shop` completely, and it is used to build an outbound request URL — an unverified value
 * here is server-side request forgery.
 */
export async function bootstrapFromSessionToken(shop: string, sessionToken: string) {
  if (!SHOP_DOMAIN_RE.test(shop)) {
    throw new Error(`Refusing to provision a non-Shopify domain: ${shop}`);
  }

  const tokens = await exchangeSessionTokenForAccessToken(shop, sessionToken);
  return provisionStore(shop, tokens);
}
