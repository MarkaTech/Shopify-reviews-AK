/**
 * Offline tests for the two-decimal star average.
 *
 * The average is computed and written in one SQL statement (recomputeProductRating), so
 * there is no JavaScript to call for it. What is tested instead is the rule that statement
 * applies, with Postgres's numeric rounding reproduced exactly in integers, over every
 * average a product with up to 400 reviews can have; plus a check that the statement still
 * says what was tested, and the metafield value built from the result. No database. Run:
 *
 *   npx --yes bun@latest run tests/ratings.test.ts
 *
 * The property that matters: storing two decimals must not change a single one-decimal
 * rating anyone already sees. The star block's default, the review list's summary and the
 * admin's product list all show one decimal, and a stored 4.95 would have shown them 5.0
 * for a product whose mean is 4.946, where they said 4.9 before.
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ratingMetafieldValue } from '../src/lib/ratings';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);
const section = (title: string) => tests.push([`\n${title}`, () => {}]);

/** ROUND(sum / count, places) as Postgres numeric does it: half away from zero, exact. */
function pgRound(sum: number, count: number, places: number): number {
  const scale = 10 ** places;
  // floor(sum * scale / count + 1/2), in integers so nothing is lost to binary fractions.
  return Math.floor((2 * sum * scale + count) / (2 * count));
}

/**
 * The stored average in hundredths, as the SQL computes it:
 * LEAST(ROUND(avg, 2), ROUND(avg, 1) + 0.04).
 */
function storedHundredths(sum: number, count: number): number {
  return Math.min(pgRound(sum, count, 2), pgRound(sum, count, 1) * 10 + 4);
}

/** Every (stars total, review count) a product can have, up to `max` reviews. */
function* everyAverage(max: number): Generator<[number, number]> {
  for (let count = 1; count <= max; count++) {
    for (let sum = count; sum <= 5 * count; sum++) yield [sum, count];
  }
}

section('The stored average');

test('rounded to one decimal, it is exactly the one-decimal rounding of the mean', () => {
  for (const [sum, count] of everyAverage(400)) {
    const stored = storedHundredths(sum, count);
    // ROUND(stored, 1), on a value that is already exact in hundredths.
    const shown = Math.floor((2 * stored + 10) / 20);
    assert.strictEqual(shown, pgRound(sum, count, 1), `${sum}/${count}`);
  }
});

test('and JavaScript readers (Math.round(x * 10) / 10) agree, binary fractions and all', () => {
  // src/app/api/products/route.ts and the storefront's JSON-LD round the float this way.
  for (const [sum, count] of everyAverage(400)) {
    const stored = storedHundredths(sum, count) / 100;
    assert.strictEqual(Math.round(stored * 10) / 10, pgRound(sum, count, 1) / 10, `${sum}/${count}`);
  }
});

test('it is within a hundredth of the mean, and never above its two-decimal rounding', () => {
  let capped = 0;
  for (const [sum, count] of everyAverage(400)) {
    const stored = storedHundredths(sum, count);
    const r2 = pgRound(sum, count, 2);
    assert.ok(stored <= r2, `${sum}/${count} stored above its rounding`);
    assert.ok(r2 - stored <= 1, `${sum}/${count} capped by more than a hundredth`);
    assert.ok(Math.abs(stored / 100 - sum / count) < 0.01, `${sum}/${count}`);
    if (stored !== r2) capped++;
  }
  assert.ok(capped > 0, 'the cap never applied, so this proves nothing about it');
});

test('the merchant example: fifteen ratings averaging 4.93 store 4.93', () => {
  // 74 stars over 15 reviews: the screenshot's "4.93  15 ratings".
  assert.strictEqual(storedHundredths(74, 15), 493);
  // And the window the cap exists for: 989/200 is 4.945, which would round to 4.95 and
  // then show as 5.0 at one decimal. It is stored as 4.94 and shows 4.9, as it always did.
  assert.strictEqual(pgRound(989, 200, 2), 495);
  assert.strictEqual(storedHundredths(989, 200), 494);
});

test('recomputeProductRating still writes exactly that expression', () => {
  const src = readFileSync(join(__dirname, '..', 'src', 'lib', 'ratings.ts'), 'utf8');
  const sql = src.replace(/\s+/g, ' ');
  assert.ok(
    sql.includes(
      'COALESCE( LEAST(ROUND(AVG(r."rating")::numeric, 2), ROUND(AVG(r."rating")::numeric, 1) + 0.04), 0 )::float8'
    ),
    'the average in recomputeProductRating is no longer the rule tested here'
  );
  assert.ok(!sql.includes('ROUND(AVG(r."rating")::numeric, 1), 0)'), 'the one-decimal average is back');
});

section('The reviews.rating metafield');

test('the value carries two decimals, padded, inside the declared 1-5 scale', () => {
  assert.deepStrictEqual(JSON.parse(ratingMetafieldValue(4.93)), { scale_min: '1.0', scale_max: '5.0', value: '4.93' });
  assert.strictEqual(JSON.parse(ratingMetafieldValue(4.9)).value, '4.90');
  assert.strictEqual(JSON.parse(ratingMetafieldValue(5)).value, '5.00');
  assert.strictEqual(JSON.parse(ratingMetafieldValue(1)).value, '1.00');
});

test('every stored average prints as itself (no binary fraction leaks into the string)', () => {
  for (let h = 100; h <= 500; h++) {
    const expected = `${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}`;
    assert.strictEqual(JSON.parse(ratingMetafieldValue(h / 100)).value, expected);
  }
});

let passed = 0;
let failed = 0;
for (const [name, fn] of tests) {
  if (name.startsWith('\n')) {
    console.log(name);
    continue;
  }
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
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
