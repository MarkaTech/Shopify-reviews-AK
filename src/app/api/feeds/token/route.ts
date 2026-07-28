import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { assertFeature, planLimitResponse } from '@/lib/plans';
import { SHOPIFY_APP_URL } from '@/lib/shopify';

/**
 * Issue (or rotate) the Google Merchant Center feed token.
 *
 * Google's crawler cannot authenticate, so the feed URL has to be publicly fetchable. An
 * unguessable per-store token in the query string is the standard answer: it keeps one
 * merchant's review corpus from being enumerable by guessing shop domains, without
 * requiring a login the crawler cannot perform.
 *
 * Rotatable, because a URL that ends up in a shared spreadsheet or a support ticket needs
 * a way to be invalidated.
 */
export async function POST(request: NextRequest) {
  try {
    const { storeId, shop } = await withAuth(request);

    // Gated behind a paid plan — this is one of the clearest paid-tier justifications in
    // the product, since it produces measurable click-through lift on Shopping listings.
    await assertFeature(storeId, 'advancedAnalytics');

    const token = crypto.randomBytes(24).toString('base64url');
    await db.storeSetting.upsert({
      where: { storeId_key: { storeId, key: 'google_feed_token' } },
      create: { storeId, key: 'google_feed_token', value: token },
      update: { value: token },
    });

    const url = `${SHOPIFY_APP_URL}/api/feeds/google?shop=${encodeURIComponent(shop)}&token=${token}`;
    return NextResponse.json({ url, token });
  } catch (error: unknown) {
    const limit = planLimitResponse(error);
    if (limit) return NextResponse.json(limit.body, { status: limit.status });
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[feeds/token]', error);
    return NextResponse.json({ error: 'Failed to create feed URL' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { storeId, shop } = await withAuth(request);
    const setting = await db.storeSetting.findUnique({
      where: { storeId_key: { storeId, key: 'google_feed_token' } },
    });
    if (!setting?.value) return NextResponse.json({ url: null });
    return NextResponse.json({
      url: `${SHOPIFY_APP_URL}/api/feeds/google?shop=${encodeURIComponent(shop)}&token=${setting.value}`,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    return NextResponse.json({ error: 'Failed to read feed URL' }, { status: 500 });
  }
}
