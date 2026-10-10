/**
 * Offline tests for the storefront widget's "See more", highlights and jump logic, and for
 * the theme extension files that feed it.
 *
 * The widget is ES5 in extension-src/reviewmaster.js with no module system, so the pieces
 * under test are cut out of the source by name and evaluated with stand-ins for whatever
 * they reach for (the same approach as the colour tests in storefront-config.test.ts).
 * Nothing touches a network or a database. Run with:
 *
 *   npx --yes bun@latest run tests/widget.test.ts
 */

import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/lib/storefront-config';

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

const asyncTests: Array<[string, () => Promise<void>]> = [];
const testAsync = (name: string, fn: () => Promise<void>) => asyncTests.push([name, fn]);

const ROOT = join(__dirname, '..');
const SRC = readFileSync(join(ROOT, 'extension-src', 'reviewmaster.js'), 'utf8');
const BUILT = readFileSync(join(ROOT, 'extensions', 'reviewmaster', 'assets', 'reviewmaster.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'extensions', 'reviewmaster', 'assets', 'reviewmaster.css'), 'utf8');
const BLOCKS_DIR = join(ROOT, 'extensions', 'reviewmaster', 'blocks');
const BLOCKS: Record<string, string> = Object.fromEntries(
  readdirSync(BLOCKS_DIR).filter((f) => f.endsWith('.liquid')).map((f) => [f, readFileSync(join(BLOCKS_DIR, f), 'utf8')])
);
const LOCALE_EN = JSON.parse(readFileSync(join(ROOT, 'extensions', 'reviewmaster', 'locales', 'en.default.json'), 'utf8'));

/** The source text starting at `marker`, up to the brace that closes its first `{`. */
function slice(marker: string): string {
  const start = SRC.indexOf(marker);
  assert.ok(start >= 0, `the widget has no ${marker}`);
  let depth = 0;
  let i = SRC.indexOf('{', start);
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) break;
  }
  return SRC.slice(start, i + 1);
}

/**
 * Evaluate named pieces of the widget together.
 *
 *   fns      plain `function name(` declarations
 *   methods  'Widget.prototype.loadMore' and the like, returned under their short name
 *   vars     `var NAME = {...}` objects such as FALLBACK
 *   scope    names the pieces reach for, supplied by the test (CONFIG, document, getJson...)
 */
function widget(opts: { fns?: string[]; methods?: string[]; vars?: string[]; scope?: Record<string, unknown> }): any {
  const fns = (opts.fns || []).map((n) => slice(`function ${n}(`));
  const vars = (opts.vars || []).map((v) => slice(`var ${v} = `) + ';');
  const methods = (opts.methods || []).map((m) => {
    const text = slice(`${m} = function`);
    return `var ${m.split('.').pop()} = ${text.slice(text.indexOf('function'))};`;
  });
  const names = [...(opts.fns || []), ...(opts.methods || []).map((m) => m.split('.').pop())];
  const scope = opts.scope || {};
  const keys = Object.keys(scope);
  const body = `${vars.join('\n')}\n${fns.join('\n')}\n${methods.join('\n')}\nreturn { ${names.join(', ')} };`;
  return new Function(...keys, body)(...keys.map((k) => scope[k]));
}

/** The JSON between {% schema %} and {% endschema %}. */
function schema(file: string): any {
  const src = BLOCKS[file];
  assert.ok(src, `no block ${file}`);
  const m = /\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/.exec(src);
  assert.ok(m, `${file} has no schema`);
  return JSON.parse(m[1]);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

console.log('\nSee more: what is asked for, and what is drawn');

test('the next chunk is by offset, and by page from a server that predates offset', () => {
  const { nextChunk } = widget({ fns: ['nextChunk'] });
  assert.deepStrictEqual(nextChunk(5, 1, 5, 10, false), { offset: 5, limit: 10 });
  assert.deepStrictEqual(nextChunk(15, 1, 5, 10, false), { offset: 15, limit: 10 });
  // Pages are the first page's size, numbered from what was fetched, not what was shown.
  assert.deepStrictEqual(nextChunk(9, 2, 5, 10, true), { page: 3, limit: 5 });
  // A first page whose size the server never reported falls back to the step.
  assert.deepStrictEqual(nextChunk(5, 1, 0, 10, true), { page: 2, limit: 10 });
});

test('a review already on screen is never drawn twice, and the record is kept', () => {
  const { freshReviews } = widget({ fns: ['freshReviews'] });
  const seen = Object.create(null);
  assert.deepStrictEqual(freshReviews(seen, [{ id: 'a' }, { id: 'b' }]).map((r: any) => r.id), ['a', 'b']);
  // A review published between clicks pushes the rows down one: the next answer starts
  // with the last one shown.
  assert.deepStrictEqual(freshReviews(seen, [{ id: 'b' }, { id: 'c' }, { id: 'c' }]).map((r: any) => r.id), ['c']);
  assert.deepStrictEqual(freshReviews(seen, null), []);
  assert.deepStrictEqual(freshReviews(seen, [null, { title: 'no id' }]), []);
});

test('an id that is also an Object.prototype name is still a new review', () => {
  const { freshReviews } = widget({ fns: ['freshReviews'] });
  assert.strictEqual(freshReviews(Object.create(null), [{ id: 'constructor' }]).length, 1);
});

test('the load-more count is the merchant\'s, held to 1..50, 10 by default', () => {
  const make = (behaviour: Record<string, unknown> | null) => widget({
    fns: ['clampInt', 'behaviour'],
    methods: ['Widget.prototype.moreStep'],
    scope: { CONFIG: behaviour ? { behaviour } : null },
  }).moreStep();
  assert.strictEqual(make(null), 10);
  assert.strictEqual(make({}), 10);
  assert.strictEqual(make({ loadMoreCount: 25 }), 25);
  assert.strictEqual(make({ loadMoreCount: 0 }), 1);
  assert.strictEqual(make({ loadMoreCount: 500 }), 50);
  assert.strictEqual(make({ loadMoreCount: 'x' }), 10);
});

test('the first-page query is unchanged, and a chunk asks by offset or by page', () => {
  const { url } = widget({ methods: ['Widget.prototype.url'] });
  const w: any = {
    shop: 'a.myshopify.com', page: 1, perPage: 5, sort: 'recent', productId: '42',
    placement: 'product_page', rating: null, mediaOnly: false, appUrl: 'https://app', url,
  };
  // What the edge cache has been keyed on: shop, page, limit, then the rest.
  assert.strictEqual(w.url(),
    'https://app/api/storefront/reviews?shop=a.myshopify.com&page=1&limit=5&sort=recent&product_id=42&placement=product_page');
  assert.strictEqual(w.url({ offset: 5, limit: 10 }),
    'https://app/api/storefront/reviews?shop=a.myshopify.com&offset=5&limit=10&sort=recent&product_id=42&placement=product_page');
  assert.strictEqual(w.url({ page: 2, limit: 5 }),
    'https://app/api/storefront/reviews?shop=a.myshopify.com&page=2&limit=5&sort=recent&product_id=42&placement=product_page');
  w.perPage = 0;
  assert.strictEqual(w.url(), 'https://app/api/storefront/reviews?shop=a.myshopify.com&page=1&sort=recent&product_id=42&placement=product_page');
});

/** 23 reviews, newest first, as the server would page them. */
const ALL = Array.from({ length: 23 }, (_, i) => ({ id: `r${i + 1}`, rating: 5, body: `Review ${i + 1}` }));

function fakeNode() {
  const attrs: Record<string, string> = {};
  return {
    hidden: false,
    textContent: '',
    attrs,
    setAttribute(k: string, v: string) { attrs[k] = String(v); },
    removeAttribute(k: string) { delete attrs[k]; },
  };
}

/**
 * A review widget part-way through: the first page of five drawn, the footer built, and
 * the real loadMore, updateMore, url and moreStep on it. `server` answers each URL.
 */
function loadMoreRig(server: (url: string) => unknown, opts: { loadMoreCount?: number; focused?: boolean } = {}) {
  const calls: string[] = [];
  const focused: unknown[] = [];
  const children: any[] = [];
  const list = { ...fakeNode(), children, appendChild(n: any) { children.push(n); return n; } };
  const more = { info: fakeNode(), btn: fakeNode(), note: fakeNode() };
  const document = { activeElement: opts.focused ? more.btn : null };
  const scope = {
    CONFIG: { behaviour: { loadMoreCount: opts.loadMoreCount ?? 10 }, text: {} },
    LOCALE: {},
    document,
    getJson: (url: string) => {
      calls.push(url);
      try {
        const out = server(url);
        return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
      } catch (err) {
        return Promise.reject(err);
      }
    },
    focusQuietly: (node: unknown) => { focused.push(node); },
  };
  const m = widget({
    fns: ['t', 'clampInt', 'behaviour', 'freshReviews', 'nextChunk'],
    vars: ['FALLBACK'],
    methods: ['Widget.prototype.url', 'Widget.prototype.moreStep', 'Widget.prototype.updateMore', 'Widget.prototype.loadMore'],
    scope,
  });
  const w: any = {
    shop: 's.myshopify.com', page: 1, perPage: 5, sort: 'recent', productId: '42', placement: '',
    rating: null, mediaOnly: false, appUrl: 'https://app',
    listEl: list, more, legacyPaging: false, gen: 1, seen: Object.create(null), shown: 0,
    total: 23, morePage: 1, moreBusy: false, moreDone: false,
    card: (r: any) => ({ id: r.id }),
    url: m.url, moreStep: m.moreStep, updateMore: m.updateMore, loadMore: m.loadMore,
  };
  ALL.slice(0, 5).forEach((r) => { w.seen[r.id] = 1; children.push({ id: r.id }); });
  w.shown = 5;
  w.updateMore('');
  return { w, calls, focused, list, more, document };
}

/** A server that understands offset, and says so by echoing it. */
function modern(rows = ALL) {
  return (url: string) => {
    const q = new URL(url).searchParams;
    const limit = Number(q.get('limit'));
    const offset = Number(q.get('offset'));
    return { reviews: rows.slice(offset, offset + limit), total: rows.length, offset, limit };
  };
}

/** A server from before offset: it reads page and limit only, and never mentions offset. */
function legacy(rows = ALL) {
  return (url: string) => {
    const q = new URL(url).searchParams;
    const limit = Number(q.get('limit')) || 5;
    const page = Number(q.get('page')) || 1;
    return { reviews: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit };
  };
}

const ids = (list: any) => list.children.map((c: any) => c.id);

testAsync('each click appends the next ten, and the button goes once all are shown', async () => {
  const { w, calls, list, more } = loadMoreRig(modern());
  assert.strictEqual(more.info.textContent, 'Showing 5 of 23 reviews');
  assert.strictEqual(more.btn.textContent, 'See more reviews');

  w.loadMore();
  // Waiting: labelled, and aria-disabled so a keyboard user keeps focus on it.
  assert.strictEqual(more.btn.textContent, 'Loading…');
  assert.strictEqual(more.btn.attrs['aria-disabled'], 'true');
  assert.strictEqual(list.attrs['aria-busy'], 'true');
  w.loadMore(); // a second click while waiting asks for nothing
  await flush();
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0], /[?&]offset=5&limit=10(&|$)/);
  assert.strictEqual(w.shown, 15);
  assert.strictEqual(more.info.textContent, 'Showing 15 of 23 reviews');
  assert.strictEqual(more.btn.hidden, false);
  assert.strictEqual(more.btn.attrs['aria-disabled'], undefined);
  assert.strictEqual(list.attrs['aria-busy'], undefined);

  w.loadMore();
  await flush();
  assert.match(calls[1], /[?&]offset=15&limit=10(&|$)/);
  assert.deepStrictEqual(ids(list), ALL.map((r) => r.id));
  assert.strictEqual(more.info.textContent, 'Showing 23 of 23 reviews');
  assert.strictEqual(more.btn.hidden, true);
});

testAsync('a review published between clicks is not drawn twice', async () => {
  // A new review lands at the top after the first page was drawn: every row moves down one,
  // so offset 5 now starts with the review that was fifth.
  const shifted = [{ id: 'new', rating: 5, body: 'x' }, ...ALL];
  const { w, list } = loadMoreRig(modern(shifted));
  w.loadMore();
  await flush();
  const shown = ids(list);
  assert.strictEqual(new Set(shown).size, shown.length, 'a review appeared twice');
  assert.deepStrictEqual(shown.slice(5), ALL.slice(5, 14).map((r) => r.id));
  assert.strictEqual(w.shown, 14);
});

testAsync('a server that ignores offset is detected, and paged instead', async () => {
  const { w, calls, list } = loadMoreRig(legacy());
  w.loadMore();
  await flush();
  // First the offset request, answered with page 1 and no `offset`; then page 2.
  assert.strictEqual(calls.length, 2);
  assert.match(calls[0], /offset=5/);
  assert.match(calls[1], /[?&]page=2&limit=5(&|$)/);
  assert.strictEqual(w.legacyPaging, true);
  assert.deepStrictEqual(ids(list), ALL.slice(0, 10).map((r) => r.id));

  w.loadMore();
  await flush();
  assert.strictEqual(calls.length, 3, 'once known, it asks by page straight away');
  assert.match(calls[2], /[?&]page=3&limit=5(&|$)/);
  assert.deepStrictEqual(ids(list), ALL.slice(0, 15).map((r) => r.id));
});

testAsync('a failed request says so, and the button works again', async () => {
  let fail = true;
  const server = modern();
  const { w, more, list } = loadMoreRig((url) => (fail ? new Error('HTTP 500') : server(url)));
  w.loadMore();
  await flush();
  assert.strictEqual(more.note.hidden, false);
  assert.strictEqual(more.note.textContent, 'Could not load more reviews. Please try again.');
  assert.strictEqual(more.btn.hidden, false);
  assert.strictEqual(more.btn.attrs['aria-disabled'], undefined);
  assert.strictEqual(w.moreBusy, false);
  assert.strictEqual(list.attrs['aria-busy'], undefined);

  fail = false;
  w.loadMore();
  await flush();
  assert.strictEqual(more.note.hidden, true);
  assert.strictEqual(w.shown, 15);
});

testAsync('an answer for a list that has since been re-sorted is dropped', async () => {
  const { w, list } = loadMoreRig(modern());
  w.loadMore();
  w.gen++; // the shopper changed the sort; load() and render() bump this
  await flush();
  assert.strictEqual(list.children.length, 5);
});

testAsync('fewer rows than asked for ends it, whatever the total said', async () => {
  // The total was 23 when the page was drawn; reviews were unpublished since.
  const { w, more } = loadMoreRig(modern(ALL.slice(0, 9)));
  w.total = 23;
  w.loadMore();
  await flush();
  assert.strictEqual(w.shown, 9);
  assert.strictEqual(more.btn.hidden, true);
});

testAsync('with the button gone, keyboard focus moves to the first new review', async () => {
  const { w, focused } = loadMoreRig(modern(ALL.slice(0, 12)), { focused: true });
  w.total = 12;
  w.loadMore();
  await flush();
  assert.deepStrictEqual(focused, [{ id: 'r6' }]);
});

console.log('\nJumping to the reviews');

function revealRig(state: Record<string, unknown>) {
  const timers: Array<() => void> = [];
  const { reveal } = widget({
    methods: ['Widget.prototype.reveal'],
    scope: { setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; }, window: { pageYOffset: 120 } },
  });
  const log: string[] = [];
  const w: any = {
    loadNow: () => log.push('load'),
    land: () => log.push('land'),
    reveal,
    ...state,
  };
  return { w, log, timers };
}

test('a jump fetches now, scrolls an inline list, and opens an overlay instead of scrolling', () => {
  const inline = revealRig({ configured: true });
  inline.w.reveal();
  assert.deepStrictEqual(inline.log, ['load', 'land']);

  const overlay = revealRig({ configured: true, setOpen: (open: boolean) => overlay.log.push(`open:${open}`) });
  overlay.w.reveal();
  assert.deepStrictEqual(overlay.log, ['load', 'open:true']);
});

test('before the layout is known it waits, then lands, and a later click is not swallowed', () => {
  const { w, log, timers } = revealRig({ configured: false });
  w.reveal();
  assert.deepStrictEqual(log, ['load'], 'nothing moves until the config says inline or overlay');
  assert.strictEqual(w.revealPending, true);
  w.reveal();
  assert.strictEqual(timers.length, 1, 'a second click does not start a second wait');
  timers[0]();
  assert.deepStrictEqual(log, ['load', 'load', 'land']);
  assert.strictEqual(w.revealFrom, 120, 'where to put the page back if it turns out to be an overlay');
  // The fetch failed, so no config will ever clear the wait: the next click still lands.
  w.reveal();
  assert.deepStrictEqual(log, ['load', 'load', 'land', 'load', 'land']);
});

console.log('\nThe highlights box');

test('highlights come once each, with text, up to the limit', () => {
  const { highlightsFrom } = widget({ fns: ['highlightsFrom', 'freshReviews', 'plainText'] });
  const long = 'A genuinely useful review with plenty to say about it.';
  const data = {
    highlights: [
      { id: 'a', rating: 5, body: long },
      { id: 'a', rating: 5, body: long },
      { id: 'b', rating: 4, body: '   ', title: '' },
      { id: 'c', rating: 5, body: '', title: 'Title only' },
      { id: 'd', rating: 5, body: long },
    ],
    total: 4,
  };
  assert.deepStrictEqual(highlightsFrom(data, 6).map((r: any) => r.id), ['a', 'c', 'd']);
  assert.deepStrictEqual(highlightsFrom(data, 2).map((r: any) => r.id), ['a', 'c']);
  assert.deepStrictEqual(highlightsFrom({ highlights: [] }, 6), []);
  assert.deepStrictEqual(highlightsFrom(null, 6), []);
});

test('from a server without highlights=1, its good reviews stand in', () => {
  const { highlightsFrom } = widget({ fns: ['highlightsFrom', 'freshReviews', 'plainText'] });
  const long = 'x'.repeat(40);
  const data = {
    reviews: [
      { id: '1', rating: 5, body: long },
      { id: '2', rating: 3, body: long },
      { id: '3', rating: 4, body: 'too short' },
      { id: '4', rating: 4, body: long },
    ],
    total: 4,
  };
  assert.deepStrictEqual(highlightsFrom(data, 6).map((r: any) => r.id), ['1', '4']);
});

test('review text is put on one line for the clamp', () => {
  const { plainText } = widget({ fns: ['plainText'] });
  assert.strictEqual(plainText('  Loved it.\n\n\tWould   buy again. '), 'Loved it. Would buy again.');
  assert.strictEqual(plainText(null), '');
  assert.strictEqual(plainText(undefined), '');
});

test('the avatar letter is the first real character, whole', () => {
  const { initial } = widget({ fns: ['initial', 'plainText'] });
  assert.strictEqual(initial('kanishka R.'), 'K');
  assert.strictEqual(initial('  "Priya"'), 'P');
  assert.strictEqual(initial('@arjun'), 'A');
  assert.strictEqual(initial('किरण'), 'क'); // Devanagari
  // An emoji is a surrogate pair; half of one renders as a broken glyph.
  assert.strictEqual(initial('😀 Happy'), '😀');
  assert.strictEqual(initial(''), '?');
  assert.strictEqual(initial(null), '?');
});

test('the carousel wraps both ways', () => {
  const { wrapIndex } = widget({ fns: ['wrapIndex'] });
  assert.strictEqual(wrapIndex(6, 6), 0);
  assert.strictEqual(wrapIndex(-1, 6), 5);
  assert.strictEqual(wrapIndex(13, 6), 1);
  assert.strictEqual(wrapIndex(3, 0), 0);
});

test('random order is a permutation, and differs between shoppers', () => {
  const { shuffle } = widget({ fns: ['shuffle'] });
  const base = [1, 2, 3, 4, 5, 6];
  const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };
  const a = shuffle(base.slice(), seq([0.1, 0.7, 0.3, 0.9, 0.5]));
  assert.deepStrictEqual(a.slice().sort(), base);
  const b = shuffle(base.slice(), seq([0.9, 0.2, 0.8, 0.1, 0.6]));
  assert.notDeepStrictEqual(a, b);
  assert.deepStrictEqual(shuffle([], Math.random), []);
});

test('a number from a data attribute is held to its range', () => {
  const { clampInt } = widget({ fns: ['clampInt'] });
  assert.strictEqual(clampInt('6', 1, 12, 6), 6);
  assert.strictEqual(clampInt('40', 1, 12, 6), 12);
  assert.strictEqual(clampInt('-3', 0, 60, 6), 0);
  assert.strictEqual(clampInt('', 0, 60, 6), 6);
  assert.strictEqual(clampInt(undefined, 0, 60, 6), 6);
});

/** Just enough DOM for el(), stars() and the slide builder. */
function fakeDocument() {
  const make = (tag: string): any => {
    const node: any = {
      tagName: tag, className: '', title: '', children: [] as any[], attrs: {} as Record<string, string>,
      appendChild(c: any) { this.children.push(c); return c; },
      setAttribute(k: string, v: string) { this.attrs[k] = String(v); },
      getAttribute(k: string) { return k in this.attrs ? this.attrs[k] : null; },
    };
    let text = '';
    Object.defineProperty(node, 'textContent', {
      get() { return node.children.length ? node.children.map((c: any) => c.textContent).join('') : text; },
      set(v: string) { text = v; node.children = []; },
    });
    return node;
  };
  return { createElement: make, createTextNode: (s: string) => ({ textContent: s, children: [] }) };
}

function find(node: any, cls: string): any[] {
  const out: any[] = [];
  const walk = (n: any) => {
    if (typeof n.className === 'string' && n.className.split(' ').includes(cls)) out.push(n);
    (n.children || []).forEach(walk);
  };
  walk(node);
  return out;
}

function slideRig(flags: Partial<{ showBadge: boolean; showAvatar: boolean; showStars: boolean }> = {}) {
  const m = widget({
    fns: ['el', 'stars', 'initial', 'plainText', 't'],
    vars: ['FALLBACK'],
    methods: ['Highlights.prototype.slide'],
    scope: { document: fakeDocument(), CONFIG: null, LOCALE: {} },
  });
  return { showBadge: true, showAvatar: true, showStars: true, ...flags, slide: m.slide };
}

test('the Verified pill is for verified_buyer only, whatever else says verified', () => {
  const h = slideRig();
  const pill = (r: any) => find(h.slide(r, 0, 3), 'rm-hl__pill');
  assert.strictEqual(pill({ author: 'A', rating: 5, body: 'b', verificationStatus: 'verified_buyer' }).length, 1);
  assert.strictEqual(pill({ author: 'A', rating: 5, body: 'b', verificationStatus: 'verified_buyer' })[0].textContent, '✓Verified');
  // The legacy boolean, an unmatched order, an import's own claim: none of them earn it.
  for (const status of ['unverified', 'email_matched', 'imported', null, undefined]) {
    assert.strictEqual(pill({ author: 'A', rating: 5, body: 'b', verified: true, verificationStatus: status }).length, 0, String(status));
  }
  // And the merchant can leave it off.
  const off = slideRig({ showBadge: false });
  assert.strictEqual(find(off.slide({ author: 'A', rating: 5, body: 'b', verificationStatus: 'verified_buyer' }, 0, 3), 'rm-hl__pill').length, 0);
});

test('an incentivised review carries its disclosure in the box, with no way to turn it off', () => {
  for (const flags of [{}, { showBadge: false, showStars: false, showAvatar: false }]) {
    const h = slideRig(flags);
    const s = h.slide({ author: 'A', rating: 5, body: 'b', incentivized: true }, 0, 3);
    const badge = find(s, 'rm-badge--incentive');
    assert.strictEqual(badge.length, 1);
    assert.strictEqual(badge[0].textContent, 'Incentivised');
    assert.match(badge[0].title, /discount/);
  }
  const plain = slideRig().slide({ author: 'A', rating: 5, body: 'b', incentivized: false }, 0, 3);
  assert.strictEqual(find(plain, 'rm-badge--incentive').length, 0);
});

test('each slide is labelled for screen readers, and a lone review is not a carousel', () => {
  const h = slideRig();
  const s = h.slide({ author: 'Kanishka', rating: 4, body: 'Lovely idol' }, 1, 6);
  assert.strictEqual(s.attrs.role, 'group');
  assert.strictEqual(s.attrs['aria-roledescription'], 'slide');
  assert.strictEqual(s.attrs['aria-label'], '2 of 6');
  assert.strictEqual(find(s, 'rm-hl__avatar')[0].textContent, 'K');
  assert.strictEqual(find(s, 'rm-hl__avatar')[0].attrs['aria-hidden'], 'true');
  assert.strictEqual(find(s, 'rm-stars__icons')[0].attrs['aria-label'], '4 out of 5 stars');
  const alone = h.slide({ author: 'K', rating: 4, body: 'x' }, 0, 1);
  assert.strictEqual(alone.attrs.role, undefined);
});

function cycleRig(state: Record<string, unknown>, reduced = false) {
  let timers = 0;
  const m = widget({
    methods: ['Highlights.prototype.cycle', 'Highlights.prototype.halt'],
    scope: {
      reducedMotion: () => reduced,
      setInterval: () => ++timers,
      clearInterval: () => {},
      document: { documentElement: { contains: () => true } },
    },
  });
  const track = fakeNode();
  const h: any = {
    rotate: 6, slides: [1, 2, 3], stopped: false, hover: false, focused: false, timer: null,
    root: { classList: { contains: () => false } }, track, cycle: m.cycle, halt: m.halt, ...state,
  };
  h.cycle();
  return h;
}

test('it rotates only when nobody is reading, and says so to screen readers', () => {
  const running = cycleRig({});
  assert.ok(running.timer, 'should rotate');
  assert.strictEqual(running.track.attrs['aria-live'], 'off');

  for (const [why, state] of Object.entries({
    hovered: { hover: true },
    focused: { focused: true },
    stopped: { stopped: true },
    'rotation off': { rotate: 0 },
    'one review': { slides: [1] },
  })) {
    const h = cycleRig(state);
    assert.strictEqual(h.timer, null, why);
    assert.strictEqual(h.track.attrs['aria-live'], 'polite', why);
  }
  const reduced = cycleRig({}, true);
  assert.strictEqual(reduced.timer, null, 'prefers-reduced-motion');

  // Pointer leaves: it picks up again.
  running.hover = true;
  running.cycle();
  assert.strictEqual(running.timer, null);
  running.hover = false;
  running.cycle();
  assert.ok(running.timer);
});

console.log('\nWords: config, then the theme locale, then the built-in English');

test('t() prefers the merchant, then the locale, then the fallback', () => {
  const make = (CONFIG: unknown, LOCALE: Record<string, string>) =>
    widget({ fns: ['t'], vars: ['FALLBACK'], scope: { CONFIG, LOCALE } }).t;
  assert.strictEqual(make(null, {})('seeMore'), 'See more reviews');
  assert.strictEqual(make(null, { seeMore: 'Voir plus' })('seeMore'), 'Voir plus');
  assert.strictEqual(make({ text: { seeMore: 'More please' } }, { seeMore: 'Voir plus' })('seeMore'), 'More please');
  assert.strictEqual(make(null, {})('showingOf', { shown: 15, total: 23 }), 'Showing 15 of 23 reviews');
});

test('the block hands its words over, and a missing translation is not shown', () => {
  const LOCALE: Record<string, string> = {};
  const { readLocale, camel } = widget({ fns: ['readLocale', 'camel'], scope: { LOCALE } });
  assert.strictEqual(camel('load-more-error'), 'loadMoreError');
  readLocale({
    attributes: [
      { name: 'data-rm-t-see-more', value: "Voir plus d'avis" },
      { name: 'data-rm-t-read-more', value: 'translation missing: fr.reviewmaster.read_more' },
      { name: 'data-rm-t-show-less', value: '' },
      { name: 'data-rm-shop', value: 'x.myshopify.com' },
    ],
  });
  assert.deepStrictEqual(LOCALE, { seeMore: "Voir plus d'avis" });
});

/** The widget's built-in English, as an object. */
const fallbackWords = () => new Function(`${slice('var FALLBACK = ')}; return FALLBACK;`)() as Record<string, string>;

test('every word the widget asks for has an English fallback or a config default', () => {
  const FALLBACK = fallbackWords();
  const known = new Set([...Object.keys(FALLBACK), ...Object.keys(DEFAULT_CONFIG.text)]);
  const asked = new Set<string>();
  for (const call of SRC.matchAll(/\bt\(([^)]*)\)/g)) {
    for (const key of call[1].matchAll(/'([A-Za-z]+)'/g)) asked.add(key[1]);
  }
  assert.ok(asked.has('seeMore') && asked.has('readMore'), 'the scan found no t() calls');
  for (const key of asked) assert.ok(known.has(key), `t('${key}') has no fallback`);
});

test('each data-rm-t-* in a block names a locale key that exists, and a key the widget knows', () => {
  const FALLBACK = fallbackWords();
  const { camel } = widget({ fns: ['camel'] });
  let seen = 0;
  for (const [file, src] of Object.entries(BLOCKS)) {
    for (const m of src.matchAll(/data-rm-t-([a-z-]+)="\{\{ 'reviewmaster\.([a-z_]+)' \| t \| escape_once \}\}"/g)) {
      seen++;
      assert.ok(LOCALE_EN.reviewmaster[m[2]], `${file}: reviewmaster.${m[2]} is not in en.default.json`);
      assert.ok(FALLBACK[camel(m[1])], `${file}: data-rm-t-${m[1]} is not a key the widget reads`);
    }
    // Every data-rm-t-* uses that exact form: anything else would not be found above.
    const all = [...src.matchAll(/data-rm-t-[a-z-]+=/g)].length;
    const good = [...src.matchAll(/data-rm-t-[a-z-]+="\{\{ 'reviewmaster\.[a-z_]+' \| t \| escape_once \}\}"/g)].length;
    assert.strictEqual(all, good, `${file} has a data-rm-t-* attribute in an unexpected form`);
  }
  assert.ok(seen >= 13, `found only ${seen} locale attributes`);
});

test('every translation key a block uses is in en.default.json', () => {
  for (const [file, src] of Object.entries(BLOCKS)) {
    for (const m of src.matchAll(/'reviewmaster\.([a-z_]+)'\s*\|\s*t\b/g)) {
      assert.ok(m[1] in LOCALE_EN.reviewmaster, `${file}: reviewmaster.${m[1]} is missing`);
    }
  }
  // "1 rating", not "1 ratings".
  assert.deepStrictEqual(Object.keys(LOCALE_EN.reviewmaster.rating_count).sort(), ['one', 'other']);
});

console.log('\nThe blocks');

test('every block schema parses, and its selects and ranges are ones Shopify accepts', () => {
  for (const file of Object.keys(BLOCKS)) {
    const s = schema(file);
    assert.ok(s.name && s.name.length <= 25, `${file}: name`);
    const ids = new Set<string>();
    for (const setting of s.settings || []) {
      if (!setting.id) continue;
      assert.ok(!ids.has(setting.id), `${file}: duplicate id ${setting.id}`);
      ids.add(setting.id);
      if (setting.type === 'select') {
        assert.ok(setting.options.some((o: any) => o.value === setting.default), `${file}: ${setting.id} default is not an option`);
      }
      if (setting.type === 'range') {
        const steps = (setting.max - setting.min) / setting.step;
        assert.ok(Number.isInteger(steps) && steps <= 101, `${file}: ${setting.id} has ${steps} steps`);
        assert.ok(setting.default >= setting.min && setting.default <= setting.max, `${file}: ${setting.id} default out of range`);
        assert.ok(Number.isInteger((setting.default - setting.min) / setting.step), `${file}: ${setting.id} default off-step`);
      }
    }
  }
});

test('the star block keeps every setting live placements have saved, with the same defaults', () => {
  const settings = Object.fromEntries(schema('star-rating.liquid').settings.map((s: any) => [s.id, s]));
  const before: Record<string, unknown> = {
    size: 'medium', star_color: '#E8871E', star_shape: 'app', show_value: true,
    show_count: true, count_style: 'parentheses', show_when_empty: false,
  };
  for (const [id, def] of Object.entries(before)) {
    assert.ok(settings[id], `${id} is gone`);
    assert.strictEqual(settings[id].default, def, `${id} default changed`);
  }
  assert.deepStrictEqual(settings.count_style.options.map((o: any) => o.value), ['parentheses', 'words']);
  // New ones default to what every existing placement shows today.
  assert.strictEqual(settings.value_decimals.default, '1');
  assert.strictEqual(settings.count_label.default, 'reviews');
});

test('the review block keeps its settings, and the sticky-header default matches the CSS and script', () => {
  const settings = Object.fromEntries(schema('review-list.liquid').settings.filter((s: any) => s.id).map((s: any) => [s.id, s]));
  for (const id of ['placement', 'accent_color', 'star_color', 'corner_radius', 'reserved_height', 'app_url']) {
    assert.ok(settings[id], `${id} is gone`);
  }
  assert.strictEqual(settings.scroll_offset.default, 80);
  assert.match(BLOCKS['review-list.liquid'], /block\.settings\.scroll_offset != 80/);
  assert.match(CSS, /scroll-margin-top:\s*var\(--rm-scroll-offset,\s*80px\)/);
  assert.match(slice('function scrollOffset('), /isNaN\(v\) \? 80 : v/);
});

test('the count link goes to the product page from anywhere but that product page', () => {
  const star = BLOCKS['star-rating.liquid'];
  assert.match(star, /assign reviews_href = '#reviewmaster-reviews'/);
  assert.match(star, /if request\.page_type != 'product' and product\.url != blank\s+assign reviews_href = product\.url \| append: '#reviewmaster-reviews'/);
  // Both links use it; no bare hash is left behind.
  assert.strictEqual([...star.matchAll(/href="\{\{ reviews_href \}\}"/g)].length, 2);
  assert.doesNotMatch(star, /href="#reviewmaster-reviews"/);
});

test('the highlights block is the one the widget looks for, with the settings the brief asks for', () => {
  const src = BLOCKS['review-highlights.liquid'];
  const s = schema('review-highlights.liquid');
  assert.strictEqual(s.name, 'Review highlights');
  assert.strictEqual(s.target, 'section');
  assert.strictEqual(s.javascript, 'reviewmaster.js');
  const settings = Object.fromEntries(s.settings.filter((x: any) => x.id).map((x: any) => [x.id, x]));
  assert.deepStrictEqual(settings.source.options.map((o: any) => o.value), ['featured', 'random', 'latest']);
  assert.strictEqual(settings.source.default, 'featured');
  assert.match(settings.source.info, /Featured = reviews you mark with Feature in Marka Reviews → All reviews/);
  assert.deepStrictEqual([settings.count.min, settings.count.max, settings.count.default], [3, 12, 6]);
  assert.deepStrictEqual([settings.rotate_seconds.min, settings.rotate_seconds.default], [0, 6]);
  assert.deepStrictEqual([settings.lines.min, settings.lines.max, settings.lines.default], [2, 8, 4]);
  for (const id of ['show_stars', 'show_verified', 'show_avatar']) assert.strictEqual(settings[id].default, true, id);
  for (const id of ['border_color', 'background_color']) {
    assert.strictEqual(settings[id].type, 'color');
    assert.strictEqual(settings[id].default, undefined, `${id} must start blank to follow the app`);
  }
  // Every data attribute the constructor reads is emitted.
  for (const attr of ['data-rm-highlights', 'data-rm-shop', 'data-rm-product', 'data-rm-placement', 'data-rm-app-url',
    'data-rm-source', 'data-rm-limit', 'data-rm-rotate', 'data-rm-show-stars', 'data-rm-show-badge', 'data-rm-show-avatar']) {
    assert.ok(src.includes(attr), `${attr} is not emitted`);
  }
  assert.match(SRC, /querySelectorAll\('\[data-rm-highlights\]'\)/);
});

console.log('\nThe stylesheet and the shipped file');

test('an empty highlights box takes no space, and its colours fall back to the theme', () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.rm-hl\[hidden\][^{]*\{\s*display:\s*none\s*!important/);
  const box = /\.rm-hl \{([^}]*)\}/.exec(css);
  assert.ok(box, 'no .rm-hl rule');
  // Transparent and inherited at the end of each chain: readable on a light or dark theme.
  assert.match(box[1], /background:\s*var\(--rm-hl-bg,\s*var\(--rm-card-bg,\s*var\(--rm-card-bg-auto,\s*transparent\)\)\)/);
  assert.match(box[1], /color:\s*var\(--rm-hl-text,\s*var\(--rm-card-text,\s*var\(--rm-card-text-auto,\s*inherit\)\)\)/);
  // The clamp and the reserved height use the same line count and line height.
  assert.match(css, /min-height:\s*calc\(var\(--rm-hl-lines, 4\) \* 1\.5em\)/);
  assert.match(css, /-webkit-line-clamp:\s*var\(--rm-hl-lines, 4\)/);
});

test('the shipped widget is ES5, parses, and was rebuilt from this source', () => {
  const code = BUILT.replace(/^\/\*[\s\S]*?\*\/\n/, '');
  assert.strictEqual(code.includes('=>'), false, 'arrow function');
  assert.strictEqual(/\bconst\s/.test(code), false, 'const');
  assert.strictEqual(/\blet\s/.test(code), false, 'let');
  assert.strictEqual(code.includes('`'), false, 'template literal');
  assert.strictEqual(/\bclass\s/.test(code), false, 'class');
  assert.strictEqual(/\?\.(?!\d)/.test(code), false, 'optional chaining');
  assert.strictEqual(code.includes('...'), false, 'spread');
  assert.doesNotThrow(() => new Function(code));
  for (const marker of ['loadMoreCount', 'paginationStyle', 'rm-hl__slide', 'data-rm-highlights', 'reviewmaster-reviews']) {
    assert.ok(BUILT.includes(marker), `the built file has no ${marker}: rebuild with node scripts/build-extension.mjs`);
  }
});

void (async () => {
  if (asyncTests.length) console.log('\nSee more against a stand-in server');
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
