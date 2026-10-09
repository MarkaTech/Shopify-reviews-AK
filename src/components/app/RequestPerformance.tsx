'use client';

import React, { useEffect, useState } from 'react';
import { Send, MousePointerClick, MessageSquarePlus, Clock, CalendarClock, Repeat2, Mail } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { Panel, PanelHeader, Meter, Pill, Skeleton, EmptyState } from './ui-kit';
import { cn } from '@/lib/utils';
import type { Navigate } from './TopNav';

/** The request settings the status line needs; /api/request-settings returns these and more. */
export interface RequestSummary {
  enabled: boolean;
  delayDays: number;
  /** The count the merchant stored. Not what is sent when `remindersAllowed` is false. */
  reminders: number;
  /** Only customers who accepted marketing at checkout are asked. */
  requireMarketingConsent?: boolean;
  /**
   * Whether the store's plan sends reminders at all; the route answers it beside the
   * settings. On Free, request-sender.ts sends the first email and nothing after it,
   * whatever `reminders` says. Undefined means the server did not say (an older build),
   * and the stored count is shown as it always was.
   */
  remindersAllowed?: boolean;
}

/** What GET and PUT /api/request-settings answer, as far as these surfaces read it. */
export interface RequestSettingsResponse {
  settings?: RequestSummary;
  remindersAllowed?: boolean;
}

/**
 * The settings with the plan's answer folded in, or null when the response carries no
 * usable settings. One reader for every surface, so none of them can take the settings and
 * leave the plan half behind — which is how all four came to promise Free stores a reminder.
 */
export function requestSummaryFrom(r: RequestSettingsResponse | null | undefined): RequestSummary | null {
  // The route answers { settings: { delayDays, ... } }; a body without the number is not settings.
  if (!r?.settings || typeof r.settings.delayDays !== 'number') return null;
  return typeof r.remindersAllowed === 'boolean'
    ? { ...r.settings, remindersAllowed: r.remindersAllowed }
    : { ...r.settings };
}

/**
 * What the review-request programme is doing right now, in the merchant's own numbers.
 *
 * Requests are ON from the moment of install — every fulfilled order schedules an email
 * after the delay, then the reminders — and the app never said so plainly. The only hint
 * ("Ask after fulfilment · Waiting 14 days") sat inside a preview card hidden below `lg`,
 * so at tablet width or in a narrow admin frame nothing anywhere said emails were already
 * going out. This sentence goes wherever requests are discussed: the first-run checklist,
 * the dashboard's request panel and the Notifications tab. The merchant's own values, not
 * the defaults, so it stays true after they change the timing.
 *
 * Lower-case start, because callers lead with "Review requests are ON — ".
 *
 * What is SENT, not only what is stored: a plan without reminders sends none whatever the
 * count says, and the consent filter narrows who is asked at all.
 */
export function describeRequests(s: RequestSummary): string {
  if (!s.enabled) return 'no invitation emails go out after an order is fulfilled.';
  const when = s.delayDays === 0
    ? 'the day an order is fulfilled'
    : `${s.delayDays} day${s.delayDays === 1 ? '' : 's'} after fulfilment`;
  const reminders =
    s.reminders === 0
      ? 'no reminder'
      : s.remindersAllowed === false
        ? 'no reminders (the Growth plan adds them)'
        : `${s.reminders} reminder${s.reminders === 1 ? '' : 's'}`;
  const who = s.requireMarketingConsent ? ' Only customers who accepted marketing are asked.' : '';
  return `first email ${when}, ${reminders}.${who}`;
}

/** The status sentence with its link, for any surface that has the settings to hand. */
export function RequestsStatus({
  settings,
  onAdjust,
  className,
}: {
  settings: RequestSummary | null;
  onAdjust?: () => void;
  className?: string;
}) {
  if (!settings) return null;
  return (
    <p
      role="status"
      className={cn('flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] leading-snug text-ink-600 dark:text-ink-300', className)}
    >
      <Mail className={cn('size-3.5 shrink-0', settings.enabled ? 'text-brand-600 dark:text-brand-400' : 'text-ink-400')} strokeWidth={2.2} />
      <span>
        <strong className="font-semibold text-ink-900 dark:text-white">
          Review requests are {settings.enabled ? 'ON' : 'OFF'}
        </strong>
        {' — '}
        {describeRequests(settings)}
      </span>
      {onAdjust && (
        <button
          type="button"
          onClick={onAdjust}
          className="ring-focus rounded font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
        >
          {settings.enabled ? 'Adjust or turn off' : 'Turn on'}
        </button>
      )}
    </p>
  );
}

/**
 * How the review-request programme is performing.
 *
 * The app recorded every step of this — sent, opened, submitted — from the day the
 * feature was built, and showed a merchant none of it. They could see how many reviews
 * they had and nothing about the machine that produces them.
 *
 * A note on the funnel's colour, since it looks like a decision that was not made: the
 * three stages are one thing narrowing, not three identities, so they take one hue at
 * decreasing steps rather than three categorical colours. Colouring them separately would
 * imply they are different kinds of thing and burn the only free channel on information
 * the bar lengths already carry.
 */

interface RequestAnalytics {
  windowDays: number;
  funnel: { sent: number; clicked: number; submitted: number; clickRate: number; conversionRate: number; completionRate: number };
  reminders: { submittedAfterReminder: number; submittedOnFirstEmail: number; shareOfSubmissions: number };
  queue: {
    pending: number;
    dueNextWeek: number;
    upcoming: Array<{ id: string; customerName: string | null; orderNumber: string | null; sendsAt: string; isReminder: boolean }>;
  };
  timeToReview: { medianDays: number | null; sampleSize: number };
  lifetime: { sent: number; submitted: number; conversionRate: number };
}

const STAGES = [
  { key: 'sent', label: 'Invitations sent', icon: Send, fill: 'bg-brand-600', hint: 'Emails that reached the provider' },
  { key: 'clicked', label: 'Opened the form', icon: MousePointerClick, fill: 'bg-brand-500', hint: 'Clicked through from the email' },
  { key: 'submitted', label: 'Left a review', icon: MessageSquarePlus, fill: 'bg-brand-400', hint: 'Completed and submitted' },
] as const;

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return 'due now';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export default function RequestPerformance({ onNavigate }: { onNavigate?: Navigate }) {
  const [data, setData] = useState<RequestAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<RequestSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<RequestAnalytics>('/api/analytics/requests')
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    // The settings behind the numbers, for the status line. Best effort: the panel is
    // about the figures, and a missing sentence is better than a missing panel.
    apiFetch<RequestSettingsResponse>('/api/request-settings')
      .then((r) => {
        const s = requestSummaryFrom(r);
        if (!cancelled && s) setSettings(s);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const adjust = onNavigate ? () => onNavigate('settings', { tab: 'notifications' }) : undefined;

  if (loading) {
    return (
      <Panel>
        <PanelHeader title="Review requests" description="Loading…" icon={Send} tone="brand" />
        <div className="space-y-3 border-t border-border p-5">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-9 w-full rounded-xl" />)}
        </div>
      </Panel>
    );
  }

  if (!data) return null;

  const { funnel, reminders, queue, timeToReview, lifetime } = data;

  // Nothing has been sent yet. An empty funnel of three zero-width bars tells a merchant
  // nothing except that something is broken, which is not what is happening.
  if (funnel.sent === 0 && queue.pending === 0) {
    return (
      <Panel>
        <PanelHeader title="Review requests" description="Automatic invitations after an order is delivered" icon={Send} tone="brand" />
        <div className="border-t border-border">
          <EmptyState
            icon={Send}
            title="No invitations sent yet"
            description="When an order is fulfilled, Marka Reviews schedules an email asking that customer for a review. Once they start going out, you'll see how many are opened and how many become reviews."
            secondary={<RequestsStatus settings={settings} onAdjust={adjust} className="justify-center" />}
          />
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader
        title="Review requests"
        description={`Last ${data.windowDays} days`}
        icon={Send}
        tone="brand"
        action={
          lifetime.sent > 0 ? (
            <Pill tone="neutral">{lifetime.conversionRate}% all time</Pill>
          ) : undefined
        }
      />

      <div className="space-y-5 border-t border-border p-5">
        {/* What is running, before how it is doing. */}
        <RequestsStatus settings={settings} onAdjust={adjust} />
        {/* ── Funnel ──
            Horizontal bars on a common baseline rather than a tapering funnel shape.
            A trapezoid encodes the value twice, in width and in area, and the area is
            the one people read — so it exaggerates every drop-off. */}
        <div className="space-y-2.5">
          {STAGES.map((stage) => {
            const value = funnel[stage.key];
            const pct = funnel.sent > 0 ? (value / funnel.sent) * 100 : 0;
            return (
              <div key={stage.key}>
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-600 dark:text-ink-300">
                    <stage.icon className="size-3.5 text-ink-400" strokeWidth={2.1} />
                    {stage.label}
                  </span>
                  <span className="text-[12.5px] text-ink-500">
                    <span className="font-semibold text-ink-900 dark:text-white">{value.toLocaleString()}</span>
                    {stage.key !== 'sent' && funnel.sent > 0 && (
                      <span className="ml-1.5 text-ink-400">
                        {Math.round((value / funnel.sent) * 100)}%
                      </span>
                    )}
                  </span>
                </div>
                {/* Track and fill, thin. The label lives outside the bar, so a stage at
                    2% cannot clip its own number. */}
                <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100 dark:bg-white/8">
                  <div
                    className={cn('h-full rounded-full transition-[width] duration-500', stage.fill)}
                    style={{ width: `${Math.max(pct, value > 0 ? 1.5 : 0)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* ── The two numbers a merchant acts on ── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-ink-50 p-3.5 dark:bg-white/[0.03]">
            <p className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">Invitation to review</p>
            <p className="mt-1 text-[22px] leading-none font-bold text-ink-900 dark:text-white">
              {funnel.conversionRate}%
            </p>
            <p className="mt-1.5 text-[11.5px] leading-snug text-ink-500">
              {funnel.submitted.toLocaleString()} of {funnel.sent.toLocaleString()} invitations became a review.
            </p>
          </div>

          <div className="rounded-xl bg-ink-50 p-3.5 dark:bg-white/[0.03]">
            <p className="text-[11px] font-semibold tracking-wide text-ink-400 uppercase">Finished the form</p>
            <p className="mt-1 text-[22px] leading-none font-bold text-ink-900 dark:text-white">
              {funnel.completionRate}%
            </p>
            <p className="mt-1.5 text-[11.5px] leading-snug text-ink-500">
              Of those who opened it. A low number here points at the form; a low click
              rate above points at the email.
            </p>
          </div>
        </div>

        {/* ── Is the reminder worth sending ── */}
        {funnel.submitted > 0 && (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-600 dark:text-ink-300">
                <Repeat2 className="size-3.5 text-ink-400" strokeWidth={2.1} />
                Reviews that needed a reminder
              </span>
              <span className="text-[12.5px] font-semibold text-ink-900 dark:text-white">
                {reminders.shareOfSubmissions}%
              </span>
            </div>
            <Meter value={reminders.shareOfSubmissions} tone="brand" height={5} />
            <p className="mt-1.5 text-[11.5px] leading-snug text-ink-500">
              {/* Only claim what reminders did when they did something: on a plan without
                  reminders, or before any were needed, the old line contradicted itself. */}
              {reminders.submittedAfterReminder > 0 ? (
                <>
                  {reminders.submittedAfterReminder.toLocaleString()} of {funnel.submitted.toLocaleString()} reviews
                  arrived only after a second email. Turning reminders off would have cost you those.
                </>
              ) : (
                <>Every review so far came from the first email.</>
              )}
            </p>
          </div>
        )}

        {/* ── What's queued ──
            The question that had no answer anywhere in the app: is anything actually
            scheduled, and when does it go out. */}
        <div className="border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-800 dark:text-ink-100">
              <CalendarClock className="size-3.5 text-ink-400" strokeWidth={2.1} />
              Scheduled
            </span>
            <span className="text-[12px] text-ink-500">
              <span className="font-semibold text-ink-900 dark:text-white">{queue.pending.toLocaleString()}</span> waiting
              {queue.dueNextWeek > 0 && <span className="text-ink-400"> · {queue.dueNextWeek} in the next 7 days</span>}
            </span>
          </div>

          {queue.upcoming.length > 0 ? (
            <ul className="mt-2.5 space-y-1">
              {queue.upcoming.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="min-w-0 truncate text-ink-600 dark:text-ink-300">
                    {u.customerName || 'Customer'}
                    {u.orderNumber && <span className="text-ink-400"> · {u.orderNumber}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-ink-500">
                    {u.isReminder && <Pill tone="neutral">reminder</Pill>}
                    {formatWhen(u.sendsAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12px] text-ink-400">
              Nothing queued. Requests are scheduled when an order is fulfilled.
            </p>
          )}
        </div>

        {/* Not a flex row. This is a sentence with emphasis inside it, and `flex` makes
            every span a flex item — so on a narrow screen it stopped being a sentence and
            became three ragged columns. The icon is inline instead. */}
        {timeToReview.medianDays !== null && (
          <p className="border-t border-border pt-3.5 text-[11.5px] leading-relaxed text-ink-500">
            <Clock className="mr-1 inline size-3.5 align-[-2px] text-ink-400" strokeWidth={2.1} />
            Customers who review typically do so{' '}
            <span className="font-semibold text-ink-800 dark:text-ink-100">
              {timeToReview.medianDays} {timeToReview.medianDays === 1 ? 'day' : 'days'}
            </span>{' '}
            after the invitation. Median of {timeToReview.sampleSize.toLocaleString()}.
          </p>
        )}
      </div>
    </Panel>
  );
}
