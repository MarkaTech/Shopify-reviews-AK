import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import {
  getRequestSettings,
  saveRequestSettings,
  DEFAULT_REQUEST_SETTINGS,
} from '@/lib/request-settings';
import { getStorePlan, PLANS } from '@/lib/plans';

/**
 * Whether this store's plan sends reminders at all.
 *
 * The stored reminder count is the merchant's choice and survives a downgrade, but
 * request-sender.ts sends no reminder on a plan without `reminderEmails`. Every surface
 * that reads these settings says "1 reminder" from the stored count, so it needs the plan's
 * answer beside it or it tells a Free store a follow-up goes out that never does. Read the
 * same way the sender reads it (getStorePlan), so the sentence and the sending agree.
 */
async function remindersAllowed(storeId: string): Promise<boolean> {
  return PLANS[await getStorePlan(storeId)].reminderEmails;
}

/** Merchant-facing read/write of review-request scheduling (delay + reminders). */
export async function GET(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const [settings, allowed] = await Promise.all([getRequestSettings(storeId), remindersAllowed(storeId)]);
    return NextResponse.json({ settings, defaults: DEFAULT_REQUEST_SETTINGS, remindersAllowed: allowed });
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
    const [settings, allowed] = await Promise.all([getRequestSettings(storeId), remindersAllowed(storeId)]);
    return NextResponse.json({ success: true, ...result, settings, remindersAllowed: allowed });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[request-settings PUT]', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
