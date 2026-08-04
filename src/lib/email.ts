/**
 * Transactional email.
 *
 * Deliberately provider-agnostic and dependency-free — both Resend and SendGrid are
 * called over plain HTTP with fetch. Adding an SDK would mean a new npm dependency, and
 * this project's Docker build already resolves dependencies loosely (--legacy-peer-deps),
 * so every avoided package is one less thing that can break a deploy.
 *
 * Configure ONE of these in the Azure app settings:
 *   RESEND_API_KEY    — https://resend.com
 *   SENDGRID_API_KEY  — https://sendgrid.com
 * Plus:
 *   EMAIL_FROM        — e.g. "ReviewMaster <reviews@yourdomain.com>"
 *
 * With none set, sending is skipped and reported as such. The review request is still
 * created and its link still works, so nothing is lost — it just has to be shared manually.
 */

import crypto from 'crypto';
import { isSuppressed } from './suppression';

export type SendResult =
  | { sent: true; provider: 'ses' | 'resend' | 'sendgrid'; id?: string }
  | { sent: false; reason: 'not_configured' | 'failed' | 'suppressed'; detail?: string };

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /**
   * One-click unsubscribe target, for shopper-facing mail.
   *
   * Gmail and Yahoo require List-Unsubscribe with one-click support from bulk senders, and
   * without it a review invitation is far more likely to be marked as spam than
   * unsubscribed from — which is the difference between a harmless opt-out and a complaint
   * against a domain every merchant on this platform shares.
   *
   * Merchant account notifications deliberately do not set this: they are account mail with
   * their own switches in Settings, and an unsubscribe link there would silently disable
   * the alerts a merchant relies on.
   */
  unsubscribeUrl?: string;
}

function fromAddress(): string {
  return process.env.EMAIL_FROM?.trim() || 'ReviewMaster <onboarding@resend.dev>';
}

export function emailProvider(): 'ses' | 'resend' | 'sendgrid' | null {
  // Explicit choice first. Detection by which credentials happen to exist breaks down
  // the moment two sets are present — which is exactly what happened when SES production
  // access was denied and the app needed to send through Resend while keeping the AWS
  // keys for the SNS suppression webhook and a later re-application.
  const explicit = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (explicit === 'ses' || explicit === 'resend' || explicit === 'sendgrid') return explicit;
  if (explicit === 'none') return null;
  if (explicit) console.warn(`[email] EMAIL_PROVIDER="${explicit}" is not recognised; falling back to detection`);

  if (process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim()) return 'ses';
  if (process.env.RESEND_API_KEY?.trim()) return 'resend';
  if (process.env.SENDGRID_API_KEY?.trim()) return 'sendgrid';
  return null;
}

// ── AWS Signature V4 ─────────────────────────────────────────────────────────────────
//
// Implemented directly rather than via @aws-sdk/client-ses: that package pulls in a large
// dependency tree, and this project's Docker build already resolves packages with
// --legacy-peer-deps. Every dependency avoided is one less thing that can break a deploy.
//
// Verified against AWS's published SigV4 test vectors.

function hmac(key: crypto.BinaryLike | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

export function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request');
}

export function buildCanonicalRequest(
  method: string,
  path: string,
  query: string,
  headers: Record<string, string>,
  payload: string
): { canonical: string; signedHeaders: string } {
  const sortedKeys = Object.keys(headers)
    .map(k => k.toLowerCase())
    .sort();

  const lower: Record<string, string> = {};
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = headers[k];

  const canonicalHeaders = sortedKeys
    .map(k => `${k}:${String(lower[k]).trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = sortedKeys.join(';');

  const canonical = [
    method,
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload),
  ].join('\n');

  return { canonical, signedHeaders };
}

export function buildAuthorization(opts: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  payload: string;
  amzDate: string; // YYYYMMDDTHHMMSSZ
}): string {
  const date = opts.amzDate.slice(0, 8);
  const scope = `${date}/${opts.region}/${opts.service}/aws4_request`;

  const { canonical, signedHeaders } = buildCanonicalRequest(
    opts.method, opts.path, opts.query, opts.headers, opts.payload
  );

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    opts.amzDate,
    scope,
    sha256Hex(canonical),
  ].join('\n');

  const signature = crypto
    .createHmac('sha256', signingKey(opts.secretAccessKey, date, opts.region, opts.service))
    .update(stringToSign, 'utf8')
    .digest('hex');

  return `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function sendViaSes(msg: EmailMessage): Promise<SendResult> {
  const region = process.env.AWS_SES_REGION?.trim() || process.env.AWS_REGION?.trim() || 'us-east-1';
  const host = `email.${region}.amazonaws.com`;
  const path = '/v2/email/outbound-emails';

  const payload = JSON.stringify({
    FromEmailAddress: fromAddress(),
    Destination: { ToAddresses: [msg.to] },
    ...(msg.replyTo ? { ReplyToAddresses: [msg.replyTo] } : {}),
    Content: {
      Simple: {
        Subject: { Data: msg.subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: msg.text, Charset: 'UTF-8' },
          Html: { Data: msg.html, Charset: 'UTF-8' },
        },
        // List-Unsubscribe-Post is what makes the header "one-click": without it, mail
        // clients render an unsubscribe link the recipient has to follow and confirm,
        // and most people press the spam button instead.
        ...(msg.unsubscribeUrl
          ? {
              Headers: [
                { Name: 'List-Unsubscribe', Value: `<${msg.unsubscribeUrl}>` },
                { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
              ],
            }
          : {}),
      },
    },
  });

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Host: host,
    'X-Amz-Date': amzDate,
  };
  if (process.env.AWS_SESSION_TOKEN?.trim()) {
    headers['X-Amz-Security-Token'] = process.env.AWS_SESSION_TOKEN.trim();
  }

  headers.Authorization = buildAuthorization({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!.trim(),
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!.trim(),
    region,
    service: 'ses',
    method: 'POST',
    path,
    query: '',
    headers,
    payload,
    amzDate,
  });

  const res = await fetch(`https://${host}${path}`, { method: 'POST', headers, body: payload });

  if (!res.ok) {
    return { sent: false, reason: 'failed', detail: `SES ${res.status}: ${(await res.text()).slice(0, 300)}` };
  }
  const body = (await res.json().catch(() => ({}))) as { MessageId?: string };
  return { sent: true, provider: 'ses', id: body.MessageId };
}

async function sendViaResend(msg: EmailMessage): Promise<SendResult> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress(),
      to: [msg.to],
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      // The same one-click unsubscribe the SES path carries. Gmail and Yahoo require it
      // for bulk senders regardless of which relay the mail travels through.
      ...(msg.unsubscribeUrl
        ? {
            headers: {
              'List-Unsubscribe': `<${msg.unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }
        : {}),
    }),
  });

  if (!res.ok) {
    return { sent: false, reason: 'failed', detail: `Resend ${res.status}: ${(await res.text()).slice(0, 300)}` };
  }
  const body = (await res.json().catch(() => ({}))) as { id?: string };
  return { sent: true, provider: 'resend', id: body.id };
}

async function sendViaSendGrid(msg: EmailMessage): Promise<SendResult> {
  // SendGrid wants the display name and address split apart.
  const m = fromAddress().match(/^(.*?)\s*<(.+)>$/);
  const from = m ? { name: m[1].trim(), email: m[2].trim() } : { email: fromAddress() };

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: msg.to }] }],
      from,
      subject: msg.subject,
      content: [
        { type: 'text/plain', value: msg.text },
        { type: 'text/html', value: msg.html },
      ],
      ...(msg.replyTo ? { reply_to: { email: msg.replyTo } } : {}),
    }),
  });

  if (!res.ok) {
    return { sent: false, reason: 'failed', detail: `SendGrid ${res.status}: ${(await res.text()).slice(0, 300)}` };
  }
  return { sent: true, provider: 'sendgrid' };
}

/** Send a message. Never throws — a failed email must not fail the webhook that triggered it. */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  const provider = emailProvider();
  if (!provider) return { sent: false, reason: 'not_configured' };

  try {
    // The suppression check lives here rather than at each call site, so a feature added
    // later cannot forget it. SES suspends a sender above a 5% bounce or 0.1% complaint
    // rate, and re-sending to an address that already hard-bounced is the quickest way
    // there — for every merchant at once, since the sending domain is shared.
    //
    // Inside the try, and failing CLOSED. If the lookup itself errors — an unmigrated
    // database, a connection blip — we do not send. Failing open would mean quietly
    // mailing addresses that already bounced at exactly the moment we cannot tell, which
    // is how a suspension happens; not sending is recoverable and loud.
    if (await isSuppressed(msg.to)) {
      return { sent: false, reason: 'suppressed' };
    }

    if (provider === 'ses') return await sendViaSes(msg);
    if (provider === 'resend') return await sendViaResend(msg);
    return await sendViaSendGrid(msg);
  } catch (err) {
    return { sent: false, reason: 'failed', detail: err instanceof Error ? err.message : String(err) };
  }
}

// ── Review request template ──────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface ReviewRequestEmailInput {
  /** Where the one-click unsubscribe link points. Required for shopper-facing mail. */
  unsubscribeUrl?: string;
  storeName: string;
  customerName: string | null;
  orderNumber: string | null;
  itemTitles: string[];
  reviewUrl: string;
  /** Softer copy for the second and third touch. Same single CTA, no pressure tactics. */
  isReminder?: boolean;
}

/**
 * The email a buyer receives after their order is fulfilled.
 * Plain, single-column, inline styles — the only layout that renders reliably across
 * Outlook, Gmail and Apple Mail.
 */
export function renderReviewRequestEmail(input: ReviewRequestEmailInput): EmailMessage & { to: string } {
  const greeting = input.customerName ? `Hi ${input.customerName},` : 'Hi,';
  const intro = input.isReminder
    ? `Just a gentle nudge — if you have a spare minute, we'd still love to hear what you thought of your order`
    : `Thanks for your order`;
  const orderRef = input.orderNumber ? ` #${escapeHtml(input.orderNumber)}` : '';
  const store = escapeHtml(input.storeName);

  const itemsHtml = input.itemTitles
    .slice(0, 8)
    .map(t => `<li style="margin:0 0 6px;color:#374151;">${escapeHtml(t)}</li>`)
    .join('');

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f6f7f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
        <tr><td>
          <p style="margin:0 0 16px;font-size:15px;color:#111827;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
            ${escapeHtml(intro)}${orderRef} from <strong>${store}</strong>.
            ${input.isReminder ? 'It takes about a minute and genuinely helps other shoppers.' : 'Now that it has arrived, would you share what you thought? It takes about a minute and genuinely helps other shoppers.'}
          </p>
          ${itemsHtml ? `<ul style="margin:0 0 20px;padding-left:20px;font-size:14px;">${itemsHtml}</ul>` : ''}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;">
            <tr><td style="border-radius:8px;background:#059669;">
              <a href="${input.reviewUrl}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
                Write a review
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 6px;font-size:12px;color:#6b7280;">Or paste this into your browser:</p>
          <p style="margin:0 0 20px;font-size:12px;color:#6b7280;word-break:break-all;">${input.reviewUrl}</p>
          <p style="margin:0 0 10px;font-size:12px;color:#9ca3af;line-height:1.5;">
            You received this because you bought from ${store}. This link is personal to your order —
            please don't forward it.
          </p>
          ${input.unsubscribeUrl ? `<p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
            Prefer not to receive these? <a href="${input.unsubscribeUrl}" style="color:#6b7280;">Unsubscribe</a>.
          </p>` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    greeting,
    '',
    `${intro}${input.orderNumber ? ` #${input.orderNumber}` : ''} from ${input.storeName}.`,
    input.isReminder ? 'It takes about a minute.' : 'Now that it has arrived, would you share what you thought? It takes about a minute.',
    '',
    ...(input.itemTitles.length ? input.itemTitles.slice(0, 8).map(t => `  - ${t}`) : []),
    '',
    'Write a review:',
    input.reviewUrl,
    '',
    `You received this because you bought from ${input.storeName}.`,
    "This link is personal to your order - please don't forward it.",
    ...(input.unsubscribeUrl
      ? ['', `Prefer not to receive these? Unsubscribe: ${input.unsubscribeUrl}`]
      : []),
  ].join('\n');

  return {
    to: '',
    subject: input.isReminder
      ? `A quick reminder from ${input.storeName}`
      : `How was your order from ${input.storeName}?`,
    html,
    text,
    unsubscribeUrl: input.unsubscribeUrl,
  };
}
