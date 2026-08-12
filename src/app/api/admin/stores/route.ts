import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAdminRequest } from '@/lib/admin-auth';

/**
 * Every merchant, with the numbers an operator actually scans for: plan, activity,
 * review volume, moderation backlog, request throughput and failure count.
 *
 * Aggregates come from three groupBy queries merged in JS rather than N+1 count()s per
 * store. Tokens are never selected — nothing on this route can leak a credential.
 */
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const q = (request.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const stores = await db.store.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { shopifyDomain: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : undefined,
    select: {
      id: true,
      name: true,
      shopifyDomain: true,
      email: true,
      plan: true,
      isActive: true,
      installedAt: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const ids = stores.map((s) => s.id);
  const [reviewAgg, pendingAgg, sentAgg, failAgg, settingRows] = await Promise.all([
    db.review.groupBy({ by: ['storeId'], where: { storeId: { in: ids } }, _count: { _all: true }, _max: { createdAt: true } }),
    db.review.groupBy({ by: ['storeId'], where: { storeId: { in: ids }, isPublished: false }, _count: { _all: true } }),
    db.reviewRequest.groupBy({ by: ['storeId'], where: { storeId: { in: ids }, sentAt: { gte: monthStart } }, _count: { _all: true } }),
    db.reviewRequest.groupBy({ by: ['storeId'], where: { storeId: { in: ids }, sendFailures: { gt: 0 }, nextSendAt: { not: null } }, _count: { _all: true } }),
    db.storeSetting.findMany({ where: { storeId: { in: ids }, key: 'admin.sendingPaused' }, select: { storeId: true, value: true } }),
  ]);

  const by = <T extends { storeId: string }>(rows: T[]) => new Map(rows.map((r) => [r.storeId, r]));
  const countAll = (r: { _count: { _all: number } | null } | undefined) => r?._count?._all ?? 0;
  const reviews = by(reviewAgg);
  const pending = by(pendingAgg);
  const sent = by(sentAgg);
  const failing = by(failAgg);
  const paused = new Set(settingRows.filter((r) => r.value === '1').map((r) => r.storeId));

  return NextResponse.json({
    stores: stores.map((s) => ({
      ...s,
      reviewCount: countAll(reviews.get(s.id)),
      lastReviewAt: reviews.get(s.id)?._max.createdAt ?? null,
      pendingReviews: countAll(pending.get(s.id)),
      requestsSentThisMonth: countAll(sent.get(s.id)),
      failingRequests: countAll(failing.get(s.id)),
      sendingPaused: paused.has(s.id),
    })),
  });
}
