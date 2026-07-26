import { NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { storeId, shop } = await withAuth(request);

    const store = await db.store.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        name: true,
        domain: true,
        shopifyDomain: true,
        plan: true,
        isActive: true,
        installedAt: true,
      },
    });

    return NextResponse.json({ store: { ...store, shop } });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[Failed to fetch store info]', error);
    return NextResponse.json({ error: 'Failed to fetch store info' }, { status: 500 });
  }
}
