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

/**
 * Everything this app holds about one person, in one place.
 *
 * Extracted so the ACCESS path and the ERASURE path cannot drift, which is exactly what
 * had happened: `customers/redact` swept five tables with a case-insensitive match, while
 * `customers/data_request` queried `Review` alone with a case-sensitive equality — so a
 * shopper stored as `Jane@Example.com` was correctly erased but reported as having no data
 * at all. Under GDPR those are the same question asked twice, and they must return the same
 * rows.
 */
async function collectPersonalData(
  storeId: string,
  email: string | null,
  orderIds: string[]
) {
  const emailMatch = email ? { equals: email, mode: 'insensitive' as const } : undefined;

  // `id: ''` is the deliberate match-nothing case, so a payload carrying neither an email
  // nor order ids returns empty rather than everything.
  const nothing = { storeId, id: '' };

  const [reviews, questions, requests, grants] = await Promise.all([
    db.review.findMany({
      where: emailMatch ? { storeId, reviewerEmail: emailMatch } : nothing,
      select: {
        id: true, reviewerName: true, reviewerEmail: true, reviewerLocation: true,
        rating: true, title: true, body: true, reviewDate: true, source: true,
      },
    }),
    db.question.findMany({
      where: emailMatch ? { storeId, askerEmail: emailMatch } : nothing,
      select: { id: true, askerName: true, askerEmail: true, body: true, createdAt: true },
    }),
    db.reviewRequest.findMany({
      where: {
        storeId,
        OR: [
          ...(emailMatch ? [{ customerEmail: emailMatch }] : []),
          ...(orderIds.length ? [{ shopifyOrderId: { in: orderIds } }] : []),
        ],
      },
      select: {
        id: true, customerEmail: true, customerName: true, shopifyOrderId: true,
        createdAt: true, submittedAt: true,
      },
    }),
    db.incentiveGrant.findMany({
      where: emailMatch
        ? { incentive: { storeId }, customerEmail: emailMatch }
        : { incentive: { storeId }, id: '' },
      select: { id: true, customerEmail: true, discountCode: true, createdAt: true },
    }),
  ]);

  // Analytics events embed the address inside a JSON blob, so they are matched on the
  // quoted form for the same reason the erasure path does — a bare `contains` on a short
  // address matches other people's rows.
  // Order ids as well as the address — the same clause set the erasure path uses. Access and
  // erasure have to see identical rows, or the app reports holding nothing about someone
  // whose data it then goes on to delete.
  const eventClauses = [
    ...(email
      ? [
          { eventData: { contains: `"${email}"`, mode: 'insensitive' as const } },
          { eventData: { contains: `:"${email}"`, mode: 'insensitive' as const } },
        ]
      : []),
    ...orderIds.flatMap((id) => [
      { eventData: { contains: `"orderId":${id},` } },
      { eventData: { contains: `"orderId":${id}}` } },
    ]),
  ];

  const events = eventClauses.length
    ? await db.analyticsEvent.findMany({
        where: { storeId, OR: eventClauses },
        select: { id: true, eventType: true, eventData: true, createdAt: true },
      })
    : [];

  return { reviews, questions, requests, grants, events };
}

/**
 * A merchant asked what personal data we hold about one of their customers.
 *
 * Shopify's requirement is that the app provides the data TO THE STORE OWNER. This used to
 * write the result into an `AnalyticsEvent` row and stop. Nothing in the app ever read that
 * row back — every reference to the table is a create or a delete — and the retention job
 * deleted it after 180 days. So the request was recorded, never answered, and the merchant
 * was never told it had arrived. The 200 we returned told Shopify it was handled.
 *
 * Now the payload is emailed to the store owner and only a RECEIPT is stored: counts and a
 * timestamp, no personal data. Keeping a second copy of someone's data in order to prove we
 * disclosed their data is its own minimisation problem.
 */
async function handleDataRequest(data: Record<string, unknown>, shop: string) {
  const payload = data as {
    customer?: { id?: number; email?: string };
    orders_requested?: Array<number | string>;
  };
  // Trimmed and lower-cased for the same reason the erasure path does it: the address
  // arrives in whatever case the shopper typed at checkout.
  const email = payload.customer?.email?.trim().toLowerCase() || null;
  const orderIds = (payload.orders_requested ?? []).map(String).filter(Boolean);

  const store = await db.store.findUnique({ where: { shopifyDomain: shop } });
  if (!store) {
    console.log(`[GDPR] data_request for unknown store ${shop} — nothing held`);
    return;
  }

  const held = await collectPersonalData(store.id, email, orderIds);
  const counts = {
    reviews: held.reviews.length,
    questions: held.questions.length,
    invitations: held.requests.length,
    incentiveGrants: held.grants.length,
    analyticsEvents: held.events.length,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  // Receipt only. No customer email, no rows — this is the artefact that proves the request
  // was serviced, not a second store of the data it was about.
  await db.analyticsEvent.create({
    data: {
      storeId: store.id,
      eventType: 'gdpr_data_request',
      eventData: JSON.stringify({
        shopifyCustomerId: payload.customer?.id ?? null,
        counts,
        total,
        requestedAt: new Date().toISOString(),
      }),
    },
  });

  await deliverDataRequest(store.email, shop, email, counts, total, held);

  console.log(`[GDPR] data_request for ${shop}: ${total} record(s) across ${Object.keys(counts).length} tables`);
}

/**
 * Send the assembled data to the store owner.
 *
 * Failure here must reach the caller: the compliance route deliberately returns 500 so
 * Shopify retries, and a disclosure that silently did not happen is the same class of
 * problem as an erasure that silently did not happen. The one case that is NOT a failure is
 * having no address on file — nothing to retry would fix that, so it logs and returns.
 */
async function deliverDataRequest(
  storeEmail: string | null,
  shop: string,
  customerEmail: string | null,
  counts: Record<string, number>,
  total: number,
  held: unknown
): Promise<void> {
  if (!storeEmail) {
    console.warn(
      `[GDPR] data_request for ${shop}: no store owner address on file, cannot deliver. ` +
        'The data is available to the operator on request.'
    );
    return;
  }

  const { sendEmail } = await import('./email');
  const subject = `Customer data request — ${customerEmail ?? 'unidentified customer'}`;
  const summary = Object.entries(counts)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const body = JSON.stringify(held, null, 2);

  const result = await sendEmail({
    to: storeEmail,
    subject,
    text:
      `Shopify forwarded a data request for ${customerEmail ?? 'a customer'} on ${shop}.\n\n` +
      `Everything ReviewMaster holds about them is below (${total} record(s)).\n\n` +
      `${summary}\n\n----\n\n${body}\n`,
    html:
      `<p>Shopify forwarded a data request for <strong>${escapeHtml(customerEmail ?? 'a customer')}</strong> on ${escapeHtml(shop)}.</p>` +
      `<p>Everything ReviewMaster holds about them is below (${total} record(s)).</p>` +
      `<pre style="white-space:pre-wrap;font-family:ui-monospace,monospace;font-size:12px">${escapeHtml(body)}</pre>`,
  });

  if (!result.sent) {
    // Retryable failures are thrown so the route 500s and Shopify tries again. Permanent
    // ones are not: no email provider is configured, or the address is suppressed, and
    // neither is fixed by redelivery. Throwing on those would pin the compliance webhook
    // red in the Partner Dashboard forever on a condition retrying cannot clear — which is
    // the opposite of the signal a failing webhook is supposed to carry.
    if (result.retryable === false || result.reason === 'not_configured') {
      console.error(
        `[GDPR] data_request for ${shop} could NOT be delivered (${result.reason}) and will ` +
          'not be retried. This request is unfulfilled — deliver it by hand and configure an ' +
          'email provider (EMAIL_PROVIDER / SES / Resend).'
      );
      return;
    }
    throw new Error(`could not deliver data request to the store owner (${result.reason})`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  // Matched on the ORDER ID as well, not just the address.
  //
  // `orders/paid` no longer stores the buyer's email — that was a copy of protected customer
  // data kept for a feature that does not exist. But removing the address also removed the
  // only thing the erasure query could match on, so those rows became unreachable by this
  // handler: still tied to a real person through `orderId`, and now permanently
  // undeletable by any erasure request.
  //
  // `orders_to_redact` is the same list already used for ReviewRequest above, and the id is
  // written as a JSON number, so the needle is unquoted and bounded by the field separator
  // to stop `"orderId":12` matching `"orderId":1234`.
  const orderIdClauses = orderIds.flatMap((id) => [
    { eventData: { contains: `"orderId":${id},` } },
    { eventData: { contains: `"orderId":${id}}` } },
  ]);

  const emailClauses = email
    ? [
        { eventData: { contains: `"${email}"`, mode: 'insensitive' as const } },
        { eventData: { contains: `:"${email}"`, mode: 'insensitive' as const } },
      ]
    : [];

  const eventClauses = [...emailClauses, ...orderIdClauses];

  const events = eventClauses.length
    ? await db.analyticsEvent.deleteMany({ where: { storeId, OR: eventClauses } })
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
/** Raised when the header names a different shop than the signed body does. */
export class ShopMismatchError extends Error {
  status = 401;
  constructor(header: string, body: string) {
    super(`Shop mismatch: header says "${header}", signed payload says "${body}"`);
    this.name = 'ShopMismatchError';
  }
}

export async function handleComplianceTopic(
  topic: string,
  data: Record<string, unknown>,
  shop: string
): Promise<boolean> {
  const t = normaliseComplianceTopic(topic);
  if (!t) return false;

  // Take the tenant from the SIGNED body. Required, not merely cross-checked.
  //
  // The HMAC covers the request body and nothing else. Both the topic and the shop domain
  // arrive in unsigned headers, so a captured `(body, signature)` pair can be replayed with
  // either rewritten — and `shop/redact` hard-deletes nine tables and the Store row. That
  // turns any leaked signed request (a proxy log, an APM trace, a shared request dump) into
  // a cross-tenant destruction primitive that stays valid as long as the app secret does.
  //
  // The first version of this check only enforced when `shop_domain` was present, reasoning
  // that a payload-shape change on Shopify's side should degrade gracefully. That reasoning
  // left the hole wide open, because the attacker chooses the body: replaying a signed
  // `products/create` payload — which has no `shop_domain` at all — skipped the comparison
  // entirely and fell straight back to the attacker-controlled header. The graceful
  // degradation WAS the bypass.
  //
  // So: all three compliance payloads carry `shop_domain` (customers/data_request,
  // customers/redact and shop/redact each document it), and a compliance request without one
  // is not a compliance request. Refuse it, and never consult the header for the identity of
  // the tenant being erased.
  const bodyShop = typeof data.shop_domain === 'string' ? data.shop_domain.trim().toLowerCase() : '';
  const headerShop = shop.trim().toLowerCase();

  if (!bodyShop) {
    throw new ShopMismatchError(headerShop || '(none)', '(absent from signed body)');
  }
  if (headerShop && bodyShop !== headerShop) {
    throw new ShopMismatchError(headerShop, bodyShop);
  }

  // The signed value, always. `headerShop` is never passed to a handler.
  await HANDLERS[t](data, bodyShop);
  return true;
}
