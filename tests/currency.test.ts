/**
 * Offline tests for the shop-currency helpers. Pure parts only; nothing here touches the
 * database or Shopify. Run with:
 *
 *   npx --yes bun@latest run tests/currency.test.ts
 *
 * Why these exist: the products page printed every price with a "$" in front, so a store
 * selling in rupees was shown its catalogue in dollars. Prices now carry the shop's own
 * currency, read from Shopify, and fall back to a bare number (never a guessed symbol)
 * while that is unknown.
 *
 * Expected strings pass an explicit locale so they do not depend on the machine running
 * them. Intl's spacing differs between locales and ICU versions (some insert U+00A0 or
 * U+202F), so whitespace is normalised before comparing.
 */

import assert from 'node:assert';
import { fixedAmountHelp, formatMoney, normaliseCurrencyCode } from '../src/lib/money';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Collapse every kind of space Intl may emit (including U+00A0 and U+202F) into one. */
const norm = (s: string) => s.replace(/[\s  ]+/g, ' ');

console.log('\nformatMoney');

test('INR shows the rupee sign and two decimals', () => {
  assert.strictEqual(norm(formatMoney(1499, 'INR', 'en-IN')), '₹1,499.00');
  // Lakh grouping needs the runtime's en-IN data; a slimmer ICU build groups in thousands.
  // Either is fine here: the symbol and the two decimals are what this code decides.
  assert.match(norm(formatMoney(149999.5, 'INR', 'en-IN')), /^₹(1,49,999|149,999)\.50$/);
});

test('USD shows the dollar sign', () => {
  assert.strictEqual(norm(formatMoney(24, 'USD', 'en-US')), '$24.00');
  assert.strictEqual(norm(formatMoney(1234.5, 'USD', 'en-US')), '$1,234.50');
});

test('JPY has no minor unit, so no decimals', () => {
  assert.strictEqual(norm(formatMoney(1500, 'JPY', 'en-US')), '¥1,500');
  assert.strictEqual(norm(formatMoney(1499.6, 'JPY', 'en-US')), '¥1,500');
  // ICU builds disagree on the half- or full-width yen sign for ja-JP; the decimals are the point.
  assert.match(norm(formatMoney(1500, 'JPY', 'ja-JP')), /^[¥￥]1,500$/);
});

test('the currency decides the symbol, not the viewer’s locale', () => {
  // A merchant reading the admin in en-US still sees rupees for a rupee store.
  assert.strictEqual(norm(formatMoney(1499, 'INR', 'en-US')), '₹1,499.00');
  // And a viewer in India sees dollars for a dollar store, unambiguously marked.
  assert.match(norm(formatMoney(24, 'USD', 'en-IN')), /^(US)?\$24\.00$/);
});

test('the default locale still names the currency', () => {
  const out = formatMoney(1499, 'INR');
  assert.ok(out.includes('499'), out);
  assert.ok(/₹|INR|Rs/.test(out), `expected a rupee marker in ${out}`);
  assert.ok(!out.includes('$'), out);
});

test('a lower-case or padded code is accepted', () => {
  assert.strictEqual(norm(formatMoney(10, ' inr ', 'en-IN')), '₹10.00');
});

test('no currency yet gives a plain two-decimal number, not a guessed "$"', () => {
  assert.strictEqual(formatMoney(1499, null), '1499.00');
  assert.strictEqual(formatMoney(1499, undefined), '1499.00');
  assert.strictEqual(formatMoney(0.5, ''), '0.50');
});

test('an invalid code falls back to the plain number instead of throwing', () => {
  // Each of these makes Intl.NumberFormat throw a RangeError if handed over directly.
  for (const bad of ['US', 'DOLLAR', '12$', 'U$D', '₹']) {
    assert.throws(() => new Intl.NumberFormat('en-US', { style: 'currency', currency: bad }), RangeError);
    assert.strictEqual(formatMoney(19.9, bad, 'en-US'), '19.90', bad);
  }
});

test('a RangeError from Intl itself is caught (a malformed locale tag)', () => {
  assert.throws(() => new Intl.NumberFormat('not a locale!', { style: 'currency', currency: 'USD' }), RangeError);
  assert.strictEqual(formatMoney(19.9, 'USD', 'not a locale!'), '19.90');
});

test('XXX (ISO 4217 "no currency") is treated as unknown', () => {
  assert.strictEqual(formatMoney(5, 'XXX', 'en-US'), '5.00');
});

test('a well-formed code with no symbol is still named, not dropped', () => {
  const out = norm(formatMoney(5, 'AED', 'en-US'));
  assert.ok(out.includes('5.00') && /AED|د\.إ/.test(out), out);
});

test('a non-finite amount renders nothing rather than "NaN"', () => {
  assert.strictEqual(formatMoney(Number.NaN, 'USD', 'en-US'), '');
  assert.strictEqual(formatMoney(Number.POSITIVE_INFINITY, null), '');
});

console.log('\nnormaliseCurrencyCode');

test('accepts Shopify CurrencyCode values as they arrive', () => {
  for (const code of ['INR', 'USD', 'JPY', 'EUR', 'GBP', 'AED']) {
    assert.strictEqual(normaliseCurrencyCode(code), code);
  }
});

test('upper-cases and trims', () => {
  assert.strictEqual(normaliseCurrencyCode('inr'), 'INR');
  assert.strictEqual(normaliseCurrencyCode('  usd\n'), 'USD');
});

test('refuses anything that is not three letters, and XXX', () => {
  for (const bad of [null, undefined, 42, {}, '', 'US', 'USDT', 'U5D', '$', 'XXX', 'xxx']) {
    assert.strictEqual(normaliseCurrencyCode(bad), null, String(bad));
  }
});

console.log('\nfixedAmountHelp');

test('names the currency when it is known', () => {
  assert.strictEqual(fixedAmountHelp('INR'), 'Amount off, in your store’s currency (INR).');
  assert.strictEqual(fixedAmountHelp('usd'), 'Amount off, in your store’s currency (USD).');
});

test('keeps the generic line when it is not', () => {
  const generic = 'Amount off, in your store’s currency.';
  assert.strictEqual(fixedAmountHelp(null), generic);
  assert.strictEqual(fixedAmountHelp(undefined), generic);
  assert.strictEqual(fixedAmountHelp('nonsense'), generic);
  assert.strictEqual(fixedAmountHelp('XXX'), generic);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
