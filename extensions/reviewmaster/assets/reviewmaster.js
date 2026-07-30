/* ReviewMaster storefront widget. Generated from extension-src/reviewmaster.js
   by scripts/build-extension.mjs — edit the source, not this file. */


(function () {
  'use strict';

  var CACHE = {};



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


  var OVERLAY = { floating: 1, popup: 1, sidebar: 1 };


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






      if (!document.documentElement.style.getPropertyValue(map[k])) {
        document.documentElement.style.setProperty(map[k], v);
      }
    });
  }



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






    this.perPage = 0;
    this.sort = '';


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






        if (self.listEl) self.listEl.innerHTML = '';
      });
  };



  Widget.prototype.applyConfig = function (data) {
    if (!data || !data.config) return;
    CONFIG = data.config;




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



    if (!list) {
      if (this.histEl && data.aggregate && data.aggregate.count) this.renderHistogram(data.aggregate);
      return;
    }

    list.innerHTML = '';

    if (!data.reviews || !data.reviews.length) {



      if (this.rating || this.mediaOnly) {
        list.appendChild(el('p', 'rm-empty', t('noMatchFilter')));
      }


      list.style.minHeight = '0';
      if (this.pagEl) this.pagEl.hidden = true;
      return;
    }



    var items = this.layout === 'testimonial' ? data.reviews.slice(0, 1) : data.reviews;
    items.forEach(function (r) { list.appendChild(self.card(r)); });
    list.style.minHeight = '0';

    if (this.histEl && data.aggregate && data.aggregate.count) this.renderHistogram(data.aggregate);
    if (this.filtersEl) this.renderFilters();

    if (this.layout === 'carousel') {


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




    if (r.verified && behaviour('showVerifiedBadge', true)) {
      var b = el('span', 'rm-badge rm-badge--verified', t('verifiedBadge'));
      b.title = 'This reviewer bought this product from this store';
      who.appendChild(b);
    }



    if (r.incentivized) {
      var inc = el('span', 'rm-badge rm-badge--incentive', t('incentivisedBadge'));
      inc.title = t('incentivisedTooltip');
      who.appendChild(inc);
    }




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

        img.width = 96; img.height = 96;
        img.alt = 'Customer photo';
        btn.appendChild(img);
        btn.addEventListener('click', function () { openLightbox(src, 'image'); });
        media.appendChild(btn);
      });

      if (r.video) {



        var vbtn = el('button', 'rm-thumb rm-thumb--video');
        vbtn.type = 'button';
        vbtn.setAttribute('aria-label', 'Play video review from ' + r.author);
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



    var info = el('div', 'rm-pagination__info',
      t('showingCount', { first: first, last: last, total: total }));
    p.appendChild(info);

    var nav = el('nav', 'rm-pagination__nav');
    nav.setAttribute('aria-label', 'Reviews pagination');

    function go(page) {
      self.page = page;
      self.load();



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


        if (list.scrollLeft + list.clientWidth >= list.scrollWidth - 4) {
          clearInterval(timer);
          return;
        }
        step(1);
      }, 5000);


      ['pointerdown', 'keydown', 'wheel'].forEach(function (evt) {
        self.root.addEventListener(evt, function () { clearInterval(timer); }, { once: true });
      });
    }
  };



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


    if (behaviour('showWriteButton', true) === false) {
      var btn = root.querySelector('[data-rm-open-form]');
      if (btn) btn.hidden = true;
    }
    if (behaviour('showHistogram', true) === false && this.histEl) this.histEl.hidden = true;
    if (behaviour('showFilters', true) === false && this.filtersEl) this.filtersEl.hidden = true;




    var fileField = root.querySelector('[data-rm-file]');
    if (fileField && !behaviour('allowPhotos', true) && !behaviour('allowVideo', true)) {
      var fieldWrap = fileField.closest('.rm-form__field');
      if (fieldWrap) fieldWrap.remove();
    } else if (fileField) {


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





          var published = !!(res.j && res.j.published);
          var msg = t(published ? 'thankYouPublished' : 'thankYou') || (res.j && res.j.message);
          if (res.j && res.j.warning) msg += ' ' + res.j.warning;
          self.showNotice(msg);

          if (published) {


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


  document.addEventListener('shopify:section:load', init);
})();
