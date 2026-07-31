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

  const storeId = store.id;

  // Anonymise rather than delete: the rating and text are the merchant's business record,
  // but everything identifying the person must go.
  //
  // Reviews are not the only place this person appears. Handling only the Review table —
  // which is what this used to do — leaves the same email address sitting in Q&A, in
  // pending review invitations, in incentive grants and in the buyer email recorded by the
  // orders/paid analytics handler. An erasure request that erases one of five copies is
  // not an erasure request, and it is one of the things an app reviewer tests directly.
  const [reviews, questions, requests, grants] = await Promise.all([
    db.review.updateMany({
      where: { storeId, reviewerEmail: email },
      data: {
        reviewerName: 'Anonymous',
        reviewerEmail: null,
        reviewerAvatar: null,
        reviewerLocation: null,
        seoTitle: null,
        seoDescription: null,
        customFields: null,
      },
    }),

    db.question.updateMany({
      where: { storeId, askerEmail: email },
      data: { askerName: 'Anonymous', askerEmail: null },
    }),

    // Deleted outright rather than anonymised. A review invitation is a pending instruction
    // to email this person; with the address gone it has no purpose, and keeping the order
    // snapshot would preserve exactly what was asked to be erased.
    db.reviewRequest.deleteMany({ where: { storeId, customerEmail: email } }),

    // The discount code itself lives in Shopify and keeps working until it expires — that
    // is the merchant's commercial arrangement. Only our copy of who it went to is cleared.
    db.incentiveGrant.updateMany({
      where: { incentive: { storeId }, customerEmail: email },
      data: { customerEmail: '' },
    }),
  ]);

  // Analytics events embed the buyer's email inside a JSON blob, so there is no column to
  // null. Matching rows are dropped: they are aggregate usage signals and losing a handful
  // costs nothing next to keeping an address that was asked to be forgotten.
  const events = await db.analyticsEvent.deleteMany({
    where: { storeId, eventData: { contains: email } },
  });

  console.log(
    `[GDPR] customers/redact for ${shop}: ${reviews.count} review(s), ${questions.count} question(s), ` +
      `${requests.count} invitation(s), ${grants.count} incentive grant(s), ${events.count} analytics event(s)`
  );
}

/** Sent 48 hours after uninstall. Erase everything belonging to the shop. */
async function handleShopRedact(_data: Record<string, unknown>, shop: string) {
  const store = await db.store.findUnique({ where: { shopifyDomain: shop } });
  if (!store) {
    console.log(`[GDPR] shop/redact for ${shop} — already erased`);
    return;
  }

  const storeId = store.id;

  // ReviewRequest and ReviewTranslation first, and via their own relations.
  //
  // Neither has a foreign key to Store, so neither cascaded and neither was in this list —
  // meaning a shop redaction left ReviewRequest rows behind holding customer email, name,
  // order number and a line-item snapshot, indefinitely. They have to be resolved through
  // Review before the reviews themselves are deleted, or the link to find them is gone.
  // ReviewTranslation keys on reviewId with no relation declared, so it cannot be filtered
  // through Review — the ids have to be collected first, while the reviews still exist.
  const reviewIds = await db.review.findMany({ where: { storeId }, select: { id: true } });
  if (reviewIds.length) {
    await db.reviewTranslation.deleteMany({
      where: { reviewId: { in: reviewIds.map((r) => r.id) } },
    });
  }
  await db.reviewRequest.deleteMany({ where: { storeId } });

  // Children first: Review and Product hold foreign keys to Store. Deleting the store row
  // cascades Question/Answer, Incentive/IncentiveGrant and ProductRating.
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
