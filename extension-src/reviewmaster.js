/**
 * ReviewMaster storefront widget.
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
    seeAll: 'See all reviews', close: 'Close'
  };

  /** Layouts that live in an overlay rather than inline in the page flow. */
  var OVERLAY = { floating: 1, popup: 1, sidebar: 1 };

  /** Layouts that show only the summary \u2014 no list, no pagination, no form. */
  var SUMMARY_ONLY = { badge: 1 };

  function t(key, vars) {
    var text = (CONFIG && CONFIG.text && CONFIG.text[key]) || FALLBACK[key] || '';
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
    Object.keys(map).forEach(function (k) {
      var v = colors[k];
      if (typeof v !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(v)) return;

      if (!root.style.getPropertyValue(map[k])) root.style.setProperty(map[k], v);

      // Also publish to the document root, so blocks that never fetch anything pick these
      // up by inheritance. The standalone star-rating block is pure Liquid with no network
      // call — deliberately, it is a few hundred bytes on a collection page — so without
      // this it could never honour a colour set in the app. An inline value on that block
      // still wins locally, which is what a merchant who set it there expects.
      if (!document.documentElement.style.getPropertyValue(map[k])) {
        document.documentElement.style.setProperty(map[k], v);
      }
    });
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
    this.bindForm();
  }

  Widget.prototype.url = function () {
    var p = ['shop=' + encodeURIComponent(this.shop), 'page=' + this.page];
    if (this.perPage) p.push('limit=' + this.perPage);
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
    this.applyText();
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
    items.forEach(function (r) { list.appendChild(self.card(r)); });
    list.style.minHeight = '0';

    if (this.histEl && data.aggregate && data.aggregate.count) this.renderHistogram(data.aggregate);
    if (this.filtersEl) this.renderFilters();

    if (this.layout === 'carousel') {
      // A carousel scrolls; it does not paginate. Two competing ways to move through the
      // same reviews is a worse experience than either alone.
      this.buildCarousel();
    } else if (this.layout === 'testimonial') {
      if (this.pagEl) this.pagEl.hidden = true;
    } else {
      this.renderPagination(data.total);
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
      row.appendChild(el('span', 'rm-hist__label', s + '★'));
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
      // the product page.
      var top = self.root.getBoundingClientRect().top + window.pageYOffset - 80;
      window.scrollTo({ top: top, behavior: 'smooth' });
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

  function init() {
    var nodes = document.querySelectorAll('[data-rm-widget]');
    if (!nodes.length) return;

    Array.prototype.forEach.call(nodes, function (node) {
      if (node.dataset.rmInit) return;
      node.dataset.rmInit = '1';
      var w = new Widget(node);

      // Defer the fetch until the widget approaches the viewport. On a product page the
      // review list is nearly always below the fold, so loading it during initial page
      // load costs the shopper time for something they may never scroll to.
      if ('IntersectionObserver' in window) {
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) { io.disconnect(); w.load(); }
          });
        }, { rootMargin: '400px' });
        io.observe(node);
      } else {
        w.load();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Theme editor: re-init when a merchant drops the block in, so the preview is live.
  document.addEventListener('shopify:section:load', init);
})();
