/**
 * Shopify session token (App Bridge ID token) verification.
 *
 * What this replaces, and why it has to
 * -------------------------------------
 * The app is embedded: it renders in an iframe on admin.shopify.com while being served
 * from azurewebsites.net. Every request the admin UI makes to us is therefore cross-site,
 * and the only thing identifying the merchant was a cookie. That has two problems, one
 * commercial and one that already affects real merchants:
 *
 *   - Shopify's automated pre-submission check blocks App Store submission for embedded
 *     apps that do not use session tokens. It has done since 6 January 2025.
 *   - A cookie set by our domain, read inside Shopify's page, is a third-party cookie.
 *     Safari has blocked those outright for years. A merchant on Safari installs the app
 *     and sees "Unauthorized" with nothing to debug.
 *
 * App Bridge hands the frontend a short-lived JWT signed with our client secret. Because
 * only Shopify and we hold that secret, a valid signature is proof the request came from a
 * genuine Shopify admin session. No shared browser state, nothing to block.
 *
 * Implemented directly rather than with a JWT library
 * ---------------------------------------------------
 * It is an HMAC-SHA256 verification and five claim checks. Pulling in a general-purpose
 * JWT library would add a dependency that supports algorithms we must never accept — and
 * the classic JWT vulnerability is exactly that: a library talked into `alg: none` or into
 * verifying an RS256 token with the public key as an HMAC secret. This only ever computes
 * HS256 and compares; it cannot be argued into anything else.
 *
 * The session token is NOT the Admin API access token. This one proves who is asking us;
 * the access token, which lives encrypted in the database, is what lets us call Shopify.
 * See shopify-token.ts for that half.
 */

import crypto from 'crypto';
import { shopifyClientId } from './client-id';

const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || '';

/**
 * Tolerance for clock drift between Shopify's servers and ours, in seconds.
 *
 * Session tokens live about a minute, so this cannot be generous. Ten seconds covers
 * ordinary NTP drift; anything larger starts to meaningfully extend the life of a token
 * that Shopify considers expired.
 */
const CLOCK_SKEW_SEC = 10;

export interface SessionTokenPayload {
  /** Shop admin domain, e.g. "https://store.myshopify.com/admin" */
  iss: string;
  /** Shop domain, e.g. "https://store.myshopify.com" */
  dest: string;
  /** Our client ID. */
  aud: string;
  /** The Shopify user this token was issued for. */
  sub: string;
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
  sid?: string;
}

export interface VerifiedSession {
  /** Normalised shop domain, e.g. "store.myshopify.com" — matches Store.shopifyDomain. */
  shop: string;
  /** Shopify user id, for logging. Never used for authorisation. */
  userId: string;
  /** Per-user, per-app session id, when present. */
  sessionId: string | null;
  expiresAt: Date;
}

export class SessionTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionTokenError';
  }
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

/**
 * Strip scheme and path from a claim, leaving the bare host.
 *
 * `iss` arrives as "https://store.myshopify.com/admin" and `dest` as
 * "https://store.myshopify.com". Both must describe the same shop, and the value we
 * compare against Store.shopifyDomain is the bare host.
 */
function hostOf(value: string): string {
  return String(value || '')
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .toLowerCase()
    .trim();
}

/**
 * Verify a session token and return the shop it belongs to.
 *
 * Throws SessionTokenError on anything suspicious. Callers must treat a throw as "reject
 * the request" — never as "fall through to a weaker check with the shop from this token",
 * because at that point the shop value is attacker-supplied.
 */
export function verifySessionToken(token: string): VerifiedSession {
  if (!SHOPIFY_API_SECRET) {
    // Refuse rather than skip. An app that silently stops verifying because an environment
    // variable is missing is worse than one that stops working: the failure is invisible.
    throw new SessionTokenError('SHOPIFY_API_SECRET is not configured');
  }

  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new SessionTokenError('Malformed token');

  const [headerB64, payloadB64, signatureB64] = parts;

  // ── Signature ──
  //
  // Checked before the payload is trusted for anything. Parsing first and validating later
  // is how "decode the claims, then decide whether to verify" bugs happen.
  const expected = crypto
    .createHmac('sha256', SHOPIFY_API_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest();

  const provided = base64UrlDecode(signatureB64);

  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    throw new SessionTokenError('Invalid signature');
  }

  // The algorithm is pinned to what we just computed. Reading `alg` from the header and
  // dispatching on it is the single most exploited weakness in JWT handling.
  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
  } catch {
    throw new SessionTokenError('Malformed header');
  }
  if (header.alg !== 'HS256') {
    throw new SessionTokenError(`Unexpected algorithm: ${header.alg}`);
  }

  let payload: SessionTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    throw new SessionTokenError('Malformed payload');
  }

  // ── Claims ──
  const now = Math.floor(Date.now() / 1000);

  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SEC < now) {
    throw new SessionTokenError('Token expired');
  }
  if (typeof payload.nbf !== 'number' || payload.nbf - CLOCK_SKEW_SEC > now) {
    throw new SessionTokenError('Token not yet valid');
  }

  // Without this, a token minted for a DIFFERENT app — signed with that app's secret, but
  // presented to us — would be rejected by the signature check anyway. The check matters
  // for the reverse: it stops a token we issued for one client ID being replayed after a
  // client ID change.
  if (!payload.aud || payload.aud !== shopifyClientId()) {
    throw new SessionTokenError('Token audience does not match this app');
  }

  const issHost = hostOf(payload.iss);
  const destHost = hostOf(payload.dest);
  if (!issHost || !destHost || issHost !== destHost) {
    throw new SessionTokenError('Token issuer and destination do not match');
  }

  // Only ever a myshopify.com domain. Anything else is not a shop we can serve, and
  // accepting it would let a crafted claim steer a database lookup.
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(destHost)) {
    throw new SessionTokenError('Token destination is not a Shopify domain');
  }

  return {
    shop: destHost,
    userId: String(payload.sub ?? ''),
    sessionId: payload.sid ?? null,
    expiresAt: new Date(payload.exp * 1000),
  };
}

/**
 * Pull the token out of an Authorization header.
 *
 * App Bridge's fetch interceptor sets this automatically for same-origin requests, and
 * apiFetch sets it explicitly as well — belt and braces, because the interceptor only
 * covers standard fetch calls.
 */
export function sessionTokenFromRequest(request: Request): string | null {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}
