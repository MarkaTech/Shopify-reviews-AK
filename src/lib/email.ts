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

export type SendResult =
  | { sent: true; provider: 'resend' | 'sendgrid'; id?: string }
  | { sent: false; reason: 'not_configured' | 'failed'; detail?: string };

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

function fromAddress(): string {
  return process.env.EMAIL_FROM?.trim() || 'ReviewMaster <onboarding@resend.dev>';
}

export function emailProvider(): 'resend' | 'sendgrid' | null {
  if (process.env.RESEND_API_KEY?.trim()) return 'resend';
  if (process.env.SENDGRID_API_KEY?.trim()) return 'sendgrid';
  return null;
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
    return provider === 'resend' ? await sendViaResend(msg) : await sendViaSendGrid(msg);
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
  storeName: string;
  customerName: string | null;
  orderNumber: string | null;
  itemTitles: string[];
  reviewUrl: string;
}

/**
 * The email a buyer receives after their order is fulfilled.
 * Plain, single-column, inline styles — the only layout that renders reliably across
 * Outlook, Gmail and Apple Mail.
 */
export function renderReviewRequestEmail(input: ReviewRequestEmailInput): EmailMessage & { to: string } {
  const greeting = input.customerName ? `Hi ${input.customerName},` : 'Hi,';
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
            Thanks for your order${orderRef} from <strong>${store}</strong>. Now that it has arrived,
            would you share what you thought? It takes about a minute and genuinely helps other shoppers.
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
          <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
            You received this because you bought from ${store}. This link is personal to your order —
            please don't forward it.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    greeting,
    '',
    `Thanks for your order${input.orderNumber ? ` #${input.orderNumber}` : ''} from ${input.storeName}.`,
    'Now that it has arrived, would you share what you thought? It takes about a minute.',
    '',
    ...(input.itemTitles.length ? input.itemTitles.slice(0, 8).map(t => `  - ${t}`) : []),
    '',
    'Write a review:',
    input.reviewUrl,
    '',
    `You received this because you bought from ${input.storeName}.`,
    "This link is personal to your order - please don't forward it.",
  ].join('\n');

  return {
    to: '',
    subject: `How was your order from ${input.storeName}?`,
    html,
    text,
  };
}
