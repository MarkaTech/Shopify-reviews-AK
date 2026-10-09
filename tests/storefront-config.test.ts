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
  STAR_STYLES,
  BADGE_ICONS,
  FONT_FAMILY,
  rebrandLegacyDefaults,
  LEGACY_DEFAULT_COLORS,
  REBRAND_DEPLOYED_AT,
  pairCardText,
} from '../src/lib/storefront-config';
import { BRAND } from '../src/lib/brand';

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

test('every default colour is either a valid hex or null, since they land in a style attribute', () => {
  for (const [name, value] of Object.entries(DEFAULT_CONFIG.colors)) {
    if (value === null) continue;
    assert.match(value, /^#[0-9a-fA-F]{3,8}$/, `${name} is not a hex colour: ${value}`);
  }
});

test('card background, text and border default to null so the merchant theme shows through', () => {
  // Not cosmetic. When these carried concrete light values the CSS fallbacks
  // `var(--rm-card-bg, transparent)` and `var(--rm-card-text, inherit)` were unreachable,
  // so a store on a dark theme got a block of white cards it had to hunt for a setting to
  // fix. Null means the custom property is never set and the theme's own colours apply.
  assert.strictEqual(DEFAULT_CONFIG.colors.cardBg, null);
  assert.strictEqual(DEFAULT_CONFIG.colors.cardText, null);
  assert.strictEqual(DEFAULT_CONFIG.colors.border, null);
});

test('the colours that must always be set still are — they have no sensible theme fallback', () => {
  // accent and star are the widget's own identity; inheriting them would render invisible
  // stars on some themes.
  for (const name of ['accent', 'star', 'verifiedBg', 'verifiedText'] as const) {
    assert.match(
      String(DEFAULT_CONFIG.colors[name]),
      /^#[0-9a-fA-F]{3,8}$/,
      `${name} must be a concrete hex colour`
    );
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

// ── The Marka look: the default, and every part of it the merchant's to change ──

test('the default look is Marka: tick-star ratings, tick-star badge icon, theme font', () => {
  assert.strictEqual(DEFAULT_CONFIG.layout.starStyle, 'tick');
  assert.strictEqual(DEFAULT_CONFIG.layout.badgeIcon, 'tick');
  assert.strictEqual(DEFAULT_CONFIG.layout.fontFamily, '');
  assert.ok((STAR_STYLES as readonly string[]).includes('classic'));
  assert.ok((BADGE_ICONS as readonly string[]).includes('none'));
});

test('a font family a merchant types is accepted when it is only a name', () => {
  for (const ok of ['Georgia', 'Playfair Display, serif', 'Open-Sans', 'Inter, Helvetica, Arial, sans-serif']) {
    assert.ok(FONT_FAMILY.test(ok), ok);
  }
});

test('a font family that could escape its CSS declaration is refused', () => {
  for (const bad of [
    'Georgia; background: url(https://evil.example)',
    'x}body{display:none',
    '"Georgia"',
    "'Georgia'",
    'Georgia)',
    'a\\62 ody',
    '<script>',
    '1Georgia',
    ' Georgia',
    'A'.repeat(81),
  ]) {
    assert.ok(!FONT_FAMILY.test(bad), bad);
  }
});

// ── The rebrand remap: only for values saved before the rename ──
//
// The remap used to apply on every read regardless of when the row was written, which made
// the old defaults unreachable: a merchant who typed the old green after the rename had it
// taken away on the next read. The row's updatedAt against the rename date is the guard.

console.log('\nrebrandLegacyDefaults — the pre-rename defaults, and when they are a choice');

const legacy = () => ({
  ...DEFAULT_CONFIG.colors,
  accent: LEGACY_DEFAULT_COLORS.accent!,
  star: LEGACY_DEFAULT_COLORS.star!,
  verifiedBg: LEGACY_DEFAULT_COLORS.verifiedBg!,
  verifiedText: LEGACY_DEFAULT_COLORS.verifiedText!,
});
const DAY = 24 * 3600 * 1000;
const before = new Date(REBRAND_DEPLOYED_AT.getTime() - DAY);
const after = new Date(REBRAND_DEPLOYED_AT.getTime() + DAY);

test('a legacy default saved before the rename moves to the Marka default', () => {
  const colors = legacy();
  rebrandLegacyDefaults(colors, { accent: before, star: before, verifiedBg: before, verifiedText: before });
  assert.strictEqual(colors.accent, DEFAULT_CONFIG.colors.accent);
  assert.strictEqual(colors.star, DEFAULT_CONFIG.colors.star);
  assert.strictEqual(colors.verifiedBg, DEFAULT_CONFIG.colors.verifiedBg);
  assert.strictEqual(colors.verifiedText, DEFAULT_CONFIG.colors.verifiedText);
});

test('a legacy default saved after the rename is a choice, and is kept', () => {
  const colors = legacy();
  rebrandLegacyDefaults(colors, { accent: after, star: after, verifiedBg: after, verifiedText: after });
  assert.strictEqual(colors.accent, LEGACY_DEFAULT_COLORS.accent);
  assert.strictEqual(colors.star, LEGACY_DEFAULT_COLORS.star);
  assert.strictEqual(colors.verifiedBg, LEGACY_DEFAULT_COLORS.verifiedBg);
  assert.strictEqual(colors.verifiedText, LEGACY_DEFAULT_COLORS.verifiedText);
});

test('the date is per field: a green chosen after the rename does not keep an old star', () => {
  const colors = legacy();
  rebrandLegacyDefaults(colors, { accent: after, star: before });
  assert.strictEqual(colors.accent, LEGACY_DEFAULT_COLORS.accent);
  assert.strictEqual(colors.star, DEFAULT_CONFIG.colors.star);
});

test('no save date means the historical behaviour: remapped', () => {
  // What a caller that did not look the date up gets — the safe reading, since a legacy
  // value can only have come from a row.
  const colors = legacy();
  rebrandLegacyDefaults(colors);
  assert.strictEqual(colors.accent, DEFAULT_CONFIG.colors.accent);
  assert.strictEqual(colors.star, DEFAULT_CONFIG.colors.star);
});

test('the deploy instant itself counts as after: a row written then is a choice', () => {
  const colors = legacy();
  rebrandLegacyDefaults(colors, { accent: new Date(REBRAND_DEPLOYED_AT) });
  assert.strictEqual(colors.accent, LEGACY_DEFAULT_COLORS.accent);
});

test('a row written on 8 October BEFORE the deploy is still remapped', () => {
  // The old Settings screen was live until 16:46Z that day and still offered the old
  // green as its default; a save that morning was not a post-rename choice.
  const colors = legacy();
  rebrandLegacyDefaults(colors, { accent: new Date('2026-10-08T09:00:00Z') });
  assert.strictEqual(colors.accent, DEFAULT_CONFIG.colors.accent);
});

test('a custom card background with theme text gets readable text', () => {
  const dark = { ...DEFAULT_CONFIG.colors, cardBg: '#111827', cardText: null };
  pairCardText(dark);
  assert.strictEqual(dark.cardText, '#ffffff');
  const light = { ...DEFAULT_CONFIG.colors, cardBg: '#fdf1de', cardText: null };
  pairCardText(light);
  assert.strictEqual(light.cardText, '#1f2937');
});

test('a chosen card text is never overridden, and no background means nothing to pair', () => {
  const chosen = { ...DEFAULT_CONFIG.colors, cardBg: '#111827', cardText: '#ff0000' };
  pairCardText(chosen);
  assert.strictEqual(chosen.cardText, '#ff0000');
  const none = { ...DEFAULT_CONFIG.colors, cardBg: null, cardText: null };
  pairCardText(none);
  assert.strictEqual(none.cardText, null);
});

test('matching is case-insensitive: a lower-case hex from an older save is still the legacy default', () => {
  const colors = { ...legacy(), star: '#f5a623' };
  rebrandLegacyDefaults(colors, { star: before });
  assert.strictEqual(colors.star, DEFAULT_CONFIG.colors.star);
});

test('a colour the merchant actually picked is left alone, whenever it was saved', () => {
  for (const at of [before, after, undefined]) {
    const colors = { ...DEFAULT_CONFIG.colors, accent: '#123456', star: '#ABCDEF' };
    rebrandLegacyDefaults(colors, at ? { accent: at, star: at } : {});
    assert.strictEqual(colors.accent, '#123456');
    assert.strictEqual(colors.star, '#ABCDEF');
  }
});

test('badge text follows a merchant-chosen badge background by contrast when the text was never chosen', () => {
  // Cream text would be unreadable on the light green a merchant picked last year.
  const colors = { ...DEFAULT_CONFIG.colors, verifiedBg: '#E0F2E9' };
  rebrandLegacyDefaults(colors, { verifiedBg: before });
  assert.strictEqual(colors.verifiedText, BRAND.navy);
});

test('a legacy badge text saved after the rename is a choice too, and is not re-derived', () => {
  const colors = { ...DEFAULT_CONFIG.colors, verifiedBg: '#E0F2E9', verifiedText: LEGACY_DEFAULT_COLORS.verifiedText! };
  rebrandLegacyDefaults(colors, { verifiedBg: after, verifiedText: after });
  assert.strictEqual(colors.verifiedText, LEGACY_DEFAULT_COLORS.verifiedText);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
