import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { createRecurringCharge, cancelActiveSubscriptions, SHOPIFY_APP_URL } from '@/lib/shopify';

export async function POST(request: NextRequest) {
  try {
    const { shop, accessToken, storeId, onUnauthorized } = await withAuth(request);

    const body = await request.json() as { plan: string; returnUrl?: string };
    const { plan, returnUrl } = body;

    if (!plan) {
      return NextResponse.json({ error: 'Plan is required' }, { status: 400 });
    }

    const validPlans = ['free', 'growth', 'scale'];
    if (!validPlans.includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    if (plan === 'free') {
      // Downgrade means cancelling the charge at Shopify, not writing 'free' locally.
      //
      // This used to do only the local write. The merchant lost their paid features
      // immediately, Shopify carried on billing them, and reconcilePlan saw a
      // still-ACTIVE subscription and restored the paid tier within the hour — so the
      // cancellation undid itself while the money kept moving, and there was no path
      // anywhere in the app to stop the charge.
      //
      // Cancel FIRST, then write. If the cancel throws we fall to the catch and the
      // stored plan is untouched, which leaves the merchant on the tier they are still
      // paying for. The alternative ordering fails toward "free locally, billed at
      // Shopify" — the exact broken state this replaces.
      const cancelled = await cancelActiveSubscriptions(shop, accessToken, onUnauthorized);

      const { db } = await import('@/lib/db');
      await db.store.update({
        where: { id: storeId },
        data: { plan: 'free' },
      });

      console.log(`[billing] ${shop} downgraded to free (${cancelled} subscription(s) cancelled)`);
      return NextResponse.json({ success: true, plan: 'free', activated: true, cancelled });
    }

    const chargeReturnUrl = returnUrl || `${SHOPIFY_APP_URL}/?shop=${shop}&billing=success`;

    const confirmationUrl = await createRecurringCharge(
      shop,
      accessToken,
      plan,
      chargeReturnUrl,
      onUnauthorized
    );

    return NextResponse.json({
      confirmationUrl,
      plan,
    });
  } catch (error: unknown) {
    // Logged in full, returned generic. Every other route in the app does this; these two
    // billing routes echoed `error.message` verbatim, which leaks Shopify userErrors and
    // GraphQL internals to the browser for no benefit to the merchant.
    console.error('[billing] charge/cancel failed:', error);
    const status = (error as Error & { status?: number }).status || 500;
    return NextResponse.json(
      { error: 'Could not update your plan. Please try again, or contact support if it keeps failing.' },
      { status }
    );
  }
}
