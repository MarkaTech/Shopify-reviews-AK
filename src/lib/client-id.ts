/**
 * The app's Shopify client ID, resolved from either environment variable name.
 *
 * Why this exists
 * ---------------
 * The same value has been read under two different names in this codebase. `shopify.ts`
 * has always used `NEXT_PUBLIC_SHOPIFY_API_KEY` — that is what OAuth signs its redirects
 * with, and it is what is actually set in Azure. The newer App Bridge code reached for the
 * unprefixed `SHOPIFY_API_KEY`, which was never set anywhere but a test file.
 *
 * The failure was silent in both places, which is why it survived a deploy:
 *
 *   - `layout.tsx` rendered `<meta name="shopify-api-key" content="">`, and Next drops a
 *     meta tag whose content is an empty string. No tag, no error, App Bridge never
 *     initialises, no session token is ever minted.
 *   - `verifySessionToken` compared `aud` against `''`, so every token that did arrive
 *     would have been rejected as the wrong audience.
 *
 * A single accessor rather than two constants, so the next place that needs the client ID
 * cannot pick the wrong name again.
 *
 * The unprefixed name is preferred when both are present: `NEXT_PUBLIC_` is a Next.js
 * convention meaning "safe to inline into the browser bundle", and while that is true of a
 * client ID, it is the wrong reason to have chosen the name. New deployments should set
 * `SHOPIFY_API_KEY`; the fallback keeps every existing one working untouched.
 */
export function shopifyClientId(): string {
  return process.env.SHOPIFY_API_KEY || process.env.NEXT_PUBLIC_SHOPIFY_API_KEY || '';
}
