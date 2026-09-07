import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookHmac } from '@/lib/shopify';
import { handleComplianceTopic, ShopMismatchError } from '@/lib/compliance';

/**
 * Single endpoint for Shopify's three mandatory compliance webhooks.
 *
 * shopify.app.toml supplies one uri for all compliance topics, so the topic arrives in
 * the X-Shopify-Topic header rather than the path.
 *
 * **A handler failure returns 500, on purpose.**
 *
 * This used to return 200 unconditionally, reasoning that a failing webhook in the
 * Partner Dashboard blocks approval. That gets the trade exactly backwards. Shopify
 * retries a non-2xx; it never retries a 200. So swallowing an exception here converts a
 * transient, recoverable failure — a dropped connection, a lock timeout, a batch that
 * exceeded a driver limit — into a customer's data being permanently *not* erased, with
 * a green tick in the dashboard saying it was.
 *
 * Erasure is a legal obligation with a deadline, not a best-effort background job. A
 * visible failing webhook is a problem you can see and fix. A silent one is a compliance
 * breach nobody discovers.
 *
 * "No data for this shop" is not a failure and never reaches the catch — the handlers
 * return normally when they match zero rows, which is the case the 2xx requirement is
 * actually about.
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
    // A shop mismatch is not a transient failure: the signed body named a different tenant
    // than the header did, or carried no tenant at all — a replayed request, or a bug.
    // 401 rather than 500 so the two are distinguishable in logs and in the Partner
    // Dashboard. Shopify retries every non-2xx, so this does not stop redelivery; it just
    // keeps failing the same way, which is the correct outcome for a request we will never
    // accept.
    if (error instanceof ShopMismatchError) {
      console.error('[GDPR] rejected a compliance webhook with a forged shop header:', error.message);
      return NextResponse.json({ error: 'Shop mismatch' }, { status: 401 });
    }
    // Loud, and retryable. See the note above: a swallowed failure here is an erasure
    // that never happens.
    console.error('[GDPR] compliance webhook FAILED — Shopify will retry:', error);
    return NextResponse.json({ error: 'Compliance handler failed' }, { status: 500 });
  }
}
