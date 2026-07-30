/**
 * Authentication middleware for the multi-tenant Shopify app.
 *
 * Two ways in, tried in this order:
 *
 *   1. **App Bridge session token** — a short-lived JWT in the Authorization header,
 *      signed by Shopify with our client secret. This is the path Shopify requires for
 *      embedded apps, and the only one that survives third-party cookie blocking.
 *   2. **Signed session cookie** — the original mechanism, kept as a fallback.
 *
 * The fallback is deliberate and temporary. It covers the non-embedded surfaces (the
 * standalone page a merchant lands on straight after OAuth, before App Bridge has loaded)
 * and means a deploy of the session-token work cannot log every merchant out mid-session.
 * It should be removed once the token path has been running in production for a while;
 * until then, the cookie remains a genuine authentication path and is treated as one.
 *
 * Either way the Shopify access token is loaded from the database and decrypted here. It
 * never travels to the browser.
 */

import { NextResponse } from 'next/server';
import { getShopifySession, SESSION_COOKIE_NAME } from './session';
import { db } from './db';
import { sessionTokenFromRequest, verifySessionToken, SessionTokenError } from './session-token';
import {
  getFreshAccessToken,
  ReauthRequiredError,
  tokenRefresherFor,
  TOKEN_SELECT,
} from './shopify-token';

interface AuthContext {
  shop: string;
  /** Guaranteed valid for at least the next 5 minutes. */
  accessToken: string;
  storeId: string;
  /** Which mechanism authenticated this request. Useful for measuring the migration. */
  via: 'session_token' | 'cookie';
  /**
   * Pass as the last argument to any Shopify helper. On a 401 it mints a replacement
   * token and the call is retried once.
   */
  onUnauthorized: () => Promise<string | null>;
}

class UnauthorizedError extends Error {
  status = 401;
  constructor(message = 'Unauthorized: No valid session. Please install the app first.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Authenticate a request and return session context.
 *
 * Async because the access token is now fetched and decrypted server-side rather than
 * read out of the cookie. Every caller must await this.
 */
export async function withAuth(request: Request): Promise<AuthContext> {
  // ── 1. Session token ──
  const bearer = sessionTokenFromRequest(request);
  if (bearer) {
    let verified;
    try {
      verified = verifySessionToken(bearer);
    } catch (error) {
      // A present-but-invalid token is a hard failure, never a quiet downgrade to the
      // cookie. Falling through here would mean an attacker could strip the header — or
      // send a junk one — to select the weaker mechanism.
      const detail = error instanceof SessionTokenError ? error.message : 'verification failed';
      throw new UnauthorizedError(`Unauthorized: ${detail}`);
    }

    const store = await db.store.findUnique({
      where: { shopifyDomain: verified.shop },
      select: { ...TOKEN_SELECT, isActive: true },
    });

    if (!store || !store.isActive) {
      // The token is genuine but we have no installation for this shop — the app was
      // uninstalled, or this is a shop that has never installed it.
      throw new UnauthorizedError('Unauthorized: store not found or app uninstalled.');
    }

    return {
      shop: verified.shop,
      accessToken: await freshTokenOrReauth(store),
      storeId: store.id,
      via: 'session_token',
      onUnauthorized: tokenRefresherFor(store.id),
    };
  }

  // ── 2. Cookie fallback ──
  const session = getShopifySession(request);
  if (!session) throw new UnauthorizedError();

  const store = await db.store.findUnique({
    where: { id: session.storeId },
    select: { ...TOKEN_SELECT, isActive: true },
  });

  if (!store || !store.isActive) {
    throw new UnauthorizedError('Unauthorized: store not found or app uninstalled.');
  }

  // Guard against a signed cookie being replayed against a different store.
  if (store.shopifyDomain !== session.shop) {
    throw new UnauthorizedError('Unauthorized: session does not match store.');
  }

  return {
    shop: session.shop,
    accessToken: await freshTokenOrReauth(store),
    storeId: store.id,
    via: 'cookie',
    onUnauthorized: tokenRefresherFor(store.id),
  };
}

/**
 * Refreshes proactively when the 60-minute expiring token is within 5 minutes of the end
 * of its life, and transparently upgrades legacy non-expiring tokens in place.
 *
 * Shared by both authentication paths so they cannot drift — a token-refresh fix applied
 * to one and not the other would show up as "works in the embedded app, fails after
 * install" and be miserable to track down.
 */
async function freshTokenOrReauth(
  store: Parameters<typeof getFreshAccessToken>[0]
): Promise<string> {
  try {
    return await getFreshAccessToken(store);
  } catch (error) {
    if (error instanceof ReauthRequiredError) {
      throw new UnauthorizedError(`Unauthorized: ${error.message}`);
    }
    throw error;
  }
}

/** Optional auth — resolves to null instead of throwing. */
export async function withOptionalAuth(request: Request): Promise<AuthContext | null> {
  try {
    return await withAuth(request);
  } catch {
    return null;
  }
}

export function unauthorizedResponse(shop?: string): NextResponse {
  if (shop) {
    return NextResponse.json(
      { error: 'Unauthorized', installUrl: `/api/auth/install?shop=${shop}` },
      { status: 401 }
    );
  }
  return NextResponse.json(
    { error: 'Unauthorized: No valid session. Please install the app via Shopify.' },
    { status: 401 }
  );
}

/**
 * Build the Set-Cookie header for the session.
 *
 * SameSite=None; Secure is required, not optional: an embedded Shopify app renders inside
 * an iframe on admin.shopify.com, which makes every request to us cross-site. A Lax cookie
 * (the previous setting) is simply not sent in that context, so the merchant appears
 * logged out on every page load inside the Shopify admin. None requires Secure, which is
 * fine because Azure terminates TLS and the app is HTTPS-only.
 */
export function createSessionCookie(sessionValue: string, maxAge: number = 86400 * 30): string {
  const attrs = [
    `${SESSION_COOKIE_NAME}=${sessionValue}`,
    'Path=/',
    'HttpOnly',
    'SameSite=None',
    'Secure',
    `Max-Age=${maxAge}`,
  ];
  return attrs.join('; ');
}

export function createClearCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0`;
}

export { UnauthorizedError };
