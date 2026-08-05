'use client';

import React from 'react';
import {
  Star, Store, Globe, ShieldCheck, Camera, Mail, Gift, Sparkles,
  BadgeCheck, Zap, TrendingUp, Quote, ArrowRight,
} from 'lucide-react';
import { ActionButton, Stars, Pill } from './ui-kit';

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
    title: 'Automatic review requests',
    body: 'Sends after fulfilment, on your schedule, with reminders that stop the moment someone reviews.',
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

export default function WelcomeScreen({
  shopInput,
  onShopInput,
  onInstall,
  error,
}: {
  shopInput: string;
  onShopInput: (v: string) => void;
  onInstall: () => void;
  error?: string;
}) {
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

            <Pill tone="brand" icon={Sparkles} className="mb-5">
              Built for Shopify · 2026 API
            </Pill>

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
              <label
                htmlFor="shop-domain"
                className="mb-2 block text-[12.5px] font-semibold text-ink-600 dark:text-ink-300"
              >
                Your Shopify store
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Globe className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
                  <input
                    id="shop-domain"
                    value={shopInput}
                    onChange={(e) => onShopInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onInstall()}
                    placeholder="your-store.myshopify.com"
                    autoComplete="url"
                    className="surface ring-focus h-12 w-full rounded-xl pl-10 pr-3 text-[14px] text-ink-900 placeholder:text-ink-400 dark:text-white"
                  />
                </div>
                <ActionButton size="lg" icon={Store} onClick={onInstall} className="h-12 px-6">
                  Install
                </ActionButton>
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

        {/* ── Why it converts ── */}
        <div className="surface-hero mt-20 overflow-hidden rounded-3xl">
          <div className="grid gap-0 md:grid-cols-3">
            {[
              { stat: '93%', label: 'of shoppers read reviews before buying', tone: 'text-brand-600' },
              { stat: '2.4×', label: 'more likely to convert with photo reviews', tone: 'text-indigo-600' },
              { stat: '5 min', label: 'from install to your first request sent', tone: 'text-amber-600' },
            ].map((s, i) => (
              <div
                key={s.label}
                className={`px-8 py-9 text-center ${i < 2 ? 'md:border-r md:border-border' : ''}`}
              >
                <p className={`display text-[40px] font-bold ${s.tone}`}>{s.stat}</p>
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

      {/* Floating callout — the automation, which is the thing that actually
          differentiates this from a widget library. */}
      <div
        className="surface-float animate-float absolute -bottom-8 -left-10 w-56 rounded-2xl p-3.5"
        style={{ animationDelay: '1.2s' }}
      >
        <div className="flex items-center gap-2.5">
          <span className="tile tile-amber size-9">
            <Mail className="size-4" strokeWidth={2.3} />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-ink-900 dark:text-white">Request sent</p>
            <p className="truncate text-[11px] text-ink-500">14 days after delivery</p>
          </div>
        </div>
      </div>
    </div>
  );
}
