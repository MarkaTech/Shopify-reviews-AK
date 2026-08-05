'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  ShoppingBag, MessageSquarePlus, Palette, Mail, CheckCircle2, Gift,
  Check, X, Rocket, ArrowRight, type LucideIcon,
} from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Meter, ActionButton, Pill, type TileTone, TILE_TONE } from './ui-kit';
import type { PageId } from './Sidebar';

/**
 * First-run setup, shown at the top of the dashboard until it is finished.
 *
 * The intent is to remove the worst moment in any app's life: install completes,
 * the dashboard loads full of zeroes, and the merchant has no idea whether that is
 * because the app is broken or because they have not done anything yet. A checklist
 * answers that question and gives every empty number a reason.
 *
 * Progress is derived server-side from real data (see /api/onboarding), so a step
 * cannot be ticked without the underlying thing existing.
 */

interface StepMeta {
  id: string;
  title: string;
  body: string;
  icon: LucideIcon;
  tone: TileTone;
  cta: string;
  page: PageId;
  optional?: boolean;
}

const STEPS: StepMeta[] = [
  {
    id: 'products',
    title: 'Sync your products',
    body: 'Runs automatically at install so reviews can attach to the right product.',
    icon: ShoppingBag,
    tone: 'cyan',
    cta: 'View products',
    page: 'products',
  },
  {
    id: 'reviews',
    title: 'Get your first reviews',
    body: 'Import from AliExpress, Etsy or a CSV — or collect fresh ones from real orders.',
    icon: MessageSquarePlus,
    tone: 'brand',
    cta: 'Import reviews',
    page: 'bulk-upload',
  },
  {
    id: 'widget',
    title: 'Add a widget to your theme',
    body: 'Pick a layout and colours that match your store, then place it on your product page.',
    icon: Palette,
    tone: 'indigo',
    cta: 'Design widget',
    page: 'widgets',
  },
  {
    id: 'requests',
    title: 'Turn on review requests',
    body: 'Emails go out after fulfilment on the delay you choose, with automatic reminders.',
    icon: Mail,
    tone: 'amber',
    cta: 'Set timing',
    page: 'settings',
  },
  {
    id: 'publish',
    title: 'Publish your first review',
    body: 'Nothing appears on your storefront until you approve it. Approve one to go live.',
    icon: CheckCircle2,
    tone: 'violet',
    cta: 'Moderate',
    page: 'reviews',
  },
  {
    id: 'incentive',
    title: 'Offer a reward',
    body: 'A discount code for leaving a review. Optional, and never tied to the rating.',
    icon: Gift,
    tone: 'rose',
    cta: 'Create incentive',
    page: 'incentives',
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

export default function OnboardingCard({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const [data, setData] = useState<Progress | null>(null);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(() => {
    apiFetch<Progress>('/api/onboarding')
      .then(setData)
      .catch(() => setData(null));
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

  // The next thing to do, promoted so there is always one obvious action.
  const next = STEPS.find((s) => !s.optional && !doneIds.has(s.id));

  return (
    <div className="surface-hero animate-rise relative overflow-hidden rounded-2xl">
      {/* Brand wash behind the header only, so the checklist rows stay legible. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-40"
        style={{
          background:
            'radial-gradient(40rem 12rem at 15% 0%, rgba(16,183,133,0.14), transparent 70%)',
        }}
      />

      <div className="relative flex items-start justify-between gap-4 px-6 pb-5 pt-6">
        <div className="flex items-start gap-3.5">
          <span className={cn('tile size-12', allDone ? TILE_TONE.brand : TILE_TONE.amber)}>
            {allDone ? (
              <Check className="size-6" strokeWidth={3} />
            ) : (
              <Rocket className="size-[22px]" strokeWidth={2.2} />
            )}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] font-bold text-ink-900 dark:text-white">
                {allDone ? 'You’re live' : 'Finish setting up'}
              </h2>
              <Pill tone={allDone ? 'brand' : 'amber'}>
                {data.completed}/{data.total}
              </Pill>
            </div>
            <p className="mt-1 max-w-lg text-[13px] leading-relaxed text-ink-500">
              {allDone
                ? 'Every essential step is done. Reviews are collecting, and your storefront is showing them.'
                : next
                  ? `Next: ${next.title.toLowerCase()}. Most stores are finished in about five minutes.`
                  : 'Almost there.'}
            </p>
          </div>
        </div>

        <button
          onClick={dismiss}
          aria-label="Dismiss setup checklist"
          className="ring-focus rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600 dark:hover:bg-white/8"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="relative px-6 pb-5">
        <Meter value={pct} tone={allDone ? 'brand' : 'amber'} height={6} />
      </div>

      <div className="relative grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((step) => {
          const done = doneIds.has(step.id);
          return (
            <div
              key={step.id}
              className={cn(
                'group flex items-start gap-3 bg-card px-5 py-4 transition-colors',
                !done && 'hover:bg-ink-50/70 dark:hover:bg-white/[0.03]'
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg transition-all',
                  done
                    ? 'tile tile-brand'
                    : 'border border-dashed border-ink-300 text-ink-400 dark:border-white/15'
                )}
              >
                {done ? (
                  <Check className="size-4" strokeWidth={3} />
                ) : (
                  <step.icon className="size-3.5" strokeWidth={2.2} />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p
                    className={cn(
                      'text-[13px] font-semibold',
                      done
                        ? 'text-ink-400 line-through decoration-ink-300'
                        : 'text-ink-900 dark:text-white'
                    )}
                  >
                    {step.title}
                  </p>
                  {step.optional && !done && (
                    <span className="text-[10px] font-medium uppercase tracking-wide text-ink-400">
                      optional
                    </span>
                  )}
                </div>

                {!done && (
                  <>
                    <p className="mt-1 text-[12px] leading-relaxed text-ink-500">{step.body}</p>
                    <button
                      onClick={() => onNavigate(step.page)}
                      className="ring-focus mt-2 inline-flex items-center gap-1 rounded text-[12px] font-semibold text-brand-700 transition-colors hover:text-brand-800 dark:text-brand-400"
                    >
                      {step.cta}
                      <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {allDone && (
        <div className="relative flex items-center justify-between gap-4 border-t border-border px-6 py-4">
          <p className="text-[12.5px] text-ink-500">
            You can bring this back any time from Settings.
          </p>
          <ActionButton size="sm" variant="soft" onClick={dismiss}>
            Hide checklist
          </ActionButton>
        </div>
      )}
    </div>
  );
}
