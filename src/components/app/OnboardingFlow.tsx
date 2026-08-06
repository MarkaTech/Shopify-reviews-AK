'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  ShoppingBag, MessageSquarePlus, Palette, Mail, CheckCircle2, Gift,
  Check, X, ArrowRight, ChevronRight, Sparkles, Star, BadgeCheck, Clock, Zap,
  type LucideIcon,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { ActionButton, Pill, type TileTone, TILE_TONE } from './ui-kit';
import type { PageId } from './Sidebar';

/**
 * First-run setup.
 *
 * This is the screen that decides whether a merchant keeps the app. They installed thirty
 * seconds ago on the strength of an App Store listing, the dashboard behind this is all
 * zeroes, and nothing about an empty store tells them whether the product is any good.
 *
 * The previous version was a row of checkbox rows above the stats — accurate, and it read
 * as a chore list from a utility. This one is built to do three things instead:
 *
 *   1. **Show the destination before asking for work.** The panel on the right is what
 *      their product page looks like when this is finished. Nobody completes a setup
 *      flow for an outcome they cannot picture.
 *   2. **Make one action obvious.** A single primary CTA for the next incomplete step,
 *      with the rest available but visibly secondary. Five equal buttons is five decisions.
 *   3. **Look like software worth $12/month.** Serif headline, real depth, generous space.
 *      The merchant is comparing this to Judge.me in another tab.
 *
 * Progress is derived server-side from real data (/api/onboarding), so a step cannot tick
 * without the underlying thing existing.
 */

interface StepMeta {
  id: string;
  title: string;
  body: string;
  cta: string;
  icon: LucideIcon;
  tone: TileTone;
  page: PageId;
  minutes: number;
  optional?: boolean;
}

const STEPS: StepMeta[] = [
  {
    id: 'products',
    title: 'Sync your products',
    body: 'Runs automatically at install, so reviews attach to the right product.',
    cta: 'View products',
    icon: ShoppingBag,
    tone: 'cyan',
    page: 'products',
    minutes: 0,
  },
  {
    id: 'reviews',
    title: 'Bring in your first reviews',
    body: 'Import what you already have from AliExpress, Etsy or a CSV — your product pages stop looking empty in about two minutes.',
    cta: 'Import reviews',
    icon: MessageSquarePlus,
    tone: 'brand',
    page: 'bulk-upload',
    minutes: 2,
  },
  {
    id: 'widget',
    title: 'Match the widget to your theme',
    body: 'Pick a layout and your brand colours, then drop it onto your product page.',
    cta: 'Design widget',
    icon: Palette,
    tone: 'indigo',
    page: 'widgets',
    minutes: 3,
  },
  {
    id: 'requests',
    title: 'Choose when to ask',
    body: 'You set how long after fulfilment the email goes out — same day, two weeks, two months — plus how many reminders follow. They stop the moment someone reviews.',
    cta: 'Set timing',
    icon: Mail,
    tone: 'amber',
    page: 'settings',
    minutes: 1,
  },
  {
    id: 'publish',
    title: 'Publish your first review',
    body: 'Nothing reaches your storefront until you approve it. Approve one to go live.',
    cta: 'Open moderation',
    icon: CheckCircle2,
    tone: 'violet',
    page: 'reviews',
    minutes: 1,
  },
  {
    id: 'incentive',
    title: 'Offer a reward',
    body: 'A discount code for leaving a review — never tied to the rating, so it stays on the right side of the FTC rules.',
    cta: 'Create incentive',
    icon: Gift,
    tone: 'rose',
    page: 'incentives',
    minutes: 2,
    optional: true,
  },
];

interface Progress {
  steps: Array<{ id: string; done: boolean; optional?: boolean }>;
  completed: number;
  total: number;
  complete: boolean;
  dismissedAt: string | null;
}

export default function OnboardingFlow({
  onNavigate,
  storeName,
}: {
  onNavigate: (page: PageId) => void;
  storeName?: string;
}) {
  const [data, setData] = useState<Progress | null>(null);
  const [hidden, setHidden] = useState(false);
  // The merchant's own send delay, so the preview shows their setting rather than
  // asserting a default as though it were fixed behaviour.
  const [delayDays, setDelayDays] = useState<number | null>(null);

  const load = useCallback(() => {
    apiFetch<Progress>('/api/onboarding')
      .then(setData)
      .catch(() => setData(null));
    apiFetch<{ delayDays?: number }>('/api/request-settings')
      .then((r) => setDelayDays(typeof r.delayDays === 'number' ? r.delayDays : null))
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  const dismiss = async () => {
    setHidden(true);
    await apiFetch('/api/onboarding', {
      method: 'POST',
      body: JSON.stringify({ dismissed: true }),
    }).catch(() => undefined);
  };

  if (!data || hidden || data.dismissedAt) return null;

  const doneIds = new Set(data.steps.filter((s) => s.done).map((s) => s.id));
  const pct = data.total ? (data.completed / data.total) * 100 : 0;
  const allDone = data.complete;
  const next = STEPS.find((s) => !s.optional && !doneIds.has(s.id));
  const minutesLeft = STEPS.filter((s) => !s.optional && !doneIds.has(s.id))
    .reduce((sum, s) => sum + s.minutes, 0);

  return (
    <section className="surface-hero animate-rise relative overflow-hidden rounded-3xl">
      {/* Ambient wash + fine grid. Confined to the hero half so the step cards below stay
          on plain card white and remain easy to scan. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        style={{
          background:
            'radial-gradient(46rem 22rem at 12% -10%, rgba(16,183,133,0.16), transparent 68%),' +
            'radial-gradient(38rem 20rem at 88% 0%, rgba(99,102,241,0.12), transparent 66%)',
        }}
      />
      <div className="grid-lines pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-50" />

      <button
        onClick={dismiss}
        aria-label="Hide setup guide"
        className="ring-focus absolute right-4 top-4 z-10 rounded-lg p-2 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-white/8"
      >
        <X className="size-4" />
      </button>

      {/* ── Hero ── */}
      <div className="relative grid gap-8 px-8 pb-8 pt-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-10 lg:pt-12">
        <div className="min-w-0">
          <Pill tone={allDone ? 'brand' : 'amber'} icon={allDone ? BadgeCheck : Sparkles}>
            {allDone ? 'Setup complete' : `Step ${data.completed + 1} of ${data.total}`}
          </Pill>

          <h1 className="font-display mt-4 text-[38px] text-ink-900 dark:text-white sm:text-[46px]">
            {allDone ? (
              <>
                You&apos;re live<span className="text-brand-600">.</span>
              </>
            ) : (
              <>
                Let&apos;s get {storeName ? <em className="italic">{storeName}</em> : 'your store'}
                <br />
                selling with proof<span className="text-brand-600">.</span>
              </>
            )}
          </h1>

          <p className="mt-4 max-w-md text-[14.5px] leading-relaxed text-ink-500">
            {allDone
              ? 'Reviews are collecting automatically and your storefront is showing them. This guide is done — hide it whenever you like.'
              : 'Five short steps. Most stores have their first reviews on a product page inside ten minutes, and the collection runs itself after that.'}
          </p>

          {/* Progress */}
          <div className="mt-7 max-w-md">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[12.5px] font-semibold text-ink-600 dark:text-ink-300">
                <span className="tnum">{data.completed}</span> of{' '}
                <span className="tnum">{data.total}</span> done
              </span>
              {!allDone && minutesLeft > 0 && (
                <span className="inline-flex items-center gap-1 text-[12px] text-ink-400">
                  <Clock className="size-3" />
                  about {minutesLeft} min left
                </span>
              )}
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-white/8"
              style={{ boxShadow: 'inset 0 1px 2px rgba(11,18,32,.1)' }}
            >
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: `${pct}%`,
                  backgroundImage: allDone
                    ? 'linear-gradient(90deg, var(--brand-400), var(--brand-600))'
                    : 'linear-gradient(90deg, #fbbf24, var(--brand-500))',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.4)',
                }}
              />
            </div>
          </div>

          {/* One obvious action */}
          {next && (
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <ActionButton size="lg" trailingIcon={ArrowRight} onClick={() => onNavigate(next.page)}>
                {next.cta}
              </ActionButton>
              <span className="text-[12.5px] text-ink-400">
                Next: {next.title.toLowerCase()}
              </span>
            </div>
          )}
        </div>

        {/* ── What it looks like when it's done ── */}
        <div className="hidden lg:block">
          <ResultPreview delayDays={delayDays} onEditTiming={() => onNavigate('settings')} />
        </div>
      </div>

      {/* ── Steps ── */}
      <div className="relative grid gap-px border-t border-border bg-border sm:grid-cols-2 xl:grid-cols-3">
        {STEPS.map((step, i) => {
          const done = doneIds.has(step.id);
          const isNext = next?.id === step.id;

          return (
            <div
              key={step.id}
              className={cn(
                'group relative flex gap-3.5 bg-card px-6 py-5 transition-colors',
                !done && 'hover:bg-ink-50/70 dark:hover:bg-white/[0.03]'
              )}
            >
              {isNext && (
                <span className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-brand-300 to-brand-600" />
              )}

              <span
                className={cn(
                  'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold transition-all',
                  done
                    ? cn('tile', TILE_TONE.brand)
                    : isNext
                      ? cn('tile', TILE_TONE[step.tone])
                      : 'border border-dashed border-ink-300 text-ink-400 dark:border-white/15'
                )}
              >
                {done ? (
                  <Check className="size-4.5" strokeWidth={3} />
                ) : isNext ? (
                  <step.icon className="size-4.5" strokeWidth={2.2} />
                ) : (
                  i + 1
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p
                    className={cn(
                      'text-[13.5px] font-semibold',
                      done ? 'text-ink-400' : 'text-ink-900 dark:text-white'
                    )}
                  >
                    {step.title}
                  </p>
                  {done && <Check className="size-3 text-brand-600" strokeWidth={3.5} />}
                  {step.optional && !done && (
                    <span className="text-[10px] font-medium uppercase tracking-wide text-ink-400">
                      optional
                    </span>
                  )}
                </div>

                {!done && (
                  <>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{step.body}</p>
                    <button
                      onClick={() => onNavigate(step.page)}
                      className="ring-focus mt-2.5 inline-flex items-center gap-1 rounded text-[12.5px] font-semibold text-brand-700 transition-colors hover:text-brand-800 dark:text-brand-400"
                    >
                      {step.cta}
                      <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer ── */}
      <div className="relative flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
        <p className="inline-flex items-center gap-1.5 text-[12px] text-ink-400">
          <Zap className="size-3.5 text-brand-500" />
          Nothing reaches your storefront until you approve it.
        </p>
        <button
          onClick={dismiss}
          className="ring-focus rounded text-[12px] font-semibold text-ink-400 transition-colors hover:text-ink-700 dark:hover:text-ink-200"
        >
          {allDone ? 'Hide this guide' : 'Skip setup for now'}
        </button>
      </div>
    </section>
  );
}

/**
 * The destination, rendered rather than described.
 *
 * Deliberately built from live markup instead of a screenshot: it stays sharp at any size,
 * adds no image weight, and cannot drift out of date with the product the way a PNG
 * checked into a repo always eventually does.
 */
function ResultPreview({
  delayDays,
  onEditTiming,
}: {
  delayDays: number | null;
  onEditTiming: () => void;
}) {
  return (
    <div className="relative">
      <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
        What your product page gets
      </p>

      <div className="surface-float relative overflow-hidden rounded-2xl">
        {/* Summary */}
        <div className="border-b border-border px-5 py-4">
          <div className="flex items-end justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="display text-[30px] font-bold leading-none text-ink-900 dark:text-white">
                  4.8
                </span>
                <div className="flex gap-px">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Star
                      key={i}
                      className="size-3.5 text-amber-400"
                      fill="currentColor"
                      strokeWidth={0}
                    />
                  ))}
                </div>
              </div>
              <p className="mt-1 text-[11.5px] text-ink-400">from 1,284 reviews</p>
            </div>
            <span className="tile tile-brand size-9">
              <Star className="size-4" fill="currentColor" strokeWidth={0} />
            </span>
          </div>
        </div>

        {/* A review with photos */}
        <div className="px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-[11px] font-bold text-white">
              M
            </span>
            <span className="text-[12.5px] font-semibold text-ink-900 dark:text-white">Maya R.</span>
            <Pill tone="brand" icon={BadgeCheck}>Verified</Pill>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-ink-600 dark:text-ink-300">
            Exactly as pictured and the finish is beautiful. Second one I&apos;ve bought.
          </p>
          <div className="mt-2.5 flex gap-1.5">
            {[
              'linear-gradient(140deg,#a7f3d4,#059468)',
              'linear-gradient(140deg,#bfdbfe,#4f46e5)',
              'linear-gradient(140deg,#fde68a,#d97706)',
            ].map((bg, i) => (
              <div
                key={i}
                className="size-11 rounded-lg ring-1 ring-inset ring-black/5"
                style={{
                  backgroundImage: bg,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.4)',
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* The timing, as a control rather than a claim.
          This read "14 days after delivery", which stated our default as though it were
          fixed behaviour — and the timing is the merchant's to set anywhere from same-day
          to two months. Showing THEIR number, and making it clickable, turns a line of
          marketing copy into the feature it was describing. */}
      <button
        onClick={onEditTiming}
        className="ring-focus surface-float animate-float lift absolute -bottom-6 -left-6 w-56 rounded-xl p-3 text-left"
        style={{ animationDelay: '1.4s' }}
      >
        <div className="flex items-center gap-2.5">
          <span className="tile tile-amber size-8">
            <Mail className="size-3.5" strokeWidth={2.4} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] font-semibold text-ink-900 dark:text-white">
              Ask after fulfilment
            </p>
            <p className="truncate text-[10.5px] text-ink-500">
              {delayDays === null
                ? 'You choose the timing'
                : delayDays === 0
                  ? 'Straight away'
                  : `Waiting ${delayDays} day${delayDays === 1 ? '' : 's'}`}
            </p>
          </div>
          <ChevronRight className="size-3.5 shrink-0 text-ink-300" />
        </div>
      </button>
    </div>
  );
}
