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
import { bootstrapFromSessionToken } from './install';
import { noteAuthMechanism } from './auth-telemetry';
import { ensureWebhooks } from './webhook-health';
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

/** Requests that never carry side effects, so cross-site reads of them change nothing. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Refuse cookie-authenticated state changes that originated on another site.
 *
 * Only applies to the cookie path. A session-token request is immune by construction —
 * the token travels in an Authorization header that cross-site page script cannot set on
 * the merchant's behalf, and App Bridge mints it per request.
 */
function requireSameSiteForCookieAuth(request: Request): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  const site = request.headers.get('sec-fetch-site');
  if (site) {
    // `same-origin` is the app calling itself. `none` is a direct navigation, which
    // cannot be a scripted cross-site POST. `cross-site` and `same-site` are both
    // refused: a sibling subdomain is not this app.
    if (site === 'same-origin' || site === 'none') return;
    throw new UnauthorizedError('Unauthorized: cross-site request rejected.');
  }

  // No Sec-Fetch-Site. Fall back to Origin, which every browser sends on a cross-origin
  // POST — including the form-submission cases that skip preflight.
  const origin = request.headers.get('origin');
  if (!origin) return;

  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return;
  }

  if (origin !== requestOrigin) {
    throw new UnauthorizedError('Unauthorized: cross-site request rejected.');
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

    let store = await db.store.findUnique({
      where: { shopifyDomain: verified.shop },
      select: { ...TOKEN_SELECT, isActive: true },
    });

    // Managed installation bootstrap.
    //
    // Under Shopify's managed install there is no OAuth callback for us to handle — the
    // app is already installed and the merchant arrives holding a session token, with no
    // store row on our side. Exchanging that token for an offline access token here is
    // what creates the installation.
    //
    // The same path recovers a store whose record went stale: uninstalled and reinstalled,
    // or a refresh token that outlived its 90 days. Both used to require the merchant to
    // reinstall by hand.
    if (!store || !store.isActive || !store.accessToken) {
      try {
        const provisioned = await bootstrapFromSessionToken(verified.shop, bearer);
        store = await db.store.findUnique({
          where: { id: provisioned.id },
          select: { ...TOKEN_SELECT, isActive: true },
        });
      } catch (error) {
        console.error('[auth] token exchange failed for', verified.shop, error);
        throw new UnauthorizedError('Unauthorized: could not establish a session with Shopify.');
      }
    }

    if (!store || !store.isActive) {
      throw new UnauthorizedError('Unauthorized: store not found or app uninstalled.');
    }

    await noteAuthMechanism(store.id, 'session_token');

    const sessionAccessToken = await freshTokenOrReauth(store);
    // Self-healing: if webhook registration never succeeded for this store, try again now.
    // Fire and forget — a repair must never be able to fail a request.
    ensureWebhooks(store.id, verified.shop, sessionAccessToken);

    return {
      shop: verified.shop,
      accessToken: sessionAccessToken,
      storeId: store.id,
      via: 'session_token',
      onUnauthorized: tokenRefresherFor(store.id),
    };
  }

  // ── 2. Cookie fallback ──
  //
  // Guarded against cross-site use before anything else, because this is the only
  // ambiently-authenticated path in the app.
  //
  // The cookie has to be `SameSite=None` — an embedded Shopify app runs in a
  // cross-site iframe and the browser would not send it otherwise. That is exactly the
  // condition CSRF needs: any page on the internet could POST here and the browser would
  // attach the merchant's credentials. There was no Origin, Referer or Sec-Fetch check
  // anywhere in the app, and the routes reachable that way include `/api/bulk-upload`
  // (multipart, so no preflight — publishes attacker-authored reviews to the storefront)
  // and `/api/billing` (`request.json()` accepts `text/plain`, so a form post downgrades
  // the plan).
  //
  // `Sec-Fetch-Site` is the right control here rather than an anti-CSRF token: it is set
  // by the browser and cannot be forged by page script, it needs no per-form plumbing,
  // and it is understood by every browser Shopify admin supports. Requests with no
  // Origin and no Sec-Fetch-Site — server-to-server, curl, older clients — are allowed
  // through, since those carry no ambient cookie to abuse in the first place.
  requireSameSiteForCookieAuth(request);

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

  await noteAuthMechanism(store.id, 'cookie');

  const cookieAccessToken = await freshTokenOrReauth(store);
  ensureWebhooks(store.id, session.shop, cookieAccessToken);

  return {
    shop: session.shop,
    accessToken: cookieAccessToken,
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
