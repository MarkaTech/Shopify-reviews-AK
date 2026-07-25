import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';

export async function GET() {
  try {
    const { storeId } = withAuth(request as unknown as Request);
    const settings = await db.storeSetting.findMany({ where: { storeId } });
    const settingsMap: Record<string, string> = {};
    settings.forEach(s => { settingsMap[s.key] = s.value; });
    return NextResponse.json({ settings: settingsMap });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { storeId } = withAuth(request);
    const { settings } = await request.json() as { settings: Record<string, string> };

    for (const [key, value] of Object.entries(settings)) {
      await db.storeSetting.upsert({
        where: { storeId_key: { storeId, key } },
        update: { value },
        create: { storeId, key, value },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
