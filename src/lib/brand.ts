/**
 * Marka Reviews: the name, colours and marks, from the Marka Universal Brand Guidelines
 * (v1.0, 1 October 2026). One place, so no screen invents its own shade of navy.
 *
 * The app was called ReviewMaster until October 2026. Only what people SEE was renamed.
 * The app handle (reviewmaster-reviews), the theme extension handle (reviewmaster), the
 * App Store URL (apps.shopify.com/reviewmaster), cookie names, locale keys, CSS classes
 * and DOM ids all keep the old name on purpose: live stores depend on every one of them,
 * and none of them is shown to a merchant or a shopper.
 *
 * Where each surface sits in the guidelines' "one brand, four contexts":
 *   - Embedded admin (inside Shopify): app identity and the palette; Shopify's own font
 *     and conventions take priority.
 *   - Operator portal, legal pages: Marka-owned, so Archivo and the full palette.
 *   - Storefront widget: the merchant's settings win; these are only the defaults.
 */

export const APP_NAME = 'Marka Reviews';
/** For "formerly ReviewMaster" lines only. Never use it as the name. */
export const FORMER_APP_NAME = 'ReviewMaster';

/**
 * The attribution line a Free-plan store carries: the 20 px icon plus these words, under
 * the storefront widget and under the review invitation email. It is identity, not a claim
 * — the "Verified by Marka" badge is reserved for where a purchase really was verified.
 */
export const POWERED_BY = `Powered by ${APP_NAME}`;
/** Where the attribution links. The listing URL keeps the old handle on purpose. */
export const APP_STORE_URL = 'https://apps.shopify.com/reviewmaster';

/** The named colours. Navy first; warm accents with purpose. */
export const BRAND = {
  /** Identity, text, primary actions. */
  navy: '#1B3358',
  /** Brand emphasis and illustration; the default star colour. Never an error state. */
  orange: '#E8871E',
  /** Highlights and accent actions (always with a navy label). */
  amber: '#FFC24B',
  /** Warm surfaces, reverse text. */
  cream: '#FDF1DE',
} as const;

export const NEUTRAL = {
  canvas: '#FAF6F0',
  paper: '#FFFDF9',
  white: '#FFFFFF',
  muted: '#5A6675',
  border: '#E4DED4',
  controlBorder: '#7B8794',
} as const;

/** Interface states. Always paired with text or an icon. */
export const SEMANTIC = {
  success: '#19734B',
  error: '#B42318',
  warning: '#8A5000',
  info: '#1B5E9B',
} as const;

export const BRAND_ASSETS = {
  /** The Marka Reviews logo as supplied: the review bubble with the tick-star. A raster,
      resized only; there is no vector master yet. */
  icon: '/brand/marka-reviews-icon-64.png',
  icon96: '/brand/marka-reviews-icon-96.png',
  /** The "Verified by Marka" badge as supplied, 600 x 200 (3:1). A PNG, so the same file
      works in email, where SVG does not render. */
  badge: '/brand/verified-by-marka.png',
  badgePng: '/brand/verified-by-marka.png',
  /** The tick-star as supplied (transparent; the tick is cut out): the Marka star rating
      icon. */
  tickStar: '/brand/tick-star-96.png',
  starPng: '/brand/star-filled.png',
  starEmptyPng: '/brand/star-empty.png',
} as const;

/** The default star colour, and the one it replaced. A store still on the old default gets the new one. */
export const DEFAULT_STAR_COLOR = BRAND.orange;
export const LEGACY_DEFAULT_STAR_COLORS = ['#F5A623'];

/** Unfilled stars. Decorative: the rating itself is always available as text. */
export const EMPTY_STAR_COLOR = '#D9D3C7';

/**
 * The Marka star rating icon: a bold star with a tick cut out of it, in a 24x24 box. The
 * default for every rating, the "Verified Purchase" badge and the "Verified by Marka" badge.
 *
 * A star shape is a display choice, not a claim: what marks a review as tied to a real
 * order is the "Verified Purchase" badge, in words. A merchant who would rather not show a
 * tick on every rating switches to the classic star in Settings -> Display.
 */
export const TICK_STAR_PATH =
  'M11.28 1.31C10.73 1.59 10.64 1.77 9.56 4.39C7.83 8.56 8.2 8.2 4.67 8.38C1.13 8.47 .95 8.56 .59 9.37C.32 10.37 .41 10.46 2.94 12.72C6.48 15.71 6.3 14.99 4.67 20.06C4.12 21.6 4.21 22.23 4.94 22.69C5.66 23.14 5.84 23.05 8.74 21.42C12.27 19.33 11.73 19.33 15.26 21.42C18.16 23.05 18.34 23.14 19.06 22.69C19.88 22.14 19.88 21.78 18.97 18.7C17.8 15.17 17.7 15.53 20.87 12.81C23.41 10.64 23.5 10.64 23.5 9.92C23.5 8.83 22.96 8.56 21.06 8.47L19.88 8.38L20.15 8.65C20.42 9.01 20.51 9.19 20.42 9.46C20.42 9.74 15.08 14.81 12 17.61C11.19 18.34 11.19 18.34 8.56 15.89C6.39 13.81 6.3 13.72 7.29 12.91C8.11 12.18 8.2 12.27 9.92 13.81C11.28 15.08 11.28 15.08 11.82 14.72C12.36 14.26 15.26 11.55 16.98 9.92L18.61 8.38L17.8 8.29C16.07 8.2 15.98 8.11 14.54 4.67C13.9 3.22 13.36 1.86 13.27 1.77C12.81 1.13 11.91 .95 11.28 1.31Z';

/** The classic star: the "one bold star" of the guidelines' Marka Reviews icon. */
export const CLASSIC_STAR_PATH =
  'M11.51 1.22C10.71 1.49 10.52 1.69 9.73 3.4C7.82 7.42 7.82 7.49 7.49 7.62C7.35 7.62 6.04 7.88 4.59 8.08C1.22 8.61 1.03 8.61 .63 9.4C.24 10.32 .5 10.91 1.69 11.97C2.15 12.36 2.94 13.02 3.47 13.48C5.51 15.26 5.38 15.13 5.31 15.59C4.92 17.24 4.19 20.93 4.19 21.26C4.19 22.25 4.92 22.91 5.97 22.84C6.43 22.78 6.5 22.78 8.41 21.72C11.04 20.2 11.24 20.14 11.57 19.94L11.9 19.81L12.23 19.94C12.43 20.07 13.29 20.47 14.08 20.93C17.37 22.78 17.44 22.78 17.9 22.84C18.82 22.91 19.61 22.25 19.74 21.33C19.74 21.06 19.61 20.34 19.15 18.1C18.82 16.51 18.56 15.2 18.62 15.13C18.62 15 19.41 14.34 21.92 12.03C23.3 10.78 23.43 10.58 23.43 9.79C23.43 9.4 23.37 9.07 23.04 8.74C22.58 8.21 22.64 8.21 18.69 7.75C17.44 7.62 16.38 7.49 16.32 7.42C16.18 7.42 15.99 7.02 15.66 6.37C14.08 3.07 13.55 1.95 13.35 1.75C12.89 1.29 12.1 1.09 11.51 1.22Z';

/** The star shapes a merchant can choose for ratings on their storefront. */
export type StarStyle = 'tick' | 'classic';

/**
 * A storefront font family a merchant may type: names, spaces, commas and hyphens, starting
 * with a letter. Shared by the Settings screen and the server, which enforces it.
 */
export const FONT_FAMILY_PATTERN = /^[A-Za-z][A-Za-z0-9 ,-]{0,79}$/;
export const DEFAULT_STAR_STYLE: StarStyle = 'tick';

/** Every rating, by default. */
export const RATING_STAR_PATH = TICK_STAR_PATH;
/** The mark before "Verified Purchase". */
export const VERIFIED_MARK_PATH = TICK_STAR_PATH;

/** Map a retired default onto the brand default; leave a merchant's own choice alone. */
export function brandStarColor(hex: string | null | undefined): string {
  if (!hex) return DEFAULT_STAR_COLOR;
  const h = hex.trim().toLowerCase();
  return LEGACY_DEFAULT_STAR_COLORS.some((c) => c.toLowerCase() === h) ? DEFAULT_STAR_COLOR : hex;
}

function luminance(hex: string): number | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  else if (h.length === 8) h = h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio between two hex colours, or null if either is not a colour. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a);
  const lb = luminance(b);
  if (la == null || lb == null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
