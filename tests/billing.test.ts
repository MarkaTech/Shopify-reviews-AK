/**
 * Offline tests for the billing route's failure classification, its refusal to hand
 * merchants to Shopify's App Pricing page, and how the app shell reads a return from
 * Shopify's approval screen. Pure parts only — nothing here talks to Shopify or the
 * database. Run with:
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
import { readFileSync } from 'node:fs';
import { ShopifyGraphQLError, describeSubscriptionFailure } from '../src/lib/shopify';
import { shopifyAppHandle } from '../src/lib/client-id';
import { classifyPlanReturn, parsePendingPlan, planArrived, planName, upgradeMayStillLand } from '../src/lib/plan-return';

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

test('a refusal naming managed pricing is a 502 that sends nobody to pay', () => {
  // The app cannot see a plan bought on Shopify's App Pricing page (that needs the Partner
  // API), so pointing the merchant there would bill them while they stayed on Free. The
  // message must say paid plans are unavailable, and nothing more actionable than support.
  for (const msg of [
    'Managed Pricing Apps cannot use the Billing API (to create charges).',
    'This app uses managed pricing; subscriptions must be created from the pricing page',
    'Apps on Shopify App Pricing cannot create subscriptions through the Billing API',
  ]) {
    const f = describeSubscriptionFailure(refused(msg));
    assert.strictEqual(f.kind, 'managed-pricing', msg);
    assert.strictEqual(f.status, 502);
    assert.match(f.message, /cannot be started/);
    assert.match(f.message, /nothing has been charged/);
    assert.match(f.message, /quote the reference/);
    assert.doesNotMatch(f.message, /https?:|\/charges\/|pricing_plans|admin\.shopify|myshopify/i, 'a URL reached the merchant');
    assert.doesNotMatch(f.message, /choose|select|pick|plan page|Shopify admin|pay there|subscribe/i, 'the merchant was told to pay somewhere');
  }
});

test('the words "pricing plan" alone are not read as Shopify App Pricing', () => {
  // A false match tells the merchant paid plans are unavailable and raises the operator's
  // MANAGED_PRICING_REFUSAL alarm for what is an ordinary refusal. Only Shopify naming the
  // feature counts.
  const kind = describeSubscriptionFailure(refused('Choose a pricing plan in the Shopify admin')).kind;
  assert.notStrictEqual(kind, 'managed-pricing');
});

test('the billing route never hands a merchant to the App Pricing page', () => {
  // The route needs a session and a database to run, so this reads its code instead: no
  // hosted-page URL, no flag that skips the Billing API, and the operator's marker on the
  // refusal. Comments are stripped first — the route explains the page it does not use.
  const source = readFileSync(new URL('../src/app/api/billing/route.ts', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /pricingPageUrl|pricing_plans|\/charges\//, 'the hosted plan page is back in the billing route');
  assert.doesNotMatch(code, /managedPricingEnabled|SHOPIFY_MANAGED_PRICING/, 'a switch that skips the Billing API is back');
  assert.match(code, /MANAGED_PRICING_REFUSAL/);
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

console.log('\nApp handle');

// Unused by the billing route until the App Pricing hand-off can come back (see the note
// above POST in src/app/api/billing/route.ts), and kept tested for that day.
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

console.log('\nComing back from Shopify\'s approval screen');

test('the stored plan change is read only in the shape the Plan page writes', () => {
  assert.deepStrictEqual(parsePendingPlan(JSON.stringify({ from: 'growth', to: 'scale' })), { from: 'growth', to: 'scale' });
  assert.deepStrictEqual(parsePendingPlan(JSON.stringify({ to: 'scale' })), { to: 'scale' });
  for (const raw of [null, undefined, '', '{}', 'null', '"growth"', '[1]', '{not json', JSON.stringify({ from: 1, to: {} })]) {
    assert.strictEqual(parsePendingPlan(raw), null, String(raw));
  }
  // Stray fields are dropped, not carried along.
  assert.deepStrictEqual(parsePendingPlan(JSON.stringify({ from: 'free', to: 'growth', extra: 'x' })), { from: 'free', to: 'growth' });
});

test('a declined Growth to Scale upgrade is not announced as an unlock', () => {
  // Shopify keeps Growth ACTIVE when Scale is declined, so confirm says activated with
  // plan growth. That used to put "You just unlocked these" over Growth's features.
  assert.strictEqual(classifyPlanReturn('growth', { from: 'growth', to: 'scale' }), 'unchanged');
  assert.strictEqual(classifyPlanReturn('scale', { from: 'scale', to: 'growth' }), 'unchanged');
});

test('the plan that was bought, or any move up, is an upgrade', () => {
  assert.strictEqual(classifyPlanReturn('scale', { from: 'growth', to: 'scale' }), 'upgraded');
  assert.strictEqual(classifyPlanReturn('growth', { from: 'free', to: 'growth' }), 'upgraded');
  // Not the plan asked for, but up from where they started: still worth marking.
  assert.strictEqual(classifyPlanReturn('scale', { from: 'free', to: 'growth' }), 'upgraded');
});

test('an approved move down between paid plans is a switch, not an unlock', () => {
  assert.strictEqual(classifyPlanReturn('growth', { from: 'scale', to: 'growth' }), 'switched');
});

test('with nothing to compare against, the long-standing behaviour holds', () => {
  // No storage in the frame, an older build's tab, or a confirm answer without a plan.
  assert.strictEqual(classifyPlanReturn('growth', null), 'upgraded');
  assert.strictEqual(classifyPlanReturn('growth', { to: 'scale' }), 'upgraded');
  assert.strictEqual(classifyPlanReturn(undefined, { from: 'growth', to: 'scale' }), 'upgraded');
  assert.strictEqual(classifyPlanReturn('enterprise', { from: 'growth', to: 'scale' }), 'upgraded');
});

test('the pending poll waits for the plan bought, not for any paid plan', () => {
  const growthToScale = { from: 'growth', to: 'scale' };
  assert.strictEqual(planArrived('growth', growthToScale), false);
  assert.strictEqual(planArrived('scale', growthToScale), true);
  assert.strictEqual(planArrived(undefined, growthToScale), false);
  // Only a starting plan recorded: any change from it.
  assert.strictEqual(planArrived('growth', { from: 'growth' }), false);
  assert.strictEqual(planArrived('scale', { from: 'growth' }), true);
  // Nothing recorded: any paid plan, as before.
  assert.strictEqual(planArrived('free', null), false);
  assert.strictEqual(planArrived('growth', null), true);
  assert.strictEqual(planArrived('growth', {}), true);
});

test('plans are named as the merchant sees them', () => {
  assert.strictEqual(planName('free'), 'Free');
  assert.strictEqual(planName('growth'), 'Growth');
  assert.strictEqual(planName('scale'), 'Scale');
  assert.strictEqual(planName('enterprise'), 'enterprise');
});

test('an upgrade that came back on the old plan is waited for, a downgrade is not', () => {
  // Growth -> Scale, back on Growth: a decline OR a swap Shopify has not finished.
  assert.strictEqual(upgradeMayStillLand('growth', { from: 'growth', to: 'scale' }), true);
  assert.strictEqual(upgradeMayStillLand('free', { from: 'free', to: 'growth' }), true);
  // Going down, or landing somewhere else, or knowing nothing: answer now.
  assert.strictEqual(upgradeMayStillLand('scale', { from: 'scale', to: 'growth' }), false);
  assert.strictEqual(upgradeMayStillLand('scale', { from: 'growth', to: 'scale' }), false);
  assert.strictEqual(upgradeMayStillLand('growth', null), false);
  assert.strictEqual(upgradeMayStillLand('growth', { from: 'growth' }), false);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
