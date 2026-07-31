import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { suppress } from '@/lib/suppression';

/**
 * One-click unsubscribe, for the List-Unsubscribe header on shopper-facing mail.
 *
 * Gmail and Yahoo require bulk senders to support this, and the practical reason is
 * sharper than the rule: given only a spam button, a recipient who no longer wants review
 * invitations will press it. That is a complaint against a sending domain every merchant
 * on this platform shares, and SES suspends above 0.1%.
 *
 * Token, not a raw address
 * ------------------------
 * The link carries an HMAC of the address rather than the address itself, so:
 *
 *   - The URL cannot be edited to unsubscribe somebody else. A plain `?email=` parameter
 *     would let anyone suppress any address they can guess, which is a denial-of-email
 *     attack on every merchant's customers at once.
 *   - The address does not appear in a URL, so it stays out of proxy logs, referrer
 *     headers and browser history.
 *
 * Both GET and POST are handled: POST is what one-click clients send, GET is what a person
 * clicking the link in a mail client gets.
 */

export const dynamic = 'force-dynamic';

const SECRET = process.env.NEXTAUTH_SECRET || '';

/** Build the token that goes in the unsubscribe URL. */
export function unsubscribeToken(email: string): string {
  return crypto
    .createHmac('sha256', SECRET)
    .update(email.trim().toLowerCase())
    .digest('base64url');
}

/**
 * Verify a token against an address.
 *
 * The address travels in the link too, but only as the thing being *claimed* — it is the
 * token that authorises. Compared in constant time so the endpoint does not leak, through
 * timing, how much of a guessed token was correct.
 */
function tokenMatches(email: string, token: string): boolean {
  if (!SECRET || !email || !token) return false;
  const expected = Buffer.from(unsubscribeToken(email), 'utf8');
  const provided = Buffer.from(token, 'utf8');
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

function page(title: string, message: string, ok: boolean): NextResponse {
  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;padding:48px 16px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937">
  <div style="max-width:460px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;text-align:center">
    <div style="font-size:32px;line-height:1;margin-bottom:12px">${ok ? '&#10003;' : '&#9888;'}</div>
    <h1 style="margin:0 0 8px;font-size:18px">${title}</h1>
    <p style="margin:0;font-size:14px;line-height:1.6;color:#4b5563">${message}</p>
  </div>
</body></html>`;
  return new NextResponse(html, {
    status: ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const email = (searchParams.get('email') || '').trim();
  const token = (searchParams.get('t') || '').trim();

  if (!tokenMatches(email, token)) {
    return page(
      'That link is not valid',
      'It may have been altered or truncated by your email client. Replying to the message and asking to be removed works just as well.',
      false
    );
  }

  await suppress(email, 'unsubscribe', 'one-click unsubscribe');

  return page(
    'You will not hear from us again',
    'That address has been removed from all review invitations, from every store using ReviewMaster.',
    true
  );
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
