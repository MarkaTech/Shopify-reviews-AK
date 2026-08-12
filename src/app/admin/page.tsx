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
  Star, Search, RefreshCw, LogOut, Store as StoreIcon, MessagesSquare, Send,
  AlertTriangle, PauseCircle, PlayCircle, X, Loader2, ShieldCheck, Inbox, ChevronRight,
} from 'lucide-react';

/* ────────────────────────── types ────────────────────────── */

interface Overview {
  stores: { total: number; active: number; installs30: number; byPlan: Record<string, number> };
  reviews: { total: number; last30: number; pendingModeration: number };
  requests: { sent30: number; submitted30: number; conversion30: number | null; queueDue: number; queueFailing: number };
  questions: { unanswered: number };
  series: Record<'reviews' | 'installs' | 'requests', Array<{ day: string; n: number }>>;
}

interface StoreRow {
  id: string; name: string; shopifyDomain: string | null; email: string | null;
  plan: string; isActive: boolean; installedAt: string | null; createdAt: string;
  reviewCount: number; lastReviewAt: string | null; pendingReviews: number;
  requestsSentThisMonth: number; failingRequests: number; sendingPaused: boolean;
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
}

/* ────────────────────────── small pieces ────────────────────────── */

function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  return new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
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

  const load = useCallback(async () => {
    setError('');
    const res = await fetch(`/api/admin/stores/${storeId}`);
    if (!res.ok) { setError('Could not load this store.'); return; }
    const d: StoreDetail = await res.json();
    setDetail(d);
    setPlanDraft(d.store.plan);
  }, [storeId]);
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

            {/* Operations */}
            <div className="surface mt-5 rounded-2xl p-4">
              <p className="text-[12px] font-semibold text-ink-700 dark:text-ink-200">Operations</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select
                  value={planDraft}
                  onChange={(e) => setPlanDraft(e.target.value)}
                  className="ring-focus h-9 rounded-xl border border-border bg-transparent px-2 text-[12.5px] text-ink-800 dark:text-ink-100"
                >
                  <option value="free">free</option>
                  <option value="growth">growth</option>
                  <option value="scale">scale</option>
                </select>
                <button
                  onClick={() => op('set-plan', { plan: planDraft })}
                  disabled={!!opBusy || planDraft === detail.store.plan}
                  className="ring-focus h-9 rounded-xl bg-brand-600 px-3 text-[12.5px] font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                >
                  {opBusy === 'set-plan' ? 'Applying…' : 'Set plan'}
                </button>
                <button
                  onClick={() => op(detail.sendingPaused ? 'resume-sending' : 'pause-sending')}
                  disabled={!!opBusy}
                  className="ring-focus inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-[12.5px] font-semibold text-ink-700 hover:border-ink-300 dark:text-ink-200"
                >
                  {detail.sendingPaused ? <PlayCircle className="size-4" /> : <PauseCircle className="size-4" />}
                  {detail.sendingPaused ? 'Resume emails' : 'Pause emails'}
                </button>
                <button
                  onClick={() => op('reconcile-billing')}
                  disabled={!!opBusy}
                  className="ring-focus inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-[12.5px] font-semibold text-ink-700 hover:border-ink-300 dark:text-ink-200"
                >
                  <RefreshCw className={`size-4 ${opBusy === 'reconcile-billing' ? 'animate-spin' : ''}`} />
                  Reconcile with Shopify billing
                </button>
              </div>
              {opNote && <p className="mt-2.5 text-[12px] text-ink-500">{opNote}</p>}
              <p className="mt-2.5 text-[11px] leading-relaxed text-ink-400">
                No deletion here by design — data erasure goes through the GDPR path, which is audited and irreversible-with-guarantees.
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
                        <td className="tnum px-4 py-2 text-right text-ink-400">{fmtDate(r.createdAt)}</td>
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

/* ────────────────────────── main ────────────────────────── */

type SortKey = 'createdAt' | 'reviewCount' | 'pendingReviews' | 'requestsSentThisMonth' | 'failingRequests';

export default function AdminPortal() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [stores, setStores] = useState<StoreRow[]>([]);
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
    if (st) setStores(st.stores);
    setRefreshing(false);
  }, [q]);

  useEffect(() => {
    fetch('/api/admin/login').then((r) => setAuthed(r.ok));
  }, []);
  useEffect(() => {
    if (authed) loadAll();
  }, [authed, loadAll]);

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
        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Merchants" value={overview ? overview.stores.total.toLocaleString() : '…'} sub={overview ? `${overview.stores.active} active · ${overview.stores.installs30} new in 30d` : undefined} />
          <StatTile label="Reviews" value={overview ? overview.reviews.total.toLocaleString() : '…'} sub={overview ? `${overview.reviews.last30.toLocaleString()} in 30d` : undefined} />
          <StatTile label="Pending moderation" value={overview ? overview.reviews.pendingModeration.toLocaleString() : '…'} tone={overview && overview.reviews.pendingModeration > 0 ? 'warn' : 'default'} />
          <StatTile label="Requests sent (30d)" value={overview ? overview.requests.sent30.toLocaleString() : '…'} sub={conv != null ? `${(conv * 100).toFixed(1)}% led to a review` : undefined} />
          <StatTile label="Send queue" value={overview ? overview.requests.queueDue.toLocaleString() : '…'} sub="due right now" />
          <StatTile label="Failing sends" value={overview ? overview.requests.queueFailing.toLocaleString() : '…'} tone={overview && overview.requests.queueFailing > 0 ? 'warn' : 'default'} sub={overview ? `${overview.questions.unanswered} unanswered questions` : undefined} />
        </div>

        {/* Trends */}
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {overview && <TrendBars series={overview.series.installs} label="New installs" />}
          {overview && <TrendBars series={overview.series.reviews} label="Reviews collected" />}
          {overview && <TrendBars series={overview.series.requests} label="Request emails sent" />}
        </div>

        {/* Plans strip */}
        {overview && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px] text-ink-500">
            <span className="font-semibold text-ink-700 dark:text-ink-200">Plans:</span>
            {Object.entries(overview.stores.byPlan).map(([plan, n]) => (
              <span key={plan} className="inline-flex items-center gap-1.5">
                <PlanChip plan={plan} /> <span className="tnum">{n}</span>
              </span>
            ))}
          </div>
        )}

        {/* Merchants table */}
        <div className="surface mt-6 overflow-hidden rounded-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
            <p className="text-[13px] font-bold text-ink-900 dark:text-white">Merchants</p>
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
              <table className="w-full min-w-[900px] text-[12.5px]">
                <thead>
                  <tr className="border-b border-border text-left text-[10.5px] font-bold uppercase tracking-wide text-ink-400">
                    <th className="px-4 py-2">Store</th>
                    <th className="px-2 py-2">Plan</th>
                    <th className="px-2 py-2 text-right">Reviews</th>
                    <th className="px-2 py-2 text-right">Pending</th>
                    <th className="px-2 py-2 text-right">Emails / mo</th>
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
                      </td>
                      <td className="px-2 py-2.5"><PlanChip plan={s.plan} /></td>
                      <td className="tnum px-2 py-2.5 text-right text-ink-700 dark:text-ink-200">{s.reviewCount.toLocaleString()}</td>
                      <td className={`tnum px-2 py-2.5 text-right ${s.pendingReviews > 0 ? 'font-semibold text-amber-600' : 'text-ink-400'}`}>{s.pendingReviews}</td>
                      <td className="tnum px-2 py-2.5 text-right text-ink-700 dark:text-ink-200">{s.requestsSentThisMonth}</td>
                      <td className={`tnum px-2 py-2.5 text-right ${s.failingRequests > 0 ? 'font-semibold text-red-600' : 'text-ink-400'}`}>{s.failingRequests}</td>
                      <td className="tnum px-2 py-2.5 text-ink-400">{fmtDate(s.installedAt)}</td>
                      <td className="px-2 py-2.5">
                        {!s.isActive ? (
                          <span className="text-[11px] font-semibold text-red-600">uninstalled</span>
                        ) : s.sendingPaused ? (
                          <span className="text-[11px] font-semibold text-amber-600">paused</span>
                        ) : (
                          <span className="text-[11px] text-ink-400">active</span>
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

        <p className="mt-6 flex items-center gap-1.5 text-[11px] text-ink-400">
          <ShieldCheck className="size-3.5" />
          Tokens are never returned by these APIs; customer emails are masked; there are no destructive operations.
        </p>
      </main>

      {openStore && <StoreDrawer storeId={openStore} onClose={() => setOpenStore(null)} onChanged={loadAll} />}
    </div>
  );
}
