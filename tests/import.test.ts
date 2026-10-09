/**
 * Offline tests for the import matcher and parser.
 *
 * Run with:  npx --yes bun@latest run tests/import.test.ts
 *
 * The matcher decides which product a review lands on, and a wrong answer is worse than
 * none: a merchant fixes an unattached review and never notices a misattached one. The
 * cases here are the ones a real catalogue produced — titles that differ only in case, an
 * emoji or punctuation and so normalise to the same key — plus the parser's handling of
 * the doubled-quote escape that the manual-entry path relies on.
 */

import assert from 'node:assert';
import { buildMatchIndex, matchProduct, mapRows, detectColumns, parseCSV } from '../src/lib/import';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

const catalogue = [
  { id: 'a', shopifyId: '1', handle: 'amethyst-stone-bracelet', title: 'Amethyst stone bracelet' },
  { id: 'b', shopifyId: '2', handle: 'amethyst-stone-bracelet-1', title: 'Amethyst Stone Bracelet' },
  { id: 'c', shopifyId: '3', handle: 'silver-coin', title: 'Divine Hindu Lakshmi–Ganesh Silver Coin (999 Purity)' },
  { id: 'd', shopifyId: '4', handle: '🎁-silver-coin', title: '🎁 Divine Hindu Lakshmi–Ganesh Silver Coin (999 Purity)' },
  { id: 'e', shopifyId: '5', handle: 'rudraksha-mala', title: '1 - 14 Mukhi Rudraksha Mala' },
];
const map = { productTitle: 'product_title', productHandle: 'product_handle', productId: 'product_id' };

console.log('product matching');

test('titles that normalise to one key are indexed together, not last-wins', () => {
  const index = buildMatchIndex(catalogue);
  assert.deepStrictEqual(index.byTitle.get('amethyst stone bracelet'), ['a', 'b']);
  assert.deepStrictEqual(index.byTitle.get('divine hindu lakshmi ganesh silver coin 999 purity'), ['c', 'd']);
  assert.deepStrictEqual(index.byTitle.get('1 14 mukhi rudraksha mala'), ['e']);
});

test('a title shared by two products is ambiguous and matches neither', () => {
  const index = buildMatchIndex(catalogue);
  const m = matchProduct({ product_title: 'Amethyst Stone Bracelet' }, map, index, null);
  assert.strictEqual(m.productId, null);
  assert.strictEqual(m.matchedBy, null);
  assert.strictEqual(m.titleMatches, 2);
});

test('an ambiguous title is not sent to the fallback product either', () => {
  // The row named a product; the fallback is for rows that name none.
  const index = buildMatchIndex(catalogue);
  const m = matchProduct({ product_title: '🎁 Divine Hindu Lakshmi–Ganesh Silver Coin (999 Purity)' }, map, index, 'e');
  assert.strictEqual(m.productId, null);
  assert.strictEqual(m.titleMatches, 2);
});

test('a unique title still matches, and handle beats an ambiguous title', () => {
  const index = buildMatchIndex(catalogue);
  const unique = matchProduct({ product_title: '1-14 Mukhi Rudraksha Mala' }, map, index, null);
  assert.deepStrictEqual(unique, { productId: 'e', matchedBy: 'title' });
  const byHandle = matchProduct({ product_title: 'Amethyst Stone Bracelet', product_handle: 'Amethyst-Stone-Bracelet-1' }, map, index, null);
  assert.deepStrictEqual(byHandle, { productId: 'b', matchedBy: 'handle' });
  const byId = matchProduct({ product_title: 'Amethyst Stone Bracelet', product_id: 'gid://shopify/Product/1' }, map, index, null);
  assert.deepStrictEqual(byId, { productId: 'a', matchedBy: 'shopifyId' });
});

test('a row with no product signal at all goes to the fallback', () => {
  const index = buildMatchIndex(catalogue);
  assert.deepStrictEqual(matchProduct({ product_title: '' }, map, index, 'c'), { productId: 'c', matchedBy: 'fallback' });
  assert.deepStrictEqual(matchProduct({ product_title: 'No such thing' }, map, index, null), { productId: null, matchedBy: null });
});

console.log('mapRows');

test('an ambiguous row is skipped with a reason that names the fix', () => {
  const headers = ['product_title', 'product_handle', 'rating', 'author', 'content'];
  const columns = detectColumns(headers);
  const index = buildMatchIndex(catalogue);
  const rows = [
    { product_title: 'Amethyst Stone Bracelet', product_handle: '', rating: '5', author: 'Asha', content: 'Lovely' },
    { product_title: 'Amethyst Stone Bracelet', product_handle: 'amethyst-stone-bracelet', rating: '4', author: 'Ravi', content: 'Good' },
    { product_title: 'Divine Hindu Lakshmi–Ganesh Silver Coin (999 Purity)', product_handle: '', rating: '5', author: 'Meera', content: 'Shiny' },
  ];
  const { reviews, errors } = mapRows(rows, columns, index, { fallbackProductId: 'e', defaultSource: 'csv' });
  assert.deepStrictEqual(errors, [
    { row: 2, reason: 'Title matches 2 products — add product_handle' },
    { row: 4, reason: 'Title matches 2 products — add product_handle' },
  ]);
  assert.strictEqual(reviews.length, 1);
  assert.strictEqual(reviews[0].reviewerName, 'Ravi');
  assert.strictEqual(reviews[0].productId, 'a');
  assert.strictEqual(reviews[0].matchedBy, 'handle');
});

test('a blank status is not given: the import default applies, not "unpublished"', () => {
  // The Excel template always has a status column and every row but the example starts
  // blank. Reading blank as false imported whole sheets hidden.
  const columns = detectColumns(['product_handle', 'rating', 'author', 'content', 'status']);
  assert.strictEqual(columns.isPublished, 'status');
  const index = buildMatchIndex(catalogue);
  const row = (status: string) => ({ product_handle: 'silver-coin', rating: '5', author: 'Asha', content: 'Lovely', status });
  const statuses = ['', '   ', 'approved', 'Published', 'pending', 'rejected', 'false'];
  const published = (opts: { autoPublish?: boolean }) =>
    mapRows(statuses.map(row), columns, index, { defaultSource: 'csv', ...opts }).reviews.map((r) => r.isPublished);
  assert.deepStrictEqual(published({}), [true, true, true, true, false, false, false]);
  // A caller that imports hidden by default still gets hidden for a blank, and the file
  // can still publish a row explicitly.
  assert.deepStrictEqual(published({ autoPublish: false }), [false, false, true, true, false, false, false]);
  // No status column at all: the default, as before.
  const noStatus = detectColumns(['product_handle', 'rating', 'author', 'content']);
  assert.strictEqual(mapRows([row('pending')], noStatus, index, {}).reviews[0].isPublished, true);
});

console.log('parseCSV');

test('a doubled quote inside a quoted field reads back as one quote', () => {
  // What the manual-entry path sends for a reviewer called John "JJ" Smith.
  const csv = 'reviewerName,rating,title,body\n"John ""JJ"" Smith","5","","Say ""hi"", they said"';
  const { headers, rows } = parseCSV(csv);
  assert.deepStrictEqual(headers, ['reviewerName', 'rating', 'title', 'body']);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].reviewerName, 'John "JJ" Smith');
  assert.strictEqual(rows[0].body, 'Say "hi", they said');
});

console.log(`\n${passed} passed`);
