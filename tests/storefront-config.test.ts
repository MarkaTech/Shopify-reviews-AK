/**
 * Offline tests for the storefront configuration layer.
 *
 * The pure parts, plus getStorefrontConfig against an in-process stand-in for the database
 * client: nothing connects and nothing is written. No network. Run with:
 *
 *   npx --yes bun@latest run tests/storefront-config.test.ts
 *
 * The CSS sanitiser gets the most attention here because it is the one function in this
 * module whose output is injected into a merchant's live storefront. Everything else is a
 * wrong colour; a hole in that function is script execution in a shopper's session.
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  pairedCardText,
  pairCardTextForLayout,
  getStorefrontConfig,
  saveStorefrontConfig,
  PAGINATION_STYLES,
  LOCALE_TEXT_KEYS,
  leaveDefaultsToLocale,
  type StorefrontConfig,
} from '../src/lib/storefront-config';
import { BRAND, contrastRatio } from '../src/lib/brand';
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

console.log('\nCard text pairing — which layouts get one');

const paired = (theme: string, type: StorefrontConfig['layout']['type'], cardBg: string | null, cardText: string | null = null) => {
  const config = {
    colors: { ...DEFAULT_CONFIG.colors, cardBg, cardText },
    layout: { ...DEFAULT_CONFIG.layout, theme, type },
  };
  pairCardTextForLayout(config);
  return config.colors.cardText;
};

test('pairedCardText is the choice pairCardText makes', () => {
  for (const bg of ['#111827', '#fdf1de', '#1B3358', '#E8871E', '#808080', '#fff', '#000000ff']) {
    const colors = { ...DEFAULT_CONFIG.colors, cardBg: bg, cardText: null };
    pairCardText(colors);
    assert.strictEqual(colors.cardText, pairedCardText(bg), bg);
  }
});

test('Minimal on the page gets no paired text: it paints no card for the text to sit on', () => {
  // The widget already live colours a Minimal review with var(--rm-card-text, inherit). A
  // text paired with the light card it never draws put #1f2937 onto a dark theme's page.
  for (const type of ['list', 'grid', 'masonry', 'carousel', 'testimonial', 'badge'] as const) {
    assert.strictEqual(paired('minimal', type, '#fdf1de'), null, type);
  }
});

test('Minimal in an overlay still pairs: the panel paints the card background', () => {
  for (const type of ['floating', 'popup', 'sidebar'] as const) {
    assert.strictEqual(paired('minimal', type, '#111827'), '#ffffff', type);
  }
});

test('every theme that draws cards pairs, on every layout', () => {
  for (const theme of ['modern', 'classic', 'bold']) {
    for (const type of LAYOUTS) {
      assert.strictEqual(paired(theme, type, '#111827'), '#ffffff', `${theme} ${type}`);
    }
  }
});

test('a chosen card text is kept under every theme, Minimal included', () => {
  assert.strictEqual(paired('minimal', 'grid', '#111827', '#ff0000'), '#ff0000');
  assert.strictEqual(paired('modern', 'grid', '#111827', '#ff0000'), '#ff0000');
});

console.log('\nThe widget pairs card text too (extension-src/reviewmaster.js)');

/**
 * Named functions lifted out of the widget's IIFE and evaluated on their own, with a
 * stand-in document. Brace counting is enough: these functions hold no brace inside a
 * string, and the {3,8} in isHex's regex is itself balanced.
 */
function widgetFunctions(names: string[], document: unknown): Record<string, (...args: any[]) => unknown> {
  const src = readFileSync(join(__dirname, '..', 'extension-src', 'reviewmaster.js'), 'utf8');
  const bodies = names.map((name) => {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `the widget has no function ${name}`);
    let depth = 0;
    let i = src.indexOf('{', start);
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) break;
    }
    return src.slice(start, i + 1);
  });
  return new Function('document', `${bodies.join('\n')}\nreturn { ${names.join(', ')} };`)(document);
}

/** Just the part of CSSStyleDeclaration applyColors uses. */
function fakeStyle() {
  const props: Record<string, string> = {};
  return {
    props,
    getPropertyValue: (k: string) => props[k] || '',
    setProperty: (k: string, v: string) => { props[k] = v; },
  };
}

const COLOUR_FNS = ['isHex', 'luminance', 'pairedText', 'pairedBackground', 'applyColors'];

test('the widget picks the same text as the server for every background', () => {
  const { pairedText } = widgetFunctions(COLOUR_FNS, {});
  // Every #rgb, which spans the whole range in 4096 steps, plus long forms.
  for (let i = 0; i < 4096; i++) {
    const bg = '#' + i.toString(16).padStart(3, '0');
    assert.strictEqual(pairedText(bg), pairedCardText(bg), bg);
  }
  for (const bg of ['#111827', '#fdf1de', '#1B3358', '#7f7f7f', '#767676', '#11182780', '#fffa']) {
    assert.strictEqual(pairedText(bg), pairedCardText(bg), bg);
  }
});

test('a background from a server that does not pair still goes out with readable text', () => {
  // The extension deployed ahead of the server: cardBg arrives with cardText null, and the
  // stylesheet's #1f2937 fallback would otherwise land on the merchant's dark card.
  const documentElement = { style: fakeStyle() };
  const { applyColors } = widgetFunctions(COLOUR_FNS, { documentElement });
  const root = { style: fakeStyle() };
  applyColors(root, { ...DEFAULT_CONFIG.colors, cardBg: '#111827', cardText: null });
  assert.strictEqual(root.style.props['--rm-card-bg'], '#111827');
  // Derived, so on the -auto variable: the cards read it, Minimal (which draws no card)
  // does not. The plain variable is reserved for what the merchant chose.
  assert.strictEqual(root.style.props['--rm-card-text-auto'], '#ffffff');
  assert.strictEqual(root.style.props['--rm-card-text'], undefined);
  // NOT on the document root: card colours stay with the widget that drew them.
  assert.strictEqual(documentElement.style.props['--rm-card-text-auto'], undefined);
  assert.strictEqual(documentElement.style.props['--rm-card-bg'], undefined);
});

test('two widgets on one page keep their own card colours', () => {
  // A floating widget with a dark panel (paired white text) and a Minimal list with no
  // card text: the list must not inherit the panel's white through the document root.
  const documentElement = { style: fakeStyle() };
  const { applyColors } = widgetFunctions(COLOUR_FNS, { documentElement });
  const panel = { style: fakeStyle() };
  applyColors(panel, { ...DEFAULT_CONFIG.colors, cardBg: '#111827', cardText: '#ffffff' });
  const list = { style: fakeStyle() };
  applyColors(list, { ...DEFAULT_CONFIG.colors, cardBg: '#111827', cardText: null });
  for (const k of ['--rm-card-text', '--rm-card-bg', '--rm-card-text-auto', '--rm-card-bg-auto', '--rm-card-text-bare']) {
    assert.strictEqual(documentElement.style.props[k], undefined, `${k} leaked to the document root`);
  }
  assert.strictEqual(list.style.props['--rm-card-text'], undefined);
  // Page-wide colours still reach the root for the Liquid-only star block.
  assert.ok(documentElement.style.props['--rm-star-color']);
});

test('a 5- or 7-digit hex is not a colour, and gets no derived surface', () => {
  const documentElement = { style: fakeStyle() };
  const { applyColors, pairedBackground } = widgetFunctions(COLOUR_FNS, { documentElement });
  assert.strictEqual(pairedBackground('#fffff'), null);
  const root = { style: fakeStyle() };
  applyColors(root, { ...DEFAULT_CONFIG.colors, cardBg: null, cardText: '#fffff' });
  assert.strictEqual(root.style.props['--rm-card-text'], undefined);
  assert.strictEqual(root.style.props['--rm-card-bg-auto'], undefined);
});

test('a text colour chosen on its own gets a surface it can be read on', () => {
  const documentElement = { style: fakeStyle() };
  const { applyColors } = widgetFunctions(COLOUR_FNS, { documentElement });
  const light = { style: fakeStyle() };
  applyColors(light, { ...DEFAULT_CONFIG.colors, cardBg: null, cardText: '#ffffff' });
  assert.strictEqual(light.style.props['--rm-card-text'], '#ffffff');
  assert.strictEqual(light.style.props['--rm-card-bg-auto'], '#111827');
  // Chosen with no card: the one text Minimal may use.
  assert.strictEqual(light.style.props['--rm-card-text-bare'], '#ffffff');
  const dark = { style: fakeStyle() };
  applyColors(dark, { ...DEFAULT_CONFIG.colors, cardBg: null, cardText: '#1f2937' });
  assert.strictEqual(dark.style.props['--rm-card-bg-auto'], '#ffffff');
});

test('the widget keeps a chosen card text, and publishes none without a background', () => {
  const documentElement = { style: fakeStyle() };
  const { applyColors } = widgetFunctions(COLOUR_FNS, { documentElement });
  const chosen = { style: fakeStyle() };
  applyColors(chosen, { ...DEFAULT_CONFIG.colors, cardBg: '#111827', cardText: '#ff0000' });
  assert.strictEqual(chosen.style.props['--rm-card-text'], '#ff0000');
  assert.strictEqual(chosen.style.props['--rm-card-text-auto'], undefined);
  assert.strictEqual(chosen.style.props['--rm-card-bg-auto'], undefined);
  // Chosen together with a card: picked against that card, so not for Minimal's bare page.
  assert.strictEqual(chosen.style.props['--rm-card-text-bare'], undefined);

  const bare = { style: fakeStyle() };
  applyColors(bare, { ...DEFAULT_CONFIG.colors, cardBg: null, cardText: null });
  assert.strictEqual(bare.style.props['--rm-card-bg'], undefined);
  assert.strictEqual(bare.style.props['--rm-card-text'], undefined);
  assert.strictEqual(bare.style.props['--rm-card-text-auto'], undefined);
  assert.strictEqual(bare.style.props['--rm-card-bg-auto'], undefined);
});

console.log('\nThe stylesheet pairs its own fallbacks');

const CSS = readFileSync(join(__dirname, '..', 'extensions', 'reviewmaster', 'assets', 'reviewmaster.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1].split(',').map((x) => x.trim()),
  body: m[2],
  at: m.index ?? 0,
}));

test('dark fallback text only ever sits on a light fallback surface', () => {
  // Chosen, then derived, then the fallback: var(--rm-card-text, var(--rm-card-text-auto, X)).
  const dark = rules.filter((r) =>
    /(^|;|\s)color:\s*var\(--rm-card-text,\s*var\(--rm-card-text-auto,\s*#1f2937\)\)/.test(r.body)
  );
  assert.ok(dark.length > 0, 'found no rule with the dark text fallback');
  for (const r of dark) {
    const bg = /background:\s*var\(--rm-card-bg,\s*var\(--rm-card-bg-auto,\s*(#[0-9a-fA-F]{3,8})\)\)/.exec(r.body);
    assert.ok(bg, `${r.selectors.join(', ')} has dark fallback text and no card background fallback`);
    assert.ok((contrastRatio('#1f2937', bg[1]) ?? 0) >= 4.5, `${r.selectors.join(', ')} pairs #1f2937 with ${bg[1]}`);
  }
});

test('Minimal takes the colour of what it sits on, and wins over the card layouts', () => {
  // Same specificity as `.rm-widget--grid .rm-review` and the rest, so it has to come
  // later, and it has to set the colour: otherwise it kept the cards' #1f2937 on a page
  // with no card under it.
  const minimal = rules.find((r) => r.selectors.includes('.rm-theme--minimal .rm-review'));
  assert.ok(minimal, 'no Minimal review rule');
  assert.match(minimal.body, /background:\s*transparent/);
  // Only a text chosen WITHOUT a card; never one chosen for, or derived from, a card that
  // Minimal does not paint.
  assert.match(minimal.body, /(^|;|\s)color:\s*var\(--rm-card-text-bare,\s*inherit\)\s*(;|$)/);
  assert.doesNotMatch(minimal.body, /--rm-card-text-auto|--rm-card-text[,)]/);
  const cards = rules.filter((r) =>
    r.selectors.some((x) => /^\.rm-widget--[a-z]+ \.rm-review$/.test(x)) && /(^|;|\s)color:/.test(r.body)
  );
  assert.ok(cards.length > 0);
  for (const r of cards) assert.ok(r.at < minimal.at, `${r.selectors.join(', ')} comes after Minimal`);
});

test('a Bold border is drawn in the card text colour, so it shows wherever the text does', () => {
  const bold = rules.find((r) => r.selectors.includes('.rm-theme--bold .rm-review'));
  assert.ok(bold, 'no Bold review rule');
  assert.match(bold.body, /border:\s*2px solid currentColor/);
});

console.log('\nThe review page header tile');

test('navy or cream always gives the store star at least 3:1, so the tile is never empty', () => {
  // src/app/r/[token]/page.tsx picks whichever of the two the star contrasts with more. A
  // page cannot export a helper, so this checks the guarantee it relies on: for every
  // #rgb star colour the better tile clears WCAG's 3:1 for a graphic.
  let worst = Infinity;
  for (let i = 0; i < 4096; i++) {
    const star = '#' + i.toString(16).padStart(3, '0');
    worst = Math.min(worst, Math.max(contrastRatio(star, BRAND.navy) ?? 0, contrastRatio(star, BRAND.cream) ?? 0));
  }
  assert.ok(worst >= 3, `worst case ${worst.toFixed(2)}:1`);
  // And the default orange keeps the navy tile it always had.
  assert.ok((contrastRatio(BRAND.orange, BRAND.navy) ?? 0) > (contrastRatio(BRAND.orange, BRAND.cream) ?? 0));
});

console.log('\n"See more" and the highlights box: behaviour and words');

test('"See more" is the default, adding ten each time; perPage stays the first page', () => {
  assert.strictEqual(DEFAULT_CONFIG.behaviour.paginationStyle, 'loadMore');
  assert.strictEqual(DEFAULT_CONFIG.behaviour.loadMoreCount, 10);
  assert.strictEqual(DEFAULT_CONFIG.behaviour.perPage, 5);
  assert.deepStrictEqual([...PAGINATION_STYLES].sort(), ['loadMore', 'pages']);
  assert.ok(VALID_KEYS.has('sf.behaviour.paginationStyle'));
  assert.ok(VALID_KEYS.has('sf.behaviour.loadMoreCount'));
});

/**
 * The English the widget's new words default to, exactly as the theme's locale file
 * (extensions/reviewmaster/locales/en.default.json) words them, keyed as the widget asks.
 */
const NEW_WORDS: Record<string, [string, string]> = {
  seeMore: ['see_more', 'See more reviews'],
  loadingMore: ['loading_more', 'Loading…'],
  loadMoreError: ['load_more_error', 'Could not load more reviews. Please try again.'],
  showingOf: ['showing_of', 'Showing {shown} of {total} reviews'],
  readMore: ['read_more', 'Read more'],
  showLess: ['show_less', 'Show less'],
  verifiedShort: ['verified_short', 'Verified'],
  highlightsLabel: ['highlights_label', 'Customer reviews'],
  previousReview: ['previous_review', 'Previous review'],
  nextReview: ['next_review', 'Next review'],
  slideLabel: ['slide_label', '{index} of {total}'],
  pauseRotation: ['pause_rotation', 'Stop rotating reviews'],
  playRotation: ['play_rotation', 'Start rotating reviews'],
  aboutProduct: ['about_product', 'on {product}'],
  highlightsEmpty: ['highlights_empty', 'Nothing to show here yet. This box shows 4 and 5 star reviews with a few lines of text, and with Featured, reviews you mark with Feature in Marka Reviews → All reviews.'],
};

test('every new widget word has an English default identical to the locale file', () => {
  const locale = JSON.parse(
    readFileSync(join(__dirname, '..', 'extensions', 'reviewmaster', 'locales', 'en.default.json'), 'utf8')
  ).reviewmaster as Record<string, unknown>;
  const text = DEFAULT_CONFIG.text as Record<string, string>;
  for (const [key, [localeKey, english]] of Object.entries(NEW_WORDS)) {
    assert.strictEqual(text[key], english, key);
    // The locale file gains these with the extension release; where it has one, the two match.
    if (localeKey in locale) assert.strictEqual(locale[localeKey], english, localeKey);
    assert.ok(VALID_KEYS.has(`sf.text.${key}`), `sf.text.${key} cannot be saved`);
  }
  assert.deepStrictEqual([...LOCALE_TEXT_KEYS].sort(), Object.keys(NEW_WORDS).sort());
});

test('every word the widget asks t() for can be configured, or is a known exception', () => {
  // Q&A copy predates this and is not in the text config: the widget's own English applies.
  const NOT_CONFIGURABLE = new Set([
    'askQuestion', 'noQuestions', 'noQuestionsPlain', 'storeAnswer', 'questionThanks',
    'questionsHeading', 'questionInvalid', 'questionError',
  ]);
  const src = readFileSync(join(__dirname, '..', 'extension-src', 'reviewmaster.js'), 'utf8');
  const asked = new Set<string>();
  // t('key', ...) and t(cond ? 'a' : 'b'). Not preceded by a word character, so
  // createElement('style') and the like are not mistaken for one.
  for (const m of src.matchAll(/(?<![\w.$])t\(\s*'([A-Za-z]+)'/g)) asked.add(m[1]);
  for (const m of src.matchAll(/(?<![\w.$])t\([^'()]*\?\s*'([A-Za-z]+)'\s*:\s*'([A-Za-z]+)'\s*\)/g)) {
    asked.add(m[1]);
    asked.add(m[2]);
  }
  assert.ok(asked.has('verifiedBadge'), 'found none of the t() calls');
  for (const key of asked) {
    assert.ok(key in DEFAULT_CONFIG.text || NOT_CONFIGURABLE.has(key), `the widget asks for ${key}, which has no default`);
  }
});

test('the storefront gets the new words blank while they are the default, so the locale applies', () => {
  const text = { ...DEFAULT_CONFIG.text, seeMore: 'Mehr Bewertungen' };
  leaveDefaultsToLocale(text);
  assert.strictEqual(text.seeMore, 'Mehr Bewertungen');
  assert.strictEqual(text.readMore, '');
  assert.strictEqual(text.slideLabel, '');
  // The strings from before the locale handover go out as they always have.
  assert.strictEqual(text.heading, DEFAULT_CONFIG.text.heading);
  assert.strictEqual(text.verifiedBadge, DEFAULT_CONFIG.text.verifiedBadge);
});

/** Async tests, run in order after the synchronous ones above. */
const asyncTests: Array<[string, () => Promise<void>]> = [];
const testAsync = (name: string, fn: () => Promise<void>) => asyncTests.push([name, fn]);

/**
 * Stand in for the three queries getStorefrontConfig makes, on the shared client
 * instance. Nothing connects: the stand-ins are plain objects, and this process runs only
 * this file.
 */
function stubDb(settings: Record<string, string>, widgets: Array<{ widgetType: string; placement: string; config: string }> = []) {
  const updatedAt = new Date();
  const stubs: Record<string, unknown> = {
    storeSetting: { findMany: async () => Object.entries(settings).map(([key, value]) => ({ key, value, updatedAt })) },
    widgetConfig: { findMany: async () => widgets },
    store: { findUnique: async () => ({ plan: 'free' }) },
  };
  for (const [model, stub] of Object.entries(stubs)) {
    Object.defineProperty(db, model, { value: stub, configurable: true, writable: true });
  }
}

testAsync('the storefront read pairs a card background left with theme text', async () => {
  stubDb({ 'sf.color.cardBg': '#111827' });
  const config = await getStorefrontConfig('store', null);
  assert.strictEqual(config.colors.cardText, '#ffffff');
});

testAsync('the admin read (pairText: false) returns only what the merchant chose', async () => {
  // Otherwise Settings shows a derived #ffffff as the merchant's "Card text", with a
  // "Use theme colour" link that the next read undoes.
  stubDb({ 'sf.color.cardBg': '#111827' });
  const config = await getStorefrontConfig('store', undefined, { pairText: false });
  assert.strictEqual(config.colors.cardBg, '#111827');
  assert.strictEqual(config.colors.cardText, null);
});

testAsync('the admin read still returns a card text the merchant did choose', async () => {
  stubDb({ 'sf.color.cardBg': '#111827', 'sf.color.cardText': '#ff0000' });
  const config = await getStorefrontConfig('store', undefined, { pairText: false });
  assert.strictEqual(config.colors.cardText, '#ff0000');
});

testAsync('Minimal pairs or not by the layout the placement really renders', async () => {
  // The theme is a store setting; the layout comes from the placement's widget, so the
  // decision has to follow applyActiveWidget.
  stubDb({ 'sf.color.cardBg': '#fdf1de', 'sf.layout.theme': 'minimal', 'sf.layout.type': 'grid' });
  assert.strictEqual((await getStorefrontConfig('store', null)).colors.cardText, null);

  stubDb(
    { 'sf.color.cardBg': '#fdf1de', 'sf.layout.theme': 'minimal', 'sf.layout.type': 'grid' },
    [{ widgetType: 'floating', placement: 'all_pages', config: '{}' }]
  );
  assert.strictEqual((await getStorefrontConfig('store', null)).colors.cardText, '#1f2937');
});

testAsync('loadMoreCount is read back within 1..50, and junk is the default', async () => {
  for (const [saved, read] of [['7', 7], ['0', 1], ['-3', 1], ['99', 50], ['12.6', 13], ['abc', 10]] as const) {
    stubDb({ 'sf.behaviour.loadMoreCount': saved });
    assert.strictEqual((await getStorefrontConfig('store', null)).behaviour.loadMoreCount, read, saved);
  }
});

testAsync('paginationStyle is read back only as one of the two styles', async () => {
  stubDb({ 'sf.behaviour.paginationStyle': 'pages' });
  assert.strictEqual((await getStorefrontConfig('store', null)).behaviour.paginationStyle, 'pages');
  stubDb({ 'sf.behaviour.paginationStyle': 'infinite' });
  assert.strictEqual((await getStorefrontConfig('store', null)).behaviour.paginationStyle, 'loadMore');
  stubDb({});
  assert.strictEqual((await getStorefrontConfig('store', null)).behaviour.paginationStyle, 'loadMore');
});

testAsync('saving refuses an unknown paginationStyle and keeps the valid ones', async () => {
  const written: Record<string, string> = {};
  Object.defineProperty(db, 'storeSetting', {
    value: {
      upsert: async ({ create }: { create: { key: string; value: string } }) => {
        written[create.key] = create.value;
      },
    },
    configurable: true,
    writable: true,
  });
  const result = await saveStorefrontConfig('store', {
    'sf.behaviour.paginationStyle': 'infinite',
    'sf.behaviour.loadMoreCount': '20',
    'sf.text.seeMore': 'Show <b>more</b>',
  });
  assert.deepStrictEqual(result.rejected, ['sf.behaviour.paginationStyle']);
  assert.ok(!('sf.behaviour.paginationStyle' in written));
  assert.strictEqual(written['sf.behaviour.loadMoreCount'], '20');
  // The new words go through the same sanitising as every other text key.
  assert.strictEqual(written['sf.text.seeMore'], 'Show bmore/b');
  const ok = await saveStorefrontConfig('store', { 'sf.behaviour.paginationStyle': 'pages' });
  assert.deepStrictEqual(ok.rejected, []);
  assert.strictEqual(written['sf.behaviour.paginationStyle'], 'pages');
});

testAsync('the storefront read leaves untouched new words to the locale; a merchant\'s own goes out', async () => {
  stubDb({ 'sf.text.seeMore': 'Load more reviews' });
  const shop = await getStorefrontConfig('store', null);
  assert.strictEqual(shop.text.seeMore, 'Load more reviews');
  assert.strictEqual(shop.text.readMore, '');
  assert.strictEqual(shop.text.heading, 'Customer reviews');
});

testAsync('the admin read (localeText: false) shows the English defaults to edit against', async () => {
  stubDb({});
  const admin = await getStorefrontConfig('store', undefined, { pairText: false, localeText: false });
  assert.strictEqual(admin.text.readMore, 'Read more');
  assert.strictEqual(admin.text.showingOf, 'Showing {shown} of {total} reviews');
});

void (async () => {
  if (asyncTests.length) console.log('\ngetStorefrontConfig and saveStorefrontConfig against a stand-in database');
  for (const [name, fn] of asyncTests) {
    try {
      await fn();
      passed++;
      console.log(`  ok  ${name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL  ${name}`);
      console.error(`        ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
})();
