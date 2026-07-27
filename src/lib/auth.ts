/**
 * Authentication middleware for the multi-tenant Shopify app.
 * Resolves the session cookie to a shop + storeId, then loads the access token from the
 * database and decrypts it. The token never travels to the browser.
 */

import { NextResponse } from 'next/server';
import { getShopifySession, SESSION_COOKIE_NAME } from './session';
import { db } from './db';
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

  // Refreshes proactively when the 60-minute expiring token is within 5 minutes of the
  // end of its life, and transparently upgrades legacy non-expiring tokens in place.
  let accessToken: string;
  try {
    accessToken = await getFreshAccessToken(store);
  } catch (error) {
    if (error instanceof ReauthRequiredError) {
      throw new UnauthorizedError(`Unauthorized: ${error.message}`);
    }
    throw error;
  }

  return {
    shop: session.shop,
    accessToken,
    storeId: store.id,
    onUnauthorized: tokenRefresherFor(store.id),
  };
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
