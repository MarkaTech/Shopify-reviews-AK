import { db } from './db';
import { registerWebhooks, listWebhookTopics, requiredWebhookTopics } from './shopify';

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
 *
 * Reconciliation
 * --------------
 * A marker proves registration once SUCCEEDED. It does not prove the subscriptions still
 * exist: a merchant or another tool can delete them from Shopify's side, and an app URL
 * change orphans them — after which the marker is a lie and the symptom is identical to
 * never having registered at all. `reconcileWebhooks` asks Shopify what is actually
 * subscribed and re-registers if anything is missing. It is deliberately NOT on the
 * authentication path: it costs an extra Admin API call, so it runs from the cron sweep
 * where latency does not matter.
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
/**
 * Backoff for stores whose registration is failing.
 *
 * `registerWebhooks` now throws when a topic does not land, which is what makes the repair
 * detectable — but it also means a store that fails keeps failing, and this function runs on
 * the AUTHENTICATION path. Without a memo, every single request from that merchant launched
 * another eight-mutation registration attempt against the Admin API: a merchant loading the
 * dashboard would fire dozens, which is how an app gets itself rate-limited and turns a
 * recoverable registration problem into a throttled one that cannot recover.
 *
 * Exponential, capped at an hour. Cleared on success, and lost on deploy along with
 * `healthy` — which is the right moment to try again anyway.
 */
const backoff = new Map<string, { attempts: number; nextTryAt: number }>();
const BACKOFF_CAP_MS = 60 * 60 * 1000;

export function ensureWebhooks(storeId: string, shop: string, accessToken: string): void {
  if (healthy.has(storeId) || inFlight.has(storeId)) return;

  const held = backoff.get(storeId);
  if (held && held.nextTryAt > Date.now()) return;

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
      backoff.delete(storeId);
      console.log('[webhooks] registered for', shop);
    } catch (err) {
      // Deliberately no marker written — the registration genuinely did not succeed, and
      // writing one here is the bug this whole module exists to prevent. But the retry is
      // now spaced: without the backoff, a failing store re-attempted on every request.
      const attempts = (backoff.get(storeId)?.attempts ?? 0) + 1;
      const delay = Math.min(BACKOFF_CAP_MS, 30_000 * 2 ** (attempts - 1));
      backoff.set(storeId, { attempts, nextTryAt: Date.now() + delay });
      console.error(
        `[webhooks] registration failed for ${shop} (attempt ${attempts}) — retrying in ` +
          `${Math.round(delay / 1000)}s`,
        err
      );
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
  // Also drop any backoff, so an operator forcing a re-register is not made to wait out a
  // hold that the previous failure set.
  backoff.delete(storeId);
  await db.storeSetting
    .deleteMany({ where: { storeId, key: MARKER_KEY } })
    .catch((err) => console.error('[webhooks] could not clear marker for', storeId, err));
}


/**
 * Ask Shopify what this shop is really subscribed to, and repair any gap.
 *
 * Returns the topics that were missing (empty when everything was already in place), so a
 * caller can log or surface it. Throws only if Shopify cannot be reached — a caller that
 * cannot tolerate that should catch.
 *
 * Re-registering is safe to repeat: an existing subscription comes back as an
 * "already exists" userError, which registerWebhooks treats as success.
 */
export async function reconcileWebhooks(
  storeId: string,
  shop: string,
  accessToken: string
): Promise<string[]> {
  const live = await listWebhookTopics(shop, accessToken);
  const missing = requiredWebhookTopics().filter((t) => !live.has(t));

  if (!missing.length) {
    // Record the check so a store verified against Shopify is distinguishable from one that
    // merely registered successfully at some point in the past.
    await markWebhooksRegistered(storeId);
    healthy.add(storeId);
    return [];
  }

  console.warn(
    `[webhooks] ${shop} is missing ${missing.length} subscription(s): ${missing.join(', ')} — re-registering`
  );
  await registerWebhooks(shop, accessToken);
  await markWebhooksRegistered(storeId);
  healthy.add(storeId);
  backoff.delete(storeId);
  return missing;
}


const RECONCILED_KEY = 'webhooks.reconciledAt';

/**
 * Reconcile a few stores' subscriptions per run, oldest-checked first.
 *
 * Called from the hourly review-request cron rather than from a schedule of its own: the
 * condition it catches (a subscription deleted at Shopify) is rare, and one extra Admin API
 * call per store is only reasonable in small batches. Five an hour covers a hundred stores
 * within a day.
 *
 * Failures for one store never stop the others, and never propagate — a store Shopify cannot
 * be reached for is simply checked again next hour.
 */
export async function reconcileSomeStores(
  batch = 5
): Promise<{ checked: number; repaired: number; topics: string[] }> {
  const { getFreshAccessTokenByStoreId } = await import('./shopify-token');

  // Oldest reconciliation first. A store with no marker at all sorts first because the
  // left join yields null, which is exactly the store most likely to need it.
  const candidates = await db.store.findMany({
    where: { isActive: true, shopifyDomain: { not: null }, accessToken: { not: null } },
    select: {
      id: true,
      shopifyDomain: true,
      settings: { where: { key: RECONCILED_KEY }, select: { value: true } },
    },
    take: 200,
  });

  const ordered = candidates
    .map((c) => ({ ...c, last: c.settings[0]?.value ? Date.parse(c.settings[0].value) : 0 }))
    .sort((a, b) => a.last - b.last)
    .slice(0, batch);

  let repaired = 0;
  const topics: string[] = [];

  for (const store of ordered) {
    if (!store.shopifyDomain) continue;
    try {
      const token = await getFreshAccessTokenByStoreId(store.id);
      const missing = await reconcileWebhooks(store.id, store.shopifyDomain, token);
      if (missing.length) {
        repaired++;
        topics.push(...missing);
      }
      await db.storeSetting.upsert({
        where: { storeId_key: { storeId: store.id, key: RECONCILED_KEY } },
        create: { storeId: store.id, key: RECONCILED_KEY, value: new Date().toISOString() },
        update: { value: new Date().toISOString() },
      });
    } catch (err) {
      console.error('[webhooks] reconciliation failed for', store.shopifyDomain, err);
    }
  }

  return { checked: ordered.length, repaired, topics: [...new Set(topics)] };
}
