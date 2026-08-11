import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { resolveActivePlan } from '@/lib/shopify';
import { db } from '@/lib/db';

/**
 * Landing point after the merchant approves (or declines) a subscription in Shopify.
 *
 * Two things changed here, both of them bugs rather than refactors:
 *
 * 1. SECURITY — the plan used to come from `?plan=` in the query string, which the browser
 *    controls. Anyone could visit /api/billing/confirm?charge_id=1&plan=enterprise and be
 *    granted the $99.99 tier without paying. The plan is now read from Shopify's own list
 *    of active subscriptions, which is the only trustworthy source.
 *
 * 2. CORRECTNESS — there is no longer an "activate the charge" step. That belonged to the
 *    REST recurring_application_charges flow, which this app can no longer use (new public
 *    apps must be GraphQL-only). With appSubscriptionCreate, merchant approval activates
 *    the subscription; we just read back what Shopify says is active.
 *
 * If the merchant declined, there is no active subscription and this correctly resolves to
 * the free plan rather than silently upgrading them.
 */
export async function GET(request: NextRequest) {
  try {
    const { shop, accessToken, storeId, onUnauthorized } = await withAuth(request);

    const plan = await resolveActivePlan(shop, accessToken, onUnauthorized);

    await db.store.update({
      where: { id: storeId },
      data: { plan },
    });

    return NextResponse.json({
      success: true,
      plan,
      activated: plan !== 'free',
    });
  } catch (error: unknown) {
    console.error('[billing/confirm] failed:', error);
    const status = (error as Error & { status?: number }).status || 500;
    return NextResponse.json({ error: 'Could not confirm your subscription.' }, { status });
  }
}
