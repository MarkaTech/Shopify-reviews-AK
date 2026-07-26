import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';

const REVIEWER_NAMES = [
  "Sarah M.", "James K.", "Emily R.", "Michael T.", "Jessica L.",
  "David W.", "Amanda P.", "Chris B.", "Nicole H.", "Ryan S.",
  "Laura C.", "Kevin D.", "Rachel G.", "Tom F.", "Stephanie V.",
];

const REVIEW_BODIES = [
  "Absolutely love this product! It exceeded all my expectations. The quality is top-notch and it arrived much faster than I anticipated.",
  "Good value for the price. Works as described but could use some minor improvements. Overall satisfied with my purchase.",
  "Decent product for the price point. Nothing spectacular but gets the job done. Would recommend for budget-conscious buyers.",
  "This is exactly what I was looking for! Perfect fit, great quality, and the color is even better in person.",
  "Not bad but not great either. The product is okay - does what it is supposed to do. Shipping was fast though.",
  "Five stars all the way! This product has made my life so much easier. Highly recommend to anyone.",
  "The product arrived damaged. Contacted customer service and they were very helpful. Replacement is on the way.",
  "Best purchase I have made this year! The quality is premium and it looks even better than the pictures.",
];

function generateImportedReviews(source: string, count: number, storeId: string) {
  return Array.from({ length: count }, (_, i) => {
    const rating = [5, 4, 5, 4, 3, 5, 4, 3, 2, 1][Math.floor(Math.random() * 10)];
    const sentiment = rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral';
    const daysAgo = Math.floor(Math.random() * 90);
    const reviewDate = new Date(Date.now() - daysAgo * 86400000);

    return {
      storeId,
      reviewerName: REVIEWER_NAMES[Math.floor(Math.random() * REVIEWER_NAMES.length)],
      reviewerEmail: null,
      reviewerLocation: null,
      reviewerAvatar: null,
      verifiedPurchase: Math.random() > 0.5,
      rating,
      title: `${rating >= 4 ? 'Great' : rating === 3 ? 'Okay' : 'Disappointing'} purchase from ${source}`,
      body: REVIEW_BODIES[Math.floor(Math.random() * REVIEW_BODIES.length)],
      images: Math.random() > 0.7 ? JSON.stringify([`https://picsum.photos/seed/${source}${i}/400/400`]) : null,
      videoUrl: null,
      source,
      sourceUrl: `https://${source}.com/review/${Math.floor(Math.random() * 100000)}`,
      sourceProductId: `${source}_prod_${Math.floor(Math.random() * 1000)}`,
      sentiment,
      isFeatured: Math.random() > 0.9,
      isPublished: true,
      isPinned: false,
      reply: null,
      repliedAt: null,
      helpfulCount: Math.floor(Math.random() * 20),
      notHelpfulCount: Math.floor(Math.random() * 5),
      reviewDate,
    };
  });
}

export async function GET(request: Request) {
  try {
    const { storeId } = await withAuth(request);
    const jobs = await db.importJob.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ jobs });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    return NextResponse.json({ error: 'Failed to fetch import jobs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const { source, config } = await request.json();
    const reviewCount = 5 + Math.floor(Math.random() * 11);
    const reviews = generateImportedReviews(source, reviewCount, storeId);

    const created = await db.review.createMany({ data: reviews });

    const job = await db.importJob.create({
      data: {
        storeId,
        source,
        status: 'completed',
        totalReviews: reviewCount,
        importedReviews: created.count,
        failedReviews: 0,
        config: config ? JSON.stringify(config) : null,
        startedAt: new Date(Date.now() - 5000),
        completedAt: new Date(),
      },
    });

    return NextResponse.json({ job, importedReviews: created.count }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('Error importing reviews:', error);
    return NextResponse.json({ error: 'Failed to import reviews' }, { status: 500 });
  }
}
