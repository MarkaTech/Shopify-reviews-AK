/**
 * Expiring offline access token lifecycle.
 *
 * Background
 * ----------
 * Shopify offline access tokens used to live forever. Since December 2025 they expire
 * after 60 minutes and come with a 90-day refresh token, and since 1 April 2026 expiring
 * tokens are MANDATORY for newly created public apps — this one included. Calling the
 * Admin API with a legacy non-expiring token returns:
 *
 *   403 [API] Non-expiring access tokens are no longer accepted for the Admin API.
 *              Start using expiring offline tokens
 *
 * which is exactly what was blocking every billing charge.
 *
 * What this module owns
 * ---------------------
 *  - Persisting a token set (access + refresh + both expiries), encrypted at rest.
 *  - Handing out an access token guaranteed fresh for at least REFRESH_SKEW_MS.
 *  - Proactive refresh before expiry, and reactive refresh on a 401 mid-request.
 *  - Silent one-time upgrade of legacy non-expiring tokens via token exchange.
 *
 * Why this is separate from shopify.ts: that module is the pure HTTP layer with no
 * database dependency. Keeping persistence here avoids an import cycle between the Prisma
 * client and the API caller, and lets the caller take refresh as an injected callback.
 */

import { db } from './db';
import { decryptToken, encryptToken } from './crypto';
import {
  ShopifyTokenSet,
  isTerminalRefreshFailure,
  migrateToExpiringToken,
  refreshOfflineToken,
} from './shopify';

/**
 * Refresh this long before the token actually expires.
 *
 * Shopify issues a 60-minute token. Five minutes of headroom covers clock skew between
 * Azure and Shopify plus a slow request that grabbed the token just before the boundary,
 * without churning tokens on every page load.
 */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** Thrown when the store must go back through OAuth — nothing here can fix it. */
export class ReauthRequiredError extends Error {
  status = 401;
  shop: string;
  constructor(shop: string, message?: string) {
    super(message ?? `Shopify authorization expired for ${shop}. The merchant must reopen the app.`);
    this.name = 'ReauthRequiredError';
    this.shop = shop;
  }
}

export interface StoreTokenRow {
  id: string;
  shopifyDomain: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
}

/** The columns every token operation needs. Keep in sync with StoreTokenRow. */
export const TOKEN_SELECT = {
  id: true,
  shopifyDomain: true,
  accessToken: true,
  refreshToken: true,
  tokenExpiresAt: true,
  refreshTokenExpiresAt: true,
} as const;

/**
 * Write a token set to the store row, encrypting both secrets.
 *
 * The refresh token is encrypted too. It is arguably the MORE sensitive of the pair: a
 * leaked access token grants 60 minutes, a leaked refresh token grants 90 renewable days.
 */
export async function persistTokenSet(storeId: string, tokens: ShopifyTokenSet): Promise<void> {
  await db.store.update({
    where: { id: storeId },
    data: {
      accessToken: encryptToken(tokens.accessToken),
      refreshToken: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
      tokenExpiresAt: tokens.expiresAt,
      refreshTokenExpiresAt: tokens.refreshExpiresAt,
    },
  });
}

/** True when the stored access token is expired, or close enough that we should rotate. */
export function needsRefresh(
  store: Pick<StoreTokenRow, 'tokenExpiresAt'>,
  now: number = Date.now()
): boolean {
  // A null expiry means a legacy non-expiring token. It never "expires", but Shopify
  // rejects it — that is the migration branch below, not the refresh branch.
  if (!store.tokenExpiresAt) return false;
  return store.tokenExpiresAt.getTime() - REFRESH_SKEW_MS <= now;
}

/** A legacy token is one held with no expiry and no refresh token. */
export function needsMigration(
  store: Pick<StoreTokenRow, 'tokenExpiresAt' | 'refreshToken'>
): boolean {
  return !store.tokenExpiresAt && !store.refreshToken;
}

/**
 * Serialise concurrent refreshes within this process.
 *
 * Refresh tokens are single-use. Two requests for the same store arriving together would
 * otherwise both POST the same refresh token; the second receives a token the first has
 * already invalidated, and one of them persists a dead pair. An in-flight promise map
 * collapses them onto a single refresh.
 *
 * This is per-container, not distributed — complete coverage on a single Azure B1
 * instance. If this ever scales out, Shopify's own behaviour is the safety net: it replays
 * the same response for a repeated refresh_token for up to an hour, so a cross-instance
 * race degrades to duplicate work rather than a broken store.
 */
const inFlight = new Map<string, Promise<string>>();

/**
 * Return a usable access token for a store, refreshing or migrating as required.
 *
 * The returned token is plaintext and valid for at least REFRESH_SKEW_MS.
 */
export async function getFreshAccessToken(store: StoreTokenRow): Promise<string> {
  const shop = store.shopifyDomain;
  if (!shop) throw new ReauthRequiredError('unknown', 'Store has no Shopify domain on file.');

  const current = decryptToken(store.accessToken);

  // Fast path: an expiring token, present and comfortably in date.
  if (current && store.tokenExpiresAt && !needsRefresh(store)) {
    return current;
  }

  const existing = inFlight.get(store.id);
  if (existing) return existing;

  const work = (async (): Promise<string> => {
    // ── Legacy non-expiring token: upgrade in place, no merchant interaction ──
    if (current && needsMigration(store)) {
      try {
        const migrated = await migrateToExpiringToken(shop, current);
        await persistTokenSet(store.id, migrated);
        console.info(`[token] migrated ${shop} to an expiring offline token`);
        return migrated.accessToken;
      } catch (error) {
        // The legacy token may itself already be revoked, in which case only a reinstall
        // helps. Do not fall through to refresh — there is no refresh token to use.
        console.error(`[token] migration failed for ${shop}:`, error);
        throw new ReauthRequiredError(
          shop,
          'Could not upgrade the stored Shopify token. Please reinstall the app.'
        );
      }
    }

    const refresh = decryptToken(store.refreshToken);
    if (!refresh) {
      throw new ReauthRequiredError(shop, 'No refresh token on file. Please reinstall the app.');
    }

    if (store.refreshTokenExpiresAt && store.refreshTokenExpiresAt.getTime() <= Date.now()) {
      throw new ReauthRequiredError(shop, 'Shopify authorization expired after 90 days of inactivity.');
    }

    try {
      const next = await refreshOfflineToken(shop, refresh);
      await persistTokenSet(store.id, next);
      return next.accessToken;
    } catch (error) {
      if (isTerminalRefreshFailure(error)) {
        // Clear the dead refresh token so we stop retrying it on every request.
        await db.store
          .update({
            where: { id: store.id },
            data: { refreshToken: null, refreshTokenExpiresAt: null },
          })
          .catch(() => undefined);
        throw new ReauthRequiredError(shop);
      }
      // Transient (network, 5xx, 429). Shopify replays the same response for the same
      // refresh token for up to an hour, so leaving it in place is safe and correct.
      throw error;
    }
  })().finally(() => {
    inFlight.delete(store.id);
  });

  inFlight.set(store.id, work);
  return work;
}

/** Load a store by id and return a fresh token. For webhooks and background jobs. */
export async function getFreshAccessTokenByStoreId(storeId: string): Promise<string> {
  const store = await db.store.findUnique({ where: { id: storeId }, select: TOKEN_SELECT });
  if (!store) throw new ReauthRequiredError('unknown', 'Store not found.');
  return getFreshAccessToken(store);
}

/**
 * Build the `onUnauthorized` callback that the Admin API caller uses to retry once on 401.
 *
 * Proactive refresh handles almost everything; this covers the remainder — a token revoked
 * early, or a request that outlived the skew window. Returns null when re-auth is the only
 * option, which tells the caller to surface the original 401 rather than loop.
 */
export function tokenRefresherFor(storeId: string): () => Promise<string | null> {
  return async () => {
    try {
      const store = await db.store.findUnique({ where: { id: storeId }, select: TOKEN_SELECT });
      if (!store?.shopifyDomain) return null;
      const shop = store.shopifyDomain;

      // Force a refresh even if the stored expiry still looks valid — the 401 is the
      // authoritative signal that it is not.
      const refresh = decryptToken(store.refreshToken);
      if (refresh) {
        const next = await refreshOfflineToken(shop, refresh);
        await persistTokenSet(storeId, next);
        return next.accessToken;
      }

      const legacy = decryptToken(store.accessToken);
      if (legacy && needsMigration(store)) {
        const migrated = await migrateToExpiringToken(shop, legacy);
        await persistTokenSet(storeId, migrated);
        return migrated.accessToken;
      }

      return null;
    } catch (error) {
      console.error(`[token] reactive refresh failed for store ${storeId}:`, error);
      return null;
    }
  };
}
