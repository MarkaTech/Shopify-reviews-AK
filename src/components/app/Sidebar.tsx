'use client';

import React, { useMemo, useState } from 'react';
import {
  LayoutDashboard, Star, FileSpreadsheet, Settings, ShoppingBag, Palette,
  MessageSquare, Search, HelpCircle, Gift, Sparkles, ChevronRight,
  Zap, ArrowUpRight, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Meter, ActionButton } from './ui-kit';

/**
 * The navigation rail.
 *
 * This was a near-black panel. Inside Shopify's admin — which is white, with the merchant's
 * own store nav immediately to its left — a black slab reads as a foreign object embedded
 * in the page rather than part of the product. It also inverted the usual relationship
 * between navigation and content: the darkest, heaviest element on screen was the one the
 * merchant looks at least.
 *
 * Now a white rail raised very slightly off the page, in the same visual language as the
 * cards it sits beside. Weight comes from typography and one accent colour rather than
 * from a large dark fill, which is what the tools this is competing with actually do.
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

interface SidebarProps {
  currentPage: PageId;
  onPageChange: (page: PageId) => void;
  /** Real store details. The footer previously hardcoded a fictional store on a Pro
   *  plan, which contradicted the header and told Free-plan merchants they were paying. */
  storeName?: string;
  storeDomain?: string;
  plan?: string;
  /**
   * Live usage for the plan meter — review request emails sent this month against the
   * plan's monthly allowance. This tracked total review count until the meter moved to
   * email volume; a cumulative count could only ever go up, which made it useless as a
   * gauge of anything the merchant could act on.
   */
  requestsUsed?: number;
  requestsCap?: number | null;
  pendingCount?: number;
}

const PLAN_META: Record<
  string,
  { label: string; short: string; price: string; chip: string }
> = {
  free: {
    label: 'Free',
    short: 'FREE',
    price: '$0',
    chip: 'bg-ink-100 text-ink-600 ring-ink-900/8',
  },
  growth: {
    label: 'Growth',
    short: 'GROW',
    price: '$12',
    chip: 'bg-brand-50 text-brand-700 ring-brand-600/15',
  },
  scale: {
    label: 'Scale',
    short: 'SCALE',
    price: '$39',
    chip: 'bg-violet-50 text-violet-700 ring-violet-600/15',
  },
};

interface NavItem {
  id: PageId;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'ST';
  return (parts[0][0] + (parts[1]?.[0] ?? parts[0][1] ?? '')).toUpperCase();
}

export default function Sidebar({
  currentPage,
  onPageChange,
  storeName,
  storeDomain,
  plan,
  requestsUsed = 0,
  requestsCap,
  pendingCount = 0,
}: SidebarProps) {
  const planKey = plan && plan in PLAN_META ? plan : 'free';
  const planMeta = PLAN_META[planKey];
  const [query, setQuery] = useState('');

  // Flat groups rather than the old collapsible tree. Two levels of disclosure to
  // reach Settings was friction with no payoff — there are only eight screens, and
  // hiding half of them behind an accordion made the app feel bigger than it is.
  const groups: NavGroup[] = useMemo(
    () => [
      {
        label: null,
        items: [{ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }],
      },
      {
        label: 'Reviews',
        items: [
          { id: 'reviews', label: 'All reviews', icon: MessageSquare, badge: pendingCount || undefined },
          { id: 'bulk-upload', label: 'Import', icon: FileSpreadsheet },
          { id: 'questions', label: 'Questions', icon: HelpCircle },
        ],
      },
      {
        label: 'Store',
        items: [
          { id: 'products', label: 'Products', icon: ShoppingBag },
          { id: 'widgets', label: 'Widgets', icon: Palette },
          { id: 'incentives', label: 'Incentives', icon: Gift },
          { id: 'settings', label: 'Settings', icon: Settings },
        ],
      },
    ],
    [pendingCount]
  );

  // The search box used to be decorative — an input wired to nothing. It now filters
  // navigation, which is the honest scope for a control in this position.
  const q = query.trim().toLowerCase();
  const filtered = q
    ? groups
        .map((g) => ({ ...g, items: g.items.filter((i) => i.label.toLowerCase().includes(q)) }))
        .filter((g) => g.items.length)
    : groups;

  const usagePct = requestsCap ? Math.min(100, (requestsUsed / requestsCap) * 100) : 0;
  const nearCap = requestsCap != null && usagePct >= 80;

  return (
    <aside
      className="fixed left-0 top-0 z-40 flex h-screen w-[260px] flex-col border-r border-border bg-card"
      style={{
        backgroundImage: 'linear-gradient(180deg, #ffffff 0%, #fcfdfe 55%, #f9fbfd 100%)',
        boxShadow: '1px 0 0 rgba(11,18,32,0.03), 4px 0 24px -12px rgba(11,18,32,0.10)',
      }}
    >
      {/* A whisper of brand at the very top, so the rail is not a plain white column. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-44"
        style={{
          background:
            'radial-gradient(20rem 11rem at 0% 0%, rgba(16,183,133,0.10), transparent 70%)',
        }}
      />

      {/* ── Brand ── */}
      <div className="relative flex items-center gap-2.5 px-4 pb-4 pt-5">
        <span className="tile tile-brand size-9">
          <Star className="size-4.5" fill="currentColor" strokeWidth={0} />
        </span>
        <div className="min-w-0">
          <h1 className="text-[14.5px] font-bold leading-tight tracking-[-0.015em] text-ink-900 dark:text-white">
            ReviewMaster
          </h1>
          <p className="text-[10.5px] font-medium text-ink-400">Reviews that sell</p>
        </div>
      </div>

      {/* ── Search ── */}
      <div className="relative px-3 pb-3">
        <Search className="pointer-events-none absolute left-6 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Jump to…"
          aria-label="Filter navigation"
          className="h-9 w-full rounded-xl border border-border bg-ink-50/70 pl-8 pr-3 text-[12.5px] text-ink-800 placeholder:text-ink-400 transition-all focus:border-brand-400 focus:bg-card focus:outline-none focus:ring-4 focus:ring-brand-500/10 dark:bg-white/5 dark:text-white"
        />
      </div>

      {/* ── Navigation ── */}
      <nav className="no-scrollbar relative flex-1 overflow-y-auto px-3 pb-2">
        {filtered.map((group) => (
          <div key={group.label ?? 'main'} className="mb-5">
            {group.label && (
              <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-ink-400">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = currentPage === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => onPageChange(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'ring-focus group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-all duration-150',
                      active
                        ? 'font-semibold text-brand-800 dark:text-brand-200'
                        : 'font-medium text-ink-600 hover:bg-ink-100/70 hover:text-ink-900 dark:text-ink-300 dark:hover:bg-white/5 dark:hover:text-white'
                    )}
                  >
                    {active && (
                      <>
                        <span
                          className="absolute inset-0 -z-10 rounded-xl border border-brand-600/12 bg-brand-50 dark:border-brand-400/20 dark:bg-brand-500/12"
                          style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)' }}
                        />
                        <span className="absolute left-0 top-1/2 h-4.5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-600" />
                      </>
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
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.badge ? (
                      <span className="tnum rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-400/15 dark:text-amber-300">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {q && !filtered.length && (
          <p className="px-3 py-6 text-center text-[12px] text-ink-400">
            Nothing matches “{query}”.
          </p>
        )}
      </nav>

      {/* ── Plan ── */}
      <div className="relative px-3 pb-3">
        <button
          onClick={() => onPageChange('settings')}
          className="ring-focus surface lift group block w-full rounded-2xl p-3 text-left"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center rounded-md px-1.5 py-0.5 text-[9.5px] font-black tracking-wider ring-1 ring-inset',
                  planMeta.chip
                )}
              >
                {planMeta.short}
              </span>
              <span className="text-[12.5px] font-semibold text-ink-900 dark:text-white">
                {planMeta.label}
              </span>
            </span>
            <ChevronRight className="size-3.5 text-ink-300 transition-transform group-hover:translate-x-0.5" />
          </div>

          <div className="mt-2.5">
            <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
              <span className="text-ink-500">Requests this month</span>
              <span className="tnum font-semibold text-ink-800 dark:text-ink-100">
                {requestsUsed.toLocaleString()}
                <span className="font-normal text-ink-400">
                  {' '}/ {requestsCap ? requestsCap.toLocaleString() : '∞'}
                </span>
              </span>
            </div>
            {requestsCap ? (
              <Meter value={usagePct} tone={nearCap ? 'amber' : 'brand'} height={5} />
            ) : (
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-700 dark:text-brand-300">
                <Sparkles className="size-3" />
                Unlimited
              </div>
            )}
          </div>
        </button>

        {planKey === 'free' && (
          <ActionButton
            variant="primary"
            size="sm"
            icon={Zap}
            className="mt-2 w-full"
            onClick={() => onPageChange('settings')}
          >
            Upgrade plan
          </ActionButton>
        )}
      </div>

      {/* ── Store ── */}
      <div className="relative border-t border-border px-3 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-ink-700 to-ink-900 text-[11px] font-bold text-white">
            {initialsOf(storeName || '')}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-ink-800 dark:text-white">
              {storeName || 'Your store'}
            </p>
            <p className="truncate text-[10.5px] text-ink-400">{storeDomain || '—'}</p>
          </div>
          {storeDomain && (
            <a
              href={`https://${storeDomain}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open your storefront"
              title="Open your storefront"
              className="ring-focus rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-white/8"
            >
              <ArrowUpRight className="size-3.5" />
            </a>
          )}
        </div>
      </div>
    </aside>
  );
}
