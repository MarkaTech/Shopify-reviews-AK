import { db } from './db';

/**
 * Data retention — the policy, expressed as code rather than prose.
 *
 * Why this file exists
 * --------------------
 * Shopify's protected customer data requirements ask whether we have "retention periods
 * that make sure personal data isn't kept longer than needed". A policy document alone is
 * not an answer to that: a document describes an intention, and intentions do not delete
 * rows. This file is the answer, and docs/data-retention.md explains the reasoning behind
 * each number for anyone who has to justify it later.
 *
 * The two shapes of retention
 * ---------------------------
 * Not everything can be deleted, and pretending otherwise produces a policy nobody follows.
 *
 *   Redaction  — the row has continuing work to do, but the personal data in it does not.
 *                A ReviewRequest still prevents a second invitation for the same order long
 *                after the invitation itself is spent; the customer's email address does
 *                not need to survive for that.
 *
 *   Deletion   — the row itself has no remaining purpose.
 *
 * Deleting a ReviewRequest outright would be the naive reading of "minimise", and it would
 * be worse for the customer: with the dedup key gone, a re-delivered `orders/fulfilled`
 * webhook would email them a second time. Redaction keeps the promise without keeping the
 * address.
 *
 * What is deliberately NOT expired
 * --------------------------------
 *   EmailSuppression — a permanent record, on purpose. Someone who bounced or pressed
 *                      "this is spam" must never be contacted again, and an expiry would
 *                      mean quietly re-mailing them. Deleting a suppression is the one
 *                      deletion that harms the person it appears to protect. Legitimate
 *                      interest, and the minimum needed to honour the objection is the
 *                      address itself.
 *
 *   Review         — the merchant's content and the shopper's published words. Reviews are
 *                    kept while the merchant uses the App, and removed by `shop/redact`
 *                    when they leave or `customers/redact` on request. `reviewerEmail` is
 *                    retained alongside because it is what makes a verified-purchase claim
 *                    auditable, and an unauditable verification badge is an FTC problem.
 *
 * Idempotent and safe to run repeatedly. Every query is bounded by a date, so a run that
 * dies halfway simply picks up the remainder next time.
 */

/** Days after a review request expires before the customer's details are redacted. */
const REQUEST_PII_DAYS = 30;

/** Days after expiry before the request row itself goes. */
const REQUEST_ROW_DAYS = 730;

/** Days before the network identifiers on an analytics event are cleared. */
const EVENT_IDENTIFIER_DAYS = 30;

/** Days before an analytics event is deleted outright. */
const EVENT_ROW_DAYS = 180;

/**
 * Placeholder written over a redacted address.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so if some future code path
 * ever tries to mail a redacted request it fails loudly instead of reaching a stranger who
 * has since been assigned that address.
 */
const REDACTED_EMAIL = 'redacted@retention.invalid';

export interface RetentionResult {
  requestsRedacted: number;
  requestsDeleted: number;
  eventsRedacted: number;
  eventsDeleted: number;
  noncesDeleted: number;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

export async function runRetention(): Promise<RetentionResult> {
  const now = Date.now();

  // ── Review requests ──
  //
  // Measured from expiresAt rather than createdAt, because the row is doing real work right
  // up until the link stops working. The 30-day tail after that covers the support case of
  // a merchant asking why a particular customer did or did not receive an invitation.
  const requestsRedacted = await db.reviewRequest.updateMany({
    where: {
      expiresAt: { lt: daysAgo(REQUEST_PII_DAYS) },
      customerEmail: { not: REDACTED_EMAIL },
    },
    data: { customerEmail: REDACTED_EMAIL, customerName: null },
  });

  const requestsDeleted = await db.reviewRequest.deleteMany({
    where: { expiresAt: { lt: daysAgo(REQUEST_ROW_DAYS) } },
  });

  // ── Analytics events ──
  //
  // The event itself (a widget was viewed, a review was submitted) is not personal data.
  // The IP address and user agent attached to it are, and they stop being useful for abuse
  // investigation within about a month. Clearing them early leaves the counts intact, so
  // merchant analytics do not develop a hole where last quarter used to be.
  const eventsRedacted = await db.analyticsEvent.updateMany({
    where: {
      createdAt: { lt: daysAgo(EVENT_IDENTIFIER_DAYS) },
      OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }],
    },
    data: { ipAddress: null, userAgent: null },
  });

  const eventsDeleted = await db.analyticsEvent.deleteMany({
    where: { createdAt: { lt: daysAgo(EVENT_ROW_DAYS) } },
  });

  // ── OAuth nonces ──
  //
  // Not personal data, but an expired CSRF nonce is pure residue and the table would grow
  // without bound. Hygiene rather than compliance.
  const noncesDeleted = await db.oAuthNonce.deleteMany({
    where: { expiresAt: { lt: new Date(now) } },
  });

  return {
    requestsRedacted: requestsRedacted.count,
    requestsDeleted: requestsDeleted.count,
    eventsRedacted: eventsRedacted.count,
    eventsDeleted: eventsDeleted.count,
    noncesDeleted: noncesDeleted.count,
  };
}

/** The periods, exported so the retention documentation and any future settings screen
 *  read from the same source as the job that enforces them. */
export const RETENTION_PERIODS = {
  reviewRequestPersonalData: REQUEST_PII_DAYS,
  reviewRequestRow: REQUEST_ROW_DAYS,
  analyticsIdentifiers: EVENT_IDENTIFIER_DAYS,
  analyticsRow: EVENT_ROW_DAYS,
} as const;
