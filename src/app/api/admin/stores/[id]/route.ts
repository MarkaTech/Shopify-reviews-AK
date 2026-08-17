import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { classifyImportFailure } from '@/lib/import-health';
import { isAdminRequest } from '@/lib/admin-auth';
import { getRequestUsage, normalisePlan, PLANS } from '@/lib/plans';

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
    failedImports,
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
    // The reasons, not just a count. "Imports failed: 6" cost a whole session to explain
    // once, and the answer — a merchant pasting listing URLs with no reviews on them —
    // was only reachable from the database.
    db.importJob.findMany({
      where: { storeId: id, status: 'failed' },
      select: { id: true, source: true, errorMessage: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 6,
    }),
  ]);

  // Mask customer emails: the operator needs "which request", not the address itself.
  const mask = (email: string) => {
    const [user, domain] = email.split('@');
    if (!domain) return '***';
    return `${user.slice(0, 2)}***@${domain}`;
  };

  const note = settings.find((s) => s.key === 'admin.note')?.value ?? '';
  const get = (k: string) => settings.find((s) => s.key === k)?.value ?? null;

  /**
   * The integrations, decoded. These all lived in the raw settings dump, which meant an
   * operator had to know the key names to answer "why is this merchant getting no review
   * requests". Webhooks especially: a store with no registration marker never receives
   * orders/fulfilled, so no invitation is ever created for them — total, silent, and
   * per-merchant.
   */
  const integrations = {
    webhooksRegisteredAt: get('webhooks.registeredAt'),
    planReconciledAt: get('plan.reconciledAt'),
    authLastVia: get('auth.lastVia'),
    etsy: { shopId: get('etsy.shopId'), lastSyncAt: get('etsy.lastSyncAt'), connected: Boolean(get('etsy.shopId')) },
    googleFeedTokenIssued: Boolean(get('google_feed_token')),
    syndicationEnabled: get('syndication_enabled') === 'true',
    weeklySummaryOptIn: get('notify.weeklySummary') === 'true',
    onboardingDismissedAt: get('onboarding.dismissedAt'),
    requestSettings: Object.fromEntries(
      settings.filter((s) => s.key.startsWith('requests.')).map((s) => [s.key.slice('requests.'.length), s.value])
    ),
  };
  const handle = store.shopifyDomain?.replace('.myshopify.com', '') ?? null;

  return NextResponse.json({
    store,
    usage,
    settings,
    note,
    integrations,
    links: handle
      ? {
          shopifyAdmin: `https://admin.shopify.com/store/${handle}`,
          appInAdmin: `https://admin.shopify.com/store/${handle}/apps/reviewmaster-reviews`,
          storefront: `https://${store.shopifyDomain}`,
        }
      : null,
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
    // Classified, so an operator can see at a glance which of these are theirs to fix.
    recentImportFailures: failedImports.map((j) => ({
      id: j.id,
      source: j.source,
      createdAt: j.createdAt,
      kind: classifyImportFailure(j.errorMessage),
      // Truncated: these carry upstream diagnostics that run to hundreds of characters,
      // and the drawer needs the gist. The full text is in the row if it is ever needed.
      error: (j.errorMessage ?? 'No error recorded').slice(0, 240),
    })),
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

  let body: {
    action?: string; plan?: string; amount?: unknown;
    note?: unknown; reviewId?: unknown; publish?: unknown; requestId?: unknown;
  } = {};
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
    case 'resync-products': {
      // "My products aren't showing" is the single most common support message a
      // catalogue-backed app gets, and until now the only answer was to ask the merchant
      // to press a button inside their own admin.
      try {
        if (!store.shopifyDomain) return NextResponse.json({ error: 'Store has no domain' }, { status: 400 });
        const { syncProducts } = await import('@/lib/product-sync');
        const { getFreshAccessTokenByStoreId, tokenRefresherFor } = await import('@/lib/shopify-token');
        const token = await getFreshAccessTokenByStoreId(id);
        const result = await syncProducts(store.shopifyDomain, store.shopifyDomain, token, tokenRefresherFor(id));
        return NextResponse.json({ ok: true, note: `Synced: ${result.created} new, ${result.alreadyPresent} already held, ${result.fetched} fetched${result.truncated ? ' (truncated)' : ''}.` });
      } catch (error) {
        console.error('[admin] resync failed', error);
        return NextResponse.json({ error: 'Sync failed — token may need re-auth' }, { status: 502 });
      }
    }

    case 'recompute-ratings': {
      // The local aggregate and the Shopify metafield can drift apart independently, and
      // when they do the widget and the theme's own stars disagree in front of shoppers.
      // This rebuilds both from the reviews, which are the only source of truth.
      try {
        const { rebuildStoreRatings } = await import('@/lib/ratings');
        const { getFreshAccessTokenByStoreId, tokenRefresherFor } = await import('@/lib/shopify-token');
        let ctx: { shop: string; accessToken: string; onUnauthorized?: () => Promise<string | null> } | undefined;
        if (store.shopifyDomain) {
          try {
            ctx = {
              shop: store.shopifyDomain,
              accessToken: await getFreshAccessTokenByStoreId(id),
              onUnauthorized: tokenRefresherFor(id),
            };
          } catch {
            // Recompute the local aggregates anyway; the metafield push just won't happen.
            ctx = undefined;
          }
        }
        const result = await rebuildStoreRatings(id, ctx);
        return NextResponse.json({
          ok: true,
          note: `Recomputed ${result.products} product${result.products === 1 ? '' : 's'}${result.failed ? `, ${result.failed} failed` : ''}${ctx ? '' : ' (local only — no valid token, Shopify metafields not updated)'}.`,
        });
      } catch (error) {
        console.error('[admin] recompute failed', error);
        return NextResponse.json({ error: 'Recompute failed' }, { status: 500 });
      }
    }

    case 'retry-failed-sends': {
      // Clears the backoff for this store: failures back to zero and everything due now.
      // Correct after the cause was external and is fixed - a rotated provider key, an
      // outage - where the alternative is waiting out an exponential backoff.
      const result = await db.reviewRequest.updateMany({
        where: { storeId: id, sendFailures: { gt: 0 }, nextSendAt: { not: null }, submittedAt: null },
        data: { sendFailures: 0, nextSendAt: new Date() },
      });
      console.warn(`[admin] requeued ${result.count} failed sends for ${store.shopifyDomain} by operator`);
      return NextResponse.json({ ok: true, note: `${result.count} request${result.count === 1 ? '' : 's'} requeued for the next sweep.` });
    }

    case 'clear-stuck-imports': {
      // A job claimed and never finished blocks the merchant from starting another.
      // Marking it failed is honest and lets them retry; it invents no rows.
      const cutoff = new Date(Date.now() - 60 * 60 * 1000);
      const result = await db.importJob.updateMany({
        where: { storeId: id, status: 'processing', updatedAt: { lt: cutoff } },
        data: { status: 'failed', errorMessage: 'Cleared by operator — job stalled and never completed.', completedAt: new Date() },
      });
      return NextResponse.json({ ok: true, note: `${result.count} stalled import${result.count === 1 ? '' : 's'} cleared.` });
    }

    case 'grant-quota': {
      // Comp a merchant extra sends this month without charging them, by crediting the
      // counter the quota check reads. Upgrading their plan was the only lever before,
      // and that bills them for our goodwill.
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000) {
        return NextResponse.json({ error: 'Amount must be between 1 and 10000' }, { status: 400 });
      }
      const now = new Date();
      const key = `usage.requests.${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const row = await db.storeSetting.findUnique({ where: { storeId_key: { storeId: id, key } }, select: { value: true } });
      const used = Number(row?.value ?? 0) || 0;
      const next = Math.max(0, used - Math.round(amount));
      await db.storeSetting.upsert({
        where: { storeId_key: { storeId: id, key } },
        create: { storeId: id, key, value: String(next) },
        update: { value: String(next) },
      });
      console.warn(`[admin] granted ${amount} request credits to ${store.shopifyDomain}: counter ${used} -> ${next}`);
      return NextResponse.json({ ok: true, note: `Credited ${Math.round(amount)} sends — this month's counter is now ${next}.` });
    }

    case 'reregister-webhooks': {
      // A store with no registration marker never receives orders/fulfilled, which means
      // no review request is ever created for them. It fails silently and completely, and
      // the self-healing path only retries on a fresh process. This forces it now.
      try {
        if (!store.shopifyDomain) return NextResponse.json({ error: 'Store has no domain' }, { status: 400 });
        const { registerWebhooks } = await import('@/lib/shopify');
        const { markWebhooksRegistered, clearWebhookRegistration } = await import('@/lib/webhook-health');
        const { getFreshAccessTokenByStoreId } = await import('@/lib/shopify-token');
        await clearWebhookRegistration(id);
        const token = await getFreshAccessTokenByStoreId(id);
        await registerWebhooks(store.shopifyDomain, token);
        await markWebhooksRegistered(id);
        return NextResponse.json({ ok: true, note: 'Webhooks re-registered with Shopify.' });
      } catch (error) {
        console.error('[admin] webhook re-registration failed', error);
        return NextResponse.json({ error: 'Re-registration failed — token may need re-auth' }, { status: 502 });
      }
    }

    case 'cancel-request': {
      // Stop a queued invitation from ever sending. Used when a merchant asks on a
      // customer's behalf, or when a bad address is looping. Clears nextSendAt rather
      // than deleting the row, so the audit trail of what was created survives.
      const requestId = typeof body.requestId === 'string' ? body.requestId : '';
      if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 });
      const result = await db.reviewRequest.updateMany({
        where: { id: requestId, storeId: id },
        data: { nextSendAt: null },
      });
      if (result.count === 0) return NextResponse.json({ error: 'Request not found on this store' }, { status: 404 });
      return NextResponse.json({ ok: true, note: 'Request cancelled — it will not be sent.' });
    }

    case 'set-note': {
      const text = typeof body.note === 'string' ? body.note.slice(0, 2000) : '';
      await db.storeSetting.upsert({
        where: { storeId_key: { storeId: id, key: 'admin.note' } },
        create: { storeId: id, key: 'admin.note', value: text },
        update: { value: text },
      });
      return NextResponse.json({ ok: true, note: 'Note saved.' });
    }

    case 'set-review-published': {
      // Moderation on a merchant's behalf, for the cases they cannot handle themselves:
      // a legal takedown, a review carrying someone's personal data, abuse. Unpublishing
      // hides it everywhere and is fully reversible - nothing here deletes.
      const reviewId = typeof body.reviewId === 'string' ? body.reviewId : '';
      const publish = Boolean(body.publish);
      if (!reviewId) return NextResponse.json({ error: 'reviewId required' }, { status: 400 });
      const owned = await db.review.findFirst({ where: { id: reviewId, storeId: id }, select: { id: true, productId: true } });
      if (!owned) return NextResponse.json({ error: 'Review not found on this store' }, { status: 404 });
      await db.review.update({ where: { id: reviewId }, data: { isPublished: publish } });
      // The aggregate counts published reviews only, so it has to follow.
      if (owned.productId) {
        try {
          const { updateProductRating } = await import('@/lib/ratings');
          await updateProductRating(id, owned.productId);
        } catch (error) {
          console.error('[admin] rating update after moderation failed', error);
        }
      }
      console.warn(`[admin] review ${reviewId} ${publish ? 'published' : 'unpublished'} on ${store.shopifyDomain} by operator`);
      return NextResponse.json({ ok: true, note: `Review ${publish ? 'published' : 'unpublished'}.` });
    }

    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }
}
