/**
 * Operator (super-admin) authentication for the /admin portal.
 *
 * Completely separate from the merchant session in session.ts, on purpose:
 *
 *  - A different cookie name, so neither surface ever accepts the other's credential.
 *  - The HMAC is keyed over a purpose prefix, so even with the same NEXTAUTH_SECRET a
 *    merchant session cookie can never verify as an admin one, and vice versa.
 *  - Login is a single operator password (ADMIN_PORTAL_PASSWORD). With it unset the
 *    portal refuses outright — the same philosophy as CRON_SECRET: an admin surface that
 *    silently defaults open is worse than one that is down.
 *
 * The password itself is never stored in the cookie; the cookie is a signed
 * { role: 'admin', iat } assertion with a 12-hour lifetime.
 */

import crypto from 'crypto';

export const ADMIN_COOKIE_NAME = 'reviewmaster_admin';
const ADMIN_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours
const PURPOSE = 'reviewmaster-admin-v1';

const SECRET = process.env.NEXTAUTH_SECRET || '';

function requireSecret(): string {
  // createHmac('sha256', '') is valid and deterministic, so an empty secret must be a
  // hard refusal — otherwise "no secret" quietly becomes "a secret everyone knows".
  if (!SECRET) throw new Error('NEXTAUTH_SECRET is not configured — refusing admin sessions');
  return SECRET;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', requireSecret()).update(`${PURPOSE}.${payload}`).digest('hex');
}

/** Whether the portal is configured at all. */
export function adminPortalEnabled(): boolean {
  return Boolean(process.env.ADMIN_PORTAL_PASSWORD && SECRET);
}

/** Constant-time password check. */
export function verifyAdminPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PORTAL_PASSWORD || '';
  if (!expected) return false;
  return constantTimeEquals(candidate, expected);
}

/** Build the Set-Cookie value for a fresh admin session. */
export function issueAdminCookie(): string {
  const payload = Buffer.from(JSON.stringify({ role: 'admin', iat: Date.now() })).toString('base64url');
  const value = `${payload}.${sign(payload)}`;
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  return `${ADMIN_COOKIE_NAME}=${value}; Path=/;${secure} HttpOnly; SameSite=Lax; Max-Age=${ADMIN_SESSION_MAX_AGE_MS / 1000}`;
}

export function clearAdminCookie(): string {
  return `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/** True only for a cookie we signed, less than 12 hours old. */
export function isAdminRequest(request: Request): boolean {
  if (!SECRET) return false;
  const cookies = request.headers.get('cookie') || '';
  const match = cookies.split(/;\s*/).find((c) => c.startsWith(`${ADMIN_COOKIE_NAME}=`));
  if (!match) return false;
  const value = match.slice(ADMIN_COOKIE_NAME.length + 1);
  const parts = value.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  if (!constantTimeEquals(signature, sign(payload))) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (decoded.role !== 'admin' || typeof decoded.iat !== 'number') return false;
    if (Date.now() - decoded.iat > ADMIN_SESSION_MAX_AGE_MS) return false;
    return true;
  } catch {
    return false;
  }
}
