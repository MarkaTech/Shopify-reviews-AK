import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeAccessToken,
  fetchShopifyShop,
  registerWebhooks,
  SHOPIFY_APP_URL,
  verifyShopifyHmac,
} from '@/lib/shopify';
import { db } from '@/lib/db';
import { setShopifySession } from '@/lib/session';
import { createSessionCookie } from '@/lib/auth';
import { verifyAndConsumeNonce } from '@/lib/nonce';
import { encryptToken } from '@/lib/crypto';

const SHOP_DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const { searchParams } = url;
    // The RAW query string, exactly as Shopify sent it. searchParams.toString()
    // re-serialises with URLSearchParams' own encoding rules, which silently rewrites
    // things like the `=` padding on the base64 `host` value and makes it impossible to
    // check the signature against the on-the-wire form.
    const rawQuery = url.search.startsWith('?') ? url.search.slice(1) : url.search;
    const shop = searchParams.get('shop');
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    if (!shop || !code || !state) {
      return NextResponse.redirect(`${SHOPIFY_APP_URL}/?error=missing_params`);
    }

    // Validate the shop domain before it is used to build any outbound URL, otherwise the
    // token exchange below can be pointed at an attacker-controlled host (SSRF).
    if (!SHOP_DOMAIN_RE.test(shop)) {
      return NextResponse.redirect(`${SHOPIFY_APP_URL}/?error=invalid_shop`);
    }

    // Verify the HMAC over the full query string.
    //
    // This previously stripped &hmac= from the string before handing it to
    // verifyShopifyHmac, which then read hmac as '' and compared a 0-byte buffer against a
    // 64-byte digest. crypto.timingSafeEqual throws on length mismatch, so the call threw
    // a RangeError on EVERY callback and the catch below redirected to auth_failed —
    // meaning no merchant could ever complete an install. Pass the string through intact;
    // verifyShopifyHmac strips the hmac parameter itself, and checks both the encoded and
    // decoded canonical forms because Shopify's spec is ambiguous about which it signs.
    if (!verifyShopifyHmac(rawQuery)) {
      return NextResponse.redirect(`${SHOPIFY_APP_URL}/?error=invalid_hmac`);
    }

    // Verify the state nonce (CSRF) and confirm it was issued for THIS shop, so a nonce
    // obtained for one store cannot be replayed to authorise another.
    const nonceShop = await verifyAndConsumeNonce(state);
    if (!nonceShop || nonceShop !== shop) {
      return NextResponse.redirect(`${SHOPIFY_APP_URL}/?error=invalid_state`);
    }

    // Requests an EXPIRING offline token (expiring=1). A non-expiring one is rejected by
    // the Admin API for public apps created on or after 1 Apr 2026 — the 403 that was
    // blocking every billing charge.
    const tokens = await exchangeAccessToken(shop, code);
    const accessToken = tokens.accessToken;
    const shopInfo = await fetchShopifyShop(shop, accessToken);

    // Both secrets encrypted at rest — see src/lib/crypto.ts. The refresh token is the
    // more sensitive of the pair: it mints new access tokens for 90 days.
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
      console.error('Failed to register webhooks:', err);
    });

    // Session carries shop + storeId only; the token stays server-side.
    const sessionValue = setShopifySession(shop, store.id);

    const response = NextResponse.redirect(`${SHOPIFY_APP_URL}/?shop=${shop}`);
    response.headers.append('Set-Cookie', createSessionCookie(sessionValue));
    return response;
  } catch (error) {
    console.error('OAuth callback error:', error);
    return NextResponse.redirect(`${SHOPIFY_APP_URL}/?error=auth_failed`);
  }
}
