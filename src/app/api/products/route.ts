import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const { storeId } = withAuth(request);
    const searchParams = request.nextUrl.searchParams;

    const where: Record<string, unknown> = { storeId };

    const search = searchParams.get('search');
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { vendor: { contains: search } },
        { productType: { contains: search } },
      ];
    }

    const hasReviews = searchParams.get('hasReviews');
    if (hasReviews === 'true') {
      where.reviews = { some: {} };
    }

    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';
    const orderBy: Record<string, string> = {};
    orderBy[sortBy] = sortOrder;

    const page = Number(searchParams.get('page')) || 1;
    const limit = Number(searchParams.get('limit')) || 20;
    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      db.product.findMany({
        where,
        include: {
          _count: { select: { reviews: true } },
          reviews: { select: { rating: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      db.product.count({ where }),
    ]);

    const productsWithStats = products.map(p => {
      const ratings = p.reviews.map(r => r.rating);
      const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
      return {
        id: p.id,
        shopifyId: p.shopifyId,
        title: p.title,
        handle: p.handle,
        description: p.description,
        image: p.image,
        price: p.price,
        vendor: p.vendor,
        productType: p.productType,
        tags: p.tags,
        isVisible: p.isVisible,
        createdAt: p.createdAt,
        reviewCount: p._count.reviews,
        averageRating: Math.round(avgRating * 10) / 10,
      };
    });

    return NextResponse.json({ products: productsWithStats, total, page });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('Error fetching products:', error);
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { storeId } = withAuth(request);
    const body = await request.json();
    const product = await db.product.create({
      data: {
        storeId,
        shopifyId: body.shopifyId || null,
        title: body.title,
        handle: body.handle || null,
        description: body.description || null,
        image: body.image || null,
        price: body.price || null,
        vendor: body.vendor || null,
        productType: body.productType || null,
        tags: body.tags ? JSON.stringify(body.tags) : null,
      },
    });
    return NextResponse.json(product, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('Error creating product:', error);
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 });
  }
}
