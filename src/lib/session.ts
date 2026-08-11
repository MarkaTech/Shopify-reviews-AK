/**
 * Session management for the Shopify app.
 * HMAC-signed cookie carrying shop + storeId.
 *
 * The Shopify access token is deliberately NOT in the cookie. It used to be: the session
 * payload is only base64url-encoded (signed, not encrypted), so anyone who could read the
 * cookie — browser devtools, an XSS bug, a proxy log, a shared machine — recovered a
 * long-lived credential with full Admin API access to the merchant's store. The token now
 * lives encrypted in the database and is looked up server-side per request.
 */

import crypto from 'crypto';

const SESSION_COOKIE_NAME = 'reviewmaster_session';
/**
 * No fallback. This used to be `|| 'dev_secret_min_32_chars_long_for_testing'`.
 *
 * This value signs the merchant session cookie, which `withAuth` accepts as a full
 * authentication path. crypto.ts accepts TOKEN_ENCRYPTION_KEY *or* NEXTAUTH_SECRET, so an
 * environment with the former set and the latter missing booted and served normally while
 * every session cookie was signed with a string published in this repository. The payload
 * is only base64url — anyone who saw one cookie could read a storeId out of it and mint a
 * valid 30-day session for that shop.
 *
 * Empty means every signature comparison below fails, so the cookie path stops working
 * loudly rather than accepting forgeries quietly.
 */
const SESSION_SECRET = process.env.NEXTAUTH_SECRET || '';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, matches the cookie Max-Age

interface SessionData {
  shop: string;
  storeId: string;
  /** Issued-at, epoch ms. Lets us reject a stale cookie even if the browser kept it. */
  iat: number;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * An empty secret is a hard refusal, not a weak key.
 *
 * Worth spelling out, because "no fallback" alone would have made this worse rather than
 * better: `createHmac('sha256', '')` is perfectly valid and deterministic, so signing and
 * verifying with an empty secret both succeed — and an attacker can compute the same
 * digest. Dropping the hardcoded default without this check would have turned a shared
 * known secret into no secret at all.
 */
function requireSecret(): string {
  if (!SESSION_SECRET) {
    throw new Error('NEXTAUTH_SECRET is not configured — refusing to sign or verify sessions');
  }
  return SESSION_SECRET;
}

function encodeSession(data: SessionData): string {
  const secret = requireSecret();
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return `${payload}.${signature}`;
}

function decodeSession(cookieValue: string): SessionData | null {
  if (!SESSION_SECRET) {
    // Reject every cookie rather than validating against a known-empty key.
    console.error('[session] NEXTAUTH_SECRET is not configured — rejecting all cookie sessions');
    return null;
  }

  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('hex');

  if (!constantTimeEquals(signature, expectedSignature)) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.shop || !decoded.storeId) return null;

    // Reject sessions older than the intended lifetime regardless of browser behaviour.
    if (typeof decoded.iat !== 'number' || Date.now() - decoded.iat > SESSION_MAX_AGE_MS) {
      return null;
    }

    return decoded as SessionData;
  } catch {
    return null;
  }
}

/** Build a signed session value. Note: no access token. */
export function setShopifySession(shop: string, storeId: string): string {
  return encodeSession({ shop, storeId, iat: Date.now() });
}

export function getShopifySession(request: Request): SessionData | null {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parseCookies(cookieHeader);
  const sessionCookie = cookies[SESSION_COOKIE_NAME];
  if (!sessionCookie) return null;
  return decodeSession(sessionCookie);
}

export function clearShopifySession(): string {
  return ''; // Empty value + Max-Age=0 in Set-Cookie clears it
}

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [key, ...rest] = pair.trim().split('=');
    if (key && rest.length > 0) {
      cookies[key.trim()] = rest.join('=').trim();
    }
  }
  return cookies;
}

export { SESSION_COOKIE_NAME };
export type { SessionData };
