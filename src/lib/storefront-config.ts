/**
 * Storefront appearance, layout, copy and behaviour — configured by the merchant.
 *
 * The problem this solves
 * ----------------------
 * Every visible string in the widget was hardcoded — "Write a review", "Verified
 * Purchase", "Thank you. Your review has been submitted for approval." A merchant selling
 * in French, or one who wants "Share your experience" instead of "Write a review", or one
 * whose approval turnaround is a week and wants to say so, had no way to change any of it
 * without editing our source.
 *
 * Beyond that, the app had THREE places that looked like configuration and only one that
 * worked: the theme editor (real), Settings (wrote rows nothing read), and Widgets (wrote
 * rows nothing read). This module is now the single source of truth for all three.
 *
 * Where the settings live, and why
 * --------------------------------
 * In StoreSetting rows, keyed by the constants below. Not in the theme app extension,
 * because:
 *
 *   - Theme settings are per-block. A merchant with the review widget on the product page,
 *     a carousel on the home page and an all-reviews page would have to retype the same
 *     copy three times and keep them in sync by hand.
 *   - Theme settings are per-theme. Duplicate a theme to test something and the copy does
 *     not come with it.
 *   - Text belongs with the merchant's account, not their theme.
 *
 * Precedence, lowest to highest
 * -----------------------------
 *   1. DEFAULT_CONFIG           — what an untouched install looks like
 *   2. StoreSetting `sf.*` rows — Settings → Display / General, account-wide
 *   3. The active WidgetConfig  — Widgets page, per placement
 *
 * The widget row wins because it is the more specific choice: a merchant who built a
 * carousel for the home page and a list for product pages means exactly that. Theme-editor
 * colours still win over all of it at render time, because tweaking a colour against a live
 * preview is the better experience and the merchant is looking right at the result.
 *
 * Delivery is free: the config rides along in the existing /api/storefront/reviews
 * response rather than costing a second request on the product page.
 */

import { db } from './db';
import { getStorePlan, PLANS } from './plans';

/** The nine display styles offered on the Widgets page. */
export const LAYOUTS = [
  'list',
  'grid',
  'masonry',
  'carousel',
  'testimonial',
  'badge',
  'floating',
  'popup',
  'sidebar',
] as const;

export type LayoutType = (typeof LAYOUTS)[number];

/** Visual presets. Each maps to a class on the widget root; the CSS does the rest. */
export const THEMES = ['modern', 'classic', 'minimal', 'bold'] as const;

export interface StorefrontConfig {
  colors: {
    accent: string;
    star: string;
    verifiedBg: string;
    verifiedText: string;
    /** Card background. Merchants on dark themes need this. */
    cardBg: string;
    /** Body text inside cards. */
    cardText: string;
    /** Card border / divider. */
    border: string;
  };
  layout: {
    type: LayoutType;
    /** Grid and masonry only. */
    columns: number;
    /** Carousel only. */
    autoplay: boolean;
    borderRadius: number;
    theme: string;
    /** Cap on reviews pulled per page for this placement. */
    maxReviews: number;
    /** Popup layout only — seconds before it opens. */
    popupDelay: number;
  };
  text: {
    heading: string;
    writeReview: string;
    noReviews: string;
    basedOn: string;
    verifiedBadge: string;
    incentivisedBadge: string;
    incentivisedTooltip: string;
    storeResponse: string;
    yourRating: string;
    yourName: string;
    yourEmail: string;
    emailPrivacy: string;
    reviewTitle: string;
    reviewBody: string;
    addPhotos: string;
    chooseFiles: string;
    noFilesSelected: string;
    submit: string;
    cancel: string;
    submitting: string;
    /** Shown after a successful submission. */
    thankYou: string;
    /** Shown when auto-publish is on, so the copy does not promise a review that is already live. */
    thankYouPublished: string;
    errorGeneric: string;
    filterWithPhotos: string;
    sortRecent: string;
    sortHighest: string;
    sortLowest: string;
    sortHelpful: string;
    showingCount: string;
    noMatchFilter: string;
    helpful: string;
    helpfulThanks: string;
    seeAll: string;
    close: string;
  };
  behaviour: {
    showHistogram: boolean;
    showFilters: boolean;
    showWriteButton: boolean;
    showVerifiedBadge: boolean;
    showSourceBadge: boolean;
    showReviewerLocation: boolean;
    showDates: boolean;
    showReply: boolean;
    showHelpful: boolean;
    /** Render photos/video attached to a review inside the card. */
    showMedia: boolean;
    /** Offer the upload control on the submission form. */
    allowPhotos: boolean;
    allowVideo: boolean;
    requireEmail: boolean;
    /** Publish storefront submissions immediately instead of queueing for approval. */
    autoPublish: boolean;
    /** Let a shopper submit without a name. */
    allowAnonymous: boolean;
    /** Characters required in the review body. */
    minReviewLength: number;
    perPage: number;
    defaultSort: string;
  };
  /** Merchant CSS, sanitised. Empty string means none. */
  /**
   * Whether to show "Reviews by ReviewMaster" under the widget.
   *
   * Not a merchant setting — derived from the plan, and deliberately not writable through
   * the `sf.*` settings path, so it cannot be switched off by anyone who has not paid to
   * switch it off. `whiteLabel` in plans.ts is what decides it.
   */
  branding: boolean;
  customCss: string;
}

/**
 * Defaults. Also the documentation of what is configurable — anything not here cannot be
 * changed by a merchant, which is a decision rather than an oversight.
 *
 * `{count}` and `{first}`/`{last}`/`{total}` are substituted at render time. Keeping them
 * as plain braces rather than a template language means a merchant can move them around
 * to suit their language's word order.
 */
export const DEFAULT_CONFIG: StorefrontConfig = {
  colors: {
    accent: '#059669',
    star: '#F5A623',
    verifiedBg: '#ECFDF5',
    verifiedText: '#047857',
    cardBg: '#FFFFFF',
    cardText: '#1F2937',
    border: '#E5E7EB',
  },
  layout: {
    type: 'list',
    columns: 3,
    autoplay: false,
    borderRadius: 8,
    theme: 'modern',
    maxReviews: 10,
    popupDelay: 5,
  },
  text: {
    heading: 'Customer reviews',
    writeReview: 'Write a review',
    noReviews: 'No reviews yet',
    basedOn: 'Based on {count} reviews',
    verifiedBadge: 'Verified Purchase',
    incentivisedBadge: 'Incentivised',
    incentivisedTooltip: 'This reviewer received a discount in exchange for an honest review',
    storeResponse: 'Store response',
    yourRating: 'Your rating',
    yourName: 'Your name',
    yourEmail: 'Your email',
    emailPrivacy: 'Not published. Used only to verify your review.',
    reviewTitle: 'Title',
    reviewBody: 'Your review',
    addPhotos: 'Add photos or video',
    chooseFiles: 'Add photos',
    noFilesSelected: 'No files selected',
    submit: 'Submit review',
    cancel: 'Cancel',
    submitting: 'Submitting…',
    thankYou: 'Thank you. Your review has been submitted for approval.',
    thankYouPublished: 'Thank you for your review.',
    errorGeneric: 'Could not submit your review. Please try again.',
    filterWithPhotos: 'With photos',
    sortRecent: 'Most recent',
    sortHighest: 'Highest rating',
    sortLowest: 'Lowest rating',
    sortHelpful: 'Most helpful',
    showingCount: 'Showing {first}–{last} of {total} reviews',
    noMatchFilter: 'No reviews match that filter.',
    helpful: 'Helpful',
    helpfulThanks: 'Thanks for the feedback',
    seeAll: 'See all reviews',
    close: 'Close',
  },
  behaviour: {
    showHistogram: true,
    showFilters: true,
    showWriteButton: true,
    showVerifiedBadge: true,
    showSourceBadge: false,
    showReviewerLocation: true,
    showDates: true,
    showReply: true,
    showHelpful: true,
    showMedia: true,
    allowPhotos: true,
    allowVideo: true,
    requireEmail: true,
    autoPublish: false,
    allowAnonymous: false,
    minReviewLength: 5,
    perPage: 5,
    defaultSort: 'recent',
  },
  customCss: '',
  // Overwritten from the plan in getStorefrontConfig. The default is the paid
  // behaviour, so a failure anywhere upstream leaves a storefront unbranded rather than
  // stamping one that has paid not to be.
  branding: false,
};

/** StoreSetting keys are namespaced so they cannot collide with anything else. */
const PREFIX = 'sf.';

/** The custom CSS blob lives outside the group/field scheme. */
const CSS_KEY = `${PREFIX}customCss`;

/**
 * Allowed ranges for numeric behaviour and layout values.
 *
 * A single global clamp was wrong: perPage genuinely belongs in 1–50, but minReviewLength
 * must be allowed to be 0 (no minimum) and popupDelay is measured in seconds.
 */
const NUMERIC_RANGES: Record<string, [number, number]> = {
  'behaviour.perPage': [1, 50],
  'behaviour.minReviewLength': [0, 1000],
  'layout.columns': [1, 6],
  'layout.borderRadius': [0, 40],
  'layout.maxReviews': [1, 50],
  'layout.popupDelay': [0, 120],
};

function clampNumber(group: string, field: string, n: number, fallback: number): number {
  const range = NUMERIC_RANGES[`${group}.${field}`];
  if (!range) return Number.isFinite(n) ? n : fallback;
  return Math.min(range[1], Math.max(range[0], Math.round(n)));
}

function flatten(config: StorefrontConfig): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(config.colors)) out[`${PREFIX}color.${k}`] = String(v);
  for (const [k, v] of Object.entries(config.layout)) out[`${PREFIX}layout.${k}`] = String(v);
  for (const [k, v] of Object.entries(config.text)) out[`${PREFIX}text.${k}`] = String(v);
  for (const [k, v] of Object.entries(config.behaviour)) out[`${PREFIX}behaviour.${k}`] = String(v);
  return out;
}

/** The full set of valid keys, so an unknown key from a request can be rejected. */
export const VALID_KEYS = new Set([...Object.keys(flatten(DEFAULT_CONFIG)), CSS_KEY]);

const HEX = /^#[0-9a-fA-F]{3,8}$/;

/**
 * Sanitise merchant-authored CSS before it is injected into their storefront.
 *
 * The threat model is not "a merchant attacks themselves" — it is a compromised merchant
 * account, or a staff member with admin access, turning the review widget into a delivery
 * mechanism aimed at shoppers. So:
 *
 *   - `<` and `>` are stripped, which makes `</style>` breakout impossible.
 *   - `@import` is removed: it fetches and executes a stylesheet from a third-party origin,
 *     which is both an exfiltration channel (via selectors) and a hard dependency on
 *     someone else's uptime on the merchant's product page.
 *   - `expression(` (legacy IE) and `javascript:` are removed — both execute script.
 *   - `url()` is restricted to https and data: images. `url(http://…)` is mixed content on
 *     an HTTPS storefront; anything else is a fetch we should not be making.
 *
 * Not a sandbox, and not sold as one. It closes the paths that turn CSS into script.
 */
export function sanitiseCss(raw: string): string {
  return String(raw ?? '')
    .slice(0, 20000)
    .replace(/[<>]/g, '')
    .replace(/@import[^;]*;?/gi, '')
    .replace(/expression\s*\(/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/url\s*\(\s*(['"]?)(?!https:|data:image\/)[^)]*\)/gi, 'none');
}

/** Coerce one persisted string into the shape the config field expects. */
function applyValue(
  target: Record<string, unknown>,
  group: string,
  field: string,
  raw: string
): void {
  const current = target[field];
  if (typeof current === 'boolean') {
    target[field] = raw === 'true';
  } else if (typeof current === 'number') {
    const n = Number(raw);
    if (Number.isFinite(n)) target[field] = clampNumber(group, field, n, current);
  } else {
    target[field] = raw;
  }
}

function emptyConfig(): StorefrontConfig {
  return {
    colors: { ...DEFAULT_CONFIG.colors },
    layout: { ...DEFAULT_CONFIG.layout },
    text: { ...DEFAULT_CONFIG.text },
    behaviour: { ...DEFAULT_CONFIG.behaviour },
    customCss: DEFAULT_CONFIG.customCss,
    // Assume the paid behaviour until the plan says otherwise. If the plan lookup fails
    // the widget stays clean rather than stamping a paying merchant's storefront.
    branding: false,
  };
}

/**
 * Read a store's config, merged over the defaults.
 *
 * A missing row means "use the default", so adding a new configurable string in a later
 * release does not require backfilling every existing store.
 *
 * @param placement When given, the active widget for that placement (falling back to the
 *   store's product_page widget, then any all_pages widget) layers its own layout and
 *   display choices on top. This is what makes the Widgets page do something.
 */
export async function getStorefrontConfig(
  storeId: string,
  placement?: string | null
): Promise<StorefrontConfig> {
  const rows = await db.storeSetting.findMany({
    where: { storeId, key: { startsWith: PREFIX } },
    select: { key: true, value: true },
  });

  const config = emptyConfig();

  for (const row of rows) {
    if (row.key === CSS_KEY) {
      config.customCss = sanitiseCss(row.value);
      continue;
    }

    const rest = row.key.slice(PREFIX.length);
    const dot = rest.indexOf('.');
    if (dot === -1) continue;
    const group = rest.slice(0, dot);
    const field = rest.slice(dot + 1);

    if (group === 'color' && field in config.colors) {
      // Only accept a hex colour. This string goes into a CSS custom property that is
      // interpolated into a style attribute, so an unvalidated value is a CSS injection
      // vector on the merchant's storefront.
      if (HEX.test(row.value)) {
        (config.colors as Record<string, string>)[field] = row.value;
      }
    } else if (group === 'layout' && field in config.layout) {
      if (field === 'type' && !LAYOUTS.includes(row.value as LayoutType)) continue;
      applyValue(config.layout as unknown as Record<string, unknown>, group, field, row.value);
    } else if (group === 'text' && field in config.text) {
      (config.text as Record<string, string>)[field] = row.value;
    } else if (group === 'behaviour' && field in config.behaviour) {
      applyValue(config.behaviour as unknown as Record<string, unknown>, group, field, row.value);
    }
  }

  if (placement !== undefined) {
    await applyActiveWidget(storeId, placement, config);
  }

  // Resolved from the plan rather than from a setting, and last, so nothing above can
  // overwrite it. The attribution is what the Free tier trades for being free — and what
  // "white label" on the paid tiers actually removes. Before this, the widget carried no
  // attribution at all, so every store already had white label and the paid feature had
  // nothing to take away.
  config.branding = !PLANS[await getStorePlan(storeId)].whiteLabel;

  return config;
}

/**
 * Layer the merchant's chosen widget for this placement over the account-wide config.
 *
 * Placement resolution is deliberately forgiving. A merchant who built one carousel and
 * dropped the block on their home page should see a carousel, not silently fall back to a
 * list because they picked "Product Page" in a dropdown three screens away. So: exact
 * placement first, then `all_pages`, then whatever single active widget exists.
 */
async function applyActiveWidget(
  storeId: string,
  placement: string | null,
  config: StorefrontConfig
): Promise<void> {
  const candidates = await db.widgetConfig.findMany({
    where: { storeId, isActive: true },
    orderBy: { createdAt: 'desc' },
    select: { widgetType: true, placement: true, config: true },
  });
  if (!candidates.length) return;

  const chosen =
    (placement && candidates.find((w) => w.placement === placement)) ||
    candidates.find((w) => w.placement === 'all_pages') ||
    (candidates.length === 1 ? candidates[0] : null);

  if (!chosen) return;

  if (LAYOUTS.includes(chosen.widgetType as LayoutType)) {
    config.layout.type = chosen.widgetType as LayoutType;
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(chosen.config || '{}');
  } catch {
    return;
  }

  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const bool = (v: unknown): boolean | null =>
    typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : null;

  const columns = num(raw.columns);
  if (columns !== null) config.layout.columns = clampNumber('layout', 'columns', columns, 3);

  const radius = num(raw.borderRadius);
  if (radius !== null) config.layout.borderRadius = clampNumber('layout', 'borderRadius', radius, 8);

  const maxReviews = num(raw.maxReviews);
  if (maxReviews !== null) {
    config.layout.maxReviews = clampNumber('layout', 'maxReviews', maxReviews, 10);
    // The widget's "max reviews" is what a shopper sees per view, which is the same thing
    // pagination calls a page. Keeping them separate produced a carousel that claimed 12
    // slides and rendered 5.
    config.behaviour.perPage = config.layout.maxReviews;
  }

  const delay = num(raw.popupDelay);
  if (delay !== null) config.layout.popupDelay = clampNumber('layout', 'popupDelay', delay, 5);

  const autoplay = bool(raw.autoPlay);
  if (autoplay !== null) config.layout.autoplay = autoplay;

  const map: Array<[string, keyof StorefrontConfig['behaviour']]> = [
    ['showPhotos', 'showMedia'],
    ['showVerified', 'showVerifiedBadge'],
    ['showSource', 'showSourceBadge'],
    ['showReply', 'showReply'],
    ['showHelpful', 'showHelpful'],
  ];
  for (const [from, to] of map) {
    const v = bool(raw[from]);
    if (v !== null) (config.behaviour as Record<string, unknown>)[to] = v;
  }

  if (typeof raw.starColor === 'string' && HEX.test(raw.starColor)) {
    config.colors.star = raw.starColor;
  }
  if (typeof raw.backgroundColor === 'string' && HEX.test(raw.backgroundColor)) {
    config.colors.cardBg = raw.backgroundColor;
  }
  if (typeof raw.textColor === 'string' && HEX.test(raw.textColor)) {
    config.colors.cardText = raw.textColor;
  }
  if (typeof raw.sortBy === 'string') {
    const sort = raw.sortBy === 'newest' ? 'recent' : raw.sortBy;
    if (['recent', 'highest', 'lowest', 'helpful'].includes(sort)) {
      config.behaviour.defaultSort = sort;
    }
  }
}

/**
 * Persist a partial config.
 *
 * Validates every key against VALID_KEYS. Without that, the settings endpoint becomes an
 * arbitrary key-value store on the merchant's row — and the storefront reads from that
 * table.
 */
export async function saveStorefrontConfig(
  storeId: string,
  updates: Record<string, string>
): Promise<{ saved: number; rejected: string[] }> {
  const rejected: string[] = [];
  let saved = 0;

  for (const [key, rawValue] of Object.entries(updates)) {
    if (!VALID_KEYS.has(key)) {
      rejected.push(key);
      continue;
    }

    let value = String(rawValue);

    if (key === CSS_KEY) {
      value = sanitiseCss(value);
    } else if (key.startsWith(`${PREFIX}color.`)) {
      if (!HEX.test(value)) {
        rejected.push(key);
        continue;
      }
    } else if (key === `${PREFIX}layout.type`) {
      if (!LAYOUTS.includes(value as LayoutType)) {
        rejected.push(key);
        continue;
      }
    } else if (key === `${PREFIX}layout.theme`) {
      // This value becomes a CSS class on the widget root. Unvalidated, any string the
      // Settings screen sent would be persisted and rendered — THEMES was exported and
      // then never used to check anything.
      if (!THEMES.includes(value as (typeof THEMES)[number])) {
        rejected.push(key);
        continue;
      }
    } else if (key.startsWith(`${PREFIX}text.`)) {
      // Cap length, and strip angle brackets. Merchant copy is rendered into the widget;
      // treating it as trusted HTML would let a compromised merchant account inject script
      // into their own storefront, and more importantly it makes the widget's escaping
      // rules inconsistent depending on where a string came from.
      value = value.slice(0, 500).replace(/[<>]/g, '');
    }

    await db.storeSetting.upsert({
      where: { storeId_key: { storeId, key } },
      create: { storeId, key, value },
      update: { value },
    });
    saved++;
  }

  return { saved, rejected };
}

/** Reset everything to defaults by deleting the overrides. */
export async function resetStorefrontConfig(storeId: string): Promise<void> {
  await db.storeSetting.deleteMany({ where: { storeId, key: { startsWith: PREFIX } } });
}

/**
 * The subset the submission endpoint needs, without paying for the full merge.
 *
 * Submission is on the shopper's critical path and only cares about four values, so it
 * reads four rows rather than every string the merchant has ever customised.
 */
export async function getSubmissionRules(storeId: string): Promise<{
  autoPublish: boolean;
  allowAnonymous: boolean;
  minReviewLength: number;
  allowPhotos: boolean;
  allowVideo: boolean;
  requireEmail: boolean;
}> {
  const keys = [
    'autoPublish',
    'allowAnonymous',
    'minReviewLength',
    'allowPhotos',
    'allowVideo',
    'requireEmail',
  ];
  const rows = await db.storeSetting.findMany({
    where: { storeId, key: { in: keys.map((k) => `${PREFIX}behaviour.${k}`) } },
    select: { key: true, value: true },
  });

  const out = {
    autoPublish: DEFAULT_CONFIG.behaviour.autoPublish,
    allowAnonymous: DEFAULT_CONFIG.behaviour.allowAnonymous,
    minReviewLength: DEFAULT_CONFIG.behaviour.minReviewLength,
    allowPhotos: DEFAULT_CONFIG.behaviour.allowPhotos,
    allowVideo: DEFAULT_CONFIG.behaviour.allowVideo,
    requireEmail: DEFAULT_CONFIG.behaviour.requireEmail,
  };

  for (const row of rows) {
    const field = row.key.slice(`${PREFIX}behaviour.`.length);
    if (field === 'minReviewLength') {
      const n = Number(row.value);
      if (Number.isFinite(n)) out.minReviewLength = clampNumber('behaviour', field, n, out.minReviewLength);
    } else if (field in out) {
      (out as Record<string, unknown>)[field] = row.value === 'true';
    }
  }

  // Video reviews are sold as a Starter-plan feature, and the Settings screen says so.
  // Until now nothing enforced it: a Free-plan merchant could switch the toggle on and
  // accept 50MB uploads into their Shopify Files. Enforced here rather than at the toggle
  // so it holds regardless of what the stored setting says.
  if (out.allowVideo) {
    const plan = await getStorePlan(storeId);
    if (!PLANS[plan].videoReviews) out.allowVideo = false;
  }

  return out;
}
