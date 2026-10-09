/**
 * Offline tests for the shopper-facing email templates. Pure rendering only — nothing
 * here sends, and nothing touches the database. Run with:
 *
 *   npx --yes bun@latest run tests/email.test.ts
 *
 * Why these exist: the review invitation carried the "Verified by Marka" badge, a claim
 * about a review's provenance, before any review existed. It now carries the same
 * "Powered by Marka Reviews" attribution the storefront widget does, and only on plans
 * that are not white-label. A template is a string, and a string regression is invisible
 * to the typechecker.
 */

import assert from 'node:assert';
import { renderReviewRequestEmail } from '../src/lib/email';
import { POWERED_BY, APP_STORE_URL } from '../src/lib/brand';

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

const base = {
  storeName: 'Divine Hindu',
  customerName: 'Asha',
  orderNumber: '1042',
  itemTitles: ['Lakshmi Ganesh Silver Coin'],
  reviewUrl: 'https://app.example.com/r/abcdefghijklmnopqrstuvwx',
  unsubscribeUrl: 'https://app.example.com/api/unsubscribe?t=token',
};

// brandImageUrl reads the app URL at call time, so each test sets what it needs.
const withAppUrl = (url: string, fn: () => void) => {
  const prev = process.env.SHOPIFY_APP_URL;
  process.env.SHOPIFY_APP_URL = url;
  try { fn(); } finally {
    if (prev === undefined) delete process.env.SHOPIFY_APP_URL;
    else process.env.SHOPIFY_APP_URL = prev;
  }
};

test('a Free-plan invitation carries the Powered-by attribution, icon at 20px', () => {
  withAppUrl('https://app.example.com', () => {
    const msg = renderReviewRequestEmail({ ...base, showAttribution: true });
    assert.ok(msg.html.includes(POWERED_BY), 'attribution words missing from html');
    assert.ok(msg.html.includes(`href="${APP_STORE_URL}"`), 'attribution does not link to the listing');
    assert.ok(
      /<img src="https:\/\/app\.example\.com\/brand\/marka-reviews-icon-64\.png" width="20" height="20"/.test(msg.html),
      'icon missing or not 20px'
    );
    assert.ok(msg.text.trim().endsWith(POWERED_BY), 'attribution missing from the text part');
  });
});

test('the invitation never carries the Verified-by-Marka badge', () => {
  withAppUrl('https://app.example.com', () => {
    for (const showAttribution of [true, false]) {
      const msg = renderReviewRequestEmail({ ...base, showAttribution });
      assert.ok(!/verified[- ]by[- ]marka/i.test(msg.html), `badge present with showAttribution=${showAttribution}`);
      assert.ok(!/verified/i.test(msg.text));
    }
  });
});

test('a white-label plan sends nothing of ours', () => {
  withAppUrl('https://app.example.com', () => {
    const msg = renderReviewRequestEmail({ ...base, showAttribution: false });
    assert.ok(!msg.html.includes(POWERED_BY));
    assert.ok(!msg.html.includes('/brand/'));
    assert.ok(!msg.html.includes(APP_STORE_URL));
    assert.ok(!msg.text.includes(POWERED_BY));
  });
});

test('without a public app URL the words stay and the image is left out, not broken', () => {
  withAppUrl('', () => {
    const msg = renderReviewRequestEmail({ ...base, showAttribution: true });
    assert.ok(msg.html.includes(POWERED_BY));
    assert.ok(!/<img/.test(msg.html), 'an image with no host would be a broken image');
  });
});

test('store name and order reference are escaped, and the unsubscribe link is carried', () => {
  const msg = renderReviewRequestEmail({
    ...base,
    storeName: 'Tom & Jerry <Shop>',
    orderNumber: '#<1>',
    showAttribution: false,
  });
  assert.ok(msg.html.includes('Tom &amp; Jerry &lt;Shop&gt;'));
  assert.ok(!msg.html.includes('<Shop>'));
  assert.ok(msg.html.includes(base.unsubscribeUrl));
  assert.strictEqual(msg.unsubscribeUrl, base.unsubscribeUrl, 'List-Unsubscribe header input missing');
  assert.strictEqual(msg.subject, 'How was your order from Tom & Jerry <Shop>?');
});

test('a reminder uses the softer copy and subject', () => {
  const msg = renderReviewRequestEmail({ ...base, isReminder: true, showAttribution: false });
  assert.strictEqual(msg.subject, 'A quick reminder from Divine Hindu');
  assert.ok(/gentle nudge/.test(msg.html));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
