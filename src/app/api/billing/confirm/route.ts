import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { resolveActiveSubscription } from '@/lib/shopify';
import { applyResolvedSubscription } from '@/lib/plan-reconcile';

/**
 * Landing point after the merchant approves (or declines) a subscription in Shopify.
 *
 * Three things changed here, all of them bugs rather than refactors:
 *
 * 1. SECURITY — the plan used to come from `?plan=` in the query string, which the browser
 *    controls. Anyone could visit /api/billing/confirm?charge_id=1&plan=enterprise and be
 *    granted the $99.99 tier without paying. The plan is now read from Shopify's own list
 *    of active subscriptions, which is the only trustworthy source.
 *
 * 2. CORRECTNESS — there is no longer an "activate the charge" step. That belonged to the
 *    REST recurring_application_charges flow, which this app can no longer use (new public
 *    apps must be GraphQL-only). With appSubscriptionCreate, merchant approval activates
 *    the subscription; we just read back what Shopify says is active.
 *
 * 3. RESILIENCE — reading the subscription involves a second query for the shop's billing
 *    class, and resolveActiveSubscription deliberately refuses to decide when that query
 *    fails (guessing wrong writes a merchant down to Free). One blip there used to 500 this
 *    route; the client swallowed the 500 and the merchant who had just paid landed on a
 *    dashboard still saying Free, with nothing to say why, until the webhook or the hourly
 *    reconcile caught up. Now: one retry, and then an honest "pending" rather than an error.
 *
 * If the merchant declined, there is no active subscription and this correctly resolves to
 * the free plan rather than silently upgrading them.
 */

/**
 * Pause before the one retry. Long enough for a transient to clear, short enough that the
 * merchant is still looking at the spinner rather than a stale page.
 */
const RETRY_AFTER_MS = 1_500;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * withAuth's own rejection, and nothing else. A 401 from Shopify's API must not become a
 * 401 of ours — apiFetch turns that into "your session has expired, reload", which is
 * untrue and unhelpful. See the same helper in ../route.ts.
 */
function isAuthFailure(error: unknown): boolean {
  return error instanceof Error && error.name === 'UnauthorizedError';
}

export async function GET(request: NextRequest) {
  try {
    const { shop, accessToken, storeId, onUnauthorized } = await withAuth(request);

    let resolved: { plan: string; test: boolean } | null = null;
    try {
      resolved = await resolveActiveSubscription(shop, accessToken, onUnauthorized);
    } catch (first) {
      console.warn(`[billing/confirm] could not read ${shop}'s subscription; retrying in ${RETRY_AFTER_MS}ms:`, first);
      await sleep(RETRY_AFTER_MS);
      try {
        resolved = await resolveActiveSubscription(shop, accessToken, onUnauthorized);
      } catch (second) {
        console.error(
          `[billing/confirm] still could not read ${shop}'s subscription; leaving the plan to the webhook or the next reconcile:`,
          second
        );
      }
    }

    if (!resolved) {
      // 200, not 500. The merchant has just paid, and this lets the client say "payment
      // received — your plan updates within a minute", which is true: app_subscriptions/update
      // is on its way and the hourly reconcile is behind it. Nothing is written, so a declined
      // charge is never mistaken for an approved one.
      return NextResponse.json({ success: false, activated: false, pending: true });
    }

    // Writes the entitlement (never below a complimentary plan an operator gave), stamps the
    // reconcile marker, and consumes the one-per-store trial when this is a paid, non-test
    // subscription. The trial is consumed here, on entitlement, not when the charge was
    // created — a merchant who opened the approval screen and closed it keeps theirs.
    const applied = await applyResolvedSubscription(storeId, shop, resolved);

    return NextResponse.json({
      success: true,
      // The plan the store is ENTITLED to — the paid plan or a gift, whichever is higher —
      // which is what /api/usage reports and what the Plan page records as `from` before
      // handing off. Returning what Shopify bills made a gifted Growth store read 'free'
      // here: a decline looked like a change of course, and a slow approval was never
      // waited for. `activated` still means "Shopify bills a paid plan".
      plan: applied.after,
      billed: resolved.plan,
      activated: resolved.plan !== 'free',
    });
  } catch (error: unknown) {
    if (isAuthFailure(error)) return unauthorizedResponse();
    console.error('[billing/confirm] failed:', error);
    return NextResponse.json({ error: 'Could not confirm your subscription.' }, { status: 500 });
  }
}
