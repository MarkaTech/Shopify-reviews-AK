'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShoppingBag, Search, RefreshCw, Star, MessageSquare, ArrowDownToLine,
  ExternalLink, ChevronDown, BarChart3, ImageIcon
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { apiFetch, ApiError, errorMessage } from '@/lib/api-client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

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

function StarRating({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <Star key={s} className={`${sizeClass} ${s <= Math.round(rating) ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`} />
      ))}
    </div>
  );
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
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

      const res = await fetch(`/api/products?${params}`);
      if (!cancelled) {
        const data = await res.json();
        setProducts(data.products || []);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [search, sortBy, sortOrder, hasReviewsFilter, refreshKey]);

  // --- Add Review dialog ---------------------------------------------------------
  // Both of these buttons were previously rendered with no onClick at all.
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
    const url = `https://admin.shopify.com/products/${product.shopifyId}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const data = await apiFetch<{ synced: number; total: number; source: string }>(
        '/api/products/sync', { method: 'POST' }
      );
      if (data.synced === 0) {
        toast.info(`No new products found. ${data.total} already synced.`);
      } else {
        toast.success(`Synced ${data.synced} new product${data.synced === 1 ? '' : 's'} from Shopify`);
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
    ? (products.reduce((sum, p) => sum + (p.averageRating * p.reviewCount), 0) / totalReviews).toFixed(1)
    : '0.0';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold">Products</h2>
          <p className="text-xs text-muted-foreground">{products.length} products synced from Shopify</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => setRefreshKey(k => k + 1)}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
          <Button onClick={handleSync} disabled={syncing} className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5">
            <ArrowDownToLine className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync Products'}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-50 rounded-lg"><ShoppingBag className="w-5 h-5 text-emerald-600" /></div>
              <div>
                <p className="text-[11px] text-muted-foreground">Total Products</p>
                <p className="text-xl font-bold">{products.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg"><MessageSquare className="w-5 h-5 text-blue-600" /></div>
              <div>
                <p className="text-[11px] text-muted-foreground">Total Reviews</p>
                <p className="text-xl font-bold">{totalReviews}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-50 rounded-lg"><Star className="w-5 h-5 text-amber-600" /></div>
              <div>
                <p className="text-[11px] text-muted-foreground">Avg Rating</p>
                <p className="text-xl font-bold">{avgAllRatings}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-teal-50 rounded-lg"><BarChart3 className="w-5 h-5 text-teal-600" /></div>
              <div>
                <p className="text-[11px] text-muted-foreground">With Reviews</p>
                <p className="text-xl font-bold">{products.filter(p => p.reviewCount > 0).length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search products..." className="pl-8 h-8 text-xs" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={hasReviewsFilter} onValueChange={setHasReviewsFilter}>
              <SelectTrigger className="w-[130px] h-8 text-xs"><SelectValue placeholder="Reviews" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Products</SelectItem>
                <SelectItem value="true">Has Reviews</SelectItem>
                <SelectItem value="false">No Reviews</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="createdAt">Newest</SelectItem>
                <SelectItem value="title">Name A-Z</SelectItem>
                <SelectItem value="reviews_count">Most Reviews</SelectItem>
                <SelectItem value="avg_rating">Highest Rated</SelectItem>
                <SelectItem value="price">Price</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Products Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          [...Array(6)].map((_, i) => (
            <div key={i} className="h-52 bg-gray-100 rounded-xl animate-pulse" />
          ))
        ) : products.length === 0 ? (
          <Card className="border-0 shadow-sm col-span-full">
            <CardContent className="py-16 text-center">
              <ShoppingBag className="w-12 h-12 mx-auto text-muted-foreground/30" />
              <p className="text-sm font-medium mt-3">No products found</p>
              <p className="text-xs text-muted-foreground mt-1">Sync products from Shopify to get started</p>
            </CardContent>
          </Card>
        ) : (
          products.map(product => (
            <Card key={product.id} className="border-0 shadow-sm hover:shadow-md transition-shadow group overflow-hidden">
              <div className="relative h-36 bg-gray-50">
                <img
                  src={product.image || `https://picsum.photos/seed/${product.id}/400/400`}
                  alt={product.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                {product.reviewCount > 0 && (
                  <div className="absolute top-2 left-2 bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1 flex items-center gap-1">
                    <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
                    <span className="text-[11px] font-bold">{product.averageRating.toFixed(1)}</span>
                    <span className="text-[10px] text-muted-foreground">({product.reviewCount})</span>
                  </div>
                )}
                {product.price && (
                  <div className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm rounded-lg px-2 py-1">
                    <span className="text-[11px] font-bold">${product.price.toFixed(2)}</span>
                  </div>
                )}
              </div>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold truncate group-hover:text-emerald-600 transition-colors">{product.title}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {product.vendor && (
                        <span className="text-[10px] text-muted-foreground">{product.vendor}</span>
                      )}
                      {product.productType && (
                        <Badge variant="outline" className="text-[9px] h-4 px-1.5">{product.productType}</Badge>
                      )}
                    </div>
                  </div>
                </div>

                {product.reviewCount > 0 ? (
                  <div className="mt-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <StarRating rating={product.averageRating} />
                      <span className="text-[10px] text-muted-foreground">{product.reviewCount} reviews</span>
                    </div>
                    <Progress value={(product.averageRating / 5) * 100} className="h-1.5" />
                  </div>
                ) : (
                  <div className="mt-3">
                    <p className="text-[11px] text-muted-foreground italic">No reviews yet</p>
                  </div>
                )}

                <div className="flex items-center gap-2 mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-7 text-[11px] gap-1"
                    onClick={() => openReviewDialog(product)}
                  >
                    <MessageSquare className="w-3 h-3" /> Add Review
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 p-0"
                    title="Open in Shopify admin"
                    onClick={() => openInShopify(product)}
                  >
                    <ExternalLink className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add Review dialog */}
      <Dialog open={reviewFor !== null} onOpenChange={(open) => !open && setReviewFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Add a review</DialogTitle>
            <DialogDescription className="text-xs">
              {reviewFor?.title}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="reviewerName" className="text-xs">Reviewer name *</Label>
              <Input
                id="reviewerName"
                value={form.reviewerName}
                onChange={(e) => setForm(f => ({ ...f, reviewerName: e.target.value }))}
                placeholder="Jane Doe"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Rating *</Label>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n} star${n === 1 ? '' : 's'}`}
                    onClick={() => setForm(f => ({ ...f, rating: n }))}
                    className="p-0.5"
                  >
                    <Star
                      className={`w-5 h-5 ${n <= form.rating ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`}
                    />
                  </button>
                ))}
                <span className="ml-2 text-xs text-muted-foreground">{form.rating} of 5</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reviewTitle" className="text-xs">Title</Label>
              <Input
                id="reviewTitle"
                value={form.title}
                onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Great product"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reviewBody" className="text-xs">Review *</Label>
              <Textarea
                id="reviewBody"
                value={form.body}
                onChange={(e) => setForm(f => ({ ...f, body: e.target.value }))}
                placeholder="What did the customer think?"
                rows={4}
                className="text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setReviewFor(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-xs"
              onClick={submitReview}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Add review'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
