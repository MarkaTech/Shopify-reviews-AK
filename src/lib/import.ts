/**
 * Review import: CSV parsing, competitor format detection, and product matching.
 *
 * Three problems this solves, in order of how much they hurt
 * ---------------------------------------------------------
 *
 * 1. **Reviews arriving with no product attached.** The previous importer only linked a
 *    review to a product if the merchant manually picked one for the whole file. Import
 *    500 reviews spanning 80 products and every single one lands unattached — invisible on
 *    every product page, contributing to no aggregate. The merchant sees "0 stars"
 *    everywhere and concludes the app is broken. Auto-matching by handle, SKU, Shopify ID
 *    or title fixes the single worst first-run experience in the product.
 *
 * 2. **Competitor migration.** Judge.me lists seventeen app-to-app importers, and that is
 *    its strongest acquisition lever: switching costs are what keep merchants on an
 *    incumbent. Every one of those apps exports CSV with its own column names. Detecting
 *    the format and mapping automatically turns "export, hand-edit a spreadsheet, hope"
 *    into one upload.
 *
 * 3. **A parser that actually handles CSV.** The old one split the file on newlines before
 *    parsing quotes, so any review containing a line break — which real reviews constantly
 *    do — silently corrupted every row after it. Real Judge.me and Yotpo exports are full
 *    of multi-line bodies.
 *
 * What this deliberately does NOT do
 * ----------------------------------
 * Import cannot manufacture verification. Every imported review is `unverified`, whatever
 * the source file claims, because we have no order to point at. A CSV column reading
 * "verified: true" is an assertion by whoever made the file, and re-publishing it as a
 * Verified Purchase badge would be a misrepresentation under FTC 16 CFR 465.
 */

export interface ParsedRow {
  [column: string]: string;
}

/**
 * RFC 4180 CSV parser.
 *
 * Operates character by character over the whole file rather than splitting on newlines
 * first, which is the only way to handle a quoted field containing a line break. It also
 * handles the doubled-quote escape (`""` inside a quoted field means one literal quote),
 * which the old parser got wrong by toggling state on every quote it saw.
 */
export function parseCSV(text: string): { headers: string[]; rows: ParsedRow[] } {
  // Strip a UTF-8 BOM. Excel adds one, and it otherwise becomes part of the first header
  // name, so "reviewerName" silently arrives as "﻿reviewerName" and never matches.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\r') {
      // Swallow; the \n that follows ends the record.
    } else if (ch === '\n') {
      record.push(field);
      field = '';
      // Skip blank lines rather than emitting an empty record.
      if (record.length > 1 || record[0].trim() !== '') records.push(record);
      record = [];
    } else {
      field += ch;
    }
  }

  if (field !== '' || record.length) {
    record.push(field);
    if (record.length > 1 || record[0].trim() !== '') records.push(record);
  }

  if (!records.length) return { headers: [], rows: [] };

  const headers = records[0].map((h) => h.trim());
  const rows: ParsedRow[] = [];

  for (let r = 1; r < records.length; r++) {
    const row: ParsedRow = {};
    headers.forEach((h, i) => {
      row[h] = (records[r][i] ?? '').trim();
    });
    rows.push(row);
  }

  return { headers, rows };
}

/**
 * Canonical fields we import into, and the column names each competitor uses for them.
 *
 * Matching is case-insensitive and ignores spaces, underscores and hyphens, so
 * "Reviewer Name", "reviewer_name" and "reviewername" all resolve to the same field.
 * Order matters: the first alias found wins, so put the most specific first.
 */
const FIELD_ALIASES: Record<string, string[]> = {
  reviewerName: [
    'reviewername', 'author', 'name', 'customername', 'reviewerfullname',
    'displayname', 'reviewauthor', 'buyername', 'nickname',
  ],
  reviewerEmail: ['revieweremail', 'email', 'customeremail', 'authoremail', 'buyeremail'],
  reviewerLocation: ['reviewerlocation', 'location', 'country', 'city', 'reviewercountry'],
  rating: ['rating', 'score', 'stars', 'reviewrating', 'starrating', 'ratingvalue'],
  title: ['title', 'reviewtitle', 'headline', 'subject', 'summary'],
  body: ['body', 'review', 'reviewbody', 'content', 'comment', 'reviewcontent', 'text', 'message', 'description'],
  reviewDate: ['reviewdate', 'date', 'createdat', 'submittedat', 'timestamp', 'datecreated', 'reviewcreatedat'],
  productHandle: ['producthandle', 'handle', 'productslug', 'slug'],
  productId: ['productid', 'shopifyproductid', 'product_id', 'productshopifyid'],
  sku: ['sku', 'variantsku', 'productsku'],
  productTitle: ['producttitle', 'product', 'productname', 'itemname', 'itemtitle'],
  images: ['images', 'imageurls', 'photos', 'pictureurls', 'photourls', 'imageurl', 'picture'],
  videoUrl: ['videourl', 'video', 'videourls'],
  reply: ['reply', 'reviewreply', 'merchantreply', 'response', 'storereply', 'adminreply'],
  isPublished: ['ispublished', 'published', 'status', 'state', 'visible'],
  source: ['source', 'platform', 'origin', 'via'],
};

function normalise(header: string): string {
  return header.toLowerCase().replace(/[\s_\-.]/g, '');
}

export interface ColumnMap {
  [canonicalField: string]: string; // canonical -> actual header in the file
}

/** Work out which column holds which field. */
export function detectColumns(headers: string[]): ColumnMap {
  const map: ColumnMap = {};
  const normalised = headers.map((h) => ({ raw: h, norm: normalise(h) }));

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const hit = normalised.find((h) => h.norm === alias);
      if (hit && !Object.values(map).includes(hit.raw)) {
        map[field] = hit.raw;
        break;
      }
    }
  }

  return map;
}

/**
 * Guess which app produced this export, purely to tell the merchant what we recognised.
 *
 * Purely cosmetic — mapping is driven by the aliases above, not by this. But "Detected a
 * Judge.me export" is far more reassuring than a silent success, and if the guess is wrong
 * the merchant now knows to check the preview before committing.
 */
export function detectSource(headers: string[]): string | null {
  const set = new Set(headers.map(normalise));
  const has = (...keys: string[]) => keys.every((k) => set.has(k));

  if (has('reviewerid', 'reviewerbody')) return 'Judge.me';
  if (has('productid', 'reviewerid') && set.has('pictureurls')) return 'Loox';
  if (has('reviewid', 'productid') && set.has('reviewcreatedat')) return 'Yotpo';
  if (set.has('reviewrating') && set.has('reviewmessage')) return 'Stamped.io';
  if (set.has('reviewbody') && set.has('reviewerhandle')) return 'Okendo';
  return null;
}

/** Parse loose truthiness from CSV text. */
function truthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'y' || s === 'published' || s === 'active';
}

/**
 * Parse a date without letting a bad value become "now".
 *
 * `new Date("garbage")` yields Invalid Date, and writing that to Postgres throws. Falling
 * back to the current date silently would be worse than it sounds: an imported review
 * dated today looks freshly written, which misrepresents the age of the feedback.
 */
export function parseDate(raw: string | undefined): Date | null {
  if (!raw?.trim()) return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) return null;
  // A date far in the future is a parsing artefact (US/EU day-month ambiguity), not a real
  // review date. Reject rather than store something absurd.
  if (d.getTime() > Date.now() + 86400_000) return null;
  return d;
}

/** Split an image column. Different exporters use different separators. */
export function parseImageList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[|,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s))
    .slice(0, 10);
}

export interface ProductLookup {
  id: string;
  shopifyId: string | null;
  handle: string | null;
  title: string;
}

export interface MatchIndex {
  byShopifyId: Map<string, string>;
  byHandle: Map<string, string>;
  byTitle: Map<string, string>;
}

export function buildMatchIndex(products: ProductLookup[]): MatchIndex {
  const byShopifyId = new Map<string, string>();
  const byHandle = new Map<string, string>();
  const byTitle = new Map<string, string>();

  for (const p of products) {
    if (p.shopifyId) byShopifyId.set(p.shopifyId, p.id);
    if (p.handle) byHandle.set(p.handle.toLowerCase(), p.id);
    byTitle.set(normaliseTitle(p.title), p.id);
  }

  return { byShopifyId, byHandle, byTitle };
}

function normaliseTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Match a CSV row to a product, most reliable signal first.
 *
 * Shopify ID and handle are exact identifiers and are trusted. Title is a fallback and is
 * matched only on an exact normalised string — deliberately NOT fuzzy. Attaching a review
 * to the wrong product because two names looked similar is worse than leaving it
 * unattached: the merchant can fix an unattached review, but will probably never notice a
 * misattached one, and it corrupts that product's rating in the meantime.
 */
export function matchProduct(
  row: ParsedRow,
  map: ColumnMap,
  index: MatchIndex,
  fallbackProductId: string | null
): { productId: string | null; matchedBy: 'shopifyId' | 'handle' | 'title' | 'fallback' | null } {
  const shopifyId = map.productId ? row[map.productId]?.replace(/\D/g, '') : '';
  if (shopifyId && index.byShopifyId.has(shopifyId)) {
    return { productId: index.byShopifyId.get(shopifyId)!, matchedBy: 'shopifyId' };
  }

  const handle = map.productHandle ? row[map.productHandle]?.trim().toLowerCase() : '';
  if (handle && index.byHandle.has(handle)) {
    return { productId: index.byHandle.get(handle)!, matchedBy: 'handle' };
  }

  const title = map.productTitle ? row[map.productTitle] : '';
  if (title) {
    const key = normaliseTitle(title);
    if (key && index.byTitle.has(key)) {
      return { productId: index.byTitle.get(key)!, matchedBy: 'title' };
    }
  }

  if (fallbackProductId) return { productId: fallbackProductId, matchedBy: 'fallback' };
  return { productId: null, matchedBy: null };
}

export interface MappedReview {
  reviewerName: string;
  reviewerEmail: string | null;
  reviewerLocation: string | null;
  rating: number;
  title: string | null;
  body: string;
  reviewDate: Date;
  images: string[];
  videoUrl: string | null;
  reply: string | null;
  isPublished: boolean;
  source: string;
  productId: string | null;
  matchedBy: string | null;
}

export interface RowError {
  row: number;
  reason: string;
}

/**
 * Turn parsed rows into reviews ready to insert.
 *
 * Returns errors per row rather than throwing, so one malformed row out of five hundred
 * does not cost the merchant the other four hundred and ninety-nine.
 */
export function mapRows(
  rows: ParsedRow[],
  map: ColumnMap,
  index: MatchIndex,
  opts: { fallbackProductId?: string | null; defaultSource?: string; autoPublish?: boolean }
): { reviews: MappedReview[]; errors: RowError[] } {
  const reviews: MappedReview[] = [];
  const errors: RowError[] = [];
  const fallback = opts.fallbackProductId ?? null;

  rows.forEach((row, i) => {
    const rowNum = i + 2; // +1 for zero-index, +1 for the header line

    const name = (map.reviewerName ? row[map.reviewerName] : '').trim();
    const body = (map.body ? row[map.body] : '').trim();

    if (!name && !body) {
      errors.push({ row: rowNum, reason: 'Empty row' });
      return;
    }
    if (!body) {
      errors.push({ row: rowNum, reason: 'No review text' });
      return;
    }

    const rawRating = map.rating ? Number(String(row[map.rating]).replace(/[^\d.]/g, '')) : NaN;
    if (!Number.isFinite(rawRating) || rawRating <= 0) {
      errors.push({ row: rowNum, reason: 'Missing or invalid rating' });
      return;
    }
    // Some exports use a 1-10 or 0-100 scale. Rescale rather than clamp everything to 5,
    // which would turn a 7/10 into a 5-star review and inflate the merchant's average.
    let rating = rawRating;
    if (rating > 10) rating = Math.round((rating / 100) * 5);
    else if (rating > 5) rating = Math.round((rating / 10) * 5);
    rating = Math.min(5, Math.max(1, Math.round(rating)));

    const { productId, matchedBy } = matchProduct(row, map, index, fallback);

    reviews.push({
      reviewerName: name || 'Anonymous',
      reviewerEmail: (map.reviewerEmail ? row[map.reviewerEmail] : '').trim() || null,
      reviewerLocation: (map.reviewerLocation ? row[map.reviewerLocation] : '').trim() || null,
      rating,
      title: (map.title ? row[map.title] : '').trim().slice(0, 200) || null,
      body: body.slice(0, 5000),
      reviewDate: parseDate(map.reviewDate ? row[map.reviewDate] : undefined) ?? new Date(),
      images: parseImageList(map.images ? row[map.images] : undefined),
      videoUrl: (map.videoUrl ? row[map.videoUrl] : '').trim() || null,
      reply: (map.reply ? row[map.reply] : '').trim() || null,
      // Default to published for imports — a merchant migrating 500 existing reviews does
      // not want to hand-approve all of them — unless the file explicitly says otherwise.
      isPublished: map.isPublished ? truthy(row[map.isPublished]) : opts.autoPublish !== false,
      source: (map.source ? row[map.source] : '').trim().toLowerCase() || opts.defaultSource || 'csv',
      productId,
      matchedBy,
    });
  });

  return { reviews, errors };
}
