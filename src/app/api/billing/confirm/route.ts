import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { activateCharge } from '@/lib/shopify';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { shop, accessToken, storeId } = await withAuth(request);
    const { searchParams } = new URL(request.url);
    const chargeId = searchParams.get('charge_id');

    if (!chargeId) {
      return NextResponse.json({ error: 'charge_id is required' }, { status: 400 });
    }

    // Activate the charge
    await activateCharge(shop, accessToken, chargeId);

    // Determine plan from charge name (simplified)
    const plan = searchParams.get('plan') || 'pro';

    // Update store plan
    await db.store.update({
      where: { id: storeId },
      data: { plan },
    });

    return NextResponse.json({ success: true, plan, activated: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to activate charge';
    const status = (error as Error & { status?: number }).status || 500;
    return NextResponse.json({ error: message }, { status });
  }
}
