/**
 * Marka Reviews storefront widget.
 *
 * Budget: Shopify recommends theme app extension JavaScript stay under 10 KB, and the
 * storefront Lighthouse score is weighted 83% toward product and collection pages — the
 * exact pages this runs on. So: no framework, no dependencies, no polyfills, and nothing
 * fetched until the widget is near the viewport.
 *
 * Everything above the fold (star rating, average, review count) is already rendered
 * server-side from Shopify metafields by the Liquid block. This file only hydrates the
 * parts that genuinely need data: the list, the histogram, the filters and the form.
 */
(function () {
  'use strict';

  var CACHE = {};

  /**
   * Merchant configuration, delivered inside the reviews response.
   *
   * Every visible string used to be hardcoded here. That meant a merchant selling in
   * French, or one whose approval turnaround is a week and wants to say so, had no way to
   * change the copy without us shipping a release. `t()` resolves a key against whatever
   * the merchant configured and falls back to the built-in English, so a config that has
   * never been touched behaves exactly as before.
   */
  var CONFIG = null;

  var FALLBACK = {
    writeReview: 'Write a review', verifiedBadge: 'Verified Purchase',
    incentivisedBadge: 'Incentivised',
    incentivisedTooltip: 'This reviewer received a discount in exchange for an honest review',
    storeResponse: 'Store response', submitting: 'Submitting\u2026',
    thankYou: 'Thank you. Your review has been submitted for approval.',
    errorGeneric: 'Could not submit your review. Please try again.',
    filterWithPhotos: 'With photos', sortRecent: 'Most recent',
    sortHighest: 'Highest rating', sortLowest: 'Lowest rating', sortHelpful: 'Most helpful',
    showingCount: 'Showing {first}\u2013{last} of {total} reviews',
    noMatchFilter: 'No reviews match that filter.',
    noFilesSelected: 'No files selected',
    helpful: 'Helpful', helpfulThanks: 'Thanks for the feedback',
    seeAll: 'See all reviews', close: 'Close',
    // Q&A. Separate from the review strings above because a merchant editing their
    // storefront copy in Settings should be able to word the two independently — "Ask a
    // question" and "Write a review" are different invitations.
    askQuestion: 'Ask a question',
    noQuestions: 'No questions yet. Ask the first one.',
    storeAnswer: 'Store',
    questionThanks: 'Thanks \u2014 your question has been sent to the shop.',
    questionsHeading: 'Questions & answers',
    // Shown instead of noQuestions when the store cannot accept questions, so an empty
    // list never invites something the server will refuse.
    noQuestionsPlain: 'No questions yet.',
    questionInvalid: 'Please add your name and a question.',
    questionError: 'Could not send your question. Please try again.',
    // "See more", the highlights box and its carousel. The blocks also hand the widget
    // these words from the theme's locale file (see readLocale), so a translated storefront
    // shows its own; these are the last resort, for a block saved before that existed.
    seeMore: 'See more reviews',
    loadingMore: 'Loading…',
    loadMoreError: 'Could not load more reviews. Please try again.',
    showingOf: 'Showing {shown} of {total} reviews',
    readMore: 'Read more',
    showLess: 'Show less',
    verifiedShort: 'Verified',
    aboutProduct: 'on {product}',
    highlightsEmpty: 'Nothing to show here yet. This box shows 4 and 5 star reviews with a few lines of text, and with Featured, reviews you mark with Feature in Marka Reviews → All reviews.',
    highlightsLabel: 'Customer reviews',
    previousReview: 'Previous review',
    nextReview: 'Next review',
    slideLabel: '{index} of {total}',
    pauseRotation: 'Stop rotating reviews',
    playRotation: 'Start rotating reviews'
  };

  /** Layouts that live in an overlay rather than inline in the page flow. */
  var OVERLAY = { floating: 1, popup: 1, sidebar: 1 };

  /** Layouts that show only the summary \u2014 no list, no pagination, no form. */
  var SUMMARY_ONLY = { badge: 1 };

  /**
   * Words from the theme's locale file, handed over by the blocks as data-rm-t-* attributes.
   *
   * The merchant's configured copy covers what Settings lets them edit; the words that are
   * new with "See more" and the highlights box have no setting, and hardcoding them here
   * would put English on every translated storefront. Liquid's `t` filter knows the
   * shopper's language and this file does not, so the block resolves them and the widget
   * reads them back. getAttribute undoes the HTML escaping `t` applies, so an apostrophe
   * in a translation arrives as an apostrophe.
   */
  var LOCALE = {};

  /** "see-more" -> "seeMore": attribute suffix to the key t() is asked for. */
  function camel(s) {
    return String(s).replace(/-([a-z0-9])/g, function (m, c) { return c.toUpperCase(); });
  }

  function readLocale(root) {
    var attrs = root.attributes;
    for (var i = 0; i < attrs.length; i++) {
      var a = attrs[i];
      // A key missing from a locale renders as "translation missing: ..." rather than
      // nothing, and that is not a thing to put on a shopper's screen.
      if (a.name.indexOf('data-rm-t-') !== 0 || !a.value || /^translation missing/i.test(a.value)) continue;
      LOCALE[camel(a.name.slice(10))] = a.value;
    }
  }

  function t(key, vars) {
    var text = (CONFIG && CONFIG.text && CONFIG.text[key]) || LOCALE[key] || FALLBACK[key] || '';
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        text = text.split('{' + k + '}').join(vars[k]);
      });
    }
    return text;
  }

  function behaviour(key, fallback) {
    if (CONFIG && CONFIG.behaviour && CONFIG.behaviour[key] !== undefined) {
      return CONFIG.behaviour[key];
    }
    return fallback;
  }

  /** A whole number from a data attribute or a config value, held to [min, max]. */
  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  // 3, 4, 6 or 8 digits: the lengths CSS accepts. A 5- or 7-digit typo passed before, and
  // CSS then dropped the colour at computed-value time with nothing to say why.
  function isHex(v) {
    return typeof v === 'string' && /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);
  }

  /** WCAG relative luminance of a #rgb, #rgba, #rrggbb or #rrggbbaa colour; null otherwise. */
  function luminance(hex) {
    var h = hex.slice(1);
    if (h.length === 3 || h.length === 4) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    } else if (h.length === 8) {
      h = h.slice(0, 6);
    }
    if (h.length !== 6) return null;
    var w = [0.2126, 0.7152, 0.0722];
    var sum = 0;
    for (var i = 0; i < 3; i++) {
      var c = parseInt(h.substr(i * 2, 2), 16) / 255;
      sum += w[i] * (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    }
    return sum;
  }

  /**
   * The text colour for a card background with card text left to follow the theme:
   * near-black or white, whichever contrasts more. pairCardText in
   * src/lib/storefront-config.ts makes the same choice, and a server that has it already
   * sends the pair; this copy is for a server that does not.
   *
   * The stylesheet gives the card layouts and the overlay panel a white fallback surface
   * with #1f2937 fallback text. That pairing is only right while no background is
   * published: a merchant's dark card with its text left unset met the dark fallback text
   * and the review could not be read. That is what this widget would show if it shipped
   * ahead of the server. Publishing the two together, on the widget root and on the
   * document root alike, means the fallback text only ever meets the fallback surface,
   * whatever the deploy order and whichever element a block inherits them from.
   */
  function pairedText(bg) {
    var l = luminance(bg);
    if (l === null) return null;
    var dark = luminance('#1f2937');
    var onDark = (Math.max(l, dark) + 0.05) / (Math.min(l, dark) + 0.05);
    var onLight = 1.05 / (l + 0.05);
    return onDark >= onLight ? '#1f2937' : '#ffffff';
  }

  /**
   * The mirror of pairedText: a card surface for a text colour chosen on its own. A text
   * that pairedText would put dark text on is itself light, so it wants the dark surface.
   */
  function pairedBackground(text) {
    var t = pairedText(text);
    if (t === null) return null;
    return t === '#1f2937' ? '#111827' : '#ffffff';
  }

  /**
   * Apply merchant colours as CSS custom properties on the widget root.
   *
   * Only ever hex, validated server-side before it is stored — this value lands in a style
   * attribute, so an unvalidated string here would be CSS injection on the storefront.
   * Theme-editor settings still win where the merchant set one, since tweaking colours
   * against a live preview is the better experience; these are the account-wide default.
   */
  function applyColors(root, colors) {
    if (!colors) return;
    var map = {
      accent: '--rm-accent', star: '--rm-star-color',
      verifiedBg: '--rm-verified-bg', verifiedText: '--rm-verified-text',
      cardBg: '--rm-card-bg', cardText: '--rm-card-text', border: '--rm-border'
    };
    // What the merchant chose goes on the plain variables; what is DERIVED to match goes on
    // the -auto ones. The stylesheet needs to tell them apart: Minimal paints no card, so it
    // honours a chosen text colour but must ignore one derived for a background it never
    // draws. And a text colour chosen on its own gets a surface it can be read on, rather
    // than white text on the white fallback card.
    //
    // --rm-card-text-bare is a chosen text with NO chosen card: the only text Minimal, which
    // paints no card, may use. A text chosen for a card the merchant also chose was picked
    // against that card, and on Minimal's bare page it can vanish (white on white).
    var bg = isHex(colors.cardBg);
    var text = isHex(colors.cardText);
    var vars = {};
    Object.keys(map).forEach(function (k) { vars[map[k]] = colors[k]; });
    if (bg && !text) vars['--rm-card-text-auto'] = pairedText(colors.cardBg);
    if (text && !bg) {
      vars['--rm-card-bg-auto'] = pairedBackground(colors.cardText);
      vars['--rm-card-text-bare'] = colors.cardText;
    }
    Object.keys(vars).forEach(function (name) {
      var v = vars[name];
      if (!isHex(v)) return;

      if (!root.style.getPropertyValue(name)) root.style.setProperty(name, v);

      // The page-wide colours also go on the document root, so blocks that never fetch
      // anything pick them up by inheritance: the standalone star-rating block is pure
      // Liquid with no network call, and could otherwise never honour a colour set in the
      // app. An inline value on that block still wins locally.
      //
      // Card colours do NOT. Nothing outside a widget draws a card, and published on the
      // root they leaked between widgets — first writer wins — so a Minimal list inherited
      // the white text paired for the floating widget's dark panel, on a white page.
      if (name.indexOf('--rm-card-') === 0) return;
      if (!document.documentElement.style.getPropertyValue(name)) {
        document.documentElement.style.setProperty(name, v);
      }
    });
  }

  /**
   * Star shape, the verified badge's icon and the font, from Settings -> Display. Published
   * on the document root like the colours, so a Liquid-only star block on the same page
   * matches; a star block that picked its own shape in the theme editor keeps it, since the
   * stylesheet resolves the nearest choice. Only known values are written: the font becomes
   * a custom property, so it is held to the same pattern the server enforces.
   */
  function applyMarks(L) {
    var d = document.documentElement;
    if (L.starStyle === 'tick' || L.starStyle === 'classic') d.setAttribute('data-rm-stars', L.starStyle);
    if (L.badgeIcon === 'tick' || L.badgeIcon === 'none') d.setAttribute('data-rm-badge-icon', L.badgeIcon);
    if (typeof L.fontFamily === 'string' && /^[A-Za-z][A-Za-z0-9 ,-]{0,79}$/.test(L.fontFamily)) {
      d.style.setProperty('--rm-font', L.fontFamily);
    }
  }

  /**
   * Merchant CSS, injected once per page rather than once per widget.
   *
   * Sanitised server-side (angle brackets, @import, expression(), javascript:, and
   * non-https url() are all stripped) before it is ever stored, so this only has to worry
   * about not injecting it twice — a product page with a star badge and a review list would
   * otherwise carry two identical style blocks.
   */
  var cssInjected = false;
  function applyCustomCss(css) {
    if (cssInjected || !css) return;
    cssInjected = true;
    var style = document.createElement('style');
    style.setAttribute('data-rm-custom', '1');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /**
   * Escape before inserting into innerHTML.
   *
   * Review bodies are attacker-controlled text. Any path that builds markup from them
   * without escaping is stored XSS on the merchant's storefront, running in the shopper's
   * session. Where practical this file uses textContent instead, which cannot be escaped
   * wrong; this helper covers the cases where markup is genuinely needed.
   */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stars(rating, cls) {
    var wrap = el('span', 'rm-stars__icons ' + (cls || ''));
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', rating + ' out of 5 stars');
    for (var i = 1; i <= 5; i++) {
      var s = el('span', 'rm-star rm-star--' + (i <= rating ? 'full' : 'empty'), '★');
      s.setAttribute('aria-hidden', 'true');
      wrap.appendChild(s);
    }
    return wrap;
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch (e) { return ''; }
  }

  /** GET a storefront read through the same per-query cache the review list uses. */
  function getJson(url) {
    if (CACHE[url]) return Promise.resolve(CACHE[url]);
    return fetch(url, { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        CACHE[url] = data;
        return data;
      });
  }

  /**
   * The reviews in `incoming` not already in `seen`, recording them there.
   *
   * "See more" asks for the rows after the ones on screen by position, and positions move:
   * a review published between two clicks pushes every row down one, so the next answer
   * starts with the last review already shown. Drawing it twice looks like a bug to a
   * shopper, and on a server that ignores the offset it would be the whole first page again.
   */
  function freshReviews(seen, incoming) {
    var out = [];
    (incoming || []).forEach(function (r) {
      if (!r || r.id == null || seen[r.id]) return;
      seen[r.id] = 1;
      out.push(r);
    });
    return out;
  }

  /**
   * What the next "See more" click asks for. By offset normally: the number on screen, and
   * the merchant's load-more count. A server from before offset only understands pages, so
   * from one of those it is the next page at the first page's size, counted separately from
   * what is on screen because dedupe can leave that short of a whole number of pages.
   */
  function nextChunk(shown, page, perPage, step, legacy) {
    if (legacy) return { page: page + 1, limit: perPage || step };
    return { offset: shown, limit: step };
  }

  /** Review text on one line: the highlights box clamps lines, and blank lines waste them. */
  function plainText(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }

  /**
   * The letter in a reviewer's avatar. Two code units when the first is half of a surrogate
   * pair, or an emoji or a rarer script would render as a broken glyph.
   */
  function initial(name) {
    var s = plainText(name).replace(/^["'(\[@#_.\-]+/, '');
    if (!s) return '?';
    var code = s.charCodeAt(0);
    var c = code >= 0xD800 && code <= 0xDBFF && s.length > 1 ? s.slice(0, 2) : s.charAt(0);
    return c.toUpperCase();
  }

  /**
   * Fisher-Yates, in place. The server picks the random sample, but its answer is cached at
   * the edge for five minutes, so without this every shopper in that window would see the
   * "random" reviews in the same order.
   */
  function shuffle(list, rnd) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  /** Index i in a ring of n: one before the first is the last, one after the last the first. */
  function wrapIndex(i, n) {
    return n ? ((i % n) + n) % n : 0;
  }

  /**
   * The reviews to show in the highlights box, each once and each with something to read.
   *
   * A server from before highlights=1 ignores it and answers with an ordinary first page.
   * Its 4 and 5 star reviews with a real body stand in until the server is updated, the
   * same rule the server applies, so the block is not empty in the meantime.
   */
  function highlightsFrom(data, limit) {
    if (!data) return [];
    var list = data.highlights;
    if (!Array.isArray(list)) {
      list = (data.reviews || []).filter(function (r) {
        return r && r.rating >= 4 && plainText(r.body).length >= 40;
      });
    }
    return freshReviews(Object.create(null), list).filter(function (r) {
      return !!plainText(r.body || r.title);
    }).slice(0, limit);
  }

  // ── Jumping to the reviews ──────────────────────────────────────────────────────────
  //
  // The review count under the product title, the highlights box's "Read more", and the
  // review URLs in the Google Shopping feed all point at #reviewmaster-reviews. Left to
  // the browser that jump lands under a sticky header, lands on an empty reserved box when
  // the list has not been fetched yet, and does nothing at all when the widget is a
  // floating or popup panel, whose content is out of the page flow.

  var JUMP = 'reviewmaster-reviews';

  function reducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  }

  /**
   * How far below the top of the window a jump stops, so a sticky header does not cover the
   * heading. The review block's "Space for a sticky header" arrives as --rm-scroll-offset in
   * px; the stylesheet also uses it as scroll-margin-top, so the browser's own jump to the
   * anchor (no script, or a link from another page) stops in the same place.
   */
  function scrollOffset(node) {
    var v = NaN;
    try { v = parseFloat(window.getComputedStyle(node).getPropertyValue('--rm-scroll-offset')); } catch (e) {}
    return isNaN(v) ? 80 : v;
  }

  function scrollToNode(node) {
    var top = Math.max(0, node.getBoundingClientRect().top + window.pageYOffset - scrollOffset(node));
    try {
      // 'instant', not 'auto': auto follows the page's CSS, and plenty of themes set
      // html { scroll-behavior: smooth }, which would scroll a reduced-motion visitor anyway.
      window.scrollTo({ top: top, behavior: reducedMotion() ? 'instant' : 'smooth' });
    } catch (e) {
      window.scrollTo(0, top);
    }
  }

  /**
   * Move focus without scrolling a second time. A keyboard or screen-reader user who
   * followed a link to the reviews should continue from the reviews, not from the link they
   * left. tabindex -1 makes the target focusable without adding it to the Tab order.
   */
  function focusQuietly(node, fallback) {
    var target = node && node.getClientRects().length ? node : fallback;
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
  }

  /**
   * Full-size media viewer.
   *
   * One lightbox element reused for every review on the page, rather than one per review.
   * Closes on Escape, on backdrop click, and restores focus to whatever opened it — a
   * modal that traps keyboard users is an accessibility failure, and this is shopper-facing
   * on a merchant's storefront.
   */
  var lightbox = null;
  var lastFocus = null;

  function closeLightbox() {
    if (!lightbox) return;
    lightbox.remove();
    lightbox = null;
    document.removeEventListener('keydown', onLightboxKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onLightboxKey(e) {
    if (e.key === 'Escape') closeLightbox();
  }

  function openLightbox(src, kind) {
    closeLightbox();
    lastFocus = document.activeElement;

    lightbox = el('div', 'rm-lightbox');
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', kind === 'video' ? 'Video review' : 'Review photo');

    var close = el('button', 'rm-lightbox__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closeLightbox);

    var inner;
    if (kind === 'video') {
      inner = document.createElement('video');
      inner.src = src;
      inner.controls = true;
      inner.autoplay = true;
      inner.playsInline = true;
      inner.className = 'rm-lightbox__media';
    } else {
      inner = el('img');
      inner.src = src;
      inner.alt = 'Customer photo, full size';
      inner.className = 'rm-lightbox__media';
    }

    lightbox.appendChild(close);
    lightbox.appendChild(inner);
    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox) closeLightbox();
    });

    document.body.appendChild(lightbox);
    document.addEventListener('keydown', onLightboxKey);
    close.focus();
  }

  function Widget(root) {
    this.root = root;
    this.shop = root.dataset.rmShop;
    this.productId = root.dataset.rmProduct;
    this.appUrl = (root.dataset.rmAppUrl || '').replace(/\/$/, '');
    // Theme setting first; the app-level default covers blocks saved before the setting
    // existed, which is why an old block kept showing 10 per page.
    // Both start unset and are filled in from the server's response. Page size and sort
    // order are the app's to decide — they used to be theme-block settings as well, which
    // meant the widget always sent limit= and sort= and the app's own values could never
    // apply. There is now one place each of these is configured.
    this.perPage = 0;
    this.sort = '';
    // Which of the merchant's widgets applies here. The server resolves this against the
    // Widgets page; if they never built one, it falls through to the default list layout.
    this.placement = root.dataset.rmPlacement || '';
    this.layout = 'list';
    this.page = 1;
    this.rating = null;
    this.mediaOnly = false;
    this.listEl = root.querySelector('[data-rm-list]');
    this.histEl = root.querySelector('[data-rm-histogram]');
    this.filtersEl = root.querySelector('[data-rm-filters]');
    this.pagEl = root.querySelector('[data-rm-pagination]');
    // Set once a reply shows the server ignores `offset`, and kept: that is a property of
    // the server, not of the list on screen.
    this.legacyPaging = false;
    this.resetMore();
    readLocale(root);
    this.bindForm();
  }

  /**
   * The reviews query. Given a chunk from nextChunk it asks for the rows after the ones on
   * screen, by offset or, from a server that predates offset, by page. Without one it is the
   * same first-page query as always, parameter for parameter, so the edge cache keeps hitting.
   */
  Widget.prototype.url = function (chunk) {
    var p = ['shop=' + encodeURIComponent(this.shop)];
    if (chunk && chunk.offset !== undefined) {
      p.push('offset=' + chunk.offset, 'limit=' + chunk.limit);
    } else {
      p.push('page=' + (chunk ? chunk.page : this.page));
      var limit = chunk ? chunk.limit : this.perPage;
      if (limit) p.push('limit=' + limit);
    }
    if (this.sort) p.push('sort=' + encodeURIComponent(this.sort));
    if (this.productId) p.push('product_id=' + encodeURIComponent(this.productId));
    if (this.placement) p.push('placement=' + encodeURIComponent(this.placement));
    if (this.rating) p.push('rating=' + this.rating);
    if (this.mediaOnly) p.push('media=1');
    return this.appUrl + '/api/storefront/reviews?' + p.join('&');
  };

  Widget.prototype.load = function () {
    var self = this;
    var url = this.url();
    // A new list is on its way. A "See more" answer still in flight belongs to the old one.
    this.gen++;

    this.showSkeletons();

    // Cache per query. Shoppers flip between filters and pages repeatedly; re-fetching an
    // identical query is latency the shopper feels for no new information.
    //
    // applyConfig runs on the cache path too. It used to live only inside the fetch
    // callback, which meant a widget that got its data from the cache rendered with the
    // default list layout and none of the merchant's colours — because the layout is
    // per-instance state and nothing had set it. That is not a theoretical case: a theme
    // that re-renders a section (variant change, theme editor edit) builds a new Widget
    // over the same URL, and it would come back styled differently from the one it
    // replaced.
    if (CACHE[url]) {
      this.applyConfig(CACHE[url]);
      this.render(CACHE[url]);
      return;
    }

    fetch(url, { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        CACHE[url] = data;
        self.applyConfig(data);
        self.render(data);
      })
      .catch(function () {
        // Fail quietly. A broken review widget must never break the product page, and a
        // shopper cannot act on a fetch error. The server-rendered star rating from the
        // metafields is still visible above.
        //
        // listEl is null for the badge layout, which removes the list entirely — so this
        // has to be guarded, or the error handler throws its own error.
        if (self.listEl) self.listEl.innerHTML = '';
        // The old list's "See more" footer goes with it. Left in place it still said
        // "Showing 15 of 37", and a click added rows of the NEW sort to an empty list; a
        // request in flight when the reload began left the button stuck on "Loading…".
        self.resetMore();
        if (self.pagEl) {
          self.pagEl.innerHTML = '';
          self.pagEl.hidden = true;
        }
      });
  };

  /**
   * Apply the merchant's configuration to this widget instance.
   *
   * Split out of the fetch callback so the cached path gets it too. Everything here is
   * idempotent — classList.add deduplicates, buildOverlay returns early if the panel
   * already exists, and applyColors only fills properties that are not already set — so
   * calling it twice on the same instance is harmless.
   */
  Widget.prototype.applyConfig = function (data) {
    if (!data || !data.config) return;
    CONFIG = data.config;

    // Adopt whatever the server actually applied. It is the only party that knows the
    // merchant's configured page size and sort, and pagination maths below has to use the
    // same number the query used or "Showing 1-5 of 10" drifts out of step with reality.
    if (data.limit) this.perPage = data.limit;
    if (!this.sort) this.sort = CONFIG.behaviour.defaultSort || 'recent';
    applyColors(this.root, data.config.colors);
    applyCustomCss(data.config.customCss);
    this.applyLayout();
    this.configured = true;
    // A jump that arrived before the layout was known has been waiting for this (see
    // reveal). An overlay has just lifted everything out of the page into its panel, so
    // open the panel; if the wait ran out and the page already scrolled, put it back
    // where the shopper was, or closing the panel would leave them far down the page.
    if (this.revealPending) {
      clearTimeout(this.revealTimer);
      if (this.setOpen) {
        if (this.revealLanded) window.scrollTo(0, this.revealFrom);
        this.setOpen(true);
      } else if (!this.revealLanded) {
        this.land();
      }
      this.revealPending = false;
      this.revealLanded = false;
    }
    this.applyText();
    this.applyBranding(data.config.branding);
    this.applyOffer(data.offer);
  };

  /**
   * The merchant's review incentive, announced where the shopper decides whether to write.
   *
   * Rendered from the payload's `offer`, which the server only sends for a store whose plan
   * includes incentives and which has one active — so a downgraded store cannot advertise a
   * reward it will not pay. The disclosure travels with it; FTC 16 CFR 465 requires the
   * offer be disclosed where it is made, not just on the review it produces.
   */
  Widget.prototype.applyOffer = function (offer) {
    var existing = this.root.querySelector('.rm-offer');
    if (existing) existing.remove();
    if (!offer || !offer.offer) return;
    var box = el('div', 'rm-offer');
    box.setAttribute('role', 'note');
    box.appendChild(el('p', 'rm-offer__text', offer.offer));
    if (offer.disclosure) box.appendChild(el('p', 'rm-offer__disclosure', offer.disclosure));
    var summary = this.root.querySelector('.rm-summary');
    if (summary && summary.parentNode) summary.parentNode.insertBefore(box, summary.nextSibling);
    else this.root.insertBefore(box, this.root.firstChild);
  };

  /**
   * The free plan's attribution: the Marka Reviews icon, 20 px, linking to the listing.
   *
   * The trade the free tier makes. Paid plans get `whiteLabel` and this never renders.
   *
   * An icon, not a line of text, because Shopify's App Store requirement 5.1 (revised
   * November 2025) limits app branding in a theme extension to the standard attribution:
   * 24 x 24 px for any image or text. The words live in the accessible name and the
   * tooltip only. It reads as the app's mark and nothing more: it never says "verified",
   * since it sits under every review, verified or not.
   *
   * Loaded from the app's own host (public/brand), only on free stores, lazily. Quiet on
   * purpose, below the reviews: a storefront belongs to the merchant.
   *
   * `rel="noopener"` because it opens in a new tab, and `nofollow` because a link on
   * every free store is exactly the footprint search engines treat as a link scheme.
   * Built with createElement, like everything else here: this runs on a merchant's
   * storefront and must not be an innerHTML path.
   */
  Widget.prototype.applyBranding = function (show) {
    var existing = this.root.querySelector('.rm-branding');
    // Idempotent: applyConfig can run more than once on the same instance, and a plan can
    // change between loads. Clearing first means it never doubles up or lingers after an
    // upgrade.
    if (existing) existing.parentNode.removeChild(existing);
    if (!show || !this.appUrl) return;

    var wrap = el('div', 'rm-branding');
    var link = el('a', 'rm-branding__link');
    link.href = 'https://apps.shopify.com/reviewmaster';
    link.target = '_blank';
    link.rel = 'noopener nofollow';
    link.title = 'Powered by Marka Reviews';
    link.setAttribute('aria-label', 'Powered by Marka Reviews');
    var icon = el('img', 'rm-branding__icon');
    icon.src = this.appUrl + '/brand/marka-reviews-icon-64.png';
    icon.width = 20;
    icon.height = 20;
    icon.alt = '';
    icon.loading = 'lazy';
    icon.decoding = 'async';
    link.appendChild(icon);
    wrap.appendChild(link);
    // Inside the panel for the overlay layouts. buildOverlay lifts every child of the block
    // into the fixed .rm-panel, so appending to the root here left the icon in the page
    // flow where the block was placed: a lone rule and a 24 px mark in the middle of the
    // product page with no reviews around it. applyLayout runs before this, so when there
    // is a panel it already exists.
    var host = this.root.querySelector('.rm-panel') || this.root;
    host.appendChild(wrap);
  };

  /**
   * Fill the reserved space with placeholder cards while the fetch is in flight.
   *
   * The container declares a min-height so the page does not jump when reviews arrive, and
   * the render below then released that height to 0. That trades one jump for another: an
   * empty reserved box collapsing by several hundred pixels is a layout shift exactly like
   * the one the reservation was added to prevent, and it lands late — after a network round
   * trip — which is the worst moment for CLS.
   *
   * Occupying the space with skeletons means the box is never visibly empty, and swapping a
   * skeleton for a real card of roughly the same height is a far smaller shift than
   * collapsing the whole container. Purely decorative, so it is hidden from assistive tech.
   */
  Widget.prototype.showSkeletons = function () {
    var list = this.listEl;
    if (!list || list.dataset.rmSkeleton === '1' || list.children.length) return;
    list.dataset.rmSkeleton = '1';
    list.setAttribute('aria-busy', 'true');
    var n = this.layout === 'testimonial' ? 1 : 3;
    for (var i = 0; i < n; i++) {
      var card = el('div', 'rm-review rm-review--skeleton');
      card.setAttribute('aria-hidden', 'true');
      card.appendChild(el('span', 'rm-skel rm-skel--stars'));
      card.appendChild(el('span', 'rm-skel rm-skel--line'));
      card.appendChild(el('span', 'rm-skel rm-skel--line'));
      card.appendChild(el('span', 'rm-skel rm-skel--line rm-skel--short'));
      list.appendChild(card);
    }
  };

  Widget.prototype.render = function (data) {
    var self = this;
    var list = this.listEl;

    // The badge layout removed the list entirely. Its histogram still wants the data, so
    // render that and stop.
    if (!list) {
      if (this.histEl && data.aggregate && data.aggregate.count) this.renderHistogram(data.aggregate);
      return;
    }

    list.innerHTML = '';
    list.dataset.rmSkeleton = '';
    list.removeAttribute('aria-busy');
    // A new list, so a new record of what is on it: "See more" appends against this, and a
    // sort, filter or star-row click lands here and so starts again from the first page.
    this.resetMore();
    this.total = data.total || 0;

    if (!data.reviews || !data.reviews.length) {
      // Only speak up when a FILTER emptied the list. With no filters the Liquid summary
      // above already renders "No reviews yet", and repeating it puts the same sentence
      // on screen twice.
      if (this.rating || this.mediaOnly) {
        list.appendChild(el('p', 'rm-empty', t('noMatchFilter')));
      }
      // Release the reserved height once we know the real content is empty, so an
      // unreviewed product does not carry 400px of blank space forever.
      list.style.minHeight = '0';
      if (this.pagEl) this.pagEl.hidden = true;
      return;
    }

    // Testimonial is a single featured quote, not a list. Showing one card is the point of
    // the layout, so the extra rows are simply not rendered rather than hidden with CSS.
    var items = this.layout === 'testimonial' ? data.reviews.slice(0, 1) : data.reviews;
    var fresh = freshReviews(this.seen, items);
    fresh.forEach(function (r) { list.appendChild(self.card(r)); });
    this.shown = fresh.length;
    list.style.minHeight = '0';

    if (this.histEl && data.aggregate && data.aggregate.count) this.renderHistogram(data.aggregate);
    if (this.filtersEl) this.renderFilters();

    if (this.layout === 'carousel') {
      // A carousel scrolls; it does not paginate. Two competing ways to move through the
      // same reviews is a worse experience than either alone.
      this.buildCarousel();
    } else if (this.layout === 'testimonial') {
      if (this.pagEl) this.pagEl.hidden = true;
    } else if (behaviour('paginationStyle', 'loadMore') === 'pages') {
      this.renderPagination(data.total);
    } else {
      // The default, and what a server from before paginationStyle gets too. Inside the
      // floating, popup and sidebar panels this is the better fit anyway: the panel already
      // scrolls, and numbered pages there had nothing sensible to scroll back to.
      this.renderMore();
    }
  };

  Widget.prototype.card = function (r) {
    var card = el('article', 'rm-review');

    var head = el('div', 'rm-review__head');
    head.appendChild(stars(r.rating));

    var who = el('div', 'rm-review__who');
    who.appendChild(el('span', 'rm-review__author', r.author));

    // Only 'verified_buyer' earns the badge. Showing "Verified Purchase" on a review with
    // no matching order is a misrepresentation under FTC 16 CFR 465 — the API already
    // enforces this, and the widget must not reintroduce it.
    if (r.verified && behaviour('showVerifiedBadge', true)) {
      var b = el('span', 'rm-badge rm-badge--verified', t('verifiedBadge'));
      b.title = 'This reviewer bought this product from this store';
      who.appendChild(b);
    }

    // FTC 16 CFR 465.4 requires incentivised reviews to be disclosed. Not a tooltip, not
    // a footnote — visible next to the review itself.
    if (r.incentivized) {
      var inc = el('span', 'rm-badge rm-badge--incentive', t('incentivisedBadge'));
      inc.title = t('incentivisedTooltip');
      who.appendChild(inc);
    }

    // Where an imported review came from. Off by default: most merchants would rather not
    // advertise that their reviews arrived from a previous app, and the ones who want the
    // provenance shown tend to want it badly.
    if (r.source && r.source !== 'storefront' && behaviour('showSourceBadge', false)) {
      who.appendChild(el('span', 'rm-badge rm-badge--source', r.source));
    }

    if (r.location && behaviour('showReviewerLocation', true)) {
      who.appendChild(el('span', 'rm-review__loc', r.location));
    }
    head.appendChild(who);
    if (behaviour('showDates', true)) {
      head.appendChild(el('time', 'rm-review__date', fmtDate(r.date)));
    }
    card.appendChild(head);

    if (r.title) card.appendChild(el('h4', 'rm-review__title', r.title));
    card.appendChild(el('p', 'rm-review__body', r.body));

    if (((r.images && r.images.length) || r.video) && behaviour('showMedia', true)) {
      var media = el('div', 'rm-review__media');

      (r.images || []).slice(0, 6).forEach(function (src) {
        var btn = el('button', 'rm-thumb');
        btn.type = 'button';
        btn.setAttribute('aria-label', 'View full size photo from ' + r.author);
        var img = el('img');
        img.src = src;
        img.loading = 'lazy';
        img.decoding = 'async';
        // Explicit dimensions so images do not shift the layout as they decode.
        img.width = 96; img.height = 96;
        img.alt = 'Customer photo';
        btn.appendChild(img);
        btn.addEventListener('click', function () { openLightbox(src, 'image'); });
        media.appendChild(btn);
      });

      if (r.video) {
        // The thumbnail is a real frame from the video, not a placeholder.
        //
        // This used to be an empty dark square with a ▶ glyph, which is indistinguishable
        // from a broken image — a shopper cannot tell whether there is a video there or
        // whether the page failed. `preload="metadata"` plus the `#t=0.1` media fragment
        // makes the browser range-request only the first fraction of a second and paint
        // that frame; it is a few tens of KB, not the file.
        //
        // The element is deliberately inert: no controls, muted, never played inline.
        // Clicking still opens the lightbox, so the actual player is created once, on
        // demand — which was the point of the original poster-and-click design.
        var vbtn = el('button', 'rm-thumb rm-thumb--video');
        vbtn.type = 'button';
        vbtn.setAttribute('aria-label', 'Play video review from ' + r.author);

        var poster = document.createElement('video');
        poster.className = 'rm-thumb__poster';
        poster.src = r.video + '#t=0.1';
        poster.preload = 'metadata';
        poster.muted = true;
        poster.playsInline = true;
        poster.tabIndex = -1;
        poster.setAttribute('aria-hidden', 'true');
        // A codec the browser cannot decode leaves the frame blank; drop back to the
        // plain dark tile rather than showing an empty box with no play affordance.
        poster.addEventListener('error', function () {
          vbtn.classList.add('rm-thumb--noposter');
          if (poster.parentNode) poster.parentNode.removeChild(poster);
        });

        vbtn.appendChild(poster);
        vbtn.appendChild(el('span', 'rm-thumb__play', '▶'));
        vbtn.addEventListener('click', function () { openLightbox(r.video, 'video'); });
        media.appendChild(vbtn);
      }

      card.appendChild(media);
    }

    if (r.reply && behaviour('showReply', true)) {
      var reply = el('div', 'rm-review__reply');
      reply.appendChild(el('strong', null, t('storeResponse')));
      reply.appendChild(el('p', null, r.reply));
      card.appendChild(reply);
    }

    if (behaviour('showHelpful', true)) card.appendChild(this.helpfulControl(r));

    return card;
  };

  /**
   * "Helpful" vote.
   *
   * The count is a soft signal — nothing is spent or published on the basis of it — so the
   * dedup story is deliberately cheap: this browser remembers what it voted on, and the
   * server rejects repeats from the same address for an hour. Storing a per-shopper
   * identifier for every merchant's storefront traffic would be a real privacy cost to
   * slightly harden a number next to a review.
   *
   * localStorage failing (private mode, blocked storage) degrades to "the button works but
   * does not remember", which is the right way for this to break.
   */
  Widget.prototype.helpfulControl = function (r) {
    var self = this;
    var wrap = el('div', 'rm-review__foot');
    var key = 'rm-helpful-' + r.id;
    var voted = false;
    try { voted = localStorage.getItem(key) === '1'; } catch (e) {}

    var count = el('span', 'rm-helpful__n', r.helpful ? String(r.helpful) : '');
    var btn = el('button', 'rm-helpful', t('helpful'));
    btn.type = 'button';
    btn.setAttribute('aria-label', t('helpful'));

    if (voted) {
      btn.disabled = true;
      btn.classList.add('is-voted');
    }

    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.classList.add('is-voted');
      try { localStorage.setItem(key, '1'); } catch (e) {}

      fetch(self.appUrl + '/api/storefront/helpful', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shop: self.shop, reviewId: r.id })
      })
        .then(function (res) { return res.json(); })
        .then(function (j) {
          if (j && typeof j.helpful === 'number') count.textContent = String(j.helpful);
          btn.title = t('helpfulThanks');
        })
        .catch(function () {
          // Optimistic either way. A failed vote is not worth a visible error on a
          // shopper's product page.
        });
    });

    wrap.appendChild(btn);
    wrap.appendChild(count);
    return wrap;
  };

  Widget.prototype.renderHistogram = function (agg) {
    var self = this;
    var h = this.histEl;
    if (!h) return;

    // Checked HERE, not only in applyText. applyText runs before the first render and set
    // hidden = true, and then this function unconditionally set hidden = false again — so
    // turning the breakdown off did nothing on any product that had reviews.
    if (behaviour('showHistogram', true) === false) { h.hidden = true; return; }

    h.innerHTML = '';
    h.hidden = false;
    for (var s = 5; s >= 1; s--) {
      var n = agg.distribution[s] || 0;
      var pct = agg.count ? Math.round((n / agg.count) * 100) : 0;
      var row = el('button', 'rm-hist__row');
      row.type = 'button';
      row.setAttribute('aria-label', s + ' star reviews: ' + n);
      // "5 ★": the number, then the glyph. Where masks work the CSS hides the glyph and
      // draws the Marka star after the number instead (.rm-hist__label::after).
      var label = el('span', 'rm-hist__label', String(s));
      var glyph = el('span', 'rm-hist__glyph', '★');
      glyph.setAttribute('aria-hidden', 'true');
      label.appendChild(glyph);
      row.appendChild(label);
      var track = el('span', 'rm-hist__track');
      var fill = el('span', 'rm-hist__fill');
      fill.style.width = pct + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('span', 'rm-hist__n', String(n)));
      (function (star) {
        row.addEventListener('click', function () {
          self.rating = self.rating === star ? null : star;
          self.page = 1;
          self.load();
        });
      })(s);
      h.appendChild(row);
    }
  };

  Widget.prototype.renderFilters = function () {
    var self = this;
    var f = this.filtersEl;
    if (!f) return;

    // Same ordering bug as the histogram, with a nastier symptom: the filters appeared on
    // first load and then vanished the moment a shopper used one, because the rebuild is
    // guarded by rmBuilt and only the second pass reached the hiding code.
    if (behaviour('showFilters', true) === false) { f.hidden = true; return; }

    if (f.dataset.rmBuilt) return;
    f.dataset.rmBuilt = '1';
    f.hidden = false;

    var sel = el('select', 'rm-filters__sort');
    [['recent', t('sortRecent')], ['highest', t('sortHighest')],
     ['lowest', t('sortLowest')], ['helpful', t('sortHelpful')]].forEach(function (o) {
      var opt = el('option', null, o[1]);
      opt.value = o[0];
      if (o[0] === self.sort) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.setAttribute('aria-label', 'Sort reviews');
    sel.addEventListener('change', function () {
      self.sort = sel.value; self.page = 1; self.load();
    });
    f.appendChild(sel);

    var media = el('button', 'rm-filters__media', t('filterWithPhotos'));
    media.type = 'button';
    media.setAttribute('aria-pressed', 'false');
    media.addEventListener('click', function () {
      self.mediaOnly = !self.mediaOnly;
      media.setAttribute('aria-pressed', String(self.mediaOnly));
      media.classList.toggle('is-active', self.mediaOnly);
      self.page = 1;
      self.load();
    });
    f.appendChild(media);
  };

  /**
   * Sectional pagination.
   *
   * Everything here is in-place: the fetch replaces the review list and nothing else on
   * the page moves. No navigation, no query string, no reload — a shopper flipping to page
   * two must not lose their scroll position, their variant selection, or anything else the
   * product page is holding.
   *
   * On page change the view scrolls to the top of the REVIEW SECTION, not the top of the
   * document, so the reader stays where they were reading.
   */
  Widget.prototype.renderPagination = function (total) {
    var self = this;
    var p = this.pagEl;
    if (!p) return;

    var pages = Math.ceil(total / this.perPage);
    p.innerHTML = '';

    if (pages <= 1) {
      p.hidden = true;
      return;
    }
    p.hidden = false;

    var first = (this.page - 1) * this.perPage + 1;
    var last = Math.min(this.page * this.perPage, total);

    // Counts before controls. "Showing 1–5 of 9" tells a shopper there is more to read,
    // which a bare pair of arrows does not.
    var info = el('div', 'rm-pagination__info',
      t('showingCount', { first: first, last: last, total: total }));
    p.appendChild(info);

    var nav = el('nav', 'rm-pagination__nav');
    nav.setAttribute('aria-label', 'Reviews pagination');

    function go(page) {
      self.page = page;
      self.load();
      // Scroll the review section into view, not the document. Anchoring on the widget
      // root keeps the shopper inside the reviews rather than throwing them to the top of
      // the product page. Same landing point as a jump from the count under the title.
      scrollToNode(self.root);
    }

    function arrow(label, page, disabled, aria) {
      var b = el('button', 'rm-page rm-page--arrow', label);
      b.type = 'button';
      b.disabled = !!disabled;
      b.setAttribute('aria-label', aria);
      if (!disabled) b.addEventListener('click', function () { go(page); });
      return b;
    }

    nav.appendChild(arrow('\u2039', this.page - 1, this.page <= 1, 'Previous page of reviews'));

    // Windowed page numbers. A product with 400 reviews would otherwise render eighty
    // buttons; show first, last, and a window around the current page with ellipses.
    var nums = [];
    if (pages <= 7) {
      for (var i = 1; i <= pages; i++) nums.push(i);
    } else {
      nums.push(1);
      var from = Math.max(2, this.page - 1);
      var to = Math.min(pages - 1, this.page + 1);
      if (from > 2) nums.push('\u2026');
      for (var k = from; k <= to; k++) nums.push(k);
      if (to < pages - 1) nums.push('\u2026');
      nums.push(pages);
    }

    nums.forEach(function (n) {
      if (n === '\u2026') {
        var gap = el('span', 'rm-page__gap', '\u2026');
        gap.setAttribute('aria-hidden', 'true');
        nav.appendChild(gap);
        return;
      }
      var b = el('button', 'rm-page' + (n === self.page ? ' is-current' : ''), String(n));
      b.type = 'button';
      b.setAttribute('aria-label', 'Page ' + n + ' of reviews');
      if (n === self.page) b.setAttribute('aria-current', 'page');
      b.addEventListener('click', function () { if (n !== self.page) go(n); });
      nav.appendChild(b);
    });

    nav.appendChild(arrow('\u203a', this.page + 1, this.page >= pages, 'Next page of reviews'));
    p.appendChild(nav);
  };

  /**
   * "See more reviews": the default since Settings gained a pagination style.
   *
   * Appends instead of replacing, so a shopper keeps every review they have read on screen
   * and never loses their place to a page flip. Each click asks for the rows after the ones
   * shown (nextChunk), draws only the ones not already there (freshReviews), and reports
   * the new count. A sort, filter or star-row click reloads through load(), whose render()
   * starts over from the first page.
   */
  Widget.prototype.resetMore = function () {
    // Bumped with every new list, so an answer for the old one is recognised and dropped.
    this.gen = (this.gen || 0) + 1;
    // No prototype, so an id can never collide with an inherited name.
    this.seen = Object.create(null);
    this.shown = 0;
    this.total = 0;
    this.morePage = 1;
    this.moreBusy = false;
    this.moreDone = false;
    this.more = null;
  };

  Widget.prototype.moreStep = function () {
    return clampInt(behaviour('loadMoreCount', 10), 1, 50, 10);
  };

  Widget.prototype.renderMore = function () {
    var self = this;
    var p = this.pagEl;
    if (!p) return;
    p.innerHTML = '';

    // Everything is already on screen: no footer, as numbered pagination hides itself when
    // there is a single page.
    if (this.shown >= this.total) {
      p.hidden = true;
      return;
    }
    p.hidden = false;

    // A live region, so the new count is read out after a click. Focus stays on the button
    // (aria-disabled rather than disabled while loading, because a disabled button drops
    // keyboard focus), and the shopper hears what changed.
    var info = el('div', 'rm-pagination__info');
    info.setAttribute('role', 'status');
    var btn = el('button', 'rm-btn rm-btn--ghost rm-more');
    btn.type = 'button';
    btn.addEventListener('click', function () { self.loadMore(); });
    var note = el('p', 'rm-more__error');
    note.setAttribute('role', 'alert');
    note.hidden = true;
    p.appendChild(info);
    p.appendChild(btn);
    p.appendChild(note);
    this.more = { info: info, btn: btn, note: note };
    this.updateMore('');
  };

  Widget.prototype.updateMore = function (state) {
    var m = this.more;
    if (!m) return;
    var loading = state === 'loading';
    m.info.textContent = t('showingOf', { shown: this.shown, total: Math.max(this.total, this.shown) });
    m.btn.hidden = !loading && (this.moreDone || this.shown >= this.total);
    m.btn.textContent = t(loading ? 'loadingMore' : 'seeMore');
    if (loading) m.btn.setAttribute('aria-disabled', 'true');
    else m.btn.removeAttribute('aria-disabled');
    m.note.hidden = state !== 'error';
    m.note.textContent = state === 'error' ? t('loadMoreError') : '';
  };

  Widget.prototype.loadMore = function () {
    var self = this;
    var list = this.listEl;
    if (this.moreBusy || !this.more || !list) return;
    this.moreBusy = true;
    var gen = this.gen;
    var hadFocus = document.activeElement === this.more.btn;
    this.updateMore('loading');
    list.setAttribute('aria-busy', 'true');

    function ask() {
      var chunk = nextChunk(self.shown, self.morePage, self.perPage, self.moreStep(), self.legacyPaging);
      return getJson(self.url(chunk)).then(function (data) { return { chunk: chunk, data: data || {} }; });
    }

    ask()
      .then(function (res) {
        // A server from before `offset` ignores it and answers with the first page again,
        // which the dedupe would quietly turn into "nothing more". Its reply also leaves
        // `offset` out, which is the tell: from here on, count in pages.
        if (res.chunk.offset !== undefined && res.data.offset === undefined) {
          self.legacyPaging = true;
          return ask();
        }
        return res;
      })
      .then(function (res) {
        if (gen !== self.gen) return;
        var rows = res.data.reviews || [];
        var fresh = freshReviews(self.seen, rows);
        fresh.forEach(function (r) { list.appendChild(self.card(r)); });
        self.shown += fresh.length;
        if (res.chunk.page) self.morePage = res.chunk.page;
        if (typeof res.data.total === 'number') self.total = res.data.total;
        // Fewer rows than asked for is the end, whatever the total said a moment ago.
        if (rows.length < res.chunk.limit) self.moreDone = true;
        self.moreBusy = false;
        list.removeAttribute('aria-busy');
        self.updateMore('');
        // With everything shown the button goes; focus goes to the first review it brought
        // in, rather than falling back to the top of the page.
        if (hadFocus && self.more.btn.hidden && fresh.length) {
          focusQuietly(list.children[list.children.length - fresh.length], null);
        }
      })
      .catch(function () {
        if (gen !== self.gen) return;
        self.moreBusy = false;
        list.removeAttribute('aria-busy');
        self.updateMore('error');
      });
  };

  /**
   * Bring the reviews to a shopper who asked for them: the count under the product title,
   * the highlights box's "Read more", or a page opened at #reviewmaster-reviews.
   */
  Widget.prototype.reveal = function () {
    var self = this;
    // The observer waits for the block to come near the viewport. A jump is the shopper
    // saying they want the reviews now, so fetch now rather than land on placeholders.
    if (this.loadNow) this.loadNow();
    if (this.setOpen) {
      this.setOpen(true);
      return;
    }
    if (this.configured) {
      this.land();
      return;
    }
    // The layout arrives with the list, and it decides what a jump means: a scroll for an
    // inline list, the panel for an overlay. Scrolling first and asking later sent the
    // shopper to the bottom of the page on a store with a floating widget. The answer is
    // usually an edge-cached response away, so wait for it (applyConfig finishes the job),
    // but not for long: past 700 ms, land on the reserved space as for a list. A config
    // that never comes (the fetch failed) must not swallow the next click, so once the
    // wait has run out a click lands straight away.
    if (this.revealPending) {
      if (this.revealLanded) this.land();
      return;
    }
    this.revealPending = true;
    this.revealTimer = setTimeout(function () {
      if (!self.revealPending) return;
      self.revealFrom = window.pageYOffset;
      self.revealLanded = true;
      self.land();
    }, 700);
  };

  /**
   * Scroll an inline widget into view below any sticky header, and move focus to its
   * heading. Focus first: a browser without preventScroll jumps on focus, and the scroll
   * that follows then corrects for the header.
   */
  Widget.prototype.land = function () {
    focusQuietly(this.root.querySelector('.rm-widget__heading'), this.root);
    scrollToNode(this.root);
  };

  /**
   * Switch the widget into whatever display style the merchant chose.
   *
   * Almost all of this is class names and custom properties, and that is deliberate: nine
   * layouts implemented as nine renderers would be nine times the JavaScript on a product
   * page, and the theme app extension budget is 10 KB. Grid, masonry, list and testimonial
   * are the same cards under different CSS. Only three things genuinely need script — the
   * carousel's controls, the overlay layouts' open/close, and skipping the list entirely
   * for the badge.
   */
  Widget.prototype.applyLayout = function () {
    if (!CONFIG || !CONFIG.layout) return;
    var L = CONFIG.layout;
    var root = this.root;
    this.layout = L.type || 'list';
    applyMarks(L);

    root.classList.add('rm-widget--' + this.layout);
    if (L.theme) root.classList.add('rm-theme--' + L.theme);

    if (L.columns) root.style.setProperty('--rm-columns', String(L.columns));
    if (L.borderRadius !== undefined && !root.style.getPropertyValue('--rm-radius')) {
      root.style.setProperty('--rm-radius', L.borderRadius + 'px');
    }

    // The summary IS the widget for a badge. Everything that would sit below it is removed
    // rather than hidden, so a merchant who put a compact badge under their Add to Cart
    // button does not get 400px of reserved space they never asked for.
    if (SUMMARY_ONLY[this.layout]) {
      ['[data-rm-list]', '[data-rm-pagination]', '[data-rm-form-wrap]', '[data-rm-filters]']
        .forEach(function (sel) {
          var n = root.querySelector(sel);
          if (n) n.remove();
        });
      this.listEl = null;
      this.pagEl = null;
      this.filtersEl = null;
      return;
    }

    if (OVERLAY[this.layout]) this.buildOverlay(L);
  };

  /**
   * Floating, popup and sidebar: the same widget, moved off the page flow.
   *
   * Rather than a separate markup path, the block's existing children are lifted into a
   * panel and a trigger is added. That keeps one set of markup, one set of bindings and one
   * accessibility story — the form, filters and pagination inside the panel are the same
   * elements that already had listeners attached in the constructor.
   */
  Widget.prototype.buildOverlay = function (L) {
    var self = this;
    var root = this.root;
    if (root.querySelector('.rm-panel')) return;

    var panel = el('div', 'rm-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', t('heading') || 'Customer reviews');
    while (root.firstChild) panel.appendChild(root.firstChild);

    var close = el('button', 'rm-panel__close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', t('close'));
    panel.insertBefore(close, panel.firstChild);

    var trigger = el('button', 'rm-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.appendChild(el('span', 'rm-trigger__star', '★'));
    trigger.appendChild(el('span', 'rm-trigger__label', t('seeAll')));

    root.appendChild(trigger);
    root.appendChild(panel);

    function setOpen(open) {
      root.classList.toggle('is-open', open);
      trigger.setAttribute('aria-expanded', String(open));
      if (open) close.focus();
      else trigger.focus();
    }
    // For reveal(): a link to the reviews opens the panel, since there is nothing in the
    // page flow to scroll to.
    self.setOpen = setOpen;

    trigger.addEventListener('click', function () {
      setOpen(!root.classList.contains('is-open'));
    });
    close.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && root.classList.contains('is-open')) setOpen(false);
    });

    // Popup opens itself once, after the configured delay, and only once per session.
    // A modal that reappears on every page view is the fastest way to make a shopper
    // leave, and sessionStorage means dismissing it sticks for the visit.
    if (self.layout === 'popup') {
      var seenKey = 'rm-popup-seen';
      var already = false;
      try { already = sessionStorage.getItem(seenKey) === '1'; } catch (e) {}
      if (!already) {
        setTimeout(function () {
          if (!root.classList.contains('is-open')) setOpen(true);
          try { sessionStorage.setItem(seenKey, '1'); } catch (e) {}
        }, Math.max(0, (L.popupDelay || 5) * 1000));
      }
    }
  };

  /**
   * Carousel controls.
   *
   * The track is the review list itself with `overflow-x: auto` — native scrolling, native
   * momentum on touch, native keyboard support, and it degrades to a plain scrollable row
   * if this script never runs. The buttons scroll by one card's width rather than a fixed
   * number of pixels, so it stays correct across breakpoints.
   */
  Widget.prototype.buildCarousel = function () {
    var self = this;
    var list = this.listEl;
    var pag = this.pagEl;
    if (!list || !pag) return;

    pag.innerHTML = '';
    pag.hidden = false;
    pag.classList.add('rm-carousel-nav');

    function step(dir) {
      var card = list.querySelector('.rm-review');
      var by = card ? card.getBoundingClientRect().width + 16 : list.clientWidth * 0.8;
      list.scrollBy({ left: dir * by, behavior: 'smooth' });
    }

    function btn(label, dir, aria) {
      var b = el('button', 'rm-page rm-page--arrow', label);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', function () { step(dir); });
      return b;
    }

    pag.appendChild(btn('‹', -1, 'Previous reviews'));
    pag.appendChild(btn('›', 1, 'Next reviews'));

    if (CONFIG && CONFIG.layout && CONFIG.layout.autoplay) {
      var timer = setInterval(function () {
        // Stop at the end rather than looping. A carousel that silently jumps back to the
        // start makes a shopper lose their place mid-sentence.
        if (list.scrollLeft + list.clientWidth >= list.scrollWidth - 4) {
          clearInterval(timer);
          return;
        }
        step(1);
      }, 5000);
      // Any interaction ends autoplay for good. Motion that fights the reader is worse
      // than no motion.
      ['pointerdown', 'keydown', 'wheel'].forEach(function (evt) {
        self.root.addEventListener(evt, function () { clearInterval(timer); }, { once: true });
      });
    }
  };

  /**
   * Overwrite the Liquid-rendered strings with the merchant's configured copy.
   *
   * The block renders defaults server-side so the widget is readable before any JavaScript
   * runs — that is deliberate and worth keeping. Once config arrives, anything the merchant
   * customised is swapped in. Only elements whose text is actually different are touched,
   * so the common case (no customisation) causes no DOM work at all.
   */
  Widget.prototype.applyText = function () {
    if (!CONFIG || !CONFIG.text) return;
    var root = this.root;

    var pairs = [
      ['.rm-widget__heading', 'heading'],
      ['[data-rm-open-form]', 'writeReview'],
      ['.rm-form__title', 'writeReview'],
      ['.rm-form__rating legend', 'yourRating'],
      ['[data-rm-cancel-form]', 'cancel'],
      ['.rm-form__actions button[type="submit"]', 'submit'],
      ['.rm-file__btn', 'chooseFiles'],
      ['[data-rm-file-name]', 'noFilesSelected']
    ];

    pairs.forEach(function (p) {
      var node = root.querySelector(p[0]);
      var value = CONFIG.text[p[1]];
      if (node && value && node.textContent.trim() !== value) node.textContent = value;
    });

    // Field labels sit in the first <span> of each .rm-form__field.
    var labels = [['name', 'yourName'], ['email', 'yourEmail'],
                  ['title', 'reviewTitle'], ['body', 'reviewBody']];
    labels.forEach(function (l) {
      var input = root.querySelector('[name="' + l[0] + '"]');
      if (!input) return;
      var field = input.closest('.rm-form__field');
      var span = field && field.querySelector('span');
      var value = CONFIG.text[l[1]];
      if (span && value && span.textContent.trim() !== value) span.textContent = value;
    });

    var privacy = root.querySelector('.rm-form__field small');
    if (privacy && CONFIG.text.emailPrivacy) privacy.textContent = CONFIG.text.emailPrivacy;

    // Behaviour toggles that hide whole controls.
    if (behaviour('showWriteButton', true) === false) {
      var btn = root.querySelector('[data-rm-open-form]');
      if (btn) btn.hidden = true;
    }
    if (behaviour('showHistogram', true) === false && this.histEl) this.histEl.hidden = true;
    if (behaviour('showFilters', true) === false && this.filtersEl) this.filtersEl.hidden = true;

    // The upload control is removed, not hidden, when the merchant has turned media off.
    // A disabled-but-present field invites a shopper to attach a photo that the endpoint
    // will then reject.
    var fileField = root.querySelector('[data-rm-file]');
    if (fileField && !behaviour('allowPhotos', true) && !behaviour('allowVideo', true)) {
      var fieldWrap = fileField.closest('.rm-form__field');
      if (fieldWrap) fieldWrap.remove();
    } else if (fileField) {
      // Narrow what the picker offers so the shopper is not shown video files they cannot
      // submit. The server enforces the same rule regardless.
      var accept = [];
      if (behaviour('allowPhotos', true)) accept.push('image/*');
      if (behaviour('allowVideo', true)) accept.push('video/*');
      fileField.setAttribute('accept', accept.join(','));
    }

    var emailInput = root.querySelector('[name="email"]');
    if (emailInput && behaviour('requireEmail', true) === false) {
      emailInput.removeAttribute('required');
    }

    var nameInput = root.querySelector('[name="name"]');
    if (nameInput && behaviour('allowAnonymous', false) === true) {
      nameInput.removeAttribute('required');
      nameInput.placeholder = 'Optional';
    }
  };

  /** A dismissible confirmation that lives outside the form, so it survives closing. */
  Widget.prototype.showNotice = function (message) {
    var existing = this.root.querySelector('.rm-notice');
    if (existing) existing.remove();
    var n = el('div', 'rm-notice', message);
    n.setAttribute('role', 'status');
    n.setAttribute('aria-live', 'polite');
    var summary = this.root.querySelector('.rm-summary');
    if (summary && summary.parentNode) {
      summary.parentNode.insertBefore(n, summary.nextSibling);
    } else {
      this.root.appendChild(n);
    }
  };

  /**
   * The upload caps from src/lib/media.ts, in its order and its words.
   *
   * The server is the rule and checks again regardless — but it can only check once the
   * body has arrived, so without this a shopper who attached a 60 MB video uploaded all of
   * it and then read that the limit is 50. Returns the message to show, or null when the
   * selection is fine. Same wording as the server so the two never disagree, and the type
   * list is the server's rather than the picker's `image/*,video/*`, so a HEIC photo from a
   * phone is turned away here rather than after the upload.
   */
  var MEDIA_IMAGE_TYPES = { 'image/jpeg': 1, 'image/png': 1, 'image/gif': 1, 'image/webp': 1 };
  var MEDIA_VIDEO_TYPES = { 'video/mp4': 1, 'video/quicktime': 1, 'video/webm': 1 };
  var MB = 1024 * 1024;
  function checkFiles(files) {
    if (!files) return null;
    var images = 0, videos = 0, total = 0;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var mime = (f.type || '').toLowerCase();
      var isImage = !!MEDIA_IMAGE_TYPES[mime];
      var isVideo = !!MEDIA_VIDEO_TYPES[mime];
      if (!isImage && !isVideo) {
        return '"' + f.name + '" is not a supported file type. Please upload a JPG, PNG, GIF, WebP, MP4, MOV or WebM.';
      }
      var limit = isImage ? 10 : 50;
      if (f.size > limit * MB) return '"' + f.name + '" is too large. The limit is ' + limit + 'MB.';
      if (f.size === 0) return '"' + f.name + '" appears to be empty.';
      if (isImage && ++images > 5) return 'Please upload at most 5 photos.';
      if (isVideo && ++videos > 1) return 'Please upload at most 1 video.';
      total += f.size;
      if (total > 80 * MB) return 'Those files are too large in total. Please upload fewer or smaller files.';
    }
    return null;
  }

  Widget.prototype.bindForm = function () {
    var self = this;
    var wrap = this.root.querySelector('[data-rm-form-wrap]');
    var open = this.root.querySelector('[data-rm-open-form]');
    var cancel = this.root.querySelector('[data-rm-cancel-form]');
    var form = this.root.querySelector('[data-rm-form]');
    if (!wrap || !form) return;

    if (open) open.addEventListener('click', function () {
      wrap.hidden = false;
      var input = form.querySelector('input[name="name"]');
      if (input) input.focus();
    });
    if (cancel) cancel.addEventListener('click', function () { wrap.hidden = true; });

    // Native file inputs render an unstyleable "Choose files / No file chosen". The input
    // is visually hidden and driven by a styled label; this keeps the label text honest
    // about what the shopper actually picked.
    var fileInput = form.querySelector('[data-rm-file]');
    var fileName = form.querySelector('[data-rm-file-name]');
    if (fileInput && fileName) {
      fileInput.addEventListener('change', function () {
        var status = form.querySelector('[data-rm-form-status]');
        // Checked the moment they are picked (see checkFiles). The picker is cleared on a
        // problem so the rejected files cannot be sent, and the message sits where the
        // submit errors do.
        var problem = checkFiles(fileInput.files);
        if (problem) {
          fileInput.value = '';
          fileName.textContent = t('noFilesSelected');
          if (status) status.textContent = problem;
          return;
        }
        if (status) status.textContent = '';
        var n = fileInput.files ? fileInput.files.length : 0;
        fileName.textContent = n === 0
          ? t('noFilesSelected')
          : (n === 1 ? fileInput.files[0].name : n + ' files selected');
      });
    }

    var chosen = 0;
    var rateWrap = form.querySelector('[data-rm-rating-input]');
    if (rateWrap) {
      rateWrap.addEventListener('click', function (e) {
        var t = e.target.closest('[data-rm-rate]');
        if (!t) return;
        chosen = parseInt(t.dataset.rmRate, 10);
        Array.prototype.forEach.call(rateWrap.children, function (c, i) {
          var on = i < chosen;
          c.classList.toggle('is-on', on);
          c.setAttribute('aria-checked', String(i + 1 === chosen));
        });
        // Clear "Please choose a star rating." the moment they choose one. Without this
        // the error stayed on screen through a valid, successful submission, telling the
        // shopper their review had failed when it had not.
        var formStatus = form.querySelector('[data-rm-form-status]');
        if (formStatus && chosen > 0) formStatus.textContent = '';
      });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = form.querySelector('[data-rm-form-status]');
      if (!chosen) { status.textContent = 'Please choose a star rating.'; return; }

      var fd = new FormData(form);
      fd.append('rating', String(chosen));
      fd.append('shop', self.shop);
      if (self.productId) fd.append('product_id', self.productId);

      var submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;
      status.textContent = t('submitting');

      fetch(self.appUrl + '/api/storefront/submit', { method: 'POST', body: fd })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.j && res.j.error);

          // Reset and close. Leaving a filled-in form open after a successful submit
          // invites a duplicate submission, and the confirmation is easy to miss when it
          // sits below a form that still looks unsent.
          form.reset();
          chosen = 0;
          Array.prototype.forEach.call(rateWrap ? rateWrap.children : [], function (c) {
            c.classList.remove('is-on');
            c.setAttribute('aria-checked', 'false');
          });
          var nameEl = form.querySelector('[data-rm-file-name]');
          if (nameEl) nameEl.textContent = t('noFilesSelected');
          status.textContent = '';
          wrap.hidden = true;

          // Confirmation goes OUTSIDE the form, so it survives the form being hidden.
          // Merchant copy wins over the server's default message — but which string is
          // correct depends on what the server actually did. With auto-publish on, telling
          // a shopper their review is "awaiting approval" is simply false.
          var published = !!(res.j && res.j.published);
          var msg = t(published ? 'thankYouPublished' : 'thankYou') || (res.j && res.j.message);
          if (res.j && res.j.warning) msg += ' ' + res.j.warning;
          self.showNotice(msg);

          if (published) {
            // The list this shopper is looking at no longer matches the server. Drop the
            // cache and reload so their own review appears where they expect it.
            CACHE = {};
            self.page = 1;
            self.load();
          }
        })
        .catch(function (err) {
          status.textContent = (err && err.message) || t('errorGeneric');
        })
        .finally(function () {
          if (submitBtn) submitBtn.disabled = false;
        });
    });
  };

  // ── Questions & answers ─────────────────────────────────────────────────────────────
  //
  // The shopper-facing half of Q&A. The server side — GET/POST /api/storefront/questions,
  // plan gating, per-email dedupe, rate limiting, and a full merchant moderation screen —
  // has existed for a long time with nothing on the storefront able to reach it. No block,
  // no fetch, so `db.question.create` had exactly one caller and that caller was
  // unreachable: the Questions screen in the app could only ever be empty, and the feature
  // was billed on the Growth plan regardless.
  //
  // Deliberately a separate widget from the review list rather than a section inside it.
  // A merchant places Q&A where it belongs on their product page, which is frequently not
  // directly under the reviews, and a shopper reading answers is doing something different
  // from a shopper reading reviews.
  //
  // Same rules as the review widget, for the same reasons: nothing is published without the
  // merchant approving it, every shopper-supplied string goes in through textContent, the
  // fetch is deferred until the block nears the viewport, and the reserved space is filled
  // with skeletons rather than collapsing when the data lands.

  function QuestionsWidget(root) {
    this.root = root;
    this.shop = root.dataset.rmShop;
    this.productId = root.dataset.rmProduct;
    this.appUrl = (root.dataset.rmAppUrl || '').replace(/\/$/, '');
    // Sent when the block carries one, as the review widget sends its own, so the widget
    // the merchant designed for this placement reaches Q&A too. The block has no placement
    // setting today; without one the server resolves the store's active widget.
    this.placement = root.dataset.rmPlacement || '';
    this.listEl = root.querySelector('[data-rm-q-list]');
    this.bindForm();
  }

  QuestionsWidget.prototype.url = function () {
    var parts = ['shop=' + encodeURIComponent(this.shop)];
    if (this.productId) parts.push('product_id=' + encodeURIComponent(this.productId));
    if (this.placement) parts.push('placement=' + encodeURIComponent(this.placement));
    return this.appUrl + '/api/storefront/questions?' + parts.join('&');
  };

  /** Placeholders while the fetch is in flight, so the reserved box is never a blank gap. */
  QuestionsWidget.prototype.showSkeletons = function () {
    var list = this.listEl;
    if (!list || list.children.length) return;
    list.setAttribute('aria-busy', 'true');
    for (var i = 0; i < 2; i++) {
      var card = el('div', 'rm-q rm-q--skeleton');
      card.setAttribute('aria-hidden', 'true');
      card.appendChild(el('span', 'rm-skel rm-skel--line'));
      card.appendChild(el('span', 'rm-skel rm-skel--line rm-skel--short'));
      list.appendChild(card);
    }
  };

  QuestionsWidget.prototype.load = function () {
    var self = this;
    this.showSkeletons();
    fetch(this.url(), { credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) { self.render(data); })
      .catch(function () {
        // A failed load must leave the page tidy rather than showing a broken shell. The
        // ask button stays HIDDEN: we could not confirm the store accepts questions, and
        // offering a form the server may refuse is worse than offering nothing.
        if (self.listEl) {
          self.listEl.innerHTML = '';
          self.listEl.removeAttribute('aria-busy');
          self.listEl.style.minHeight = '0';
        }
      });
  };

  /**
   * Show or hide the invitation to ask, from the entitlement the GET reports.
   *
   * The button is rendered hidden in the Liquid and revealed only here, on a successful
   * load that says canAsk === true. Theme app blocks are offered to every store regardless
   * of plan and Liquid has no plan signal, so without this a Free-plan store advertised
   * "Ask a question" and rejected every submission after the shopper had typed it all in.
   * The server's own gate on POST remains the backstop.
   */
  QuestionsWidget.prototype.setCanAsk = function (canAsk) {
    var open = this.root.querySelector('[data-rm-q-open]');
    if (open) open.hidden = !canAsk;
    if (!canAsk) {
      var wrap = this.root.querySelector('[data-rm-q-form-wrap]');
      if (wrap) wrap.hidden = true;
    }
  };

  QuestionsWidget.prototype.render = function (data) {
    var self = this;
    var list = this.listEl;
    if (!list) return;

    // The merchant's colours, so a Q&A block on a page with no review block still picks
    // up Settings -> Display. applyColors only fills in properties the theme block did not
    // already set inline, so a per-placement override in the block still wins.
    applyColors(this.root, data && data.colors);
    // And the rest of their look — star shape, badge icon, font, custom CSS — which only the
    // review widget used to publish. A Q&A block on a FAQ page or a collection, with no
    // review list beside it, rendered in the theme font with none of the merchant's CSS.
    // Both are idempotent, so a page that also carries the review widget applies them once.
    // An older server sends neither key, and nothing happens then.
    if (data && data.layout) applyMarks(data.layout);
    applyCustomCss(data && data.customCss);

    // Entitlement first, so nothing rendered below can invite what the server refuses.
    var canAsk = !!(data && data.canAsk === true);
    this.setCanAsk(canAsk);

    list.innerHTML = '';
    list.removeAttribute('aria-busy');

    var items = (data && data.questions) || [];
    if (!items.length) {
      list.appendChild(el('p', 'rm-empty', t(canAsk ? 'noQuestions' : 'noQuestionsPlain')));
      list.style.minHeight = '0';
      return;
    }

    items.forEach(function (q) { list.appendChild(self.card(q)); });
    list.style.minHeight = '0';
  };

  QuestionsWidget.prototype.card = function (q) {
    var wrap = el('article', 'rm-q');
    wrap.setAttribute('role', 'listitem');

    // The Q and A markers are visual structure only. Assistive tech gets the same
    // structure from the list/listitem roles and the answers nested under each question,
    // so the letters are hidden from it rather than read out as "Q" and "A".
    var head = el('div', 'rm-q__head');
    var qm = el('span', 'rm-q__marker', 'Q'); qm.setAttribute('aria-hidden', 'true');
    head.appendChild(qm);
    head.appendChild(el('p', 'rm-q__body', q.body));
    wrap.appendChild(head);

    var meta = el('div', 'rm-q__meta');
    meta.appendChild(el('span', 'rm-q__author', q.author));
    if (q.date) meta.appendChild(el('time', 'rm-q__date', fmtDate(q.date)));
    wrap.appendChild(meta);

    (q.answers || []).forEach(function (a) {
      var ans = el('div', 'rm-a' + (a.isMerchant ? ' rm-a--merchant' : ''));
      var ahead = el('div', 'rm-a__head');
      var am = el('span', 'rm-a__marker', 'A'); am.setAttribute('aria-hidden', 'true');
      ahead.appendChild(am);
      ahead.appendChild(el('p', 'rm-a__body', a.body));
      ans.appendChild(ahead);

      var ameta = el('div', 'rm-a__meta');
      ameta.appendChild(el('span', 'rm-a__author', a.author));
      // A shopper weighs an answer from the shop differently from another shopper's, so the
      // distinction the API already carries has to be visible rather than just present.
      if (a.isMerchant) ameta.appendChild(el('span', 'rm-badge rm-badge--verified', t('storeAnswer')));
      if (a.date) ameta.appendChild(el('time', 'rm-a__date', fmtDate(a.date)));
      ans.appendChild(ameta);

      wrap.appendChild(ans);
    });

    return wrap;
  };

  QuestionsWidget.prototype.bindForm = function () {
    var self = this;
    var wrap = this.root.querySelector('[data-rm-q-form-wrap]');
    var open = this.root.querySelector('[data-rm-q-open]');
    var cancel = this.root.querySelector('[data-rm-q-cancel]');
    var form = this.root.querySelector('[data-rm-q-form]');
    if (!wrap || !form) return;

    // Closing the form puts focus back on the button that opened it. Hiding the element a
    // keyboard user is focused inside otherwise drops their focus to <body>, and the next
    // Tab starts from the top of the page.
    function close() {
      wrap.hidden = true;
      if (open) { open.setAttribute('aria-expanded', 'false'); open.focus(); }
    }

    if (open) {
      open.addEventListener('click', function () {
        wrap.hidden = false;
        open.setAttribute('aria-expanded', 'true');
        var first = form.querySelector('input[name="name"]');
        if (first) first.focus();
      });
    }
    if (cancel) cancel.addEventListener('click', close);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = form.querySelector('[data-rm-q-status]');
      var submit = form.querySelector('button[type="submit"]');

      // The same rule the server applies, applied first. The form is `novalidate` so the
      // browser's own required-field check is off, and the server counts a request against
      // the rate limit BEFORE it validates fields — so without this, a shopper who pressed
      // Send on an empty form a few times was locked out for ten minutes for nothing.
      var nameEl = form.querySelector('[name="name"]');
      var bodyEl = form.querySelector('[name="body"]');
      var name = nameEl ? nameEl.value.trim() : '';
      var body = bodyEl ? bodyEl.value.trim() : '';
      if (!name || body.length < 5) {
        if (status) status.textContent = t('questionInvalid');
        (!name ? nameEl : bodyEl).focus();
        return;
      }

      var fd = new FormData(form);
      fd.append('shop', self.shop);
      if (self.productId) fd.append('product_id', self.productId);

      if (submit) submit.disabled = true;
      if (status) status.textContent = t('submitting');

      fetch(self.appUrl + '/api/storefront/questions', { method: 'POST', body: fd })
        .then(function (res) {
          return res.json().then(function (body) { return { ok: res.ok, body: body }; });
        })
        .then(function (r) {
          // The server's message is shown as-is on the error path. It knows things the
          // widget does not — the shop is not accepting questions, this person already has
          // one pending for this product — and inventing a generic line here would hide it.
          // Tagged, so the catch below can tell a message meant for the shopper from a
          // network or JSON-parse error whose text is not.
          if (!r.ok) {
            var e = new Error((r.body && r.body.error) || t('questionError'));
            e.rmUser = true;
            throw e;
          }
          form.reset();
          if (status) status.textContent = '';
          close();
          self.notice(t('questionThanks'));
        })
        .catch(function (err) {
          // Only a message we chose to show reaches the shopper. "Unexpected token < in
          // JSON" is not something to put on a product page.
          if (status) status.textContent = (err && err.rmUser && err.message) || t('questionError');
        })
        .finally(function () {
          if (submit) submit.disabled = false;
        });
    });
  };

  /**
   * Confirmation that lives outside the form, so it survives the form closing.
   *
   * Writes into a live region the Liquid renders up front, rather than creating one.
   * A `role="status"` element inserted into the DOM with its text already set is not
   * reliably announced — screen readers watch existing live regions for CHANGES, and a
   * node that arrives pre-filled has not changed. The region exists from page load,
   * empty and hidden; setting its text is the change that gets read out.
   */
  QuestionsWidget.prototype.notice = function (message) {
    var note = this.root.querySelector('[data-rm-q-notice]');
    if (!note) {
      note = el('div', 'rm-notice');
      note.setAttribute('data-rm-q-notice', '');
      note.setAttribute('role', 'status');
      note.setAttribute('aria-live', 'polite');
      this.root.insertBefore(note, this.root.firstChild);
    }
    note.hidden = false;
    note.textContent = message;
  };

  // ── Review highlights ───────────────────────────────────────────────────────────────
  //
  // A few good reviews in a box beside Add to cart, one at a time, from the "Review
  // highlights" block. The review list sits far down the page; this puts the proof where
  // the buying decision is made.
  //
  // The rules are the review widget's: every shopper string through textContent, the
  // "Verified" pill only for a review tied to a real order, the incentive disclosure on any
  // review written under an offer, nothing fetched until the block nears the viewport. And
  // one of its own: the box never changes height as it rotates. Each review's text is held
  // to the same number of lines, so the Add to cart button below it never moves under the
  // shopper's finger.

  function Highlights(root) {
    var d = root.dataset;
    this.root = root;
    this.shop = d.rmShop;
    this.productId = d.rmProduct;
    this.appUrl = (d.rmAppUrl || '').replace(/\/$/, '');
    this.placement = d.rmPlacement || '';
    this.source = /^(featured|random|latest)$/.test(d.rmSource || '') ? d.rmSource : 'featured';
    this.limit = clampInt(d.rmLimit, 1, 12, 6);
    this.rotate = clampInt(d.rmRotate, 0, 60, 6);
    this.showStars = d.rmShowStars !== 'false';
    this.showBadge = d.rmShowBadge !== 'false';
    this.showAvatar = d.rmShowAvatar !== 'false';
    this.slides = [];
    this.dots = [];
    this.index = 0;
    this.timer = null;
    // Rotation pauses while the pointer or focus is inside, and stops for good once the
    // shopper takes over (an arrow, a dot, the pause button). Motion that fights a reader
    // is worse than none.
    this.hover = false;
    this.focused = false;
    this.stopped = false;
    readLocale(root);
  }

  Highlights.prototype.url = function () {
    var p = ['highlights=1', 'shop=' + encodeURIComponent(this.shop),
      'source=' + this.source, 'limit=' + this.limit];
    if (this.productId) p.push('product_id=' + encodeURIComponent(this.productId));
    if (this.placement) p.push('placement=' + encodeURIComponent(this.placement));
    return this.appUrl + '/api/storefront/reviews?' + p.join('&');
  };

  Highlights.prototype.load = function () {
    var self = this;
    getJson(this.url())
      .then(function (data) { self.render(data); })
      // Quietly gone, like the review widget on a failed fetch: a broken box beside Add to
      // cart is worse than no box.
      .catch(function () { self.hide(); });
  };

  /** No highlights: no box, and no space held for one. */
  Highlights.prototype.hide = function () {
    this.halt();
    this.root.innerHTML = '';
    // In the theme editor an empty box would vanish, and a merchant adding the block to a
    // new store would think it broken. There it says what it needs instead; on the live
    // storefront it takes no space at all.
    if (this.root.getAttribute('data-rm-design-mode') === 'true') {
      this.root.appendChild(el('p', 'rm-hl__empty', t('highlightsEmpty')));
      return;
    }
    this.root.hidden = true;
  };

  Highlights.prototype.render = function (data) {
    var self = this;
    var root = this.root;
    var cfg = data && data.config;
    if (cfg) {
      // The merchant's look, applied as the review widget applies it, so the box matches
      // on a page whose review list has not loaded yet or that has none. The config is
      // only adopted for the text when no review widget has set one: the list's own config
      // is for its placement, and it must keep it.
      if (!CONFIG) CONFIG = cfg;
      // The app-wide "show verified badges" switch governs the box too, as it does the cards.
      if (cfg.behaviour && cfg.behaviour.showVerifiedBadge === false) this.showBadge = false;
      applyColors(root, cfg.colors);
      if (cfg.layout) applyMarks(cfg.layout);
      applyCustomCss(cfg.customCss);
    }

    var items = highlightsFrom(data, this.limit);
    if (this.source === 'random') shuffle(items, Math.random);
    if (!items.length) {
      this.hide();
      return;
    }
    // When any slide names another product, every slide keeps that line (blank where it has
    // none), so the box does not change height as it rotates.
    this.anyAbout = false;
    for (var ai = 0; ai < items.length; ai++) {
      if (typeof items[ai].productTitle === 'string' && items[ai].productTitle) this.anyAbout = true;
    }

    // A background picked on the block comes with a text colour that reads on it, the
    // same pairing the review cards get, so a dark box never meets the theme's dark text.
    var bg = root.getAttribute('data-rm-hl-bg');
    if (isHex(bg)) root.style.setProperty('--rm-hl-text', pairedText(bg));

    var n = items.length;
    root.innerHTML = '';
    root.hidden = false;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', t('highlightsLabel'));
    if (n > 1) root.setAttribute('aria-roledescription', 'carousel');

    var track = el('div', 'rm-hl__slides');
    this.track = track;
    this.slides = items.map(function (r, i) {
      var s = self.slide(r, i, n);
      track.appendChild(s);
      return s;
    });
    root.appendChild(track);

    var foot = el('div', 'rm-hl__foot');
    // "Read more" opens the text right here. It used to jump to the review list, which need
    // not contain the review being read: a quote "on Product B" is never in Product A's list,
    // and an older featured review is not on the list's first page. The list keeps its own
    // way in — the "See all reviews" link beside it — when the page has one.
    var more = el('button', 'rm-hl__more', t('readMore'));
    more.type = 'button';
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', function () { self.expand(!root.classList.contains('is-expanded')); });
    this.more = more;
    foot.appendChild(more);
    if (document.getElementById(JUMP)) {
      var all = el('a', 'rm-hl__all', t('seeAll'));
      all.href = '#' + JUMP;
      foot.appendChild(all);
    }
    if (n > 1) foot.appendChild(this.controls(items));
    root.appendChild(foot);

    if (n > 1) this.bind();
    // Whether the text is cut off depends on the width, so check again when it changes.
    window.addEventListener('resize', function () { self.measure(); });
    this.show(0);
    this.cycle();
  };

  Highlights.prototype.slide = function (r, i, n) {
    var s = el('div', 'rm-hl__slide');
    if (n > 1) {
      s.setAttribute('role', 'group');
      s.setAttribute('aria-roledescription', 'slide');
      s.setAttribute('aria-label', t('slideLabel', { index: i + 1, total: n }));
    }

    var head = el('div', 'rm-hl__head');
    if (this.showAvatar) {
      var av = el('span', 'rm-hl__avatar', initial(r.author));
      av.setAttribute('aria-hidden', 'true');
      head.appendChild(av);
    }
    var who = el('div', 'rm-hl__who');
    var line = el('div', 'rm-hl__line');
    line.appendChild(el('span', 'rm-hl__name', r.author));

    // The strict status only, as on the review cards. "Verified" on a review with no
    // matching order is the misrepresentation FTC 16 CFR 465 is about.
    if (this.showBadge && r.verificationStatus === 'verified_buyer') {
      var pill = el('span', 'rm-hl__pill');
      var tick = el('span', 'rm-hl__tick', '✓');
      tick.setAttribute('aria-hidden', 'true');
      pill.appendChild(tick);
      pill.appendChild(document.createTextNode(t('verifiedShort')));
      // Product-neutral on purpose: a store-wide top-up may be about another product.
      pill.title = 'Verified buyer: this reviewer bought from this store';
      line.appendChild(pill);
    }
    // FTC 16 CFR 465.4: the disclosure goes wherever the review goes, and this box is
    // exactly the kind of prominent placement it was written for. No setting turns it off.
    if (r.incentivized) {
      var inc = el('span', 'rm-badge rm-badge--incentive', t('incentivisedBadge'));
      inc.title = t('incentivisedTooltip');
      line.appendChild(inc);
    }
    who.appendChild(line);
    // A review topping up the box from elsewhere in the store says so. Beside Add to cart,
    // a quote about a different product read as a quote about this one.
    if (typeof r.productTitle === 'string' && r.productTitle) {
      who.appendChild(el('span', 'rm-hl__about', t('aboutProduct', { product: r.productTitle })));
    } else if (this.anyAbout) {
      var blank = el('span', 'rm-hl__about', '\u00a0');
      blank.setAttribute('aria-hidden', 'true');
      who.appendChild(blank);
    }
    if (this.showStars) who.appendChild(stars(r.rating, 'rm-hl__stars'));
    head.appendChild(who);
    s.appendChild(head);

    var quote = el('div', 'rm-hl__quote');
    quote.appendChild(el('p', 'rm-hl__text', plainText(r.body || r.title)));
    s.appendChild(quote);
    return s;
  };

  /** ‹ dots › and, when it rotates, a pause button. */
  Highlights.prototype.controls = function (items) {
    var self = this;
    var nav = el('div', 'rm-hl__nav');

    function arrow(label, aria, dir) {
      var b = el('button', 'rm-hl__btn', label);
      b.type = 'button';
      b.setAttribute('aria-label', aria);
      b.addEventListener('click', function () { self.go(self.index + dir); });
      return b;
    }

    nav.appendChild(arrow('‹', t('previousReview'), -1));
    // The dots are a pointer convenience. Keyboard and screen-reader users have the
    // arrows, the arrow keys and each slide's "2 of 6", so the dots stay out of the Tab
    // order and out of the accessibility tree rather than adding six more stops.
    var dots = el('div', 'rm-hl__dots');
    dots.setAttribute('aria-hidden', 'true');
    items.forEach(function (r, i) {
      var d = el('button', 'rm-hl__dot');
      d.type = 'button';
      d.tabIndex = -1;
      d.addEventListener('click', function () { self.go(i); });
      dots.appendChild(d);
      self.dots.push(d);
    });
    nav.appendChild(dots);
    nav.appendChild(arrow('›', t('nextReview'), 1));

    // WCAG 2.2.2: motion that starts by itself needs a way to stop it.
    if (this.rotate && !reducedMotion()) {
      var toggle = el('button', 'rm-hl__btn rm-hl__toggle');
      toggle.type = 'button';
      var label = function () {
        toggle.textContent = self.stopped ? '▶' : '‖';
        toggle.setAttribute('aria-label', t(self.stopped ? 'playRotation' : 'pauseRotation'));
      };
      toggle.addEventListener('click', function () {
        self.stopped = !self.stopped;
        // Asking for rotation with focus still on this button would otherwise do nothing
        // until focus left the box.
        if (!self.stopped) self.focused = false;
        label();
        self.cycle();
      });
      label();
      this.syncToggle = label;
      nav.appendChild(toggle);
    }
    return nav;
  };

  Highlights.prototype.bind = function () {
    var self = this;
    var root = this.root;
    root.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Left' && k !== 'Right') return;
      e.preventDefault();
      self.go(self.index + (k === 'ArrowLeft' || k === 'Left' ? -1 : 1));
    });
    root.addEventListener('mouseenter', function () { self.hover = true; self.cycle(); });
    root.addEventListener('mouseleave', function () { self.hover = false; self.cycle(); });
    root.addEventListener('focusin', function () { self.focused = true; self.cycle(); });
    root.addEventListener('focusout', function (e) {
      if (e.relatedTarget && root.contains(e.relatedTarget)) return;
      self.focused = false;
      self.cycle();
    });
  };

  /** The shopper moved it themselves: show that review, and rotate no further. */
  Highlights.prototype.go = function (i) {
    this.stopped = true;
    this.show(i);
    this.cycle();
    if (this.syncToggle) this.syncToggle();
  };

  Highlights.prototype.show = function (i) {
    var n = this.slides.length;
    if (!n) return;
    i = wrapIndex(i, n);
    this.index = i;
    this.slides.forEach(function (s, k) { s.hidden = k !== i; });
    this.dots.forEach(function (d, k) { d.classList.toggle('is-current', k === i); });
    if (this.root.classList.contains('is-expanded')) this.expand(false);
    this.measure();
  };

  /**
   * "Read more" only when there is more: the text is clamped by CSS, and only the browser
   * knows whether it overflowed. Hidden with visibility rather than removed, so the box
   * keeps its height from one review to the next.
   */
  Highlights.prototype.measure = function () {
    var s = this.slides[this.index];
    var p = s && s.querySelector('.rm-hl__text');
    if (!p || !this.more) return;
    var open = this.root.classList.contains('is-expanded');
    this.more.style.visibility = open || p.scrollHeight > p.clientHeight + 1 ? '' : 'hidden';
  };

  /** Read more in place, for a page with no review list to jump to. */
  Highlights.prototype.expand = function (open) {
    this.root.classList.toggle('is-expanded', open);
    this.more.textContent = t(open ? 'showLess' : 'readMore');
    this.more.setAttribute('aria-expanded', String(open));
    this.cycle();
  };

  /** Start or stop the rotation to match the current state, and say so to screen readers. */
  Highlights.prototype.cycle = function () {
    var self = this;
    var run = this.rotate > 0 && this.slides.length > 1 && !this.stopped && !this.hover &&
      !this.focused && !this.root.classList.contains('is-expanded') && !reducedMotion();
    if (run && !this.timer) {
      this.timer = setInterval(function () {
        // The theme editor replaces a section's markup without telling the old script.
        if (!document.documentElement.contains(self.root)) {
          self.halt();
          return;
        }
        self.show(self.index + 1);
      }, this.rotate * 1000);
    } else if (!run) {
      this.halt();
    }
    // Announce a new review only when a person asked for it. Read out on a timer, it would
    // talk over whatever the shopper is doing every few seconds.
    if (this.track) this.track.setAttribute('aria-live', this.timer ? 'off' : 'polite');
  };

  Highlights.prototype.halt = function () {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  };

  /**
   * The merchant's marks, applied before the review list is fetched.
   *
   * The list is deferred until the block nears the viewport, which is right for the list
   * and wrong for what its payload publishes on the page: the star shape, the badge icon,
   * the font and the colours all travel in it, and the Liquid-only star block under the
   * product title takes them by inheritance from the document root. So on a store that
   * chose the classic star, the stars under the title rendered as tick-stars at load and
   * changed shape only when the shopper scrolled down to the reviews; the font arrived the
   * same way.
   *
   * One small request per page, from the first review widget, against a cached endpoint
   * that returns only those values. Everything applied here is idempotent and the review
   * payload applies the same values again when it arrives, so a failure costs nothing but
   * the early paint: the catch is deliberately empty.
   */
  var lookRequested = false;
  function fetchLook(w) {
    if (lookRequested || !w.appUrl || !w.shop) return;
    lookRequested = true;
    var p = ['shop=' + encodeURIComponent(w.shop)];
    if (w.placement) p.push('placement=' + encodeURIComponent(w.placement));
    fetch(w.appUrl + '/api/storefront/look?' + p.join('&'), { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (look) {
        if (!look) return;
        if (look.layout) applyMarks(look.layout);
        applyColors(w.root, look.colors);
        applyCustomCss(look.customCss);
      })
      .catch(function () {});
  }

  /**
   * Run `load` once, when `node` comes within 400 px of the viewport. Returns a function
   * that runs it straight away instead (still only once), for a shopper who jumps to the
   * reviews before scrolling anywhere near them.
   */
  function lazy(node, load) {
    var done = false;
    var io = null;
    function now() {
      if (done) return;
      done = true;
      if (io) io.disconnect();
      load();
    }
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) now();
        });
      }, { rootMargin: '400px' });
      io.observe(node);
    } else {
      now();
    }
    return now;
  }

  /** The review widgets on the page, so a jump to #reviewmaster-reviews can find its own. */
  var WIDGETS = [];

  function widgetFor(node) {
    for (var i = 0; i < WIDGETS.length; i++) {
      if (WIDGETS[i].root === node) return WIDGETS[i];
    }
    return null;
  }

  function init() {
    // Forget widgets whose block the theme editor has since replaced.
    WIDGETS = WIDGETS.filter(function (w) { return document.documentElement.contains(w.root); });
    var nodes = document.querySelectorAll('[data-rm-widget]');
    if (!nodes.length) return;

    Array.prototype.forEach.call(nodes, function (node) {
      if (node.dataset.rmInit) return;
      node.dataset.rmInit = '1';
      var w = new Widget(node);
      WIDGETS.push(w);

      // The marks first, ahead of the observer gate below. See fetchLook.
      fetchLook(w);

      // Defer the fetch until the widget approaches the viewport. On a product page the
      // review list is nearly always below the fold, so loading it during initial page
      // load costs the shopper time for something they may never scroll to.
      w.loadNow = lazy(node, function () { w.load(); });
    });
  }

  /**
   * Same deferred-load treatment for the Q&A block.
   *
   * A separate pass rather than a shared selector: the two widgets have different roots,
   * different data attributes and different lifecycles, and merging them behind one
   * querySelectorAll would mean every Q&A block constructing a review Widget that finds
   * none of the elements it expects.
   */
  function initQuestions() {
    var nodes = document.querySelectorAll('[data-rm-questions]');
    if (!nodes.length) return;

    Array.prototype.forEach.call(nodes, function (node) {
      if (node.dataset.rmInit) return;
      node.dataset.rmInit = '1';
      var w = new QuestionsWidget(node);
      lazy(node, function () { w.load(); });
    });
  }

  /**
   * The highlights box, deferred like the others. It usually sits beside Add to cart, near
   * the top, so in practice the observer fires at once; on a long description page it
   * still waits. It asks for the merchant's marks too when it is the first block to run,
   * since the star block under the title takes them from the page.
   */
  function initHighlights() {
    var nodes = document.querySelectorAll('[data-rm-highlights]');
    Array.prototype.forEach.call(nodes, function (node) {
      if (node.dataset.rmInit) return;
      node.dataset.rmInit = '1';
      var h = new Highlights(node);
      fetchLook(h);
      lazy(node, function () { h.load(); });
    });
  }

  /** Reveal the review widget the jump links point at. False when the page has none. */
  function revealReviews() {
    var node = document.getElementById(JUMP);
    if (!node) return false;
    // Hidden (a closed accordion, an inactive tab, hidden at this width) and not an overlay:
    // its box is all zeros, so any scroll lands 80 px above wherever the shopper was. The
    // browser's own jump, or the theme's tab script, is the better answer — every route
    // in (click, hash change, page load) comes through here, so the check lives here.
    if (!node.getClientRects().length && !node.querySelector('.rm-panel')) return false;
    var w = widgetFor(node);
    if (w) w.reveal();
    else scrollToNode(node);
    return true;
  }

  /**
   * Same-page links to #reviewmaster-reviews: the star block's count and "be the first",
   * the highlights box's "Read more", and any the merchant added. Only a bare hash is
   * handled; a link carrying a path (the star block on a collection or home page) is a
   * different page, and navigating there is right. One listener on the document, so the
   * Liquid-only star block needs no script of its own.
   */
  function onJumpClick(e) {
    if (e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.getAttribute('href') !== '#' + JUMP) return;
    var node = document.getElementById(JUMP);
    if (!node) return;
    // A star block showing another product than this page's reviews (a featured product
    // section on a product page) goes to that product's own reviews instead — decided
    // before anything else, since it is about where to go, not how to get there here.
    var holder = a.closest('[data-rm-product]');
    var mine = holder ? holder.getAttribute('data-rm-product') : '';
    var theirs = node.getAttribute('data-rm-product') || '';
    var other = a.getAttribute('data-rm-product-url');
    if (mine && theirs && mine !== theirs && other) {
      e.preventDefault();
      window.location.href = other + '#' + JUMP;
      return;
    }
    // Hidden (a closed accordion, an inactive tab, hidden on mobile): left to the browser's
    // own anchor jump, and to a theme that opens its tab on hash change. An overlay layout
    // keeps its panel in the root and is opened instead, so it stays ours.
    if (!node.getClientRects().length && !node.querySelector('.rm-panel')) return;
    e.preventDefault();
    revealReviews();
  }

  // Whether the shopper has started moving around the page themselves. A page opened at
  // #reviewmaster-reviews lands again once images above have loaded and pushed the
  // reviews down, but never once they have taken over.
  var moved = false;
  var urlHandled = false;

  /**
   * A page opened at #reviewmaster-reviews: from the star count on a collection page, or a
   * review link in Google Shopping. The browser's own jump cannot fetch the list or open an
   * overlay panel; this does both, and lands again once the page has finished loading.
   */
  function revealFromUrl() {
    if (urlHandled || window.location.hash !== '#' + JUMP || !document.getElementById(JUMP)) return;
    urlHandled = true;
    revealReviews();
    if (document.readyState !== 'complete') {
      window.addEventListener('load', function () { if (!moved) revealReviews(); });
    }
  }

  document.addEventListener('click', onJumpClick);
  // A full-path link to this same page (the browser treats it as a hash change) or a
  // script setting location.hash.
  window.addEventListener('hashchange', function () {
    if (window.location.hash === '#' + JUMP) revealReviews();
  });
  ['wheel', 'touchstart', 'keydown'].forEach(function (type) {
    window.addEventListener(type, function () { moved = true; }, { passive: true, once: true });
  });

  function boot() { init(); initQuestions(); initHighlights(); revealFromUrl(); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Theme editor: re-init when a merchant drops either block in, so the preview is live.
  document.addEventListener('shopify:section:load', boot);
})();
