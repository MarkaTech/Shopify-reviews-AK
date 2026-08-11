/**
 * First-party review collection — the model Judge.me and Loox actually run on.
 *
 * A merchant fulfils an order. We create one ReviewRequest for that order and email the
 * real buyer a single-use link. They submit a review through it, and because the request
 * came from a genuine Shopify order, the review is a provable verified purchase.
 *
 * This is the honest alternative to importing reviews from other marketplaces: the
 * reviews belong to the merchant's own customers, so displaying them on their storefront
 * is exactly what review-disclosure rules intend.
 */

import crypto from 'crypto';
import { db } from './db';

/** How long a review link stays valid. Long enough to survive a slow delivery. */
const REQUEST_TTL_DAYS = 60;

export interface RequestLineItem {
  productId: string | null;
  shopifyId: string | null;
  title: string;
  image: string | null;
}

export interface OrderPayload {
  id: number | string;
  order_number?: number | string;
  email?: string | null;
  contact_email?: string | null;
  customer?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
  line_items?: Array<{ product_id?: number | string | null; title?: string; name?: string }> | null;
}

/** Cryptographically random, URL-safe, single-use. */
export function generateRequestToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function customerNameFrom(order: OrderPayload): string | null {
  const first = order.customer?.first_name?.trim() || '';
  const last = order.customer?.last_name?.trim() || '';
  const full = `${first} ${last}`.trim();
  return full || null;
}

function emailFrom(order: OrderPayload): string | null {
  const candidate = order.customer?.email || order.email || order.contact_email || '';
  const trimmed = String(candidate).trim().toLowerCase();
  // Deliberately permissive — Shopify has already validated it; we only reject obvious junk.
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed) ? trimmed : null;
}

/**
 * Re-read an order from the Admin API when the webhook payload has no usable email.
 *
 * Webhook payloads are not a data-export channel, and Shopify says so: customer fields
 * on an order webhook are redacted unless the app holds Level 2 protected-customer-data
 * approval, and holding the `read_customers` scope does not by itself change that. An app
 * on Level 1 (Proof of Concept) receives `orders/fulfilled` with `customer` and `email`
 * stripped — the notification arrives, the personal data does not.
 *
 * Reading the buyer's address straight out of the payload therefore has a failure mode
 * where nothing errors and nothing sends: `emailFrom` returns null, one line goes to the
 * log, and the merchant's review programme quietly does nothing for every order. That is
 * the entire product, silently off, with a green webhook in the dashboard.
 *
 * So the webhook is treated as a notification and the order is fetched when the payload
 * comes back thin — which is the pattern Shopify recommends. On Level 2 this never runs;
 * on Level 1 it is what makes the feature work at all.
 */
async function fetchOrderFromAdmin(
  storeId: string,
  shop: string,
  orderId: string | number
): Promise<OrderPayload | null> {
  try {
    const { callShopifyGraphQL } = await import('./shopify');
    const { getFreshAccessTokenByStoreId, tokenRefresherFor } = await import('./shopify-token');

    const accessToken = await getFreshAccessTokenByStoreId(storeId);
    const gid = String(orderId).startsWith('gid://')
      ? String(orderId)
      : `gid://shopify/Order/${orderId}`;

    const data = await callShopifyGraphQL<{
      order: {
        id: string;
        name?: string | null;
        email?: string | null;
        customer?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
        lineItems?: { nodes: Array<{ title?: string | null; product?: { legacyResourceId?: string | null } | null }> } | null;
      } | null;
    }>(
      shop,
      accessToken,
      `query OrderForReviewRequest($id: ID!) {
        order(id: $id) {
          id
          name
          email
          customer { firstName lastName email }
          lineItems(first: 50) { nodes { title product { legacyResourceId } } }
        }
      }`,
      { id: gid },
      tokenRefresherFor(storeId)
    );

    const o = data.order;
    if (!o) return null;

    return {
      id: orderId,
      order_number: o.name ?? undefined,
      email: o.email ?? null,
      customer: o.customer
        ? { first_name: o.customer.firstName, last_name: o.customer.lastName, email: o.customer.email }
        : null,
      line_items: (o.lineItems?.nodes || []).map((li) => ({
        product_id: li.product?.legacyResourceId ?? null,
        title: li.title ?? undefined,
      })),
    };
  } catch (error) {
    // Never throws to the caller. A failed re-read must not turn a webhook Shopify
    // considers delivered into a 500 and a retry storm; the outcome is the same as before
    // this existed — no request created — but now it is logged as a real failure.
    console.error(`[review-request] could not re-read order ${orderId} from the Admin API:`, error);
    return null;
  }
}

/**
 * Build a review request from a fulfilled order.
 * Returns null when the order has no usable email or no products we track.
 */
export async function createRequestForOrder(
  storeId: string,
  orderPayload: OrderPayload,
  delayDays = 0,
  shop?: string
): Promise<{ token: string; email: string; lineItems: RequestLineItem[] } | null> {
  let order = orderPayload;
  let email = emailFrom(order);

  // Thin payload — see fetchOrderFromAdmin. Only reached when the webhook carried no
  // usable address, so the ordinary path costs nothing.
  if (!email && shop) {
    const refetched = await fetchOrderFromAdmin(storeId, shop, order.id);
    if (refetched) {
      order = { ...refetched, id: order.id };
      email = emailFrom(order);
      if (email) {
        console.log(`[review-request] order ${order.id}: payload was redacted, recovered the address from the Admin API`);
      }
    }
  }

  if (!email) {
    // Say so. A silently skipped order cost a real debugging session: the merchant
    // fulfils a test order with no customer attached, nothing happens, and nothing
    // anywhere explains why.
    console.log(`[review-request] order ${order.id}: no customer email on the order or via the Admin API — nothing to send`);
    return null;
  }

  const shopifyOrderId = String(order.id);

  // One request per order. A re-fulfilment or webhook retry must not email twice.
  const existing = await db.reviewRequest.findUnique({
    where: { storeId_shopifyOrderId: { storeId, shopifyOrderId } },
  });
  if (existing) {
    console.log(`[review-request] order ${order.id}: already has a request — not creating twice`);
    return null;
  }

  const shopifyProductIds = (order.line_items || [])
    .map(li => (li.product_id == null ? null : String(li.product_id)))
    .filter((v): v is string => !!v);

  const known = shopifyProductIds.length
    ? await db.product.findMany({
        where: { storeId, shopifyId: { in: shopifyProductIds } },
        select: { id: true, shopifyId: true, title: true, image: true },
      })
    : [];

  const byShopifyId = new Map(known.map(p => [p.shopifyId, p]));

  const lineItems: RequestLineItem[] = (order.line_items || []).map(li => {
    const sid = li.product_id == null ? null : String(li.product_id);
    const match = sid ? byShopifyId.get(sid) : undefined;
    return {
      productId: match?.id ?? null,
      shopifyId: sid,
      title: match?.title || li.title || li.name || 'Item',
      image: match?.image ?? null,
    };
  });

  if (lineItems.length === 0) {
    console.log(`[review-request] order ${order.id}: no line items — nothing to review`);
    return null;
  }

  const token = generateRequestToken();
  await db.reviewRequest.create({
    data: {
      storeId,
      token,
      shopifyOrderId,
      orderNumber: order.order_number == null ? null : String(order.order_number),
      customerEmail: email,
      customerName: customerNameFrom(order),
      lineItems: JSON.stringify(lineItems),
      // The link's lifetime starts when the FIRST email goes out, not when the order is
      // fulfilled — otherwise a long send delay quietly eats the customer's window.
      expiresAt: new Date(Date.now() + (delayDays + REQUEST_TTL_DAYS) * 86_400_000),
      nextSendAt: new Date(Date.now() + delayDays * 86_400_000),
    },
  });

  return { token, email, lineItems };
}

export type RequestState =
  | { ok: true; request: NonNullable<Awaited<ReturnType<typeof findByToken>>>; lineItems: RequestLineItem[] }
  | { ok: false; reason: 'not_found' | 'expired' | 'already_submitted' };

async function findByToken(token: string) {
  if (!token || token.length < 20) return null;
  return db.reviewRequest.findUnique({ where: { token } });
}

/** Resolve a token to a usable request, or say precisely why it is not usable. */
export async function resolveToken(token: string): Promise<RequestState> {
  const request = await findByToken(token);
  if (!request) return { ok: false, reason: 'not_found' };
  if (request.submittedAt) return { ok: false, reason: 'already_submitted' };
  if (request.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };

  let lineItems: RequestLineItem[] = [];
  try {
    lineItems = JSON.parse(request.lineItems) as RequestLineItem[];
  } catch {
    lineItems = [];
  }
  return { ok: true, request, lineItems };
}

/** The link the buyer receives. */
export function reviewRequestUrl(token: string, appUrl: string): string {
  return `${appUrl.replace(/\/$/, '')}/r/${token}`;
}
