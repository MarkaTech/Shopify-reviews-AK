import { db } from './db';
import { sendEmail, renderReviewRequestEmail } from './email';
import { reviewRequestUrl } from './review-requests';
import { getRequestSettings } from './request-settings';
import { hasRequestQuota, recordRequestSent, nextQuotaReset, getStorePlan, PLANS } from './plans';
import { SHOPIFY_APP_URL } from './shopify';
import { unsubscribeToken } from '@/app/api/unsubscribe/route';

/**
 * The one place a review-request email is actually sent from.
 *
 * The webhook no longer sends anything — it only creates the request with a
 * `nextSendAt`. The cron sweep calls this for every due request. That split is what
 * fixes two problems at once:
 *
 *   - Timing. Emails go out `delayDays` after fulfilment (default 14), when the
 *     customer is holding the product, not the moment it leaves the warehouse.
 *   - Loss. A failed send used to be logged and forgotten — Shopify got its 200, no
 *     retry existed, and the invitation was silently gone. Now failure simply leaves
 *     `nextSendAt` in the past, and the next sweep tries again.
 *
 * Reminder scheduling lives here too: after a successful send, the next send is booked
 * if the store's settings allow another, otherwise the request is closed out.
 */

interface DueRequest {
  id: string;
  storeId: string;
  token: string;
  customerEmail: string;
  customerName: string | null;
  orderNumber: string | null;
  lineItems: string;
  sendCount: number;
}

export type SendOutcome = 'sent' | 'reminder_sent' | 'skipped' | 'failed' | 'not_configured' | 'over_quota';

export async function sendDueRequest(
  request: DueRequest,
  settings?: { reminders: number; reminderGapDays: number }
): Promise<SendOutcome> {
  const cfg = settings ?? (await getRequestSettings(request.storeId));

  // Redacted by retention, or junk — close it out rather than retrying forever.
  if (!request.customerEmail.includes('@') || request.customerEmail.endsWith('.invalid')) {
    await db.reviewRequest.update({ where: { id: request.id }, data: { nextSendAt: null } });
    return 'skipped';
  }

  const store = await db.store.findUnique({
    where: { id: request.storeId },
    select: { name: true, email: true, isActive: true },
  });
  if (!store?.isActive) {
    await db.reviewRequest.update({ where: { id: request.id }, data: { nextSendAt: null } });
    return 'skipped';
  }

  // ── Monthly send quota ──
  //
  // Deferred to the start of next month rather than cancelled. A Free store that runs out
  // mid-month keeps its queue: those buyers still get asked, just later. Dropping the
  // request would lose a real review permanently to a billing limit, which is a much worse
  // trade than a delayed email — and the merchant sees the backlog as a reason to upgrade
  // rather than as silence.
  if (!(await hasRequestQuota(request.storeId))) {
    await db.reviewRequest.update({
      where: { id: request.id },
      data: { nextSendAt: nextQuotaReset() },
    });
    return 'over_quota';
  }

  let itemTitles: string[] = [];
  try {
    itemTitles = (JSON.parse(request.lineItems) as Array<{ title?: string }>).map(
      (li) => li.title || 'Item'
    );
  } catch {
    itemTitles = [];
  }

  const link = reviewRequestUrl(request.token, SHOPIFY_APP_URL);
  const unsubscribeUrl =
    `${SHOPIFY_APP_URL}/api/unsubscribe` +
    `?email=${encodeURIComponent(request.customerEmail)}` +
    `&t=${encodeURIComponent(unsubscribeToken(request.customerEmail))}`;

  const isReminder = request.sendCount > 0;

  // A reminder booked while the store was on a paid plan must not fire after they
  // downgrade. The scheduling check below only runs when the NEXT send is booked, so
  // without this a cancelled plan kept sending for one more round. Checked here, at send
  // time, against the plan as it is right now.
  if (isReminder && !PLANS[await getStorePlan(request.storeId)].reminderEmails) {
    await db.reviewRequest.update({ where: { id: request.id }, data: { nextSendAt: null } });
    return 'skipped';
  }

  const message = renderReviewRequestEmail({
    storeName: store.name || 'the store',
    customerName: request.customerName ? request.customerName.split(' ')[0] : null,
    orderNumber: request.orderNumber,
    itemTitles,
    reviewUrl: link,
    unsubscribeUrl,
    isReminder,
  });

  const result = await sendEmail({
    ...message,
    to: request.customerEmail,
    // Replies go to the merchant, not to us — they own the customer relationship.
    replyTo: store.email || undefined,
  });

  if (result.sent) {
    // Count it only now. A send the provider rejected cost nothing and must not consume
    // the merchant's allowance.
    await recordRequestSent(request.storeId);

    const newCount = request.sendCount + 1;
    // Reminders are a paid feature. On a plan without them the first email is the only
    // email. A downgrade between booking and sending is caught by the send-time check
    // above, so this only has to get the booking right.
    const remindersAllowed = PLANS[await getStorePlan(request.storeId)].reminderEmails;
    // newCount 1 is the initial email; reminders allowed on top of it.
    const another = remindersAllowed && newCount <= cfg.reminders;
    await db.reviewRequest.update({
      where: { id: request.id },
      data: {
        sendCount: newCount,
        sentAt: request.sendCount === 0 ? new Date() : undefined,
        nextSendAt: another ? new Date(Date.now() + cfg.reminderGapDays * 86_400_000) : null,
      },
    });
    return isReminder ? 'reminder_sent' : 'sent';
  }

  if (result.reason === 'suppressed') {
    // The address asked never to be mailed again. Retrying would be the exact thing the
    // suppression list exists to prevent.
    await db.reviewRequest.update({ where: { id: request.id }, data: { nextSendAt: null } });
    return 'skipped';
  }

  if (result.reason === 'not_configured') {
    // No provider yet. Push a day out rather than knocking hourly on a door with no one
    // behind it; the moment the merchant configures email, requests resume within a day.
    await db.reviewRequest.update({
      where: { id: request.id },
      data: { nextSendAt: new Date(Date.now() + 86_400_000) },
    });
    return 'not_configured';
  }

  // Transient failure: leave nextSendAt where it is. The next sweep retries. This is
  // deliberate — it is the retry mechanism.
  console.error(`[review-request] send failed for ${request.customerEmail}: ${result.detail}`);
  return 'failed';
}

/**
 * Sweep every due request. Called by the cron route.
 *
 * Bounded per run: a backlog (first deploy over an existing store, or an outage) drains
 * across successive hourly runs instead of one enormous request that gets killed by the
 * platform's timeout.
 */
export async function sweepDueRequests(limit = 200): Promise<Record<SendOutcome, number>> {
  const due = await db.reviewRequest.findMany({
    where: {
      nextSendAt: { lte: new Date() },
      submittedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      storeId: true,
      token: true,
      customerEmail: true,
      customerName: true,
      orderNumber: true,
      lineItems: true,
      sendCount: true,
    },
    orderBy: { nextSendAt: 'asc' },
    take: limit,
  });

  const counts: Record<SendOutcome, number> = {
    sent: 0,
    reminder_sent: 0,
    skipped: 0,
    failed: 0,
    not_configured: 0,
    over_quota: 0,
  };

  // Settings fetched once per store per sweep, not once per request.
  const settingsCache = new Map<string, { reminders: number; reminderGapDays: number }>();

  for (const request of due) {
    let cfg = settingsCache.get(request.storeId);
    if (!cfg) {
      cfg = await getRequestSettings(request.storeId);
      settingsCache.set(request.storeId, cfg);
    }
    const outcome = await sendDueRequest(request, cfg);
    counts[outcome]++;
  }

  return counts;
}
