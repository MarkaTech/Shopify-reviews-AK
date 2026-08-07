/**
 * Offline tests for the Google Merchant Center product ratings feed.
 *
 * Why this file exists at all: an invalid feed does not fail loudly. It is built without
 * error, served with a 200, fetched by Google's crawler and then rejected **in full** —
 * so a merchant loses every star rating they have and the app reports nothing wrong. The
 * only place that can be caught is here.
 *
 * Mostly attacks rather than happy paths. Real review bodies contain ampersands, angle
 * brackets, quotes, emoji and occasionally a stray control byte pasted out of Word, and
 * any one of those turns a valid document into a parse error for every review after it.
 *
 * Compile and run (no test runner, no database — the module under test imports nothing):
 *
 *   npx tsc tests/google-feed.test.ts src/lib/google-feed.ts --outDir ./.rmtest \
 *     --module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck
 *   node ./.rmtest/tests/google-feed.test.js
 */

import assert from 'node:assert';
import {
  buildProductReviewsFeed,
  xmlEscape,
  REVIEW_ELEMENT_ORDER,
  type FeedReview,
  type FeedStore,
} from '../src/lib/google-feed';

const store: FeedStore = { name: 'Divine Hindu', domain: 'divinehindu.in', shopifyDomain: 'divine-hindu.myshopify.com' };

function review(over: Partial<FeedReview> = {}): FeedReview {
  return {
    id: 'clx0000000000',
    reviewerName: 'Asha K',
    rating: 5,
    title: 'Lovely',
    body: 'Arrived quickly and looks exactly like the photos.',
    reviewDate: new Date('2026-07-14T09:30:00.000Z'),
    isIncentivized: false,
    verificationStatus: 'verified_buyer',
    product: { shopifyId: 'gid://shopify/Product/1', handle: 'brass-diya', title: 'Brass Diya' },
    ...over,
  };
}

// ── A deliberately small XML reader ──────────────────────────────────────────────────
//
// Node ships no XML parser and the sandbox has no network to install one, so this walks
// the document itself. It is strict on purpose: unbalanced tags, stray `<` and `&`, and
// bad nesting all have to be caught, because those are exactly the failures under test.

interface Node { name: string; children: Node[]; text: string }

function parse(xml: string): Node {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  const stack: Node[] = [{ name: '#root', children: [], text: '' }];
  let i = 0;

  while (i < body.length) {
    const lt = body.indexOf('<', i);
    if (lt === -1) {
      assertNoRawMarkup(body.slice(i));
      break;
    }
    assertNoRawMarkup(body.slice(i, lt));

    const gt = body.indexOf('>', lt);
    assert.ok(gt !== -1, 'unterminated tag');
    const raw = body.slice(lt + 1, gt);
    assert.ok(!raw.includes('<'), `nested '<' inside a tag: ${raw.slice(0, 60)}`);

    if (raw.startsWith('/')) {
      const closing = stack.pop();
      assert.ok(closing, 'closing tag with nothing open');
      assert.strictEqual(closing!.name, raw.slice(1), 'mismatched closing tag');
      stack[stack.length - 1].children.push(closing!);
    } else if (!raw.endsWith('/')) {
      stack.push({ name: raw.split(/[\s>]/)[0], children: [], text: '' });
    }
    i = gt + 1;
  }

  assert.strictEqual(stack.length, 1, `unclosed elements: ${stack.slice(1).map(n => n.name).join(', ')}`);
  return stack[0];
}

/** Character data must not contain a bare `<` or an `&` that is not a valid entity. */
function assertNoRawMarkup(text: string): void {
  assert.ok(!text.includes('<'), 'unescaped < in character data');
  const bad = text.match(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/);
  assert.ok(!bad, `unescaped & in character data near: ${text.slice(Math.max(0, (bad?.index ?? 0) - 20), (bad?.index ?? 0) + 20)}`);
}

function find(node: Node, name: string): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => { if (n.name === name) out.push(n); n.children.forEach(walk); };
  walk(node);
  return out;
}

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

// ── Escaping ─────────────────────────────────────────────────────────────────────────

test('xmlEscape neutralises every character XML treats as markup', () => {
  assert.strictEqual(xmlEscape('a & b'), 'a &amp; b');
  assert.strictEqual(xmlEscape('<script>'), '&lt;script&gt;');
  assert.strictEqual(xmlEscape(`"quoted" 'single'`), '&quot;quoted&quot; &apos;single&apos;');
});

test('xmlEscape escapes the ampersand first, so entities are not double-escaped into nonsense', () => {
  // Order matters: escaping `<` before `&` yields `&amp;lt;`, which renders as the literal
  // text "&lt;" rather than a less-than sign.
  assert.strictEqual(xmlEscape('a < b & c'), 'a &lt; b &amp; c');
});

test('xmlEscape strips the control bytes XML 1.0 forbids, and keeps the ones it allows', () => {
  assert.strictEqual(xmlEscape('bad\x00\x07\x1Fbyte'), 'badbyte');
  // Tab, newline and carriage return are legal and are content the reviewer typed.
  assert.strictEqual(xmlEscape('line\tone\nline\rtwo'), 'line\tone\nline\rtwo');
});

// ── Document shape ───────────────────────────────────────────────────────────────────

test('a feed with no reviews is still a well-formed document', () => {
  // Every merchant is here on their first day. A feed that only parses once reviews
  // exist means the very first fetch Google makes fails.
  const doc = parse(buildProductReviewsFeed(store, []));
  assert.strictEqual(find(doc, 'feed').length, 1);
  assert.strictEqual(find(doc, 'reviews')[0].children.length, 0);
});

test('reviews with no linked product are dropped, not emitted half-built', () => {
  const xml = buildProductReviewsFeed(store, [
    review({ id: 'keep' }),
    review({ id: 'drop-null-product', product: null }),
    review({ id: 'drop-no-shopify-id', product: { shopifyId: null, handle: 'x', title: 'X' } }),
  ]);
  parse(xml);
  assert.strictEqual(find(parse(xml), 'review').length, 1);
  assert.ok(xml.includes('<review_id>keep</review_id>'));
  assert.ok(!xml.includes('drop-null-product'));
});

// ── The constraint that is easy to get wrong ─────────────────────────────────────────

test('review children appear in the exact sequence Google’s schema requires', () => {
  // `review` is an xs:sequence, so this is validity rather than style, and it is the one
  // thing here with no visible symptom short of Google rejecting the entire feed.
  const doc = parse(buildProductReviewsFeed(store, [review()]));
  const got = find(doc, 'review')[0].children.map(c => c.name);
  assert.deepStrictEqual(got, [...REVIEW_ELEMENT_ORDER]);
});

test('the optional title is omitted rather than emitted empty, and the rest keeps its order', () => {
  const doc = parse(buildProductReviewsFeed(store, [review({ title: null })]));
  const got = find(doc, 'review')[0].children.map(c => c.name);
  assert.deepStrictEqual(got, REVIEW_ELEMENT_ORDER.filter(n => n !== 'title'));
});

test('product children are ordered and carry no empty identifier containers', () => {
  const xml = buildProductReviewsFeed(store, [review()]);
  const doc = parse(xml);
  assert.deepStrictEqual(find(doc, 'product')[0].children.map(c => c.name), ['product_name', 'product_url']);
  // `gtins`, `mpns` and `skus` each require at least one child, so an empty container is
  // invalid — and we hold no product identifiers to put in one.
  assert.ok(!xml.includes('<product_ids>'), 'empty product_ids must not be emitted');
});

// ── Honesty ──────────────────────────────────────────────────────────────────────────

test('every rating is submitted, including the ones a merchant would rather hide', () => {
  // Filtering by star is a Google policy violation that rejects the whole feed, and is
  // separately illegal under the FTC rule, the EU Omnibus Directive and the UK DMCC Act.
  const xml = buildProductReviewsFeed(store, [1, 2, 3, 4, 5].map(rating => review({ id: `r${rating}`, rating })));
  const doc = parse(xml);
  assert.strictEqual(find(doc, 'review').length, 5);
  for (const rating of [1, 2, 3, 4, 5]) {
    assert.ok(xml.includes(`<overall min="1" max="5">${rating}</overall>`), `rating ${rating} missing`);
  }
});

test('incentivised and unverified reviews are declared as what they are', () => {
  const xml = buildProductReviewsFeed(store, [
    review({ id: 'a', isIncentivized: true, verificationStatus: 'verified_buyer' }),
    review({ id: 'b', isIncentivized: false, verificationStatus: null }),
  ]);
  const reviews = find(parse(xml), 'review');
  assert.strictEqual(reviews.length, 2);
  assert.ok(xml.includes('<is_incentivized_review>true</is_incentivized_review>'));
  assert.ok(xml.includes('<is_verified_purchase>false</is_verified_purchase>'));
  // Only a fulfilled order earns `post_fulfillment`; anything else is `unsolicited`.
  assert.ok(xml.includes('<collection_method>post_fulfillment</collection_method>'));
  assert.ok(xml.includes('<collection_method>unsolicited</collection_method>'));
});

test('collection_method only ever emits a value Google accepts', () => {
  const xml = buildProductReviewsFeed(store, [
    review({ id: 'a', verificationStatus: 'verified_buyer' }),
    review({ id: 'b', verificationStatus: 'unverified' }),
    review({ id: 'c', verificationStatus: null }),
    review({ id: 'd', verificationStatus: 'something-we-add-later' }),
  ]);
  for (const m of xml.match(/<collection_method>([^<]*)<\/collection_method>/g) ?? []) {
    const value = m.replace(/<\/?collection_method>/g, '');
    assert.ok(['post_fulfillment', 'unsolicited'].includes(value), `invalid collection_method: ${value}`);
  }
});

// ── Hostile content ──────────────────────────────────────────────────────────────────

test('a review body full of markup cannot break the document', () => {
  const doc = parse(buildProductReviewsFeed(store, [
    review({
      body: 'Bought <b>two</b> & loved them — 5" wide, "great" value, <3 100% & <script>alert(1)</script>',
      title: 'A & B < C > D',
      reviewerName: `O'Brien & Sons <"VIP">`,
    }),
    review({ id: 'second', body: 'still parses' }),
  ]));
  // The second review surviving is the real assertion: an unescaped character truncates
  // everything after it, so a single bad body silently costs a merchant the rest of
  // their catalogue's ratings.
  assert.strictEqual(find(doc, 'review').length, 2);
});

test('a product title and handle full of markup cannot break the document', () => {
  const doc = parse(buildProductReviewsFeed(store, [
    review({ product: { shopifyId: 'gid://1', handle: 'a&b<c>"d"', title: 'Diya <Large> & "Heavy"' } }),
    review({ id: 'second' }),
  ]));
  assert.strictEqual(find(doc, 'review').length, 2);
});

test('a store name full of markup cannot break the document header', () => {
  const doc = parse(buildProductReviewsFeed(
    { name: 'Divine & Hindu <Store>', domain: 'a&b.example', shopifyDomain: null },
    [review()]
  ));
  assert.strictEqual(find(doc, 'review').length, 1);
});

test('control bytes pasted out of a word processor are stripped, not emitted', () => {
  const xml = buildProductReviewsFeed(store, [review({ body: 'good\x00 product\x08 really\x1F' })]);
  parse(xml);
  for (const ch of ['\x00', '\x08', '\x1F']) {
    assert.ok(!xml.includes(ch), `control byte ${ch.charCodeAt(0)} survived into the feed`);
  }
});

test('emoji and non-Latin scripts survive intact', () => {
  // Stripping these would quietly mangle reviews for most of the store's customers.
  const body = 'बहुत सुंदर 🙏 とても良い';
  const xml = buildProductReviewsFeed(store, [review({ body })]);
  parse(xml);
  assert.ok(xml.includes(body), 'unicode content was altered');
});

// ── URLs ─────────────────────────────────────────────────────────────────────────────

test('a product with no handle falls back to the site root rather than emitting /products/null', () => {
  const xml = buildProductReviewsFeed(store, [
    review({ product: { shopifyId: 'gid://1', handle: null, title: 'Brass Diya' } }),
  ]);
  parse(xml);
  assert.ok(!xml.includes('products/null'), 'null handle leaked into the URL');
  assert.ok(xml.includes('<product_url>https://divinehindu.in</product_url>'));
});

test('the custom domain is preferred, and the myshopify domain is the fallback', () => {
  assert.ok(buildProductReviewsFeed(store, [review()]).includes('https://divinehindu.in/products/brass-diya'));
  const fallback = buildProductReviewsFeed(
    { name: 'S', domain: null, shopifyDomain: 'divine-hindu.myshopify.com' },
    [review()]
  );
  assert.ok(fallback.includes('https://divine-hindu.myshopify.com/products/brass-diya'));
});

test('review_timestamp is ISO 8601 in UTC, which is the only format Google accepts', () => {
  const xml = buildProductReviewsFeed(store, [review({ reviewDate: new Date('2026-07-14T09:30:00.000Z') })]);
  assert.ok(xml.includes('<review_timestamp>2026-07-14T09:30:00.000Z</review_timestamp>'));
});

// ── Scale ────────────────────────────────────────────────────────────────────────────

test('a realistic full feed stays well-formed at the 5000-review query cap', () => {
  const many = Array.from({ length: 5000 }, (_, i) =>
    review({
      id: `r${i}`,
      rating: (i % 5) + 1,
      title: i % 3 === 0 ? null : `Title & ${i}`,
      body: `Review <${i}> body & more`,
      isIncentivized: i % 7 === 0,
      verificationStatus: i % 2 === 0 ? 'verified_buyer' : null,
      product: { shopifyId: `gid://${i}`, handle: i % 11 === 0 ? null : `p-${i}`, title: `Product & ${i}` },
    })
  );
  const doc = parse(buildProductReviewsFeed(store, many));
  assert.strictEqual(find(doc, 'review').length, 5000);
});

// ── Run ──────────────────────────────────────────────────────────────────────────────

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
