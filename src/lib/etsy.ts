import crypto from 'crypto';
import { db } from './db';
import { encryptToken, decryptToken } from './crypto';

/**
 * Etsy review sync — the one genuinely new import source worth having.
 *
 * Why Etsy is different from AliExpress
 * -------------------------------------
 * These are the merchant's OWN sales on their own Etsy shop — the same seller, often the
 * same handmade product, sold on a second channel. Etsy exposes them through a real,
 * documented, authenticated API (Open API v3), not a scraped endpoint. That is why
 * Judge.me marks Etsy-synced reviews verified while marking every other import
 * unverified. We store them as `verified_reviewer`: a real purchase happened and Etsy
 * vouches for it, but there is no Shopify order to point at, and `verified_buyer` is
 * reserved for exactly that.
 *
 * The honest limitation
 * ---------------------
 * Etsy has no equivalent of a public app store install: API access needs the MERCHANT's
 * own Etsy developer keystring (etsy.com/developers, a short approval). So v1 is
 * bring-your-own-key: paste keystring + shop, click Connect, approve on Etsy, sync. A
 * shared ReviewMaster Etsy app can replace the keystring step later without changing
 * anything below.
 *
 * Tokens are encrypted at rest with the same helper as the Shopify access token. The
 * OAuth flow is authorization-code + PKCE, per Etsy v3.
 */

const K = {
  keystring: 'etsy.keystring',
  shopId: 'etsy.shopId',
  access: 'etsy.accessTokenEnc',
  refresh: 'etsy.refreshTokenEnc',
  expiresAt: 'etsy.tokenExpiresAt',
  verifier: 'etsy.pkceVerifier',
  lastSyncAt: 'etsy.lastSyncAt',
} as const;

// Reviews come with the listing they belong to; listings_r covers resolving them.
// transactions_r is included because review payloads reference transactions.
const SCOPES = 'shops_r listings_r transactions_r';

async function setting(storeId: string, key: string): Promise<string | null> {
  const row = await db.storeSetting.findUnique({
    where: { storeId_key: { storeId, key } },
    select: { value: true },
  });
  return row?.value ?? null;
}

async function putSetting(storeId: string, key: string, value: string): Promise<void> {
  await db.storeSetting.upsert({
    where: { storeId_key: { storeId, key } },
    create: { storeId, key, value },
    update: { value },
  });
}

export class EtsyError extends Error {
  merchantMessage: string;
  constructor(merchantMessage: string, detail?: string) {
    super(detail || merchantMessage);
    this.name = 'EtsyError';
    this.merchantMessage = merchantMessage;
  }
}

// ── OAuth (authorization code + PKCE) ──

export async function beginEtsyConnect(
  storeId: string,
  keystring: string,
  shopInput: string,
  appUrl: string
): Promise<string> {
  const key = keystring.trim();
  if (!/^[a-z0-9]{10,40}$/i.test(key)) {
    throw new EtsyError('That does not look like an Etsy keystring. Copy it from etsy.com/developers → Your apps.');
  }
  const shop = shopInput.trim();
  if (!shop) throw new EtsyError('Enter your Etsy shop ID or shop name.');

  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(24).toString('base64url');

  // The state nonce rides the OAuthNonce table (10-minute expiry) with a namespaced
  // shop column, so the public callback can find the store without trusting the caller.
  await db.oAuthNonce.create({
    data: { nonce: state, shop: `etsy:${storeId}`, expiresAt: new Date(Date.now() + 600_000) },
  });
  await putSetting(storeId, K.keystring, key);
  await putSetting(storeId, K.shopId, shop);
  await putSetting(storeId, K.verifier, verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: key,
    redirect_uri: `${appUrl.replace(/\/$/, '')}/api/etsy/callback`,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `https://www.etsy.com/oauth/connect?${params}`;
}

export async function completeEtsyConnect(
  storeId: string,
  code: string,
  appUrl: string
): Promise<void> {
  const keystring = await setting(storeId, K.keystring);
  const verifier = await setting(storeId, K.verifier);
  if (!keystring || !verifier) throw new EtsyError('The connection attempt has expired. Start again from the Import page.');

  const res = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: keystring,
      redirect_uri: `${appUrl.replace(/\/$/, '')}/api/etsy/callback`,
      code,
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new EtsyError(
      'Etsy rejected the connection. Check the keystring, and that your Etsy app lists this exact callback URL.',
      `token exchange ${res.status}: ${body.slice(0, 300)}`
    );
  }
  const tokens = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new EtsyError('Etsy returned an incomplete token response. Try connecting again.');
  }

  await putSetting(storeId, K.access, encryptToken(tokens.access_token));
  await putSetting(storeId, K.refresh, encryptToken(tokens.refresh_token));
  await putSetting(storeId, K.expiresAt, String(Date.now() + (tokens.expires_in ?? 3600) * 1000));
  // One-time verifier, spent.
  await db.storeSetting.deleteMany({ where: { storeId, key: K.verifier } });
}

async function accessTokenFor(storeId: string): Promise<{ token: string; keystring: string }> {
  const keystring = await setting(storeId, K.keystring);
  const refreshEnc = await setting(storeId, K.refresh);
  if (!keystring || !refreshEnc) throw new EtsyError('Etsy is not connected yet.');

  const expiresAt = Number((await setting(storeId, K.expiresAt)) ?? 0);
  const accessEnc = await setting(storeId, K.access);
  if (accessEnc && Date.now() < expiresAt - 120_000) {
    const cached = decryptToken(accessEnc);
    if (cached) return { token: cached, keystring };
    // An undecryptable token (rotated TOKEN_ENCRYPTION_KEY) falls through to a refresh.
  }

  const res = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: keystring,
      refresh_token: decryptToken(refreshEnc),
    }),
  });
  if (!res.ok) {
    throw new EtsyError(
      'Etsy needs to be reconnected — the stored authorisation has expired or been revoked.',
      `refresh ${res.status}`
    );
  }
  const tokens = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!tokens.access_token) throw new EtsyError('Etsy needs to be reconnected.');
  await putSetting(storeId, K.access, encryptToken(tokens.access_token));
  if (tokens.refresh_token) await putSetting(storeId, K.refresh, encryptToken(tokens.refresh_token));
  await putSetting(storeId, K.expiresAt, String(Date.now() + (tokens.expires_in ?? 3600) * 1000));
  return { token: tokens.access_token, keystring };
}

async function etsyGet<T>(storeId: string, path: string): Promise<T> {
  const { token, keystring } = await accessTokenFor(storeId);
  const res = await fetch(`https://openapi.etsy.com/v3/application${path}`, {
    headers: { 'x-api-key': keystring, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new EtsyError(
      `Etsy returned an error (HTTP ${res.status}). If this persists, reconnect from the Import page.`,
      `${path} -> ${res.status}: ${body.slice(0, 300)}`
    );
  }
  return (await res.json()) as T;
}

/** Resolve a shop name to its numeric id; numeric input passes through. */
async function resolveShopId(storeId: string): Promise<string> {
  const raw = (await setting(storeId, K.shopId)) ?? '';
  if (/^\d+$/.test(raw)) return raw;
  const found = await etsyGet<{ count: number; results?: Array<{ shop_id: number; shop_name: string }> }>(
    storeId,
    `/shops?shop_name=${encodeURIComponent(raw)}&limit=1`
  );
  const id = found.results?.[0]?.shop_id;
  if (!id) throw new EtsyError(`No Etsy shop named "${raw}" was found. Use the numeric shop ID from your Etsy shop settings instead.`);
  await putSetting(storeId, K.shopId, String(id));
  return String(id);
}

// ── Sync ──

interface EtsyReview {
  listing_id?: number;
  transaction_id?: number;
  rating?: number;
  review?: string;
  language?: string;
  image_url_fullxfull?: string;
  create_timestamp?: number;
  created_timestamp?: number;
}

export interface EtsySyncResult {
  fetched: number;
  imported: number;
  skippedExisting: number;
  skippedUnmatched: number;
  unmatchedListings: number;
}

export async function isEtsyConnected(storeId: string): Promise<{ connected: boolean; shopId: string | null; lastSyncAt: string | null }> {
  const refresh = await setting(storeId, K.refresh);
  return {
    connected: !!refresh,
    shopId: await setting(storeId, K.shopId),
    lastSyncAt: await setting(storeId, K.lastSyncAt),
  };
}

/**
 * Pull the shop's reviews and attach them to matching products.
 *
 * Listing→product matching is by exact (case-insensitive) title in v1 — the common case
 * for a merchant selling the same items on both channels. Reviews on unmatched listings
 * are counted and reported, not silently dropped, so the merchant knows to align titles.
 */
export async function syncEtsyReviews(storeId: string): Promise<EtsySyncResult> {
  const shopId = await resolveShopId(storeId);

  // Listing titles for matching.
  const listings = await etsyGet<{ results?: Array<{ listing_id: number; title: string }> }>(
    storeId,
    `/shops/${shopId}/listings/active?limit=100`
  );
  const products = await db.product.findMany({
    where: { storeId },
    select: { id: true, title: true },
  });
  const byTitle = new Map(products.map((p) => [p.title.trim().toLowerCase(), p.id]));
  const listingToProduct = new Map<number, string>();
  for (const l of listings.results ?? []) {
    const match = byTitle.get(l.title.trim().toLowerCase());
    if (match) listingToProduct.set(l.listing_id, match);
  }

  // Reviews, paginated.
  const all: EtsyReview[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const page = await etsyGet<{ count?: number; results?: EtsyReview[] }>(
      storeId,
      `/shops/${shopId}/reviews?limit=100&offset=${offset}`
    );
    const results = page.results ?? [];
    all.push(...results);
    if (results.length < 100) break;
  }

  // Dedup on Etsy transaction id, which is stable per review.
  const txIds = all.map((r) => String(r.transaction_id ?? '')).filter(Boolean);
  const existing = await db.review.findMany({
    where: { storeId, source: 'etsy', sourceProductId: { in: txIds } },
    select: { sourceProductId: true },
  });
  const known = new Set(existing.map((e) => e.sourceProductId));

  let imported = 0;
  let skippedExisting = 0;
  let skippedUnmatched = 0;

  for (const r of all) {
    const tx = String(r.transaction_id ?? '');
    const rating = Math.round(Number(r.rating ?? 0));
    if (!tx || rating < 1 || rating > 5) continue;
    if (known.has(tx)) { skippedExisting++; continue; }

    const productId = r.listing_id ? listingToProduct.get(r.listing_id) ?? null : null;
    if (!productId) { skippedUnmatched++; continue; }

    const ts = (r.create_timestamp ?? r.created_timestamp ?? 0) * 1000;
    await db.review.create({
      data: {
        storeId,
        productId,
        reviewerName: 'Etsy Customer',
        rating,
        body: String(r.review ?? '').trim(),
        images: r.image_url_fullxfull?.startsWith('https://') ? JSON.stringify([r.image_url_fullxfull]) : null,
        source: 'etsy',
        sourceProductId: tx,
        sourceUrl: r.listing_id ? `https://www.etsy.com/listing/${r.listing_id}` : null,
        // A real Etsy purchase vouched for by Etsy's API — but not a Shopify order, so
        // never verified_buyer.
        verificationStatus: 'verified_reviewer',
        verifiedPurchase: false,
        isPublished: true,
        ...(ts > 0 && ts < Date.now() ? { reviewDate: new Date(ts) } : {}),
      },
    });
    known.add(tx);
    imported++;
  }

  await putSetting(storeId, K.lastSyncAt, new Date().toISOString());

  const matchedListingIds = new Set(listingToProduct.keys());
  const unmatchedListings = (listings.results ?? []).filter((l) => !matchedListingIds.has(l.listing_id)).length;

  return { fetched: all.length, imported, skippedExisting, skippedUnmatched, unmatchedListings };
}

/** Stores due a background resync: connected, and last synced more than ~7 days ago. */
export async function storesDueEtsySync(): Promise<string[]> {
  const connected = await db.storeSetting.findMany({
    where: { key: 'etsy.refreshTokenEnc' },
    select: { storeId: true },
  });
  const due: string[] = [];
  for (const { storeId } of connected) {
    const last = await setting(storeId, K.lastSyncAt);
    if (!last || Date.now() - new Date(last).getTime() > 6.5 * 86_400_000) due.push(storeId);
  }
  return due;
}
