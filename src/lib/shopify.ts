/**
 * Shopify API Utilities
 * Handles OAuth, HMAC verification, Admin API calls, and billing
 */

import crypto from 'crypto';

const SHOPIFY_API_KEY = process.env.NEXT_PUBLIC_SHOPIFY_API_KEY || 'test_key';
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_secret';
const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL || 'http://localhost:3000';

const SCOPES = [
  'read_products',
  'write_products',
  'read_orders',
  'read_customers',
  'read_script_tags',
  'write_script_tags',
  'read_themes',
  'write_themes',
].join(',');

// ── HMAC Verification ──

/**
 * Constant-time comparison that tolerates length mismatch.
 *
 * crypto.timingSafeEqual throws a RangeError when the two buffers differ in length, so
 * calling it directly on attacker-controlled input turns a failed signature check into a
 * 500 (or, worse, an unhandled rejection) instead of a clean rejection. Compare lengths
 * first, then compare bytes in constant time.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify the HMAC on an OAuth / App Bridge query string.
 *
 * Pass the FULL query string including the hmac parameter — this function strips it
 * before computing the digest. Callers must not pre-strip it.
 */
export function verifyShopifyHmac(queryString: string, secret: string = SHOPIFY_API_SECRET): boolean {
  const params = new URLSearchParams(queryString);
  const hmac = params.get('hmac');

  // No signature at all is a failure, not something to compare against the empty string.
  if (!hmac) return false;

  // Shopify excludes both hmac and the legacy signature param from the signed message.
  params.delete('hmac');
  params.delete('signature');

  const sortedParams: string[] = [];
  params.forEach((value, key) => {
    sortedParams.push(`${key}=${value}`);
  });
  const message = sortedParams.sort().join('&');

  const expectedHmac = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  return safeCompare(hmac, expectedHmac);
}

export function verifyWebhookHmac(body: string, hmacHeader: string, secret: string = SHOPIFY_API_SECRET): boolean {
  if (!hmacHeader) return false;

  const expectedHmac = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');

  return safeCompare(hmacHeader, expectedHmac);
}

// ── OAuth URL Generation ──
export function createShopifyAuthUrl(shop: string, state: string, scopes: string = SCOPES): string {
  const redirectUri = `${SHOPIFY_APP_URL}/api/auth/callback`;
  return `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${encodeURIComponent(scopes)}&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

// ── Token Exchange ──
export async function exchangeAccessToken(shop: string, code: string): Promise<string> {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to exchange access token: ${response.statusText}`);
  }

  const data = await response.json();
  return data.access_token;
}

// ── Shopify Admin REST API Caller ──
export async function callShopifyAdmin(
  shop: string,
  accessToken: string,
  method: string = 'GET',
  endpoint: string,
  body?: unknown
): Promise<unknown> {
  const url = `https://${shop}/admin/api/2024-01${endpoint}`;
  const options: RequestInit = {
    method,
    headers: {
      'X-Shopify-Access-Token': accessToken,
      'Content-Type': 'application/json',
    },
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Shopify API error ${response.status}: ${errorData}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

// ── Fetch Shop Info ──
export async function fetchShopifyShop(shop: string, accessToken: string): Promise<{
  id: number;
  name: string;
  domain: string;
  email: string;
  myshopify_domain: string;
  plan_display_name: string;
}> {
  const data = await callShopifyAdmin(shop, accessToken, 'GET', '/shop.json') as Record<string, unknown>;
  const shopData = data.shop as {
    id: number;
    name: string;
    domain: string;
    email: string;
    myshopify_domain: string;
    plan_display_name: string;
  };
  return shopData;
}

// ── Fetch Products from Shopify ──
export async function fetchShopifyProducts(
  shop: string,
  accessToken: string,
  limit: number = 250
): Promise<Array<{
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  image: { src: string } | null;
  variants: Array<{ price: string }>;
  vendor: string;
  product_type: string;
  tags: string;
}>> {
  const data = await callShopifyAdmin(
    shop,
    accessToken,
    'GET',
    `/products.json?limit=${limit}`
  ) as { products: Array<Record<string, unknown>> };

  return data.products.map((p) => ({
    id: p.id as number,
    title: p.title as string,
    handle: p.handle as string,
    body_html: (p.body_html as string) || null,
    image: p.image ? { src: (p.image as { src: string }).src } : null,
    variants: (p.variants as Array<{ price: string }>) || [],
    vendor: (p.vendor as string) || '',
    product_type: (p.product_type as string) || '',
    tags: (p.tags as string) || '',
  }));
}

// ── Recurring Charge (Billing) ──
const PLAN_PRICES: Record<string, number> = {
  free: 0,
  starter: 9.99,
  pro: 29.99,
  enterprise: 99.99,
};

export async function createRecurringCharge(
  shop: string,
  accessToken: string,
  plan: string,
  returnUrl: string
): Promise<string> {
  const price = PLAN_PRICES[plan] || 0;

  if (price === 0) {
    return returnUrl; // Free plan — no charge needed
  }

  // Development stores cannot be charged for real. Shopify rejects a live charge against
  // one, and the error it returns ("owned by a Shop... must be migrated to the Shopify
  // partners area") describes the wrong problem entirely, which makes it hard to diagnose.
  // Test charges behave identically through the whole approval flow but move no money.
  //
  // Set SHOPIFY_BILLING_TEST=false in production once real merchants install.
  const isTestCharge = (process.env.SHOPIFY_BILLING_TEST ?? 'true').toLowerCase() !== 'false';

  const chargeData = {
    recurring_application_charge: {
      name: `ReviewMaster ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`,
      price: price.toFixed(2),
      return_url: returnUrl,
      trial_days: 7,
      capped_amount: 500,
      test: isTestCharge,
      terms: 'Charges will be applied monthly. Cancel anytime from your Shopify admin.',
    },
  };

  const data = await callShopifyAdmin(
    shop,
    accessToken,
    'POST',
    '/recurring_application_charges.json',
    chargeData
  ) as { recurring_application_charge: { confirmation_url: string; id: number } };

  return data.recurring_application_charge.confirmation_url;
}

export async function activateCharge(
  shop: string,
  accessToken: string,
  chargeId: string
): Promise<void> {
  await callShopifyAdmin(
    shop,
    accessToken,
    'POST',
    `/recurring_application_charges/${chargeId}/activate.json`
  );
}

// ── Webhook Registration ──

/**
 * Map a Shopify topic to our route segment.
 *
 * This used to be `topic.replace('/', '-')`. String.replace with a string pattern only
 * swaps the FIRST occurrence, so 'app/charges/accepted' became 'app-charges/accepted' —
 * two path segments against the single [topic] slot, which 404s. Every paid upgrade
 * webhook was silently lost. replaceAll fixes all separators.
 */
export function topicToSegment(topic: string): string {
  return topic.replaceAll('/', '-');
}

export async function registerWebhooks(
  shop: string,
  accessToken: string,
  appUrl: string = SHOPIFY_APP_URL
): Promise<void> {
  // Note: the three mandatory GDPR compliance topics (customers/data_request,
  // customers/redact, shop/redact) are NOT registered here. Shopify does not accept them
  // via the webhook API — they are configured in the Partner Dashboard under
  // App setup > Compliance webhooks. The handlers live in /api/webhooks/[topic].
  const webhookTopics = [
    { topic: 'app/uninstalled', format: 'json' },
    { topic: 'products/create', format: 'json' },
    { topic: 'products/update', format: 'json' },
    { topic: 'products/delete', format: 'json' },
    { topic: 'orders/paid', format: 'json' },
    // Drives first-party review collection: a fulfilled order becomes a review request.
    { topic: 'orders/fulfilled', format: 'json' },
    { topic: 'shop/update', format: 'json' },
    { topic: 'app/charges/accepted', format: 'json' },
  ];

  for (const wh of webhookTopics) {
    const webhookData = {
      webhook: {
        topic: wh.topic,
        address: `${appUrl}/api/webhooks/${topicToSegment(wh.topic)}`,
        format: wh.format,
      },
    };

    try {
      await callShopifyAdmin(
        shop,
        accessToken,
        'POST',
        '/webhooks.json',
        webhookData
      );
    } catch (error) {
      console.error(`Failed to register webhook ${wh.topic}:`, error);
    }
  }
}

export { SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL, SCOPES };
