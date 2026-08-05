import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { createRecurringCharge, SHOPIFY_APP_URL } from '@/lib/shopify';

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
      // Free plan — no charge, just update the store
      const { db } = await import('@/lib/db');
      await db.store.update({
        where: { id: storeId },
        data: { plan: 'free' },
      });
      return NextResponse.json({ success: true, plan: 'free', activated: true });
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
    const message = error instanceof Error ? error.message : 'Failed to create charge';
    const status = (error as Error & { status?: number }).status || 500;
    return NextResponse.json({ error: message }, { status });
  }
}
