/**
 * Subscription plan limits and enforcement.
 *
 * Plans were previously recorded on the Store row but never enforced anywhere, so a
 * merchant on the Free plan could collect unlimited reviews, use every widget type and
 * run platform imports. There was no functional reason to upgrade.
 *
 * Everything here is server-side. Never gate features in the browser alone — a client
 * check is a suggestion, not a limit.
 */

import crypto from 'node:crypto';
import { db } from './db';

export type PlanId = 'free' | 'growth' | 'scale';

export interface PlanLimits {
  label: string;
  price: number;
  /**
   * Review request emails per calendar month. null means unlimited.
   *
   * This is the meter. See the pricing note below for why it is this and not review count.
   */
  maxRequestsPerMonth: number | null;
  /** null means unlimited. Unlimited on every tier — see the pricing note. */
  maxReviews: number | null;
  maxWidgets: number | null;
  /** null means every widget type is allowed */
  allowedWidgetTypes: string[] | null;
  csvImport: boolean;
  platformImport: boolean;
  photoReviews: boolean;
  /** Video is a separate gate from photo — it costs far more to store and serve. */
  videoReviews: boolean;
  /** Follow-up nudges after the first request. Each one consumes the monthly quota. */
  reminderEmails: boolean;
  questionsAndAnswers: boolean;
  incentives: boolean;
  /** Google Merchant Center product ratings feed. */
  googleFeed: boolean;
  /** Shop app syndication via the product_review metaobject. */
  shopSyndication: boolean;
  apiAccess: boolean;
  whiteLabel: boolean;
}

/**
 * Pricing.
 *
 * ── Why the meter is email volume, not review count ──
 *
 * This used to cap total stored reviews: 50 free, then 500 / 1,000 / unlimited. Three
 * things were wrong with that, in order of severity.
 *
 * **It paywalled the best onboarding moment.** The strongest first five minutes this app
 * has is a merchant importing a few hundred AliExpress reviews and watching their product
 * page fill up. Under a 50-review free cap, that single action hit the wall immediately —
 * the feature we lead with was also the feature that blocked them.
 *
 * **Review count is a ratchet, not a meter.** Reviews accumulate and never decrease, so a
 * store that crossed 1,000 lifetime reviews stayed above it permanently no matter how
 * little it now sells. It measured how long someone had been a customer, not what they
 * could afford.
 *
 * **It lost the only comparison that gets made.** Judge.me's free plan is unlimited
 * reviews, unlimited photo and video, with AliExpress and Etsy import included. Against
 * "50 reviews", a merchant stops reading before reaching any feature at all.
 *
 * So: reviews are unlimited on every tier, and the meter is **review request emails per
 * calendar month**. That axis is defensible on every count — it is the only real marginal
 * cost, it tracks fulfilled orders and therefore store size, it resets monthly, and
 * imports do not touch it.
 *
 * ── Why these numbers ──
 *
 *  - **Free: 100 requests/month.** Roughly three orders a day. Enough that a small store
 *    runs the whole collection loop for real, small enough that a growing one outgrows it
 *    within a quarter. Carries our branding on the widget, which is the distribution.
 *
 *  - **Growth: $12.** Judge.me is $15 flat and has a decade of reviews behind it. At
 *    $19.99 we were asking an unknown app to command a premium over the category leader.
 *    $12 is visibly cheaper rather than a rounding error, and it makes the upgrade an easy
 *    yes at the moment the quota runs out. Raise it later; grandfather everyone early.
 *
 *  - **Scale: $39.** Deliberately just under Loox's $49.99 entry, so "switching from Loox"
 *    has a number attached to it.
 *
 *  - **Three tiers, not four.** At this price point a fourth only creates hesitation, and
 *    the old Starter and Growth tiers cannibalised each other.
 *
 * Shopify takes 0% of the first $1M in app revenue, then 15%. Gross margin here stays
 * around 90% — the constraint on this business is distribution, not unit economics.
 */
export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    label: 'Free',
    price: 0,
    maxRequestsPerMonth: 100,
    maxReviews: null,
    maxWidgets: null,
    allowedWidgetTypes: null,
    csvImport: true,
    // Import is free on every tier, deliberately. It is the fastest path to a populated
    // product page, it costs us nothing per row, and the competitor gives it away.
    platformImport: true,
    photoReviews: true,
    videoReviews: false,
    reminderEmails: false,
    questionsAndAnswers: false,
    incentives: false,
    googleFeed: false,
    shopSyndication: false,
    apiAccess: false,
    whiteLabel: false,
  },
  growth: {
    label: 'Growth',
    price: 12,
    maxRequestsPerMonth: 1000,
    maxReviews: null,
    maxWidgets: null,
    allowedWidgetTypes: null,
    csvImport: true,
    platformImport: true,
    photoReviews: true,
    videoReviews: true,
    reminderEmails: true,
    questionsAndAnswers: true,
    incentives: true,
    googleFeed: true,
    shopSyndication: true,
    apiAccess: false,
    whiteLabel: true,
  },
  scale: {
    label: 'Scale',
    price: 39,
    maxRequestsPerMonth: null,
    maxReviews: null,
    maxWidgets: null,
    allowedWidgetTypes: null,
    csvImport: true,
    platformImport: true,
    photoReviews: true,
    videoReviews: true,
    reminderEmails: true,
    questionsAndAnswers: true,
    incentives: true,
    googleFeed: true,
    shopSyndication: true,
    // Not sold until it is built.
    //
    // This was `true` on the top tier, and nothing in the codebase implements it — no
    // route, no key issuance, no docs. Charging for a feature that does not exist is a
    // Shopify review failure on its own, and it is the kind of thing that is invisible
    // right up until a merchant pays for the tier and asks where their key is. The flag
    // stays so the plumbing is ready; the entitlement flips when the endpoint ships.
    apiAccess: false,
    whiteLabel: true,
  },
};

/** Cheapest to most expensive. Used to suggest the tier that unblocks a merchant. */
const PLAN_ORDER: PlanId[] = ['free', 'growth', 'scale'];

export type FeatureFlag =
  | 'csvImport'
  | 'platformImport'
  | 'photoReviews'
  | 'videoReviews'
  | 'reminderEmails'
  | 'questionsAndAnswers'
  | 'incentives'
  | 'googleFeed'
  | 'shopSyndication'
  | 'apiAccess'
  | 'whiteLabel';

/**
 * Thrown when a store exceeds its plan. Carries HTTP 402 Payment Required so the client
 * can distinguish "you need to upgrade" from a generic failure and show an upgrade prompt
 * rather than an error toast.
 */
export class PlanLimitError extends Error {
  status = 402;
  code: string;
  currentPlan: PlanId;
  suggestedPlan: PlanId | null;
  usage?: { used: number; limit: number };

  constructor(
    message: string,
    opts: {
      code: string;
      currentPlan: PlanId;
      suggestedPlan?: PlanId | null;
      usage?: { used: number; limit: number };
    }
  ) {
    super(message);
    this.name = 'PlanLimitError';
    this.code = opts.code;
    this.currentPlan = opts.currentPlan;
    this.suggestedPlan = opts.suggestedPlan ?? null;
    this.usage = opts.usage;
  }
}

/**
 * Plan ids from before the three-tier restructure.
 *
 * A store whose Shopify subscription is still named "ReviewMaster Pro Plan" must land on
 * the tier that honours what they are paying for, not fall through to Free. Mapping up
 * rather than down: nobody loses a feature because we renamed a tier.
 */
const LEGACY_PLAN_IDS: Record<string, PlanId> = {
  starter: 'growth',
  pro: 'scale',
};

/** Normalise whatever is stored on the row into a known plan. */
export function normalisePlan(plan: string | null | undefined): PlanId {
  if (!plan) return 'free';
  if (plan in PLANS) return plan as PlanId;
  return LEGACY_PLAN_IDS[plan] ?? 'free';
}

export async function getStorePlan(storeId: string): Promise<PlanId> {
  const store = await db.store.findUnique({
    where: { id: storeId },
    select: { plan: true },
  });
  return normalisePlan(store?.plan);
}

/** The cheapest plan that provides a given feature. */
function cheapestPlanWith(feature: FeatureFlag): PlanId | null {
  return PLAN_ORDER.find((p) => PLANS[p][feature] === true) ?? null;
}

/* ────────────────────────────────────────────────────────────────────────────
   Monthly request quota
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The counter lives in StoreSetting rather than a dedicated table.
 *
 * One upsert per email sent, one lookup per check, no migration — which matters, because
 * a schema change is the riskiest thing to ship to a live multi-tenant database for what
 * is fundamentally an integer per store per month. Old keys age out with the retention
 * job; nothing reads them after the month ends.
 */
function usageKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `usage.requests.${y}-${m}`;
}

/** First instant of next month, UTC. When a throttled request should next be attempted. */
export function nextQuotaReset(from = new Date()): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1, 0, 5, 0));
}

/** Requests sent this calendar month, and the plan's allowance. null limit = unlimited. */
export async function getRequestUsage(storeId: string): Promise<{
  used: number;
  limit: number | null;
  remaining: number | null;
  plan: PlanId;
}> {
  const plan = await getStorePlan(storeId);
  const limit = PLANS[plan].maxRequestsPerMonth;

  const row = await db.storeSetting.findUnique({
    where: { storeId_key: { storeId, key: usageKey() } },
    select: { value: true },
  });
  const used = Number(row?.value ?? 0) || 0;

  return {
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
    plan,
  };
}

/**
 * Record one sent request against this month's quota.
 *
 * Called only after the provider accepts the message — a send that failed did not cost us
 * anything and must not consume the merchant's allowance.
 */
export async function recordRequestSent(storeId: string): Promise<void> {
  const key = usageKey();

  // Incremented in the database, not read into JavaScript and written back.
  //
  // The old shape was findUnique, add one, upsert. Two sends interleaving both read the
  // same value and both wrote the same result, so the meter under-counted by exactly the
  // number of concurrent sends. That is the merchant's monthly allowance quietly leaking:
  // a Free store on 100 could send meaningfully more, and the busier the store the wider
  // the gap — the counter is least accurate precisely when it matters most.
  //
  // `ON CONFLICT DO UPDATE` with the arithmetic inside the statement makes it atomic
  // under any amount of concurrency. The value is stored as text because StoreSetting is
  // a generic key/value table, so it is cast in and back out; a row whose value is not a
  // number is treated as zero rather than poisoning the count.
  await db.$executeRaw`
    INSERT INTO "StoreSetting" ("id", "storeId", "key", "value", "createdAt", "updatedAt")
    VALUES (${crypto.randomUUID()}, ${storeId}, ${key}, '1', NOW(), NOW())
    ON CONFLICT ("storeId", "key") DO UPDATE
      SET "value" = (COALESCE(NULLIF("StoreSetting"."value", '')::numeric, 0) + 1)::bigint::text,
          "updatedAt" = NOW()
  `;
}

/**
 * Has this store any request quota left this month?
 *
 * Returns a boolean rather than throwing: the caller is the scheduled sender, and a store
 * being out of quota is an ordinary outcome to defer, not an exception to handle.
 */
export async function hasRequestQuota(storeId: string): Promise<boolean> {
  const { limit, used } = await getRequestUsage(storeId);
  return limit === null || used < limit;
}

/* ────────────────────────────────────────────────────────────────────────────
   Review capacity
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * How many more reviews this store may add. null means unlimited.
 *
 * Unlimited on every tier since the meter moved to email volume. Kept — rather than
 * deleted along with its five call sites — because it is the correct place for any future
 * volume limit, and because a caller that stops checking is harder to fix later than one
 * that checks against no limit.
 */
export async function getRemainingReviewCapacity(storeId: string): Promise<number | null> {
  const plan = await getStorePlan(storeId);
  const limit = PLANS[plan].maxReviews;
  if (limit === null) return null;
  const used = await db.review.count({ where: { storeId } });
  return Math.max(0, limit - used);
}

/**
 * Check that a store can add `adding` more reviews. Throws PlanLimitError if not.
 * Call this BEFORE writing, so a rejected import does not leave partial data behind.
 */
export async function assertReviewCapacity(storeId: string, adding = 1): Promise<void> {
  const plan = await getStorePlan(storeId);
  const limit = PLANS[plan].maxReviews;
  if (limit === null) return;

  const used = await db.review.count({ where: { storeId } });
  if (used + adding <= limit) return;

  const remaining = Math.max(0, limit - used);
  const message =
    adding === 1
      ? `You have reached the ${PLANS[plan].label} plan limit of ${limit} reviews.`
      : `Adding ${adding} reviews would exceed the ${PLANS[plan].label} plan limit of ${limit}. You have room for ${remaining} more.`;

  const suggested =
    PLAN_ORDER.find((p) => {
      const max = PLANS[p].maxReviews;
      return max === null || max >= used + adding;
    }) ?? null;

  throw new PlanLimitError(message, {
    code: 'REVIEW_LIMIT_REACHED',
    currentPlan: plan,
    suggestedPlan: suggested,
    usage: { used, limit },
  });
}

/* ────────────────────────────────────────────────────────────────────────────
   Feature and widget gates
   ──────────────────────────────────────────────────────────────────────────── */

/** Check that a store's plan includes a feature. Throws PlanLimitError if not. */
export async function assertFeature(storeId: string, feature: FeatureFlag): Promise<void> {
  const plan = await getStorePlan(storeId);
  if (PLANS[plan][feature]) return;

  // Written for a merchant reading an upgrade prompt, not for a developer reading a log.
  const labels: Record<FeatureFlag, string> = {
    csvImport: 'CSV import',
    platformImport: 'AliExpress review import',
    photoReviews: 'Photo reviews',
    videoReviews: 'Video reviews',
    reminderEmails: 'Reminder emails',
    questionsAndAnswers: 'Questions & answers',
    incentives: 'Review incentives',
    googleFeed: 'Google Shopping star ratings',
    shopSyndication: 'Shop app syndication',
    apiAccess: 'API access',
    whiteLabel: 'White-label widgets',
  };

  const suggested = cheapestPlanWith(feature);
  throw new PlanLimitError(
    `${labels[feature]} is not available on the ${PLANS[plan].label} plan.`,
    { code: 'FEATURE_NOT_IN_PLAN', currentPlan: plan, suggestedPlan: suggested }
  );
}

/** Check widget count and type against the plan. Throws PlanLimitError if not allowed. */
/**
 * @param excludeId When updating an existing widget, its own id — so the count check does
 *   not include the row being edited. Without this, a merchant on a plan with a widget cap
 *   could never edit the widget they already have: the count would see 1 of 1 used and
 *   reject the change.
 *
 * Every tier currently allows every widget type with no cap — widgets cost nothing to run
 * and "unlimited everything except email volume" is a far cleaner promise than a matrix of
 * caps. The checks stay because the limits are data, and a future tier may reintroduce one.
 */
export async function assertWidgetAllowed(
  storeId: string,
  widgetType: string,
  excludeId?: string
): Promise<void> {
  const plan = await getStorePlan(storeId);
  const limits = PLANS[plan];

  if (limits.allowedWidgetTypes && !limits.allowedWidgetTypes.includes(widgetType)) {
    throw new PlanLimitError(
      `The "${widgetType}" widget is not available on the ${limits.label} plan.`,
      {
        code: 'WIDGET_TYPE_NOT_IN_PLAN',
        currentPlan: plan,
        suggestedPlan:
          PLAN_ORDER.find(
            (p) => PLANS[p].allowedWidgetTypes === null || PLANS[p].allowedWidgetTypes!.includes(widgetType)
          ) ?? null,
      }
    );
  }

  if (limits.maxWidgets !== null) {
    const used = await db.widgetConfig.count({
      where: { storeId, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (used >= limits.maxWidgets) {
      throw new PlanLimitError(
        `You have reached the ${limits.label} plan limit of ${limits.maxWidgets} widget${limits.maxWidgets === 1 ? '' : 's'}.`,
        {
          code: 'WIDGET_LIMIT_REACHED',
          currentPlan: plan,
          suggestedPlan:
            PLAN_ORDER.find((p) => {
              const max = PLANS[p].maxWidgets;
              return max === null || max > used;
            }) ?? null,
          usage: { used, limit: limits.maxWidgets },
        }
      );
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Reporting
   ──────────────────────────────────────────────────────────────────────────── */

/** Current usage and limits, for display in the dashboard. */
export async function getUsage(storeId: string) {
  const plan = await getStorePlan(storeId);
  const limits = PLANS[plan];

  const [reviews, widgets, requests, pendingReviews] = await Promise.all([
    db.review.count({ where: { storeId } }),
    db.widgetConfig.count({ where: { storeId } }),
    getRequestUsage(storeId),
    // Here rather than in /api/analytics, which is where the shell used to get it.
    // The nav badge needs one number; analytics answers fifteen aggregates plus a
    // thirty-day scan, and the shell was firing the whole thing on every navigation to
    // read a single count. One more `count` on a query this route already runs is free
    // by comparison.
    db.review.count({ where: { storeId, isPublished: false } }),
  ]);

  const pct = (used: number, limit: number | null) =>
    limit === null ? 0 : Math.min(100, Math.round((used / limit) * 100));

  return {
    plan,
    planLabel: limits.label,
    price: limits.price,
    /** Awaiting moderation. Drives the badge on the Reviews tab. */
    pendingReviews,
    // The meter. Everything else here is informational.
    requests: {
      used: requests.used,
      limit: requests.limit,
      percentUsed: pct(requests.used, requests.limit),
      resetsAt: nextQuotaReset().toISOString(),
    },
    reviews: { used: reviews, limit: limits.maxReviews, percentUsed: pct(reviews, limits.maxReviews) },
    widgets: { used: widgets, limit: limits.maxWidgets, percentUsed: pct(widgets, limits.maxWidgets) },
    features: {
      csvImport: limits.csvImport,
      platformImport: limits.platformImport,
      photoReviews: limits.photoReviews,
      videoReviews: limits.videoReviews,
      reminderEmails: limits.reminderEmails,
      questionsAndAnswers: limits.questionsAndAnswers,
      incentives: limits.incentives,
      googleFeed: limits.googleFeed,
      shopSyndication: limits.shopSyndication,
      apiAccess: limits.apiAccess,
      whiteLabel: limits.whiteLabel,
    },
    allowedWidgetTypes: limits.allowedWidgetTypes,
  };
}

/** Shared error handling so every route responds to plan limits identically. */
export function planLimitResponse(error: unknown) {
  if (error instanceof PlanLimitError) {
    return {
      body: {
        error: error.message,
        code: error.code,
        currentPlan: error.currentPlan,
        suggestedPlan: error.suggestedPlan,
        usage: error.usage,
        upgradeUrl: '/billing',
      },
      status: error.status,
    };
  }
  return null;
}
