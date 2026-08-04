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
  const incentive = await db.incentive.findFirst({
    where: { storeId, isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!incentive) return null;

  const hasMedia = opts.hasPhoto || opts.hasVideo;

  // A media-only incentive is lawful — media is a content type, not an opinion.
  if (incentive.requiresMedia && !hasMedia) return null;

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
    if (used >= incentive.usageLimit) return null;
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + incentive.expiryDays * 86400_000);

  const value =
    incentive.rewardType === 'percentage'
      ? { percentage: rewardValue / 100 }
      : { discountAmount: { amount: rewardValue, appliesOnEachItem: false } };

  try {
    const data = await callShopifyGraphQL<{
      discountCodeBasicCreate: {
        codeDiscountNode: { id: string } | null;
        userErrors: Array<{ message: string }>;
      };
    }>(
      shop,
      accessToken,
      DISCOUNT_CREATE,
      {
        basicCodeDiscount: {
          title: `Review reward — ${incentive.name}`,
          code,
          startsAt: new Date().toISOString(),
          endsAt: expiresAt.toISOString(),
          customerSelection: { all: true },
          customerGets: { value, items: { all: true } },
          // One use, by one customer. A review reward that leaks onto a coupon site and
          // gets used ten thousand times is a merchant's worst day.
          appliesOncePerCustomer: true,
          usageLimit: 1,
        },
      },
      opts.onUnauthorized
    );

    const errs = data.discountCodeBasicCreate.userErrors;
    if (errs?.length) {
      console.error('[incentives] Shopify rejected the discount:', errs.map((e) => e.message).join('; '));
      return null;
    }

    await db.incentiveGrant.create({
      data: {
        incentiveId: incentive.id,
        reviewId: opts.reviewId,
        customerEmail: opts.customerEmail,
        discountCode: code,
        priceRuleId: data.discountCodeBasicCreate.codeDiscountNode?.id ?? null,
        expiresAt,
      },
    });

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
