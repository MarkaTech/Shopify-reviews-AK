'use client';

/**
 * Operator portal — every merchant on the platform, and the levers.
 *
 * Not linked from anywhere in the merchant app, gated by ADMIN_PORTAL_PASSWORD via
 * /api/admin/login, and served outside the Shopify iframe entirely. Everything here
 * talks to /api/admin/*, which never selects a token column, masks customer emails,
 * and offers no destructive operations at all.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Star, Search, RefreshCw, LogOut, PauseCircle, PlayCircle, X, Loader2,
  ShieldCheck, Inbox, ChevronRight, ExternalLink, MailX, Eye, EyeOff, Boxes,
  Calculator, RotateCcw, Gift, StickyNote, Trash2,
} from 'lucide-react';

/* ────────────────────────── types ────────────────────────── */

interface Overview {
  business: {
    mrr: number; arpu: number; revenueByPlan: Record<string, number>;
    paidCount: number; paidShare: number; installs30: number; installsPrev30: number;
    uninstalled30: number; netChange30: number; churnRate30: number;
  };
  stores: { total: number; active: number; byPlan: Record<string, number> };
  activation: { activated: number; syncedOnly: number; cold: number; rate: number };
  reviews: { total: number; last30: number; pendingModeration: number; avgRating: number | null; bySource: Record<string, number> };
  requests: { sent30: number; opened30: number; submitted30: number; conversion30: number | null; queueDue: number; queueFailing: number };
  health: {
    needsReauth: number; tokenExpiringSoon: number; atQuota: number; nearQuota: number;
    importsStuck: number; importsFailed30: number; emailSuppressed: number; hardBounces: number;
    suppressionByReason: Record<string, number>; questionsUnanswered: number; queueFailing: number;
  };
  incentives: { issued: number; redeemed: number; redemptionRate: number | null };
  series: Record<'reviews' | 'installs' | 'requests', Array<{ day: string; n: number }>>;
}

interface StoreRow {
  id: string; name: string; shopifyDomain: string | null; email: string | null;
  plan: string; isActive: boolean; installedAt: string | null; createdAt: string;
  reviewCount: number; lastReviewAt: string | null; pendingReviews: number;
  requestsSentThisMonth: number; failingRequests: number; sendingPaused: boolean;
  mrr: number; quotaUsed: number; quotaCap: number | null; quotaPct: number | null;
  productCount: number; needsReauth: boolean; activation: 'active' | 'synced' | 'cold';
}

interface StoreDetail {
  store: StoreRow & { tokenExpiresAt: string | null; refreshTokenExpiresAt: string | null; updatedAt: string };
  usage: { used: number; limit: number | null; resetsAt?: string };
  settings: Array<{ key: string; value: string; updatedAt: string }>;
  counts: {
    products: number; questions: number; widgets: number; incentives: number;
    reviewsByStatus: Record<string, number>; requestsCreated30: number;
  };
  recentReviews: Array<{ id: string; rating: number; title: string | null; isPublished: boolean; reviewerName: string | null; source: string; createdAt: string }>;
  recentRequests: Array<{ id: string; orderNumber: string | null; customerEmail: string; sentAt: string | null; openedAt: string | null; submittedAt: string | null; nextSendAt: string | null; sendCount: number; sendFailures: number; createdAt: string }>;
  sendingPaused: boolean;
  note: string;
  links: { shopifyAdmin: string; appInAdmin: string; storefront: string } | null;
}

interface Suppression { email: string; reason: string; detail: string | null; createdAt: string }

/* ────────────────────────── small pieces ────────────────────────── */

function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  return new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: n % 1 === 0 ? 0 : 2 })}`;
const pct = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : `${(n * 100).toFixed(digits)}%`;

/**
 * The number the dashboard leads with. A hero figure, not a one-bar chart - it is a
 * single current value, and the delta beside it is the only comparison that matters.
 */
function Hero({ label, value, sub, delta }: {
  label: string; value: string; sub?: string; delta?: { n: number; label: string };
}) {
  return (
    <div className="surface rounded-2xl p-5">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">{label}</p>
      <div className="mt-2 flex items-baseline gap-2.5">
        {/* Proportional figures, same sans as everything else - tabular-nums makes a
            display-size number read loose, and a serif would read as decoration. */}
        <span className="display text-[40px] font-bold leading-none text-ink-900 dark:text-white">{value}</span>
        {delta && (
          <span className={`text-[12.5px] font-semibold ${delta.n > 0 ? 'text-brand-600 dark:text-brand-400' : delta.n < 0 ? 'text-red-600' : 'text-ink-400'}`}>
            {delta.n > 0 ? '+' : ''}{delta.n} {delta.label}
          </span>
        )}
      </div>
      {sub && <p className="mt-2 text-[12px] text-ink-400">{sub}</p>}
    </div>
  );
}

/**
 * Health items. Quiet at zero, loud otherwise - an operator should be able to glance at
 * this block and look away, which only works if a green row is visually silent.
 */
function Attention({ items }: { items: Array<{ label: string; n: number; hint: string; severe?: boolean }> }) {
  const live = items.filter((i) => i.n > 0);
  return (
    <div className="surface rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold text-ink-700 dark:text-ink-200">Needs attention</p>
        {live.length === 0 && (
          <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-brand-600 dark:text-brand-400">
            <ShieldCheck className="size-3.5" /> All clear
          </span>
        )}
      </div>
      {live.length === 0 ? (
        <p className="mt-2 text-[12px] text-ink-400">
          No dead tokens, blocked quotas, stuck imports or bouncing email.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {live.map((i) => (
            <li key={i.label} className="flex items-start gap-2.5">
              <span className={`tnum mt-px inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md px-1.5 text-[11px] font-bold ${
                i.severe ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
                         : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'}`}>
                {i.n}
              </span>
              <span className="text-[12px] leading-snug">
                <span className="font-semibold text-ink-800 dark:text-ink-100">{i.label}</span>
                <span className="text-ink-400"> — {i.hint}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Where reviews come from. Nominal categories, so one hue for every bar - a darker-where-
 * bigger ramp would double-encode the length the bar already shows and spend the only
 * free channel on nothing. Labels sit outside the bars so short ones stay readable.
 */
function SourceBars({ bySource }: { bySource: Record<string, number> }) {
  const rows = Object.entries(bySource).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((a, [, n]) => a + n, 0);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <div className="surface rounded-2xl p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[12px] font-semibold text-ink-700 dark:text-ink-200">Reviews by source</p>
        <p className="tnum text-[11.5px] text-ink-400">{total.toLocaleString()} total</p>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-[12px] text-ink-400">No reviews yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map(([source, n]) => (
            <li key={source} className="flex items-center gap-2.5">
              <span className="w-20 shrink-0 truncate text-[11.5px] text-ink-500" title={source}>{source}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-700/50">
                <span className="block h-full rounded-full bg-brand-500" style={{ width: `${(n / max) * 100}%` }} />
              </span>
              <span className="tnum w-14 shrink-0 text-right text-[11.5px] font-semibold text-ink-700 dark:text-ink-200">
                {n.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatTile({ label, value, sub, tone = 'default' }: {
  label: string; value: React.ReactNode; sub?: string; tone?: 'default' | 'warn';
}) {
  return (
    <div className="surface rounded-2xl p-4">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-400">{label}</p>
      <p className={`display mt-1.5 text-[26px] font-bold leading-none ${tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-ink-900 dark:text-white'}`}>
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[11.5px] text-ink-400">{sub}</p>}
    </div>
  );
}

/**
 * A 30-day single-series bar chart. One hue, hairline baseline, values on hover and in
 * the accessible label — never a rainbow, never a second axis.
 */
function TrendBars({ series, label }: { series: Array<{ day: string; n: number }>; label: string }) {
  const days = useMemo(() => {
    const map = new Map(series.map((s) => [s.day, s.n]));
    const out: Array<{ day: string; n: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      out.push({ day: d, n: map.get(d) ?? 0 });
    }
    return out;
  }, [series]);
  const max = Math.max(1, ...days.map((d) => d.n));
  const total = days.reduce((a, d) => a + d.n, 0);
  return (
    <div className="surface rounded-2xl p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[12px] font-semibold text-ink-700 dark:text-ink-200">{label}</p>
        <p className="tnum text-[11.5px] text-ink-400">{total.toLocaleString()} in 30 days</p>
      </div>
      <div className="mt-3 flex h-16 items-end gap-px border-b border-border" role="img" aria-label={`${label}: ${total} in the last 30 days`}>
        {days.map((d) => (
          <div
            key={d.day}
            title={`${d.day}: ${d.n}`}
            className="flex-1 rounded-t-[2px] bg-brand-500/80 transition-colors hover:bg-brand-600"
            style={{ height: `${Math.max(d.n > 0 ? 6 : 1, (d.n / max) * 100)}%`, opacity: d.n === 0 ? 0.25 : 1 }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-300">
        <span>{fmtDate(days[0].day)}</span>
        <span>{fmtDate(days[29].day)}</span>
      </div>
    </div>
  );
}

const PLAN_CHIP: Record<string, string> = {
  free: 'bg-ink-100 text-ink-600 dark:bg-ink-700/60 dark:text-ink-200',
  growth: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300',
  scale: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300',
};

function PlanChip({ plan }: { plan: string }) {
  return (
    <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide ${PLAN_CHIP[plan] ?? PLAN_CHIP.free}`}>
      {plan}
    </span>
  );
}

/** One operation control. Shows its own busy state so an operator can see which of the
 *  several buttons on this panel is the one currently working. */
function OpButton({ busy, action, onClick, children, icon: Icon, primary, disabled }: {
  busy: string; action: string; onClick: () => void; children: React.ReactNode;
  icon?: typeof RefreshCw; primary?: boolean; disabled?: boolean;
}) {
  const isBusy = busy === action;
  return (
    <button
      onClick={onClick}
      disabled={!!busy || disabled}
      className={
        primary
          ? 'ring-focus inline-flex h-9 items-center gap-1.5 rounded-xl bg-brand-600 px-3 text-[12.5px] font-semibold text-white hover:bg-brand-700 disabled:opacity-40'
          : 'ring-focus inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-[12.5px] font-semibold text-ink-700 hover:border-ink-300 disabled:opacity-40 dark:text-ink-200'
      }
    >
      {isBusy ? <Loader2 className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  );
}

/* ────────────────────────── login ────────────────────────── */

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) onDone();
    else setError(res.status === 429 ? 'Too many attempts — wait fifteen minutes.' : 'Wrong password.');
  };
  return (
    <div className="aurora flex min-h-screen items-center justify-center bg-background p-6">
      <form onSubmit={submit} className="surface w-full max-w-sm rounded-2xl p-8">
        <span className="tile tile-brand mx-auto mb-4 flex size-12 items-center justify-center">
          <ShieldCheck className="size-6" />
        </span>
        <h1 className="text-center text-[16px] font-bold text-ink-900 dark:text-white">Operator portal</h1>
        <p className="mt-1 text-center text-[12.5px] text-ink-400">ReviewMaster internal — not for merchants.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Operator password"
          autoFocus
          className="ring-focus mt-5 h-10 w-full rounded-xl border border-border bg-transparent px-3 text-[13px] text-ink-900 dark:text-white"
        />
        {error && <p className="mt-2 text-[12px] font-medium text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 flex h-10 w-full items-center justify-center rounded-xl bg-brand-600 text-[13px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

/* ────────────────────────── store drawer ────────────────────────── */

function StoreDrawer({ storeId, onClose, onChanged }: { storeId: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<StoreDetail | null>(null);
  const [error, setError] = useState('');
  const [opBusy, setOpBusy] = useState('');
  const [opNote, setOpNote] = useState('');
  const [planDraft, setPlanDraft] = useState('');
  const [quotaDraft, setQuotaDraft] = useState('100');
  const [noteDraft, setNoteDraft] = useState('');

  const load = useCallback(async () => {
    setError('');
    const res = await fetch(`/api/admin/stores/${storeId}`);
    if (!res.ok) { setError('Could not load this store.'); return; }
    const d: StoreDetail = await res.json();
    setDetail(d);
    setPlanDraft(d.store.plan);
    setNoteDraft(d.note ?? '');
  }, [storeId]);
  /* eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch on mount; the
     setState is inside an awaited callback, not a synchronous cascade. */
  useEffect(() => { load(); }, [load]);

  const op = async (action: string, extra: Record<string, unknown> = {}) => {
    setOpBusy(action);
    setOpNote('');
    const res = await fetch(`/api/admin/stores/${storeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    const j = await res.json().catch(() => ({}));
    setOpBusy('');
    if (!res.ok) { setOpNote(j.error || 'Operation failed'); return; }
    setOpNote(j.note || 'Done.');
    await load();
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-2xl overflow-y-auto bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {!detail && !error && (
          <div className="flex h-40 items-center justify-center"><Loader2 className="size-5 animate-spin text-ink-400" /></div>
        )}
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        {detail && (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-[18px] font-bold text-ink-900 dark:text-white">{detail.store.name}</h2>
                <p className="mt-0.5 truncate text-[12.5px] text-ink-400">
                  {detail.store.shopifyDomain} · {detail.store.email || 'no email'}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <PlanChip plan={detail.store.plan} />
                  {!detail.store.isActive && (
                    <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700 dark:bg-red-500/10 dark:text-red-300">Uninstalled</span>
                  )}
                  {detail.sendingPaused && (
                    <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">Sending paused</span>
                  )}
                  <span className="text-[11.5px] text-ink-400">installed {fmtDate(detail.store.installedAt)}</span>
                </div>
                {detail.note && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                    <StickyNote className="mr-1 inline size-3" />{detail.note}
                  </p>
                )}
              </div>
              <button onClick={onClose} className="ring-focus rounded-lg p-1.5 text-ink-400 hover:text-ink-700" aria-label="Close">
                <X className="size-5" />
              </button>
            </div>

            {/* Counts */}
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Products" value={detail.counts.products.toLocaleString()} />
              <StatTile
                label="Reviews"
                value={Object.values(detail.counts.reviewsByStatus).reduce((a, b) => a + b, 0).toLocaleString()}
                sub={`${detail.counts.reviewsByStatus.pending ?? 0} pending`}
              />
              <StatTile
                label="Requests / mo"
                value={`${detail.usage.used}${detail.usage.limit != null ? ` / ${detail.usage.limit}` : ''}`}
                sub={detail.usage.limit == null ? 'No cap on this plan' : undefined}
              />
              <StatTile label="Q&A / widgets" value={`${detail.counts.questions} / ${detail.counts.widgets}`} />
            </div>

            {/* Links */}
            {detail.links && (
              <div className="mt-4 flex flex-wrap gap-2">
                {[
                  { href: detail.links.appInAdmin, label: 'Open their app' },
                  { href: detail.links.shopifyAdmin, label: 'Their Shopify admin' },
                  { href: detail.links.storefront, label: 'Storefront' },
                ].map((l) => (
                  <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer"
                    className="ring-focus inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11.5px] font-medium text-ink-600 hover:border-ink-300 dark:text-ink-300">
                    {l.label} <ExternalLink className="size-3" />
                  </a>
                ))}
              </div>
            )}

            {/* Operations */}
            <div className="surface mt-5 rounded-2xl p-4">
              <p className="text-[12px] font-semibold text-ink-700 dark:text-ink-200">Operations</p>

              <p className="mt-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-400">Plan &amp; billing</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={planDraft}
                  onChange={(e) => setPlanDraft(e.target.value)}
                  className="ring-focus h-9 rounded-xl border border-border bg-transparent px-2 text-[12.5px] text-ink-800 dark:text-ink-100"
                >
                  <option value="free">free</option>
                  <option value="growth">growth</option>
                  <option value="scale">scale</option>
                </select>
                <OpButton busy={opBusy} action="set-plan" disabled={planDraft === detail.store.plan} primary
                  onClick={() => op('set-plan', { plan: planDraft })}>Set plan</OpButton>
                <OpButton busy={opBusy} action="reconcile-billing" icon={RefreshCw}
                  onClick={() => op('reconcile-billing')}>Reconcile with Shopify billing</OpButton>
              </div>

              <p className="mt-4 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-400">Review request emails</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <OpButton busy={opBusy} action={detail.sendingPaused ? 'resume-sending' : 'pause-sending'}
                  icon={detail.sendingPaused ? PlayCircle : PauseCircle}
                  onClick={() => op(detail.sendingPaused ? 'resume-sending' : 'pause-sending')}>
                  {detail.sendingPaused ? 'Resume emails' : 'Pause emails'}
                </OpButton>
                <OpButton busy={opBusy} action="retry-failed-sends" icon={RotateCcw}
                  onClick={() => op('retry-failed-sends')}>Retry failed sends now</OpButton>
                <span className="inline-flex items-center gap-1.5">
                  <input
                    type="number" min={1} max={10000} value={quotaDraft}
                    onChange={(e) => setQuotaDraft(e.target.value)}
                    aria-label="Sends to credit"
                    className="ring-focus h-9 w-20 rounded-xl border border-border bg-transparent px-2 text-[12.5px] text-ink-800 dark:text-ink-100"
                  />
                  <OpButton busy={opBusy} action="grant-quota" icon={Gift}
                    onClick={() => op('grant-quota', { amount: Number(quotaDraft) })}>Credit sends</OpButton>
                </span>
              </div>

              <p className="mt-4 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-400">Data &amp; sync</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <OpButton busy={opBusy} action="resync-products" icon={Boxes}
                  onClick={() => op('resync-products')}>Resync products from Shopify</OpButton>
                <OpButton busy={opBusy} action="recompute-ratings" icon={Calculator}
                  onClick={() => op('recompute-ratings')}>Recompute star ratings</OpButton>
                <OpButton busy={opBusy} action="clear-stuck-imports" icon={Trash2}
                  onClick={() => op('clear-stuck-imports')}>Clear stalled imports</OpButton>
              </div>

              <p className="mt-4 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-400">Operator note</p>
              <div className="mt-2 flex items-start gap-2">
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  rows={2}
                  placeholder="Context for whoever picks this up next — what you emailed them, what they asked for."
                  className="ring-focus min-h-16 flex-1 rounded-xl border border-border bg-transparent p-2 text-[12.5px] text-ink-800 dark:text-ink-100"
                />
                <OpButton busy={opBusy} action="set-note" icon={StickyNote}
                  onClick={() => op('set-note', { note: noteDraft })}>Save</OpButton>
              </div>

              {opNote && <p className="mt-3 rounded-lg bg-ink-50 px-2.5 py-1.5 text-[12px] text-ink-600 dark:bg-white/[0.04] dark:text-ink-300">{opNote}</p>}
              <p className="mt-2.5 text-[11px] leading-relaxed text-ink-400">
                Nothing here deletes a merchant&rsquo;s data. Erasure goes through the GDPR path, which is audited and has guarantees a button does not.
              </p>
            </div>

            {/* Recent reviews */}
            <div className="surface mt-5 overflow-hidden rounded-2xl">
              <p className="px-4 pt-4 text-[12px] font-semibold text-ink-700 dark:text-ink-200">Latest reviews</p>
              {detail.recentReviews.length === 0 ? (
                <p className="px-4 py-4 text-[12.5px] text-ink-400">None yet.</p>
              ) : (
                <table className="mt-2 w-full text-[12px]">
                  <tbody>
                    {detail.recentReviews.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="tnum px-4 py-2 text-amber-500">{'★'.repeat(r.rating)}</td>
                        <td className="max-w-0 truncate px-2 py-2 text-ink-700 dark:text-ink-200">{r.title || '(no title)'}</td>
                        <td className="px-2 py-2 text-ink-400">{r.reviewerName || '—'}</td>
                        <td className="px-2 py-2"><span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-500 dark:bg-ink-700/60 dark:text-ink-300">{r.isPublished ? 'published' : 'pending'}</span></td>
                        <td className="tnum px-2 py-2 text-right text-ink-400">{fmtDate(r.createdAt)}</td>
                        <td className="px-4 py-2 text-right">
                          {/* Moderation on the merchant's behalf, for what they cannot
                              handle themselves: a takedown, a review carrying someone's
                              personal data, abuse. Reversible either way. */}
                          <button
                            onClick={() => op('set-review-published', { reviewId: r.id, publish: !r.isPublished })}
                            disabled={!!opBusy}
                            title={r.isPublished ? 'Unpublish this review' : 'Publish this review'}
                            aria-label={r.isPublished ? 'Unpublish this review' : 'Publish this review'}
                            className="ring-focus rounded-lg p-1 text-ink-400 hover:text-ink-800 disabled:opacity-40 dark:hover:text-white"
                          >
                            {r.isPublished ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Recent requests */}
            <div className="surface mt-5 overflow-hidden rounded-2xl">
              <p className="px-4 pt-4 text-[12px] font-semibold text-ink-700 dark:text-ink-200">Latest review requests</p>
              {detail.recentRequests.length === 0 ? (
                <p className="px-4 py-4 text-[12.5px] text-ink-400">None yet.</p>
              ) : (
                <table className="mt-2 w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-[10.5px] font-bold uppercase tracking-wide text-ink-400">
                      <th className="px-4 py-1.5">Order</th><th className="px-2 py-1.5">Customer</th>
                      <th className="px-2 py-1.5">Sent</th><th className="px-2 py-1.5">Submitted</th>
                      <th className="px-4 py-1.5 text-right">Failures</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.recentRequests.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="tnum px-4 py-2 text-ink-700 dark:text-ink-200">{r.orderNumber || '—'}</td>
                        <td className="px-2 py-2 text-ink-400">{r.customerEmail}</td>
                        <td className="tnum px-2 py-2 text-ink-400">{fmtDate(r.sentAt)}</td>
                        <td className="tnum px-2 py-2 text-ink-400">{r.submittedAt ? fmtDate(r.submittedAt) : '—'}</td>
                        <td className={`tnum px-4 py-2 text-right ${r.sendFailures > 0 ? 'font-semibold text-amber-600' : 'text-ink-400'}`}>{r.sendFailures}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Settings dump */}
            <details className="surface mt-5 rounded-2xl p-4">
              <summary className="cursor-pointer text-[12px] font-semibold text-ink-700 dark:text-ink-200">
                Raw store settings ({detail.settings.length})
              </summary>
              <table className="mt-2 w-full text-[11.5px]">
                <tbody>
                  {detail.settings.map((s) => (
                    <tr key={s.key} className="border-t border-border align-top">
                      <td className="py-1.5 pr-3 font-mono text-ink-500">{s.key}</td>
                      <td className="max-w-0 truncate py-1.5 font-mono text-ink-400" title={s.value}>{s.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The suppression list, with the undo.
 *
 * A wrongly-suppressed address is a customer who will never be asked for a review again,
 * silently and permanently — a full mailbox and a provider blip both land here looking
 * exactly like a real hard bounce. So it has to be visible, searchable, and reversible.
 */
function SuppressionPanel() {
  const [rows, setRows] = useState<Suppression[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/suppressions${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    if (!r.ok) return;
    const j = await r.json();
    setRows(j.suppressions);
    setTotal(j.total);
  }, [q]);
  /* eslint-disable-next-line react-hooks/set-state-in-effect -- lazy fetch when the panel opens. */
  useEffect(() => { if (open) load(); }, [open, load]);

  const remove = async (email: string) => {
    setBusy(email);
    await fetch('/api/admin/suppressions', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    setBusy('');
    load();
  };

  return (
    <div className="surface mt-4 overflow-hidden rounded-2xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="ring-focus flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[13px] font-bold text-ink-900 dark:text-white">
          <MailX className="size-4 text-ink-400" /> Email suppression list
        </span>
        <span className="flex items-center gap-2 text-[11.5px] text-ink-400">
          {total > 0 && <span className="tnum">{total.toLocaleString()} address{total === 1 ? '' : 'es'}</span>}
          <ChevronRight className={`size-4 transition-transform ${open ? 'rotate-90' : ''}`} />
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <div className="relative w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-300" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search an address…"
              className="ring-focus h-9 w-full rounded-xl border border-border bg-transparent pl-8 pr-3 text-[12.5px] text-ink-800 dark:text-ink-100"
            />
          </div>
          {rows.length === 0 ? (
            <p className="mt-3 text-[12.5px] text-ink-400">
              {total === 0 ? 'Nothing suppressed — every address is mailable.' : 'No address matches.'}
            </p>
          ) : (
            <table className="mt-3 w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10.5px] font-bold uppercase tracking-wide text-ink-400">
                  <th className="py-1.5">Address</th><th className="py-1.5">Reason</th>
                  <th className="py-1.5">Detail</th><th className="py-1.5">When</th><th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.email} className="border-t border-border">
                    <td className="py-2 font-mono text-ink-700 dark:text-ink-200">{s.email}</td>
                    <td className="py-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                        s.reason === 'bounce' || s.reason === 'complaint'
                          ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
                          : 'bg-ink-100 text-ink-500 dark:bg-ink-700/60 dark:text-ink-300'}`}>
                        {s.reason}
                      </span>
                    </td>
                    <td className="max-w-0 truncate py-2 text-ink-400" title={s.detail ?? ''}>{s.detail || '—'}</td>
                    <td className="tnum py-2 text-ink-400">{fmtDate(s.createdAt)}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => remove(s.email)}
                        disabled={busy === s.email}
                        className="ring-focus rounded-lg px-2 py-1 text-[11.5px] font-semibold text-ink-500 hover:text-ink-900 disabled:opacity-40 dark:hover:text-white"
                      >
                        {busy === s.email ? '…' : 'Allow again'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────── main ────────────────────────── */

type SortKey = 'createdAt' | 'reviewCount' | 'pendingReviews' | 'requestsSentThisMonth' | 'failingRequests' | 'mrr' | 'quotaUsed';

export default function AdminPortal() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [storeTotal, setStoreTotal] = useState<{ total: number; showing: number; truncated: boolean } | null>(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('createdAt');
  const [openStore, setOpenStore] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    const [ov, st] = await Promise.all([
      fetch('/api/admin/overview').then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/admin/stores${q ? `?q=${encodeURIComponent(q)}` : ''}`).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (ov) setOverview(ov);
    if (st) { setStores(st.stores); setStoreTotal({ total: st.total, showing: st.showing, truncated: st.truncated }); }
    setRefreshing(false);
  }, [q]);

  useEffect(() => {
    fetch('/api/admin/login').then((r) => setAuthed(r.ok));
  }, []);
  /* eslint-disable react-hooks/set-state-in-effect -- refetch when auth or the search
     term changes; every setState is behind an await, not a synchronous cascade. */
  useEffect(() => {
    if (authed) loadAll();
  }, [authed, loadAll]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const sorted = useMemo(() => {
    const copy = [...stores];
    copy.sort((a, b) => {
      if (sort === 'createdAt') return +new Date(b.createdAt) - +new Date(a.createdAt);
      return (b[sort] as number) - (a[sort] as number);
    });
    return copy;
  }, [stores, sort]);

  if (authed === null) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="size-5 animate-spin text-ink-400" /></div>;
  }
  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const conv = overview?.requests.conversion30;

  return (
    <div className="aurora min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="tile tile-brand flex size-8 items-center justify-center"><Star className="size-4" fill="currentColor" strokeWidth={0} /></span>
            <div>
              <p className="text-[13px] font-bold leading-tight text-ink-900 dark:text-white">ReviewMaster</p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Operator portal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadAll}
              className="ring-focus inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-[12.5px] font-semibold text-ink-600 hover:border-ink-300 dark:text-ink-300"
            >
              <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <button
              onClick={async () => { await fetch('/api/admin/login', { method: 'DELETE' }); setAuthed(false); }}
              className="ring-focus inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-[12.5px] font-semibold text-ink-600 hover:border-ink-300 dark:text-ink-300"
            >
              <LogOut className="size-3.5" /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
        {/* ── Business: the four numbers you check first ── */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Hero
            label="MRR"
            value={overview ? money(overview.business.mrr) : '…'}
            sub={overview ? `${overview.business.paidCount} paying of ${overview.stores.active} active · ${pct(overview.business.paidShare)} paid · ${money(overview.business.arpu)} ARPU` : undefined}
          />
          <Hero
            label="Active merchants"
            value={overview ? overview.stores.active.toLocaleString() : '…'}
            delta={overview ? { n: overview.business.netChange30, label: 'net 30d' } : undefined}
            sub={overview ? `${overview.business.installs30} installed, ${overview.business.uninstalled30} left · prior 30d: ${overview.business.installsPrev30} installs` : undefined}
          />
          <Hero
            label="Activated"
            value={overview ? pct(overview.activation.rate) : '…'}
            sub={overview ? `${overview.activation.activated} collecting reviews · ${overview.activation.syncedOnly} set up but silent · ${overview.activation.cold} never started` : undefined}
          />
          <Hero
            label="Churn (30d)"
            value={overview ? pct(overview.business.churnRate30, 1) : '…'}
            sub={overview ? `${overview.business.uninstalled30} uninstalled in the last 30 days` : undefined}
          />
        </div>

        {/* ── Health + plan mix ── */}
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {overview && (
              <Attention
                items={[
                  { label: `${overview.health.needsReauth} store${overview.health.needsReauth === 1 ? '' : 's'} need re-auth`, n: overview.health.needsReauth, hint: 'refresh token expired — the app cannot call Shopify for them at all', severe: true },
                  { label: 'Tokens expiring within 7 days', n: overview.health.tokenExpiringSoon, hint: 'will break silently unless refreshed' },
                  { label: 'At their monthly send cap', n: overview.health.atQuota, hint: 'review requests are being deferred — support risk and upgrade signal', severe: true },
                  { label: 'Near their cap (80%+)', n: overview.health.nearQuota, hint: 'about to be blocked this month' },
                  { label: 'Failing review-request sends', n: overview.health.queueFailing, hint: 'retrying with backoff; check the provider if this climbs' },
                  { label: 'Imports stuck in processing', n: overview.health.importsStuck, hint: 'claimed over an hour ago and never finished' },
                  { label: 'Imports failed (30d)', n: overview.health.importsFailed30, hint: 'merchant-visible failure' },
                  { label: 'Hard bounces / complaints', n: overview.health.hardBounces, hint: 'suppressed addresses — deliverability risk', severe: true },
                  { label: 'Suppressed addresses (total)', n: overview.health.emailSuppressed, hint: Object.entries(overview.health.suppressionByReason).map(([r, n]) => `${n} ${r}`).join(', ') || 'bounce, complaint, unsubscribe' },
                  { label: 'Unanswered questions', n: overview.health.questionsUnanswered, hint: 'shoppers waiting on a merchant reply' },
                  { label: 'Reviews awaiting moderation', n: overview.reviews.pendingModeration, hint: 'sitting unpublished across all stores' },
                ]}
              />
            )}
          </div>
          <div className="surface rounded-2xl p-4">
            <p className="text-[12px] font-semibold text-ink-700 dark:text-ink-200">Plan mix</p>
            {overview && (
              <ul className="mt-3 space-y-2.5">
                {(['free', 'growth', 'scale'] as const).map((plan) => {
                  const n = overview.stores.byPlan[plan] ?? 0;
                  const rev = overview.business.revenueByPlan[plan] ?? 0;
                  return (
                    <li key={plan} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2"><PlanChip plan={plan} /><span className="tnum text-[12.5px] text-ink-700 dark:text-ink-200">{n}</span></span>
                      <span className="tnum text-[12px] text-ink-400">{money(rev)}/mo</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {overview && (
              <div className="mt-4 border-t border-border pt-3 text-[11.5px] text-ink-400">
                <p className="flex justify-between"><span>Avg rating</span><span className="tnum font-semibold text-ink-700 dark:text-ink-200">{overview.reviews.avgRating != null ? overview.reviews.avgRating.toFixed(2) : '—'}</span></p>
                <p className="mt-1.5 flex justify-between"><span>Discount codes issued</span><span className="tnum font-semibold text-ink-700 dark:text-ink-200">{overview.incentives.issued.toLocaleString()}</span></p>
                <p className="mt-1.5 flex justify-between"><span>…redeemed</span><span className="tnum font-semibold text-ink-700 dark:text-ink-200">{overview.incentives.redeemed.toLocaleString()}{overview.incentives.redemptionRate != null ? ` (${pct(overview.incentives.redemptionRate)})` : ''}</span></p>
              </div>
            )}
          </div>
        </div>

        {/* ── Volume ── */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <StatTile label="Reviews" value={overview ? overview.reviews.total.toLocaleString() : '…'} sub={overview ? `${overview.reviews.last30.toLocaleString()} in 30d` : undefined} />
          <StatTile label="Requests sent (30d)" value={overview ? overview.requests.sent30.toLocaleString() : '…'} sub={overview ? `${overview.requests.opened30} clicked through` : undefined} />
          <StatTile label="Request → review" value={conv != null ? pct(conv, 1) : '…'} sub={overview ? `${overview.requests.submitted30} reviews from requests` : undefined} />
          <StatTile label="Send queue" value={overview ? overview.requests.queueDue.toLocaleString() : '…'} sub="due right now" />
          <StatTile label="Pending moderation" value={overview ? overview.reviews.pendingModeration.toLocaleString() : '…'} tone={overview && overview.reviews.pendingModeration > 0 ? 'warn' : 'default'} sub="across all stores" />
        </div>

        {/* ── Trends ── */}
        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          {overview && <TrendBars series={overview.series.installs} label="New installs" />}
          {overview && <TrendBars series={overview.series.reviews} label="Reviews collected" />}
          {overview && <TrendBars series={overview.series.requests} label="Request emails sent" />}
          {overview && <SourceBars bySource={overview.reviews.bySource} />}
        </div>

        {/* Merchants table */}
        <div className="surface mt-6 overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
            <p className="text-[13px] font-bold text-ink-900 dark:text-white">
              Merchants
              {storeTotal && (
                <span className="ml-2 text-[11.5px] font-normal text-ink-400">
                  {storeTotal.truncated
                    ? `showing ${storeTotal.showing} of ${storeTotal.total} — narrow the search to see the rest`
                    : `${storeTotal.total}`}
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-300" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && loadAll()}
                  placeholder="Search name, domain, email…"
                  className="ring-focus h-9 w-64 rounded-xl border border-border bg-transparent pl-8 pr-3 text-[12.5px] text-ink-800 dark:text-ink-100"
                />
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="ring-focus h-9 rounded-xl border border-border bg-transparent px-2 text-[12px] text-ink-600 dark:text-ink-300"
                aria-label="Sort merchants"
              >
                <option value="createdAt">Newest</option>
                <option value="reviewCount">Most reviews</option>
                <option value="pendingReviews">Most pending</option>
                <option value="requestsSentThisMonth">Most emails this month</option>
                <option value="failingRequests">Failing sends</option>
                <option value="mrr">Highest MRR</option>
                <option value="quotaUsed">Closest to cap</option>
              </select>
            </div>
          </div>

          {sorted.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-ink-400">
              <Inbox className="size-6" />
              <p className="text-[12.5px]">No merchants match.</p>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[1040px] text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10.5px] font-bold uppercase tracking-wide text-ink-400">
                    <th className="px-4 py-2">Store</th>
                    <th className="px-2 py-2">Plan</th>
                    <th className="px-2 py-2 text-right">MRR</th>
                    <th className="px-2 py-2 text-right">Reviews</th>
                    <th className="px-2 py-2 text-right">Pending</th>
                    <th className="px-2 py-2">Quota</th>
                    <th className="px-2 py-2 text-right">Failing</th>
                    <th className="px-2 py-2">Installed</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => setOpenStore(s.id)}
                      className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-ink-50/60 dark:hover:bg-white/[0.03]"
                    >
                      <td className="max-w-0 truncate px-4 py-2.5">
                        <span className="font-semibold text-ink-800 dark:text-ink-100">{s.name}</span>
                        <span className="ml-2 text-ink-400">{s.shopifyDomain}</span>
                        {s.productCount === 0 && <span className="ml-2 text-[10px] font-semibold uppercase text-ink-300">no products</span>}
                      </td>
                      <td className="px-2 py-2.5"><PlanChip plan={s.plan} /></td>
                      <td className="tnum px-2 py-2.5 text-right text-ink-700 dark:text-ink-200">{s.mrr > 0 ? money(s.mrr) : '—'}</td>
                      <td className="tnum px-2 py-2.5 text-right text-ink-700 dark:text-ink-200">{s.reviewCount.toLocaleString()}</td>
                      <td className={`tnum px-2 py-2.5 text-right ${s.pendingReviews > 0 ? 'font-semibold text-amber-600' : 'text-ink-400'}`}>{s.pendingReviews}</td>
                      <td className="px-2 py-2.5">
                        {s.quotaCap == null ? (
                          <span className="text-[11px] text-ink-400">no cap</span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <span className="tnum text-[11.5px] text-ink-600 dark:text-ink-300">{s.quotaUsed}/{s.quotaCap}</span>
                            <span className="h-1.5 w-10 overflow-hidden rounded-full bg-ink-100 dark:bg-ink-700/50">
                              <span
                                className={`block h-full rounded-full ${(s.quotaPct ?? 0) >= 100 ? 'bg-red-500' : (s.quotaPct ?? 0) >= 80 ? 'bg-amber-500' : 'bg-brand-500'}`}
                                style={{ width: `${s.quotaPct ?? 0}%` }}
                              />
                            </span>
                          </span>
                        )}
                      </td>
                      <td className={`tnum px-2 py-2.5 text-right ${s.failingRequests > 0 ? 'font-semibold text-red-600' : 'text-ink-400'}`}>{s.failingRequests}</td>
                      <td className="tnum px-2 py-2.5 text-ink-400">{fmtDate(s.installedAt)}</td>
                      <td className="px-2 py-2.5">
                        {!s.isActive ? (
                          <span className="text-[11px] font-semibold text-red-600">uninstalled</span>
                        ) : s.needsReauth ? (
                          <span className="text-[11px] font-semibold text-red-600">needs re-auth</span>
                        ) : s.sendingPaused ? (
                          <span className="text-[11px] font-semibold text-amber-600">paused</span>
                        ) : s.activation === 'cold' ? (
                          <span className="text-[11px] text-ink-400">never started</span>
                        ) : s.activation === 'synced' ? (
                          <span className="text-[11px] text-ink-400">no reviews yet</span>
                        ) : (
                          <span className="text-[11px] font-medium text-brand-600 dark:text-brand-400">collecting</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right"><ChevronRight className="ml-auto size-4 text-ink-300" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <SuppressionPanel />

        <p className="mt-6 flex items-center gap-1.5 text-[11px] text-ink-400">
          <ShieldCheck className="size-3.5" />
          Tokens are never returned by these APIs; customer emails are masked; there are no destructive operations.
        </p>
      </main>

      {openStore && <StoreDrawer storeId={openStore} onClose={() => setOpenStore(null)} onChanged={loadAll} />}
    </div>
  );
}
