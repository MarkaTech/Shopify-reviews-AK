import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';

export async function GET(request: Request) {
  try {
    const { storeId } = await withAuth(request);

    const [totalReviews, publishedReviews, pendingReviews, allReviews, products] = await Promise.all([
      db.review.count({ where: { storeId } }),
      db.review.count({ where: { storeId, isPublished: true } }),
      db.review.count({ where: { storeId, isPublished: false } }),
      db.review.findMany({ where: { storeId } }),
      db.product.findMany({
        where: { storeId },
        include: { _count: { select: { reviews: true } }, reviews: { select: { rating: true } } },
      }),
    ]);

    const ratings = allReviews.map(r => r.rating);
    const averageRating = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0;

    const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    allReviews.forEach(r => { ratingDistribution[r.rating as keyof typeof ratingDistribution]++; });

    const reviewsBySource: Record<string, number> = {};
    allReviews.forEach(r => { reviewsBySource[r.source] = (reviewsBySource[r.source] || 0) + 1; });

    const now = new Date();
    const reviewsOverTime: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const nextDay = new Date(date);
      nextDay.setDate(nextDay.getDate() + 1);
      const count = allReviews.filter(r => {
        const rd = new Date(r.reviewDate);
        return rd >= date && rd < nextDay;
      }).length;
      reviewsOverTime.push({ date: dateStr, count });
    }

    const topProducts = products
      .map(p => {
        const pRatings = p.reviews.map(r => r.rating);
        const avg = pRatings.length ? pRatings.reduce((a, b) => a + b, 0) / pRatings.length : 0;
        return {
          product: { id: p.id, title: p.title, image: p.image, price: p.price },
          reviewCount: p._count.reviews,
          avgRating: Math.round(avg * 10) / 10,
        };
      })
      .sort((a, b) => b.reviewCount - a.reviewCount)
      .slice(0, 5);

    const recentReviews = await db.review.findMany({
      where: { storeId },
      include: { product: { select: { id: true, title: true, image: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const verifiedCount = allReviews.filter(r => r.verifiedPurchase).length;
    const verifiedPercentage = totalReviews ? Math.round((verifiedCount / totalReviews) * 100) : 0;

    const repliedCount = allReviews.filter(r => r.reply).length;
    const responseRate = totalReviews ? Math.round((repliedCount / totalReviews) * 100) : 0;

    const sentimentDistribution: Record<string, number> = { positive: 0, neutral: 0, negative: 0 };
    allReviews.forEach(r => { sentimentDistribution[r.sentiment || 'neutral']++; });

    const reviewsWithImages = allReviews.filter(r => r.images && JSON.parse(r.images || '[]').length > 0).length;
    const featuredCount = allReviews.filter(r => r.isFeatured).length;

    return NextResponse.json({
      totalReviews, publishedReviews, pendingReviews, averageRating,
      ratingDistribution, reviewsBySource, reviewsOverTime, topProducts,
      recentReviews, verifiedPercentage, responseRate,
      sentimentDistribution, reviewsWithImages, featuredCount,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('Error fetching analytics:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics' }, { status: 500 });
  }
}
