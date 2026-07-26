/**
 * Mandatory GDPR / privacy compliance webhook handlers.
 *
 * Shopify requires every public app to handle three topics. They are configured in
 * shopify.app.toml, which supplies a SINGLE uri for all three — the topic arrives in the
 * X-Shopify-Topic header rather than the URL path. These handlers therefore live here
 * rather than in a route file, so both the header-dispatching endpoint and the legacy
 * path-based endpoint can share them.
 *
 * All three must return 2xx even when the store is unknown: shop/redact arrives 48 hours
 * after uninstall, by which point the store row may already be gone.
 */

import { db } from './db';

export type ComplianceTopic = 'customers/data_request' | 'customers/redact' | 'shop/redact';

/** Accepts both "customers/data_request" and "customers-data_request". */
export function normaliseComplianceTopic(raw: string): ComplianceTopic | null {
  const t = raw.trim().toLowerCase().replace(/-/g, '/');
  // "customers/data/request" can result from the dashed form; repair it.
  const fixed = t.replace('customers/data/request', 'customers/data_request');
  if (fixed === 'customers/data_request' || fixed === 'customers/redact' || fixed === 'shop/redact') {
    return fixed as ComplianceTopic;
  }
  return null;
}

/** A merchant asked what personal data we hold about one of their customers. */
async function handleDataRequest(data: Record<string, unknown>, shop: string) {
  const payload = data as { customer?: { id?: number; email?: string } };
  const email = payload.customer?.email || null;

  const store = await db.store.findUnique({ where: { shopifyDomain: shop } });
  if (!store) {
    console.log(`[GDPR] data_request for unknown store ${shop} — nothing held`);
    return;
  }

  const reviews = email
    ? await db.review.findMany({
        where: { storeId: store.id, reviewerEmail: email },
        select: {
          id: true, reviewerName: true, reviewerEmail: true, reviewerLocation: true,
          rating: true, title: true, body: true, reviewDate: true,
        },
      })
    : [];

  await db.analyticsEvent.create({
    data: {
      storeId: store.id,
      eventType: 'gdpr_data_request',
      eventData: JSON.stringify({
        shop,
        customerId: payload.customer?.id ?? null,
        customerEmail: email,
        reviewCount: reviews.length,
        reviews,
        requestedAt: new Date().toISOString(),
      }),
    },
  });

  console.log(`[GDPR] data_request for ${shop}: ${reviews.length} review(s) held`);
}

/** A customer asked to be erased. */
async function handleCustomerRedact(data: Record<string, unknown>, shop: string) {
  const payload = data as { customer?: { email?: string } };
  const email = payload.customer?.email;

  const store = await db.store.findUnique({ where: { shopifyDomain: shop } });
  if (!store || !email) return;

  // Anonymise rather than delete: the rating and text are the merchant's business record,
  // but everything identifying the person must go.
  const { count } = await db.review.updateMany({
    where: { storeId: store.id, reviewerEmail: email },
    data: {
      reviewerName: 'Anonymous',
      reviewerEmail: null,
      reviewerAvatar: null,
      reviewerLocation: null,
      seoTitle: null,
      seoDescription: null,
      customFields: null,
    },
  });

  console.log(`[GDPR] customers/redact for ${shop}: anonymised ${count} review(s)`);
}

/** Sent 48 hours after uninstall. Erase everything belonging to the shop. */
async function handleShopRedact(_data: Record<string, unknown>, shop: string) {
  const store = await db.store.findUnique({ where: { shopifyDomain: shop } });
  if (!store) {
    console.log(`[GDPR] shop/redact for ${shop} — already erased`);
    return;
  }

  const storeId = store.id;
  // Children first: Review and Product hold foreign keys to Store.
  await db.review.deleteMany({ where: { storeId } });
  await db.product.deleteMany({ where: { storeId } });
  await db.importJob.deleteMany({ where: { storeId } });
  await db.widgetConfig.deleteMany({ where: { storeId } });
  await db.storeSetting.deleteMany({ where: { storeId } });
  await db.analyticsEvent.deleteMany({ where: { storeId } });
  await db.store.delete({ where: { id: storeId } });

  console.log(`[GDPR] shop/redact complete for ${shop}`);
}

const HANDLERS: Record<ComplianceTopic, (d: Record<string, unknown>, shop: string) => Promise<void>> = {
  'customers/data_request': handleDataRequest,
  'customers/redact': handleCustomerRedact,
  'shop/redact': handleShopRedact,
};

/** Returns true if the topic was recognised and handled. */
export async function handleComplianceTopic(
  topic: string,
  data: Record<string, unknown>,
  shop: string
): Promise<boolean> {
  const t = normaliseComplianceTopic(topic);
  if (!t) return false;
  await HANDLERS[t](data, shop);
  return true;
}
