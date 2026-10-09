import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import {
  createRecurringCharge,
  cancelActiveSubscriptions,
  describeSubscriptionFailure,
  genericSubscriptionFailure,
  SHOPIFY_APP_URL,
} from '@/lib/shopify';
import { adminUrl } from '@/lib/admin-links';
import { shopifyClientId } from '@/lib/client-id';

/**
 * Where Shopify sends the merchant after they approve or decline the charge.
 *
 * This must be a URL *inside* the Shopify admin, and it was not. It defaulted to
 * `${SHOPIFY_APP_URL}/?shop=...`, the app's own Azure origin — so the top-level window that
 * Shopify redirects after approval landed outside admin.shopify.com. There, `window.top`
 * is the page itself, App Bridge never initialises, no session token is minted, and under
 * managed installation there is no session cookie either (that is only ever set by the
 * legacy OAuth callback). Every authenticated call 401s, and `page.tsx` falls through to
 * WelcomeScreen — the install sales page. A merchant who had just paid was told to install
 * the app they already owned, and an App Store reviewer testing the paid plan saw exactly
 * that.
 *
 * `/apps/<client id>` rather than `/apps/<app handle>`: the admin accepts the client ID as
 * the app identifier, and it is already resolved server-side by `shopifyClientId()`. Using
 * the handle would mean a second copy of a value that lives in shopify.app.toml, with a
 * silent 404 as the failure mode if the two ever drifted.
 *
 * Falls back to the old absolute URL only if the shop domain or client ID is somehow
 * unavailable — a bad landing page beats a charge that cannot be created at all.
 */
function embeddedReturnUrl(shop: string): string {
  const clientId = shopifyClientId();
  const embedded = clientId ? adminUrl(shop, `/apps/${clientId}?billing=success`) : null;
  return embedded || `${SHOPIFY_APP_URL}/?shop=${shop}&billing=success`;
}

/**
 * withAuth's own rejection, and nothing else.
 *
 * The response status used to be copied off whatever was thrown, so a 401 from Shopify's
 * Admin API — the OFFLINE token refused — reached the browser as a 401 of ours, and
 * apiFetch told the merchant their session had expired and to reload. Reloading changes
 * nothing; their session was fine. Only the session check may answer 401 here.
 */
function isAuthFailure(error: unknown): boolean {
  return error instanceof Error && error.name === 'UnauthorizedError';
}

/*
 * Shopify App Pricing (managed pricing): why this route never sends a merchant to Shopify's
 * hosted plan page.
 *
 * An app opted in to App Pricing has the Billing API closed to it — appSubscriptionCreate
 * is refused with "Managed Pricing Apps cannot use the Billing API" — and merchants pick a
 * plan on a page Shopify hosts at /charges/<app handle>/pricing_plans instead. An earlier
 * draft of this route sent merchants there, on a SHOPIFY_MANAGED_PRICING flag and on that
 * refusal. It must not, yet. A plan bought on that page is visible only through the
 * Partner API, activeSubscription(appId, shopId); a native App Pricing subscription has no
 * Admin API AppSubscription, and App Pricing sends no app_subscriptions/update webhook. Every path that grants a plan here reads the
 * Admin API (currentAppInstallation.activeSubscriptions, via resolveActiveSubscription):
 * the confirm route, the webhook, /api/store's reconcile and the hourly reconcileSomePlans.
 * So the merchant would be billed every month while all of them resolved the store to
 * Free, and the hourly reconcile would undo even an operator's hand-set plan. Refusing,
 * with nothing charged, is the honest answer until the app can see what it charged for.
 *
 * Before the hand-off can come back:
 *   - a Partner API client, with a Manage apps token in the app settings;
 *   - activeSubscription(appId, shopId) — shopId from `shop { id }` — merged into
 *     resolveActiveSubscription, so confirm, /api/store and both reconciles all see it;
 *   - the welcome link's `plan_handle` return handled in page.tsx through
 *     /api/billing/confirm, never trusted from the URL itself;
 *   - downgrades cancelled through the Partner API when an App Pricing subscription exists.
 *
 * Until then a refusal is a 502 telling the merchant paid plans cannot be started, and a
 * console.error carrying MANAGED_PRICING_REFUSAL, which is the line to search the log for.
 */
export async function POST(request: NextRequest) {
  // Hoisted out of the try so the failure log can say which shop and plan it was for.
  let shop = '';
  let plan = '';
  // A short reference, in the log line and in the merchant's message. "It says ref
  // mg3k2x1" is enough for support to find the full Shopify error in the Azure log; the
  // generic sentence on its own was not, which is how "merchants cannot pay" arrived with
  // no way to tell which merchant hit which cause.
  const ref = Date.now().toString(36);
  // Which Shopify call was in flight when something threw: the downgrade and gift paths
  // CANCEL, only the upgrade path CREATES. See the managed-pricing branch in the catch.
  let stage: 'cancel' | 'create' = 'cancel';

  try {
    const auth = await withAuth(request);
    shop = auth.shop;
    const { accessToken, storeId, onUnauthorized } = auth;

    // `returnUrl` is deliberately no longer read from the body. It was never sent by the
    // only caller, and an attacker-supplied return URL on a billing flow is a redirect
    // gadget carrying the merchant straight out of the admin after a payment.
    const body = await request.json() as { plan?: unknown };
    plan = typeof body.plan === 'string' ? body.plan : '';

    if (!plan) {
      return NextResponse.json({ error: 'Plan is required' }, { status: 400 });
    }

    const validPlans = ['free', 'growth', 'scale'];
    if (!validPlans.includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    // A complimentary plan covers itself and every plan below it, so those are never
    // charged for. Choosing one only does something when the store still pays Shopify for
    // a plan ABOVE the gift (given Growth, paying for Scale): that charge is cancelled and
    // the store settles on its free plan. Paying for a higher plan goes to Shopify as usual.
    const { getComplimentary, higherPlan } = await import('@/lib/plans');
    const comp = await getComplimentary(storeId);
    if (comp && higherPlan(plan, comp.plan) === comp.plan) {
      const cancelled = await cancelActiveSubscriptions(shop, accessToken, onUnauthorized);
      if (cancelled === 0) {
        return NextResponse.json(
          { error: `Your store has the ${comp.plan === 'scale' ? 'Scale' : 'Growth'} plan free of charge, so there is nothing to change or pay.` },
          { status: 409 }
        );
      }
      const { db } = await import('@/lib/db');
      await db.store.update({ where: { id: storeId }, data: { plan: comp.plan } });
      console.log(`[billing] ${shop} back on complimentary '${comp.plan}' (${cancelled} subscription(s) cancelled)`);
      return NextResponse.json({ success: true, plan: comp.plan, activated: true, cancelled });
    }

    if (plan === 'free') {
      // Downgrade means cancelling the charge at Shopify, not writing 'free' locally.
      //
      // This used to do only the local write. The merchant lost their paid features
      // immediately, Shopify carried on billing them, and reconcilePlan saw a
      // still-ACTIVE subscription and restored the paid tier within the hour — so the
      // cancellation undid itself while the money kept moving, and there was no path
      // anywhere in the app to stop the charge.
      //
      // Cancel FIRST, then write. If the cancel throws we fall to the catch and the
      // stored plan is untouched, which leaves the merchant on the tier they are still
      // paying for. The alternative ordering fails toward "free locally, billed at
      // Shopify" — the exact broken state this replaces.
      //
      // Cancellation stays on the Billing API under Shopify App Pricing too: that opt-in
      // closes subscription CREATION, not appSubscriptionCancel. It only reaches the
      // subscriptions this route created, though — one bought on Shopify's own App Pricing
      // page is invisible to it (see the note above POST).
      const cancelled = await cancelActiveSubscriptions(shop, accessToken, onUnauthorized);

      const { db } = await import('@/lib/db');
      await db.store.update({
        where: { id: storeId },
        data: { plan: 'free' },
      });

      console.log(`[billing] ${shop} downgraded to free (${cancelled} subscription(s) cancelled)`);
      return NextResponse.json({ success: true, plan: 'free', activated: true, cancelled });
    }

    const chargeReturnUrl = embeddedReturnUrl(shop);

    // One 30-day trial per store, ever. Read here, but CONSUMED only when Shopify reports
    // an active subscription — see src/lib/trial.ts. Marking it here would mean a merchant
    // who opened the approval screen and closed it had silently burned their trial.
    const { trialDaysFor } = await import('@/lib/trial');
    const trialDays = await trialDaysFor(storeId);

    stage = 'create';
    const confirmationUrl = await createRecurringCharge(
      shop,
      accessToken,
      plan,
      chargeReturnUrl,
      onUnauthorized,
      trialDays
    );

    console.info(`[billing] ${shop} -> ${plan}: subscription created through the Billing API, awaiting approval`);
    return NextResponse.json({
      confirmationUrl,
      plan,
    });
  } catch (error: unknown) {
    if (isAuthFailure(error)) return unauthorizedResponse();

    // Logged in full, returned classified. Shopify's userErrors and GraphQL internals never
    // reach the browser verbatim; what the merchant sees is one of a handful of sentences
    // that say what THEY can do about it, plus the reference that finds this log line.
    // The status is ours — 502 when Shopify answered with an error, 500 otherwise — and
    // never Shopify's own.
    const failure = describeSubscriptionFailure(error);

    // Only a CREATE refusal is the App Pricing wall. A cancel that fails — a merchant asking
    // to STOP paying — must never be told "paid plans cannot be started right now".
    if (failure.kind === 'managed-pricing' && stage === 'create') {
      // Not one merchant's problem: every paid plan fails this way until the app is taken
      // off Shopify App Pricing or can read its subscriptions (see the note above POST).
      // Its own marker so the operator can find it, and alert on it, without reading every
      // billing failure. The merchant is told nothing was charged and is NOT sent to pay.
      console.error(
        `[billing] MANAGED_PRICING_REFUSAL — the app is on Shopify App Pricing; Billing API charges are rejected ` +
          `(${shop || 'unknown shop'}, plan '${plan}', ref ${ref}):`,
        error
      );
    } else {
      console.error(`[billing] charge/cancel failed for ${shop || 'unknown shop'} (plan '${plan}', ref ${ref}):`, error);
    }

    const shown = failure.kind === 'managed-pricing' && stage !== 'create' ? genericSubscriptionFailure() : failure;
    return NextResponse.json({ error: `${shown.message} (ref ${ref})` }, { status: failure.status });
  }
}
