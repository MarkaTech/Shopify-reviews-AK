import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { assertFeature, planLimitResponse } from '@/lib/plans';
import { beginEtsyConnect, isEtsyConnected, EtsyError } from '@/lib/etsy';
import { SHOPIFY_APP_URL } from '@/lib/shopify';

/** Connection status for the Import page card. */
export async function GET(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    return NextResponse.json(await isEtsyConnected(storeId));
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    return NextResponse.json({ error: 'Failed to load Etsy status' }, { status: 500 });
  }
}

/** Start the OAuth dance: store the keystring + shop, return the Etsy consent URL. */
export async function POST(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    await assertFeature(storeId, 'platformImport');

    const body = (await request.json()) as { keystring?: string; shop?: string };
    const authUrl = await beginEtsyConnect(
      storeId,
      String(body.keystring || ''),
      String(body.shop || ''),
      SHOPIFY_APP_URL
    );
    return NextResponse.json({ authUrl });
  } catch (error: unknown) {
    if (error instanceof EtsyError) return NextResponse.json({ error: error.merchantMessage }, { status: 400 });
    const limit = planLimitResponse(error);
    if (limit) return NextResponse.json(limit.body, { status: limit.status });
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[etsy/connect]', error);
    return NextResponse.json({ error: 'Could not start the Etsy connection' }, { status: 500 });
  }
}
