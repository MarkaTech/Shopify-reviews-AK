import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { clientIp, checkHelpfulRateLimit } from '@/lib/rate-limit';

/**
 * "Was this review helpful?" — the vote endpoint.
 *
 * Unauthenticated, because it runs on a shopper's browser on the merchant's storefront.
 * That shapes everything below.
 *
 * On dedup, honestly
 * ------------------
 * A helpful count is a soft signal, not a security boundary — nothing is spent, granted or
 * published on the basis of it. So this does not get a database table and a device
 * identity; it gets two cheap, honest layers:
 *
 *   1. The widget remembers what this browser voted on and hides the button. That handles
 *      the accidental double-click, which is the overwhelming majority of real duplicates.
 *   2. A bounded in-memory set of (ip, review) hashes rejects repeats from the same address
 *      for an hour. It is per-instance and evaporates on restart, and someone determined
 *      can still inflate a count.
 *
 * The alternative — a votes table keyed on a fingerprint — means storing a per-shopper
 * identifier for every merchant's storefront traffic. That is a meaningful privacy cost and
 * a protected-data conversation, to slightly harden a number next to a review. Not worth it.
 *
 * The count is only ever incremented, never set, so a malformed request cannot zero a
 * review's score.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const WINDOW_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 20000;

const seen = new Map<string, number>();

function alreadyVoted(key: string): boolean {
  const now = Date.now();
  const at = seen.get(key);
  if (at && now - at < WINDOW_MS) return true;

  // Evict on write rather than on a timer: no interval to leak, and the map only grows
  // while traffic is arriving. Oldest-first so an active review is not evicted by a burst.
  if (seen.size >= MAX_ENTRIES) {
    const cutoff = now - WINDOW_MS;
    for (const [k, t] of seen) {
      if (t < cutoff) seen.delete(k);
    }
    if (seen.size >= MAX_ENTRIES) {
      const oldest = [...seen.entries()].sort((a, b) => a[1] - b[1]).slice(0, MAX_ENTRIES / 4);
      for (const [k] of oldest) seen.delete(k);
    }
  }

  seen.set(key, now);
  return false;
}

// Removed in favour of the shared helper in @/lib/rate-limit.
//
// This local copy drifted from it: the shared one strips the `:port` Azure appends to the
// forwarded address, and this one did not. So the same shopper reconnecting on a new source
// port looked like a new address and got a fresh allowance on every vote — which is the
// whole ceiling, defeated by ordinary TCP behaviour rather than by an attacker.

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: NextRequest) {
  try {
    // Volume ceiling, first.
    //
    // This is the app's other unauthenticated write endpoint and it had none — only a
    // per-(ip, review) "already voted" memo, which bounds repeat votes on ONE review and
    // nothing else. A script walking review ids could inflate helpful counts across a whole
    // store unimpeded, and helpfulness ordering is what decides which reviews a shopper
    // sees first.
    const flood = checkHelpfulRateLimit(request);
    if (!flood.allowed) {
      return NextResponse.json(
        { error: 'Too many votes just now. Please try again later.' },
        { status: 429, headers: { ...CORS, 'Retry-After': String(flood.retryAfter) } }
      );
    }

    const body = (await request.json()) as { shop?: string; reviewId?: string };
    const shop = typeof body.shop === 'string' ? body.shop.slice(0, 255) : '';
    const reviewId = typeof body.reviewId === 'string' ? body.reviewId.slice(0, 64) : '';

    if (!shop || !reviewId) {
      return NextResponse.json({ error: 'shop and reviewId are required' }, { status: 400, headers: CORS });
    }

    const store = await db.store.findUnique({
      where: { shopifyDomain: shop },
      select: { id: true, isActive: true },
    });
    if (!store || !store.isActive) {
      return NextResponse.json({ error: 'Unknown store' }, { status: 404, headers: CORS });
    }

    // Scope the lookup to the store. Without it, one merchant's storefront could vote on
    // another merchant's reviews by guessing an id.
    const review = await db.review.findFirst({
      where: { id: reviewId, storeId: store.id, isPublished: true },
      select: { id: true, helpfulCount: true },
    });
    if (!review) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404, headers: CORS });
    }

    const key = crypto
      .createHash('sha256')
      .update(`${clientIp(request)}:${reviewId}`)
      .digest('hex');

    if (alreadyVoted(key)) {
      // Report the current count rather than an error. From the shopper's point of view
      // they clicked once; a failure state here is noise.
      return NextResponse.json(
        { success: true, helpful: review.helpfulCount, counted: false },
        { headers: CORS }
      );
    }

    const updated = await db.review.update({
      where: { id: review.id },
      data: { helpfulCount: { increment: 1 } },
      select: { helpfulCount: true },
    });

    return NextResponse.json(
      { success: true, helpful: updated.helpfulCount, counted: true },
      { headers: CORS }
    );
  } catch (error) {
    console.error('[storefront/helpful]', error);
    return NextResponse.json({ error: 'Could not record that' }, { status: 500, headers: CORS });
  }
}
