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
 * The address is *inside* the token, not beside it
 * ------------------------------------------------
 * This used to be `?email=someone@example.com&t=<hmac>`. The HMAC did its job — the URL
 * could not be edited to unsubscribe somebody else, which would otherwise be a
 * denial-of-email attack on every merchant's customers at once — but the comment here
 * claimed the address "does not appear in a URL, so it stays out of proxy logs, referrer
 * headers and browser history", and it plainly did appear. Azure App Service records full
 * query strings; so does every proxy and CDN in front of it. A customer's address was
 * written to access logs on every unsubscribe, and shown in the address bar of whoever
 * clicked — which is how it ends up in a screenshot.
 *
 * The address is now encrypted into the token with AES-256-GCM, so the URL carries no
 * readable personal data at all. GCM authenticates as well as encrypts, so tampering is
 * still caught: the same protection the HMAC gave, plus confidentiality.
 *
 * There is deliberately no branch for the old `?email=` form. Keeping one would mean
 * keeping the plaintext path alive, which is the thing being removed, and the app is not
 * live anywhere yet — no shopper holds an old link that matters.
 *
 * GET confirms, POST acts
 * -----------------------
 * Both verbs used to suppress on sight. The link also sits in the body of every
 * invitation, and mail gateways — Defender Safe Links, Proofpoint, Mimecast, Barracuda —
 * GET every link in a message at delivery time. So at scanning domains it was the gateway,
 * not the customer, pressing unsubscribe the moment the first invitation arrived. The
 * suppression list is platform-wide and keyed on the address alone, so one prefetch
 * removed that customer from every merchant's review programme at once: the reminder
 * quietly never went out, every later order at any store was never asked, and only the
 * operator portal could undo it.
 *
 * A GET now renders a one-button confirmation and changes nothing; the button POSTs. The
 * one-click path is untouched: an RFC 8058 client POSTs to the List-Unsubscribe URL with
 * `List-Unsubscribe=One-Click` as the body, which is why the mail advertises
 * List-Unsubscribe-Post. A gateway that POSTs to links is conceivable; a GET is the thing
 * they all do.
 */

export const dynamic = 'force-dynamic';

const SECRET = process.env.NEXTAUTH_SECRET || '';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * 32 bytes derived from the shared secret.
 *
 * An empty secret is refused rather than hashed. `createHash('sha256').update('')` is
 * valid and deterministic, so without this a misconfigured deployment would encrypt every
 * address under a key anyone can compute from nothing — and would look like it was
 * working.
 */
function key(): Buffer {
  if (!SECRET) throw new Error('NEXTAUTH_SECRET is not set; refusing to build unsubscribe links');
  return crypto.createHash('sha256').update(SECRET).digest();
}

/** Build the token that goes in the unsubscribe URL. The address is inside it. */
export function unsubscribeToken(email: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([
    cipher.update(email.trim().toLowerCase(), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
}

/**
 * Recover the address from a token, or null if it was altered, truncated or forged.
 *
 * No constant-time comparison here, and none needed: GCM's tag check is the
 * authentication, and it either passes or throws. A failure reveals nothing beyond
 * "wrong", which is what the old timing-safe HMAC comparison existed to protect.
 */
function emailFromToken(token: string): string | null {
  if (!SECRET || !token) return null;
  const raw = Buffer.from(token, 'base64url');
  if (raw.length <= IV_BYTES + TAG_BYTES) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, IV_BYTES));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    const email = Buffer.concat([
      decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
  } catch {
    return null;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The pages this route shows. Plain HTML, inline styles, no external assets: it opens
 * from a mail client, often inside a sandboxed preview, and must not depend on anything
 * else loading. Brand-neutral on purpose — the person clicked a link in the merchant's
 * email, not ours.
 */
function page(opts: { status: number; icon: string; title: string; message: string; extra?: string }): NextResponse {
  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(opts.title)}</title></head>
<body style="margin:0;padding:48px 16px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2937">
  <div style="max-width:460px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;text-align:center">
    <div style="font-size:32px;line-height:1;margin-bottom:12px">${opts.icon}</div>
    <h1 style="margin:0 0 8px;font-size:18px">${esc(opts.title)}</h1>
    <p style="margin:0;font-size:14px;line-height:1.6;color:#4b5563">${esc(opts.message)}</p>
    ${opts.extra ?? ''}
  </div>
</body></html>`;
  return new NextResponse(html, {
    status: opts.status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function invalidPage(): NextResponse {
  return page({
    status: 400,
    icon: '&#9888;',
    title: 'That link is not valid',
    message:
      'It may have been altered or truncated by your email client. Replying to the message and asking to be removed works just as well.',
  });
}

/** What a person sees after clicking the link. Nothing has happened yet. */
function confirmPage(token: string): NextResponse {
  // The token goes back out exactly as it came in; it is opaque to the page.
  const action = `/api/unsubscribe?t=${encodeURIComponent(token)}`;
  return page({
    status: 200,
    icon: '&#9993;',
    title: 'Unsubscribe from review invitations?',
    message:
      'Press the button to stop receiving review invitations at this address, from every store using Marka Reviews.',
    extra: `<form method="POST" action="${esc(action)}" style="margin:20px 0 0">
      <button type="submit" style="appearance:none;border:0;border-radius:8px;background:#1f2937;color:#fff;font:inherit;font-size:15px;font-weight:600;padding:12px 24px;min-height:44px;cursor:pointer">Unsubscribe</button>
    </form>`,
  });
}

function donePage(): NextResponse {
  return page({
    status: 200,
    icon: '&#10003;',
    title: 'You will not hear from us again',
    message:
      'That address has been removed from all review invitations, from every store using Marka Reviews.',
  });
}

function tokenFrom(request: NextRequest): string {
  return (new URL(request.url).searchParams.get('t') || '').trim();
}

export async function GET(request: NextRequest) {
  const token = tokenFrom(request);
  // Checked now so a broken link says so before a click rather than after one — but
  // nothing is suppressed here. This is the response a link scanner gets.
  if (!emailFromToken(token)) return invalidPage();
  return confirmPage(token);
}

export async function POST(request: NextRequest) {
  const email = emailFromToken(tokenFrom(request));
  if (!email) return invalidPage();

  // An RFC 8058 client sends exactly this body; the confirmation form above sends none.
  // Recorded on the suppression row so the operator portal can tell the two apart.
  const body = await request.text().catch(() => '');
  const oneClick = /list-unsubscribe=one-click/i.test(body);
  await suppress(email, 'unsubscribe', oneClick ? 'one-click unsubscribe' : 'unsubscribe link, confirmed');

  return donePage();
}
