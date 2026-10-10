/**
 * Offline tests for the Review highlights box and "See more" paging on the public
 * storefront endpoint.
 *
 * The selection rules (src/lib/storefront-reviews.ts) directly, then GET
 * /api/storefront/reviews against an in-process stand-in for the database client that
 * understands exactly the filters the route uses. Nothing connects and nothing is written.
 * No network. Run with:
 *
 *   npx --yes bun@latest run tests/highlights.test.ts
 *
 * The box sits beside Add to cart, so the rules that matter most are the ones a shopper
 * would read as a claim: published reviews only, never one twice, and never a review of
 * a different product passed off as a review of this one.
 */

import assert from 'node:assert';
import {
  pickHighlights,
  parseHighlightSource,
  clampHighlightLimit,
  parseOffset,
  isQuotable,
  MIN_QUOTE_LENGTH,
  RANDOM_POOL,
  MAX_OFFSET,
  type HighlightCandidate,
} from '../src/lib/storefront-reviews';
import { db } from '../src/lib/db';

const { NextRequest } = await import('next/server');
const route = await import('../src/app/api/storefront/reviews/route');

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);
const section = (title: string) => tests.push([`\n${title}`, () => {}]);

// ── Fixtures ───────────────────────────────────────────────────────────────────────

const LONG = 'Beautiful finish, heavier than expected, and it arrived well packed.';
assert.ok(LONG.length >= MIN_QUOTE_LENGTH);

let seq = 0;
/** A candidate, newest-first by creation order unless a date is given. */
function cand(over: Partial<HighlightCandidate> = {}): HighlightCandidate {
  seq++;
  return {
    id: `r${String(seq).padStart(3, '0')}`,
    productId: 'P',
    rating: 5,
    title: null,
    body: LONG,
    isFeatured: false,
    isPublished: true,
    reviewDate: new Date(Date.UTC(2026, 0, 1) + seq * 60_000),
    ...over,
  };
}
const ids = (rs: Array<{ id: string }>) => rs.map((r) => r.id);

/** A deterministic generator, so "random" is repeatable. mulberry32. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Parameters ─────────────────────────────────────────────────────────────────────

section('Parameters: source, limit, offset');

test('an unknown or missing source is featured', () => {
  assert.strictEqual(parseHighlightSource('featured'), 'featured');
  assert.strictEqual(parseHighlightSource('random'), 'random');
  assert.strictEqual(parseHighlightSource('latest'), 'latest');
  for (const bad of [null, undefined, '', 'best', 'FEATURED', 'random ', '__proto__']) {
    assert.strictEqual(parseHighlightSource(bad), 'featured', String(bad));
  }
});

test('the highlights limit is a whole number in 1..12, default 6', () => {
  assert.strictEqual(clampHighlightLimit(null), 6);
  assert.strictEqual(clampHighlightLimit(''), 6);
  assert.strictEqual(clampHighlightLimit('abc'), 6);
  assert.strictEqual(clampHighlightLimit('0'), 1);
  assert.strictEqual(clampHighlightLimit('-4'), 1);
  assert.strictEqual(clampHighlightLimit('3'), 3);
  assert.strictEqual(clampHighlightLimit('3.9'), 3);
  assert.strictEqual(clampHighlightLimit('99'), 12);
  assert.strictEqual(clampHighlightLimit(12), 12);
});

test('offset: absent or unreadable is null, so the request is answered as a page', () => {
  for (const raw of [null, undefined, '', '  ', 'abc', 'NaN', 'Infinity']) {
    assert.strictEqual(parseOffset(raw), null, String(raw));
  }
});

test('offset: a whole number from 0 to MAX_OFFSET', () => {
  assert.strictEqual(parseOffset('0'), 0);
  assert.strictEqual(parseOffset('15'), 15);
  assert.strictEqual(parseOffset('7.9'), 7);
  assert.strictEqual(parseOffset('-5'), 0);
  // A skip outside a 32-bit integer is a Prisma validation error, which was a 500.
  assert.strictEqual(parseOffset('1e20'), MAX_OFFSET);
  assert.ok(MAX_OFFSET <= 2 ** 31 - 1);
});

// ── Selection ──────────────────────────────────────────────────────────────────────

section('pickHighlights: featured');

test("the merchant's featured reviews come first, this product's before the store's", () => {
  const ownFeatured = cand({ isFeatured: true });
  const storeFeatured = cand({ isFeatured: true, productId: 'Q' });
  const ownQuotable = cand();
  const storeQuotable = cand({ productId: 'Q' });
  const out = pickHighlights([storeQuotable, ownQuotable, storeFeatured, ownFeatured], {
    source: 'featured', limit: 6, productId: 'P',
  });
  assert.deepStrictEqual(ids(out), ids([ownFeatured, storeFeatured, ownQuotable, storeQuotable]));
});

test('featured reviews of either kind are newest first within their tier', () => {
  const older = cand({ isFeatured: true });
  const newer = cand({ isFeatured: true });
  const out = pickHighlights([older, newer], { source: 'featured', limit: 6, productId: 'P' });
  assert.deepStrictEqual(ids(out), ids([newer, older]));
});

test('no top-up while the featured reviews fill the box', () => {
  const featured = [cand({ isFeatured: true }), cand({ isFeatured: true })];
  const out = pickHighlights([...featured, cand(), cand()], { source: 'featured', limit: 2, productId: 'P' });
  assert.deepStrictEqual(ids(out).sort(), ids(featured).sort());
});

test('a featured review is shown whatever its rating or length: the merchant chose it', () => {
  const short = cand({ isFeatured: true, rating: 3, body: 'Lovely.' });
  assert.deepStrictEqual(ids(pickHighlights([short], { source: 'featured', limit: 6, productId: 'P' })), [short.id]);
});

test('a featured review with nothing to quote is skipped (the widget would drop it)', () => {
  const blank = cand({ isFeatured: true, body: '   \n  ', title: null });
  const titled = cand({ isFeatured: true, body: '', title: 'Worth every rupee' });
  assert.deepStrictEqual(ids(pickHighlights([blank, titled], { source: 'featured', limit: 6, productId: 'P' })), [titled.id]);
});

test('the top-up is 4-5 stars with at least 40 characters, this product before the store', () => {
  const three = cand({ rating: 3 });
  const short = cand({ body: 'Great product, fast shipping!' });
  const padded = cand({ body: `Nice${' '.repeat(80)}idol` });
  const ownFour = cand({ rating: 4 });
  const storeFive = cand({ productId: 'Q' });
  const out = pickHighlights([three, short, padded, ownFour, storeFive], {
    source: 'featured', limit: 6, productId: 'P',
  });
  assert.deepStrictEqual(ids(out), ids([ownFour, storeFive]));
});

test('the 40-character rule counts text as shown: whitespace runs collapse, ends trim', () => {
  const exactly = 'x'.repeat(MIN_QUOTE_LENGTH);
  assert.ok(isQuotable({ rating: 5, body: exactly }));
  assert.ok(!isQuotable({ rating: 5, body: exactly.slice(1) }));
  assert.ok(!isQuotable({ rating: 5, body: `  ${exactly.slice(1)}  \n\n` }));
  assert.ok(!isQuotable({ rating: 3, body: LONG }));
  assert.ok(isQuotable({ rating: 4, body: LONG }));
});

section('pickHighlights: always');

test('never a review twice, even when it is in two pools or matches two tiers', () => {
  const both = cand({ isFeatured: true }); // featured AND quotable
  const out = pickHighlights([both, { ...both }, both, cand()], { source: 'featured', limit: 6, productId: 'P' });
  assert.strictEqual(new Set(ids(out)).size, out.length);
  assert.strictEqual(out.filter((r) => r.id === both.id).length, 1);
});

test('published only, for every source', () => {
  const hidden = cand({ isPublished: false, isFeatured: true });
  const hiddenStore = cand({ isPublished: false, productId: 'Q' });
  for (const source of ['featured', 'random', 'latest'] as const) {
    const out = pickHighlights([hidden, hiddenStore], { source, limit: 6, productId: 'P', random: seeded(1) });
    assert.deepStrictEqual(out, [], source);
  }
});

test('the limit is clamped to 1..12', () => {
  const many = Array.from({ length: 30 }, () => cand());
  assert.strictEqual(pickHighlights(many, { source: 'latest', limit: 99, productId: 'P' }).length, 12);
  assert.strictEqual(pickHighlights(many, { source: 'latest', limit: 0, productId: 'P' }).length, 1);
  assert.strictEqual(pickHighlights(many, { source: 'latest', limit: Number.NaN, productId: 'P' }).length, 6);
});

test('on a product page a store review with no product is left out: nothing could name it', () => {
  const detached = cand({ productId: null, isFeatured: true });
  const named = cand({ productId: 'Q' });
  for (const source of ['featured', 'random', 'latest'] as const) {
    const out = pickHighlights([detached, named], { source, limit: 6, productId: 'P', random: seeded(2) });
    assert.deepStrictEqual(ids(out), [named.id], source);
  }
  // A product not synced yet: no local id, but still a product page.
  const unsynced = pickHighlights([detached, named], { source: 'featured', limit: 6, productId: null, productPage: true });
  assert.deepStrictEqual(ids(unsynced), [named.id]);
});

test('off a product page (the home page) every published review may be shown', () => {
  const detached = cand({ productId: null, isFeatured: true });
  const named = cand({ productId: 'Q' });
  const out = pickHighlights([detached, named], { source: 'featured', limit: 6, productId: null });
  assert.deepStrictEqual(ids(out), [detached.id, named.id]);
});

section('pickHighlights: latest and random');

test("latest: the newest quotable reviews, this product's first", () => {
  const ownOld = cand();
  const storeNew = cand({ productId: 'Q' });
  const ownNew = cand();
  const featuredShort = cand({ isFeatured: true, body: 'Ok' });
  const out = pickHighlights([ownOld, storeNew, ownNew, featuredShort], { source: 'latest', limit: 6, productId: 'P' });
  assert.deepStrictEqual(ids(out), ids([ownNew, ownOld, storeNew]));
});

test('random: drawn through the injected generator, and repeatable with it', () => {
  const pool = Array.from({ length: 20 }, () => cand());
  const a = pickHighlights(pool, { source: 'random', limit: 5, productId: 'P', random: seeded(7) });
  const b = pickHighlights(pool, { source: 'random', limit: 5, productId: 'P', random: seeded(7) });
  assert.deepStrictEqual(ids(a), ids(b));
  let calls = 0;
  pickHighlights(pool, { source: 'random', limit: 5, productId: 'P', random: () => { calls++; return 0.5; } });
  assert.ok(calls > 0, 'the generator was never asked');
  const others = new Set<string>();
  for (let s = 0; s < 20; s++) {
    others.add(ids(pickHighlights(pool, { source: 'random', limit: 5, productId: 'P', random: seeded(s) })).join());
  }
  assert.ok(others.size > 1, 'every seed gave the same sample');
});

test('random: only from the newest 60 quotable reviews of this product when it has enough', () => {
  const pool = Array.from({ length: RANDOM_POOL + 15 }, () => cand());
  const oldest = new Set(ids(pool.slice(0, 15)));
  const store = cand({ productId: 'Q' });
  for (let s = 0; s < 200; s++) {
    const out = pickHighlights([...pool, store], { source: 'random', limit: 12, productId: 'P', random: seeded(s) });
    assert.strictEqual(out.length, 12);
    assert.strictEqual(new Set(ids(out)).size, 12);
    for (const r of out) {
      assert.ok(!oldest.has(r.id), `${r.id} is older than the newest ${RANDOM_POOL}`);
      assert.strictEqual(r.productId, 'P', 'a store review was drawn while the product had enough');
    }
  }
});

test("random: a product short of the limit keeps all its own and samples the store's", () => {
  const own = [cand(), cand()];
  const store = Array.from({ length: 10 }, () => cand({ productId: 'Q' }));
  const unquotable = cand({ rating: 2 });
  const out = pickHighlights([...own, ...store, unquotable], { source: 'random', limit: 6, productId: 'P', random: seeded(3) });
  assert.strictEqual(out.length, 6);
  for (const r of own) assert.ok(ids(out).includes(r.id));
  assert.ok(!ids(out).includes(unquotable.id));
  assert.strictEqual(new Set(ids(out)).size, 6);
});

test('random: a generator that returns exactly 1 still yields real reviews', () => {
  const pool = Array.from({ length: 8 }, () => cand());
  const out = pickHighlights(pool, { source: 'random', limit: 5, productId: 'P', random: () => 1 });
  assert.strictEqual(out.length, 5);
  assert.ok(out.every(Boolean));
  assert.strictEqual(new Set(ids(out)).size, 5);
});

// ── The route, against a stand-in database ─────────────────────────────────────────

type Row = Record<string, unknown> & { id: string; productId: string | null };

const PRODUCTS: Record<string, { id: string; shopifyId: string; title: string }> = {
  P: { id: 'P', shopifyId: '111', title: 'Adiyogi Divine Idol' },
  Q: { id: 'Q', shopifyId: '222', title: 'Brass Diya' },
};

function row(over: Partial<Row> & { id: string }): Row {
  return {
    storeId: 'S',
    productId: 'P',
    reviewerName: 'Priya',
    reviewerEmail: 'priya@example.com',
    reviewerLocation: 'Pune',
    shopifyOrderId: '9001',
    rating: 5,
    title: null,
    body: LONG,
    images: null,
    videoUrl: null,
    reviewDate: new Date('2026-09-01T00:00:00Z'),
    verificationStatus: 'verified_buyer',
    verifiedPurchase: true,
    isIncentivized: false,
    helpfulCount: 0,
    reply: null,
    repliedAt: null,
    source: 'direct',
    isFeatured: false,
    isPublished: true,
    isPinned: false,
    ...over,
  };
}

/** SQL three-valued logic for the handful of filters the route builds. */
function matches(r: Row, where: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(where)) {
    const value = r[key];
    if (key === 'NOT') {
      const inner = cond as Record<string, unknown>;
      // NOT (x = v) is NULL, so false, when x is NULL.
      if (Object.entries(inner).some(([f, v]) => r[f] === null && v !== null)) return false;
      if (matches(r, inner)) return false;
      continue;
    }
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ('not' in c) {
        if (c.not === null ? value === null : value === null || value === c.not) return false;
      } else if ('gte' in c) {
        if (!((value as number) >= (c.gte as number))) return false;
      } else {
        throw new Error(`stand-in does not understand the filter on ${key}: ${JSON.stringify(c)}`);
      }
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

function project(r: Row, select: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(select)) {
    if (k === 'product') {
      const p = r.productId ? PRODUCTS[r.productId] : null;
      out.product = p ? { title: p.title } : null;
    } else if (v === true) {
      out[k] = r[k];
    }
  }
  return out;
}

function order(rows: Row[], orderBy: Array<Record<string, 'asc' | 'desc'>>): Row[] {
  return rows.slice().sort((a, b) => {
    for (const o of orderBy) {
      const [k, dir] = Object.entries(o)[0];
      const x = a[k] instanceof Date ? (a[k] as Date).getTime() : (a[k] as number | string | boolean);
      const y = b[k] instanceof Date ? (b[k] as Date).getTime() : (b[k] as number | string | boolean);
      if (x === y) continue;
      return (x < y ? -1 : 1) * (dir === 'asc' ? 1 : -1);
    }
    return 0;
  });
}

interface FindManyArgs {
  where: Record<string, unknown>;
  orderBy: Array<Record<string, 'asc' | 'desc'>>;
  skip?: number;
  take: number;
  select: Record<string, unknown>;
}

let findManyCalls: FindManyArgs[] = [];

function stubDb(rows: Row[]) {
  findManyCalls = [];
  const stubs: Record<string, unknown> = {
    store: { findUnique: async () => ({ id: 'S', isActive: true, plan: 'free' }) },
    storeSetting: { findMany: async () => [] },
    widgetConfig: { findMany: async () => [] },
    productRating: { findUnique: async () => null },
    product: {
      findUnique: async ({ where }: { where: { storeId_shopifyId: { shopifyId: string } } }) => {
        const p = Object.values(PRODUCTS).find((x) => x.shopifyId === where.storeId_shopifyId.shopifyId);
        return p ? { id: p.id, title: p.title, image: null, handle: null } : null;
      },
    },
    review: {
      findMany: async (args: FindManyArgs) => {
        findManyCalls.push(args);
        const hit = order(rows.filter((r) => matches(r, args.where)), args.orderBy);
        return hit.slice(args.skip ?? 0, (args.skip ?? 0) + args.take).map((r) => project(r, args.select));
      },
      count: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where)).length,
    },
  };
  for (const [model, stub] of Object.entries(stubs)) {
    Object.defineProperty(db, model, { value: stub, configurable: true, writable: true });
  }
}

async function get(query: string) {
  const res = await route.GET(new NextRequest(`https://app.example.com/api/storefront/reviews?shop=s.myshopify.com&${query}`));
  return { res, json: (await res.json()) as Record<string, any> };
}

const day = (d: number) => new Date(Date.UTC(2026, 8, d));

/** A product with one featured review and two quotable, and a store around it. */
function storeRows(): Row[] {
  return [
    row({ id: 'own-featured', isFeatured: true, reviewDate: day(1) }),
    row({ id: 'own-new', reviewDate: day(9) }),
    row({ id: 'own-old', reviewDate: day(2) }),
    row({ id: 'own-hidden', isPublished: false, isFeatured: true, reviewDate: day(10) }),
    row({ id: 'own-short', body: 'Good', reviewDate: day(11) }),
    row({ id: 'diya-featured', productId: 'Q', isFeatured: true, reviewDate: day(5) }),
    row({ id: 'diya', productId: 'Q', reviewDate: day(8) }),
    row({ id: 'detached', productId: null, reviewDate: day(12) }),
    row({ id: 'other-store', storeId: 'T', isFeatured: true, reviewDate: day(13) }),
  ];
}

section('GET ?highlights=1');

test('featured, product page: own featured, store featured, then the top-up, each once', async () => {
  stubDb(storeRows());
  const { res, json } = await get('highlights=1&product_id=111&limit=6');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(Object.keys(json).sort(), ['config', 'highlights', 'total']);
  assert.deepStrictEqual(json.highlights.map((h: { id: string }) => h.id), ['own-featured', 'diya-featured', 'own-new', 'own-old', 'diya']);
  assert.strictEqual(json.total, json.highlights.length);
});

test("productTitle names the store's reviews and is null for this product's own", async () => {
  stubDb(storeRows());
  const { json } = await get('highlights=1&product_id=111');
  const byId = Object.fromEntries(json.highlights.map((h: { id: string }) => [h.id, h]));
  assert.strictEqual(byId['own-featured'].productTitle, null);
  assert.strictEqual(byId['own-new'].productTitle, null);
  assert.strictEqual(byId['diya-featured'].productTitle, 'Brass Diya');
  assert.strictEqual(byId['diya'].productTitle, 'Brass Diya');
});

test('off a product page every review with a product is named, and a detached one may show', async () => {
  stubDb(storeRows());
  const { json } = await get('highlights=1&source=latest&limit=12');
  const byId = Object.fromEntries(json.highlights.map((h: { id: string }) => [h.id, h]));
  assert.strictEqual(byId['own-new'].productTitle, 'Adiyogi Divine Idol');
  assert.ok('detached' in byId);
  assert.strictEqual(byId['detached'].productTitle, null);
  assert.ok(!('other-store' in byId), "another store's review leaked in");
});

test('a highlight is exactly a list review plus productTitle, and carries nothing private', async () => {
  stubDb(storeRows());
  const listed = (await get('product_id=111&limit=50')).json.reviews[0];
  const highlighted = (await get('highlights=1&product_id=111')).json.highlights[0];
  assert.deepStrictEqual(Object.keys(highlighted), [...Object.keys(listed), 'productTitle']);
  for (const h of [listed, highlighted]) {
    const text = JSON.stringify(h);
    assert.ok(!text.includes('priya@example.com'), 'reviewer email went out');
    assert.ok(!text.includes('9001'), 'order id went out');
    for (const k of ['reviewerEmail', 'shopifyOrderId', 'isFeatured', 'isPublished', 'productId', 'product']) {
      assert.ok(!(k in h), `${k} went out`);
    }
  }
});

test('same CORS and cache headers as the list', async () => {
  stubDb(storeRows());
  const list = (await get('product_id=111')).res.headers;
  const box = (await get('highlights=1&product_id=111')).res.headers;
  for (const h of ['Access-Control-Allow-Origin', 'Access-Control-Allow-Methods', 'Cache-Control']) {
    assert.ok(box.get(h), `${h} missing`);
    assert.strictEqual(box.get(h), list.get(h), h);
  }
});

test('an unknown source is featured; a limit above 12 is 12', async () => {
  const rows = storeRows();
  for (let i = 0; i < 20; i++) rows.push(row({ id: `extra-${i}`, reviewDate: day(3) }));
  stubDb(rows);
  const { json } = await get('highlights=1&product_id=111&source=bogus&limit=40');
  assert.strictEqual(json.highlights[0].id, 'own-featured');
  assert.strictEqual(json.highlights.length, 12);
});

test('every query is bounded, and a full box stops reading', async () => {
  const rows = storeRows();
  for (let i = 0; i < 30; i++) rows.push(row({ id: `feat-${i}`, isFeatured: true, reviewDate: day(4) }));
  stubDb(rows);
  await get('highlights=1&product_id=111&limit=6');
  assert.strictEqual(findManyCalls.length, 1, 'kept reading after the featured reviews filled the box');
  for (const source of ['featured', 'random', 'latest']) {
    stubDb(storeRows());
    await get(`highlights=1&source=${source}&product_id=111&limit=12`);
    assert.ok(findManyCalls.length >= 1);
    for (const call of findManyCalls) {
      assert.ok(Number.isInteger(call.take) && call.take > 0 && call.take <= 120, `${source}: take ${call.take}`);
    }
  }
});

test('a product not synced yet gets the store reviews, each named, none detached', async () => {
  stubDb(storeRows());
  const { json } = await get('highlights=1&product_id=999&source=latest');
  assert.ok(json.highlights.length > 0);
  for (const h of json.highlights) assert.ok(typeof h.productTitle === 'string' && h.productTitle, h.id);
});

test('no qualifying reviews: an empty box, not an error', async () => {
  stubDb([row({ id: 'meh', rating: 2 })]);
  const { res, json } = await get('highlights=1&product_id=111&source=random');
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(json.highlights, []);
  assert.strictEqual(json.total, 0);
});

section('GET with offset ("See more")');

function listRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => row({ id: `l${String(i).padStart(2, '0')}`, reviewDate: day(1 + (i % 28)) }));
}

test('offset wins over page, is echoed, and limit still applies', async () => {
  stubDb(listRows(30));
  const { json } = await get('product_id=111&offset=5&limit=10&page=3');
  const call = findManyCalls[0];
  assert.strictEqual(call.skip, 5);
  assert.strictEqual(call.take, 10);
  assert.strictEqual(json.offset, 5);
  assert.strictEqual(json.limit, 10);
  assert.strictEqual(json.reviews.length, 10);
  assert.strictEqual(json.total, 30);
});

test('offset rows continue exactly where the first page stopped', async () => {
  stubDb(listRows(30));
  const first = (await get('product_id=111&page=1&limit=5')).json.reviews.map((r: { id: string }) => r.id);
  const more = (await get('product_id=111&offset=5&limit=10')).json.reviews.map((r: { id: string }) => r.id);
  const all = (await get('product_id=111&page=1&limit=15')).json.reviews.map((r: { id: string }) => r.id);
  assert.deepStrictEqual([...first, ...more], all);
});

test('without offset nothing changes: page paging, and no offset in the reply', async () => {
  stubDb(listRows(30));
  const { json } = await get('product_id=111&page=2&limit=5');
  assert.strictEqual(findManyCalls[0].skip, 5);
  assert.ok(!('offset' in json), 'offset appeared in a page reply');
  assert.strictEqual(json.page, 2);
  assert.strictEqual(json.limit, 5);
});

test('the limit is clamped as before, offset or not', async () => {
  stubDb(listRows(80));
  assert.strictEqual((await get('product_id=111&offset=0&limit=500')).json.limit, 50);
  assert.strictEqual((await get('product_id=111&offset=0&limit=-3')).json.limit, 1);
  // perPage (5 by default) when the widget sends none.
  assert.strictEqual((await get('product_id=111&offset=0')).json.limit, 5);
});

test('an offset past the end is an empty page that says so', async () => {
  stubDb(listRows(12));
  const { json } = await get('product_id=111&offset=40&limit=10');
  assert.deepStrictEqual(json.reviews, []);
  assert.strictEqual(json.offset, 40);
  assert.strictEqual(json.total, 12);
});

// ── Run ────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
for (const [name, fn] of tests) {
  if (name.startsWith('\n')) {
    console.log(name);
    continue;
  }
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
