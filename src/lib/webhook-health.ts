import { db } from './db';
import { registerWebhooks } from './shopify';

/**
 * Keep every store's webhook subscriptions alive.
 *
 * The failure this fixes
 * ---------------------
 * Registration used to be fired once during install and never checked again:
 *
 *   registerWebhooks(shop, accessToken).catch(console.error)
 *
 * `withAuth` only re-provisions a store when its row is missing, inactive, or has no access
 * token — none of which is true after a successful install. So one rate-limited Admin API
 * call during those few seconds meant `orders/fulfilled` was never subscribed, permanently,
 * for that merchant. No review invitation would ever be sent for them again, nothing would
 * error, and the only trace was a line in a log nobody reads. `app_subscriptions/update`
 * going the same way meant a paid upgrade would never activate.
 *
 * How this fixes it
 * -----------------
 * Success is recorded; failure is not. A store with no success marker gets another attempt
 * on the first authenticated request of every process, which means every deploy and every
 * restart is a fresh chance to heal. Nothing needs a human to notice.
 *
 * Cost is one indexed read per store per process, and only until it succeeds once. After
 * that the in-process memo answers without touching the database at all.
 */

const MARKER_KEY = 'webhooks.registeredAt';

/** storeId → known-good. Cleared on deploy, which is exactly when a retry is wanted. */
const healthy = new Set<string>();

/** Stores with a registration attempt in flight, so concurrent requests do not pile on. */
const inFlight = new Set<string>();

/**
 * Ensure webhooks are registered, without making the caller wait.
 *
 * Never throws and never blocks: it is called from the authentication path, and an
 * authentication that fails because a background repair failed would turn a recoverable
 * problem into an outage.
 */
export function ensureWebhooks(storeId: string, shop: string, accessToken: string): void {
  if (healthy.has(storeId) || inFlight.has(storeId)) return;
  inFlight.add(storeId);

  void (async () => {
    try {
      const marker = await db.storeSetting.findUnique({
        where: { storeId_key: { storeId, key: MARKER_KEY } },
        select: { id: true },
      });

      if (marker) {
        healthy.add(storeId);
        return;
      }

      await registerWebhooks(shop, accessToken);
      await markWebhooksRegistered(storeId);
      healthy.add(storeId);
      console.log('[webhooks] registered for', shop);
    } catch (err) {
      // Deliberately no marker written. The next process to serve this store tries again.
      console.error('[webhooks] registration failed for', shop, '— will retry', err);
    } finally {
      inFlight.delete(storeId);
    }
  })();
}

export async function markWebhooksRegistered(storeId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.storeSetting.upsert({
    where: { storeId_key: { storeId, key: MARKER_KEY } },
    create: { storeId, key: MARKER_KEY, value: now },
    update: { value: now },
  });
}

/**
 * Forget that a store's webhooks are healthy.
 *
 * Called on uninstall: Shopify drops the subscriptions with the installation, so the marker
 * is stale and a reinstall must register again rather than trusting a record of the
 * previous one.
 */
export async function clearWebhookRegistration(storeId: string): Promise<void> {
  healthy.delete(storeId);
  await db.storeSetting
    .deleteMany({ where: { storeId, key: MARKER_KEY } })
    .catch((err) => console.error('[webhooks] could not clear marker for', storeId, err));
}
