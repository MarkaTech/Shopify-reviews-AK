import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { createRecurringCharge, cancelActiveSubscriptions, SHOPIFY_APP_URL } from '@/lib/shopify';
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

export async function POST(request: NextRequest) {
  try {
    const { shop, accessToken, storeId, onUnauthorized } = await withAuth(request);

    // `returnUrl` is deliberately no longer read from the body. It was never sent by the
    // only caller, and an attacker-supplied return URL on a billing flow is a redirect
    // gadget carrying the merchant straight out of the admin after a payment.
    const body = await request.json() as { plan: string };
    const { plan } = body;

    if (!plan) {
      return NextResponse.json({ error: 'Plan is required' }, { status: 400 });
    }

    const validPlans = ['free', 'growth', 'scale'];
    if (!validPlans.includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
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

    const confirmationUrl = await createRecurringCharge(
      shop,
      accessToken,
      plan,
      chargeReturnUrl,
      onUnauthorized,
      trialDays
    );

    return NextResponse.json({
      confirmationUrl,
      plan,
    });
  } catch (error: unknown) {
    // Logged in full, returned generic. Every other route in the app does this; these two
    // billing routes echoed `error.message` verbatim, which leaks Shopify userErrors and
    // GraphQL internals to the browser for no benefit to the merchant.
    console.error('[billing] charge/cancel failed:', error);
    const status = (error as Error & { status?: number }).status || 500;
    return NextResponse.json(
      { error: 'Could not update your plan. Please try again, or contact support if it keeps failing.' },
      { status }
    );
  }
}
