/**
 * One free trial per store, ever — recorded when the merchant actually GETS one.
 *
 * The bug this replaces
 * --------------------
 * `trialDays: 30` was hardcoded into every `appSubscriptionCreate`, which made the trial a
 * property of the mutation rather than of the merchant: cancel on day 29, resubscribe, and
 * get another 30 free days, repeatable forever.
 *
 * The first attempt at a fix wrote the marker at charge-CREATION time, which traded an
 * abuse for a worse defect. Creating a charge is an intent, not an outcome — the merchant
 * still has to approve it on Shopify's screen. So a merchant who clicked Upgrade, read the
 * price, and closed the tab had silently burned their only trial; so had one who opened
 * Growth, changed their mind, and picked Scale instead. Both are ordinary behaviour, both
 * were unrecoverable, and neither produced any signal.
 *
 * The marker is therefore written from the ENTITLEMENT side: the points where Shopify tells
 * us a subscription is actually active. Those are the `app_subscriptions/update` webhook and
 * `/api/billing/confirm`, and they are the same two places that already write `store.plan`.
 * Abandoning an approval screen now costs nothing, and the only way to consume the trial is
 * to receive one.
 *
 * Stored as a StoreSetting rather than a Store column so this needs no migration.
 */

import { db } from './db';

const TRIAL_KEY = 'billing.trialUsedAt';
export const TRIAL_DAYS = 30;

/**
 * Days of trial this store should be offered on a new subscription.
 *
 * 30 for a store that has never held an active paid subscription, 0 afterwards. The full
 * length is 30 rather than the 7 it once was, and not the 14-15 the category uses: the
 * default review-request delay is 14 days after fulfilment, so a 7-day trial expired a week
 * before the merchant's first request email even sent — they cancelled having never seen the
 * product do the thing they were evaluating.
 */
export async function trialDaysFor(storeId: string): Promise<number> {
  const used = await db.storeSetting.findUnique({
    where: { storeId_key: { storeId, key: TRIAL_KEY } },
    select: { id: true },
  });
  return used ? 0 : TRIAL_DAYS;
}

/**
 * Record that this store has now had its trial. Idempotent.
 *
 * Call only when Shopify reports an ACTIVE paid subscription. Safe to call on every plan
 * resolution: the upsert leaves an existing marker alone, so the FIRST activation is the one
 * that counts and later reconciliations do not move the date.
 *
 * Never throws — losing the marker costs one extra trial, and that must not be allowed to
 * fail a webhook or a plan confirmation.
 */
export async function markTrialConsumed(storeId: string): Promise<void> {
  try {
    await db.storeSetting.upsert({
      where: { storeId_key: { storeId, key: TRIAL_KEY } },
      create: { storeId, key: TRIAL_KEY, value: new Date().toISOString() },
      update: {},
    });
  } catch (err) {
    console.error('[billing] could not record trial consumption for store', storeId, err);
  }
}
