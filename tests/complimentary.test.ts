/**
 * Offline tests for complimentary plans: a paid plan an operator gives a store at no
 * charge from the operator portal. Pure parts, the ledger backfill migration's pattern, and
 * ending a gift against a stubbed Prisma client; nothing here reaches a database. Run with:
 *
 *   npx --yes bun@latest run tests/complimentary.test.ts
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseComplimentary,
  serialiseComplimentary,
  higherPlan,
  planPaidAbove,
  complimentaryFromLedger,
  endComplimentary,
  COMPLIMENTARY_KEY,
  COMPLIMENTARY_PLANS,
} from '../src/lib/plans';
import { db } from '../src/lib/db';

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

console.log('\nLedger backfill (gifts given before the ledger existed)');

// The backfill migration matches the stored value by pattern instead of a ::jsonb cast, so
// a malformed value cannot fail the deploy. That only works while the pattern matches what
// serialiseComplimentary writes; JS and Postgres regexes agree on a pattern this plain.
const backfillSql = readFileSync(
  join(__dirname, '../prisma/migrations/20261010120000_complimentary_ledger_backfill/migration.sql'),
  'utf8'
);
const planPattern = (() => {
  const m = backfillSql.match(/ss\."value" ~ '([^']+)'/);
  assert.ok(m, 'backfill migration has no value pattern');
  return new RegExp(m[1]);
})();

test('the backfill copies every live gift the portal can have written', () => {
  for (const plan of COMPLIMENTARY_PLANS) {
    const value = serialiseComplimentary(plan, new Date('2026-10-09T08:30:00Z'));
    const m = value.match(planPattern);
    assert.ok(m, `pattern misses ${value}`);
    // substring(... from pattern) returns the first group: the plan written to the ledger.
    assert.strictEqual(m[1], plan);
  }
});

test('the backfill skips ended, free and malformed values', () => {
  assert.ok(!planPattern.test(''));
  assert.ok(!planPattern.test(JSON.stringify({ plan: 'free', grantedAt: '2026-10-09T08:30:00.000Z' })));
  assert.ok(!planPattern.test('scale'));
});

test('the backfill keys on the setting the app reads, and leaves existing ledger rows alone', () => {
  assert.ok(backfillSql.includes(`ss."key" = '${COMPLIMENTARY_KEY}'`));
  assert.ok(/ON CONFLICT \("shopifyDomain"\) DO NOTHING/.test(backfillSql));
  assert.ok(/"shopifyDomain" IS NOT NULL/.test(backfillSql));
});

/* ── Ending a gift: both writes or neither ───────────────────────────────────
   Run against a stubbed client. Every stub is checked to be in place BEFORE
   endComplimentary is called, so a stub that did not take fails the test instead
   of reaching a real database. */

type Op = { op: string; args: unknown; then: (resolve: (v: unknown) => void) => void };
const executed: string[] = [];
let transactions: Op[][] = [];
let transactionFails = false;
const makeOp = (op: string, args: unknown): Op => ({
  op,
  args,
  // Awaited on its own, outside a transaction.
  then: (resolve) => {
    executed.push(op);
    resolve(op);
  },
});
const stubs: Record<string, unknown> = {
  $transaction: async (ops: Op[]) => {
    if (transactionFails) throw new Error('connection dropped');
    transactions.push(ops);
    return ops.map((o) => o.op);
  },
  storeSetting: { upsert: (args: unknown) => makeOp('setting', args) },
  complimentaryLedger: { updateMany: (args: unknown) => makeOp('ledger', args) },
};
const client = db as unknown as Record<string, unknown>;

async function withStubbedDb(fn: () => Promise<void>) {
  const originals: Record<string, unknown> = {};
  for (const k of Object.keys(stubs)) {
    originals[k] = client[k];
    client[k] = stubs[k];
  }
  executed.length = 0;
  transactions = [];
  transactionFails = false;
  try {
    for (const k of Object.keys(stubs)) assert.strictEqual(client[k], stubs[k], `could not stub db.${k}`);
    await fn();
  } finally {
    for (const k of Object.keys(stubs)) client[k] = originals[k];
  }
}

const asyncTests: Array<[string, () => Promise<void>]> = [
  ['ending a gift writes the empty setting and closes the ledger in one transaction', async () => {
    const endedAt = new Date('2026-10-10T09:00:00Z');
    await endComplimentary('store_1', 'x.myshopify.com', endedAt);
    assert.strictEqual(transactions.length, 1);
    assert.deepStrictEqual(transactions[0].map((o) => o.op), ['setting', 'ledger']);
    assert.deepStrictEqual(transactions[0][0].args, {
      where: { storeId_key: { storeId: 'store_1', key: COMPLIMENTARY_KEY } },
      create: { storeId: 'store_1', key: COMPLIMENTARY_KEY, value: '' },
      update: { value: '' },
    });
    assert.deepStrictEqual(transactions[0][1].args, {
      where: { shopifyDomain: 'x.myshopify.com', endedAt: null },
      data: { endedAt },
    });
    // Nothing ran outside the transaction.
    assert.deepStrictEqual(executed, []);
  }],
  ['a failed end throws, so the portal reports it instead of "Ended"', async () => {
    transactionFails = true;
    await assert.rejects(endComplimentary('store_1', 'x.myshopify.com'), /connection dropped/);
    assert.deepStrictEqual(executed, []);
  }],
  ['a store with no domain has only its setting ended (no ledger row to close)', async () => {
    await endComplimentary('store_2', null);
    assert.strictEqual(transactions.length, 0);
    assert.deepStrictEqual(executed, ['setting']);
  }],
];

(async () => {
  console.log('\nEnding a complimentary plan');
  for (const [name, fn] of asyncTests) {
    try {
      await withStubbedDb(fn);
      passed++;
      console.log(`  ok  ${name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${name}`);
      console.log(`        ${(err as Error).message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
