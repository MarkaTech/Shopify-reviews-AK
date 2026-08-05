'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Star, Filter, Search, Download, Trash2, Edit3, Eye, EyeOff,
  ThumbsUp, ThumbsDown, MessageSquare, Pin, Award, MoreHorizontal,
  RefreshCw, X, Check, Clock, ShoppingBag, MapPin, Mail, BadgeCheck,
  Inbox, ChevronLeft, ChevronRight, Play, Gift,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { apiFetch, errorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Panel, Stars, Pill, EmptyState, ActionButton, Skeleton } from './ui-kit';

interface Review {
  id: string;
  reviewerName: string;
  reviewerEmail: string | null;
  reviewerLocation: string | null;
  verifiedPurchase: boolean;
  /**
   * The strict provenance status. `verifiedPurchase` is the legacy boolean and can be true
   * without a matched order, so anything merchant- or shopper-facing that says "Verified"
   * must key off this instead — claiming a verified purchase we cannot evidence is the
   * misrepresentation FTC 16 CFR 465 targets.
   */
  verificationStatus: string;
  rating: number;
  title: string | null;
  body: string;
  images: string | null;
  videoUrl: string | null;
  source: string;
  sentiment: string;
  isFeatured: boolean;
  isPublished: boolean;
  isPinned: boolean;
  isIncentivized?: boolean;
  reply: string | null;
  repliedAt: string | null;
  helpfulCount: number;
  notHelpfulCount: number;
  reviewDate: string;
  createdAt: string;
  product: { id: string; title: string; image: string | null } | null;
}

const SOURCE_LABELS: Record<string, string> = {
  direct: 'Direct', amazon: 'Amazon', ebay: 'eBay', etsy: 'Etsy',
  walmart: 'Walmart', alibaba: 'AliExpress', aliexpress: 'AliExpress',
  shopify: 'Shopify', csv: 'CSV', storefront: 'Storefront',
};

const PAGE_SIZE = 20;

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [replyDialog, setReplyDialog] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [ratingFilter, setRatingFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [sentimentFilter, setSentimentFilter] = useState<string>('all');
  const [publishedFilter, setPublishedFilter] = useState<string>('all');
  const [verifiedFilter, setVerifiedFilter] = useState<string>('all');
  const [imagesFilter, setImagesFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState('reviewDate');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showFilters, setShowFilters] = useState(false);

  /**
   * Load the review list for the current filters.
   *
   * This used to be a `load()` closure declared inside the useEffect below, while five
   * places in this component called `fetchReviews()` — a name that did not exist anywhere.
   * Each of those calls threw `ReferenceError: fetchReviews is not defined` at runtime.
   *
   * The failure was doubly confusing because the throw happened AFTER the success toast
   * and inside a try block, so publishing a review showed "Review published" immediately
   * followed by "Could not update the review", and the list never refreshed. Every action
   * on this page actually worked server-side; only the refresh was broken.
   */
  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (ratingFilter !== 'all') params.set('rating', ratingFilter);
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      if (sentimentFilter !== 'all') params.set('sentiment', sentimentFilter);
      if (publishedFilter !== 'all') params.set('isPublished', publishedFilter);
      if (verifiedFilter !== 'all') params.set('verifiedPurchase', verifiedFilter);
      if (imagesFilter !== 'all') params.set('hasImages', imagesFilter);
      params.set('sortBy', sortBy);
      params.set('sortOrder', sortOrder);
      params.set('page', String(page));
      params.set('limit', String(PAGE_SIZE));

      const data = await apiFetch<{ reviews?: Review[]; total?: number }>(
        `/api/reviews?${params}`
      );
      setReviews(data.reviews || []);
      setTotal(data.total || 0);
    } catch (err) {
      // The raw fetch here ignored res.ok and fed an error body straight into setReviews,
      // which is how an expired session rendered as "0 reviews" instead of a prompt to
      // reinstall.
      toast.error(errorMessage(err, 'Could not load reviews'));
      setReviews([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [search, ratingFilter, sourceFilter, sentimentFilter, publishedFilter, verifiedFilter, imagesFilter, sortBy, sortOrder, page]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Export the reviews currently loaded, as CSV.
   *
   * Built in the browser from state already fetched rather than through a new endpoint:
   * the merchant is looking at exactly this list, so a server round trip would be a second
   * source of truth that could disagree with what is on screen.
   *
   * RFC 4180 quoting — every field wrapped, embedded quotes doubled. Review bodies contain
   * commas, newlines and quotation marks as a matter of course, and a naive join produces a
   * file that silently corrupts on import.
   *
   * The BOM is there so Excel opens UTF-8 correctly; without it, accented names and any
   * non-Latin script arrive as mojibake, which is most of the value of an export gone.
   */
  const exportCsv = () => {
    if (!reviews.length) {
      toast.error('There are no reviews to export');
      return;
    }

    const columns: Array<[string, (r: Review) => unknown]> = [
      ['Date', r => new Date(r.reviewDate ?? r.createdAt).toISOString().slice(0, 10)],
      ['Product', r => r.product?.title ?? ''],
      ['Reviewer', r => r.reviewerName],
      ['Email', r => r.reviewerEmail ?? ''],
      ['Rating', r => r.rating],
      ['Title', r => r.title ?? ''],
      ['Body', r => r.body],
      ['Published', r => (r.isPublished ? 'yes' : 'no')],
      ['Verified', r => (r.verificationStatus === 'verified_buyer' ? 'yes' : 'no')],
      ['Source', r => r.source ?? ''],
      ['Reply', r => r.reply ?? ''],
    ];

    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      columns.map(([header]) => cell(header)).join(','),
      ...reviews.map(r => columns.map(([, get]) => cell(get(r))).join(',')),
    ].join('\r\n');

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reviews-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success(`Exported ${reviews.length} review${reviews.length === 1 ? '' : 's'}`);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === reviews.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(reviews.map(r => r.id)));
  };

  /** PATCH a single review and refresh. Shared by publish/feature/pin toggles. */
  const patchReview = async (id: string, data: Record<string, unknown>, successMsg: string) => {
    setBusyId(id);
    try {
      await apiFetch(`/api/reviews/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      toast.success(successMsg);
      await fetchReviews();
    } catch (err) {
      // Previously every one of these reported success unconditionally, so a failed
      // request still showed "Review published" while nothing had changed.
      toast.error(errorMessage(err, 'Could not update the review'));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/api/reviews/${id}`, { method: 'DELETE' });
      toast.success('Review deleted');
      await fetchReviews();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the review'));
    }
  };

  const handleTogglePublish = (review: Review) =>
    patchReview(review.id, { isPublished: !review.isPublished },
      review.isPublished ? 'Review unpublished' : 'Review published');

  const handleToggleFeature = (review: Review) =>
    patchReview(review.id, { isFeatured: !review.isFeatured },
      review.isFeatured ? 'Unfeatured' : 'Featured');

  const handleTogglePin = (review: Review) =>
    patchReview(review.id, { isPinned: !review.isPinned },
      review.isPinned ? 'Unpinned' : 'Pinned');

  const handleReply = async (id: string) => {
    if (!replyText.trim()) {
      toast.error('Write a reply before sending.');
      return;
    }
    try {
      await apiFetch(`/api/reviews/${id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ reply: replyText }),
      });
      toast.success('Reply added');
      setReplyDialog(null);
      setReplyText('');
      await fetchReviews();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save the reply'));
    }
  };

  const handleBulkAction = async (action: string) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;

    const run = (id: string) => {
      switch (action) {
        case 'publish':   return apiFetch(`/api/reviews/${id}`, { method: 'PUT', body: JSON.stringify({ isPublished: true }) });
        case 'unpublish': return apiFetch(`/api/reviews/${id}`, { method: 'PUT', body: JSON.stringify({ isPublished: false }) });
        case 'feature':   return apiFetch(`/api/reviews/${id}`, { method: 'PUT', body: JSON.stringify({ isFeatured: true }) });
        case 'delete':    return apiFetch(`/api/reviews/${id}`, { method: 'DELETE' });
        default:          return Promise.resolve();
      }
    };

    // allSettled, not all: one failure previously rejected the whole batch and still
    // reported success for every item.
    const results = await Promise.allSettled(ids.map(run));
    const failed = results.filter(r => r.status === 'rejected').length;
    const ok = results.length - failed;

    if (failed === 0) {
      toast.success(`${action} applied to ${ok} review${ok === 1 ? '' : 's'}`);
    } else if (ok === 0) {
      toast.error(`Could not ${action} any of the ${failed} selected reviews.`);
    } else {
      toast.warning(`${action} applied to ${ok}, but ${failed} failed.`);
    }

    setSelectedIds(new Set());
    await fetchReviews();
  };

  const activeFilterCount = [ratingFilter, sourceFilter, sentimentFilter, verifiedFilter, imagesFilter].filter(f => f !== 'all').length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const clearFilters = () => {
    setRatingFilter('all'); setSourceFilter('all'); setSentimentFilter('all');
    setVerifiedFilter('all'); setImagesFilter('all');
    setPage(1);
  };

  // Moderation status is promoted out of the "more filters" drawer into a segmented
  // control. Approving what is waiting is the job this page exists for; burying it
  // three clicks deep alongside "sentiment" got the hierarchy backwards.
  const STATUS_TABS = [
    { value: 'all', label: 'All' },
    { value: 'false', label: 'Pending' },
    { value: 'true', label: 'Published' },
  ];

  return (
    <div className="space-y-4">
      {/* ── Toolbar ── */}
      <Panel className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status segmented control */}
          <div className="flex rounded-xl bg-ink-100 p-0.5 dark:bg-white/5">
            {STATUS_TABS.map(t => (
              <button
                key={t.value}
                onClick={() => { setPublishedFilter(t.value); setPage(1); }}
                className={cn(
                  'ring-focus rounded-[10px] px-3 py-1.5 text-[12.5px] font-semibold transition-all',
                  publishedFilter === t.value
                    ? 'bg-card text-ink-900 shadow-[var(--elev-1)] dark:text-white'
                    : 'text-ink-500 hover:text-ink-700 dark:hover:text-ink-200'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
            <Input
              placeholder="Search by reviewer, title or content…"
              className="h-9 rounded-xl pl-9 text-[13px]"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
            />
          </div>

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="h-9 w-[148px] rounded-xl text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="reviewDate">Newest first</SelectItem>
              <SelectItem value="rating">Highest rated</SelectItem>
              <SelectItem value="helpfulCount">Most helpful</SelectItem>
              <SelectItem value="reviewerName">Reviewer name</SelectItem>
            </SelectContent>
          </Select>

          <ActionButton
            size="sm"
            variant={showFilters || activeFilterCount ? 'soft' : 'outline'}
            icon={Filter}
            onClick={() => setShowFilters(!showFilters)}
          >
            Filters
            {activeFilterCount > 0 && (
              <span className="tnum ml-0.5 rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </ActionButton>

          <ActionButton size="sm" variant="outline" icon={Download} onClick={exportCsv}>
            Export
          </ActionButton>
          <ActionButton
            size="sm"
            variant="ghost"
            className="px-2"
            aria-label="Refresh"
            onClick={() => fetchReviews()}
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </ActionButton>
        </div>

        {showFilters && (
          <div className="animate-rise mt-3 grid grid-cols-2 gap-2.5 border-t border-border pt-3 sm:grid-cols-3 lg:grid-cols-6">
            <Select value={ratingFilter} onValueChange={v => { setRatingFilter(v); setPage(1); }}>
              <SelectTrigger className="h-9 rounded-xl text-[12.5px]"><SelectValue placeholder="Rating" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All ratings</SelectItem>
                <SelectItem value="5">5 stars</SelectItem>
                <SelectItem value="4">4 stars</SelectItem>
                <SelectItem value="3">3 stars</SelectItem>
                <SelectItem value="2">2 stars</SelectItem>
                <SelectItem value="1">1 star</SelectItem>
                <SelectItem value="4,5">4–5 stars</SelectItem>
                <SelectItem value="1,2,3">1–3 stars</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={v => { setSourceFilter(v); setPage(1); }}>
              <SelectTrigger className="h-9 rounded-xl text-[12.5px]"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sentimentFilter} onValueChange={v => { setSentimentFilter(v); setPage(1); }}>
              <SelectTrigger className="h-9 rounded-xl text-[12.5px]"><SelectValue placeholder="Sentiment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sentiment</SelectItem>
                <SelectItem value="positive">Positive</SelectItem>
                <SelectItem value="neutral">Neutral</SelectItem>
                <SelectItem value="negative">Negative</SelectItem>
              </SelectContent>
            </Select>
            <Select value={verifiedFilter} onValueChange={v => { setVerifiedFilter(v); setPage(1); }}>
              <SelectTrigger className="h-9 rounded-xl text-[12.5px]"><SelectValue placeholder="Verified" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any provenance</SelectItem>
                <SelectItem value="true">Verified buyers</SelectItem>
                <SelectItem value="false">Unverified</SelectItem>
              </SelectContent>
            </Select>
            <Select value={imagesFilter} onValueChange={v => { setImagesFilter(v); setPage(1); }}>
              <SelectTrigger className="h-9 rounded-xl text-[12.5px]"><SelectValue placeholder="Media" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any media</SelectItem>
                <SelectItem value="true">With photos</SelectItem>
                <SelectItem value="false">Text only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortOrder} onValueChange={setSortOrder}>
              <SelectTrigger className="h-9 rounded-xl text-[12.5px]"><SelectValue placeholder="Order" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Descending</SelectItem>
                <SelectItem value="asc">Ascending</SelectItem>
              </SelectContent>
            </Select>

            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="ring-focus col-span-full inline-flex items-center gap-1 justify-self-start rounded text-[12px] font-semibold text-ink-500 hover:text-ink-800 dark:hover:text-white"
              >
                <X className="size-3" /> Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
              </button>
            )}
          </div>
        )}
      </Panel>

      {/* ── Select-all / count ── */}
      {!loading && reviews.length > 0 && (
        <div className="flex items-center gap-3 px-1">
          <Checkbox
            checked={reviews.length > 0 && selectedIds.size === reviews.length}
            onCheckedChange={toggleSelectAll}
            aria-label="Select all reviews on this page"
          />
          <span className="text-[12.5px] text-ink-500">
            Showing <span className="tnum font-semibold text-ink-700 dark:text-ink-200">{reviews.length}</span> of{' '}
            <span className="tnum font-semibold text-ink-700 dark:text-ink-200">{total}</span>
            {publishedFilter === 'false' && ' awaiting approval'}
          </span>
        </div>
      )}

      {/* ── List ── */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Panel key={i} className="p-4">
              <div className="flex gap-3.5">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-2.5">
                  <Skeleton className="h-3.5 w-48" />
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              </div>
            </Panel>
          ))}
        </div>
      ) : reviews.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Inbox}
            tone={publishedFilter === 'false' ? 'brand' : 'indigo'}
            title={
              publishedFilter === 'false'
                ? 'Nothing waiting for you'
                : search || activeFilterCount
                  ? 'No reviews match those filters'
                  : 'No reviews yet'
            }
            description={
              publishedFilter === 'false'
                ? 'Every review has been moderated. New ones will appear here as they arrive.'
                : search || activeFilterCount
                  ? 'Loosen a filter or clear your search to see more.'
                  : 'Import reviews you already own, or let ReviewMaster collect them automatically after orders are fulfilled.'
            }
            action={
              (search || activeFilterCount) ? (
                <ActionButton variant="outline" onClick={() => { setSearch(''); clearFilters(); }}>
                  Clear filters
                </ActionButton>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => {
            let images: string[] = [];
            try {
              images = review.images ? (JSON.parse(review.images) as string[]) : [];
            } catch {
              // A malformed images blob must not take the whole moderation queue down.
              images = [];
            }
            const verified = review.verificationStatus === 'verified_buyer';
            const busy = busyId === review.id;

            return (
              <Panel
                key={review.id}
                className={cn(
                  'relative overflow-hidden transition-all',
                  busy && 'opacity-60',
                  selectedIds.has(review.id) && 'is-selected'
                )}
              >
                {/* Status rail: unpublished reviews read as "needs you" at a glance,
                    which a 60% opacity wash never communicated. */}
                <span
                  className={cn(
                    'absolute inset-y-0 left-0 w-1',
                    review.isPinned
                      ? 'bg-gradient-to-b from-amber-300 to-amber-500'
                      : !review.isPublished
                        ? 'bg-gradient-to-b from-amber-200 to-amber-400'
                        : 'bg-gradient-to-b from-brand-300 to-brand-500'
                  )}
                />

                <div className="flex gap-3.5 p-4 pl-5">
                  <div className="flex flex-col items-center gap-3 pt-1">
                    <Checkbox
                      checked={selectedIds.has(review.id)}
                      onCheckedChange={() => toggleSelect(review.id)}
                      aria-label={`Select review by ${review.reviewerName}`}
                    />
                  </div>

                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-[14px] font-bold text-white shadow-[var(--glow-brand)]">
                    {(review.reviewerName || '?').charAt(0).toUpperCase()}
                  </span>

                  <div className="min-w-0 flex-1">
                    {/* ── Header ── */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[14px] font-semibold text-ink-900 dark:text-white">
                        {review.reviewerName}
                      </span>
                      <Stars rating={review.rating} size={13} />
                      {verified && <Pill tone="brand" icon={BadgeCheck}>Verified buyer</Pill>}
                      {review.isFeatured && <Pill tone="amber" icon={Award}>Featured</Pill>}
                      {review.isPinned && <Pill tone="amber" icon={Pin}>Pinned</Pill>}
                      {review.isIncentivized && <Pill tone="violet" icon={Gift}>Incentivised</Pill>}
                      {!review.isPublished && <Pill tone="neutral" icon={EyeOff}>Not published</Pill>}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-400">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" />
                        {new Date(review.reviewDate).toLocaleDateString(undefined, {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ShoppingBag className="size-3" />
                        {SOURCE_LABELS[review.source] || review.source}
                      </span>
                      {review.reviewerLocation && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" />{review.reviewerLocation}
                        </span>
                      )}
                      {review.reviewerEmail && (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="size-3" />{review.reviewerEmail}
                        </span>
                      )}
                    </div>

                    {/* ── Content ── */}
                    {review.title && (
                      <p className="mt-2.5 text-[14px] font-semibold text-ink-900 dark:text-white">
                        {review.title}
                      </p>
                    )}
                    <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-ink-600 dark:text-ink-300">
                      {review.body}
                    </p>

                    {/* ── Media ──
                        Moderators need to SEE what a shopper attached before approving it —
                        a review that reads well can carry an image that must not go on a
                        storefront. Photos open full size; video plays inline with controls. */}
                    {(images.length > 0 || review.videoUrl) && (
                      <div className="mt-3 flex flex-wrap items-start gap-2">
                        {images.map((img, i) => (
                          <a
                            key={i}
                            href={img}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open full size"
                            className="ring-focus group/img relative block overflow-hidden rounded-xl"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img}
                              alt={`Photo ${i + 1} from ${review.reviewerName}`}
                              loading="lazy"
                              className="size-[72px] rounded-xl object-cover ring-1 ring-inset ring-black/[0.06] transition-transform duration-300 group-hover/img:scale-105"
                            />
                            <span className="pointer-events-none absolute inset-0 rounded-xl bg-black/0 transition-colors group-hover/img:bg-black/10" />
                          </a>
                        ))}
                        {review.videoUrl && (
                          <div className="relative">
                            <video
                              src={review.videoUrl}
                              controls
                              preload="metadata"
                              className="h-[72px] rounded-xl bg-ink-900 ring-1 ring-inset ring-black/10"
                            />
                            <span className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[9.5px] font-bold text-white">
                              <Play className="size-2.5" fill="currentColor" strokeWidth={0} /> VIDEO
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Store reply ── */}
                    {review.reply && (
                      <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/70 p-3 dark:border-indigo-400/15 dark:bg-indigo-500/8">
                        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
                          <ShoppingBag className="size-3" />
                          Your reply
                          {review.repliedAt && (
                            <span className="font-medium normal-case tracking-normal text-indigo-400">
                              · {new Date(review.repliedAt).toLocaleDateString()}
                            </span>
                          )}
                        </p>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-indigo-900 dark:text-indigo-100">
                          {review.reply}
                        </p>
                      </div>
                    )}

                    {/* ── Product ── */}
                    {review.product && (
                      <div className="mt-2.5 inline-flex items-center gap-2 rounded-lg bg-ink-50 px-2.5 py-1.5 dark:bg-white/[0.04]">
                        <ProductChip src={review.product.image} alt={review.product.title} />
                        <span className="text-[11.5px] font-medium text-ink-600 dark:text-ink-300">
                          {review.product.title}
                        </span>
                      </div>
                    )}

                    {/* ── Actions ── */}
                    <div className="mt-3.5 flex flex-wrap items-center gap-1">
                      <ActionButton
                        size="sm"
                        variant={review.isPublished ? 'ghost' : 'primary'}
                        icon={review.isPublished ? EyeOff : Eye}
                        disabled={busy}
                        onClick={() => handleTogglePublish(review)}
                      >
                        {review.isPublished ? 'Unpublish' : 'Approve & publish'}
                      </ActionButton>
                      <ActionButton
                        size="sm"
                        variant="ghost"
                        icon={Award}
                        disabled={busy}
                        onClick={() => handleToggleFeature(review)}
                      >
                        {review.isFeatured ? 'Unfeature' : 'Feature'}
                      </ActionButton>
                      <ActionButton
                        size="sm"
                        variant="ghost"
                        icon={Pin}
                        disabled={busy}
                        onClick={() => handleTogglePin(review)}
                      >
                        {review.isPinned ? 'Unpin' : 'Pin'}
                      </ActionButton>
                      <ActionButton
                        size="sm"
                        variant="ghost"
                        icon={MessageSquare}
                        onClick={() => { setReplyText(review.reply || ''); setReplyDialog(review.id); }}
                      >
                        {review.reply ? 'Edit reply' : 'Reply'}
                      </ActionButton>

                      <div className="flex-1" />

                      <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-400">
                        <ThumbsUp className="size-3" />
                        <span className="tnum">{review.helpfulCount}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-400">
                        <ThumbsDown className="size-3" />
                        <span className="tnum">{review.notHelpfulCount}</span>
                      </span>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="ring-focus rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-white/8"
                            aria-label="More actions"
                          >
                            <MoreHorizontal className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl">
                          <DropdownMenuItem onClick={() => { setReplyText(review.reply || ''); setReplyDialog(review.id); }}>
                            <Edit3 className="mr-2 size-3.5" />{review.reply ? 'Edit reply' : 'Add reply'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-rose-600" onClick={() => handleDelete(review.id)}>
                            <Trash2 className="mr-2 size-3.5" />Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {/* ── Pagination ── */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <ActionButton
            size="sm"
            variant="outline"
            icon={ChevronLeft}
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            Previous
          </ActionButton>
          <span className="tnum px-3 text-[12.5px] text-ink-500">
            Page {page} of {totalPages}
          </span>
          <ActionButton
            size="sm"
            variant="outline"
            trailingIcon={ChevronRight}
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next
          </ActionButton>
        </div>
      )}

      {/* ── Bulk action bar ──
          Floats over the list once something is selected, so the actions are reachable
          without scrolling back to a toolbar at the top of a long queue. */}
      {selectedIds.size > 0 && (
        <div className="animate-pop pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-6">
          <div className="surface-float pointer-events-auto flex items-center gap-2 rounded-2xl px-3 py-2.5">
            <span className="px-2 text-[12.5px] font-semibold text-ink-700 dark:text-ink-200">
              <span className="tnum">{selectedIds.size}</span> selected
            </span>
            <span className="h-5 w-px bg-border" />
            <ActionButton size="sm" icon={Check} onClick={() => handleBulkAction('publish')}>
              Publish
            </ActionButton>
            <ActionButton size="sm" variant="outline" icon={EyeOff} onClick={() => handleBulkAction('unpublish')}>
              Unpublish
            </ActionButton>
            <ActionButton size="sm" variant="outline" icon={Award} onClick={() => handleBulkAction('feature')}>
              Feature
            </ActionButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="ring-focus rounded-lg p-2 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-white/8"
                  aria-label="More bulk actions"
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="rounded-xl">
                <DropdownMenuLabel className="text-[12px]">
                  Apply to {selectedIds.size} review{selectedIds.size === 1 ? '' : 's'}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-rose-600" onClick={() => handleBulkAction('delete')}>
                  <Trash2 className="mr-2 size-3.5" />Delete selected
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ring-focus rounded-lg p-2 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-white/8"
              aria-label="Clear selection"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Reply dialog ── */}
      <Dialog open={replyDialog !== null} onOpenChange={(open) => !open && setReplyDialog(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-[16px]">
              Reply to {reviews.find(r => r.id === replyDialog)?.reviewerName ?? 'this review'}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="Thanks for taking the time to review…"
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            className="min-h-[120px] rounded-xl text-[13px]"
          />
          <p className="text-[11.5px] text-ink-400">
            Your reply appears publicly beneath the review on your storefront.
          </p>
          <div className="flex justify-end gap-2">
            <ActionButton size="sm" variant="ghost" onClick={() => setReplyDialog(null)}>
              Cancel
            </ActionButton>
            <ActionButton size="sm" onClick={() => replyDialog && handleReply(replyDialog)}>
              Post reply
            </ActionButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Tiny product avatar with a first-party fallback (was a picsum.photos URL). */
function ProductChip({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="flex size-5 items-center justify-center rounded bg-ink-200 dark:bg-white/10" aria-hidden>
        <ShoppingBag className="size-3 text-ink-400" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="size-5 rounded object-cover"
    />
  );
}
