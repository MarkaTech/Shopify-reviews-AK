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
  const payload = data as {
    customer?: { id?: number | string; email?: string };
    orders_to_redact?: Array<number | string>;
  };

  // Lower-cased before it is matched against anything.
  //
  // This used the address exactly as Shopify sent it, in five exact-match queries. The
  // two ways an address enters this database disagree about case: a storefront submission
  // stores what the shopper typed (`src/app/api/storefront/submit/route.ts` only trims),
  // while a review invitation stores it lower-cased (`review-requests.ts`). So a shopper
  // who reviewed as `Jane@Example.com` matched zero rows, the handler logged
  // "0 review(s), 0 question(s)…", returned 200, and their name, address and location
  // stayed in the database. An erasure that erases nothing, reported as success.
  const email = payload.customer?.email?.trim().toLowerCase() || null;

  // Shopify also names the orders belonging to this person. That is the only handle we
  // have when the email is absent — which happens for a phone-only customer, and for any
  // app whose protected-customer-data approval does not include the email field.
  const orderIds = (payload.orders_to_redact ?? []).map(String).filter(Boolean);

  const store = await db.store.findUnique({ where: { shopifyDomain: shop } });
  if (!store) return;

  if (!email && !orderIds.length) {
    console.warn(`[GDPR] customers/redact for ${shop}: payload carried neither an email nor orders_to_redact — nothing to match on`);
    return;
  }

  const storeId = store.id;

  // Anonymise rather than delete: the rating and text are the merchant's business record,
  // but everything identifying the person must go.
  //
  // Reviews are not the only place this person appears. Handling only the Review table —
  // which is what this used to do — leaves the same email address sitting in Q&A, in
  // pending review invitations, in incentive grants and in the buyer email recorded by the
  // orders/paid analytics handler. An erasure request that erases one of five copies is
  // not an erasure request, and it is one of the things an app reviewer tests directly.
  // `mode: 'insensitive'` on an equality match, so a stored `Jane@Example.com` is found
  // by a lower-cased needle regardless of which path wrote it.
  const emailMatch = email ? { equals: email, mode: 'insensitive' as const } : undefined;

  const [reviews, questions, requests, grants] = await Promise.all([
    db.review.updateMany({
      where: emailMatch ? { storeId, reviewerEmail: emailMatch } : { storeId, id: '' },
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
      where: emailMatch ? { storeId, askerEmail: emailMatch } : { storeId, id: '' },
      data: { askerName: 'Anonymous', askerEmail: null },
    }),

    // Deleted outright rather than anonymised. A review invitation is a pending instruction
    // to email this person; with the address gone it has no purpose, and keeping the order
    // snapshot would preserve exactly what was asked to be erased.
    // Matched on the order id as well as the address. ReviewRequest is the one table
    // that records shopifyOrderId, so `orders_to_redact` reaches it directly — which is
    // what makes erasure work at all when the payload carries no email.
    db.reviewRequest.deleteMany({
      where: {
        storeId,
        OR: [
          ...(emailMatch ? [{ customerEmail: emailMatch }] : []),
          ...(orderIds.length ? [{ shopifyOrderId: { in: orderIds } }] : []),
        ],
      },
    }),

    // The discount code itself lives in Shopify and keeps working until it expires — that
    // is the merchant's commercial arrangement. Only our copy of who it went to is cleared.
    db.incentiveGrant.updateMany({
      where: emailMatch
        ? { incentive: { storeId }, customerEmail: emailMatch }
        : { incentive: { storeId }, id: '' },
      data: { customerEmail: '' },
    }),
  ]);

  // Analytics events embed the buyer's email inside a JSON blob, so there is no column to
  // null and the row has to go.
  //
  // The match cannot be a bare substring. `contains: 'n@x.com'` also matches
  // `john@x.com`, `ben@x.com` and `karen@x.com` — so redacting one shopper silently
  // deleted other customers' order analytics, and the count in the log reported the
  // over-deletion as success. Short addresses are common and this needs no adversary.
  //
  // Matching on the address wrapped in the JSON quoting that surrounds it means a hit is
  // a whole field value rather than a fragment of a longer one. Two forms because the
  // address can appear as a value or inside a nested object, and the case-insensitive
  // flag for the same reason as above.
  const events = email
    ? await db.analyticsEvent.deleteMany({
        where: {
          storeId,
          OR: [
            { eventData: { contains: `"${email}"`, mode: 'insensitive' } },
            { eventData: { contains: `:"${email}"`, mode: 'insensitive' } },
          ],
        },
      })
    : { count: 0 };

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
  // Batched, because the unbatched version could not complete for a large store.
  //
  // It collected every review id and passed them to a single `deleteMany({ id: { in } })`.
  // Prisma binds one parameter per id and Postgres' wire protocol caps a statement at
  // 65,535 — so past roughly that many reviews the statement threw. Combined with the
  // handler returning 200 on error (fixed separately), the result was: Shopify records a
  // success, never retries, and the store's data is never deleted. The stores it failed
  // for were the largest ones, which are also the ones holding the most personal data.
  //
  // Everything below is idempotent — deleting rows that are already gone is a no-op — so
  // a timeout partway through is safe. Shopify retries a non-2xx, and each retry resumes
  // from wherever the last one reached rather than starting over. That is what makes an
  // unbounded amount of work survivable inside a webhook with a short timeout, without a
  // job queue.
  const ID_BATCH = 5_000;
  for (;;) {
    const batch = await db.review.findMany({
      where: { storeId },
      select: { id: true },
      take: ID_BATCH,
    });
    if (!batch.length) break;

    const ids = batch.map((r) => r.id);
    // ReviewTranslation has no foreign key to Review, so it cannot cascade and cannot be
    // filtered through the relation — the ids have to be gathered while the reviews still
    // exist. Its translation goes first, then the reviews it pointed at.
    await db.reviewTranslation.deleteMany({ where: { reviewId: { in: ids } } });
    await db.review.deleteMany({ where: { id: { in: ids } } });

    if (batch.length < ID_BATCH) break;
  }

  await db.reviewRequest.deleteMany({ where: { storeId } });

  // Children first: Review and Product hold foreign keys to Store. Deleting the store row
  // cascades Question/Answer, Incentive/IncentiveGrant and ProductRating.
  //
  // A final sweep for reviews created between the batch loop finishing and here — a
  // storefront submission landing mid-redaction would otherwise leave a row whose
  // Restrict-by-default relation blocks `store.delete` below and fails the whole handler.
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
