import { db } from './db';

/**
 * Record which mechanism authenticated a store's requests.
 *
 * Why this exists
 * ---------------
 * `withAuth` has always computed `via`, and nothing ever read it. That made the one
 * question worth asking before an App Store submission unanswerable from outside: is this
 * app actually running on App Bridge session tokens, or is it quietly falling back to the
 * cookie?
 *
 * It is genuinely hard to tell by looking. The client mints a token when App Bridge is
 * present and silently omits the header when it is not; the server accepts either; the app
 * renders identically both ways. A broken session-token path looks exactly like a working
 * one right up until Shopify's automated review rejects the submission. So the answer is
 * written down where it can be read: `StoreSetting["auth.lastVia"]`.
 *
 * It is also the measurement the cookie fallback needs. That fallback is meant to be
 * temporary, and it can only be removed once no store has used it for a while — which
 * requires knowing, per store, when it was last used.
 *
 * Cost
 * ----
 * One write per store per process, not per request. The in-process memo means the steady
 * state is a Map lookup; a row is only touched when a store's mechanism actually changes,
 * which for a healthy store is once after a deploy and then never.
 *
 * A StoreSetting row rather than a column on Store, so this needs no migration and can be
 * deleted later by dropping two keys.
 */

type AuthVia = 'session_token' | 'cookie';

/** storeId → the value we last wrote. Reset on deploy, which is when we want a fresh read. */
const lastSeen = new Map<string, AuthVia>();

/**
 * Never throws and never blocks the caller's result. An authentication path that can fail
 * because a diagnostic write failed would be strictly worse than having no diagnostic.
 */
export async function noteAuthMechanism(storeId: string, via: AuthVia): Promise<void> {
  if (lastSeen.get(storeId) === via) return;

  // Set before the await, so concurrent requests during the first write do not all queue
  // up behind it. A lost write here costs nothing — the next request re-records it.
  lastSeen.set(storeId, via);

  try {
    const at = new Date().toISOString();
    await db.$transaction([
      db.storeSetting.upsert({
        where: { storeId_key: { storeId, key: 'auth.lastVia' } },
        create: { storeId, key: 'auth.lastVia', value: via },
        update: { value: via },
      }),
      db.storeSetting.upsert({
        where: { storeId_key: { storeId, key: `auth.lastSeen.${via}` } },
        create: { storeId, key: `auth.lastSeen.${via}`, value: at },
        update: { value: at },
      }),
    ]);
  } catch (error) {
    lastSeen.delete(storeId);
    console.warn('[auth] could not record the auth mechanism for', storeId, error);
  }
}
