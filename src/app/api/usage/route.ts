import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { getUsage } from '@/lib/plans';

/**
 * Current plan, usage and feature flags for the signed-in store.
 * The dashboard uses this to show "42 / 50 reviews used" and to disable controls the
 * merchant's plan does not include.
 */
export async function GET(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    return NextResponse.json(await getUsage(storeId));
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('Error fetching usage:', error);
    return NextResponse.json({ error: 'Failed to fetch usage' }, { status: 500 });
  }
}
