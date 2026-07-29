/**
 * Offline tests for the storefront configuration layer.
 *
 * Only the pure parts — no database, no network. Run with:
 *
 *   npx tsx tests/storefront-config.test.ts
 *
 * The CSS sanitiser gets the most attention here because it is the one function in this
 * module whose output is injected into a merchant's live storefront. Everything else is a
 * wrong colour; a hole in that function is script execution in a shopper's session.
 */

import assert from 'node:assert';
import {
  sanitiseCss,
  DEFAULT_CONFIG,
  VALID_KEYS,
  LAYOUTS,
} from '../src/lib/storefront-config';

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

console.log('\nsanitiseCss — the storefront injection surface');

test('passes ordinary CSS through unchanged', () => {
  const css = '.rm-review { border-radius: 12px; color: #333; }';
  assert.strictEqual(sanitiseCss(css), css);
});

test('strips angle brackets, so </style> breakout is impossible', () => {
  const out = sanitiseCss('.a{} </style><script>alert(1)</script>');
  assert.ok(!out.includes('<'), 'left an angle bracket behind');
  assert.ok(!out.includes('>'), 'left an angle bracket behind');
});

test('removes @import, which fetches and executes third-party CSS', () => {
  const out = sanitiseCss("@import url('https://evil.example/x.css'); .a { color: red }");
  assert.ok(!/@import/i.test(out), '@import survived');
  assert.ok(out.includes('color: red'), 'threw away the legitimate rule too');
});

test('removes @import regardless of case or spacing', () => {
  assert.ok(!/@import/i.test(sanitiseCss('@IMPORT  "x.css";')));
  assert.ok(!/@import/i.test(sanitiseCss('@Import url(x);')));
});

test('removes expression(), the legacy IE script vector', () => {
  const out = sanitiseCss('.a { width: expression(alert(1)); }');
  assert.ok(!/expression\s*\(/i.test(out));
});

test('removes javascript: URLs', () => {
  const out = sanitiseCss('.a { background: url(javascript:alert(1)); }');
  assert.ok(!/javascript\s*:/i.test(out));
});

test('keeps https url()', () => {
  const css = '.a { background: url(https://cdn.shopify.com/x.png); }';
  assert.ok(sanitiseCss(css).includes('https://cdn.shopify.com/x.png'));
});

test('keeps data: image url()', () => {
  const css = '.a { background: url(data:image/png;base64,iVBOR); }';
  assert.ok(sanitiseCss(css).includes('data:image/png'));
});

test('neutralises http:// url() — mixed content on an HTTPS storefront', () => {
  const out = sanitiseCss('.a { background: url(http://insecure.example/x.png); }');
  assert.ok(!out.includes('http://insecure.example'), 'insecure URL survived');
});

test('neutralises protocol-relative and bare-path url()', () => {
  assert.ok(!sanitiseCss('.a{background:url(//evil.example/x)}').includes('evil.example'));
  assert.ok(!sanitiseCss('.a{background:url("/tracker.gif")}').includes('tracker.gif'));
});

test('caps length so one merchant cannot ship a megabyte to every product page', () => {
  assert.ok(sanitiseCss('a'.repeat(50_000)).length <= 20_000);
});

test('handles null and undefined without throwing', () => {
  assert.strictEqual(sanitiseCss(undefined as unknown as string), '');
  assert.strictEqual(sanitiseCss(null as unknown as string), '');
});

console.log('\nDEFAULT_CONFIG and key validation');

test('every default colour is a valid hex, since they land in a style attribute', () => {
  for (const [name, value] of Object.entries(DEFAULT_CONFIG.colors)) {
    assert.match(value, /^#[0-9a-fA-F]{3,8}$/, `${name} is not a hex colour: ${value}`);
  }
});

test('the default layout is one of the nine offered types', () => {
  assert.ok((LAYOUTS as readonly string[]).includes(DEFAULT_CONFIG.layout.type));
});

test('defaults are safe: reviews are moderated and names are required', () => {
  assert.strictEqual(DEFAULT_CONFIG.behaviour.autoPublish, false);
  assert.strictEqual(DEFAULT_CONFIG.behaviour.allowAnonymous, false);
  assert.strictEqual(DEFAULT_CONFIG.behaviour.requireEmail, true);
});

test('VALID_KEYS covers every group, so no field is silently unsaveable', () => {
  for (const k of Object.keys(DEFAULT_CONFIG.colors)) assert.ok(VALID_KEYS.has(`sf.color.${k}`), k);
  for (const k of Object.keys(DEFAULT_CONFIG.layout)) assert.ok(VALID_KEYS.has(`sf.layout.${k}`), k);
  for (const k of Object.keys(DEFAULT_CONFIG.text)) assert.ok(VALID_KEYS.has(`sf.text.${k}`), k);
  for (const k of Object.keys(DEFAULT_CONFIG.behaviour)) assert.ok(VALID_KEYS.has(`sf.behaviour.${k}`), k);
  assert.ok(VALID_KEYS.has('sf.customCss'));
});

test('VALID_KEYS rejects anything outside the namespace', () => {
  assert.ok(!VALID_KEYS.has('plan'));
  assert.ok(!VALID_KEYS.has('sf.behaviour.__proto__'));
  assert.ok(!VALID_KEYS.has('accessToken'));
});

test('the thank-you copy does not promise moderation when auto-publish is on', () => {
  assert.ok(/approval/i.test(DEFAULT_CONFIG.text.thankYou));
  assert.ok(!/approval/i.test(DEFAULT_CONFIG.text.thankYouPublished));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
