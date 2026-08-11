'use client';

import React from 'react';
import {
  Star, Store, ShieldCheck, Camera, Mail, Gift,
  BadgeCheck, Zap, TrendingUp, Quote, ArrowRight, Clock, ChevronDown,
} from 'lucide-react';
import { Stars, Pill } from './ui-kit';

/**
 * The install screen.
 *
 * This is a sales page, not a form. A merchant reaching it has ReviewMaster open
 * in one tab and Judge.me in another, and the decision between them is made on
 * this screen in a few seconds — before a single feature has been used. The old
 * version was a centred input box with four grey feature rows, which reads as a
 * side project regardless of what the app can actually do.
 *
 * So: a real hero, a rendered product mock in perspective, the proof points that
 * matter to this buyer (verified reviews, photo reviews, automatic requests), and
 * the legal footer Shopify expects. Everything here is true of the app as built —
 * nothing claims a feature that does not ship.
 */

const FEATURES = [
  {
    icon: Mail,
    tone: 'tile-brand',
    title: 'Review requests, on your timing',
    body: 'You choose how long after fulfilment to ask — same day, two weeks, two months — and how many reminders follow. They stop the moment someone reviews.',
  },
  {
    icon: Camera,
    tone: 'tile-indigo',
    title: 'Photo & video reviews',
    body: 'Shoppers attach media straight from the email. Stored in your own Shopify Files, not ours.',
  },
  {
    icon: BadgeCheck,
    tone: 'tile-cyan',
    title: 'Verified buyer badges',
    body: 'Reviews tied to a real paid order carry a badge that is actually earned — never applied by default.',
  },
  {
    icon: Gift,
    tone: 'tile-amber',
    title: 'Compliant incentives',
    body: 'Reward a review with a discount code. Never tied to what the review says — FTC-safe by construction.',
  },
  {
    icon: Zap,
    tone: 'tile-violet',
    title: 'Import from anywhere',
    body: 'AliExpress listings, Etsy shops and CSV files, mapped to your products and deduplicated.',
  },
  {
    icon: TrendingUp,
    tone: 'tile-rose',
    title: 'Rich snippets & Shop sync',
    body: 'Star ratings in Google results and in the Shop app, kept in step with what you publish.',
  },
] as const;

/**
 * Where a merchant installs from.
 *
 * This screen used to ask them to type their `.myshopify.com` domain into a box and
 * built an OAuth URL from it. That is prohibited outright — App Store requirement 2.3.1:
 * "Your app must not request the manual entry of a myshopify.com URL or a shop's domain
 * during the installation or configuration flow."
 *
 * The reason behind the rule is worth keeping in mind rather than just complying with:
 * a text box that accepts a shop domain and redirects to an OAuth consent screen is the
 * exact shape of a phishing flow, and it trains merchants to type their store address
 * into whatever page asks. Installs begin on Shopify's side, always, so the only correct
 * control here is a link to the listing.
 *
 * It also matters that this screen is reachable by accident: it renders whenever
 * `/api/store` returns 401, which includes a transient auth failure inside the embedded
 * iframe. Hence the reload affordance — a merchant who lands here mid-session is one
 * click from where they were, rather than being asked to re-install.
 */
const APP_STORE_LISTING = 'https://apps.shopify.com/reviewmaster';

export default function WelcomeScreen({ error }: { error?: string }) {
  return (
    <div className="aurora min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-6 py-14 lg:py-20">
        {/* ── Hero ── */}
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="animate-rise">
            <div className="mb-6 flex items-center gap-2.5">
              <span className="tile tile-brand size-10">
                <Star className="size-5" fill="currentColor" strokeWidth={0} />
              </span>
              <span className="text-[17px] font-bold tracking-tight text-ink-900 dark:text-white">
                ReviewMaster
              </span>
            </div>

            {/* No "Built for Shopify" pill here. That is a designation Shopify grants
                after a certification review and displays itself — an app asserting it in
                its own UI is claiming a status it has not been given, which reviewers
                treat as a branding violation. */}

            <h1 className="display text-[44px] font-bold text-ink-900 dark:text-white sm:text-[52px]">
              Turn happy customers
              <br />
              into <span className="text-gradient">your best sales team.</span>
            </h1>

            <p className="mt-5 max-w-lg text-[15.5px] leading-relaxed text-ink-500">
              Collect verified reviews automatically after every order, show them off in
              widgets that match your theme, and let real photos do the selling. Everything
              runs on your store — your files, your customers, your data.
            </p>

            {/* ── Install ── */}
            <div className="mt-8 max-w-md">
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={APP_STORE_LISTING}
                  target="_blank"
                  rel="noopener"
                  className="brand-fill ring-focus inline-flex h-12 items-center gap-2 rounded-xl px-6 text-[14.5px] font-semibold"
                >
                  <Store className="size-4.5" strokeWidth={2.2} />
                  Install from the Shopify App Store
                </a>
                {/* For the merchant who landed here because their session lapsed, not
                    because they need to install. Reloading inside the admin re-runs the
                    session-token handshake and puts them straight back. */}
                <button
                  onClick={() => window.location.reload()}
                  className="ring-focus surface inline-flex h-12 items-center gap-2 rounded-xl px-4 text-[13.5px] font-semibold text-ink-600 transition-colors hover:border-ink-300 hover:text-ink-900 dark:text-ink-300 dark:hover:text-white"
                >
                  Already installed? Reload
                </button>
              </div>

              {error && (
                <p className="mt-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-[12.5px] font-medium text-rose-700 ring-1 ring-inset ring-rose-600/15 dark:bg-rose-500/10 dark:text-rose-300">
                  {error}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-500">
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5 text-brand-600" />
                  Free plan, no card
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Zap className="size-3.5 text-brand-600" />
                  Installs in under a minute
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <BadgeCheck className="size-3.5 text-brand-600" />
                  GDPR &amp; CCPA ready
                </span>
              </div>
            </div>
          </div>

          {/* ── Product mock, in perspective ── */}
          <div className="scene hidden lg:block">
            <HeroMock />
          </div>
        </div>

        {/* ── Features ── */}
        <div className="mt-24">
          <div className="mb-9 text-center">
            <h2 className="display text-[32px] font-bold text-ink-900 dark:text-white">
              Everything you need to sell with proof
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-[14.5px] leading-relaxed text-ink-500">
              Not a feature list bolted together — one pipeline, from the order being
              fulfilled to the star rating Google shows in search.
            </p>
          </div>

          <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="surface-raised lift group rounded-2xl p-5"
              >
                <span className={`tile size-11 ${f.tone}`}>
                  <f.icon className="size-5" strokeWidth={2.2} />
                </span>
                <h3 className="mt-4 text-[14.5px] font-semibold text-ink-900 dark:text-white">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">{f.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── What you get, and what we do not take ──
            This block used to read "93% of shoppers read reviews before buying",
            "2.4x more likely to convert with photo reviews", "5 min from install to your
            first request". Three confident figures with no source behind any of them —
            the first two are industry statistics we cannot substantiate, and the third
            was invented. Unsubstantiated performance claims are a listing violation, and
            more to the point a merchant who checks one and finds nothing behind it has
            learned something true about how carefully the rest was written.
            Replaced with commitments about this app that are verifiable from the code. */}
        <div className="surface-hero mt-20 overflow-hidden rounded-3xl">
          <div className="grid gap-0 md:grid-cols-3">
            {[
              {
                stat: 'Your files',
                label: 'Review photos and video are stored in your own Shopify Files, never ours — and stay with you if you uninstall.',
                tone: 'text-brand-600',
              },
              {
                stat: 'Every review',
                label: 'Ratings are never filtered by score. Hiding low ratings breaks Google\u2019s policy and the FTC rule, so the app cannot do it.',
                tone: 'text-indigo-600',
              },
              {
                stat: 'No card',
                label: 'The free plan covers 100 review request emails a month and unlimited reviews. Upgrade only when you outgrow it.',
                tone: 'text-amber-600',
              },
            ].map((s, i) => (
              <div
                key={s.stat}
                className={`px-8 py-9 text-center ${i < 2 ? 'md:border-r md:border-border' : ''}`}
              >
                <p className={`display text-[28px] font-bold ${s.tone}`}>{s.stat}</p>
                <p className="mt-2 text-[13px] leading-snug text-ink-500">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Footer ── */}
        <p className="mt-14 text-center text-[12px] text-ink-400">
          By installing, you agree to our{' '}
          <a href="/terms" className="font-medium underline underline-offset-2 hover:text-ink-600">
            Terms of Service
          </a>
          ,{' '}
          <a href="/privacy" className="font-medium underline underline-offset-2 hover:text-ink-600">
            Privacy Policy
          </a>{' '}
          and{' '}
          <a href="/dpa" className="font-medium underline underline-offset-2 hover:text-ink-600">
            Data Processing Agreement
          </a>
          .
        </p>
      </div>
    </div>
  );
}

/**
 * A miniature of the widget a shopper actually sees, rotated in 3D.
 *
 * Deliberately built from real markup rather than a screenshot: it stays sharp at
 * any size, it costs no image weight, and it can never drift out of date with the
 * product the way a PNG in a repo always eventually does.
 */
function HeroMock() {
  return (
    <div className="tilt relative">
      {/* Depth stack: two ghost panels behind the real card. */}
      <div className="surface absolute -right-6 -top-6 h-full w-full rounded-3xl opacity-40" />
      <div className="surface absolute -right-3 -top-3 h-full w-full rounded-3xl opacity-70" />

      <div className="surface-hero relative overflow-hidden rounded-3xl">
        <div className="grid-lines absolute inset-0 opacity-60" />

        {/* Summary header */}
        <div className="relative border-b border-border px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] font-medium text-ink-500">Customer reviews</p>
              <div className="mt-1.5 flex items-center gap-2.5">
                <span className="display text-[34px] font-bold text-ink-900 dark:text-white">4.8</span>
                <div>
                  <Stars rating={4.8} size={15} />
                  <p className="mt-0.5 text-[11.5px] text-ink-400">based on 1,284 reviews</p>
                </div>
              </div>
            </div>
            <span className="tile tile-brand size-11">
              <Star className="size-5" fill="currentColor" strokeWidth={0} />
            </span>
          </div>

          <div className="mt-4 space-y-1.5">
            {[
              { s: 5, pct: 86 },
              { s: 4, pct: 9 },
              { s: 3, pct: 3 },
            ].map((r) => (
              <div key={r.s} className="flex items-center gap-2.5">
                <span className="tnum w-3 text-[11px] font-medium text-ink-500">{r.s}</span>
                <Star className="size-3 text-amber-400" fill="currentColor" strokeWidth={0} />
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-white/10">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${r.pct}%`,
                      backgroundImage: 'linear-gradient(90deg, #fbbf24, #f59e0b)',
                    }}
                  />
                </div>
                <span className="tnum w-8 text-right text-[11px] text-ink-400">{r.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* A review, with media */}
        <div className="relative px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-[13px] font-bold text-white shadow-[var(--glow-brand)]">
              M
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] font-semibold text-ink-900 dark:text-white">Maya R.</span>
                <Pill tone="brand" icon={BadgeCheck}>Verified buyer</Pill>
              </div>
              <div className="mt-1">
                <Stars rating={5} size={13} />
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-600 dark:text-ink-300">
                <Quote className="mr-1 inline size-3 -translate-y-0.5 text-ink-300" />
                Exactly as pictured and the finish is beautiful. Second one I&apos;ve bought.
              </p>

              <div className="mt-3 flex gap-2">
                {[
                  'linear-gradient(140deg,#a7f3d4,#059468)',
                  'linear-gradient(140deg,#bfdbfe,#4f46e5)',
                  'linear-gradient(140deg,#fde68a,#d97706)',
                ].map((bg, i) => (
                  <div
                    key={i}
                    className="size-14 rounded-xl ring-1 ring-inset ring-black/5"
                    style={{
                      backgroundImage: bg,
                      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.4), 0 2px 8px -3px rgba(11,18,32,.25)',
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer bar */}
        <div className="relative flex items-center justify-between border-t border-border bg-ink-50/60 px-6 py-3 dark:bg-white/[0.02]">
          <span className="text-[11.5px] font-medium text-ink-500">Powered by ReviewMaster</span>
          <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-700 dark:text-brand-400">
            Write a review
            <ArrowRight className="size-3" />
          </span>
        </div>
      </div>

      {/* Floating callout.
          Drawn as a CONTROL rather than a status line. "14 days after delivery" stated a
          default as though it were a fixed behaviour — which undersold the actual feature,
          because the timing is the merchant's to set anywhere from same-day to two months.
          A number in a field says "you decide" in a way no sentence does. */}
      <div
        className="surface-float animate-float absolute -bottom-8 -left-10 w-60 rounded-2xl p-3.5"
        style={{ animationDelay: '1.2s' }}
      >
        <div className="flex items-center gap-2.5">
          <span className="tile tile-amber size-9">
            <Mail className="size-4" strokeWidth={2.3} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-ink-900 dark:text-white">
              Ask for a review
            </p>
            <p className="text-[11px] text-ink-500">after an order is fulfilled</p>
          </div>
        </div>
        <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-ink-50 px-2.5 py-1.5 dark:bg-white/5">
          <Clock className="size-3.5 shrink-0 text-ink-400" />
          <span className="text-[11px] text-ink-500">Wait</span>
          <span className="surface flex items-center gap-1 rounded-md px-1.5 py-0.5">
            <span className="tnum text-[11.5px] font-bold text-ink-900 dark:text-white">14</span>
            <span className="text-[10.5px] text-ink-400">days</span>
            <ChevronDown className="size-3 text-ink-400" />
          </span>
          <span className="text-[10.5px] text-ink-400">your call</span>
        </div>
      </div>
    </div>
  );
}
