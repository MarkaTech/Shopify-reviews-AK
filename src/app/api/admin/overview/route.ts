import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAdminRequest } from '@/lib/admin-auth';

/**
 * Global operator metrics. One round of aggregates, no per-store fan-out — the per-store
 * numbers live on /api/admin/stores where they can be paged.
 */
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalStores,
    activeStores,
    plans,
    installs30,
    totalReviews,
    reviews30,
    pendingModeration,
    requestsSent30,
    requestsSubmitted30,
    queueDue,
    queueFailing,
    questionsUnanswered,
  ] = await Promise.all([
    db.store.count(),
    db.store.count({ where: { isActive: true } }),
    db.store.groupBy({ by: ['plan'], _count: { _all: true } }),
    db.store.count({ where: { installedAt: { gte: d30 } } }),
    db.review.count(),
    db.review.count({ where: { createdAt: { gte: d30 } } }),
    db.review.count({ where: { isPublished: false } }),
    db.reviewRequest.count({ where: { sentAt: { gte: d30 } } }),
    db.reviewRequest.count({ where: { submittedAt: { gte: d30 } } }),
    db.reviewRequest.count({ where: { nextSendAt: { lte: now } } }),
    db.reviewRequest.count({ where: { sendFailures: { gt: 0 }, nextSendAt: { not: null } } }),
    db.question.count({ where: { isPublished: false } }),
  ]);

  // Daily series for the last 30 days. date_trunc in SQL rather than 30 count() calls.
  const reviewSeries = await db.$queryRaw<Array<{ day: Date; n: bigint }>>`
    SELECT date_trunc('day', "createdAt") AS day, count(*) AS n
    FROM "Review" WHERE "createdAt" >= ${d30}
    GROUP BY 1 ORDER BY 1`;
  const installSeries = await db.$queryRaw<Array<{ day: Date; n: bigint }>>`
    SELECT date_trunc('day', "installedAt") AS day, count(*) AS n
    FROM "Store" WHERE "installedAt" >= ${d30}
    GROUP BY 1 ORDER BY 1`;
  const requestSeries = await db.$queryRaw<Array<{ day: Date; n: bigint }>>`
    SELECT date_trunc('day', "sentAt") AS day, count(*) AS n
    FROM "ReviewRequest" WHERE "sentAt" >= ${d30}
    GROUP BY 1 ORDER BY 1`;

  const toSeries = (rows: Array<{ day: Date; n: bigint }>) =>
    rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), n: Number(r.n) }));

  return NextResponse.json({
    stores: {
      total: totalStores,
      active: activeStores,
      installs30,
      byPlan: Object.fromEntries(plans.map((p) => [p.plan, p._count._all])),
    },
    reviews: { total: totalReviews, last30: reviews30, pendingModeration },
    requests: {
      sent30: requestsSent30,
      submitted30: requestsSubmitted30,
      conversion30: requestsSent30 > 0 ? requestsSubmitted30 / requestsSent30 : null,
      queueDue,
      queueFailing,
    },
    questions: { unanswered: questionsUnanswered },
    series: {
      reviews: toSeries(reviewSeries),
      installs: toSeries(installSeries),
      requests: toSeries(requestSeries),
    },
  });
}
