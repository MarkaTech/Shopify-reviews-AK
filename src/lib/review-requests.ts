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
 * Build a review request from a fulfilled order.
 * Returns null when the order has no usable email or no products we track.
 */
export async function createRequestForOrder(
  storeId: string,
  order: OrderPayload,
  delayDays = 0
): Promise<{ token: string; email: string; lineItems: RequestLineItem[] } | null> {
  const email = emailFrom(order);
  if (!email) return null;

  const shopifyOrderId = String(order.id);

  // One request per order. A re-fulfilment or webhook retry must not email twice.
  const existing = await db.reviewRequest.findUnique({
    where: { storeId_shopifyOrderId: { storeId, shopifyOrderId } },
  });
  if (existing) return null;

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

  if (lineItems.length === 0) return null;

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
