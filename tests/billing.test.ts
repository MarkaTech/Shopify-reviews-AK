/**
 * Offline tests for the billing route's failure classification and the managed-pricing
 * switches. Pure parts only — nothing here talks to Shopify or the database. Run with:
 *
 *   npx --yes bun@latest run tests/billing.test.ts
 *
 * Why these exist: merchants reported that they could not pay, and every failure reached
 * them as the same sentence with Shopify's own HTTP status attached. A 401 from Shopify
 * (an offline token refused) became "your session has expired, reload", and a refusal
 * because the app is on Shopify App Pricing looked identical to a frozen shop. The mapping
 * from Shopify's error to what the merchant sees is now a pure function, so it can be held
 * to the cases below without a store to break.
 */

import assert from 'node:assert';
import {
  ShopifyGraphQLError,
  describeSubscriptionFailure,
  managedPricingEnabled,
} from '../src/lib/shopify';
import { shopifyAppHandle } from '../src/lib/client-id';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${(err as Error).message}`);
  }
}

/** A refusal as createRecurringCharge raises it: userErrors attached, status 502. */
const refused = (...messages: string[]) =>
  new ShopifyGraphQLError(
    `appSubscriptionCreate: ${messages.join('; ')}`,
    502,
    messages.map((message) => ({ field: null, message }))
  );

console.log('\nBilling failures, as the merchant sees them');

test('the typed error keeps the userErrors as data', () => {
  const err = refused('Shop is frozen');
  assert.ok(err instanceof Error);
  assert.strictEqual(err.name, 'ShopifyGraphQLError');
  assert.deepStrictEqual(err.userErrors.map((e) => e.message), ['Shop is frozen']);
  assert.strictEqual(err.status, 502);
});

test('a refusal naming managed pricing is the hosted plan page, not an error', () => {
  for (const msg of [
    'This app uses managed pricing; subscriptions must be created from the pricing page',
    'Apps on Shopify App Pricing cannot create subscriptions through the Billing API',
  ]) {
    assert.strictEqual(describeSubscriptionFailure(refused(msg)).kind, 'managed-pricing', msg);
  }
});

test('the words "pricing plan" alone do not send the merchant to the hosted plan page', () => {
  // A false match navigates the whole admin to /charges/<handle>/pricing_plans, which is a
  // 404 for an app not on Shopify App Pricing. Only Shopify naming the feature counts.
  const kind = describeSubscriptionFailure(refused('Choose a pricing plan in the Shopify admin')).kind;
  assert.notStrictEqual(kind, 'managed-pricing');
});

test('a live charge against a development store is explained as such', () => {
  for (const msg of [
    'This shop is a development store and can only accept test charges',
    'The shop is owned by a Shop that must be migrated to the Shopify partners area',
  ]) {
    const f = describeSubscriptionFailure(refused(msg));
    assert.strictEqual(f.kind, 'development-store', msg);
    assert.strictEqual(f.status, 502);
    assert.match(f.message, /development store/);
  }
});

test('a frozen, paused, closed or locked shop points at the Shopify plan page', () => {
  for (const msg of ['Shop is frozen', 'This store is paused', 'Shop has been closed', 'The shop is locked']) {
    const f = describeSubscriptionFailure(refused(msg));
    assert.strictEqual(f.kind, 'shop-ineligible', msg);
    assert.match(f.message, /Settings > Plan/);
  }
  // Shopify answers 402 for a frozen shop and 423 for a locked one at the transport level,
  // with a free-text body that may say nothing useful.
  assert.strictEqual(describeSubscriptionFailure(new ShopifyGraphQLError('Shopify API error 402: {}', 402)).kind, 'shop-ineligible');
  assert.strictEqual(describeSubscriptionFailure(new ShopifyGraphQLError('Shopify API error 423: {}', 423)).kind, 'shop-ineligible');
});

test('a charge still awaiting approval is named', () => {
  const f = describeSubscriptionFailure(refused('A pending subscription already exists for this app'));
  assert.strictEqual(f.kind, 'pending-charge');
  assert.match(f.message, /waiting for approval/);
});

test("a 401 from Shopify is the OFFLINE token, never the merchant's session", () => {
  const f = describeSubscriptionFailure(new ShopifyGraphQLError('Shopify API error 401: {"errors":"[API] Invalid API key or access token"}', 401));
  assert.strictEqual(f.kind, 'reauth');
  // The route must answer 502, not 401 — 401 is what makes apiFetch say "reload".
  assert.strictEqual(f.status, 502);
  assert.match(f.message, /Reopen the app/);
});

test('an unrecognised Shopify refusal is generic, 502, and never echoes Shopify', () => {
  const raw = 'Something nobody has seen before: xyzzy-7f3a';
  const f = describeSubscriptionFailure(refused(raw));
  assert.strictEqual(f.kind, 'shopify');
  assert.strictEqual(f.status, 502);
  assert.ok(!f.message.includes('xyzzy'), 'raw Shopify text leaked to the merchant');
  assert.match(f.message, /quote the reference/);
});

test('a non-Shopify error is 500 and generic', () => {
  const f = describeSubscriptionFailure(new Error('ECONNRESET'));
  assert.strictEqual(f.kind, 'unknown');
  assert.strictEqual(f.status, 500);
  assert.ok(!f.message.includes('ECONNRESET'));
  assert.strictEqual(describeSubscriptionFailure('not even an Error').status, 500);
});

test('a cancel refusal classifies the same way as a create refusal', () => {
  const err = new ShopifyGraphQLError('appSubscriptionCancel gid://1: Shop is frozen', 502, [{ message: 'Shop is frozen' }]);
  assert.strictEqual(describeSubscriptionFailure(err).kind, 'shop-ineligible');
});

console.log('\nManaged pricing switches');

test('SHOPIFY_MANAGED_PRICING is off unless it says true', () => {
  const saved = process.env.SHOPIFY_MANAGED_PRICING;
  try {
    delete process.env.SHOPIFY_MANAGED_PRICING;
    assert.strictEqual(managedPricingEnabled(), false);
    process.env.SHOPIFY_MANAGED_PRICING = 'false';
    assert.strictEqual(managedPricingEnabled(), false);
    process.env.SHOPIFY_MANAGED_PRICING = 'yes';
    assert.strictEqual(managedPricingEnabled(), false);
    process.env.SHOPIFY_MANAGED_PRICING = 'true';
    assert.strictEqual(managedPricingEnabled(), true);
    process.env.SHOPIFY_MANAGED_PRICING = ' TRUE ';
    assert.strictEqual(managedPricingEnabled(), true);
  } finally {
    if (saved === undefined) delete process.env.SHOPIFY_MANAGED_PRICING;
    else process.env.SHOPIFY_MANAGED_PRICING = saved;
  }
});

test('the app handle defaults to the published one and follows the env override', () => {
  const saved = process.env.SHOPIFY_APP_HANDLE;
  try {
    delete process.env.SHOPIFY_APP_HANDLE;
    assert.strictEqual(shopifyAppHandle(), 'reviewmaster-reviews');
    process.env.SHOPIFY_APP_HANDLE = '  ';
    assert.strictEqual(shopifyAppHandle(), 'reviewmaster-reviews');
    process.env.SHOPIFY_APP_HANDLE = ' marka-reviews ';
    assert.strictEqual(shopifyAppHandle(), 'marka-reviews');
  } finally {
    if (saved === undefined) delete process.env.SHOPIFY_APP_HANDLE;
    else process.env.SHOPIFY_APP_HANDLE = saved;
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
