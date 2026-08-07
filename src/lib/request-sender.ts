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
 *     retry existed, and the invitation was silently gone. Now a failure reschedules the
 *     request with a growing backoff and the next sweep tries again.
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
  sendFailures: number;
}

export type SendOutcome =
  | 'sent'
  | 'reminder_sent'
  | 'skipped'
  | 'failed'
  | 'abandoned'
  | 'not_configured'
  | 'over_quota';

/**
 * Retry policy for a transient send failure.
 *
 * The sweep takes the 200 requests with the oldest `nextSendAt`. Leaving that column
 * untouched on failure — which is what this used to do, deliberately, as "the retry
 * mechanism" — means a permanently failing row stays the oldest row forever and is picked
 * first on every run. Two hundred of those anywhere on the platform and the sweep spends
 * every hour retrying the same dead addresses and never reaches anyone else's queue. It
 * fails quietly: the cron returns HTTP 200 with `{"failed":200}` and the workflow is green.
 *
 * So a failure now pushes the row into the future, doubling each time: +1h, +2h, +4h,
 * +8h, +16h, +32h. Giving up is reported as its own outcome rather than folded into
 * `failed`, so the cron log distinguishes "the provider is having a bad hour" from
 * "these addresses are dead".
 *
 * **Only a failure the provider attributes to the address counts toward giving up.**
 * That distinction is the whole safety of this mechanism. `sendEmail` returns
 * `retryable` (see `email.ts`): a 401 from a rotated key, a 403 from an unverified
 * sending domain, a 429, a 5xx or a socket reset all set it, and those failures back off
 * without ever incrementing the counter.
 *
 * Without it the backoff would be worse than the bug it replaces. An expired API key
 * fails every send platform-wide; each row would climb to seven failures and, about 63
 * hours later, set `nextSendAt: null` — permanently, since nothing else ever writes that
 * column and no path resurrects an abandoned request. A weekend of a bad credential
 * would silently destroy every queued review request in the product, where the old
 * behaviour merely paused and resumed intact. Backing off a stuck queue is worth doing;
 * deleting it is not.
 */
const MAX_SEND_FAILURES = 7;
const RETRY_BASE_MS = 60 * 60 * 1000;
/** Safety bound on the exponent — the give-up check reaches first, but not by accident. */
const MAX_BACKOFF_STEPS = 6;

function retryDelayMs(failures: number): number {
  // `failures` includes the one just recorded, so the first retry waits one base interval
  // rather than none.
  return RETRY_BASE_MS * 2 ** Math.min(failures - 1, MAX_BACKOFF_STEPS);
}

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
      // Counter cleared: waiting for a quota reset is not a failure, and carrying an old
      // count across a month boundary would spend a request's retry budget on failures
      // from weeks earlier — so `sendFailures` means what the schema says it means.
      data: { sendFailures: 0, nextSendAt: nextQuotaReset() },
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

  // Resolved once, before the send, and reused afterwards. Reading it again after the
  // provider has accepted the message would put another await — another thing that can
  // throw — between a delivered email and the row that records it.
  const plan = await getStorePlan(request.storeId);

  // A reminder booked while the store was on a paid plan must not fire after they
  // downgrade. The scheduling check below only runs when the NEXT send is booked, so
  // without this a cancelled plan kept sending for one more round. Checked here, at send
  // time, against the plan as it is right now.
  if (isReminder && !PLANS[plan].reminderEmails) {
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
    const newCount = request.sendCount + 1;
    // Reminders are a paid feature. On a plan without them the first email is the only
    // email. A downgrade between booking and sending is caught by the send-time check
    // above, so this only has to get the booking right.
    const remindersAllowed = PLANS[plan].reminderEmails;
    // newCount 1 is the initial email; reminders allowed on top of it.
    const another = remindersAllowed && newCount <= cfg.reminders;

    // The row is written FIRST, before the quota is recorded.
    //
    // The order used to be the other way round, and the window between the two was a
    // duplicate-mail bug: the customer has already received the email at this point, so
    // anything that throws before `sendCount` is incremented leaves the request looking
    // unsent, and the next sweep — an hour later, and every hour after that — mails them
    // again. Recording usage a moment later risks under-counting one request against a
    // monthly allowance. Mailing a customer hourly forever is not comparable.
    await db.reviewRequest.update({
      where: { id: request.id },
      data: {
        sendCount: newCount,
        // A send that worked clears the failure history. Whatever went wrong before is
        // over, and the reminder booked below deserves its own full retry budget.
        sendFailures: 0,
        sentAt: request.sendCount === 0 ? new Date() : undefined,
        nextSendAt: another ? new Date(Date.now() + cfg.reminderGapDays * 86_400_000) : null,
      },
    });

    // Counted only now. A send the provider rejected cost nothing and must not consume
    // the merchant's allowance. Isolated, for the reason above: a metering failure must
    // not undo a send that already happened.
    try {
      await recordRequestSent(request.storeId);
    } catch (err) {
      console.error(`[review-request] usage not recorded for store ${request.storeId}:`, err);
    }

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
      data: { sendFailures: 0, nextSendAt: new Date(Date.now() + 86_400_000) },
    });
    return 'not_configured';
  }

  // Failure. See MAX_SEND_FAILURES above for why this cannot simply leave `nextSendAt`
  // alone and let the next sweep pick it up again — and why a provider-side fault must
  // not spend the request's retry budget.
  // `!== false` rather than truthiness: absent means retryable, so a future call path
  // that forgets to classify its failure fails safe rather than abandoning requests.
  if (result.retryable !== false) {
    const wait = retryDelayMs(request.sendFailures + 1);
    await db.reviewRequest.update({
      where: { id: request.id },
      // `sendFailures` deliberately untouched. The backoff still grows with it, so a
      // long outage stops hammering the provider, but the request can never be
      // abandoned for a fault that says nothing about the recipient. It waits, at worst
      // 32 hours at a time, until the configuration is fixed.
      data: { nextSendAt: new Date(Date.now() + wait) },
    });
    console.error(
      `[review-request] provider-side failure for ${request.customerEmail}, retrying in ${Math.round(wait / 3_600_000)}h: ${result.detail}`
    );
    return 'failed';
  }

  const failures = request.sendFailures + 1;

  if (failures >= MAX_SEND_FAILURES) {
    await db.reviewRequest.update({
      where: { id: request.id },
      data: { sendFailures: failures, nextSendAt: null },
    });
    console.error(
      `[review-request] giving up on ${request.customerEmail} after ${failures} rejections: ${result.detail}`
    );
    return 'abandoned';
  }

  await db.reviewRequest.update({
    where: { id: request.id },
    data: {
      sendFailures: failures,
      nextSendAt: new Date(Date.now() + retryDelayMs(failures)),
    },
  });
  console.error(
    `[review-request] rejected for ${request.customerEmail} (attempt ${failures}/${MAX_SEND_FAILURES}): ${result.detail}`
  );
  return 'failed';
}

/**
 * Most of one sweep any single store may occupy.
 *
 * The window is filled strictly oldest-first, which is fair between requests and not
 * between merchants. One store can hold every slot indefinitely, and the quota path makes
 * that easy to reach rather than hypothetical: an over-quota request is deferred to
 * `nextQuotaReset()`, which is *the same millisecond* for every deferred row in the
 * product, and earlier than anything scheduled organically for the rest of the month.
 *
 * So a Free store doing 500 orders a day accumulates ~15,000 requests stamped
 * 00:05 on the 1st. From that moment every sweep filled all 200 slots with that one
 * store's rows, sent its 100 and deferred the rest — for the three days it took to walk
 * the backlog, during which no other merchant on the platform received a single review
 * request. At 2,000 orders a day the drain never finished and the starvation was
 * permanent. No failure was required; one large store on the free plan was enough.
 *
 * Two changes, because there are two problems. This cap is the general one: with 200
 * slots and a cap of 40, at least five stores are served whenever five have work, and a
 * store with a real backlog still drains — just not at everyone else's expense. Where
 * only one store has work it gets 40 an hour, comfortably above what a single store
 * generates in an hour.
 *
 * The quota case is handled separately in the loop below, because a cap alone would still
 * let a few exhausted stores spend their whole share discovering they are exhausted. Once
 * one row comes back `over_quota`, that store's entire due backlog is deferred in a single
 * statement and the store is skipped for the rest of the run.
 */
const MAX_PER_STORE_PER_SWEEP = 40;

/**
 * Sweep every due request. Called by the cron route.
 *
 * Bounded per run: a backlog (first deploy over an existing store, or an outage) drains
 * across successive hourly runs instead of one enormous request that gets killed by the
 * platform's timeout.
 */
export async function sweepDueRequests(limit = 200): Promise<Record<SendOutcome, number>> {
  const now = new Date();

  // Over-fetched, then capped per store below. Reading more rows than we will act on is
  // the price of fairness: if we asked the database for exactly `limit`, a single store's
  // backlog would fill the result set before any other store's rows were even considered,
  // and capping afterwards would leave the window half empty. The select is six small
  // columns on an indexed range, so the extra rows are cheap.
  const candidates = await db.reviewRequest.findMany({
    where: {
      nextSendAt: { lte: now },
      submittedAt: null,
      expiresAt: { gt: now },
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
      sendFailures: true,
    },
    orderBy: { nextSendAt: 'asc' },
    take: limit * 5,
  });

  const counts: Record<SendOutcome, number> = {
    sent: 0,
    reminder_sent: 0,
    skipped: 0,
    failed: 0,
    abandoned: 0,
    not_configured: 0,
    over_quota: 0,
  };

  // Settings fetched once per store per sweep, not once per request.
  const settingsCache = new Map<string, { reminders: number; reminderGapDays: number }>();
  const attempted = new Map<string, number>();
  // Stores whose whole backlog has already been pushed to the next quota reset in this
  // run. Usage only ever climbs within a month, so a store that is out of allowance now
  // is still out of allowance later in the same sweep — the answer cannot change.
  const exhausted = new Set<string>();
  let slots = 0;

  for (const request of candidates) {
    if (slots >= limit) break;
    if (exhausted.has(request.storeId)) continue;
    const taken = attempted.get(request.storeId) ?? 0;
    if (taken >= MAX_PER_STORE_PER_SWEEP) continue;
    attempted.set(request.storeId, taken + 1);
    slots++;

    // Isolated. Every branch of `sendDueRequest` writes `nextSendAt`, so the only way a
    // row can still stall the queue is by throwing before it gets there — and without
    // this the throw would take the whole sweep with it, discarding the counts and
    // returning 500 while every row behind it goes unattempted for another hour. The
    // realistic trigger is a GDPR redaction deleting a request between the read above
    // and its update (Prisma P2025), which is nobody's bug and should cost one row.
    try {
      let cfg = settingsCache.get(request.storeId);
      if (!cfg) {
        cfg = await getRequestSettings(request.storeId);
        settingsCache.set(request.storeId, cfg);
      }
      const outcome = await sendDueRequest(request, cfg);
      counts[outcome]++;

      if (outcome === 'over_quota') {
        // One store out of allowance should cost one slot, not forty. Walking its
        // backlog row by row would spend the rest of its share re-deriving the same
        // answer — and with a handful of large free stores in that state, they would
        // between them consume the entire window every hour while sending nothing.
        //
        // The answer is known for every one of its due rows, so they all move at once.
        // This runs once per store per month rather than every hour, which is what turns
        // a three-day drain into a single statement.
        exhausted.add(request.storeId);
        const bulk = await db.reviewRequest.updateMany({
          where: {
            storeId: request.storeId,
            nextSendAt: { lte: now },
            submittedAt: null,
            expiresAt: { gt: now },
          },
          data: { sendFailures: 0, nextSendAt: nextQuotaReset() },
        });
        counts.over_quota += bulk.count;
      }
    } catch (err) {
      console.error(`[review-request] sweep error on request ${request.id}:`, err);
      counts.failed++;
    }
  }

  return counts;
}
