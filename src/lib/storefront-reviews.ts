/**
 * The rules behind the public storefront reviews endpoint that do not need a database:
 * which reviews go in the "Review highlights" box, and how a "See more" offset is read.
 *
 * Kept out of src/app/api/storefront/reviews/route.ts because a Next.js route module may
 * only export its handlers, and these are worth testing on their own: the highlights box
 * sits beside Add to cart, where a review shown twice, an unpublished one, or one about a
 * different product passed off as this one is a claim made at the moment of purchase.
 */

/** Where the highlights come from: the merchant's picks, a random few, or the newest. */
export const HIGHLIGHT_SOURCES = ['featured', 'random', 'latest'] as const;
export type HighlightSource = (typeof HIGHLIGHT_SOURCES)[number];

/** How many reviews the box may ask for. Matches the block's own 1-12 range. */
export const HIGHLIGHT_LIMIT = { min: 1, max: 12, fallback: 6 } as const;

/**
 * Characters of text a review needs before it is chosen without the merchant asking.
 *
 * The box quotes a review beside Add to cart. "Great!" proves nothing there, and a box
 * full of one-word reviews reads as padding. A review the merchant featured is theirs to
 * show whatever its length.
 */
export const MIN_QUOTE_LENGTH = 40;

/** "Random" samples from this many of the newest qualifying reviews, not the whole history. */
export const RANDOM_POOL = 60;

/**
 * The furthest a "See more" offset is honoured.
 *
 * Far beyond any list a shopper clicks through (ten thousand clicks at ten a time), and it
 * keeps a hand-typed `offset=1e20` from reaching Prisma, which rejects a skip outside a
 * 32-bit integer and would turn the request into a 500.
 */
export const MAX_OFFSET = 100_000;

/** The fields the selection rules read. The route's rows carry more; they pass through. */
export interface HighlightCandidate {
  id: string;
  productId: string | null;
  rating: number;
  title: string | null;
  body: string;
  isFeatured: boolean;
  isPublished: boolean;
  reviewDate: Date;
}

export interface HighlightOptions {
  source: HighlightSource;
  /** Clamped to HIGHLIGHT_LIMIT. */
  limit: number;
  /** The local id of the product the box is about, or null for none (or not synced yet). */
  productId: string | null;
  /**
   * Whether the box sits on a product page. Defaults to `productId !== null`; the route
   * passes true for a product that is not synced yet, which has no local id but is still
   * the product the shopper is looking at.
   */
  productPage?: boolean;
  /** For "random". Injectable so the tests can pin the sample. */
  random?: () => number;
}

/** An unknown or missing source is the default, featured: the merchant's choice comes first. */
export function parseHighlightSource(raw: string | null | undefined): HighlightSource {
  return (HIGHLIGHT_SOURCES as readonly string[]).includes(raw ?? '')
    ? (raw as HighlightSource)
    : 'featured';
}

/** A whole number in 1..12; anything unreadable is the default of 6. */
export function clampHighlightLimit(raw: unknown): number {
  if (raw === null || raw === undefined || raw === '') return HIGHLIGHT_LIMIT.fallback;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return HIGHLIGHT_LIMIT.fallback;
  return Math.min(HIGHLIGHT_LIMIT.max, Math.max(HIGHLIGHT_LIMIT.min, n));
}

/**
 * The `offset` query parameter: a whole number from 0 to MAX_OFFSET, or null when the
 * request did not send a readable one.
 *
 * Null rather than 0 for something unreadable, because the reply echoes the offset it
 * used and the widget reads a missing echo as "this server pages by number". An offset the
 * server could not read is better answered as a page than as a silent jump to the top.
 */
export function parseOffset(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_OFFSET, Math.max(0, Math.floor(n)));
}

/** Review text as the box shows it: on one line, so a run of blank lines is not "length". */
function plain(s: string | null | undefined): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Four or five stars and enough to read. What every source draws on when choosing for itself. */
export function isQuotable(r: Pick<HighlightCandidate, 'rating' | 'body'>): boolean {
  return r.rating >= 4 && plain(r.body).length >= MIN_QUOTE_LENGTH;
}

/** Anything at all to quote. The widget drops a review with neither body nor title. */
function hasText(r: Pick<HighlightCandidate, 'body' | 'title'>): boolean {
  return plain(r.body || r.title).length > 0;
}

/** Newest first, the id breaking ties, so the same rows always come out in the same order. */
function newestFirst(a: HighlightCandidate, b: HighlightCandidate): number {
  const byDate = b.reviewDate.getTime() - a.reviewDate.getTime();
  if (byDate !== 0) return byDate;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Up to `k` of `list`, chosen uniformly without replacement: a partial Fisher-Yates. */
function sample<T>(list: T[], k: number, random: () => number): T[] {
  const a = list.slice();
  const n = Math.max(0, Math.min(k, a.length));
  for (let i = 0; i < n; i++) {
    // min(), because a random() that returns exactly 1 would index one past the end.
    const j = Math.min(a.length - 1, i + Math.floor(random() * (a.length - i)));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a.slice(0, n);
}

/**
 * Choose the reviews for the highlights box, in the order to show them.
 *
 * `candidates` is whatever the route read, in any order and possibly with the same review
 * twice (it reads this product's pool and the store's separately). Every rule is applied
 * here rather than trusted to the query, so the tests cover what the shopper will see.
 *
 *   featured — the merchant's featured reviews, this product's before the rest of the
 *              store's; then, if that is short of `limit`, quotable reviews (4-5 stars,
 *              MIN_QUOTE_LENGTH characters), this product's before the store's, newest first.
 *   random   — a random sample of this product's newest RANDOM_POOL quotable reviews. A
 *              product with fewer than `limit` keeps all of its own and is topped up with a
 *              sample of the store's newest RANDOM_POOL.
 *   latest   — the newest quotable reviews, this product's before the store's.
 *
 * Always: published only, and each review once.
 *
 * On a product page, a review from elsewhere in the store is shown named ("on <product>",
 * from the route's productTitle). A review with no product at all, such as one detached
 * when its product was deleted, cannot be named, and beside this product's Add to cart it
 * would read as a review of this product. So there it is left out.
 */
export function pickHighlights<T extends HighlightCandidate>(candidates: T[], options: HighlightOptions): T[] {
  const limit = clampHighlightLimit(options.limit);
  const productId = options.productId;
  const productPage = options.productPage ?? productId !== null;
  const random = options.random ?? Math.random;

  const seen = new Set<string>();
  const pool: T[] = [];
  for (const r of candidates) {
    if (!r || !r.isPublished || seen.has(r.id)) continue;
    seen.add(r.id);
    pool.push(r);
  }
  pool.sort(newestFirst);

  const own = (r: T) => productId !== null && r.productId === productId;
  const elsewhere = (r: T) => !own(r) && (!productPage || r.productId !== null);

  if (options.source === 'random') {
    const mine = pool.filter((r) => own(r) && isQuotable(r)).slice(0, RANDOM_POOL);
    if (mine.length >= limit) return sample(mine, limit, random);
    const store = pool.filter((r) => elsewhere(r) && isQuotable(r)).slice(0, RANDOM_POOL);
    return [...mine, ...sample(store, limit - mine.length, random)];
  }

  const tiers: Array<(r: T) => boolean> = [];
  if (options.source === 'featured') {
    tiers.push((r) => r.isFeatured && hasText(r) && own(r));
    tiers.push((r) => r.isFeatured && hasText(r) && elsewhere(r));
  }
  tiers.push((r) => isQuotable(r) && own(r));
  tiers.push((r) => isQuotable(r) && elsewhere(r));

  // A featured review of this product that is also quotable matches two tiers; it is
  // placed by the first and skipped by the second.
  const out: T[] = [];
  const placed = new Set<string>();
  for (const tier of tiers) {
    for (const r of pool) {
      if (out.length >= limit) return out;
      if (placed.has(r.id) || !tier(r)) continue;
      placed.add(r.id);
      out.push(r);
    }
  }
  return out;
}
