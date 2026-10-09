/**
 * Offline tests for complimentary plans: a paid plan an operator gives a store at no
 * charge from the operator portal. Pure parts only. Run with:
 *
 *   npx tsx tests/complimentary.test.ts
 */

import assert from 'node:assert';
import {
  parseComplimentary,
  serialiseComplimentary,
  higherPlan,
  planPaidAbove,
  complimentaryFromLedger,
  COMPLIMENTARY_PLANS,
} from '../src/lib/plans';

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

console.log('\nComplimentary plans');

test('only paid plans can be given', () => {
  assert.deepStrictEqual(COMPLIMENTARY_PLANS, ['growth', 'scale']);
});

test('a granted plan round-trips through the stored value', () => {
  const at = new Date('2026-10-08T12:00:00Z');
  const parsed = parseComplimentary(serialiseComplimentary('scale', at));
  assert.deepStrictEqual(parsed, { plan: 'scale', grantedAt: '2026-10-08T12:00:00.000Z' });
});

test('an ended plan (empty value) grants nothing', () => {
  assert.strictEqual(parseComplimentary(''), null);
  assert.strictEqual(parseComplimentary(null), null);
  assert.strictEqual(parseComplimentary(undefined), null);
});

test('a malformed or unknown value grants nothing', () => {
  assert.strictEqual(parseComplimentary('scale'), null);
  assert.strictEqual(parseComplimentary('{"plan":"enterprise"}'), null);
  assert.strictEqual(parseComplimentary('{"plan":"free"}'), null);
  assert.strictEqual(parseComplimentary('{not json'), null);
});

test('billing can lift a store above its complimentary plan but never below it', () => {
  // higherPlan(paid, complimentary) is what entitledPlan writes.
  assert.strictEqual(higherPlan('free', 'scale'), 'scale');
  assert.strictEqual(higherPlan('growth', 'scale'), 'scale');
  assert.strictEqual(higherPlan('scale', 'growth'), 'scale');
  assert.strictEqual(higherPlan('free', 'growth'), 'growth');
  assert.strictEqual(higherPlan(null, 'growth'), 'growth');
  // Legacy names normalise first: an old "pro" subscription is Scale.
  assert.strictEqual(higherPlan('pro', 'growth'), 'scale');
});

test('giving a plan free cancels charges for it or less, and keeps a higher one', () => {
  // Null: every charge is for the gift or less, so all are cancelled.
  assert.strictEqual(planPaidAbove([], 'scale'), null);
  assert.strictEqual(planPaidAbove(['growth'], 'scale'), null);
  assert.strictEqual(planPaidAbove(['scale'], 'scale'), null);
  assert.strictEqual(planPaidAbove(['growth'], 'growth'), null);
  assert.strictEqual(planPaidAbove(['free'], 'growth'), null);
  // Paying for more than the gift: that charge, and that plan, stay.
  assert.strictEqual(planPaidAbove(['scale'], 'growth'), 'scale');
  assert.strictEqual(planPaidAbove(['pro'], 'growth'), 'scale');
});

test('granting asks of the one plan Shopify entitles the store to, test-aware', () => {
  // The grant resolves ONE plan through resolveActiveSubscription — which reports 'free'
  // for a test subscription on a live store — and asks whether that is above the gift.
  assert.strictEqual(planPaidAbove(['free'], 'growth'), null); // test subscription on a live store: cancelled
  assert.strictEqual(planPaidAbove(['growth'], 'growth'), null);
  assert.strictEqual(planPaidAbove(['scale'], 'growth'), 'scale');
  assert.strictEqual(planPaidAbove(['scale'], 'scale'), null);
});

console.log('\nComplimentary ledger (survives shop/redact)');

test('an open ledger row restores the gift', () => {
  const row = { plan: 'scale', grantedAt: new Date('2026-10-08T12:00:00Z'), endedAt: null };
  assert.deepStrictEqual(complimentaryFromLedger(row), { plan: 'scale', grantedAt: '2026-10-08T12:00:00.000Z' });
});

test('an ended ledger row restores nothing', () => {
  const row = { plan: 'scale', grantedAt: new Date('2026-10-08T12:00:00Z'), endedAt: new Date('2026-10-09T12:00:00Z') };
  assert.strictEqual(complimentaryFromLedger(row), null);
});

test('a ledger row naming an unknown or free plan restores nothing', () => {
  assert.strictEqual(complimentaryFromLedger({ plan: 'enterprise', grantedAt: new Date(), endedAt: null }), null);
  assert.strictEqual(complimentaryFromLedger({ plan: 'free', grantedAt: new Date(), endedAt: null }), null);
  assert.strictEqual(complimentaryFromLedger(null), null);
  assert.strictEqual(complimentaryFromLedger(undefined), null);
});

test('a restored gift serialises exactly as a fresh grant would', () => {
  const row = { plan: 'growth', grantedAt: new Date('2026-10-08T12:00:00Z'), endedAt: null };
  const comp = complimentaryFromLedger(row);
  assert.ok(comp);
  assert.deepStrictEqual(parseComplimentary(serialiseComplimentary(comp.plan, new Date(comp.grantedAt))), comp);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
