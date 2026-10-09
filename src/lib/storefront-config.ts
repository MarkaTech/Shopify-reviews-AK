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

import { BRAND, contrastRatio, FONT_FAMILY_PATTERN } from './brand';
import { db } from './db';
import { sanitiseCss } from './css-sanitiser';
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

/** Star shapes for every rating: the Marka tick-star (default) or the classic star. */
export const STAR_STYLES = ['tick', 'classic'] as const;

/** The icon before "Verified Purchase": the Marka tick-star (default) or none. */
export const BADGE_ICONS = ['tick', 'none'] as const;

/**
 * A font family the merchant's theme already loads, or empty for the theme's own font.
 *
 * Names, spaces, commas and hyphens only. The value becomes a CSS custom property on the
 * storefront, so anything that could end a declaration or open a function (semicolon,
 * brace, quote, parenthesis, backslash, angle bracket) is refused. Naming a font here does
 * not load it; the guidelines' font policy is "use a font the store already provides".
 */
export const FONT_FAMILY = FONT_FAMILY_PATTERN;

export interface StorefrontConfig {
  colors: {
    accent: string;
    star: string;
    verifiedBg: string;
    verifiedText: string;
    /**
     * Card background, body text and border.
     *
     * Nullable, and null by DEFAULT — these three inherit from the merchant's theme unless
     * they choose otherwise.
     *
     * They used to default to concrete light values (#FFFFFF / #1F2937 / #E5E7EB), which
     * made the CSS's theme-adaptive fallbacks — `var(--rm-card-bg, transparent)` and
     * `var(--rm-card-text, inherit)` — unreachable dead code. Every store got white cards
     * with dark text, so a shop on a dark theme rendered a block of white rectangles in the
     * middle of its product page and had to discover the colour pickers to fix it.
     *
     * Null means "do not set the custom property at all", so the fallback applies and the
     * widget takes the theme's own background and text colour. The widget JS already skips
     * any value that is not a hex string, so null needs no handling there.
     */
    cardBg: string | null;
    cardText: string | null;
    border: string | null;
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
    /** Every rating's star shape. See STAR_STYLES. */
    starStyle: string;
    /** The icon before "Verified Purchase". See BADGE_ICONS. */
    badgeIcon: string;
    /** Empty for the theme's font, or a family the theme loads. See FONT_FAMILY. */
    fontFamily: string;
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
   * Whether to show the Marka Reviews attribution under the widget: the app icon at 20 px,
   * the standard attribution Shopify's requirement 5.1 allows in a theme extension.
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
/**
 * Colours a merchant may leave unset, so the widget takes the theme's own.
 *
 * Deliberately not accent/star/verified: those are the widget's identity and have no
 * sensible fallback — an inherited star colour renders invisible stars on some themes.
 */
export const INHERITABLE_COLORS = new Set(['cardBg', 'cardText', 'border']);

/**
 * Colour defaults are Marka presets (brand guidelines v1.0): Navy for the main action with
 * a white label, Marka Orange stars, and a navy "Verified Purchase" badge with a cream
 * label, the badge's own colours. Card colours stay null, so a widget sits on the
 * merchant's theme; and anything a merchant sets wins, as the guidelines require.
 */
export const DEFAULT_CONFIG: StorefrontConfig = {
  colors: {
    accent: BRAND.navy,
    star: BRAND.orange,
    verifiedBg: BRAND.navy,
    verifiedText: BRAND.cream,
    cardBg: null,
    cardText: null,
    border: null,
  },
  layout: {
    type: 'list',
    columns: 3,
    autoplay: false,
    borderRadius: 8,
    theme: 'modern',
    maxReviews: 10,
    popupDelay: 5,
    // The Marka look by default; every one of these is the merchant's to change.
    starStyle: 'tick',
    badgeIcon: 'tick',
    fontFamily: '',
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
  // `v ?? ''`, not `String(v)`. A null colour means "inherit from the merchant's theme",
  // and String(null) writes the literal text "null" — which then fails the hex check on the
  // way back in and is silently discarded, so choosing "use theme colour" would never stick.
  for (const [k, v] of Object.entries(config.colors)) out[`${PREFIX}color.${k}`] = v ?? '';
  for (const [k, v] of Object.entries(config.layout)) out[`${PREFIX}layout.${k}`] = String(v);
  for (const [k, v] of Object.entries(config.text)) out[`${PREFIX}text.${k}`] = String(v);
  for (const [k, v] of Object.entries(config.behaviour)) out[`${PREFIX}behaviour.${k}`] = String(v);
  return out;
}

/**
 * The colour defaults before the Marka rebrand (October 2026).
 *
 * A store whose saved value is still exactly one of these did not choose it: it is what the
 * Settings and widget screens saved back untouched. So it moves to the new default with
 * every other store. A colour a merchant actually picked is left alone.
 *
 * Exported for the tests.
 */
export const LEGACY_DEFAULT_COLORS: Partial<Record<keyof StorefrontConfig['colors'], string>> = {
  accent: '#059669',
  star: '#F5A623',
  verifiedBg: '#ECFDF5',
  verifiedText: '#047857',
};

/**
 * When the rename went live.
 *
 * "Still exactly the old default" only proves nothing was chosen for rows written BEFORE
 * this. Since then the Settings screen has shown navy and orange, so a merchant who typed
 * #059669 after the rename wanted that green — and the remap used to take it away on the
 * very next read, with nothing on the screen to say why. A row's updatedAt against this
 * date is what separates the two.
 */
//
// The instant the renamed Settings screen went live: the af1071b deploy finished at
// 16:46:03Z on 8 October (GitHub Actions run). Midnight that day was 17 hours early — a
// row saved that morning on the OLD screen, which still offered the old green as its
// default, would have been read as a post-rename choice and frozen. Erring late is the
// safe side: a row inside the gap is remapped as it always was.
export const REBRAND_DEPLOYED_AT = new Date('2026-10-08T16:47:00Z');

/** When each colour row was last written, by field. No entry for a field with no row. */
export type ColorSavedAt = Partial<Record<keyof StorefrontConfig['colors'], Date>>;

/**
 * A card background the merchant chose, with card text left to "follow your theme", gets a
 * text colour that reads on that background.
 *
 * The stylesheet pairs its white card fallback with dark fallback text, which is right
 * when neither colour is set. But the background CAN be set on its own — Settings and the
 * widget designer both allow it — and then the CSS text fallback met a background it was
 * never meant for: a dark card on a dark theme got #1f2937 text, unreadable. Publishing a
 * text colour whenever a background is published means the CSS fallback text only ever
 * meets the CSS fallback background.
 */
export function pairCardText(colors: StorefrontConfig['colors']): void {
  const bg = colors.cardBg;
  if (typeof bg !== 'string' || !HEX.test(bg) || colors.cardText) return;
  const onDark = contrastRatio('#1f2937', bg) ?? 0;
  const onLight = contrastRatio('#ffffff', bg) ?? 0;
  colors.cardText = onDark >= onLight ? '#1f2937' : '#ffffff';
}

/**
 * Move the pre-rename defaults to the Marka ones — for values saved before the rename.
 *
 * @param savedAt When each colour was written. A field with no entry is remapped as before:
 *   a legacy value can only arrive from a StoreSetting row, so a missing date means the
 *   caller did not look it up, and the historical behaviour is the safe reading for it.
 */
export function rebrandLegacyDefaults(colors: StorefrontConfig['colors'], savedAt: ColorSavedAt = {}): void {
  const same = (x: string | null | undefined, y: string) => typeof x === 'string' && x.trim().toLowerCase() === y.toLowerCase();
  const chosenAfterRename = (field: keyof StorefrontConfig['colors']) => {
    const at = savedAt[field];
    return at instanceof Date && at.getTime() >= REBRAND_DEPLOYED_AT.getTime();
  };
  // Whether the badge text was ever a merchant's choice, decided before anything is remapped.
  const textWasDefault =
    same(colors.verifiedText, DEFAULT_CONFIG.colors.verifiedText) ||
    (same(colors.verifiedText, LEGACY_DEFAULT_COLORS.verifiedText!) && !chosenAfterRename('verifiedText'));

  for (const [field, legacy] of Object.entries(LEGACY_DEFAULT_COLORS) as Array<[keyof StorefrontConfig['colors'], string]>) {
    if (same(colors[field], legacy) && !chosenAfterRename(field)) {
      (colors as Record<string, string | null>)[field] = DEFAULT_CONFIG.colors[field];
    }
  }

  // The badge text colour is not editable in Settings; only the badge background is. A
  // merchant who chose their own background never chose the text, so it follows the
  // background: navy or cream, whichever reads better on it. Without this, the new cream
  // default would sit unreadably on a light background a merchant picked last year.
  if (textWasDefault && !same(colors.verifiedBg, DEFAULT_CONFIG.colors.verifiedBg)) {
    const onNavy = contrastRatio(BRAND.navy, colors.verifiedBg) ?? 0;
    const onCream = contrastRatio(BRAND.cream, colors.verifiedBg) ?? 0;
    colors.verifiedText = onNavy >= onCream ? BRAND.navy : BRAND.cream;
  }
}

/** The full set of valid keys, so an unknown key from a request can be rejected. */
export const VALID_KEYS = new Set([...Object.keys(flatten(DEFAULT_CONFIG)), CSS_KEY]);

const HEX = /^#[0-9a-fA-F]{3,8}$/;


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

/**
 * The layout fields that become class names, attributes or a CSS custom property on the
 * storefront, checked on the way in and again on the way out. Other fields pass.
 */
function validLayoutValue(field: string, value: string): boolean {
  if (field === 'starStyle') return (STAR_STYLES as readonly string[]).includes(value);
  if (field === 'badgeIcon') return (BADGE_ICONS as readonly string[]).includes(value);
  if (field === 'fontFamily') return value === '' || FONT_FAMILY.test(value);
  return true;
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
    // updatedAt: when a colour was written decides whether a pre-rename default is remapped
    // below, or was chosen after the rename and stays.
    select: { key: true, value: true, updatedAt: true },
  });

  const config = emptyConfig();
  const colorSavedAt: ColorSavedAt = {};

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
      // Only a hex colour, or empty for the inheritable ones. This string goes into a CSS
      // custom property that is interpolated into a style attribute, so an unvalidated value
      // is a CSS injection vector on the merchant's storefront.
      if (row.value === '' && INHERITABLE_COLORS.has(field)) {
        (config.colors as Record<string, string | null>)[field] = null;
      } else if (HEX.test(row.value)) {
        (config.colors as Record<string, string | null>)[field] = row.value;
        colorSavedAt[field as keyof StorefrontConfig['colors']] = row.updatedAt;
      }
    } else if (group === 'layout' && field in config.layout) {
      if (field === 'type' && !LAYOUTS.includes(row.value as LayoutType)) continue;
      if (!validLayoutValue(field, row.value)) continue;
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

  rebrandLegacyDefaults(config.colors, colorSavedAt);
  pairCardText(config.colors);

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

  // The widget designer used to save its own defaults whether or not the merchant touched
  // them (#F5A623 stars, #FFFFFF cards, #1F2937 text), and these silently overrode
  // Settings → Display and the theme: a dark theme got white cards. A widget still holding
  // exactly those never chose them, so they are skipped and the account colours apply.
  // The designer now saves an empty value for "not set".
  const picked = (v: unknown, designerDefault: string): v is string =>
    typeof v === 'string' && HEX.test(v) && v.toLowerCase() !== designerDefault;
  if (picked(raw.starColor, '#f5a623')) {
    config.colors.star = raw.starColor;
  }
  if (picked(raw.backgroundColor, '#ffffff')) {
    config.colors.cardBg = raw.backgroundColor;
  }
  if (picked(raw.textColor, '#1f2937')) {
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
      // Empty means "inherit from the theme", and is only offered for the colours that have
      // a sensible fallback — a blank accent or star colour would render invisible stars.
      const field = key.slice(`${PREFIX}color.`.length);
      const inheritable = INHERITABLE_COLORS.has(field);
      if (!(value === '' && inheritable) && !HEX.test(value)) {
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
    } else if (key.startsWith(`${PREFIX}layout.`)) {
      const field = key.slice(`${PREFIX}layout.`.length);
      if (field === 'fontFamily') value = value.trim().replace(/\s+/g, ' ');
      if (!validLayoutValue(field, value)) {
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

/**
 * The star shape and colour a store chose, for pages the app serves itself (the review page
 * a customer opens from their order email), so they match the store's widget.
 */
export async function getRatingLook(storeId: string): Promise<{ starStyle: string; starColor: string }> {
  const rows = await db.storeSetting.findMany({
    where: { storeId, key: { in: [`${PREFIX}layout.starStyle`, `${PREFIX}color.star`] } },
    select: { key: true, value: true, updatedAt: true },
  });
  const out = { starStyle: DEFAULT_CONFIG.layout.starStyle, starColor: DEFAULT_CONFIG.colors.star };
  // When the star colour was written, so the legacy-default remap below applies the same
  // rule as getStorefrontConfig: the review page must not show a star the widget does not.
  const savedAt: ColorSavedAt = {};
  for (const row of rows) {
    if (row.key.endsWith('.starStyle') && validLayoutValue('starStyle', row.value)) out.starStyle = row.value;
    if (row.key.endsWith('.star') && HEX.test(row.value)) {
      out.starColor = row.value;
      savedAt.star = row.updatedAt;
    }
  }
  const colors = { ...DEFAULT_CONFIG.colors, star: out.starColor };
  rebrandLegacyDefaults(colors, savedAt);
  out.starColor = colors.star;
  return out;
}

export { sanitiseCss };
