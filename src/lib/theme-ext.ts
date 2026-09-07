/**
 * The theme app extension, as the admin needs to refer to it.
 *
 * The UUID is assigned by Shopify when the extension is deployed. It is the same for every
 * store the app is installed on and only changes if the extension is deleted and
 * re-created, so it can be overridden by environment without a rebuild.
 *
 * Lived as a private constant inside WidgetsPage until the Questions screen needed the
 * same link; one copy here so the two cannot drift.
 */
export const THEME_EXT_UUID =
  process.env.NEXT_PUBLIC_THEME_EXT_UUID || '019fa7a3-4150-7e81-85fa-1980189ff629';

/** Block handles are the filenames under extensions/reviewmaster/blocks, minus .liquid. */
export type ThemeBlock = 'review-list' | 'star-rating' | 'questions';

/**
 * A deep link into the theme editor with one of our app blocks already added to the
 * product template, so the merchant only has to press Save.
 *
 * "Install, see nothing change on the storefront, uninstall" is the most common way a
 * storefront app loses a merchant: the widget lives in an app block, and nothing else in
 * the app puts it there. This link is the fix.
 */
export function themeEditorAddBlockUrl(
  shopifyDomain: string,
  block: ThemeBlock,
  template = 'product'
): string {
  const handle = shopifyDomain.replace(/\.myshopify\.com$/, '');
  return (
    `https://admin.shopify.com/store/${handle}/themes/current/editor` +
    `?template=${template}&addAppBlockId=${THEME_EXT_UUID}/${block}&target=mainSection`
  );
}
