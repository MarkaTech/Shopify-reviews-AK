/**
 * Keeping `store.plan` true to what Shopify bills for.
 *
 * Shopify is the authority on what a merchant pays, and `store.plan` is a cache of that
 * answer, lifted to any complimentary plan an operator gave (entitledPlan). The cache is
 * written from events — the post-approval confirm, the app_subscriptions/update webhook —
 * and events get missed: a webhook dropped while the app was deploying, a confirm that
 * failed on a flaky classification query, an operator's "Set plan". Until now the only
 * thing that ever corrected drift was the merchant opening their dashboard, which ran a
 * reconcile in after() at most hourly. The portal and the end-complimentary fallback both
 * promised an "hourly billing check" that did not exist, and the gap was not academic: a
 * store whose Scale gift was ended kept unlimited review requests for as long as the
 * merchant stayed away from the app, because the hourly SEND sweep is a real cron and the
 * plan check was not.
 *
 * One implementation, three entry points:
 *   - applyResolvedSubscription: given what Shopify said, write the entitlement. The
 *     post-approval confirm uses this directly because it reads Shopify with its own retry.
 *   - reconcileStorePlan: one store, with a token the caller already holds. Used from the
 *     dashboard load and the operator portal.
 *   - reconcileSomePlans: a slice of the fleet, oldest check first, from the hourly cron.
 *
 * The trial marker is written here as well (billing-4). It used to be written only by the
 * confirm and the webhook, so a merchant whose confirm failed and whose webhook was dropped
 * received a 30-day trial that nothing recorded — and trialDaysFor offered them another one
 * on their next subscription. markTrialConsumed is idempotent, so the first activation date
 * is the one that stays.
 */

import { db } from './db';
import { resolveActiveSubscription, ShopifyGraphQLError } from './shopify';
import { entitledPlan, normalisePlan, type PlanId } from './plans';
import { markTrialConsumed } from './trial';
import { getFreshAccessTokenByStoreId, tokenRefresherFor, ReauthRequiredError } from './shopify-token';

/**
 * When Shopify was last asked. Shared by every path that reconciles, so the dashboard load
 * and the cron do not each ask within the same hour.
 */
export const PLAN_RECONCILED_KEY = 'plan.reconciledAt';

export async function stampPlanReconciled(storeId: string, at = new Date()): Promise<void> {
  const value = at.toISOString();
  await db.storeSetting.upsert({
    where: { storeId_key: { storeId, key: PLAN_RECONCILED_KEY } },
    create: { storeId, key: PLAN_RECONCILED_KEY, value },
    update: { value },
  });
}

/**
 * Forget when Shopify was last asked, so the next dashboard load asks straight away.
 *
 * Called on uninstall and on (re)provisioning. Without it, a merchant who uninstalled and
 * reinstalled inside an hour came back with the paid tier Shopify had already cancelled at
 * uninstall — white-label widget, gated features, the lot — until the marker aged out.
 */
export async function clearPlanReconciled(storeId: string): Promise<void> {
  await db.storeSetting
    .deleteMany({ where: { storeId, key: PLAN_RECONCILED_KEY } })
    .catch((err) => console.error('[plan] could not clear the reconcile marker for', storeId, err));
}

export interface PlanReconcileResult {
  before: PlanId;
  after: PlanId;
  corrected: boolean;
}

/**
 * Write down what a store is entitled to, given what Shopify just reported.
 *
 * `currentPlan` is what the row holds now, when the caller already has it; otherwise it is
 * read. The write only happens on a difference, and either way the marker is stamped.
 */
export async function applyResolvedSubscription(
  storeId: string,
  shop: string,
  resolved: { plan: string; test: boolean },
  currentPlan?: string | null
): Promise<PlanReconcileResult> {
  const stored =
    currentPlan === undefined
      ? (await db.store.findUnique({ where: { id: storeId }, select: { plan: true } }))?.plan
      : currentPlan;

  // What Shopify bills for, lifted to any complimentary plan an operator gave.
  const after = await entitledPlan(storeId, resolved.plan);
  const before = normalisePlan(stored);

  await stampPlanReconciled(storeId);

  const corrected = after !== before;
  if (corrected) {
    // Worth a log line either way. Drift downward means we were giving away a paid tier;
    // drift upward means a merchant was paying for something they could not use.
    console.warn(`[plan] ${shop} drifted: stored='${stored}' actual='${after}' — correcting`);
    await db.store.update({ where: { id: storeId }, data: { plan: after } });
  }

  // Entitlement reached: this store has now had its trial. A test subscription (development
  // store, or the billing test flag) is not a trial in any sense that should cost one.
  if (resolved.plan !== 'free' && !resolved.test) {
    await markTrialConsumed(storeId);
  }

  return { before, after, corrected };
}

/** Ask Shopify, then write. Throws when Shopify cannot be read; nothing is written then. */
export async function reconcileStorePlan(
  storeId: string,
  shop: string,
  accessToken: string,
  onUnauthorized?: () => Promise<string | null>,
  currentPlan?: string | null
): Promise<PlanReconcileResult> {
  const resolved = await resolveActiveSubscription(shop, accessToken, onUnauthorized);
  return applyResolvedSubscription(storeId, shop, resolved, currentPlan);
}

export interface PlanBatchResult {
  checked: number;
  corrected: number;
  /** Token gone or unrefreshable; the merchant has to open the app before this can work. */
  reauth: number;
  failed: number;
}

/**
 * Reconcile a few stores' plans, oldest check first. Hourly, from the review-request cron.
 *
 * A small batch on purpose: it is two Admin API calls per store (subscriptions, then the
 * shop's billing class), the condition it catches is rare, and the whole fleet is still
 * covered within a few hours without a burst of traffic. A store the merchant opened
 * recently sorts late because the dashboard load stamps the same marker.
 *
 * A store with no marker sorts first — it is the one most likely to be wrong.
 */
export async function reconcileSomePlans(batch = 10): Promise<PlanBatchResult> {
  // accessToken not null: the uninstall webhook drops every credential, so that excludes
  // uninstalled stores without a second flag. Shopify cancels their subscription anyway.
  const candidates = await db.store.findMany({
    where: { isActive: true, shopifyDomain: { not: null }, accessToken: { not: null } },
    select: {
      id: true,
      shopifyDomain: true,
      plan: true,
      settings: { where: { key: PLAN_RECONCILED_KEY }, select: { value: true } },
    },
    take: 200,
  });

  const ordered = candidates
    .map((c) => ({ ...c, last: c.settings[0]?.value ? Date.parse(c.settings[0].value) : 0 }))
    .sort((a, b) => a.last - b.last)
    .slice(0, batch);

  const result: PlanBatchResult = { checked: 0, corrected: 0, reauth: 0, failed: 0 };

  for (const store of ordered) {
    if (!store.shopifyDomain) continue;
    result.checked++;
    try {
      const token = await getFreshAccessTokenByStoreId(store.id);
      const r = await reconcileStorePlan(
        store.id,
        store.shopifyDomain,
        token,
        tokenRefresherFor(store.id),
        store.plan
      );
      if (r.corrected) result.corrected++;
    } catch (err) {
      // A dead refresh token, or a token Shopify refuses outright: either way the merchant
      // has to open the app once. Not an error worth a stack trace every hour.
      if (err instanceof ReauthRequiredError || (err instanceof ShopifyGraphQLError && err.status === 401)) {
        // Nothing to do until the merchant opens the app, which re-provisions the store
        // and clears the marker so their first load reconciles immediately.
        result.reauth++;
        console.warn(`[plan] ${store.shopifyDomain} skipped: ${err.message}`);
      } else {
        result.failed++;
        console.error('[plan] reconciliation failed for', store.shopifyDomain, err);
      }
      // Still stamped. Without this a store whose token fetch throws sorts first forever
      // and takes a slot in every run, so the batch never reaches anyone else.
      await stampPlanReconciled(store.id).catch(() => undefined);
    }
  }

  return result;
}
