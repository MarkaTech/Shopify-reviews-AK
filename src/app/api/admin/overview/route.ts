import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAdminRequest } from '@/lib/admin-auth';
import { PLANS, normalisePlan, type PlanId } from '@/lib/plans';

/**
 * Everything an operator needs on one screen, in four groups:
 *
 *   business  - MRR, paid share, churn, activation. The numbers you check first.
 *   volume    - reviews, requests, moderation backlog. What the platform is doing.
 *   health    - the silent failures: dead tokens, blocked quotas, stuck imports,
 *               bouncing email. None of these surface anywhere else, and each one is a
 *               merchant whose app is broken while everything looks fine.
 *   content   - rating and source mix. Which acquisition path is actually working.
 *
 * Aggregates only - the per-store detail lives on /api/admin/stores where it can be paged.
 */
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const d60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const monthKey = `usage.requests.${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const [
    allStores, installs30, installs30to60, uninstalled30,
    totalReviews, reviews30, pendingModeration, ratingAgg, bySource,
    requestsSent30, requestsSubmitted30, requestsOpened30, queueDue, queueFailing,
    questionsUnanswered, storesWithReviews, storesWithProducts,
    usageRows, importsStuck, importsFailed30, suppressions,
    grantsIssued, grantsRedeemed,
  ] = await Promise.all([
    db.store.findMany({ select: { id: true, plan: true, isActive: true, tokenExpiresAt: true, refreshTokenExpiresAt: true, installedAt: true, updatedAt: true } }),
    db.store.count({ where: { installedAt: { gte: d30 } } }),
    db.store.count({ where: { installedAt: { gte: d60, lt: d30 } } }),
    db.store.count({ where: { isActive: false, updatedAt: { gte: d30 } } }),

    db.review.count(),
    db.review.count({ where: { createdAt: { gte: d30 } } }),
    db.review.count({ where: { isPublished: false } }),
    db.review.aggregate({ _avg: { rating: true } }),
    db.review.groupBy({ by: ['source'], _count: { _all: true } }),

    db.reviewRequest.count({ where: { sentAt: { gte: d30 } } }),
    db.reviewRequest.count({ where: { submittedAt: { gte: d30 } } }),
    db.reviewRequest.count({ where: { openedAt: { gte: d30 } } }),
    db.reviewRequest.count({ where: { nextSendAt: { lte: now } } }),
    db.reviewRequest.count({ where: { sendFailures: { gt: 0 }, nextSendAt: { not: null } } }),

    db.question.count({ where: { isPublished: false } }),
    db.review.groupBy({ by: ['storeId'], _count: { _all: true } }),
    db.product.groupBy({ by: ['storeId'], _count: { _all: true } }),

    db.storeSetting.findMany({ where: { key: monthKey }, select: { storeId: true, value: true } }),
    // "Stuck" = claimed by a worker over an hour ago and never finished.
    db.importJob.count({ where: { status: 'processing', updatedAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) } } }),
    db.importJob.count({ where: { status: 'failed', createdAt: { gte: d30 } } }),
    db.emailSuppression.groupBy({ by: ['reason'], _count: { _all: true } }),

    db.incentiveGrant.count(),
    db.incentiveGrant.count({ where: { redeemedAt: { not: null } } }),
  ]);

  // ── Business ──
  const active = allStores.filter((s) => s.isActive);
  const byPlan: Record<string, number> = {};
  let mrr = 0;
  const revenueByPlan: Record<string, number> = {};
  for (const s of active) {
    const plan = normalisePlan(s.plan) as PlanId;
    byPlan[plan] = (byPlan[plan] ?? 0) + 1;
    const price = PLANS[plan].price;
    mrr += price;
    revenueByPlan[plan] = (revenueByPlan[plan] ?? 0) + price;
  }
  const paidCount = active.filter((s) => normalisePlan(s.plan) !== 'free').length;

  // ── Activation ──
  // An install that never collected a review is, for our purposes, a dead install. It is
  // the most actionable number here: it separates "we have N merchants" from "N merchants
  // are getting value", and those two have never been the same figure.
  const withReviews = new Set(storesWithReviews.map((r) => r.storeId));
  const withProducts = new Set(storesWithProducts.map((r) => r.storeId));
  const activated = active.filter((s) => withReviews.has(s.id)).length;
  const syncedOnly = active.filter((s) => withProducts.has(s.id) && !withReviews.has(s.id)).length;
  const cold = active.filter((s) => !withProducts.has(s.id)).length;

  // ── Health ──
  // A store whose refresh token has expired cannot be called on behalf of at all: no
  // metafield writes, no order lookups, no billing reconcile. It fails silently and
  // permanently until the merchant reinstalls, and nothing else in the product surfaces it.
  const needsReauth = active.filter(
    (s) => s.refreshTokenExpiresAt && s.refreshTokenExpiresAt < now
  ).length;
  const tokenExpiringSoon = active.filter(
    (s) => s.refreshTokenExpiresAt && s.refreshTokenExpiresAt >= now &&
      s.refreshTokenExpiresAt < new Date(now.getTime() + 7 * 86400000)
  ).length;

  const usageByStore = new Map(usageRows.map((r) => [r.storeId, Number(r.value) || 0]));
  let atQuota = 0;
  let nearQuota = 0;
  for (const s of active) {
    const cap = PLANS[normalisePlan(s.plan) as PlanId].maxRequestsPerMonth;
    if (cap == null) continue;
    const used = usageByStore.get(s.id) ?? 0;
    if (used >= cap) atQuota++;
    else if (used / cap >= 0.8) nearQuota++;
  }

  const suppressionByReason = Object.fromEntries(suppressions.map((s) => [s.reason, s._count._all]));
  const hardBounces = (suppressionByReason.bounce ?? 0) + (suppressionByReason.complaint ?? 0);

  // ── Series ──
  const series = async (table: 'Review' | 'Store' | 'ReviewRequest', col: string) =>
    db.$queryRawUnsafe<Array<{ day: Date; n: bigint }>>(
      `SELECT date_trunc('day', "${col}") AS day, count(*) AS n
       FROM "${table}" WHERE "${col}" >= $1 GROUP BY 1 ORDER BY 1`, d30
    );
  const [reviewSeries, installSeries, requestSeries] = await Promise.all([
    series('Review', 'createdAt'),
    series('Store', 'installedAt'),
    series('ReviewRequest', 'sentAt'),
  ]);
  const toSeries = (rows: Array<{ day: Date; n: bigint }>) =>
    rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), n: Number(r.n) }));

  return NextResponse.json({
    business: {
      mrr,
      arpu: active.length > 0 ? mrr / active.length : 0,
      revenueByPlan,
      paidCount,
      paidShare: active.length > 0 ? paidCount / active.length : 0,
      installs30,
      installsPrev30: installs30to60,
      uninstalled30,
      netChange30: installs30 - uninstalled30,
      churnRate30: active.length + uninstalled30 > 0 ? uninstalled30 / (active.length + uninstalled30) : 0,
    },
    stores: { total: allStores.length, active: active.length, byPlan },
    activation: {
      activated,
      syncedOnly,
      cold,
      rate: active.length > 0 ? activated / active.length : 0,
    },
    reviews: {
      total: totalReviews,
      last30: reviews30,
      pendingModeration,
      avgRating: ratingAgg._avg.rating ?? null,
      bySource: Object.fromEntries(bySource.map((r) => [r.source, r._count._all])),
    },
    requests: {
      sent30: requestsSent30,
      opened30: requestsOpened30,
      submitted30: requestsSubmitted30,
      conversion30: requestsSent30 > 0 ? requestsSubmitted30 / requestsSent30 : null,
      queueDue,
      queueFailing,
    },
    health: {
      needsReauth,
      tokenExpiringSoon,
      atQuota,
      nearQuota,
      importsStuck,
      importsFailed30,
      emailSuppressed: Object.values(suppressionByReason).reduce((a, b) => a + b, 0),
      hardBounces,
      suppressionByReason,
      questionsUnanswered,
      queueFailing,
    },
    incentives: {
      issued: grantsIssued,
      redeemed: grantsRedeemed,
      redemptionRate: grantsIssued > 0 ? grantsRedeemed / grantsIssued : null,
    },
    series: { reviews: toSeries(reviewSeries), installs: toSeries(installSeries), requests: toSeries(requestSeries) },
  });
}
