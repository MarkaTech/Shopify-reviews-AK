import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAdminRequest } from '@/lib/admin-auth';
import { getRequestUsage, normalisePlan, PLANS, type PlanId } from '@/lib/plans';

/**
 * One merchant in detail, and the operations an operator can perform on them.
 *
 * What is deliberately NOT here:
 *  - accessToken / refreshToken are never selected, in any branch.
 *  - No data deletion. Erasure has a GDPR path with its own guarantees; an admin
 *    button that hard-deletes a merchant's reviews is an incident waiting for a click.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const store = await db.store.findUnique({
    where: { id },
    select: {
      id: true, name: true, shopifyDomain: true, email: true, plan: true,
      isActive: true, installedAt: true, createdAt: true, updatedAt: true,
      tokenExpiresAt: true, refreshTokenExpiresAt: true,
    },
  });
  if (!store) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [
    usage, settings, productCount, reviewsByStatus, requestStats30,
    recentReviews, recentRequests, widgets, incentives, questionCount,
  ] = await Promise.all([
    getRequestUsage(store.id),
    db.storeSetting.findMany({ where: { storeId: id }, select: { key: true, value: true, updatedAt: true }, orderBy: { key: 'asc' } }),
    db.product.count({ where: { storeId: id } }),
    db.review.groupBy({ by: ['isPublished'], where: { storeId: id }, _count: { _all: true } }),
    db.reviewRequest.aggregate({
      where: { storeId: id, createdAt: { gte: d30 } },
      _count: { _all: true },
    }),
    db.review.findMany({
      where: { storeId: id },
      select: { id: true, rating: true, title: true, isPublished: true, reviewerName: true, source: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    db.reviewRequest.findMany({
      where: { storeId: id },
      select: {
        id: true, orderNumber: true, customerEmail: true, sentAt: true, openedAt: true,
        submittedAt: true, nextSendAt: true, sendCount: true, sendFailures: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    db.widgetConfig.count({ where: { storeId: id } }),
    db.incentive.count({ where: { storeId: id } }),
    db.question.count({ where: { storeId: id } }),
  ]);

  // Mask customer emails: the operator needs "which request", not the address itself.
  const mask = (email: string) => {
    const [user, domain] = email.split('@');
    if (!domain) return '***';
    return `${user.slice(0, 2)}***@${domain}`;
  };

  return NextResponse.json({
    store,
    usage,
    settings,
    counts: {
      products: productCount,
      questions: questionCount,
      widgets,
      incentives,
      reviewsByStatus: Object.fromEntries(
        reviewsByStatus.map((r) => [r.isPublished ? 'published' : 'pending', r._count?._all ?? 0])
      ),
      requestsCreated30: requestStats30._count._all,
    },
    recentReviews,
    recentRequests: recentRequests.map((r) => ({ ...r, customerEmail: mask(r.customerEmail) })),
    sendingPaused: settings.some((s) => s.key === 'admin.sendingPaused' && s.value === '1'),
  });
}

/**
 * Operations. Body: { action: 'set-plan' | 'pause-sending' | 'resume-sending' | 'reconcile-billing', plan? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const store = await db.store.findUnique({ where: { id }, select: { id: true, shopifyDomain: true, plan: true } });
  if (!store) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: { action?: string; plan?: string } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  switch (body.action) {
    case 'set-plan': {
      // Explicit allow-list, not normalisePlan: that helper maps anything unknown to
      // 'free', which would turn an operator's typo into a silent downgrade.
      if (!body.plan || !(body.plan in PLANS)) {
        return NextResponse.json({ error: 'Unknown plan' }, { status: 400 });
      }
      const plan = normalisePlan(body.plan);
      await db.store.update({ where: { id }, data: { plan } });
      console.warn(`[admin] plan for ${store.shopifyDomain} set to '${plan}' (was '${store.plan}') by operator`);
      return NextResponse.json({
        ok: true,
        plan,
        note: 'Hourly billing reconciliation with Shopify may revert this unless a matching subscription exists.',
      });
    }
    case 'pause-sending':
    case 'resume-sending': {
      const pause = body.action === 'pause-sending';
      await db.storeSetting.upsert({
        where: { storeId_key: { storeId: id, key: 'admin.sendingPaused' } },
        create: { storeId: id, key: 'admin.sendingPaused', value: pause ? '1' : '0' },
        update: { value: pause ? '1' : '0' },
      });
      console.warn(`[admin] review-request sending ${pause ? 'PAUSED' : 'resumed'} for ${store.shopifyDomain} by operator`);
      return NextResponse.json({ ok: true, sendingPaused: pause });
    }
    case 'reconcile-billing': {
      // Ask Shopify what is actually active and write that down — the same path the
      // hourly job takes, on demand.
      try {
        const { resolveActivePlan } = await import('@/lib/shopify');
        const { getFreshAccessTokenByStoreId, tokenRefresherFor } = await import('@/lib/shopify-token');
        if (!store.shopifyDomain) return NextResponse.json({ error: 'Store has no domain' }, { status: 400 });
        const token = await getFreshAccessTokenByStoreId(id);
        const plan = await resolveActivePlan(store.shopifyDomain, token, tokenRefresherFor(id));
        await db.store.update({ where: { id }, data: { plan } });
        return NextResponse.json({ ok: true, plan });
      } catch (error) {
        console.error('[admin] reconcile failed', error);
        return NextResponse.json({ error: 'Reconcile failed — token may need re-auth' }, { status: 502 });
      }
    }
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}
