'use client';

import React, { useState, useEffect } from 'react';
import {
  Star, MessageSquare, Eye, BadgeCheck, Camera, TrendingUp, Inbox,
  ArrowRight, Clock, Sparkles, ShieldCheck, PieChart as PieIcon,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { apiFetch } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import OnboardingFlow from './OnboardingFlow';
import type { PageId } from './Sidebar';
import {
  Panel, PanelHeader, StatCard, StatSkeletonRow, Skeleton, Stars, Pill,
  Meter, EmptyState, ActionButton, SectionTitle, Tile, CountUp,
} from './ui-kit';

interface Analytics {
  totalReviews: number;
  publishedReviews: number;
  pendingReviews: number;
  averageRating: number;
  ratingDistribution: Record<string, number>;
  reviewsBySource: Record<string, number>;
  reviewsOverTime: { date: string; count: number }[];
  topProducts: {
    product: { id: string; title: string; image: string; price: number | null };
    reviewCount: number;
    avgRating: number;
  }[];
  recentReviews: Array<{
    id: string; reviewerName: string; rating: number; title: string | null; body: string;
    product: { id: string; title: string; image: string | null } | null;
    createdAt: string; source: string; isFeatured: boolean; verifiedPurchase: boolean;
  }>;
  verifiedPercentage: number;
  responseRate: number;
  sentimentDistribution: Record<string, number>;
  reviewsWithImages: number;
  featuredCount: number;
}

const SOURCE_LABELS: Record<string, string> = {
  direct: 'Direct', amazon: 'Amazon', ebay: 'eBay', etsy: 'Etsy',
  walmart: 'Walmart', alibaba: 'AliExpress', aliexpress: 'AliExpress',
  shopify: 'Shopify', csv: 'CSV', storefront: 'Storefront',
};

const SENTIMENT = [
  { key: 'positive', name: 'Positive', color: 'var(--brand-500)' },
  { key: 'neutral', name: 'Neutral', color: '#f59e0b' },
  { key: 'negative', name: 'Negative', color: '#e11d48' },
] as const;

export default function DashboardPage({
  onNavigate,
  storeName,
}: {
  onNavigate?: (page: PageId) => void;
  storeName?: string;
}) {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const go = onNavigate ?? (() => undefined);

  useEffect(() => {
    apiFetch<Analytics>('/api/analytics')
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <DashboardSkeleton />;

  if (!data) {
    return (
      <Panel className="py-4">
        <EmptyState
          icon={TrendingUp}
          tone="rose"
          title="Couldn’t load your analytics"
          description="The connection to your store dropped. This is usually momentary — reload and it should come back."
          action={
            <ActionButton onClick={() => window.location.reload()}>Reload</ActionButton>
          }
        />
      </Panel>
    );
  }

  const hasReviews = data.totalReviews > 0;
  const spark = data.reviewsOverTime.map((d) => d.count);

  const sentimentData = SENTIMENT.map((s) => ({
    name: s.name,
    value: data.sentimentDistribution[s.key] || 0,
    color: s.color,
  }));
  const sentimentTotal = sentimentData.reduce((a, b) => a + b.value, 0);

  const ratingRows = [5, 4, 3, 2, 1].map((n) => {
    const count = data.ratingDistribution[String(n)] || 0;
    return { stars: n, count, pct: data.totalReviews ? (count / data.totalReviews) * 100 : 0 };
  });

  const sources = Object.entries(data.reviewsBySource)
    .map(([key, value]) => ({ name: SOURCE_LABELS[key] || key, value }))
    .sort((a, b) => b.value - a.value);
  const sourceMax = Math.max(1, ...sources.map((s) => s.value));

  return (
    <div className="space-y-6">
      <OnboardingFlow onNavigate={go} storeName={storeName} />

      {/* ── Headline stats ── */}
      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total reviews"
          value={data.totalReviews}
          icon={MessageSquare}
          tone="brand"
          spark={spark}
          hint={
            data.pendingReviews > 0 ? (
              <span className="inline-flex items-center gap-1 font-medium text-amber-600">
                <Clock className="size-3" />
                {data.pendingReviews} awaiting approval
              </span>
            ) : hasReviews ? (
              'All caught up on moderation'
            ) : (
              'None collected yet'
            )
          }
          onClick={() => go('reviews')}
        />
        <StatCard
          label="Average rating"
          value={data.averageRating}
          decimals={1}
          icon={Star}
          tone="amber"
          hint={
            hasReviews ? (
              <Stars rating={data.averageRating} size={13} />
            ) : (
              'Waiting on your first review'
            )
          }
        />
        <StatCard
          label="Live on store"
          value={data.publishedReviews}
          icon={Eye}
          tone="indigo"
          hint={
            hasReviews
              ? `${Math.round((data.publishedReviews / data.totalReviews) * 100)}% of everything collected`
              : 'Nothing published yet'
          }
          onClick={() => go('reviews')}
        />
        <StatCard
          label="Verified buyers"
          value={data.verifiedPercentage}
          suffix="%"
          icon={BadgeCheck}
          tone="cyan"
          hint={
            <span className="inline-flex items-center gap-1">
              <Camera className="size-3 text-ink-400" />
              {data.reviewsWithImages} with photos
            </span>
          }
        />
      </div>

      {!hasReviews ? (
        <Panel elevation="raised" className="overflow-hidden">
          <EmptyState
            icon={Inbox}
            title="Your first reviews will land here"
            description="Import reviews you already own from AliExpress, Etsy or a CSV — or let ReviewMaster ask your recent customers automatically after their orders are fulfilled."
            action={
              <>
                <ActionButton icon={Sparkles} onClick={() => go('bulk-upload')}>
                  Import reviews
                </ActionButton>
                <ActionButton variant="outline" onClick={() => go('settings')}>
                  Set up requests
                </ActionButton>
              </>
            }
            secondary="Nothing reaches your storefront until you approve it."
          />
        </Panel>
      ) : (
        <>
          {/* ── Trend + sentiment ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Panel className="lg:col-span-2">
              <PanelHeader
                title="Reviews over time"
                description="Last 30 days"
                icon={TrendingUp}
                tone="brand"
                action={
                  <Pill tone="brand">
                    <CountUp value={spark.reduce((a, b) => a + b, 0)} /> this month
                  </Pill>
                }
              />
              <div className="h-[248px] px-2 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.reviewsOverTime} margin={{ top: 4, right: 12, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="dashArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--brand-500)" stopOpacity={0.32} />
                        <stop offset="100%" stopColor="var(--brand-500)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4 4" stroke="var(--ink-200)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: 'var(--ink-400)' }}
                      tickFormatter={(v: string) => v.slice(5)}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: 'var(--ink-400)' }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                      width={34}
                    />
                    <Tooltip
                      cursor={{ stroke: 'var(--ink-300)', strokeDasharray: '4 4' }}
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                        boxShadow: 'var(--elev-2)',
                        background: 'var(--card)',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      name="Reviews"
                      stroke="var(--brand-500)"
                      strokeWidth={2.5}
                      fill="url(#dashArea)"
                      dot={false}
                      activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Sentiment" description="Derived from star ratings" icon={PieIcon} tone="violet" />
              <div className="relative h-[168px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sentimentData}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={72}
                      dataKey="value"
                      paddingAngle={3}
                      stroke="var(--card)"
                      strokeWidth={3}
                    >
                      {sentimentData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        fontSize: 12,
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                        boxShadow: 'var(--elev-2)',
                        background: 'var(--card)',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* The number belongs in the hole of a donut; without it the chart is
                    decoration rather than information. */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="tnum text-[24px] font-bold leading-none text-ink-900 dark:text-white">
                    {sentimentTotal
                      ? Math.round(((sentimentData[0].value || 0) / sentimentTotal) * 100)
                      : 0}
                    %
                  </span>
                  <span className="text-[10.5px] font-medium uppercase tracking-wide text-ink-400">
                    positive
                  </span>
                </div>
              </div>
              <div className="space-y-1.5 px-5 pb-5 pt-2">
                {sentimentData.map((s) => (
                  <div key={s.name} className="flex items-center gap-2 text-[12px]">
                    <span className="size-2 rounded-full" style={{ background: s.color }} />
                    <span className="flex-1 text-ink-500">{s.name}</span>
                    <span className="tnum font-semibold text-ink-800 dark:text-ink-200">{s.value}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* ── Distribution / products / sources ── */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Panel>
              <PanelHeader title="Rating breakdown" icon={Star} tone="amber" />
              <div className="space-y-2.5 px-5 pb-5">
                {ratingRows.map((r) => (
                  <div key={r.stars} className="flex items-center gap-3">
                    <span className="flex w-8 items-center gap-0.5 text-[12px] font-semibold text-ink-600 dark:text-ink-300">
                      {r.stars}
                      <Star className="size-3 text-amber-400" fill="currentColor" strokeWidth={0} />
                    </span>
                    <Meter value={r.pct} tone="amber" height={7} className="flex-1" />
                    <span className="tnum w-14 text-right text-[12px] text-ink-500">
                      {r.count}
                      <span className="text-ink-300"> · {Math.round(r.pct)}%</span>
                    </span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                title="Most reviewed"
                icon={ShieldCheck}
                tone="cyan"
                action={
                  <button
                    onClick={() => go('products')}
                    className="ring-focus rounded text-[12px] font-semibold text-brand-700 hover:text-brand-800 dark:text-brand-400"
                  >
                    All
                  </button>
                }
              />
              <div className="space-y-1 px-3 pb-4">
                {data.topProducts.length === 0 && (
                  <p className="px-2 py-6 text-center text-[12.5px] text-ink-400">
                    No product has reviews yet.
                  </p>
                )}
                {data.topProducts.slice(0, 5).map((item, i) => (
                  <div
                    key={item.product.id}
                    className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-ink-50 dark:hover:bg-white/[0.03]"
                  >
                    <span className="tnum w-4 text-[11px] font-bold text-ink-300">{i + 1}</span>
                    <ProductThumb src={item.product.image} alt={item.product.title} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-ink-800 dark:text-ink-100">
                        {item.product.title}
                      </p>
                      <Stars rating={item.avgRating} size={11} />
                    </div>
                    <div className="text-right">
                      <p className="tnum text-[13px] font-bold text-ink-900 dark:text-white">
                        {item.reviewCount}
                      </p>
                      <p className="text-[10px] text-ink-400">reviews</p>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Where they came from" icon={Sparkles} tone="indigo" />
              <div className="space-y-3 px-5 pb-5">
                {sources.length === 0 && (
                  <p className="py-6 text-center text-[12.5px] text-ink-400">Nothing yet.</p>
                )}
                {sources.slice(0, 6).map((s) => (
                  <div key={s.name}>
                    <div className="mb-1 flex items-baseline justify-between text-[12px]">
                      <span className="font-medium text-ink-700 dark:text-ink-200">{s.name}</span>
                      <span className="tnum text-ink-500">{s.value}</span>
                    </div>
                    <Meter value={(s.value / sourceMax) * 100} tone="indigo" height={6} />
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          {/* ── Recent ── */}
          <div>
            <SectionTitle
              action={
                <ActionButton
                  size="sm"
                  variant="outline"
                  trailingIcon={ArrowRight}
                  onClick={() => go('reviews')}
                >
                  Open moderation
                </ActionButton>
              }
            >
              Latest reviews
            </SectionTitle>

            <Panel className="divide-y divide-border overflow-hidden">
              {data.recentReviews.length === 0 && (
                <p className="px-5 py-10 text-center text-[13px] text-ink-400">
                  No reviews yet.
                </p>
              )}
              {data.recentReviews.slice(0, 6).map((review) => (
                <div
                  key={review.id}
                  className="flex gap-3.5 px-5 py-4 transition-colors hover:bg-ink-50/70 dark:hover:bg-white/[0.02]"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-[13px] font-bold text-white shadow-[var(--glow-brand)]">
                    {(review.reviewerName || '?').charAt(0).toUpperCase()}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-ink-900 dark:text-white">
                        {review.reviewerName}
                      </span>
                      <Stars rating={review.rating} size={12} />
                      {review.verifiedPurchase && (
                        <Pill tone="brand" icon={BadgeCheck}>Verified</Pill>
                      )}
                      {review.isFeatured && <Pill tone="amber">Featured</Pill>}
                      <Pill tone="neutral">{SOURCE_LABELS[review.source] || review.source}</Pill>
                    </div>
                    {review.title && (
                      <p className="mt-1 text-[13px] font-medium text-ink-800 dark:text-ink-100">
                        {review.title}
                      </p>
                    )}
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-500">
                      {review.body}
                    </p>
                  </div>

                  {review.product && (
                    <ProductThumb src={review.product.image} alt={review.product.title} size={44} />
                  )}
                </div>
              ))}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Product image with a real fallback.
 *
 * The old code pointed at picsum.photos when a product had no image — a random
 * stock photo from a third-party server, rendered inside a merchant's admin, on
 * every page load. Wrong on privacy grounds and wrong visually.
 */
function ProductThumb({
  src,
  alt,
  size = 36,
}: {
  src: string | null;
  alt: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-300 ring-1 ring-inset ring-black/[0.04] dark:bg-white/5"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <Camera className="size-4" />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      loading="lazy"
      className="shrink-0 rounded-lg object-cover ring-1 ring-inset ring-black/[0.06]"
      style={{ width: size, height: size }}
    />
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <StatSkeletonRow />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2 p-5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-5 h-[220px] w-full rounded-xl" />
        </Panel>
        <Panel className="p-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mx-auto mt-6 size-36 rounded-full" />
          <div className="mt-6 space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Panel key={i} className="p-5">
            <Skeleton className="h-4 w-28" />
            <div className="mt-5 space-y-3">
              {[0, 1, 2, 3].map((j) => (
                <Skeleton key={j} className={cn('h-3', j % 2 ? 'w-4/5' : 'w-full')} />
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
