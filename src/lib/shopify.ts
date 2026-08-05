/**
 * Shopify API Utilities
 * Handles OAuth, HMAC verification, Admin API calls, and billing
 */

import crypto from 'crypto';
import { shopifyClientId } from './client-id';

const SHOPIFY_API_KEY = shopifyClientId() || 'test_key';
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_secret';
const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL || 'http://localhost:3000';

/**
 * OAuth scopes.
 *
 * read_script_tags / write_script_tags were removed when the theme app extension landed.
 * ScriptTag is a legacy API and requesting a scope the app no longer uses is both a
 * needless permission prompt for the merchant and an App Store review finding.
 *
 * write_product_reviews and read_metaobjects are NOT listed here on purpose. They are
 * only granted after Shopify approves the Standard Product Review Syndication Program
 * and a review-specific amendment to the Partner Agreement is signed. Requesting a scope
 * that has not been granted makes Shopify reject the whole OAuth request, which would
 * break every install. Once approved, add them via SHOPIFY_SCOPES rather than editing
 * this file, so the change is a config toggle instead of a deploy.
 */
const DEFAULT_SCOPES = [
  'read_products',
  'write_products',
  'read_orders',
  'read_customers',
  // Photo and video reviews are stored in Shopify Files rather than our own bucket, so
  // the media lives on the merchant's CDN, costs us nothing to store, and stays with them
  // if they uninstall. That requires write_files.
  'write_files',
  // Review incentives create a real Shopify discount code via discountCodeBasicCreate.
  // Without this the whole incentives feature returns access-denied — and because it is
  // gated to Starter and above, the first merchant to hit it would be one who had just
  // paid for it.
  'write_discounts',
];

// read_themes / write_themes were removed. Nothing in the app calls a theme API: the
// storefront widget is a theme app extension that the merchant places themselves in the
// theme editor, and no script tag is installed. Requesting a permission the app never
// exercises is a larger install prompt for the merchant and a question at review.

const SCOPES = (process.env.SHOPIFY_SCOPES || DEFAULT_SCOPES.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .join(',');

// ── HMAC Verification ──

/**
 * Constant-time comparison that tolerates length mismatch.
 *
 * crypto.timingSafeEqual throws a RangeError when the two buffers differ in length, so
 * calling it directly on attacker-controlled input turns a failed signature check into a
 * 500 (or, worse, an unhandled rejection) instead of a clean rejection. Compare lengths
 * first, then compare bytes in constant time.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Build the two candidate canonical strings Shopify might have signed.
 *
 * Shopify's instruction is to "transform the query string to a key-value table, remove the
 * hmac key-value pair, and then transform your map back to a query string." That round
 * trip is ambiguous: transforming a map back to a query string may or may not re-encode
 * the values, and the two produce completely different digests the moment any value
 * contains a reserved character.
 *
 * In practice this bites on `host`, which is base64 of `admin.shopify.com/store/<shop>`.
 * Whenever that string's length is not a multiple of 3 the base64 carries `=` padding,
 * which is `%3D` encoded and `=` decoded. Whether an install succeeds would otherwise
 * depend on the character count of the shop's domain — which is exactly the kind of
 * bug that looks intermittent and unreproducible.
 *
 * Rather than bet on one reading, compute both and accept either. Both are full
 * HMAC-SHA256 checks against the real client secret, so this does not weaken the
 * signature check: a forger still has to produce a valid digest under one of two fixed,
 * well-defined encodings without knowing the secret.
 *
 * @returns [encodedForm, decodedForm] — the message as Shopify sent it on the wire, and
 *          the same parameters with values percent-decoded.
 */
function canonicalMessages(queryString: string): [string, string] {
  const rawPairs: string[] = [];
  const decodedPairs: string[] = [];

  for (const pair of queryString.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1);

    const key = safeDecode(rawKey);
    // Shopify excludes both hmac and the legacy signature parameter from the message.
    if (key === 'hmac' || key === 'signature') continue;

    rawPairs.push(`${rawKey}=${rawValue}`);
    decodedPairs.push(`${key}=${safeDecode(rawValue)}`);
  }

  return [rawPairs.sort().join('&'), decodedPairs.sort().join('&')];
}

/** decodeURIComponent that returns the input unchanged rather than throwing on bad input. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function digest(message: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

/**
 * Verify the HMAC on an OAuth / App Bridge query string.
 *
 * Pass the RAW query string exactly as it arrived, including the hmac parameter — this
 * function strips it before computing the digest. Do NOT pass
 * `new URL(request.url).searchParams.toString()`: URLSearchParams re-serialises with its
 * own encoding rules, which destroys the on-the-wire form this needs in order to check
 * the encoded variant. Use `new URL(request.url).search.slice(1)`.
 */
export function verifyShopifyHmac(queryString: string, secret: string = SHOPIFY_API_SECRET): boolean {
  const params = new URLSearchParams(queryString);
  const hmac = params.get('hmac');

  // No signature at all is a failure, not something to compare against the empty string.
  if (!hmac) return false;

  const [encodedForm, decodedForm] = canonicalMessages(queryString);

  const encodedDigest = digest(encodedForm, secret);
  if (safeCompare(hmac, encodedDigest)) return true;

  const decodedDigest = digest(decodedForm, secret);
  if (safeCompare(hmac, decodedDigest)) return true;

  // Neither form matched. Log enough to tell a canonicalisation problem apart from a
  // wrong secret, without ever putting the secret — or a merchant's `code` — in a log.
  //
  // Parameter NAMES only. Digest prefixes are safe: the hmac is public (it travels in the
  // URL), and 8 hex characters of a SHA-256 digest reveal nothing about the key.
  console.error(
    '[hmac] verification failed',
    JSON.stringify({
      params: Array.from(params.keys()).sort(),
      received: hmac.slice(0, 8),
      encodedCandidate: encodedDigest.slice(0, 8),
      decodedCandidate: decodedDigest.slice(0, 8),
      formsDiffer: encodedForm !== decodedForm,
      secretLength: secret.length,
    })
  );

  return false;
}

export function verifyWebhookHmac(body: string, hmacHeader: string, secret: string = SHOPIFY_API_SECRET): boolean {
  if (!hmacHeader) return false;

  const expectedHmac = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('base64');

  return safeCompare(hmacHeader, expectedHmac);
}

// ── OAuth URL Generation ──
export function createShopifyAuthUrl(shop: string, state: string, scopes: string = SCOPES): string {
  const redirectUri = `${SHOPIFY_APP_URL}/api/auth/callback`;
  return `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${encodeURIComponent(scopes)}&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

// ── Token Exchange ──

/** A token set as returned by any of Shopify's OAuth grants. */
export interface ShopifyTokenSet {
  accessToken: string;
  /** Null only for a legacy non-expiring token. Everything issued from now on has one. */
  refreshToken: string | null;
  /** Absolute expiry of the access token (60 min), or null for a legacy token. */
  expiresAt: Date | null;
  /** Absolute expiry of the refresh token (90 days), or null when there is none. */
  refreshExpiresAt: Date | null;
  scope: string | null;
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

/** Error carrying enough detail to tell a dead refresh token from a transient blip. */
export interface TokenRequestError extends Error {
  status?: number;
  shopifyError?: string;
}

/**
 * POST to a shop's OAuth token endpoint.
 *
 * Shopify documents this endpoint as application/x-www-form-urlencoded. The previous
 * implementation sent JSON, which Shopify tolerates for the plain authorization-code
 * exchange but is not what the expiring-token and refresh grants are specified against —
 * so all three now match the documented content type.
 */
async function postToken(shop: string, form: Record<string, string>): Promise<ShopifyTokenSet> {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
  });

  const raw = (await response.json().catch(() => ({}))) as RawTokenResponse;

  if (!response.ok || !raw.access_token) {
    const detail = raw.error_description || raw.error || response.statusText;
    const err = new Error(`Shopify token request failed (${response.status}): ${detail}`) as TokenRequestError;
    err.status = response.status;
    err.shopifyError = raw.error;
    throw err;
  }

  const now = Date.now();
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresAt: raw.expires_in ? new Date(now + raw.expires_in * 1000) : null,
    refreshExpiresAt: raw.refresh_token_expires_in
      ? new Date(now + raw.refresh_token_expires_in * 1000)
      : null,
    scope: raw.scope ?? null,
  };
}

/**
 * Exchange an OAuth authorization code for an EXPIRING offline access token.
 *
 * `expiring=1` is the whole point of this function. Without it Shopify issues a classic
 * non-expiring token, and every subsequent Admin API call fails with:
 *
 *   403 [API] Non-expiring access tokens are no longer accepted for the Admin API.
 *              Start using expiring offline tokens
 *
 * That rule covers public apps created on or after 1 April 2026 — which this app is — and
 * every public app from 1 January 2027. It is what was blocking billing.
 */
export async function exchangeAccessToken(shop: string, code: string): Promise<ShopifyTokenSet> {
  return postToken(shop, {
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
    code,
    expiring: '1',
  });
}

/**
 * Trade a refresh token for a fresh access token + refresh token.
 *
 * Shopify invalidates the old refresh token on success and returns a new one with a fresh
 * 90-day window, so the result MUST be persisted — dropping it strands the store.
 */
export async function refreshOfflineToken(shop: string, refreshToken: string): Promise<ShopifyTokenSet> {
  return postToken(shop, {
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

/**
 * One-way migration of an existing non-expiring token to an expiring one.
 *
 * Stores installed before this change hold a legacy token Shopify now rejects. Token
 * exchange upgrades them in place — no merchant interaction, no reinstall.
 *
 * Irreversible: the non-expiring token is revoked on success. That is fine, because it no
 * longer works anyway.
 */
export async function migrateToExpiringToken(shop: string, legacyToken: string): Promise<ShopifyTokenSet> {
  return postToken(shop, {
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: legacyToken,
    subject_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    expiring: '1',
  });
}

/**
 * Exchange an App Bridge session token for an offline access token.
 *
 * This is what makes Shopify's managed installation work. Under managed install there is
 * no authorization-code redirect for us to handle: Shopify installs the app, grants the
 * scopes declared in shopify.app.toml, and drops the merchant straight into our embedded
 * page. The first thing that page does is present a session token — and this turns that
 * token into the offline credential we need for Admin API calls.
 *
 * Why that is better than the redirect flow we had
 * ------------------------------------------------
 *   - No OAuth round trip on install, so the merchant lands in the app immediately.
 *   - Scope changes are handled by Shopify. The legacy flow needed the merchant to
 *     reinstall, and getting that wrong is what produced the "Unauthorized Access" screen
 *     when write_files was added.
 *   - No `state` nonce, no redirect allowlist, no HMAC on a callback — three things that
 *     could each be got wrong, deleted rather than defended.
 *
 * `expiring=1` for the same reason as everywhere else: non-expiring tokens are rejected
 * outright for public apps created after 1 April 2026.
 */
export async function exchangeSessionTokenForAccessToken(
  shop: string,
  sessionToken: string
): Promise<ShopifyTokenSet> {
  return postToken(shop, {
    client_id: SHOPIFY_API_KEY,
    client_secret: SHOPIFY_API_SECRET,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: sessionToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    expiring: '1',
  });
}

/**
 * True when a failed refresh means the refresh token is genuinely dead, rather than a
 * transient network / 5xx / 429 blip.
 *
 * Shopify's guidance: retry the SAME refresh token on transient failures — it replays the
 * same response for up to an hour. Only a 401, or `invalid_request`, is terminal, and then
 * the merchant has to reopen the app.
 */
export function isTerminalRefreshFailure(error: unknown): boolean {
  const e = error as TokenRequestError | undefined;
  return e?.status === 401 || e?.shopifyError === 'invalid_request';
}

// ── API version ──

/**
 * Admin API version.
 *
 * Shopify supports each version for 12 months. 2024-01 — the previous value — went out of
 * support long ago, and unsupported versions are silently served by the oldest supported
 * one, so behaviour drifts under you with no error to point at. 2026-04 is the current
 * stable release and is supported until 16 April 2027.
 */
export const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-04';

// ── GraphQL Admin API ──
//
// Everything below talks GraphQL, not REST. This is not a preference: the REST Admin API
// became a legacy API on 1 October 2024, and since 1 April 2025 **all new public apps must
// be built exclusively with the GraphQL Admin API**. The REST product endpoints this app
// used (`/products.json`) were separately deprecated in 2024-04. A REST-based public app
// fails App Store review and is on a countdown to breaking outright.

export interface GraphQLUserError {
  field?: string[] | null;
  message: string;
}

class ShopifyGraphQLError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.name = 'ShopifyGraphQLError';
    this.status = status;
  }
}

/**
 * Execute a GraphQL operation against a shop's Admin API.
 *
 * @param onUnauthorized Optional callback invoked once on a 401. Returns a replacement
 *   access token to retry with, or null to give up. This is how expiring-token refresh
 *   hooks in without this module needing to import the database — see shopify-token.ts.
 */
export async function callShopifyGraphQL<T>(
  shop: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
  onUnauthorized?: () => Promise<string | null>
): Promise<T> {
  const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const send = (token: string) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

  let response = await send(accessToken);

  // Retry exactly once on 401 with a freshly minted token. Covers a token that lapsed
  // between the proactive expiry check and this request, with no risk of a refresh loop.
  if (response.status === 401 && onUnauthorized) {
    const retryToken = await onUnauthorized();
    if (retryToken) response = await send(retryToken);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new ShopifyGraphQLError(`Shopify API error ${response.status}: ${text}`, response.status);
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };

  // GraphQL reports failures in the body with HTTP 200, so a bare response.ok check is not
  // enough — this is the classic way a GraphQL migration silently "succeeds" while doing
  // nothing. Throw on any top-level error.
  if (payload.errors?.length) {
    throw new ShopifyGraphQLError(
      `Shopify GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`
    );
  }
  if (!payload.data) {
    throw new ShopifyGraphQLError('Shopify GraphQL returned no data');
  }

  return payload.data;
}

/** Throw if a mutation returned userErrors. These are HTTP 200 + errors:[] free. */
function assertNoUserErrors(errors: GraphQLUserError[] | undefined, context: string): void {
  if (errors?.length) {
    throw new ShopifyGraphQLError(
      `${context}: ${errors.map((e) => `${(e.field ?? []).join('.')} ${e.message}`.trim()).join('; ')}`
    );
  }
}

/** Numeric id from a Shopify global id, e.g. gid://shopify/Product/123 -> "123". */
export function gidToId(gid: string): string {
  const parts = gid.split('/');
  return parts[parts.length - 1] || gid;
}

// ── Fetch Shop Info ──

const SHOP_QUERY = `
  query ShopInfo {
    shop {
      id
      name
      email
      myshopifyDomain
      primaryDomain { host }
      plan { publicDisplayName }
    }
  }
`;

export interface ShopifyShopInfo {
  id: string;
  name: string;
  domain: string;
  email: string;
  myshopify_domain: string;
  plan_display_name: string;
}

export async function fetchShopifyShop(
  shop: string,
  accessToken: string,
  onUnauthorized?: () => Promise<string | null>
): Promise<ShopifyShopInfo> {
  const data = await callShopifyGraphQL<{
    shop: {
      id: string;
      name: string;
      email: string | null;
      myshopifyDomain: string;
      primaryDomain: { host: string } | null;
      plan: { publicDisplayName: string } | null;
    };
  }>(shop, accessToken, SHOP_QUERY, undefined, onUnauthorized);

  const s = data.shop;
  return {
    id: gidToId(s.id),
    name: s.name,
    domain: s.primaryDomain?.host || s.myshopifyDomain,
    email: s.email || '',
    myshopify_domain: s.myshopifyDomain,
    plan_display_name: s.plan?.publicDisplayName || '',
  };
}

// ── Fetch Products from Shopify ──

const PRODUCTS_QUERY = `
  query SyncProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        handle
        descriptionHtml
        vendor
        productType
        tags
        featuredMedia { preview { image { url } } }
        variants(first: 1) { nodes { price } }
      }
    }
  }
`;

export interface ShopifyProductSummary {
  id: string;
  title: string;
  handle: string;
  body_html: string | null;
  image: { src: string } | null;
  variants: Array<{ price: string }>;
  vendor: string;
  product_type: string;
  tags: string;
}

/**
 * Fetch up to `limit` products, following cursors as needed.
 *
 * GraphQL caps a single `products` page at 250 nodes, so anything larger has to paginate.
 * The old REST call quietly returned at most one page; asking for more than 250 got you
 * 250 with no indication that the rest existed.
 */
export async function fetchShopifyProducts(
  shop: string,
  accessToken: string,
  limit: number = 250,
  onUnauthorized?: () => Promise<string | null>
): Promise<ShopifyProductSummary[]> {
  const out: ShopifyProductSummary[] = [];
  let after: string | null = null;

  while (out.length < limit) {
    const pageSize: number = Math.min(250, limit - out.length);
    const data: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          id: string;
          title: string;
          handle: string;
          descriptionHtml: string | null;
          vendor: string | null;
          productType: string | null;
          tags: string[];
          featuredMedia: { preview: { image: { url: string } | null } | null } | null;
          variants: { nodes: Array<{ price: string }> };
        }>;
      };
    } = await callShopifyGraphQL(
      shop,
      accessToken,
      PRODUCTS_QUERY,
      { first: pageSize, after },
      onUnauthorized
    );

    for (const p of data.products.nodes) {
      const imageUrl = p.featuredMedia?.preview?.image?.url ?? null;
      out.push({
        id: gidToId(p.id),
        title: p.title,
        handle: p.handle,
        body_html: p.descriptionHtml || null,
        image: imageUrl ? { src: imageUrl } : null,
        variants: p.variants.nodes.map((v) => ({ price: v.price })),
        vendor: p.vendor || '',
        product_type: p.productType || '',
        tags: (p.tags || []).join(', '),
      });
    }

    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor;
    if (!after) break;
  }

  return out;
}

// ── Subscription Billing ──

// Must stay in step with PLANS in src/lib/plans.ts. Duplicated rather than imported
// because plans.ts imports the database and this module deliberately does not.
const PLAN_PRICES: Record<string, number> = {
  free: 0,
  starter: 19.99,
  growth: 29.99,
  pro: 49.99,
};

export function planDisplayName(plan: string): string {
  return `ReviewMaster ${plan.charAt(0).toUpperCase() + plan.slice(1)} Plan`;
}

/** Map a Shopify subscription name back to one of our plan keys. */
export function planFromSubscriptionName(name: string): string {
  const n = name.toLowerCase();
  // Order matters: 'growth' and 'starter' must be tested before 'pro', since a name like
  // "ReviewMaster Pro Growth Plan" would otherwise resolve to the wrong tier.
  if (n.includes('growth')) return 'growth';
  if (n.includes('starter')) return 'starter';
  if (n.includes('pro')) return 'pro';
  return 'free';
}

const SUBSCRIPTION_CREATE = `
  mutation CreateSubscription(
    $name: String!
    $returnUrl: URL!
    $test: Boolean
    $trialDays: Int
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      trialDays: $trialDays
      lineItems: $lineItems
    ) {
      confirmationUrl
      appSubscription { id status }
      userErrors { field message }
    }
  }
`;

/**
 * Create a recurring app subscription and return the URL the merchant must approve.
 *
 * Replaces the REST `recurring_application_charges` flow. Two behavioural differences
 * worth knowing:
 *   - There is no separate "activate" call. Merchant approval activates the subscription;
 *     Shopify then redirects to returnUrl and fires APP_SUBSCRIPTIONS_UPDATE.
 *   - Shopify retires any existing subscription for this app when a new one is approved,
 *     so upgrades and downgrades need no explicit cancellation.
 */
export async function createRecurringCharge(
  shop: string,
  accessToken: string,
  plan: string,
  returnUrl: string,
  onUnauthorized?: () => Promise<string | null>
): Promise<string> {
  const price = PLAN_PRICES[plan] || 0;

  if (price === 0) {
    return returnUrl; // Free plan — no charge needed
  }

  // Development stores cannot be charged for real. Shopify rejects a live charge against
  // one, and the error it returns ("owned by a Shop... must be migrated to the Shopify
  // partners area") describes the wrong problem entirely, which makes it hard to diagnose.
  // Test charges behave identically through the whole approval flow but move no money.
  //
  // Opt IN to test charges, never out. This default used to be the other way round, which
  // put the quiet failure on the expensive side: a missing or misspelled app setting in
  // production meant every merchant subscribed on a test charge, no money moved, and
  // nothing anywhere said so — the flow completes, the plan activates, the merchant is
  // happy. You would find out from a payout report that never arrived.
  //
  // Inverted, the failure is loud and immediate: a live charge against a development store
  // is rejected by Shopify the first time anyone tries it, during development, by the
  // person who can fix it.
  const isTestCharge = billingTestMode();

  if (isTestCharge) {
    // Deliberately noisy. If this appears in production logs, no merchant is being billed.
    console.warn(
      `[billing] TEST charge for ${shop} on ${plan} — no money will move. ` +
        'Unset SHOPIFY_BILLING_TEST to bill for real.'
    );
  }

  const data = await callShopifyGraphQL<{
    appSubscriptionCreate: {
      confirmationUrl: string | null;
      appSubscription: { id: string; status: string } | null;
      userErrors: GraphQLUserError[];
    };
  }>(
    shop,
    accessToken,
    SUBSCRIPTION_CREATE,
    {
      name: planDisplayName(plan),
      returnUrl,
      test: isTestCharge,
      trialDays: 7,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              interval: 'EVERY_30_DAYS',
              price: { amount: price.toFixed(2), currencyCode: 'USD' },
            },
          },
        },
      ],
    },
    onUnauthorized
  );

  const result = data.appSubscriptionCreate;
  assertNoUserErrors(result.userErrors, 'appSubscriptionCreate');

  if (!result.confirmationUrl) {
    throw new ShopifyGraphQLError('Shopify did not return a confirmation URL for the subscription');
  }
  return result.confirmationUrl;
}

const ACTIVE_SUBSCRIPTIONS = `
  query CurrentSubscriptions {
    currentAppInstallation {
      activeSubscriptions { id name status test trialDays }
    }
  }
`;

export interface ActiveSubscription {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
}

/**
 * Read the app's currently ACTIVE subscriptions for this shop, straight from Shopify.
 *
 * This is the authoritative source of what a merchant is entitled to. The previous confirm
 * endpoint took the plan from a query parameter the browser controlled, which meant anyone
 * could grant themselves the enterprise plan by editing a URL. Always derive the plan from
 * what Shopify says is active.
 */
export async function fetchActiveSubscriptions(
  shop: string,
  accessToken: string,
  onUnauthorized?: () => Promise<string | null>
): Promise<ActiveSubscription[]> {
  const data = await callShopifyGraphQL<{
    currentAppInstallation: { activeSubscriptions: ActiveSubscription[] } | null;
  }>(shop, accessToken, ACTIVE_SUBSCRIPTIONS, undefined, onUnauthorized);

  return data.currentAppInstallation?.activeSubscriptions ?? [];
}

/**
 * Resolve the plan a shop is actually entitled to, according to Shopify.
 *
 * Returns 'free' when there is no active subscription — which is the correct fallback both
 * for new installs and for a subscription the merchant has cancelled.
 */
/**
 * Is this deployment billing with test charges?
 *
 * Read in two places that must never disagree: the charge we create, and the
 * entitlement we grant from it. Splitting that decision across two independent
 * expressions is what let the app open a test charge and then refuse to honour it.
 */
export function billingTestMode(): boolean {
  return (process.env.SHOPIFY_BILLING_TEST ?? 'false').toLowerCase() === 'true';
}

export async function resolveActivePlan(
  shop: string,
  accessToken: string,
  onUnauthorized?: () => Promise<string | null>
): Promise<string> {
  const subs = await fetchActiveSubscriptions(shop, accessToken, onUnauthorized);

  // `test` matters as much as `status`. A test subscription completes the entire approval
  // flow and reports ACTIVE while moving no money, so honouring one in production hands
  // out a paid plan for free — silently, because everything downstream looks exactly like
  // a genuine upgrade.
  //
  // But it is honoured when this deployment is ITSELF in billing-test mode, because then
  // a test subscription is the only kind the app can create: SHOPIFY_BILLING_TEST=true
  // stamps `test: true` on every charge it opens. Rejecting them unconditionally meant
  // the whole upgrade flow completed — approval screen, ACTIVE subscription, redirect —
  // and then resolved to 'free', which is indistinguishable from the upgrade silently
  // failing. The same flag governs both sides, so test charges can never entitle a plan
  // on a deployment that bills for real.
  const honourTestCharges = billingTestMode();
  const active = subs.find(
    (s) => s.status === 'ACTIVE' && (honourTestCharges ? true : !s.test)
  );

  if (!active && subs.some((s) => s.status === 'ACTIVE' && s.test)) {
    console.warn(
      `[billing] ${shop} has an ACTIVE test subscription but this deployment bills for ` +
        'real; treating as free. Set SHOPIFY_BILLING_TEST=true to test plan upgrades.'
    );
  }

  if (active?.test) {
    console.warn(
      `[billing] ${shop} entitled to '${planFromSubscriptionName(active.name)}' from a ` +
        'TEST subscription. No money is moving. Unset SHOPIFY_BILLING_TEST before launch.'
    );
  }

  return active ? planFromSubscriptionName(active.name) : 'free';
}

// ── Webhook Registration ──

/**
 * Map a Shopify topic to our route segment.
 *
 * This used to be `topic.replace('/', '-')`. String.replace with a string pattern only
 * swaps the FIRST occurrence, so 'app/charges/accepted' became 'app-charges/accepted' —
 * two path segments against the single [topic] slot, which 404s. Every paid upgrade
 * webhook was silently lost. replaceAll fixes all separators.
 */
export function topicToSegment(topic: string): string {
  return topic.replaceAll('/', '-');
}

/**
 * Shopify topic string -> WebhookSubscriptionTopic GraphQL enum.
 * 'products/create' -> 'PRODUCTS_CREATE'
 */
export function topicToEnum(topic: string): string {
  return topic.toUpperCase().replaceAll('/', '_');
}

const WEBHOOK_CREATE = `
  mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`;

export async function registerWebhooks(
  shop: string,
  accessToken: string,
  appUrl: string = SHOPIFY_APP_URL,
  onUnauthorized?: () => Promise<string | null>
): Promise<void> {
  // The three mandatory GDPR compliance topics (customers/data_request, customers/redact,
  // shop/redact) are NOT registered here. Shopify does not accept them via the webhook
  // API — they are configured in the Partner Dashboard under App setup > Compliance
  // webhooks. The handlers live in /api/webhooks/[topic].
  const webhookTopics = [
    'app/uninstalled',
    'products/create',
    'products/update',
    'products/delete',
    'orders/paid',
    // The whole verified-buyer story depends on this one, and it was missing.
    //
    // /api/webhooks/orders-fulfilled creates the review invitation that carries a token,
    // and only a review submitted through that token is ever marked `verified_buyer`.
    // Without the subscription the handler never fired, so no invitation was ever created
    // and no review could earn the Verified Purchase badge — the app's main differentiator,
    // silently inert.
    'orders/fulfilled',
    'shop/update',
    // Was 'app/charges/accepted', which does not exist as a GraphQL topic and mapped to a
    // 404 route. APP_SUBSCRIPTIONS_UPDATE is the real signal for a subscription being
    // approved, cancelled, declined or expired — i.e. every event that should change what
    // the merchant is entitled to.
    'app_subscriptions/update',
  ];

  for (const topic of webhookTopics) {
    try {
      const data = await callShopifyGraphQL<{
        webhookSubscriptionCreate: {
          webhookSubscription: { id: string } | null;
          userErrors: GraphQLUserError[];
        };
      }>(
        shop,
        accessToken,
        WEBHOOK_CREATE,
        {
          topic: topicToEnum(topic),
          sub: { uri: `${appUrl}/api/webhooks/${topicToSegment(topic)}`, format: 'JSON' },
        },
        onUnauthorized
      );

      // A webhook that already exists comes back as a userError, not an exception. That is
      // expected on reinstall and is not worth failing the install over — but anything
      // else should be visible in the logs rather than swallowed.
      const errs = data.webhookSubscriptionCreate.userErrors;
      if (errs?.length && !errs.some((e) => /already exists|taken/i.test(e.message))) {
        console.error(`Webhook ${topic} rejected:`, errs.map((e) => e.message).join('; '));
      }
    } catch (error) {
      console.error(`Failed to register webhook ${topic}:`, error);
    }
  }
}

export { SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL, SCOPES };
