import { NextResponse, after } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { db } from '@/lib/db';
import { resolveActivePlan } from '@/lib/shopify';
import { normalisePlan } from '@/lib/plans';

/**
 * How often to re-derive the plan from Shopify. Cheap enough to do often, expensive
 * enough not to do on every request — a merchant clicking around the app would otherwise
 * generate an Admin API call per navigation for a value that changes a few times a year.
 */
const RECONCILE_EVERY_MS = 60 * 60 * 1000;
const LAST_RECONCILED_KEY = 'plan.reconciledAt';

/**
 * Re-derive `store.plan` from what Shopify actually reports, and correct it if it drifted.
 *
 * Why this exists: `store.plan` was written in exactly two places, both event-driven —
 * the `?billing=success` redirect, and the APP_SUBSCRIPTIONS_UPDATE webhook. Any sequence
 * that misses both leaves whatever was written last, permanently:
 *
 *   - a merchant cancels in Shopify admin and the webhook is dropped or arrives while the
 *     app is down — they keep a paid tier they are no longer paying for
 *   - uninstall and reinstall, which writes no plan at all
 *   - a trial that expires without conversion
 *
 * There was no path that would ever correct any of those. Shopify is the authority on
 * what a merchant is paying for, so this asks it, on a schedule, and writes the answer.
 *
 * Runs in `after()` so it never delays the response, and every failure is swallowed: a
 * Shopify API blip must not stop a merchant opening their own dashboard. The worst case
 * of a failure is that the value stays as stale as it already was, and the next open
 * tries again.
 */
async function reconcilePlan(
  storeId: string,
  shop: string,
  accessToken: string,
  currentPlan: string | null,
  onUnauthorized?: () => Promise<string | null>
): Promise<void> {
  try {
    const marker = await db.storeSetting.findUnique({
      where: { storeId_key: { storeId, key: LAST_RECONCILED_KEY } },
      select: { value: true },
    });
    const last = marker?.value ? Date.parse(marker.value) : 0;
    if (Number.isFinite(last) && Date.now() - last < RECONCILE_EVERY_MS) return;

    const actual = await resolveActivePlan(shop, accessToken, onUnauthorized);

    const now = new Date().toISOString();
    await db.storeSetting.upsert({
      where: { storeId_key: { storeId, key: LAST_RECONCILED_KEY } },
      create: { storeId, key: LAST_RECONCILED_KEY, value: now },
      update: { value: now },
    });

    if (normalisePlan(actual) !== normalisePlan(currentPlan)) {
      // Worth a log line either way. Drift downward means we were giving away a paid
      // tier; drift upward means a merchant was paying for something they could not use.
      console.warn(
        `[plan] ${shop} drifted: stored='${currentPlan}' actual='${actual}' — correcting`
      );
      await db.store.update({ where: { id: storeId }, data: { plan: actual } });
    }
  } catch (err) {
    console.error('[plan] reconciliation failed for', shop, err);
  }
}

export async function GET(request: Request) {
  try {
    const { storeId, shop, accessToken, onUnauthorized } = await withAuth(request);

    const store = await db.store.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        name: true,
        domain: true,
        shopifyDomain: true,
        plan: true,
        isActive: true,
        installedAt: true,
      },
    });

    // Off the response path. The merchant sees their dashboard immediately; if the plan
    // was wrong it is corrected behind them and right on the next load.
    if (store) {
      after(() => reconcilePlan(storeId, shop, accessToken, store.plan, onUnauthorized));
    }

    return NextResponse.json({ store: { ...store, shop } });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[Failed to fetch store info]', error);
    return NextResponse.json({ error: 'Failed to fetch store info' }, { status: 500 });
  }
}
