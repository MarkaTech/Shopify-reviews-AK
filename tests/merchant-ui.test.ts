/**
 * Offline tests for the pure parts of the merchant admin's copy and previews.
 *
 * No database, no network, no DOM. Run with:
 *
 *   npx --yes bun@latest run tests/merchant-ui.test.ts
 *
 * The request sentence goes on four screens (setup guide, dashboard empty state, the
 * dashboard's request panel, Settings → Notifications), so what it promises is what a
 * merchant believes their customers receive. The card-text pairing is the preview's copy
 * of a choice the server makes for the storefront; the two must not drift.
 */

import assert from 'node:assert';
import { describeRequests, requestSummaryFrom, type RequestSummary } from '../src/components/app/RequestPerformance';
import { pairedCardText } from '../src/lib/brand';
import { pairCardText, DEFAULT_CONFIG } from '../src/lib/storefront-config';

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

const base: RequestSummary = { enabled: true, delayDays: 14, reminders: 1 };

console.log('\ndescribeRequests — what is sent, not only what is stored');

test('a Free store on the default settings is not promised a reminder', () => {
  const out = describeRequests({ ...base, remindersAllowed: false });
  assert.ok(!/1 reminder/.test(out), `promised a reminder: ${out}`);
  assert.strictEqual(out, 'first email 14 days after fulfilment, no reminders (the Growth plan adds them).');
});

test('a plan with reminders states the stored count', () => {
  assert.strictEqual(describeRequests({ ...base, reminders: 2, remindersAllowed: true }), 'first email 14 days after fulfilment, 2 reminders.');
  assert.strictEqual(describeRequests({ ...base, remindersAllowed: true }), 'first email 14 days after fulfilment, 1 reminder.');
});

test('when the server did not say (an older build), the stored count is shown as before', () => {
  assert.strictEqual(describeRequests(base), 'first email 14 days after fulfilment, 1 reminder.');
});

test('a merchant who chose no reminders is not sold the Growth plan for them', () => {
  assert.strictEqual(describeRequests({ ...base, reminders: 0, remindersAllowed: false }), 'first email 14 days after fulfilment, no reminder.');
});

test('the consent filter is stated, since it narrows who is asked at all', () => {
  const out = describeRequests({ ...base, remindersAllowed: true, requireMarketingConsent: true });
  assert.strictEqual(out, 'first email 14 days after fulfilment, 1 reminder. Only customers who accepted marketing are asked.');
  assert.ok(!/marketing/.test(describeRequests({ ...base, requireMarketingConsent: false })));
});

test('switched off says so, whatever the plan or the numbers', () => {
  for (const remindersAllowed of [true, false, undefined]) {
    assert.strictEqual(
      describeRequests({ ...base, enabled: false, remindersAllowed, requireMarketingConsent: true }),
      'no invitation emails go out after an order is fulfilled.'
    );
  }
});

test('same-day and one-day delays read as English', () => {
  assert.ok(describeRequests({ ...base, delayDays: 0 }).startsWith('first email the day an order is fulfilled,'));
  assert.ok(describeRequests({ ...base, delayDays: 1 }).startsWith('first email 1 day after fulfilment,'));
});

console.log('\nrequestSummaryFrom — one reader for /api/request-settings');

test('folds the plan answer into the settings', () => {
  const s = requestSummaryFrom({ settings: base, remindersAllowed: false });
  assert.deepStrictEqual(s, { ...base, remindersAllowed: false });
  assert.ok(s && /no reminders/.test(describeRequests(s)));
});

test('leaves remindersAllowed unset when the server did not send it', () => {
  const s = requestSummaryFrom({ settings: base });
  assert.ok(s);
  assert.strictEqual(s.remindersAllowed, undefined);
});

test('a body without usable settings is null, not a half-filled summary', () => {
  assert.strictEqual(requestSummaryFrom(null), null);
  assert.strictEqual(requestSummaryFrom(undefined), null);
  assert.strictEqual(requestSummaryFrom({}), null);
  assert.strictEqual(requestSummaryFrom({ settings: { ...base, delayDays: undefined as unknown as number } }), null);
});

test('does not mutate the response it was given', () => {
  const settings = { ...base };
  requestSummaryFrom({ settings, remindersAllowed: true });
  assert.strictEqual('remindersAllowed' in settings, false);
});

console.log('\npairedCardText — the Settings preview pairs card text as the storefront does');

test('no background, or not a colour, means no pairing', () => {
  for (const bg of [null, undefined, '', 'emerald', '111827', '#11']) {
    assert.strictEqual(pairedCardText(bg), null, `paired ${String(bg)}`);
  }
});

test('dark backgrounds get white text, light ones the dark fallback', () => {
  assert.strictEqual(pairedCardText('#111827'), '#ffffff');
  assert.strictEqual(pairedCardText('#000'), '#ffffff');
  assert.strictEqual(pairedCardText('#ffffff'), '#1f2937');
  assert.strictEqual(pairedCardText('#FDF1DE'), '#1f2937');
});

test('matches the server pairing for every kind of background', () => {
  const backgrounds = [
    '#111827', '#ffffff', '#FFFFFF', '#000', '#fff', '#777777', '#808080', '#1B3358',
    '#E8871E', '#FFC24B', '#19734B', '#B42318', '#11182780', '#11182', '#abcd',
  ];
  for (const bg of backgrounds) {
    const colors = { ...DEFAULT_CONFIG.colors, cardBg: bg, cardText: null };
    pairCardText(colors);
    assert.strictEqual(pairedCardText(bg), colors.cardText, `drifted on ${bg}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
