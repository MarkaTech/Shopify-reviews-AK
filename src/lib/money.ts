/**
 * A merchant's money: product prices and fixed-amount rewards, in the shop's own currency.
 *
 * Pure, with no database or network import, so the browser bundle, the server and the
 * offline tests all share it.
 *
 * NOT for this app's own plan prices. Shopify bills apps in USD whatever currency the shop
 * trades in, so "$12/month" is correct for every merchant and stays as it is.
 */

/**
 * An ISO 4217 code ("INR"), or null when the value is not one.
 *
 * Shopify's CurrencyCode enum is the source, so a well-formed value is the normal case. The
 * check exists because the value is stored and later handed to Intl, and because one value
 * the enum can carry is useless here: XXX, ISO 4217's "no currency", which Shopify uses for
 * a currency it does not recognise. Intl formats it as "¤1.00", a symbol no merchant reads
 * as anything, so it is treated as unknown rather than stored.
 */
export function normaliseCurrencyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code) || code === 'XXX') return null;
  return code;
}

/**
 * Format an amount in a shop's currency: "₹1,499.00", "$24.00", "¥1,500".
 *
 * The currency decides the symbol and the decimals (yen has none); the locale, the viewer's
 * by default, decides grouping and where the symbol goes. When the currency is unknown (a
 * store installed before it was recorded, or a code the runtime refuses) this returns a
 * plain two-decimal number. Leaving the unit off is the honest answer: the page used to
 * print "$" in front of every price, which told a rupee store its catalogue was in dollars.
 *
 * A non-finite amount gives an empty string rather than "NaN" or "∞".
 *
 * @param locale A BCP 47 tag, or undefined for the runtime's default. Tests pass one so
 *   their expected strings do not depend on the machine they run on.
 */
export function formatMoney(
  amount: number,
  currency: string | null | undefined,
  locale?: string
): string {
  if (!Number.isFinite(amount)) return '';
  const code = normaliseCurrencyCode(currency);
  if (code) {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(amount);
    } catch (err) {
      // RangeError: a code this runtime's Intl refuses, or a malformed locale tag. A price
      // without its symbol is better than a page that fails to render, so fall through.
      if (!(err instanceof RangeError)) throw err;
    }
  }
  return amount.toFixed(2);
}

/**
 * The help line under a fixed-amount reward field, naming the currency when it is known.
 *
 * Shopify mints a fixed-amount discount in the shop's currency; there is no choosing
 * another. "Your store's currency" alone leaves a merchant who sells in several markets
 * guessing which one that is, and the guess decides what every reviewer is given.
 */
export function fixedAmountHelp(currency: string | null | undefined): string {
  const code = normaliseCurrencyCode(currency);
  return code
    ? `Amount off, in your store’s currency (${code}).`
    : 'Amount off, in your store’s currency.';
}
