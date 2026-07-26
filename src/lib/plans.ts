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

import { db } from './db';

export type PlanId = 'free' | 'starter' | 'pro' | 'enterprise';

export interface PlanLimits {
  label: string;
  price: number;
  /** null means unlimited */
  maxReviews: number | null;
  maxWidgets: number | null;
  /** null means every widget type is allowed */
  allowedWidgetTypes: string[] | null;
  csvImport: boolean;
  platformImport: boolean;
  photoReviews: boolean;
  advancedAnalytics: boolean;
  apiAccess: boolean;
  whiteLabel: boolean;
}

export const PLANS: Record<PlanId, PlanLimits> = {
  free: {
    label: 'Free',
    price: 0,
    maxReviews: 50,
    maxWidgets: 1,
    allowedWidgetTypes: ['list'],
    csvImport: false,
    platformImport: true,
    photoReviews: false,
    advancedAnalytics: false,
    apiAccess: false,
    whiteLabel: false,
  },
  starter: {
    label: 'Starter',
    price: 9.99,
    maxReviews: 500,
    maxWidgets: 5,
    allowedWidgetTypes: null,
    csvImport: true,
    platformImport: true,
    photoReviews: true,
    advancedAnalytics: false,
    apiAccess: false,
    whiteLabel: false,
  },
  pro: {
    label: 'Pro',
    price: 29.99,
    maxReviews: null,
    maxWidgets: null,
    allowedWidgetTypes: null,
    csvImport: true,
    platformImport: true,
    photoReviews: true,
    advancedAnalytics: true,
    apiAccess: false,
    whiteLabel: false,
  },
  enterprise: {
    label: 'Enterprise',
    price: 99.99,
    maxReviews: null,
    maxWidgets: null,
    allowedWidgetTypes: null,
    csvImport: true,
    platformImport: true,
    photoReviews: true,
    advancedAnalytics: true,
    apiAccess: true,
    whiteLabel: true,
  },
};

export type FeatureFlag =
  | 'csvImport'
  | 'platformImport'
  | 'photoReviews'
  | 'advancedAnalytics'
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

/** Normalise whatever is stored on the row into a known plan. */
export function normalisePlan(plan: string | null | undefined): PlanId {
  if (plan && plan in PLANS) return plan as PlanId;
  return 'free';
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
  const order: PlanId[] = ['free', 'starter', 'pro', 'enterprise'];
  return order.find((p) => PLANS[p][feature] === true) ?? null;
}

/** The cheapest plan that allows at least `count` reviews. */
function cheapestPlanForReviews(count: number): PlanId | null {
  const order: PlanId[] = ['free', 'starter', 'pro', 'enterprise'];
  return order.find((p) => {
    const max = PLANS[p].maxReviews;
    return max === null || max >= count;
  }) ?? null;
}

/**
 * How many more reviews this store may add. null means unlimited.
 *
 * Used by the platform importer, which is available on every plan but bounded by the
 * plan's total review cap — so a Free store can import, just not past 50 reviews.
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

  throw new PlanLimitError(message, {
    code: 'REVIEW_LIMIT_REACHED',
    currentPlan: plan,
    suggestedPlan: cheapestPlanForReviews(used + adding),
    usage: { used, limit },
  });
}

/** Check that a store's plan includes a feature. Throws PlanLimitError if not. */
export async function assertFeature(storeId: string, feature: FeatureFlag): Promise<void> {
  const plan = await getStorePlan(storeId);
  if (PLANS[plan][feature]) return;

  const labels: Record<FeatureFlag, string> = {
    csvImport: 'CSV import',
    platformImport: 'Importing from Amazon, eBay and other platforms',
    photoReviews: 'Photo and video reviews',
    advancedAnalytics: 'Advanced analytics',
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
export async function assertWidgetAllowed(storeId: string, widgetType: string): Promise<void> {
  const plan = await getStorePlan(storeId);
  const limits = PLANS[plan];

  if (limits.allowedWidgetTypes && !limits.allowedWidgetTypes.includes(widgetType)) {
    throw new PlanLimitError(
      `The "${widgetType}" widget is not available on the ${limits.label} plan.`,
      { code: 'WIDGET_TYPE_NOT_IN_PLAN', currentPlan: plan, suggestedPlan: 'starter' }
    );
  }

  if (limits.maxWidgets !== null) {
    const used = await db.widgetConfig.count({ where: { storeId } });
    if (used >= limits.maxWidgets) {
      throw new PlanLimitError(
        `You have reached the ${limits.label} plan limit of ${limits.maxWidgets} widget${limits.maxWidgets === 1 ? '' : 's'}.`,
        {
          code: 'WIDGET_LIMIT_REACHED',
          currentPlan: plan,
          suggestedPlan: limits.maxWidgets < 5 ? 'starter' : 'pro',
          usage: { used, limit: limits.maxWidgets },
        }
      );
    }
  }
}

/** Current usage and limits, for display in the dashboard. */
export async function getUsage(storeId: string) {
  const plan = await getStorePlan(storeId);
  const limits = PLANS[plan];

  const [reviews, widgets] = await Promise.all([
    db.review.count({ where: { storeId } }),
    db.widgetConfig.count({ where: { storeId } }),
  ]);

  const pct = (used: number, limit: number | null) =>
    limit === null ? 0 : Math.min(100, Math.round((used / limit) * 100));

  return {
    plan,
    planLabel: limits.label,
    price: limits.price,
    reviews: { used: reviews, limit: limits.maxReviews, percentUsed: pct(reviews, limits.maxReviews) },
    widgets: { used: widgets, limit: limits.maxWidgets, percentUsed: pct(widgets, limits.maxWidgets) },
    features: {
      csvImport: limits.csvImport,
      platformImport: limits.platformImport,
      photoReviews: limits.photoReviews,
      advancedAnalytics: limits.advancedAnalytics,
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
