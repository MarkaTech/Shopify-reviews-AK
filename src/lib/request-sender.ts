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
 * So every failure increments `sendFailures` and pushes the row into the future,
 * doubling each time: +1h, +2h, +4h, +8h, +16h, then +32h from there on. That alone is
 * what unblocks the queue, and it applies to every kind of failure without exception.
 *
 * **Giving up is a separate decision, and it needs positive evidence.** A request is
 * abandoned only once it has failed MAX_SEND_FAILURES times *and* the latest failure is
 * one the provider attributed to the recipient (`retryable === false`, classified in
 * `email.ts` from the response body, not the status code). Anything else — a rotated
 * key, an unverified sending domain, a 429, a 5xx, a socket reset — backs off forever
 * and is never abandoned.
 *
 * The asymmetry is the point. An expired credential fails every send platform-wide; if
 * that could abandon requests, a bad key over a weekend would silently destroy every
 * queued review request in the product, permanently, since nothing resurrects one. A
 * dead address that is never abandoned costs one send attempt every 32 hours until the
 * request expires ~60 days after fulfilment and leaves the queue by itself. Backing off
 * a stuck queue is worth doing; deleting it is not.
 */
/**
 * How long a claimed row is held before it becomes due again.
 *
 * Long enough that a slow provider call cannot expire the claim mid-send, short enough
 * that a process killed between claim and write costs one cycle rather than a day. The
 * hourly sweep means anything under an hour is effectively "the next run".
 */
const CLAIM_HOLD_MS = 15 * 60 * 1000;

const MAX_SEND_FAILURES = 7;
const RETRY_BASE_MS = 60 * 60 * 1000;
/** 2**5 = 32 hours, the ceiling on how long a failing request waits between attempts. */
const MAX_BACKOFF_STEPS = 5;

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

  // ── Claim the row before sending ──
  //
  // The sweep selects rows whose `nextSendAt` is in the past and mails them. Nothing
  // marked a row as in flight, so two sweeps running at once both saw the same rows and
  // both sent. That is not hypothetical: a 200-row sweep can outlast Azure's 230-second
  // front-end timeout, the workflow sees a 502 and reports failure, and the natural
  // response is to re-run it — at which point every row the first pass had not yet
  // reached is still due, and every row it *had* reached is still due too, because
  // `sendCount` is only written after the send. The customer gets the same invitation
  // twice, and the duplicate lands against a shared sending domain's complaint rate.
  //
  // A compare-and-swap on `nextSendAt` is enough, and needs no new column: push the row
  // into the future conditional on it still being due. Exactly one concurrent writer can
  // match, and the loser gets count 0 and steps aside. Every path below then sets the
  // real `nextSendAt` — the next reminder, a backoff, a quota deferral, or null — so the
  // hold is temporary by construction. If the process dies mid-send the row simply
  // becomes due again after CLAIM_HOLD_MS rather than being stranded.
  const claim = await db.reviewRequest.updateMany({
    where: { id: request.id, nextSendAt: { lte: new Date() } },
    data: { nextSendAt: new Date(Date.now() + CLAIM_HOLD_MS) },
  });
  if (claim.count === 0) {
    // Another sweep has this one. Not an error, and not this run's to count.
    return 'skipped';
  }

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
  // alone and let the next sweep pick it up again.
  const failures = request.sendFailures + 1;

  // `=== false` rather than falsiness: absent means retryable, so a call path that has
  // not classified its failure keeps the request alive instead of discarding it.
  const rejectedByRecipient = result.retryable === false;

  if (rejectedByRecipient && failures >= MAX_SEND_FAILURES) {
    await db.reviewRequest.update({
      where: { id: request.id },
      data: { sendFailures: failures, nextSendAt: null },
    });
    console.error(
      `[review-request] giving up on ${request.customerEmail} after ${failures} attempts, last rejected as a bad recipient: ${result.detail}`
    );
    return 'abandoned';
  }

  const wait = retryDelayMs(failures);
  await db.reviewRequest.update({
    where: { id: request.id },
    data: { sendFailures: failures, nextSendAt: new Date(Date.now() + wait) },
  });
  console.error(
    `[review-request] send failed for ${request.customerEmail} ` +
      `(attempt ${failures}, ${rejectedByRecipient ? 'recipient rejected' : 'provider-side'}, ` +
      `retrying in ${Math.round(wait / 3_600_000)}h): ${result.detail}`
  );
  return 'failed';
}

/**
 * Most stores one sweep will look at. A bound on the fan-out below, not on fairness.
 */
const MAX_STORES_PER_SWEEP = 100;

/**
 * Sweep every due request. Called by the cron route.
 *
 * Bounded per run: a backlog (first deploy over an existing store, or an outage) drains
 * across successive hourly runs instead of one enormous request that gets killed by the
 * platform's timeout.
 *
 * **Why this does not just take the oldest 200 rows.** That is fair between requests and
 * not between merchants, and one store can hold every slot indefinitely. The quota path
 * makes it easy to reach rather than hypothetical: an over-quota request is deferred to
 * `nextQuotaReset()`, the *same millisecond* for every deferred row in the product and
 * earlier than anything scheduled organically for the rest of the month. A Free store
 * doing 500 orders a day accumulates ~15,000 requests stamped 00:05 on the 1st, and from
 * then on every sweep filled all 200 slots with that one store's rows for the three days
 * it took to walk the backlog, while no other merchant received a single email. At 2,000
 * orders a day it never finished. No failure was required — one large store was enough.
 *
 * The fix is to choose the *stores* first and then take rows within each, rather than
 * capping a single oldest-first result set. Capping afterwards looks equivalent and is
 * strictly worse: if the oldest rows all belong to one store, a cap of 40 attempts 40 of
 * them, skips the rest, and ends the run with 160 of 200 slots unused — starving everyone
 * else *and* cutting total throughput. Nothing refills the window, because the window was
 * already spent.
 *
 * Choosing stores first makes the share fall out of how many are competing: one store
 * with work gets the whole 200, five get 40 each, a hundred get 2 each. No store is ever
 * starved by another's backlog, and a lone store keeps full throughput.
 */
export async function sweepDueRequests(limit = 200): Promise<Record<SendOutcome, number>> {
  const now = new Date();
  const dueWhere = {
    nextSendAt: { lte: now },
    submittedAt: null,
    expiresAt: { gt: now },
  };

  // Which stores have work, longest-waiting first. Ordering on each store's oldest due
  // request is what rotates stores across sweeps: a store served this hour has no old
  // rows left, so it sorts behind whoever was skipped.
  const storesWithWork = await db.reviewRequest.groupBy({
    by: ['storeId'],
    where: dueWhere,
    _min: { nextSendAt: true },
    orderBy: { _min: { nextSendAt: 'asc' } },
    take: MAX_STORES_PER_SWEEP,
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
  // Reported separately from `over_quota`, which counts requests this run actually
  // looked at. Folding a 15,000-row bulk defer into it would make the numbers
  // incommensurable and the log unreadable as "what this run did".
  let bulkDeferred = 0;

  let slots = 0;

  for (let i = 0; i < storesWithWork.length; i++) {
    if (slots >= limit) break;
    const { storeId } = storesWithWork[i];

    // Recomputed each time, over what is actually left and how many stores are left to
    // serve. So the share falls out of how many stores are competing — one store with
    // work keeps the whole window, five get 40 each, a hundred get 2 each — and a store
    // that turns out to need less than its share hands the remainder to the ones behind
    // it rather than leaving the window half empty. `ceil` so the last store is never
    // allotted zero.
    const share = Math.max(1, Math.ceil((limit - slots) / (storesWithWork.length - i)));

    const due = await db.reviewRequest.findMany({
      where: { ...dueWhere, storeId },
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
      take: Math.min(share, limit - slots),
    });

    for (const request of due) {
      slots++;

      // Isolated. Every branch of `sendDueRequest` writes `nextSendAt`, so the only way
      // a row can still stall the queue is by throwing before it gets there — and
      // without this the throw would take the whole sweep with it, discarding the counts
      // and returning 500 while every row behind it goes unattempted for another hour.
      // The realistic trigger is a GDPR redaction deleting a request between the read
      // above and its update (Prisma P2025), which is nobody's bug and should cost one
      // row rather than everybody's hour.
      try {
        let cfg = settingsCache.get(storeId);
        if (!cfg) {
          cfg = await getRequestSettings(storeId);
          settingsCache.set(storeId, cfg);
        }
        const outcome = await sendDueRequest(request, cfg);
        counts[outcome]++;

        if (outcome === 'over_quota') {
          // One store out of allowance should cost one slot, not its whole share.
          // Walking the backlog row by row spends the rest of that share re-deriving an
          // answer that cannot change: `recordRequestSent` only ever increments, and the
          // usage key is scoped to the month, so a store that is out of allowance now is
          // still out of allowance later in this run.
          //
          // The answer is known for every one of its due rows, so they all move at once.
          // That is what turns a three-day drain into a single statement, and it runs
          // once per store per month rather than every hour.
          //
          // The bulk `where` will also sweep up rows `sendDueRequest` would have closed
          // out — a redacted address, a suppressed one, a reminder on a downgraded plan.
          // They are deferred a month and closed out then instead. Deliberate: the
          // alternative is walking them here, which is the cost this exists to avoid.
          const bulk = await db.reviewRequest.updateMany({
            where: { ...dueWhere, storeId },
            data: { sendFailures: 0, nextSendAt: nextQuotaReset() },
          });
          bulkDeferred += bulk.count;
          break;
        }
      } catch (err) {
        console.error(`[review-request] sweep error on request ${request.id}:`, err);
        counts.failed++;
      }
    }
  }

  if (bulkDeferred > 0) {
    console.log(`[review-request] deferred ${bulkDeferred} request(s) to the next quota reset`);
  }

  return counts;
}
