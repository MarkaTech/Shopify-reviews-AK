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
 * Webhook registration is fired and not awaited: it is several Admin API calls, and a
 * merchant should not wait on them to see their dashboard. A failure is logged and
 * recovered on the next install or manual re-register — losing a webhook is recoverable,
 * making the merchant stare at a spinner is not.
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

  registerWebhooks(shop, accessToken).catch((err) => {
    console.error('[install] webhook registration failed for', shop, err);
  });

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
