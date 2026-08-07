import { NextResponse, type NextRequest } from 'next/server';

/**
 * Clickjacking protection for the embedded admin.
 *
 * Shopify requires an embedded app to declare which sites may frame it, and states that
 * an app "might be rejected" during review without it. The requirement exists because an
 * embedded app renders inside an iframe by design — so the usual blanket `DENY` is not
 * available, and the app has to name the two origins that are legitimately allowed to
 * frame it: the merchant's own storefront domain, and Shopify's admin.
 *
 * `frame-ancestors` and not `X-Frame-Options`. The older header cannot express "these two
 * origins" — it offers DENY, SAMEORIGIN, or a single ALLOW-FROM that modern browsers
 * ignore. Setting it alongside CSP would only add a directive that either blocks the app
 * outright or is disregarded.
 *
 * The shop is read from the query string, which Shopify puts on every embedded request.
 * It is validated against the myshopify pattern before it reaches the header — a shop
 * parameter is attacker-controlled, and unvalidated input in a CSP directive is a way to
 * add an origin of the attacker's choosing to the allow-list.
 *
 * Requests without a usable shop fall back to Shopify's admin only. That is the correct
 * default: it keeps the app framable where it is meant to run, and nowhere else.
 */

const SHOP_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  const shop = request.nextUrl.searchParams.get('shop');
  const ancestors =
    shop && SHOP_PATTERN.test(shop)
      ? `https://${shop} https://admin.shopify.com`
      : 'https://admin.shopify.com';

  response.headers.set('Content-Security-Policy', `frame-ancestors ${ancestors};`);

  // Cheap hardening that costs nothing and is expected of a merchant-facing app.
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return response;
}

/**
 * Everything except static assets and the storefront-facing endpoints.
 *
 * The `/api/storefront/*` routes are called cross-origin from a merchant's theme and the
 * public review form is opened directly by a buyer, so neither is framed and neither
 * should inherit an admin-only frame-ancestors policy. Excluding them also keeps this
 * middleware off the hot path that shoppers hit.
 */
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|api/storefront|api/webhooks|api/cron|api/feeds|r/).*)',
  ],
};
