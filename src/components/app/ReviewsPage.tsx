'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Star, Filter, Search, Download, Trash2, Edit3, Eye, EyeOff,
  ThumbsUp, ThumbsDown, MessageSquare, ChevronDown, ChevronUp,
  Pin, Award, ImagePlus, MoreHorizontal, RefreshCw, X, Check,
  Clock, ShoppingBag, MapPin, Mail, ExternalLink
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { toast } from 'sonner';
import { apiFetch, errorMessage } from '@/lib/api-client';

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
  reply: string | null;
  repliedAt: string | null;
  helpfulCount: number;
  notHelpfulCount: number;
  reviewDate: string;
  createdAt: string;
  product: { id: string; title: string; image: string | null } | null;
}

const sourceLabels: Record<string, string> = {
  direct: 'Direct', amazon: 'Amazon', ebay: 'eBay', etsy: 'Etsy',
  walmart: 'Walmart', alibaba: 'Alibaba', shopify: 'Shopify', csv: 'CSV',
};

function StarRating({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <Star key={s} className={`${sizeClass} ${s <= rating ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`} />
      ))}
    </div>
  );
}

export default function ReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [replyDialog, setReplyDialog] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

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
   *
   * `typescript.ignoreBuildErrors: true` in next.config.ts is why this shipped — tsc had
   * been reporting it the whole time.
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
      params.set('limit', '20');

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

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

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

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
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
    try {
      await apiFetch(`/api/reviews/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      toast.success(successMsg);
      await fetchReviews();
    } catch (err) {
      // Previously every one of these reported success unconditionally, so a failed
      // request still showed "Review published" while nothing had changed.
      toast.error(errorMessage(err, 'Could not update the review'));
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

  const activeFilterCount = [ratingFilter, sourceFilter, sentimentFilter, publishedFilter, verifiedFilter, imagesFilter].filter(f => f !== 'all').length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold">Reviews</h2>
          <p className="text-xs text-muted-foreground">{total} total reviews • {selectedIds.size} selected</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1">
                  <MessageSquare className="w-3.5 h-3.5" /> Bulk Actions ({selectedIds.size})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Apply to {selectedIds.size} reviews</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleBulkAction('publish')}><Check className="w-3.5 h-3.5 mr-2" />Publish</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkAction('unpublish')}><EyeOff className="w-3.5 h-3.5 mr-2" />Unpublish</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBulkAction('feature')}><Award className="w-3.5 h-3.5 mr-2" />Feature</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleBulkAction('delete')} className="text-red-600"><Trash2 className="w-3.5 h-3.5 mr-2" />Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={exportCsv}>
            <Download className="w-3.5 h-3.5" /> Export
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => setSelectedIds(new Set())}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search reviews by name, title, or content..." className="pl-8 h-8 text-xs" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            </div>
            <Select value={ratingFilter} onValueChange={v => { setRatingFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[100px] h-8 text-xs"><SelectValue placeholder="Rating" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Ratings</SelectItem>
                <SelectItem value="5">5 Stars</SelectItem>
                <SelectItem value="4">4 Stars</SelectItem>
                <SelectItem value="3">3 Stars</SelectItem>
                <SelectItem value="2">2 Stars</SelectItem>
                <SelectItem value="1">1 Star</SelectItem>
                <SelectItem value="4,5">4-5 Stars</SelectItem>
                <SelectItem value="1,2,3">1-3 Stars</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={v => { setSourceFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[110px] h-8 text-xs"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {Object.entries(sourceLabels).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="reviewDate">Newest First</SelectItem>
                <SelectItem value="rating">Highest Rated</SelectItem>
                <SelectItem value="helpfulCount">Most Helpful</SelectItem>
                <SelectItem value="reviewerName">Reviewer Name</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={showFilters ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs gap-1"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="w-3.5 h-3.5" /> More Filters
              {activeFilterCount > 0 && (
                <Badge className="ml-1 bg-red-500 text-white text-[10px] h-4 w-4 p-0 flex items-center justify-center">{activeFilterCount}</Badge>
              )}
            </Button>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => {
                setRatingFilter('all'); setSourceFilter('all'); setSentimentFilter('all');
                setPublishedFilter('all'); setVerifiedFilter('all'); setImagesFilter('all');
              }}>
                <X className="w-3 h-3 mr-1" /> Clear
              </Button>
            )}
          </div>

          {/* Expanded Filters */}
          {showFilters && (
            <div className="mt-3 pt-3 border-t grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              <Select value={sentimentFilter} onValueChange={v => { setSentimentFilter(v); setPage(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sentiment" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sentiments</SelectItem>
                  <SelectItem value="positive">Positive</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                  <SelectItem value="negative">Negative</SelectItem>
                </SelectContent>
              </Select>
              <Select value={publishedFilter} onValueChange={v => { setPublishedFilter(v); setPage(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="true">Published</SelectItem>
                  <SelectItem value="false">Unpublished</SelectItem>
                </SelectContent>
              </Select>
              <Select value={verifiedFilter} onValueChange={v => { setVerifiedFilter(v); setPage(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Verified" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="true">Verified Purchase</SelectItem>
                  <SelectItem value="false">Not Verified</SelectItem>
                </SelectContent>
              </Select>
              <Select value={imagesFilter} onValueChange={v => { setImagesFilter(v); setPage(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Images" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="true">With Images</SelectItem>
                  <SelectItem value="false">Without Images</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortOrder} onValueChange={setSortOrder}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Order" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Descending</SelectItem>
                  <SelectItem value="asc">Ascending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reviews List */}
      <div className="space-y-3">
        {/* Select All Bar */}
        <div className="flex items-center gap-3 px-1">
          <Checkbox checked={reviews.length > 0 && selectedIds.size === reviews.length} onCheckedChange={toggleSelectAll} />
          <span className="text-xs text-muted-foreground">{reviews.length} reviews on this page</span>
        </div>

        {loading ? (
          <div className="space-y-3 animate-pulse">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-40 bg-gray-100 rounded-xl" />
            ))}
          </div>
        ) : reviews.length === 0 ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="py-16 text-center">
              <MessageSquare className="w-12 h-12 mx-auto text-muted-foreground/30" />
              <p className="text-sm font-medium mt-3">No reviews found</p>
              <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters</p>
            </CardContent>
          </Card>
        ) : (
          reviews.map((review) => {
            const images = review.images ? JSON.parse(review.images) : [];
            return (
              <Card key={review.id} className={`border-0 shadow-sm transition-all ${!review.isPublished ? 'opacity-60' : ''} ${review.isPinned ? 'ring-2 ring-amber-300' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    <div className="flex items-center">
                      <Checkbox checked={selectedIds.has(review.id)} onCheckedChange={() => toggleSelect(review.id)} />
                    </div>

                    <Avatar className="w-9 h-9 flex-shrink-0">
                      <AvatarFallback className="text-xs bg-gradient-to-br from-emerald-400 to-teal-500 text-white font-bold">
                        {review.reviewerName.charAt(0)}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      {/* Review Header */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{review.reviewerName}</span>
                        <StarRating rating={review.rating} />
                        {review.verifiedPurchase && (
                          <Badge className="bg-emerald-100 text-emerald-700 text-[10px] h-4 px-1.5 gap-0.5">
                            <Check className="w-2.5 h-2.5" /> Verified
                          </Badge>
                        )}
                        {review.isFeatured && (
                          <Badge className="bg-amber-100 text-amber-700 text-[10px] h-4 px-1.5 gap-0.5">
                            <Award className="w-2.5 h-2.5" /> Featured
                          </Badge>
                        )}
                        {review.isPinned && (
                          <Badge className="bg-orange-100 text-orange-700 text-[10px] h-4 px-1.5 gap-0.5">
                            <Pin className="w-2.5 h-2.5" /> Pinned
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5">{sourceLabels[review.source] || review.source}</Badge>
                        <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${review.sentiment === 'positive' ? 'border-emerald-200 text-emerald-600' : review.sentiment === 'negative' ? 'border-red-200 text-red-600' : 'border-amber-200 text-amber-600'}`}>
                          {review.sentiment}
                        </Badge>
                        {!review.isPublished && (
                          <Badge variant="secondary" className="text-[10px] h-4 px-1.5">Unpublished</Badge>
                        )}
                      </div>

                      {/* Reviewer Details */}
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(review.reviewDate).toLocaleDateString()}</span>
                        {review.reviewerLocation && (
                          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{review.reviewerLocation}</span>
                        )}
                        {review.reviewerEmail && (
                          <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{review.reviewerEmail}</span>
                        )}
                      </div>

                      {/* Review Content */}
                      {review.title && <p className="text-sm font-medium mt-2">{review.title}</p>}
                      <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{review.body}</p>

                      {/* Review media.
                          Moderators need to SEE what a shopper attached before approving it —
                          a review that reads well can carry an image that must not go on a
                          storefront. Photos open full size; video plays inline with controls. */}
                      {(images.length > 0 || review.videoUrl) && (
                        <div className="flex gap-2 mt-2 flex-wrap items-start">
                          {images.map((img: string, i: number) => (
                            <a
                              key={i}
                              href={img}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open full size"
                            >
                              <img
                                src={img}
                                alt={`Photo ${i + 1} from ${review.reviewerName}`}
                                loading="lazy"
                                className="w-16 h-16 rounded-lg object-cover bg-gray-100 cursor-pointer hover:opacity-80 transition-opacity"
                              />
                            </a>
                          ))}
                          {review.videoUrl && (
                            <video
                              src={review.videoUrl}
                              controls
                              preload="metadata"
                              className="h-16 rounded-lg bg-gray-900"
                            />
                          )}
                        </div>
                      )}

                      {/* Store Reply */}
                      {review.reply && (
                        <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                          <p className="text-[11px] font-semibold text-blue-700 flex items-center gap-1">
                            <ShoppingBag className="w-3 h-3" /> Store Reply • {review.repliedAt ? new Date(review.repliedAt).toLocaleDateString() : ''}
                          </p>
                          <p className="text-xs text-blue-800 mt-1">{review.reply}</p>
                        </div>
                      )}

                      {/* Product Tag */}
                      {review.product && (
                        <div className="flex items-center gap-2 mt-2 p-2 bg-gray-50 rounded-lg w-fit">
                          <img src={review.product.image || 'https://picsum.photos/seed/fallback/30/30'} className="w-5 h-5 rounded object-cover" alt="" />
                          <span className="text-[11px] text-muted-foreground">{review.product.title}</span>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-1 mt-3">
                        <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={() => handleTogglePublish(review)}>
                          {review.isPublished ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          {review.isPublished ? 'Unpublish' : 'Publish'}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={() => handleToggleFeature(review)}>
                          <Award className="w-3 h-3" />{review.isFeatured ? 'Unfeature' : 'Feature'}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1" onClick={() => handleTogglePin(review)}>
                          <Pin className="w-3 h-3" />{review.isPinned ? 'Unpin' : 'Pin'}
                        </Button>
                        <Dialog open={replyDialog === review.id} onOpenChange={() => setReplyDialog(replyDialog === review.id ? null : review.id)}>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 text-[11px] gap-1">
                              <MessageSquare className="w-3 h-3" />{review.reply ? 'Edit Reply' : 'Reply'}
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle className="text-sm">Reply to {review.reviewerName}</DialogTitle>
                            </DialogHeader>
                            <Textarea placeholder="Write your reply..." value={replyText} onChange={e => setReplyText(e.target.value)} className="min-h-[100px]" />
                            <div className="flex justify-end gap-2">
                              <Button variant="outline" size="sm" onClick={() => setReplyDialog(null)}>Cancel</Button>
                              <Button size="sm" onClick={() => handleReply(review.id)}>Send Reply</Button>
                            </div>
                          </DialogContent>
                        </Dialog>
                        <div className="flex-1" />
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <ThumbsUp className="w-3 h-3" />{review.helpfulCount}
                        </span>
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <ThumbsDown className="w-3 h-3" />{review.notHelpfulCount}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => { setReplyText(review.reply || ''); setReplyDialog(review.id); }}>
                              <Edit3 className="w-3.5 h-3.5 mr-2" />{review.reply ? 'Edit Reply' : 'Add Reply'}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(review.id)}>
                              <Trash2 className="w-3.5 h-3.5 mr-2" />Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {total > 20 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-xs text-muted-foreground px-2">Page {page} of {Math.ceil(total / 20)}</span>
          <Button variant="outline" size="sm" className="h-8 text-xs" disabled={page >= Math.ceil(total / 20)} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
