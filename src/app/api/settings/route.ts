import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';

/**
 * StoreSetting is a shared key-value table: merchant preferences live in it, but so do
 * values the merchant must never control — the monthly request counter their plan is
 * metered on, OAuth tokens for connected platforms, and the signed Google feed token.
 *
 * This endpoint used to upsert whatever keys the request body contained. A merchant could
 * therefore `PUT {"settings": {"usage.requests.2026-08": "0"}}` from their own authenticated
 * session and reset their plan allowance to zero — with GET helpfully returning the key
 * name to copy. The entire three-tier pricing model rested on an integer the customer
 * could edit.
 *
 * Reserved prefixes are refused on write and hidden on read. An allow-list would be
 * stricter still, but merchant preference keys are added often and a deny-list that fails
 * closed on the sensitive namespaces is the version that stays correct when someone adds
 * a preference and forgets this file.
 */
const RESERVED_PREFIXES = [
  'usage.',       // plan metering — the whole billing model
  'etsy.',        // OAuth tokens and refresh tokens
  'google_feed',  // signed feed token
  'auth.',        // session-mechanism telemetry
  'webhooks.',    // registration markers
  'onboarding.',  // written via its own endpoint
];

function isReserved(key: string): boolean {
  return RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export async function GET(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const settings = await db.storeSetting.findMany({ where: { storeId } });
    const settingsMap: Record<string, string> = {};
    settings.forEach(s => {
      if (isReserved(s.key)) return;
      settingsMap[s.key] = s.value;
    });
    return NextResponse.json({ settings: settingsMap });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[Failed to fetch settings]', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const { settings } = await request.json() as { settings: Record<string, string> };

    const rejected = Object.keys(settings).filter(isReserved);
    if (rejected.length) {
      // Loud, not silent. A caller trying to write these is either a bug or an attempt to
      // edit their own billing meter, and both are worth a log line.
      console.warn(`[settings] refused reserved keys for store ${storeId}:`, rejected.join(', '));
      return NextResponse.json(
        { error: 'Some of those settings cannot be changed here.', keys: rejected },
        { status: 400 }
      );
    }

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
    console.error('[Failed to update settings]', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
