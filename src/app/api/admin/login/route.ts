import { NextRequest, NextResponse } from 'next/server';
import {
  adminPortalEnabled,
  verifyAdminPassword,
  issueAdminCookie,
  clearAdminCookie,
  isAdminRequest,
} from '@/lib/admin-auth';
import { clientIp } from '@/lib/rate-limit';

/**
 * Operator login. Deliberately sparse in what it reveals:
 *  - Portal unconfigured and wrong password are the same 401 to the caller, so probing
 *    this endpoint cannot establish whether an admin portal exists at all.
 *  - Five attempts per IP per fifteen minutes. In-memory, which is fine for a
 *    single-instance deployment; the sweep already makes the same assumption.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const now = Date.now();
  const entry = attempts.get(ip);
  if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  let password = '';
  try {
    const body = await request.json();
    password = typeof body?.password === 'string' ? body.password : '';
  } catch {
    /* fall through to the failure path */
  }

  if (!adminPortalEnabled() || !password || !verifyAdminPassword(password)) {
    const current = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + WINDOW_MS };
    current.count += 1;
    attempts.set(ip, current);
    if (!adminPortalEnabled()) {
      console.error('[admin] login attempted but ADMIN_PORTAL_PASSWORD/NEXTAUTH_SECRET not configured');
    }
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  attempts.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', issueAdminCookie());
  return res;
}

/** Session probe for the portal shell: 200 when the cookie is good. */
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({ authenticated: true });
}

/** Logout lives here too (DELETE) so the portal needs one route for its whole session. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.headers.set('Set-Cookie', clearAdminCookie());
  return res;
}
