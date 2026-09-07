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
 *  - Five attempts per IP per fifteen minutes, plus a global ceiling. In-memory, which is
 *    fine for a single-instance deployment; the sweep already makes the same assumption.
 *
 * Why there are two counters
 * --------------------------
 * The per-IP counter is keyed on `clientIp`, which reads the FIRST entry of
 * `X-Forwarded-For` — a header the caller sets. That is the right trade for shopper-facing
 * throttling, where the worst case is an attacker rotating keys back to the unthrottled
 * rate they already had. It is the wrong trade here, because this endpoint guards a single
 * shared password that unlocks every merchant's data across all tenants, with no MFA and no
 * second factor. `curl -H 'X-Forwarded-For: 1.2.3.<n>'` walked straight past the ceiling.
 *
 * So the real control is GLOBAL_MAX_FAILURES: a counter with no attacker-controllable key
 * at all. Sixty failures in fifteen minutes closes the endpoint for the rest of the window,
 * for everyone.
 *
 * That is deliberately a denial-of-service on the operator portal, and that is the correct
 * trade here: the portal is used by one person a few times a week, an outage of it costs a
 * delayed support reply, and the alternative is an unbounded offline-speed guessing attack
 * on the only credential protecting cross-tenant access. The window is short and the log
 * line says exactly what happened.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

/** Unkeyed, so no header can move a request out of this bucket. */
const GLOBAL_MAX_FAILURES = 60;
let globalFailures = { count: 0, resetAt: 0 };

function globallyLocked(now: number): boolean {
  if (globalFailures.resetAt <= now) return false;
  return globalFailures.count >= GLOBAL_MAX_FAILURES;
}

function recordGlobalFailure(now: number): void {
  if (globalFailures.resetAt <= now) {
    globalFailures = { count: 0, resetAt: now + WINDOW_MS };
  }
  globalFailures.count += 1;
  if (globalFailures.count === GLOBAL_MAX_FAILURES) {
    console.error(
      `[admin] ${GLOBAL_MAX_FAILURES} failed operator logins within the window — locking ` +
        '/api/admin/login until it expires. This is what a distributed guessing attack ' +
        'looks like; rotate ADMIN_PORTAL_PASSWORD.'
    );
  }
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const now = Date.now();

  // Checked first, because it is the one ceiling a caller cannot route around.
  if (globallyLocked(now)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

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
    recordGlobalFailure(now);
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
