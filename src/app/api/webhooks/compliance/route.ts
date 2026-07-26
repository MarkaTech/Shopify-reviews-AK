import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookHmac } from '@/lib/shopify';
import { handleComplianceTopic } from '@/lib/compliance';

/**
 * Single endpoint for Shopify's three mandatory compliance webhooks.
 *
 * shopify.app.toml supplies one uri for all compliance topics, so the topic arrives in
 * the X-Shopify-Topic header rather than the path. Shopify requires a 2xx response even
 * when we hold no data for the shop, so failures are logged rather than surfaced as
 * error statuses — a non-2xx here shows as a failing webhook in the Partner Dashboard
 * and blocks App Store approval.
 */
export async function POST(request: NextRequest) {
  try {
    const hmacHeader = request.headers.get('x-shopify-hmac-sha256') || '';
    const rawBody = await request.text();

    if (!verifyWebhookHmac(rawBody, hmacHeader)) {
      // A genuine 401 here is correct: an unverified request is not from Shopify.
      return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
    }

    const topic = request.headers.get('x-shopify-topic') || '';
    const shop = request.headers.get('x-shopify-shop-domain') || '';
    const data = JSON.parse(rawBody);

    const handled = await handleComplianceTopic(topic, data, shop);
    if (!handled) {
      console.warn(`[GDPR] unrecognised compliance topic: ${topic}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('[GDPR] compliance webhook error:', error);
    // Still acknowledge: Shopify retries on non-2xx and repeated failures block approval.
    return NextResponse.json({ received: true });
  }
}
