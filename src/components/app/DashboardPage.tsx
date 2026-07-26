'use client';

import React, { useState, useEffect } from 'react';
import { Star, TrendingUp, MessageSquare, Eye, ThumbsUp, ImagePlus, Award, CheckCircle, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell
} from 'recharts';

const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899'];

interface Analytics {
  totalReviews: number;
  publishedReviews: number;
  pendingReviews: number;
  averageRating: number;
  ratingDistribution: Record<string, number>;
  reviewsBySource: Record<string, number>;
  reviewsOverTime: { date: string; count: number }[];
  topProducts: { product: { id: string; title: string; image: string; price: number | null }; reviewCount: number; avgRating: number }[];
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

const sourceLabels: Record<string, string> = {
  direct: 'Direct', amazon: 'Amazon', ebay: 'eBay', etsy: 'Etsy',
  walmart: 'Walmart', alibaba: 'Alibaba', shopify: 'Shopify', csv: 'CSV',
};

function StarRating({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = size === 'sm' ? 'w-3.5 h-3.5' : size === 'md' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <Star key={s} className={`${sizeClass} ${s <= rating ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`} />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/analytics')
      .then(res => res.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-28 bg-gray-100 rounded-xl" />
          ))}
        </div>
        <div className="h-80 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  const statsCards = [
    // No trend is calculated anywhere, so a hardcoded '+12%' was being shown on every
    // store regardless of its data — including brand-new stores with zero reviews.
    { label: 'Total Reviews', value: data.totalReviews, icon: MessageSquare, color: 'text-blue-600 bg-blue-50', change: `${data.totalReviews === 1 ? '1 review' : `${data.totalReviews} reviews`} total` },
    { label: 'Average Rating', value: data.averageRating.toFixed(1), icon: Star, color: 'text-amber-600 bg-amber-50', change: data.totalReviews > 0 ? 'across all reviews' : 'no reviews yet' },
    { label: 'Published', value: data.publishedReviews, icon: Eye, color: 'text-emerald-600 bg-emerald-50', change: `${data.pendingReviews} pending` },
    { label: 'Verified', value: `${data.verifiedPercentage}%`, icon: CheckCircle, color: 'text-teal-600 bg-teal-50', change: `${data.reviewsWithImages} with photos` },
  ];

  const sentimentData = [
    { name: 'Positive', value: data.sentimentDistribution.positive || 0, color: '#10b981' },
    { name: 'Neutral', value: data.sentimentDistribution.neutral || 0, color: '#f59e0b' },
    { name: 'Negative', value: data.sentimentDistribution.negative || 0, color: '#ef4444' },
  ];

  const sourceData = Object.entries(data.reviewsBySource).map(([key, value]) => ({
    name: sourceLabels[key] || key, value
  }));

  const ratingDistData = Object.entries(data.ratingDistribution).map(([key, value]) => ({
    stars: `${key} Star`, count: value, pct: data.totalReviews ? Math.round((value / data.totalReviews) * 100) : 0
  }));

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsCards.map((stat) => (
          <Card key={stat.label} className="border-0 shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-medium">{stat.label}</p>
                  <p className="text-2xl font-bold mt-1">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.change}</p>
                </div>
                <div className={`p-2.5 rounded-lg ${stat.color}`}>
                  <stat.icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Reviews Over Time */}
        <Card className="lg:col-span-2 border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Reviews Over Time</CardTitle>
            <CardDescription className="text-xs">Last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.reviewsOverTime}>
                  <defs>
                    <linearGradient id="colorReviews" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Area type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} fill="url(#colorReviews)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Sentiment Distribution */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Sentiment Analysis</CardTitle>
            <CardDescription className="text-xs">AI-powered analysis</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={sentimentData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value" paddingAngle={3}>
                    {sentimentData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4 mt-1">
              {sentimentData.map((s) => (
                <div key={s.name} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="text-muted-foreground">{s.name}</span>
                  <span className="font-semibold">{s.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Rating Distribution */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Rating Distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {ratingDistData.reverse().map((item) => (
              <div key={item.stars} className="flex items-center gap-3">
                <span className="text-xs font-medium w-14">{item.stars}</span>
                <div className="flex-1">
                  <Progress value={item.pct} className="h-2" />
                </div>
                <span className="text-xs font-semibold w-16 text-right">{item.count} ({item.pct}%)</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Top Products */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Top Reviewed Products</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.topProducts.map((item, i) => (
              <div key={item.product.id} className="flex items-center gap-3">
                <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}</span>
                <img src={item.product.image || 'https://picsum.photos/seed/fallback/40/40'} className="w-9 h-9 rounded-lg object-cover bg-gray-100" alt={item.product.title} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{item.product.title}</p>
                  <StarRating rating={Math.round(item.avgRating)} size="sm" />
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold">{item.reviewCount}</p>
                  <p className="text-[10px] text-muted-foreground">reviews</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Source Breakdown */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Reviews by Source</CardTitle>
          </CardHeader>
          <CardContent className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sourceData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={60} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="value" fill="#10b981" radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Recent Reviews */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-semibold">Recent Reviews</CardTitle>
              <CardDescription className="text-xs">Latest customer feedback</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                <ThumbsUp className="w-3 h-3 mr-1" />
                {data.responseRate}% Response Rate
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                <ImagePlus className="w-3 h-3 mr-1" />
                {data.reviewsWithImages} Photo Reviews
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {data.recentReviews.map((review) => (
              <div key={review.id} className="flex gap-3 p-3 rounded-lg bg-gray-50/50 hover:bg-gray-50 transition-colors">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                  {review.reviewerName.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold">{review.reviewerName}</span>
                    <StarRating rating={review.rating} size="sm" />
                    {review.verifiedPurchase && (
                      <Badge className="bg-emerald-100 text-emerald-700 text-[10px] h-4 px-1.5">Verified</Badge>
                    )}
                    {review.isFeatured && (
                      <Badge className="bg-amber-100 text-amber-700 text-[10px] h-4 px-1.5">Featured</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                      {sourceLabels[review.source] || review.source}
                    </Badge>
                  </div>
                  {review.title && <p className="text-xs font-medium mt-0.5">{review.title}</p>}
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{review.body}</p>
                </div>
                {review.product && (
                  <img src={review.product.image || 'https://picsum.photos/seed/fallback/40/40'} className="w-10 h-10 rounded-lg object-cover bg-gray-100 flex-shrink-0" alt={review.product?.title || 'Product'} />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
