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
 * Navigate the merchant's admin to a URL from inside the embedded app.
 *
 * `window.top`, never `window.location`. The app runs in an iframe, so navigating the
 * frame leaves Shopify's chrome wrapped around a page that does not belong in it — and
 * for Shopify's own OAuth screen, which refuses to be framed, the result is a blank
 * rectangle with no way forward.
 */
export function navigateTop(url: string): void {
  if (typeof window === 'undefined') return;
  if (window.top) window.top.location.href = url;
  else window.location.href = url;
}
