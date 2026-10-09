/**
 * Merchant notifications.
 *
 * Three things a merchant actually wants to hear about, and nothing else:
 *
 *   1. A new review arrived and is waiting for approval.
 *   2. Someone left a bad one. This is the urgent case — the window in which a public
 *      reply turns an angry customer around is measured in hours, and a merchant who finds
 *      out on Friday about a Tuesday one-star has already lost it.
 *   3. A weekly digest, for merchants who do not want an email per review.
 *
 * Design notes
 * ------------
 * **Never throws.** Every function here returns rather than raising. These are called from
 * `after()` on the storefront submission path; a notification failure must not turn a
 * successfully saved review into a 500 for the shopper who wrote it.
 *
 * **Opt-in, not opt-out, for the per-review email.** A store doing forty reviews a day does
 * not want forty emails, and the fastest way to make a merchant filter your domain to spam
 * is to send them one. Negative alerts default ON because they are rare and time-critical.
 *
 * **No merchant content in the subject line.** A review title is attacker-controlled text
 * from a public form. It appears in the body, escaped; it never shapes a header.
 */

import { db } from './db';
import { sendEmail, emailProvider, brandImageUrl, type SendResult } from './email';
import { APP_NAME, BRAND, BRAND_ASSETS } from './brand';

const PREFIX = 'notify.';

export interface NotificationSettings {
  /** Email on every new review. Off by default — high volume stores would drown. */
  newReview: boolean;
  /** Email immediately when a review lands at or below the threshold. On by default. */
  negativeReview: boolean;
  /** Weekly digest of review activity. */
  weeklySummary: boolean;
  /** Star rating at or below which a review counts as negative. */
  negativeThreshold: number;
  /** Where to send. Empty means "the address on the store record". */
  email: string;
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  newReview: false,
  negativeReview: true,
  weeklySummary: false,
  negativeThreshold: 2,
  email: '',
};

export const NOTIFICATION_KEYS = new Set(
  Object.keys(DEFAULT_NOTIFICATIONS).map((k) => `${PREFIX}${k}`)
);

export async function getNotificationSettings(storeId: string): Promise<NotificationSettings> {
  const rows = await db.storeSetting.findMany({
    where: { storeId, key: { startsWith: PREFIX } },
    select: { key: true, value: true },
  });

  const out: NotificationSettings = { ...DEFAULT_NOTIFICATIONS };
  for (const row of rows) {
    const field = row.key.slice(PREFIX.length) as keyof NotificationSettings;
    if (!(field in out)) continue;
    if (field === 'negativeThreshold') {
      const n = Number(row.value);
      if (Number.isFinite(n)) out.negativeThreshold = Math.min(5, Math.max(1, Math.round(n)));
    } else if (field === 'email') {
      out.email = row.value.slice(0, 200);
    } else {
      (out as unknown as Record<string, boolean>)[field] = row.value === 'true';
    }
  }
  return out;
}

export async function saveNotificationSettings(
  storeId: string,
  updates: Record<string, string>
): Promise<{ saved: number; rejected: string[] }> {
  const rejected: string[] = [];
  let saved = 0;

  for (const [key, rawValue] of Object.entries(updates)) {
    if (!NOTIFICATION_KEYS.has(key)) {
      rejected.push(key);
      continue;
    }
    let value = String(rawValue);

    if (key === `${PREFIX}email`) {
      value = value.trim().slice(0, 200);
      // An empty string is meaningful — it means "fall back to the store address" — so
      // only a non-empty value that fails to look like an address is a rejection.
      if (value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
        rejected.push(key);
        continue;
      }
    }

    await db.storeSetting.upsert({
      where: { storeId_key: { storeId, key } },
      create: { storeId, key, value },
      update: { value },
    });
    saved++;
  }

  return { saved, rejected };
}

/** Drop every notification override, restoring the defaults. */
export async function resetNotificationSettings(storeId: string): Promise<void> {
  await db.storeSetting.deleteMany({ where: { storeId, key: { startsWith: PREFIX } } });
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shell(title: string, inner: string, footer: string): string {
  // The app icon and name head every merchant email.
  //
  // This used to be the "Verified by Marka" badge, which is a claim about a review's
  // provenance — and it sat above "New 3-star review awaiting approval" for anonymous
  // storefront submissions the body itself calls unverified, above the weekly digest and
  // above the question alert. The badge belongs where a purchase really was verified (the
  // /r/<token> page); an email header is identity, not a claim. The icon is left out,
  // rather than broken, when there is no public app URL to load it from; the name stays.
  // Its alt is empty because the name is right beside it as text.
  const icon = brandImageUrl(BRAND_ASSETS.icon);
  const header = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 22px"><tr>
      ${icon ? `<td style="padding:0 10px 0 0"><img src="${icon}" width="32" height="32" alt="" style="display:block;width:32px;height:32px;border:0;outline:none;border-radius:8px"></td>` : ''}
      <td style="font-size:15px;font-weight:700;color:${BRAND.navy};letter-spacing:.01em">${esc(APP_NAME)}</td>
    </tr></table>`;
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#FAF6F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1B3358">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;border:1px solid #E4DED4">
    ${header}
    <h1 style="margin:0 0 16px;font-size:18px;font-weight:700">${esc(title)}</h1>
    ${inner}
    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #E4DED4;font-size:12px;color:#5A6675">${footer}</p>
  </div>
</body></html>`;
}

function starRow(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(Math.max(0, 5 - rating));
}

/**
 * The rating as five tick-stars, for the HTML part. Images, because mail clients render
 * neither SVG nor CSS masks; each one's alt text is the plain star, so a client that blocks
 * images still shows the rating.
 */
function starRowHtml(rating: number): string {
  const on = brandImageUrl(BRAND_ASSETS.starPng);
  const off = brandImageUrl(BRAND_ASSETS.starEmptyPng);
  if (!on || !off) {
    return `<span style="font-size:18px;color:${BRAND.orange};letter-spacing:2px">${starRow(rating)}</span>`;
  }
  return Array.from({ length: 5 }, (_, i) => {
    const filled = i < rating;
    return `<img src="${filled ? on : off}" width="18" height="18" alt="${filled ? '★' : '☆'}" style="display:inline-block;width:18px;height:18px;border:0;margin:0 2px 0 0;vertical-align:middle">`;
  }).join('');
}

export interface ReviewNotice {
  reviewerName: string;
  rating: number;
  title: string | null;
  body: string;
  productTitle?: string | null;
  isPublished: boolean;
}

/** Resolve where a store's notifications go, or null if there is nowhere to send them. */
async function recipientFor(storeId: string, settings: NotificationSettings): Promise<string | null> {
  if (settings.email) return settings.email;
  const store = await db.store.findUnique({ where: { id: storeId }, select: { email: true } });
  return store?.email?.trim() || null;
}

/**
 * Pure: the subject line of the merchant's new-review alert.
 *
 * Follows the publish state as the body does. It said "awaiting approval" for every
 * non-negative review, so on a store with auto-publish on the subject contradicted the body
 * ("It is already live on your storefront") and sent the merchant to an empty moderation
 * queue — for every verified-buyer review once the review-request page began alerting too.
 * A negative review reads the same either way: it needs a reply whether or not it is live.
 */
export function newReviewSubject(rating: number, isNegative: boolean, isPublished: boolean): string {
  if (isNegative) return `${rating}-star review needs your attention`;
  return isPublished ? `New ${rating}-star review published` : `New ${rating}-star review awaiting approval`;
}

/**
 * Called after a review is saved. Decides whether anything should be sent, and sends it.
 *
 * Returns a result rather than throwing so the caller can log it without a try/catch, and
 * so tests can assert on the decision without a mail provider configured.
 */
export async function notifyNewReview(
  storeId: string,
  review: ReviewNotice
): Promise<SendResult | { sent: false; reason: 'disabled' | 'no_recipient' }> {
  try {
    const settings = await getNotificationSettings(storeId);
    const isNegative = review.rating <= settings.negativeThreshold;
    const wanted = (isNegative && settings.negativeReview) || settings.newReview;
    if (!wanted) return { sent: false, reason: 'disabled' };

    if (!emailProvider()) return { sent: false, reason: 'not_configured' };

    const to = await recipientFor(storeId, settings);
    if (!to) return { sent: false, reason: 'no_recipient' };

    const store = await db.store.findUnique({
      where: { id: storeId },
      select: { name: true, shopifyDomain: true },
    });

    const subject = newReviewSubject(review.rating, isNegative, review.isPublished);

    const productLine = review.productTitle
      ? `<p style="margin:0 0 4px;font-size:13px;color:#5A6675">on <strong>${esc(review.productTitle)}</strong></p>`
      : '';

    const urgency = isNegative
      ? `<p style="margin:0 0 16px;padding:10px 12px;background:#FEF3F2;border-left:3px solid #B42318;font-size:13px;color:#912018">A public reply within a few hours is the single most effective response to a review like this.</p>`
      : '';

    const inner = `${urgency}
    <div style="border:1px solid #E4DED4;border-radius:8px;padding:16px">
      <p style="margin:0 0 8px;line-height:18px">${starRowHtml(review.rating)}</p>
      ${review.title ? `<p style="margin:0 0 6px;font-size:15px;font-weight:600">${esc(review.title)}</p>` : ''}
      <p style="margin:0 0 10px;font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(review.body.slice(0, 1200))}</p>
      <p style="margin:0 0 2px;font-size:13px;color:#3E4A5C">— ${esc(review.reviewerName)}</p>
      ${productLine}
    </div>
    <p style="margin:18px 0 0;font-size:13px;color:#3E4A5C">${
      review.isPublished
        ? 'It is already live on your storefront.'
        : 'It is waiting in your moderation queue and is not visible to shoppers yet.'
    }</p>`;

    const text = [
      subject,
      '',
      `${starRow(review.rating)} (${review.rating}/5)`,
      review.title || '',
      review.body.slice(0, 1200),
      `— ${review.reviewerName}`,
      review.productTitle ? `on ${review.productTitle}` : '',
      '',
      review.isPublished
        ? 'It is already live on your storefront.'
        : 'It is waiting in your moderation queue.',
    ]
      .filter(Boolean)
      .join('\n');

    return await sendEmail({
      to,
      subject,
      html: shell(subject, inner, `${APP_NAME} · ${esc(store?.name || store?.shopifyDomain || '')}`),
      text,
    });
  } catch (error) {
    // A notification is never worth failing a request over.
    console.error('[notifications] notifyNewReview failed:', error);
    return { sent: false, reason: 'failed', detail: String(error) };
  }
}

export interface WeeklyStats {
  total: number;
  published: number;
  pending: number;
  average: number;
  negative: number;
}

/** Gather one store's last seven days. Exported so the digest route stays thin. */
export async function weeklyStats(storeId: string, since: Date): Promise<WeeklyStats> {
  const rows = await db.review.findMany({
    where: { storeId, createdAt: { gte: since } },
    select: { rating: true, isPublished: true },
  });

  const total = rows.length;
  const published = rows.filter((r) => r.isPublished).length;
  const sum = rows.reduce((a, r) => a + r.rating, 0);

  return {
    total,
    published,
    pending: total - published,
    average: total ? Math.round((sum / total) * 10) / 10 : 0,
    negative: rows.filter((r) => r.rating <= 2).length,
  };
}

/**
 * Send one store's weekly digest.
 *
 * A week with no reviews sends nothing. An email that says "0 reviews this week" is the
 * kind of message that trains a merchant to ignore the sender.
 */
export async function sendWeeklySummary(
  storeId: string,
  since: Date
): Promise<SendResult | { sent: false; reason: 'disabled' | 'no_recipient' | 'no_activity' }> {
  try {
    const settings = await getNotificationSettings(storeId);
    if (!settings.weeklySummary) return { sent: false, reason: 'disabled' };
    if (!emailProvider()) return { sent: false, reason: 'not_configured' };

    const to = await recipientFor(storeId, settings);
    if (!to) return { sent: false, reason: 'no_recipient' };

    const stats = await weeklyStats(storeId, since);
    if (stats.total === 0) return { sent: false, reason: 'no_activity' };

    const store = await db.store.findUnique({
      where: { id: storeId },
      select: { name: true, shopifyDomain: true },
    });

    const subject = `${stats.total} new review${stats.total === 1 ? '' : 's'} this week`;

    const cell = (label: string, value: string, color = '#1B3358') =>
      `<td style="padding:12px;border:1px solid #E4DED4;border-radius:8px;text-align:center">
         <div style="font-size:22px;font-weight:700;color:${color}">${esc(value)}</div>
         <div style="font-size:11px;color:#5A6675;margin-top:2px">${esc(label)}</div>
       </td>`;

    const inner = `<table style="width:100%;border-collapse:separate;border-spacing:6px"><tr>
      ${cell('new reviews', String(stats.total))}
      ${cell('avg rating', stats.average.toFixed(1), BRAND.orange)}
      ${cell('awaiting approval', String(stats.pending), stats.pending ? '#8A5000' : '#1B3358')}
      ${cell('1–2 star', String(stats.negative), stats.negative ? '#B42318' : '#1B3358')}
    </tr></table>
    ${
      stats.pending
        ? `<p style="margin:18px 0 0;font-size:13px;color:#3E4A5C">${stats.pending} review${stats.pending === 1 ? ' is' : 's are'} still waiting for approval and not visible to shoppers.</p>`
        : `<p style="margin:18px 0 0;font-size:13px;color:#3E4A5C">Your moderation queue is clear.</p>`
    }`;

    const text = `${subject}

New reviews: ${stats.total}
Average rating: ${stats.average.toFixed(1)}
Awaiting approval: ${stats.pending}
1-2 star: ${stats.negative}`;

    return await sendEmail({
      to,
      subject,
      html: shell(subject, inner, `${APP_NAME} · ${esc(store?.name || store?.shopifyDomain || '')}`),
      text,
    });
  } catch (error) {
    console.error('[notifications] sendWeeklySummary failed:', error);
    return { sent: false, reason: 'failed', detail: String(error) };
  }
}


/**
 * A shopper asked a question. Gated by the same "every new review" switch: a merchant who
 * wants to hear about each review wants to hear about each question at least as much — a
 * question is a purchase waiting on an answer, and until this existed nothing told the
 * merchant one had arrived. The Questions screen is the only place it showed, unprompted.
 */
export async function notifyNewQuestion(
  storeId: string,
  q: { askerName: string; body: string; productTitle?: string | null }
): Promise<SendResult | { sent: false; reason: 'disabled' | 'no_recipient' }> {
  try {
    const settings = await getNotificationSettings(storeId);
    if (!settings.newReview) return { sent: false, reason: 'disabled' };
    if (!emailProvider()) return { sent: false, reason: 'not_configured' };
    const to = await recipientFor(storeId, settings);
    if (!to) return { sent: false, reason: 'no_recipient' };

    const store = await db.store.findUnique({ where: { id: storeId }, select: { name: true, shopifyDomain: true } });
    const subject = 'A shopper asked a question';
    const productLine = q.productTitle
      ? `<p style="margin:0 0 4px;font-size:13px;color:#5A6675">about <strong>${esc(q.productTitle)}</strong></p>`
      : '';
    const inner = `
    <div style="border:1px solid #E4DED4;border-radius:8px;padding:16px">
      <p style="margin:0 0 10px;font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(q.body.slice(0, 1200))}</p>
      <p style="margin:0 0 2px;font-size:13px;color:#3E4A5C">— ${esc(q.askerName)}</p>
      ${productLine}
    </div>
    <p style="margin:18px 0 0;font-size:13px;color:#3E4A5C">Answer it from the Questions screen in Marka Reviews. Your answer is published on the product page for every future shopper, and the person who asked is emailed if they left an address.</p>`;
    const text = [subject, '', q.body.slice(0, 1200), `— ${q.askerName}`, q.productTitle ? `about ${q.productTitle}` : '', '', 'Answer it from the Questions screen in Marka Reviews.'].filter(Boolean).join('\n');
    return await sendEmail({ to, subject, html: shell(subject, inner, `${APP_NAME} · ${esc(store?.name || store?.shopifyDomain || '')}`), text });
  } catch (error) {
    console.error('[notifications] notifyNewQuestion failed:', error);
    return { sent: false, reason: 'failed', detail: String(error) };
  }
}
