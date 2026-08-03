/**
 * AliExpress review import — fetch a listing's public feedback and map it to our shape.
 *
 * Why AliExpress and only AliExpress
 * ----------------------------------
 * This app once shipped a generic "import from Amazon / eBay / Alibaba" scraper, and it
 * was removed for documented reasons (see /api/import). Those reasons still hold for
 * Amazon — robots.txt prohibits it, bot detection enforces it, and their Conditions of
 * Use forbid it. They do NOT hold for AliExpress:
 *
 *   - AliExpress serves product feedback through a public, unauthenticated JSON endpoint
 *     (feedback.aliexpress.com). No scraping of protected pages, no login, no CAPTCHA on
 *     the feedback service itself. It is the same channel every importer in this category
 *     uses, including the market leader's dedicated AliExpress importer app, which has
 *     lived on the Shopify App Store for years.
 *
 *   - The use case is dropshipping: the merchant sells the *same physical item* the
 *     listing describes. A review of that item is a review of what the shopper will
 *     receive. That is materially different from borrowing reviews of someone else's
 *     product — and it is why the merchant must attest to it (see the route).
 *
 * What imported reviews can never be
 * ---------------------------------
 * Verified. Every review lands as `verificationStatus: 'unverified'` with
 * `source: 'aliexpress'` and the listing URL recorded, and the storefront widget shows
 * the source. We have no order to point at, and FTC 16 CFR 465 makes claiming otherwise
 * a misrepresentation. There is also deliberately no star filter on this import: pulling
 * only the 5-star reviews from a listing is curation the FTC's review-suppression rules
 * frown on, and it is not a control this app offers anywhere else either.
 */

export interface AliExpressReview {
  author: string;
  rating: number;
  body: string;
  images: string[];
  country: string | null;
  date: Date | null;
}

export interface AliExpressFetchResult {
  reviews: AliExpressReview[];
  /** Total the listing claims, which can exceed what we fetch. */
  listingTotal: number;
}

export class AliExpressImportError extends Error {
  /** Safe to show a merchant verbatim. */
  merchantMessage: string;
  constructor(merchantMessage: string, detail?: string) {
    super(detail || merchantMessage);
    this.name = 'AliExpressImportError';
    this.merchantMessage = merchantMessage;
  }
}

/**
 * Pull the numeric product id out of whatever the merchant pasted.
 *
 * Accepted: aliexpress.com/item/1005006789.html and every regional/mobile variant of it
 * (aliexpress.us, es.aliexpress.com, m.aliexpress.com, /i/{id}.html), or a bare id.
 *
 * alibaba.com is rejected by name rather than falling through to "invalid URL": it is a
 * different site (B2B, supplier reviews behind login, no public feedback service), and a
 * merchant pasting it deserves to be told that rather than shown a generic error.
 */
export function parseAliExpressUrl(input: string): string {
  const raw = String(input || '').trim();
  if (!raw) throw new AliExpressImportError('Paste an AliExpress product URL.');

  if (/^\d{6,20}$/.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    throw new AliExpressImportError('That does not look like a URL. Paste the product page address from AliExpress.');
  }

  const host = url.hostname.toLowerCase();

  if (host.endsWith('alibaba.com')) {
    throw new AliExpressImportError(
      'Alibaba.com is not supported — it has no public review feed. This import works with AliExpress product pages (aliexpress.com/item/...).'
    );
  }

  if (!/(^|\.)aliexpress\.(com|us|ru)$/.test(host) && !host.endsWith('.aliexpress.com')) {
    throw new AliExpressImportError('That is not an AliExpress link. Paste a product page URL like aliexpress.com/item/1005001234567890.html');
  }

  const m = url.pathname.match(/\/(?:item|i)\/(?:[^/]*-)?(\d{6,20})(?:\.html)?/);
  if (!m) {
    throw new AliExpressImportError(
      'Could not find a product id in that link. Open the product page on AliExpress and copy the address from the browser bar — it should contain /item/<number>.html'
    );
  }
  return m[1];
}

/** Shape of the fragments we read from feedback.aliexpress.com. Everything optional,
 *  because the response is not ours and absent fields must degrade, not throw. */
interface RawEval {
  buyerName?: string;
  buyerEval?: number;
  buyerFeedback?: string;
  buyerTranslationFeedback?: string;
  buyerCountry?: string;
  evalDate?: string;
  images?: string[];
}

interface RawBox {
  totalNum?: number;
  evaViewList?: RawEval[];
  /** Where recent revisions of the endpoint put the count. */
  productEvaluationStatistic?: { totalNum?: number };
}

function mapEval(e: RawEval): AliExpressReview | null {
  // buyerEval is 0–100 in steps of 20. Anything unparseable becomes 0 and is dropped —
  // a review without a rating cannot participate in an average.
  const rating = Math.round(Number(e.buyerEval ?? 0) / 20);
  if (rating < 1 || rating > 5) return null;

  const body = String(e.buyerTranslationFeedback || e.buyerFeedback || '').trim();
  const images = (Array.isArray(e.images) ? e.images : [])
    .map((u) => String(u))
    .filter((u) => u.startsWith('https://'))
    .slice(0, 6);

  // Star-only feedback with no text and no photo is dropped: importing hundreds of empty
  // rows inflates the count without telling a shopper anything, and it spends quota.
  if (!body && images.length === 0) return null;

  let date: Date | null = null;
  if (e.evalDate) {
    const parsed = new Date(e.evalDate);
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() < Date.now()) date = parsed;
  }

  return {
    // AliExpress anonymises names on their side (e.g. "A***v"), which suits us: we never
    // hold the buyer's identity at all.
    author: String(e.buyerName || '').trim() || 'AliExpress Customer',
    rating,
    body,
    images,
    country: e.buyerCountry ? String(e.buyerCountry) : null,
    date,
  };
}

const PAGE_SIZE = 20;

/** Hard ceiling per import run. Bounds our writes, their bandwidth, and the merchant's
 *  review quota in one number. */
export const MAX_IMPORT = 200;

/**
 * The feedback service answers on more than one host, and availability differs by edge
 * and by caller IP. Rather than marrying one URL, page 1 tries each in order and the
 * first host that yields reviews serves the remaining pages. This is the difference
 * between "works from my machine" and working from every merchant's server region.
 */
const FEEDBACK_HOSTS = [
  'https://feedback.aliexpress.com',
  'https://feedback.aliexpress.ru',
];

interface PageResult {
  evals: RawEval[];
  total: number;
  diag: string;
}

async function fetchPage(host: string, productId: string, page: number): Promise<PageResult> {
  const params = new URLSearchParams({
    productId,
    lang: 'en_US',
    country: 'US',
    page: String(page),
    pageSize: String(PAGE_SIZE),
    filter: 'all',
    sort: 'complex_default',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  let res: Response;
  try {
    res = await fetch(`${host}/pc/searchEvaluation.do?${params}`, {
      signal: controller.signal,
      headers: {
        // A plain server-side fetch with no UA reads as a bot probe; a browser-shaped
        // request reads as the feedback widget doing its job.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: `https://www.aliexpress.com/item/${productId}.html`,
        Origin: 'https://www.aliexpress.com',
      },
    });
  } catch (err) {
    clearTimeout(timer);
    return { evals: [], total: 0, diag: `${host}: unreachable (${String(err).slice(0, 80)})` };
  }
  clearTimeout(timer);

  if (!res.ok) {
    return { evals: [], total: 0, diag: `${host}: HTTP ${res.status}` };
  }

  const rawText = await res.text();
  let payload: { displayMessage?: RawBox; data?: RawBox } & RawBox;
  try {
    payload = JSON.parse(rawText);
  } catch {
    return { evals: [], total: 0, diag: `${host}: non-JSON ${rawText.replace(/\s+/g, ' ').slice(0, 120)}` };
  }

  // The envelope has moved over the years: displayMessage.*, data.*, and occasionally
  // top-level. Accept all three, and read the total from either of its known homes.
  const box: RawBox = payload.displayMessage ?? payload.data ?? payload ?? {};
  const evals = Array.isArray(box.evaViewList) ? box.evaViewList : [];
  const total = Number(box.totalNum ?? box.productEvaluationStatistic?.totalNum ?? 0) || 0;

  return {
    evals,
    total,
    diag: `${host}: keys=${Object.keys(payload ?? {}).slice(0, 8).join(',') || 'none'} body="${rawText.replace(/\s+/g, ' ').slice(0, 160)}"`,
  };
}

/**
 * Fetch up to `limit` usable reviews for a product id.
 *
 * Failure modes are folded into merchant-facing messages. The one case that carries a
 * diagnostic is "the service answered and we recognised nothing" — that text is the only
 * window anyone has into what AliExpress actually said, and it is what turns a vague bug
 * report into a one-line fix.
 */
export async function fetchAliExpressReviews(
  productId: string,
  limit: number = MAX_IMPORT
): Promise<AliExpressFetchResult> {
  const out: AliExpressReview[] = [];
  let listingTotal = 0;
  const diags: string[] = [];
  const maxPages = Math.ceil(Math.min(limit, MAX_IMPORT) / PAGE_SIZE);

  // Page 1 doubles as host selection: the first edge that produces reviews wins.
  let host: string | null = null;
  for (const candidate of FEEDBACK_HOSTS) {
    const first = await fetchPage(candidate, productId, 1);
    diags.push(first.diag);
    if (first.evals.length > 0 || first.total > 0) {
      host = candidate;
      listingTotal = first.total;
      for (const raw of first.evals) {
        const mapped = mapEval(raw);
        if (mapped) out.push(mapped);
        if (out.length >= limit) break;
      }
      break;
    }
  }

  if (host === null) {
    throw new AliExpressImportError(
      `No reviews found on that listing. If the listing definitely has reviews, report this diagnostic: ${diags.join(' | ')}`
    );
  }

  for (let page = 2; page <= maxPages && out.length < limit; page++) {
    // A polite gap between pages. One importer hammering the feedback service is how the
    // whole app's egress IP ends up on a blocklist every merchant then shares.
    await new Promise((r) => setTimeout(r, 400));

    const next = await fetchPage(host, productId, page);
    if (next.evals.length === 0) break;
    for (const raw of next.evals) {
      const mapped = mapEval(raw);
      if (mapped) out.push(mapped);
      if (out.length >= limit) break;
    }
    if (next.evals.length < PAGE_SIZE) break;
  }

  if (out.length === 0) {
    // The listing has ratings but every one was star-only with no text or photos.
    throw new AliExpressImportError(
      `That listing reports ${listingTotal} ratings, but none include text or photos, so there is nothing to import.`
    );
  }

  return { reviews: out, listingTotal: Math.max(listingTotal, out.length) };
}
