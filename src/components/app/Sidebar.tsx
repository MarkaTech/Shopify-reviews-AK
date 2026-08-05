'use client';

import React, { useMemo, useState } from 'react';
import {
  LayoutDashboard, Star, FileSpreadsheet, Settings, ShoppingBag, Palette,
  MessageSquare, Search, HelpCircle, Gift, Sparkles, ChevronRight,
  Zap, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tile, Meter, ActionButton } from './ui-kit';

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

const PLAN_META: Record<string, { label: string; short: string; price: string; tone: string }> = {
  free: { label: 'Free', short: 'FREE', price: '$0', tone: 'from-slate-400 to-slate-600' },
  growth: { label: 'Growth', short: 'GROW', price: '$12', tone: 'from-emerald-400 to-teal-600' },
  scale: { label: 'Scale', short: 'SCALE', price: '$39', tone: 'from-violet-400 to-fuchsia-600' },
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
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-[264px] flex-col bg-[var(--sidebar)] text-[var(--sidebar-foreground)]">
      {/* A single hairline of light down the right edge. Reads as a lit panel edge
          rather than a border, which is the difference between "dark theme" and
          "dark material". */}
      <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-white/[0.02] via-white/[0.12] to-white/[0.02]" />
      {/* Brand glow bleeding in from the top-left. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-64 opacity-70"
        style={{
          background:
            'radial-gradient(28rem 16rem at 8% 0%, rgba(16,183,133,0.22), transparent 68%)',
        }}
      />

      {/* ── Brand ── */}
      <div className="relative flex items-center gap-3 px-4 pb-4 pt-5">
        <div className="relative">
          <div className="absolute inset-0 rounded-xl bg-brand-500/40 blur-lg" />
          <span className="tile tile-brand relative size-10">
            <Star className="size-5" fill="currentColor" strokeWidth={0} />
          </span>
        </div>
        <div className="min-w-0">
          <h1 className="text-[15px] font-bold leading-tight tracking-tight text-white">
            ReviewMaster
          </h1>
          <p className="text-[11px] text-white/40">Reviews that sell</p>
        </div>
      </div>

      {/* ── Search ── */}
      <div className="relative px-3 pb-3">
        <Search className="pointer-events-none absolute left-6 top-1/2 size-3.5 -translate-y-1/2 text-white/30" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Jump to…"
          aria-label="Filter navigation"
          className="h-9 w-full rounded-xl border border-white/[0.07] bg-white/[0.04] pl-8 pr-3 text-[12.5px] text-white placeholder:text-white/30 transition-colors focus:border-brand-500/50 focus:bg-white/[0.07] focus:outline-none"
        />
      </div>

      {/* ── Navigation ── */}
      <nav className="no-scrollbar relative flex-1 overflow-y-auto px-3 pb-2">
        {filtered.map((group) => (
          <div key={group.label ?? 'main'} className="mb-4">
            {group.label && (
              <p className="mb-1.5 px-3 text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/25">
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
                      'ring-focus group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-200',
                      active
                        ? 'text-white'
                        : 'text-white/55 hover:bg-white/[0.05] hover:text-white/90'
                    )}
                  >
                    {active && (
                      <>
                        {/* Active row is a lit slab: gradient fill, top bevel, and a
                            brand bar on the leading edge. */}
                        <span
                          className="absolute inset-0 -z-10 rounded-xl border border-white/[0.09]"
                          style={{
                            backgroundImage:
                              'linear-gradient(100deg, rgba(16,183,133,0.22), rgba(255,255,255,0.05))',
                            boxShadow:
                              'inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 12px -6px rgba(16,183,133,0.6)',
                          }}
                        />
                        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand-400 shadow-[0_0_10px_var(--brand-400)]" />
                      </>
                    )}
                    <item.icon
                      className={cn(
                        'size-4 shrink-0 transition-colors',
                        active ? 'text-brand-300' : 'text-white/40 group-hover:text-white/70'
                      )}
                      strokeWidth={2.1}
                    />
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.badge ? (
                      <span className="tnum rounded-full bg-amber-400/90 px-1.5 py-px text-[10px] font-bold text-amber-950 shadow-[0_0_10px_rgba(251,191,36,.45)]">
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
          <p className="px-3 py-6 text-center text-[12px] text-white/30">
            Nothing matches “{query}”.
          </p>
        )}
      </nav>

      {/* ── Plan card ── */}
      <div className="relative px-3 pb-3">
        <button
          onClick={() => onPageChange('settings')}
          className="ring-focus group block w-full rounded-2xl border border-white/[0.08] p-3 text-left transition-all duration-200 hover:border-white/[0.16]"
          style={{
            backgroundImage:
              'linear-gradient(155deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-flex items-center rounded-md bg-gradient-to-br px-1.5 py-0.5 text-[9.5px] font-black tracking-wider text-white shadow-sm',
                  planMeta.tone
                )}
              >
                {planMeta.short}
              </span>
              <span className="text-[12.5px] font-semibold text-white">{planMeta.label}</span>
            </span>
            <ChevronRight className="size-3.5 text-white/30 transition-transform group-hover:translate-x-0.5" />
          </div>

          <div className="mt-2.5">
            <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
              <span className="text-white/45">Requests this month</span>
              <span className="tnum font-semibold text-white/80">
                {requestsUsed.toLocaleString()}
                <span className="text-white/35"> / {requestsCap ? requestsCap.toLocaleString() : '∞'}</span>
              </span>
            </div>
            {requestsCap ? (
              <Meter value={usagePct} tone={nearCap ? 'amber' : 'brand'} height={5} className="bg-white/10" />
            ) : (
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-brand-300">
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
      <div className="relative border-t border-white/[0.07] px-3 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-[11px] font-bold text-white/80 ring-1 ring-inset ring-white/10">
            {initialsOf(storeName || '')}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold text-white/90">
              {storeName || 'Your store'}
            </p>
            <p className="truncate text-[10.5px] text-white/35">{storeDomain || '—'}</p>
          </div>
          <span className="size-1.5 shrink-0 rounded-full bg-brand-400 shadow-[0_0_8px_var(--brand-400)]" />
        </div>
      </div>
    </aside>
  );
}
