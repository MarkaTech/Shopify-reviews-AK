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

  function Widget(root) {
    this.root = root;
    this.shop = root.dataset.rmShop;
    this.productId = root.dataset.rmProduct;
    this.appUrl = (root.dataset.rmAppUrl || '').replace(/\/$/, '');
    this.perPage = parseInt(root.dataset.rmPerPage, 10) || 10;
    this.sort = root.dataset.rmSort || 'recent';
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
    var p = ['shop=' + encodeURIComponent(this.shop), 'page=' + this.page,
             'limit=' + this.perPage, 'sort=' + encodeURIComponent(this.sort)];
    if (this.productId) p.push('product_id=' + encodeURIComponent(this.productId));
    if (this.rating) p.push('rating=' + this.rating);
    if (this.mediaOnly) p.push('media=1');
    return this.appUrl + '/api/storefront/reviews?' + p.join('&');
  };

  Widget.prototype.load = function () {
    var self = this;
    var url = this.url();

    // Cache per query. Shoppers flip between filters and pages repeatedly; re-fetching an
    // identical query is latency the shopper feels for no new information.
    if (CACHE[url]) { this.render(CACHE[url]); return; }

    fetch(url, { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        CACHE[url] = data;
        self.render(data);
      })
      .catch(function () {
        // Fail quietly. A broken review widget must never break the product page, and a
        // shopper cannot act on a fetch error. The server-rendered star rating from the
        // metafields is still visible above.
        self.listEl.innerHTML = '';
      });
  };

  Widget.prototype.render = function (data) {
    var self = this;
    var list = this.listEl;
    list.innerHTML = '';

    if (!data.reviews || !data.reviews.length) {
      list.appendChild(el('p', 'rm-empty', this.rating || this.mediaOnly
        ? 'No reviews match that filter.'
        : 'No reviews yet.'));
      // Release the reserved height once we know the real content is empty, so an
      // unreviewed product does not carry 400px of blank space forever.
      list.style.minHeight = '0';
      if (this.pagEl) this.pagEl.hidden = true;
      return;
    }

    data.reviews.forEach(function (r) { list.appendChild(self.card(r)); });
    list.style.minHeight = '0';

    if (this.histEl && data.aggregate && data.aggregate.count) this.renderHistogram(data.aggregate);
    if (this.filtersEl) this.renderFilters();
    this.renderPagination(data.total);
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
    if (r.verified) {
      var b = el('span', 'rm-badge rm-badge--verified', 'Verified Purchase');
      b.title = 'This reviewer bought this product from this store';
      who.appendChild(b);
    }

    // FTC 16 CFR 465.4 requires incentivised reviews to be disclosed. Not a tooltip, not
    // a footnote — visible next to the review itself.
    if (r.incentivized) {
      var inc = el('span', 'rm-badge rm-badge--incentive', 'Incentivised');
      inc.title = 'This reviewer received a discount in exchange for an honest review';
      who.appendChild(inc);
    }

    if (r.location) who.appendChild(el('span', 'rm-review__loc', r.location));
    head.appendChild(who);
    head.appendChild(el('time', 'rm-review__date', fmtDate(r.date)));
    card.appendChild(head);

    if (r.title) card.appendChild(el('h4', 'rm-review__title', r.title));
    card.appendChild(el('p', 'rm-review__body', r.body));

    if (r.images && r.images.length) {
      var media = el('div', 'rm-review__media');
      r.images.slice(0, 6).forEach(function (src) {
        var img = el('img');
        img.src = src;
        img.loading = 'lazy';
        img.decoding = 'async';
        // Explicit dimensions so images do not shift the layout as they decode.
        img.width = 96; img.height = 96;
        img.alt = 'Customer photo';
        media.appendChild(img);
      });
      card.appendChild(media);
    }

    if (r.reply) {
      var reply = el('div', 'rm-review__reply');
      reply.appendChild(el('strong', null, 'Store response'));
      reply.appendChild(el('p', null, r.reply));
      card.appendChild(reply);
    }

    return card;
  };

  Widget.prototype.renderHistogram = function (agg) {
    var self = this;
    var h = this.histEl;
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
    if (f.dataset.rmBuilt) return;
    f.dataset.rmBuilt = '1';
    f.hidden = false;

    var sel = el('select', 'rm-filters__sort');
    [['recent', 'Most recent'], ['highest', 'Highest rating'],
     ['lowest', 'Lowest rating'], ['helpful', 'Most helpful']].forEach(function (o) {
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

    var media = el('button', 'rm-filters__media', 'With photos');
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
    if (pages <= 1) { p.hidden = true; return; }
    p.hidden = false;

    function btn(label, page, disabled) {
      var b = el('button', 'rm-page', label);
      b.type = 'button';
      b.disabled = !!disabled;
      b.addEventListener('click', function () {
        self.page = page;
        self.load();
        self.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return b;
    }

    p.appendChild(btn('‹', this.page - 1, this.page <= 1));
    p.appendChild(el('span', 'rm-page__info', this.page + ' / ' + pages));
    p.appendChild(btn('›', this.page + 1, this.page >= pages));
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

      status.textContent = 'Submitting…';
      fetch(self.appUrl + '/api/storefront/submit', { method: 'POST', body: fd })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) throw new Error(res.j && res.j.error);
          form.reset();
          chosen = 0;
          status.textContent = 'Thank you. Your review has been submitted for approval.';
        })
        .catch(function (err) {
          status.textContent = (err && err.message) || 'Could not submit your review.';
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
