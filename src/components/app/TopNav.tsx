'use client';

import React, { useMemo } from 'react';
import {
  LayoutDashboard, Star, FileSpreadsheet, Settings, ShoppingBag, Palette,
  MessageSquare, HelpCircle, Gift, Sparkles, Zap, ArrowUpRight, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Meter, ActionButton } from './ui-kit';

/**
 * Top navigation.
 *
 * This replaces a fixed 260px rail, and the reason is a layout bug rather than taste.
 *
 * Tailwind's breakpoints measure the **viewport**, not the container. With a rail holding
 * 264px, a `lg:grid-cols-4` fired at a 1024px viewport while the content column actually
 * had 760px to lay out in — so four columns were requested into space that fits two, and
 * the overflow pushed everything rightward off screen. That is why the plan badge, the
 * Copy button and the whole right-hand column of colour inputs were unreachable without
 * scrolling sideways: not one bad element, but every viewport-derived breakpoint in the
 * app being wrong by the width of the rail.
 *
 * Embedded Shopify apps get less room than a browser window to begin with, so 264px was
 * a meaningful fraction of everything available. Moving navigation above the content
 * makes the content width approximately the viewport width, which is the assumption those
 * breakpoints were already making — so this one change makes the existing responsive
 * classes across every page correct, rather than requiring each to be re-tuned.
 *
 * The rail's "Jump to…" filter is not carried over. Filtering a list of eight items that
 * are all visible at once is a control with nothing to do.
 */

export type PageId =
  | 'dashboard'
  | 'reviews'
  | 'bulk-upload'
  | 'questions'
  | 'widgets'
  | 'settings'
  | 'products'
  | 'incentives';

interface TopNavProps {
  currentPage: PageId;
  onPageChange: (page: PageId) => void;
  storeName?: string;
  storeDomain?: string;
  plan?: string;
  /** Review request emails sent this month, against the plan's monthly allowance. */
  requestsUsed?: number;
  requestsCap?: number | null;
  pendingCount?: number;
}

const PLAN_META: Record<string, { label: string; short: string; chip: string }> = {
  free:   { label: 'Free',   short: 'FREE',  chip: 'bg-ink-100 text-ink-600 ring-ink-900/8' },
  growth: { label: 'Growth', short: 'GROW',  chip: 'bg-brand-50 text-brand-700 ring-brand-600/15' },
  scale:  { label: 'Scale',  short: 'SCALE', chip: 'bg-violet-50 text-violet-700 ring-violet-600/15' },
};

interface NavItem { id: PageId; label: string; short: string; icon: LucideIcon; badge?: number }

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'ST';
  return (parts[0][0] + (parts[1]?.[0] ?? parts[0][1] ?? '')).toUpperCase();
}

export default function TopNav({
  currentPage,
  onPageChange,
  storeName,
  storeDomain,
  plan,
  requestsUsed = 0,
  requestsCap,
  pendingCount = 0,
}: TopNavProps) {
  const planKey = plan && plan in PLAN_META ? plan : 'free';
  const planMeta = PLAN_META[planKey];

  // The rail's three groups collapse to one row. Grouping earned its keep vertically,
  // where headings gave the eye somewhere to rest; laid out horizontally it would just be
  // separators between eight items that already read as a single set.
  const items: NavItem[] = useMemo(
    () => [
      { id: 'dashboard',   label: 'Dashboard',   short: 'Home',      icon: LayoutDashboard },
      { id: 'reviews',     label: 'All reviews', short: 'Reviews',   icon: MessageSquare, badge: pendingCount || undefined },
      { id: 'bulk-upload', label: 'Import',      short: 'Import',    icon: FileSpreadsheet },
      { id: 'questions',   label: 'Questions',   short: 'Q&A',       icon: HelpCircle },
      { id: 'products',    label: 'Products',    short: 'Products',  icon: ShoppingBag },
      { id: 'widgets',     label: 'Widgets',     short: 'Widgets',   icon: Palette },
      { id: 'incentives',  label: 'Incentives',  short: 'Offers',    icon: Gift },
      { id: 'settings',    label: 'Settings',    short: 'Settings',  icon: Settings },
    ],
    [pendingCount]
  );

  const usagePct = requestsCap ? Math.min(100, (requestsUsed / requestsCap) * 100) : 0;
  const nearCap = requestsCap != null && usagePct >= 80;

  return (
    <header className="glass sticky top-0 z-40 border-b border-border">
      {/* A whisper of brand along the top edge, carried over from the rail so the chrome
          is not a plain white band. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-full"
        style={{ background: 'radial-gradient(36rem 6rem at 0% 0%, rgba(16,183,133,0.07), transparent 70%)' }}
      />

      {/* ── Identity, plan, storefront ── */}
      <div className="relative mx-auto flex w-full max-w-[1600px] items-center gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
        <span className="tile tile-brand size-8 shrink-0">
          <Star className="size-4" fill="currentColor" strokeWidth={0} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[14px] font-bold leading-tight tracking-[-0.015em] text-ink-900 dark:text-white">
            ReviewMaster
          </h1>
          <p className="hidden text-[10.5px] font-medium text-ink-400 sm:block">Reviews that sell</p>
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {/* The usage meter, compact. Below `lg` only the numbers survive — the bar is
              the first thing worth losing, because the fraction beside it says the same
              thing in less room. */}
          <button
            onClick={() => onPageChange('settings')}
            className="ring-focus surface lift hidden items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left md:flex"
            title="Plan and usage"
          >
            <span
              className={cn(
                'inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[9.5px] font-black tracking-wider ring-1 ring-inset',
                planMeta.chip
              )}
            >
              {planMeta.short}
            </span>
            {requestsCap === undefined ? (
              /* Usage not fetched yet. A shimmer, never "Unlimited" - that is a plan
                 entitlement the Free plan does not have, and it was on screen for the
                 first seconds of every load. */
              <span className="hidden w-24 lg:block" aria-hidden="true">
                <span className="block h-2 w-16 animate-pulse rounded bg-ink-200/70 dark:bg-ink-700/60" />
              </span>
            ) : requestsCap ? (
              <span className="hidden lg:block">
                <span className="tnum block text-[11px] font-semibold whitespace-nowrap text-ink-800 dark:text-ink-100">
                  {requestsUsed.toLocaleString()}
                  <span className="font-normal text-ink-400"> / {requestsCap.toLocaleString()}</span>
                </span>
                <span className="mt-1 block w-24">
                  <Meter value={usagePct} tone={nearCap ? 'amber' : 'brand'} height={4} />
                </span>
              </span>
            ) : (
              <span className="hidden items-center gap-1 text-[11px] font-semibold text-brand-700 lg:flex dark:text-brand-300">
                <Sparkles className="size-3" />
                Unlimited
              </span>
            )}
          </button>

          {planKey === 'free' && (
            <ActionButton variant="primary" size="sm" icon={Zap} onClick={() => onPageChange('settings')}>
              <span className="hidden sm:inline">Upgrade</span>
              <span className="sm:hidden">Pro</span>
            </ActionButton>
          )}

          {storeDomain && (
            <a
              href={`https://${storeDomain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ring-focus surface hidden min-w-0 items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-2.5 transition-colors hover:border-ink-300 sm:flex"
              title={`Open ${storeDomain}`}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-ink-700 to-ink-900 text-[10px] font-bold text-white">
                {initialsOf(storeName || '')}
              </span>
              <span className="hidden min-w-0 xl:block">
                <span className="block truncate text-[11.5px] font-semibold text-ink-800 dark:text-white">
                  {storeName || 'Your store'}
                </span>
                <span className="block truncate text-[10px] text-ink-400">{storeDomain}</span>
              </span>
              <ArrowUpRight className="size-3.5 shrink-0 text-ink-400" />
            </a>
          )}
        </div>
      </div>

      {/* ── Navigation ──
          Its own row, so it gets the full width rather than competing with the identity
          block. `overflow-x-auto` is the honest fallback at the narrow end: eight labels
          cannot fit on a phone, and a row that scrolls sideways beats one that wraps to
          three lines or silently hides items behind a menu. */}
      <nav className="relative border-t border-border/70">
        <div className="no-scrollbar mx-auto flex w-full max-w-[1600px] gap-0.5 overflow-x-auto px-1.5 sm:px-3.5 lg:px-5.5">
          {items.map((item) => {
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onPageChange(item.id)}
                aria-current={active ? 'page' : undefined}
                // Always named, because below `md` the button renders as a bare icon with
                // no text node at all — which a screen reader announces as nothing, and a
                // sighted user has to guess at.
                title={item.label}
                aria-label={item.label}
                className={cn(
                  'ring-focus group relative flex shrink-0 items-center gap-1.5 rounded-t-lg px-2.5 py-2.5 text-[13px] whitespace-nowrap transition-colors duration-150',
                  active
                    ? 'font-semibold text-brand-800 dark:text-brand-200'
                    : 'font-medium text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-white'
                )}
              >
                {/* The active marker is an underline rather than the rail's filled pill.
                    A pill under a horizontal row reads as a button among buttons; a rule
                    on the boundary the content starts at reads as "you are here". */}
                {active && (
                  <span className="absolute inset-x-1.5 bottom-0 h-[2.5px] rounded-t-full bg-brand-600 dark:bg-brand-400" />
                )}
                <item.icon
                  className={cn(
                    'size-4 shrink-0 transition-colors',
                    active
                      ? 'text-brand-600 dark:text-brand-300'
                      : 'text-ink-400 group-hover:text-ink-600 dark:group-hover:text-ink-200'
                  )}
                  strokeWidth={2.1}
                />
                {/* Three tiers, sized against what the row measurably needs rather than
                    by eye: eight full labels want ~1000px, eight short ones 853px, eight
                    bare icons ~320px. That leaves one narrow band, 768–853px, where the
                    short labels overflow and the row scrolls sideways. Switching them on
                    at `lg` instead would remove it, at the cost of showing nothing but
                    icons on every tablet — a worse trade than a scroll in an 85px window.
                    Rendered and measured at 480/768/820/900/1024/1100/1280/1600. */}
                <span className="hidden xl:inline">{item.label}</span>
                <span className="hidden md:inline xl:hidden">{item.short}</span>
                {item.badge ? (
                  <span className="tnum rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-400/15 dark:text-amber-300">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
