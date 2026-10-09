/**
 * Links into the merchant's own Shopify admin.
 *
 * These were built as `https://admin.shopify.com/products/<id>` and
 * `https://admin.shopify.com/settings/billing/subscriptions` — both missing the
 * `/store/<handle>` segment that identifies WHICH store. Shopify 404s them, and because
 * the billing one navigates `window.top`, a merchant who clicked "Manage Billing" had
 * their entire admin window replaced with a not-found page and had to navigate back by
 * hand. That is a worse outcome than the button not existing.
 *
 * The handle is the myshopify subdomain: `acme-store.myshopify.com` -> `acme-store`.
 */

export function storeHandle(shopifyDomain: string | null | undefined): string | null {
  if (!shopifyDomain) return null;
  // Accepts either form: the full domain, or a bare handle if one is ever stored.
  const handle = shopifyDomain.trim().toLowerCase().replace(/\.myshopify\.com$/, '');
  return handle || null;
}

/** Absolute URL into this merchant's admin, or null when the domain is unknown. */
export function adminUrl(shopifyDomain: string | null | undefined, path: string): string | null {
  const handle = storeHandle(shopifyDomain);
  if (!handle) return null;
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `https://admin.shopify.com/store/${handle}${clean}`;
}

/**
 * Leave the embedded app for a URL — Shopify's billing approval screen, the admin's
 * subscriptions page — the way App Bridge expects.
 *
 * Never by assigning `window.top.location`. The app runs inside Shopify's sandboxed admin
 * iframe, which is only allowed to navigate its parent while the click's transient
 * activation is still valid: about five seconds in Chrome and Firefox, and in Safari not
 * reliably across an awaited fetch at all. Every billing hand-off sits behind a network
 * round-trip (a session-token check, a few database reads and two Shopify calls), so on a
 * slow response the window had closed by the time the URL arrived. Chrome then threw
 * "The current window does not have permission to navigate the target frame" and Safari
 * did nothing — the merchant watched the button flip back from "Redirecting…" to "Upgrade"
 * and never reached Shopify's approval page, while a PENDING subscription was left behind
 * at Shopify on every attempt.
 *
 * App Bridge patches the global `open` so that `open(url, '_top')` posts a message to the
 * admin host, which performs the navigation itself. That is Shopify's documented way out
 * of the frame ("embedded apps don't have permission to manipulate the parent browser
 * window, including redirects") and it is not subject to the activation window. Outside
 * the admin there is no App Bridge (`window.shopify` is undefined) and no parent to ask,
 * so a plain location change is the right thing — and the only thing — to do.
 */
/**
 * sessionStorage key for the plan change in flight at Shopify: `{ from, to }`, written by
 * the Plan page just before it hands the merchant to Shopify and read by the app shell
 * when they come back, so a slow confirmation waits for the plan they actually bought.
 */
export const PENDING_PLAN_KEY = 'marka.pendingPlan';

export function navigateTop(url: string): void {
  if (typeof window === 'undefined') return;
  // Both conditions: the App Bridge script is loaded on every page, so the global can
  // exist outside the admin, where handing it the navigation does nothing at all.
  if (window.shopify && window.self !== window.top) {
    window.open(url, '_top');
    return;
  }
  window.location.href = url;
}
