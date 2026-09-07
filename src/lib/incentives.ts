/**
 * Review incentives — a discount code in exchange for a review.
 *
 * Near-universal in this market, and it materially lifts collection rate, which is the
 * whole funnel. It is also the single easiest feature in this category to build illegally.
 *
 * The two rules that shape this file
 * ----------------------------------
 *
 * **1. An incentive may never depend on what the review says.**
 * FTC 16 CFR 465.4 prohibits offering compensation conditioned, expressly or by
 * implication, on the sentiment of a review. "Leave a 5-star review, get 10% off" is a
 * straightforward violation, at up to ~$53,000 per instance. The EU Omnibus Directive and
 * the UK DMCC Act say the same.
 *
 * So the Incentive model has **no minimum-rating field**, and this module has no code path
 * that reads a rating before granting. There is nowhere to express the illegal idea. That
 * is deliberate: a `minRating` column with a comment saying "don't set this above 1" would
 * eventually get set.
 *
 * Rewarding a *photo* is lawful, because media is a content type rather than a sentiment —
 * a one-star review with a photo earns exactly what a five-star one with a photo earns.
 *
 * **2. Incentivised reviews must be disclosed.**
 * Not in a tooltip, not in a footer. The badge renders beside the review, the disclosure
 * text ships with a sane default, and `isIncentivized` travels all the way to the
 * storefront JSON and the Google feed so no surface can quietly forget it.
 *
 * One consequence worth knowing: incentivised reviews are excluded from Shop app
 * syndication entirely. Shop's merchant guidelines ban compensation-for-reviews outright,
 * with no disclosure carve-out — stricter than the FTC. See syndication.ts.
 */

import crypto from 'crypto';
import { db } from './db';
import { callShopifyGraphQL } from './shopify';

const DISCOUNT_CREATE = `
  mutation CreateReviewDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field code message }
    }
  }
`;

/**
 * Free shipping is a different mutation, not a different value.
 *
 * `free_shipping` is offered in the merchant's reward-type picker and the create route
 * forces its `rewardValue` to 0. The grant then branched only on 'percentage', so free
 * shipping fell through to the fixed-amount arm and minted a discount of
 * `{ amount: 0 }` — a code that takes nothing off, paired with a reward email reading
 * "0.00 off your next order". The shopper was promised free shipping and given a working
 * code worth nothing, which is worse than the feature not existing.
 *
 * `discountCodeFreeShippingCreate` takes no `customerGets`; the benefit is the shipping
 * line itself, scoped by destination.
 */
const FREE_SHIPPING_CREATE = `
  mutation CreateReviewFreeShipping($freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
    discountCodeFreeShippingCreate(freeShippingCodeDiscount: $freeShippingCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field code message }
    }
  }
`;

/**
 * Human-friendly, unguessable code.
 *
 * Excludes I, O, 0 and 1 — a merchant reads these out over the phone and a customer types
 * them from an email, and those four are where transcription errors come from.
 */
function generateCode(prefix = 'THANKS'): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
  return `${prefix}-${code}`;
}

/**
 * Codes one store may mint in any rolling 24 hours, across every incentive it has.
 *
 * A backstop against automated farming of a feature that hands out real money, not a
 * product limit. See the check in grantIncentive for why a per-incentive `usageLimit`
 * cannot serve this purpose.
 */
const MAX_GRANTS_PER_DAY = 50;

export interface GrantResult {
  code: string;
  expiresAt: Date;
  disclosureText: string;
  /** What the code is worth, so the thank-you email can say "12% off" or "$5 off". */
  rewardType: string;
  rewardValue: number;
  /** False when this call minted the code; true when an earlier grant is being re-read. */
  alreadyGranted: boolean;
}

/**
 * Grant a discount for a published review.
 *
 * Note what is NOT a parameter: the review's rating. The caller cannot pass it, so no
 * caller can accidentally make the grant conditional on it.
 */
export async function grantIncentive(
  storeId: string,
  shop: string,
  accessToken: string,
  opts: {
    reviewId: string;
    customerEmail: string;
    hasPhoto: boolean;
    hasVideo: boolean;
    onUnauthorized?: () => Promise<string | null>;
  }
): Promise<GrantResult | null> {
  // Plan gate, here rather than at the call sites, so no call site can forget it.
  //
  // The only condition on granting used to be "is there an active Incentive row", and
  // nothing deactivates that row on downgrade — /api/billing writes plan: 'free' and
  // reconcilePlan writes the plan field, neither touches Incentive. So a store that dropped
  // to Free kept minting real Shopify discount codes and emailing them out, indefinitely,
  // against a feature it was no longer paying for.
  const { getStorePlan, PLANS } = await import('./plans');
  const plan = await getStorePlan(storeId);
  if (!PLANS[plan].incentives) {
    console.warn(`[incentives] skipped: store ${storeId} is on '${plan}', which has no incentives`);
    return null;
  }

  const incentive = await db.incentive.findFirst({
    where: { storeId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!incentive) {
    console.warn('[incentives] skipped: no active incentive for store', storeId);
    return null;
  }
  console.info(
    `[incentives] granting for review ${opts.reviewId} (photo=${opts.hasPhoto}, video=${opts.hasVideo}, incentive="${incentive.name}")`
  );

  const hasMedia = opts.hasPhoto || opts.hasVideo;

  // A media-only incentive is lawful — media is a content type, not an opinion.
  if (incentive.requiresMedia && !hasMedia) {
    console.warn('[incentives] skipped: incentive requires media and review has none', opts.reviewId);
    return null;
  }

  // Tiered rewards: the reward depends on what the review CONTAINS (text/photo/video),
  // never on what it says. A video falls back to the photo tier, and both fall back to
  // the base value, so a merchant who sets only one uplift gets sensible behaviour.
  const rewardValue =
    (opts.hasVideo ? incentive.rewardValueVideo ?? incentive.rewardValuePhoto : null) ??
    (hasMedia ? incentive.rewardValuePhoto : null) ??
    incentive.rewardValue;

  // One grant per review. Without this, republishing a review mints another code.
  const existing = await db.incentiveGrant.findFirst({
    where: { incentiveId: incentive.id, reviewId: opts.reviewId },
  });
  if (existing) {
    return {
      code: existing.discountCode,
      expiresAt: existing.expiresAt,
      disclosureText: incentive.disclosureText,
      rewardType: incentive.rewardType,
      rewardValue,
      alreadyGranted: true,
    };
  }

  if (incentive.usageLimit) {
    const used = await db.incentiveGrant.count({ where: { incentiveId: incentive.id } });
    if (used >= incentive.usageLimit) {
      console.warn('[incentives] skipped: usage limit reached', incentive.id);
      return null;
    }
  }

  // Daily ceiling, independent of the merchant's own usageLimit.
  //
  // Until recently the only way to reach this function was a merchant pressing Publish, so
  // a human bounded the spend. Granting on auto-publish removed that human: an anonymous
  // storefront submission now mints a REAL Shopify discount code with no approval, and the
  // only other bound is the 120-per-hour-per-shop storefront rate limit — roughly 2,880
  // codes a day, each worth real money, farmable by anyone who can vary an email address.
  //
  // `usageLimit` does not cover this: it is nullable and unset by default, and it is a
  // lifetime total for the incentive rather than a rate. This is a rate, it is always on,
  // and it is deliberately generous — a store legitimately collecting 50 rewarded reviews
  // in one day is doing extremely well, and one that appears to be collecting 500 is being
  // farmed. Hitting it pauses rewards, never reviews.
  const dayAgo = new Date(Date.now() - 86400_000);
  const grantedToday = await db.incentiveGrant.count({
    where: { incentive: { storeId }, createdAt: { gte: dayAgo } },
  });
  if (grantedToday >= MAX_GRANTS_PER_DAY) {
    console.warn(
      `[incentives] skipped: store ${storeId} has minted ${grantedToday} codes in 24h ` +
        `(ceiling ${MAX_GRANTS_PER_DAY}). Reviews are unaffected; rewards resume automatically.`
    );
    return null;
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + incentive.expiryDays * 86400_000);

  const isFreeShipping = incentive.rewardType === 'free_shipping';

  const value =
    incentive.rewardType === 'percentage'
      ? { percentage: rewardValue / 100 }
      : { discountAmount: { amount: rewardValue, appliesOnEachItem: false } };

  // Shared by both mutations — everything except how the benefit is expressed.
  const common = {
    title: `Review reward — ${incentive.name}`,
    code,
    startsAt: new Date().toISOString(),
    endsAt: expiresAt.toISOString(),
    customerSelection: { all: true },
    // One use, by one customer. A review reward that leaks onto a coupon site and
    // gets used ten thousand times is a merchant's worst day.
    appliesOncePerCustomer: true,
    usageLimit: 1,
  };

  try {
    // Both mutations return the same shape, so the response is normalised to one field and
    // the rest of this function does not have to care which was used.
    const createDiscount = async (token: string) => {
      if (isFreeShipping) {
        const res = await callShopifyGraphQL<{
          discountCodeFreeShippingCreate: {
            codeDiscountNode: { id: string } | null;
            userErrors: Array<{ message: string }>;
          };
        }>(
          shop,
          token,
          FREE_SHIPPING_CREATE,
          { freeShippingCodeDiscount: { ...common, destination: { all: true } } },
          opts.onUnauthorized
        );
        return res.discountCodeFreeShippingCreate;
      }

      const res = await callShopifyGraphQL<{
        discountCodeBasicCreate: {
          codeDiscountNode: { id: string } | null;
          userErrors: Array<{ message: string }>;
        };
      }>(
        shop,
        token,
        DISCOUNT_CREATE,
        {
          basicCodeDiscount: {
            ...common,
            customerGets: { value, items: { all: true } },
          },
        },
        opts.onUnauthorized
      );
      return res.discountCodeBasicCreate;
    };

    let data;
    try {
      data = await createDiscount(accessToken);
    } catch (err) {
      // "Access denied … write_discounts" with a cached token can simply mean the
      // merchant approved the scope AFTER this token was minted — tokens live an hour
      // and carry the grants that existed when they were issued. One forced refresh
      // picks up the new grant; if the scope truly is not approved, the retry fails the
      // same way and the error propagates with the message that says exactly that.
      const scopeDenied = err instanceof Error && /access denied/i.test(err.message);
      const fresh = scopeDenied && opts.onUnauthorized ? await opts.onUnauthorized() : null;
      if (!fresh) throw err;
      console.info('[incentives] scope denied with cached token — retrying with a fresh one');
      data = await createDiscount(fresh);
    }

    const errs = data.userErrors;
    if (errs?.length) {
      console.error('[incentives] Shopify rejected the discount:', errs.map((e) => e.message).join('; '));
      return null;
    }

    // The unique on IncentiveGrant.reviewId is what actually enforces one code per
    // review. The findFirst above is a cheap early exit, but it cannot be the guarantee:
    // between that read and this write sits a Shopify API round trip, and a double-clicked
    // Approve or a retried PUT fits inside it comfortably — which produced two live
    // single-use codes and two reward emails for one review.
    try {
      await db.incentiveGrant.create({
        data: {
          incentiveId: incentive.id,
          reviewId: opts.reviewId,
          customerEmail: opts.customerEmail,
          discountCode: code,
          priceRuleId: data.codeDiscountNode?.id ?? null,
          expiresAt,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        // Lost the race. The other request has already granted this review its code, so
        // return null and let the caller treat it as "already granted" — which is what
        // suppresses the duplicate reward email.
        //
        // The discount we just created at Shopify is orphaned. Deliberately left alone
        // rather than deleted: it is unissued and expires on its own, and a delete here
        // would run against a code we may not have created, on the losing side of a race,
        // in a catch block. Wasting an unused discount beats risking the live one.
        console.warn(`[incentives] concurrent grant for review ${opts.reviewId} — keeping the first`);
        return null;
      }
      throw error;
    }

    // Mark the review so every downstream surface discloses it. Set here rather than left
    // to the caller, so the disclosure cannot be separated from the reward.
    await db.review.update({
      where: { id: opts.reviewId },
      data: { isIncentivized: true, incentiveType: incentive.rewardType },
    });

    return {
      code,
      expiresAt,
      disclosureText: incentive.disclosureText,
      rewardType: incentive.rewardType,
      rewardValue,
      alreadyGranted: false,
    };
  } catch (error) {
    console.error('[incentives] grant failed:', error);
    return null;
  }
}

/**
 * Describe the offer for the shopper, before they write.
 *
 * Shown up front on purpose: the FTC's concern is a reader not knowing a review was
 * compensated, and telling the reviewer plainly at the point of offer — with no mention of
 * what they should say — is what a compliant incentive looks like.
 */
export async function describeActiveIncentive(storeId: string): Promise<{
  offer: string;
  disclosure: string;
  requiresMedia: boolean;
} | null> {
  const incentive = await db.incentive.findFirst({
    where: { storeId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!incentive) return null;

  const reward =
    incentive.rewardType === 'percentage'
      ? `${incentive.rewardValue}% off`
      : incentive.rewardType === 'free_shipping'
      ? 'free shipping'
      : `${incentive.rewardValue} off`;

  return {
    offer: incentive.requiresMedia
      ? `Add a photo or video with your review and get ${reward} on your next order.`
      : `Leave a review and get ${reward} on your next order.`,
    disclosure: incentive.disclosureText,
    requiresMedia: incentive.requiresMedia,
  };
}

/**
 * Mint the reward for a review that is now published, and email it to the reviewer.
 *
 * Why this is shared rather than inlined
 * -------------------------------------
 * The reward flow lived entirely inside the merchant's PATCH /api/reviews/[id] handler, and
 * its trigger was a false->true transition on `isPublished`. That is the right trigger for
 * moderation — but it is the WRONG one for the two paths that create a review that is
 * already published:
 *
 *   - /api/storefront/submit, when the merchant has auto-publish on
 *   - /api/review-request/[token], likewise
 *
 * Neither path has a transition to observe, because the row is born published. So on every
 * store with auto-publish enabled — which is the setting merchants reach for precisely
 * because they want reviews live without touching them — the entire incentives feature was
 * inert: no code minted, no email sent, and the merchant paying for the Growth plan had no
 * way to tell.
 *
 * One function, called from all three, so the next creation path cannot forget it.
 *
 * Never throws. A missing discount code is a disappointed shopper; a failed submission is a
 * lost review. The first must never cause the second — every caller invokes this inside
 * `after()` for the same reason.
 */
export async function rewardPublishedReview(
  storeId: string,
  shop: string,
  accessToken: string,
  review: {
    id: string;
    reviewerEmail: string | null;
    reviewerName?: string | null;
    images?: unknown;
    videoUrl?: unknown;
  },
  onUnauthorized?: () => Promise<string | null>
): Promise<void> {
  if (!review.reviewerEmail) {
    // Diagnosable rather than silent: "why did no code go out" is a real support question,
    // and an anonymous or imported review is the common non-obvious answer.
    console.info('[incentives] published without reviewer email — no reward possible:', review.id);
    return;
  }

  try {
    const grant = await grantIncentive(storeId, shop, accessToken, {
      reviewId: review.id,
      customerEmail: review.reviewerEmail,
      hasPhoto: Boolean(review.images),
      hasVideo: Boolean(review.videoUrl),
      onUnauthorized,
    });

    // Minting the code is only half the feature: a code the reviewer is never told about is
    // indistinguishable from no reward. `alreadyGranted` guards the republish case, so
    // toggling a review off and on again does not send the same code twice.
    if (!grant || grant.alreadyGranted) return;

    const { renderIncentiveEmail, sendEmail } = await import('./email');
    const store = await db.store.findUnique({ where: { id: storeId }, select: { name: true } });

    // Same unsubscribe machinery the review-request emails carry.
    //
    // The reward email had no opt-out of any kind: no link in the body, no List-Unsubscribe
    // header. It was treated as a one-off receipt, but it is unsolicited mail carrying a
    // discount code — which is exactly what a recipient reports as spam when they have no
    // other exit, and Gmail and Yahoo require one-click unsubscribe from bulk senders
    // regardless. Every merchant on this platform shares one sending domain, so one
    // reputation hit is everyone's.
    const { unsubscribeToken } = await import('@/app/api/unsubscribe/route');
    const appUrl = process.env.SHOPIFY_APP_URL || '';
    const unsubscribeUrl = appUrl
      ? `${appUrl}/api/unsubscribe?t=${encodeURIComponent(unsubscribeToken(review.reviewerEmail))}`
      : undefined;

    const msg = renderIncentiveEmail({
      unsubscribeUrl,
      storeName: store?.name || shop,
      customerName: review.reviewerName === 'Verified Customer' ? null : review.reviewerName ?? null,
      code: grant.code,
      rewardType: grant.rewardType,
      rewardValue: grant.rewardValue,
      expiresAt: grant.expiresAt,
      disclosureText: grant.disclosureText,
    });

    const result = await sendEmail({ ...msg, to: review.reviewerEmail });
    if (!result.sent) {
      // The code still exists in Shopify and in the grants table — the merchant can hand it
      // over by hand from the review's detail view.
      console.warn('[incentives] reward code minted but email not sent:', result.reason);
    }
  } catch (err) {
    console.error('[incentives] reward failed for review', review.id, err);
  }
}
