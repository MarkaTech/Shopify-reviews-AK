'use client';

import React, { useState, useEffect } from 'react';
import {
  ShoppingBag, Search, RefreshCw, Star, MessageSquare, ArrowDownToLine,
  ExternalLink, BarChart3, ImageIcon, Plus,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { apiFetch, ApiError, errorMessage } from '@/lib/api-client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  Panel, StatCard, Stars, Pill, EmptyState, ActionButton, Skeleton, Meter,
} from './ui-kit';

interface Product {
  id: string;
  shopifyId: string | null;
  title: string;
  handle: string | null;
  description: string | null;
  image: string | null;
  price: number | null;
  vendor: string | null;
  productType: string | null;
  isVisible: boolean;
  reviewCount: number;
  averageRating: number;
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder] = useState('desc');
  const [hasReviewsFilter, setHasReviewsFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      params.set('sortBy', sortBy);
      params.set('sortOrder', sortOrder);
      if (hasReviewsFilter !== 'all') params.set('hasReviews', hasReviewsFilter);
      params.set('limit', '50');

      try {
        const data = await apiFetch<{ products: Product[] }>(`/api/products?${params}`);
        if (!cancelled) setProducts(data.products || []);
      } catch (err) {
        // Previously an unhandled rejection: a failed load left the spinner up forever
        // with nothing in the console a merchant could act on.
        if (!cancelled) {
          setProducts([]);
          toast.error(errorMessage(err, 'Could not load products'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [search, sortBy, sortOrder, hasReviewsFilter, refreshKey]);

  // --- Add Review dialog ---------------------------------------------------------
  const [reviewFor, setReviewFor] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ reviewerName: '', rating: 5, title: '', body: '' });

  const openReviewDialog = (product: Product) => {
    setForm({ reviewerName: '', rating: 5, title: '', body: '' });
    setReviewFor(product);
  };

  const submitReview = async () => {
    if (!reviewFor) return;
    if (!form.reviewerName.trim() || !form.body.trim()) {
      toast.error('Reviewer name and review text are required.');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          productId: reviewFor.id,
          reviewerName: form.reviewerName.trim(),
          rating: form.rating,
          title: form.title.trim() || null,
          body: form.body.trim(),
          source: 'direct',
          isPublished: true,
        }),
      });
      toast.success('Review added.');
      setReviewFor(null);
      setRefreshKey(k => k + 1);
    } catch (err) {
      if (err instanceof ApiError && err.isPlanLimit) {
        toast.error(err.userMessage, { description: 'Open Settings to change your plan.', duration: 8000 });
      } else {
        toast.error(errorMessage(err, 'Could not add the review'));
      }
    } finally {
      setSaving(false);
    }
  };

  /** Open the product in the merchant's Shopify admin. */
  const openInShopify = (product: Product) => {
    if (!product.shopifyId) {
      toast.error('This product has no Shopify ID and cannot be opened.');
      return;
    }
    window.open(
      `https://admin.shopify.com/products/${product.shopifyId}`,
      '_blank',
      'noopener,noreferrer'
    );
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const data = await apiFetch<{ synced: number; total: number; truncated?: boolean }>(
        '/api/products/sync', { method: 'POST' }
      );
      if (data.synced === 0) {
        toast.info(`No new products found. ${data.total} already synced.`);
      } else {
        toast.success(`Synced ${data.synced} new product${data.synced === 1 ? '' : 's'} from Shopify`);
      }
      // Say so rather than leaving a large catalogue silently half-imported. The rest
      // arrives as Shopify sends product webhooks.
      if (data.truncated) {
        toast.info('This sync covered the first 5,000 products. The rest will arrive as they are updated in Shopify.');
      }
      setRefreshKey(k => k + 1);
    } catch (err) {
      toast.error(errorMessage(err, 'Sync failed'));
    } finally {
      setSyncing(false);
    }
  };

  const totalReviews = products.reduce((sum, p) => sum + p.reviewCount, 0);
  // Guard on totalReviews, not products.length. With 17 products and 0 reviews the old
  // check passed and then divided by zero, rendering "NaN" on the dashboard.
  const avgAllRatings = totalReviews > 0
    ? products.reduce((sum, p) => sum + (p.averageRating * p.reviewCount), 0) / totalReviews
    : 0;
  const withReviews = products.filter(p => p.reviewCount > 0).length;

  return (
    <div className="space-y-6">
      {/* ── Stats ── */}
      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Products" value={products.length} icon={ShoppingBag} tone="cyan" hint="Synced from Shopify" />
        <StatCard label="Reviews" value={totalReviews} icon={MessageSquare} tone="brand" hint="Across all products" />
        <StatCard label="Average rating" value={avgAllRatings} decimals={1} icon={Star} tone="amber" hint={totalReviews ? <Stars rating={avgAllRatings} size={13} /> : 'No reviews yet'} />
        <StatCard
          label="With reviews"
          value={withReviews}
          icon={BarChart3}
          tone="indigo"
          hint={products.length ? `${Math.round((withReviews / products.length) * 100)}% of your catalogue` : '—'}
        />
      </div>

      {/* ── Toolbar ── */}
      <Panel className="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
          <Input
            placeholder="Search products…"
            className="h-9 rounded-xl pl-9 text-[13px]"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <Select value={hasReviewsFilter} onValueChange={setHasReviewsFilter}>
          <SelectTrigger className="h-9 w-[142px] rounded-xl text-[13px]"><SelectValue placeholder="Reviews" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All products</SelectItem>
            <SelectItem value="true">Has reviews</SelectItem>
            <SelectItem value="false">No reviews</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="h-9 w-[150px] rounded-xl text-[13px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="createdAt">Newest</SelectItem>
            <SelectItem value="title">Name A–Z</SelectItem>
            <SelectItem value="reviews_count">Most reviews</SelectItem>
            <SelectItem value="avg_rating">Highest rated</SelectItem>
            <SelectItem value="price">Price</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <ActionButton variant="outline" size="sm" icon={RefreshCw} onClick={() => setRefreshKey(k => k + 1)}>
            Refresh
          </ActionButton>
          <ActionButton size="sm" onClick={handleSync} disabled={syncing}>
            <ArrowDownToLine className={cn('size-3.5', syncing && 'animate-bounce')} />
            {syncing ? 'Syncing…' : 'Sync from Shopify'}
          </ActionButton>
        </div>
      </Panel>

      {/* ── Grid ── */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Panel key={i} className="overflow-hidden">
              <Skeleton className="h-40 w-full rounded-none" />
              <div className="space-y-2.5 p-4">
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-2.5 w-2/5" />
                <Skeleton className="h-6 w-full" />
              </div>
            </Panel>
          ))}
        </div>
      ) : products.length === 0 ? (
        <Panel>
          <EmptyState
            icon={ShoppingBag}
            tone="cyan"
            title={search ? 'No products match that search' : 'No products synced yet'}
            description={
              search
                ? 'Try a shorter search, or clear it to see your whole catalogue.'
                : 'ReviewMaster syncs your catalogue automatically at install. If nothing appeared, pull it in manually.'
            }
            action={
              search ? (
                <ActionButton variant="outline" onClick={() => setSearch('')}>Clear search</ActionButton>
              ) : (
                <ActionButton icon={ArrowDownToLine} onClick={handleSync} disabled={syncing}>
                  {syncing ? 'Syncing…' : 'Sync from Shopify'}
                </ActionButton>
              )
            }
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map(product => (
            <Panel key={product.id} className="group flex flex-col overflow-hidden lift">
              {/* ── Image ── */}
              <div className="relative aspect-[4/3] overflow-hidden bg-ink-100 dark:bg-white/5">
                <ProductImage src={product.image} alt={product.title} />

                {/* Gradient scrim so the overlaid chips stay readable on any photo. */}
                <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/25 to-transparent" />

                {product.reviewCount > 0 && (
                  <div className="absolute left-2.5 top-2.5 flex items-center gap-1 rounded-lg bg-white/92 px-2 py-1 backdrop-blur-sm dark:bg-ink-900/85">
                    <Star className="size-3 text-amber-400" fill="currentColor" strokeWidth={0} />
                    <span className="tnum text-[11px] font-bold text-ink-900 dark:text-white">
                      {product.averageRating.toFixed(1)}
                    </span>
                    <span className="tnum text-[10px] text-ink-400">({product.reviewCount})</span>
                  </div>
                )}

                {product.price != null && (
                  <div className="absolute right-2.5 top-2.5 rounded-lg bg-white/92 px-2 py-1 backdrop-blur-sm dark:bg-ink-900/85">
                    <span className="tnum text-[11px] font-bold text-ink-900 dark:text-white">
                      ${product.price.toFixed(2)}
                    </span>
                  </div>
                )}
              </div>

              {/* ── Body ── */}
              <div className="flex flex-1 flex-col p-4">
                <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug text-ink-900 transition-colors group-hover:text-brand-700 dark:text-white dark:group-hover:text-brand-400">
                  {product.title}
                </h3>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {product.vendor && (
                    <span className="text-[11px] text-ink-400">{product.vendor}</span>
                  )}
                  {product.productType && <Pill tone="neutral">{product.productType}</Pill>}
                </div>

                <div className="mt-3 flex-1">
                  {product.reviewCount > 0 ? (
                    <>
                      <div className="mb-1.5 flex items-center justify-between">
                        <Stars rating={product.averageRating} size={12} />
                        <span className="tnum text-[11px] text-ink-400">
                          {product.reviewCount} review{product.reviewCount === 1 ? '' : 's'}
                        </span>
                      </div>
                      <Meter value={(product.averageRating / 5) * 100} tone="amber" height={5} />
                    </>
                  ) : (
                    <p className="text-[11.5px] italic text-ink-400">No reviews yet</p>
                  )}
                </div>

                <div className="mt-3.5 flex items-center gap-2">
                  <ActionButton
                    variant="outline"
                    size="sm"
                    icon={Plus}
                    className="flex-1"
                    onClick={() => openReviewDialog(product)}
                  >
                    Add review
                  </ActionButton>
                  <ActionButton
                    variant="ghost"
                    size="sm"
                    className="px-2"
                    title="Open in Shopify admin"
                    aria-label="Open in Shopify admin"
                    onClick={() => openInShopify(product)}
                  >
                    <ExternalLink className="size-3.5" />
                  </ActionButton>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}

      {/* ── Add Review dialog ── */}
      <Dialog open={reviewFor !== null} onOpenChange={(open) => !open && setReviewFor(null)}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[16px]">Add a review</DialogTitle>
            <DialogDescription className="text-[12.5px]">
              {reviewFor?.title}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="reviewerName" className="text-[12.5px] font-semibold">Reviewer name *</Label>
              <Input
                id="reviewerName"
                value={form.reviewerName}
                onChange={(e) => setForm(f => ({ ...f, reviewerName: e.target.value }))}
                placeholder="Jane Doe"
                className="h-9 rounded-xl text-[13px]"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[12.5px] font-semibold">Rating *</Label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n} star${n === 1 ? '' : 's'}`}
                    onClick={() => setForm(f => ({ ...f, rating: n }))}
                    className="ring-focus rounded p-0.5 transition-transform hover:scale-110"
                  >
                    <Star
                      className={cn('size-6 transition-colors', n <= form.rating ? 'text-amber-400' : 'text-ink-200 dark:text-white/15')}
                      fill="currentColor"
                      strokeWidth={0}
                    />
                  </button>
                ))}
                <span className="ml-2 text-[12px] text-ink-500">{form.rating} of 5</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reviewTitle" className="text-[12.5px] font-semibold">Title</Label>
              <Input
                id="reviewTitle"
                value={form.title}
                onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Great product"
                className="h-9 rounded-xl text-[13px]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reviewBody" className="text-[12.5px] font-semibold">Review *</Label>
              <Textarea
                id="reviewBody"
                value={form.body}
                onChange={(e) => setForm(f => ({ ...f, body: e.target.value }))}
                placeholder="What did the customer think?"
                rows={4}
                className="rounded-xl text-[13px]"
              />
            </div>
          </div>

          <DialogFooter>
            <ActionButton variant="ghost" size="sm" onClick={() => setReviewFor(null)}>
              Cancel
            </ActionButton>
            <ActionButton size="sm" onClick={submitReview} disabled={saving}>
              {saving ? 'Saving…' : 'Add review'}
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Product image with a first-party fallback.
 *
 * This used to fall back to `picsum.photos/seed/<id>` — a random stock photo pulled
 * from a third-party server, rendered inside the merchant's admin, on every load.
 * It leaked product IDs to an unrelated host and made products look like they had
 * imagery they do not have.
 */
function ProductImage({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-ink-100 to-ink-200 dark:from-white/5 dark:to-white/[0.02]">
        <ImageIcon className="size-8 text-ink-300 dark:text-white/20" strokeWidth={1.5} />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
    />
  );
}
