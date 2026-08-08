import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';

/**
 * How the review-request programme is actually performing.
 *
 * The app has been recording `sentAt`, `openedAt` and `submittedAt` on every request
 * since the feature was built, and displaying none of them. So a merchant could see how
 * many reviews they had, and nothing at all about the machine that produces them: how
 * many invitations went out, how many were acted on, whether the reminder is worth
 * sending, or whether anything is queued at all.
 *
 * That is the question a merchant actually has — *are the invitations working?* — and it
 * is the number that justifies the subscription. "You sent 340 invitations and got 68
 * reviews" is a case for renewal in a way that a review count on its own is not.
 *
 * A word on what these metrics honestly mean
 * ------------------------------------------
 * `openedAt` is written when the review FORM is opened, not when the email is opened.
 * There is no tracking pixel in the email and there should not be one — it is a privacy
 * cost paid by the shopper for the merchant's curiosity. So this is a click-through, and
 * it is labelled as one. Calling it an "open rate" would be the more flattering number
 * and a false claim about what was measured.
 *
 * Everything here is a count or a bounded read. Nothing scans the request table whole.
 */

const WINDOW_DAYS = 90;

export async function GET(request: Request) {
  try {
    const { storeId } = await withAuth(request);

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - (WINDOW_DAYS - 1));
    since.setUTCHours(0, 0, 0, 0);
    const now = new Date();

    const inWindow = { storeId, sentAt: { gte: since, not: null } };

    const [
      sent,
      clicked,
      submitted,
      submittedAfterReminder,
      pending,
      dueNextWeek,
      upcoming,
      completions,
      lifetimeSent,
      lifetimeSubmitted,
    ] = await Promise.all([
      db.reviewRequest.count({ where: inWindow }),
      db.reviewRequest.count({ where: { ...inWindow, openedAt: { not: null } } }),
      db.reviewRequest.count({ where: { ...inWindow, submittedAt: { not: null } } }),
      // sendCount > 1 means at least one reminder went out before this was submitted.
      // The comparison a merchant wants is whether the reminder earns its send, and this
      // is the only honest way to answer it without an A/B split.
      db.reviewRequest.count({
        where: { ...inWindow, submittedAt: { not: null }, sendCount: { gt: 1 } },
      }),

      // Queued right now. Not windowed — "what is waiting" is a present-tense question.
      db.reviewRequest.count({
        where: { storeId, nextSendAt: { not: null }, submittedAt: null, expiresAt: { gt: now } },
      }),
      db.reviewRequest.count({
        where: {
          storeId,
          submittedAt: null,
          expiresAt: { gt: now },
          nextSendAt: { not: null, lte: new Date(now.getTime() + 7 * 86_400_000) },
        },
      }),
      db.reviewRequest.findMany({
        where: { storeId, nextSendAt: { not: null }, submittedAt: null, expiresAt: { gt: now } },
        select: { id: true, customerName: true, orderNumber: true, nextSendAt: true, sendCount: true },
        orderBy: { nextSendAt: 'asc' },
        take: 5,
      }),

      // Bounded: only requests that completed inside the window, only two columns.
      db.reviewRequest.findMany({
        where: { ...inWindow, submittedAt: { not: null } },
        select: { sentAt: true, submittedAt: true },
        take: 2000,
      }),

      db.reviewRequest.count({ where: { storeId, sentAt: { not: null } } }),
      db.reviewRequest.count({ where: { storeId, submittedAt: { not: null } } }),
    ]);

    // ── Time to review ──
    //
    // Median rather than mean. One shopper who answers a three-month-old email drags an
    // average badly, and the merchant's real question is "when should I expect these
    // back", which is what a median answers.
    const gaps = completions
      .filter((r) => r.sentAt && r.submittedAt)
      .map((r) => (r.submittedAt!.getTime() - r.sentAt!.getTime()) / 86_400_000)
      .filter((d) => d >= 0)
      .sort((a, b) => a - b);

    const medianDays = gaps.length
      ? Math.round(
          (gaps.length % 2
            ? gaps[(gaps.length - 1) / 2]
            : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2) * 10
        ) / 10
      : null;

    const rate = (part: number, whole: number) =>
      whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

    return NextResponse.json({
      windowDays: WINDOW_DAYS,
      funnel: {
        sent,
        clicked,
        submitted,
        clickRate: rate(clicked, sent),
        conversionRate: rate(submitted, sent),
        // Of the people who opened the form, how many finished it. Isolates the form
        // itself from the email: a healthy click rate with a poor finish rate points at
        // the form, the other way round points at the email.
        completionRate: rate(submitted, clicked),
      },
      reminders: {
        submittedAfterReminder,
        submittedOnFirstEmail: Math.max(0, submitted - submittedAfterReminder),
        shareOfSubmissions: rate(submittedAfterReminder, submitted),
      },
      queue: {
        pending,
        dueNextWeek,
        upcoming: upcoming.map((u) => ({
          id: u.id,
          customerName: u.customerName,
          orderNumber: u.orderNumber,
          sendsAt: u.nextSendAt,
          isReminder: u.sendCount > 0,
        })),
      },
      timeToReview: { medianDays, sampleSize: gaps.length },
      lifetime: {
        sent: lifetimeSent,
        submitted: lifetimeSubmitted,
        conversionRate: rate(lifetimeSubmitted, lifetimeSent),
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('Error fetching request analytics:', error);
    return NextResponse.json({ error: 'Failed to fetch request analytics' }, { status: 500 });
  }
}
