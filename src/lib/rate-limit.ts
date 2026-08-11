/**
 * Request throttling for the public storefront endpoints.
 *
 * What this is for
 * ----------------
 * `/api/storefront/submit` is the only unauthenticated write path in the app. It already
 * has four defences — a honeypot, one-pending-review-per-email-per-product, plan capacity,
 * and length caps — and none of them bound VOLUME from a single source. A script posting
 * unique names and addresses satisfies every one of those checks and can bury a merchant's
 * moderation queue in an afternoon. Nothing reaches the storefront, so it is not a content
 * attack; it is a denial of the merchant's attention, which is the thing this app is
 * supposed to be saving them.
 *
 * Why in memory
 * -------------
 * The honest answer is that this is a single-instance bound, not a global one. Azure App
 * Service can scale out, and each instance would keep its own counters, so N instances
 * means N times the ceiling. Redis or a database counter would be exact.
 *
 * That trade is deliberate. A DB write on every storefront submission adds latency to the
 * one path where a shopper is waiting, and a new dependency has to be operated. The
 * realistic attack here is one script from one address, and one instance's counter stops
 * that completely. If this app ever runs at a scale where the difference matters, the
 * shape below is the same — only the store behind it changes.
 *
 * Fixed windows, not sliding
 * --------------------------
 * A fixed window lets a burst straddle a boundary and briefly double the rate. For abuse
 * control that is irrelevant, and it costs one integer per key instead of a list of
 * timestamps — which matters, because the key space is attacker-controlled.
 */

interface Bucket {
  count: number;
  /** Epoch ms at which this window ends and the count resets. */
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Bound on distinct keys held at once.
 *
 * Without it, an attacker rotating addresses grows this map until the process runs out of
 * memory — a rate limiter that becomes the outage it was added to prevent.
 */
const MAX_KEYS = 20_000;

/**
 * Overflow used to call `buckets.clear()`. That was the limiter's own off switch.
 *
 * The key space is attacker-controlled and cheap to fill: `checkSubmitRateLimit` runs
 * *before* the store lookup in the storefront submit route, so a POST with an invented
 * `shop` value mints two brand-new keys and only then 404s. Around ten thousand junk
 * requests overflowed the map, and clearing it reset every real counter in the process —
 * including the victim shop's 120-per-hour ceiling and the attacker's own per-IP bucket.
 * Loop that and a store can be review-bombed without limit.
 *
 * Evicting the oldest entries instead keeps live windows intact under the same pressure.
 * Expired buckets go first, since they are free; only if that is not enough do we drop
 * the entries closest to expiry, which are the ones with the least protection left to
 * give. An attacker can still cost us memory, but can no longer clear anyone's counter.
 */
function evictOldest(): void {
  const now = Date.now();

  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
  if (buckets.size < MAX_KEYS) return;

  // Still full: shed the soonest-to-expire tenth, so this runs rarely rather than on
  // every subsequent insert.
  const target = Math.max(1, Math.floor(MAX_KEYS / 10));
  const byExpiry = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (let i = 0; i < target && i < byExpiry.length; i++) {
    buckets.delete(byExpiry[i][0]);
  }
  console.warn(`[rate-limit] key space full — evicted ${target} soonest-to-expire buckets`);
}

function hit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    if (buckets.size >= MAX_KEYS) evictOldest();
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  existing.count += 1;
  return existing.count <= limit;
}

/** Sweep expired buckets so a quiet period releases the memory. */
function sweep(): void {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

// Node only; guarded so this module stays importable from an edge runtime. `unref` keeps
// the timer from holding the process open during a graceful shutdown.
if (typeof setInterval === 'function') {
  const timer = setInterval(sweep, 5 * 60_000);
  if (typeof timer === 'object' && timer && 'unref' in timer) {
    (timer as { unref: () => void }).unref();
  }
}

/**
 * The client's address, as far as it can be trusted.
 *
 * `x-forwarded-for` is a client-settable header everywhere except behind a proxy that
 * overwrites it — which Azure App Service does. The FIRST entry is the original client;
 * taking the last would read our own load balancer and rate-limit every shopper as one.
 *
 * A caller that spoofs the header only changes which bucket it lands in, so the worst case
 * is that a determined attacker rotates keys and gets the un-throttled rate. That is the
 * same position we were in before this existed, so the header is worth using despite not
 * being authenticated.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    // Azure appends :port to the forwarded address; strip it so a client that reconnects
    // on a new port is not treated as a new address.
    if (first) return first.replace(/:\d+$/, '');
  }
  return (
    request.headers.get('x-client-ip') ||
    request.headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the offending window resets — for a Retry-After header. */
  retryAfter: number;
}

/**
 * Two ceilings, because they catch different things.
 *
 * Per IP+shop bounds one script hammering one store. Per shop bounds a distributed run
 * that rotates addresses — that ceiling is deliberately loose, since it is shared by every
 * genuine shopper on the store and throttling real customers is a worse outcome than
 * letting a slow flood through to a moderation queue that already holds everything back.
 */
const PER_IP_LIMIT = 8;
const PER_IP_WINDOW_MS = 10 * 60_000;
const PER_SHOP_LIMIT = 120;
const PER_SHOP_WINDOW_MS = 60 * 60_000;

export function checkSubmitRateLimit(request: Request, shop: string): RateLimitResult {
  const ip = clientIp(request);

  if (!hit(`submit:${ip}:${shop}`, PER_IP_LIMIT, PER_IP_WINDOW_MS)) {
    return { allowed: false, retryAfter: Math.ceil(PER_IP_WINDOW_MS / 1000) };
  }
  if (!hit(`submit:shop:${shop}`, PER_SHOP_LIMIT, PER_SHOP_WINDOW_MS)) {
    console.warn(`[rate-limit] shop-wide submit ceiling hit for ${shop}`);
    return { allowed: false, retryAfter: Math.ceil(PER_SHOP_WINDOW_MS / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/**
 * Questions are rarer than reviews and equally unauthenticated, so they get the same
 * treatment on a tighter per-IP allowance.
 */
export function checkQuestionRateLimit(request: Request, shop: string): RateLimitResult {
  const ip = clientIp(request);
  if (!hit(`question:${ip}:${shop}`, 5, PER_IP_WINDOW_MS)) {
    return { allowed: false, retryAfter: Math.ceil(PER_IP_WINDOW_MS / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

/** Exposed for tests and for a future move to a shared store. */
export function __resetRateLimits(): void {
  buckets.clear();
}
