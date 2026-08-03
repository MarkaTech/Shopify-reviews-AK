import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import {
  getRequestSettings,
  saveRequestSettings,
  DEFAULT_REQUEST_SETTINGS,
} from '@/lib/request-settings';

/** Merchant-facing read/write of review-request scheduling (delay + reminders). */
export async function GET(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const settings = await getRequestSettings(storeId);
    return NextResponse.json({ settings, defaults: DEFAULT_REQUEST_SETTINGS });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[request-settings GET]', error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const body = (await request.json()) as { updates?: Record<string, string> };
    if (!body.updates || typeof body.updates !== 'object') {
      return NextResponse.json({ error: 'updates object is required' }, { status: 400 });
    }
    const result = await saveRequestSettings(storeId, body.updates);
    const settings = await getRequestSettings(storeId);
    return NextResponse.json({ success: true, ...result, settings });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[request-settings PUT]', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
