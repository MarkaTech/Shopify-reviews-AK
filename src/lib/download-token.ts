import crypto from 'crypto';

/**
 * Short-lived, single-purpose download links.
 *
 * The embedded admin authenticates every request with an App Bridge session token in a
 * header, which a browser download cannot carry: a new tab opened on the file's URL
 * sends cookies, and under managed installation there is no session cookie. So the app
 * mints a link that proves who asked for it instead — the store id, a purpose and an
 * expiry, signed with the app's key — and the download route accepts that in place of
 * the header. Five minutes is long enough to click "Template" and short enough that a
 * forwarded link is useless by the time it is read.
 *
 * Signed, not encrypted: the payload is a store id and a purpose, neither secret. What
 * matters is that nobody can mint one for another store, which the HMAC guarantees.
 */

const TTL_MS = 5 * 60 * 1000;

function key(): string {
  const k = process.env.TOKEN_ENCRYPTION_KEY?.trim() || process.env.SHOPIFY_API_SECRET?.trim();
  if (!k) throw new Error('TOKEN_ENCRYPTION_KEY is not set; download links cannot be signed.');
  return k;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', key()).update(`download.${payload}`).digest('base64url');
}

export function issueDownloadToken(storeId: string, purpose: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ s: storeId, p: purpose, e: now + TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** The store id the token was minted for, or null if it is forged, expired or for another purpose. */
export function verifyDownloadToken(token: string | null | undefined, purpose: string, now = Date.now()): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const given = token.slice(dot + 1);
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { s?: unknown; p?: unknown; e?: unknown };
    if (typeof data.s !== 'string' || data.p !== purpose || typeof data.e !== 'number' || data.e < now) return null;
    return data.s;
  } catch {
    return null;
  }
}
