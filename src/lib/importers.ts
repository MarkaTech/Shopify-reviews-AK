/**
 * Real review extraction.
 *
 * This replaces a generator that fabricated reviews with random names and ratings and
 * presented them as imported. Publishing invented reviews on a storefront is deceptive
 * under the FTC Rule on Consumer Reviews and Testimonials (US) and the Omnibus Directive
 * (EU), and is a straightforward App Store rejection. Nothing here invents data: if real
 * reviews cannot be found, the import fails with an explanation.
 *
 * Extraction order:
 *   1. schema.org Review / AggregateRating in JSON-LD  — the most reliable source, and
 *      published by the site itself for exactly this purpose.
 *   2. Embedded JSON blobs used by the page's own front end.
 *
 * Both operate on HTML the caller supplies. The caller may fetch that HTML itself, or the
 * merchant may paste it from their own browser session when a server fetch is blocked.
 */

export interface ExtractedReview {
  reviewerName: string;
  rating: number;
  title: string | null;
  body: string;
  reviewDate: Date | null;
  verifiedPurchase: boolean;
  sourceUrl: string | null;
}

export type Platform = 'amazon' | 'alibaba';

export const SUPPORTED_PLATFORMS: Record<Platform, { label: string; hostPattern: RegExp }> = {
  amazon: { label: 'Amazon', hostPattern: /(^|\.)amazon\.[a-z.]+$/i },
  alibaba: { label: 'Alibaba', hostPattern: /(^|\.)alibaba\.com$/i },
};

export class ImportError extends Error {
  code: string;
  hint?: string;
  constructor(message: string, code: string, hint?: string) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
    this.hint = hint;
  }
}

/** Validate that a URL belongs to the platform the merchant selected. */
export function validateSourceUrl(platform: Platform, rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new ImportError('That does not look like a valid URL.', 'INVALID_URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ImportError('Only http and https URLs are supported.', 'INVALID_URL');
  }
  const spec = SUPPORTED_PLATFORMS[platform];
  if (!spec.hostPattern.test(url.hostname)) {
    throw new ImportError(
      `That URL is not a ${spec.label} link.`,
      'WRONG_PLATFORM',
      `Expected a ${spec.label} product page.`
    );
  }
  return url;
}

function clampRating(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 5) return null;
  return rounded;
}

function cleanText(input: unknown, maxLen = 5000): string {
  return String(input ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Pull every JSON-LD block out of an HTML document. */
function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch {
      // Malformed block — skip it rather than failing the whole import.
    }
  }
  return blocks;
}

/** Walk an arbitrary JSON structure collecting anything shaped like a schema.org Review. */
function collectReviewNodes(node: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (depth > 8 || node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) collectReviewNodes(item, out, depth + 1);
    return;
  }

  const obj = node as Record<string, unknown>;
  const type = obj['@type'];
  const types = Array.isArray(type) ? type.map(String) : [String(type ?? '')];
  if (types.some(t => t === 'Review' || t === 'UserReview')) {
    out.push(obj);
  }

  for (const key of Object.keys(obj)) {
    collectReviewNodes(obj[key], out, depth + 1);
  }
}

function reviewFromJsonLd(node: Record<string, unknown>, sourceUrl: string | null): ExtractedReview | null {
  const ratingNode = node.reviewRating as Record<string, unknown> | undefined;
  const rating = clampRating(ratingNode?.ratingValue ?? node.ratingValue);
  if (rating === null) return null;

  const body = cleanText(node.reviewBody ?? node.description ?? node.text);
  if (!body || body.length < 3) return null;

  const authorNode = node.author as Record<string, unknown> | string | undefined;
  const authorName =
    typeof authorNode === 'string'
      ? authorNode
      : cleanText((authorNode as Record<string, unknown>)?.name);

  return {
    reviewerName: cleanText(authorName, 120) || 'Anonymous',
    rating,
    title: cleanText(node.name ?? node.headline, 200) || null,
    body,
    reviewDate: parseDate(node.datePublished ?? node.dateCreated),
    verifiedPurchase: false,
    sourceUrl,
  };
}

/**
 * Extract reviews from a product page's HTML.
 * Returns an empty array when the page contains no structured review data.
 */
export function extractReviews(html: string, sourceUrl: string | null): ExtractedReview[] {
  if (!html || html.length < 100) return [];

  const nodes: Record<string, unknown>[] = [];
  for (const block of extractJsonLdBlocks(html)) {
    collectReviewNodes(block, nodes);
  }

  const reviews: ExtractedReview[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    const r = reviewFromJsonLd(node, sourceUrl);
    if (!r) continue;
    // Same reviewer + same opening text is a duplicate, which pages often emit twice.
    const key = `${r.reviewerName}|${r.body.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    reviews.push(r);
  }

  return reviews;
}

/**
 * Fetch a product page. Many marketplaces block datacentre traffic, so this is expected
 * to fail sometimes — the caller falls back to merchant-supplied HTML rather than
 * inventing data.
 */
export async function fetchPage(url: URL, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ReviewMasterImporter/1.0)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) {
      throw new ImportError(
        `The page could not be fetched (HTTP ${res.status}).`,
        'FETCH_BLOCKED',
        'Marketplaces often block automated requests. Open the page in your browser, view source, and paste the HTML instead.'
      );
    }
    return await res.text();
  } catch (err) {
    if (err instanceof ImportError) throw err;
    throw new ImportError(
      'The page could not be reached.',
      'FETCH_BLOCKED',
      'Marketplaces often block automated requests. Open the page in your browser, view source, and paste the HTML instead.'
    );
  } finally {
    clearTimeout(timer);
  }
}
