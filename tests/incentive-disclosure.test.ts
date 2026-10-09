/**
 * Offline tests for incentive disclosure on reviews written under an offer. Pure parts
 * only; nothing here touches the database. Run with:
 *
 *   npx --yes bun@latest run tests/incentive-disclosure.test.ts
 *
 * Why these exist: the review-request page shows the store's offer above every item in the
 * order, but only the one review the reward landed on was marked isIncentivized. The rest
 * reached the storefront, the Google feed and the Shop app as ordinary reviews, which is an
 * undisclosed material connection. Every review written under the offer is now marked when
 * it is created.
 */

import assert from 'node:assert';
import { disclosureForOffer } from '../src/lib/incentives';
import { syndicationBlocker } from '../src/lib/syndication';

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

const anyReview = { rewardType: 'percentage', requiresMedia: false };
const mediaOnly = { rewardType: 'fixed_amount', requiresMedia: true };

console.log('\nIncentive disclosure');

test('every review written under an offer is disclosed, media or not', () => {
  // Three reviews from one order, one reward: all three carry the disclosure.
  for (const hasMedia of [false, true]) {
    assert.deepStrictEqual(disclosureForOffer(anyReview, hasMedia), {
      isIncentivized: true,
      incentiveType: 'percentage',
    });
  }
});

test('the type recorded is the reward type, as grantIncentive records it', () => {
  assert.strictEqual(disclosureForOffer({ rewardType: 'free_shipping', requiresMedia: false }, false).incentiveType, 'free_shipping');
});

test('a media-only offer discloses the reviews with media and not the text-only ones', () => {
  assert.deepStrictEqual(disclosureForOffer(mediaOnly, true), { isIncentivized: true, incentiveType: 'fixed_amount' });
  assert.deepStrictEqual(disclosureForOffer(mediaOnly, false), { isIncentivized: false, incentiveType: null });
});

test('no offer (none active, or a plan without incentives) discloses nothing', () => {
  assert.deepStrictEqual(disclosureForOffer(null, true), { isIncentivized: false, incentiveType: null });
  assert.deepStrictEqual(disclosureForOffer(null, false), { isIncentivized: false, incentiveType: null });
});

test('a review disclosed at creation is still refused by Shop syndication', () => {
  const review = {
    id: 'r1',
    rating: 5,
    title: null,
    body: 'Lovely',
    reviewerName: 'Asha',
    reviewDate: new Date('2026-10-10T00:00:00Z'),
    isPublished: true,
    verificationStatus: 'verified_buyer',
    verifiedPurchase: true,
    shopifyOrderId: '1042',
    images: null,
    language: null,
    reply: null,
    repliedAt: null,
    source: 'direct',
    metaobjectId: null,
    product: { shopifyId: 'gid://shopify/Product/1' },
  };
  const disclosed = disclosureForOffer(anyReview, false);
  assert.ok(syndicationBlocker({ ...review, isIncentivized: disclosed.isIncentivized }));
  assert.strictEqual(syndicationBlocker({ ...review, isIncentivized: false }), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
