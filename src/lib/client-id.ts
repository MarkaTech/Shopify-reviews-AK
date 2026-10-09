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

/**
 * The app's handle in the Shopify admin — the `handle = "..."` line of shopify.app.toml.
 *
 * Not used by app code today. It is the one value the plan page Shopify hosts for an app on
 * Shopify App Pricing needs (`/store/<store>/charges/<handle>/pricing_plans`, where the
 * client ID cannot stand in the way it does on `/apps/<id>`). That hand-off was removed:
 * subscriptions bought there are visible only to the Partner API, which this app does not
 * read yet, so sending a merchant there charged them for a plan the app never granted.
 * Kept for when that reader exists.
 *
 * An environment variable with the toml value as its default, rather than reading the toml
 * at runtime: the file is not shipped in the standalone build. The default is the handle the
 * app was published under, and the variable exists so a renamed handle can be followed
 * without a code change.
 */
export function shopifyAppHandle(): string {
  return process.env.SHOPIFY_APP_HANDLE?.trim() || 'reviewmaster-reviews';
}
