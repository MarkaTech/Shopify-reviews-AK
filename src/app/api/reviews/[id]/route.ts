import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { storeId } = await withAuth(request);
    const { id } = await params;
    const review = await db.review.findFirst({
      where: { id, storeId },
      include: {
        product: { select: { id: true, title: true, image: true, handle: true } },
        store: { select: { id: true, name: true, domain: true } },
      },
    });
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });
    return NextResponse.json(review);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[Failed to fetch review]', error);
    return NextResponse.json({ error: 'Failed to fetch review' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { storeId } = await withAuth(request);
    const { id } = await params;
    const body = await request.json();

    let sentiment = body.sentiment;
    if (body.rating && !body.sentiment) {
      if (body.rating >= 4) sentiment = 'positive';
      else if (body.rating <= 2) sentiment = 'negative';
      else sentiment = 'neutral';
    }

    const data: Record<string, unknown> = { ...body };
    if (sentiment) data.sentiment = sentiment;
    if (body.images) data.images = JSON.stringify(body.images);
    if (body.customFields) data.customFields = JSON.stringify(body.customFields);

    const review = await db.review.findFirst({ where: { id, storeId } });
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });

    const updated = await db.review.update({
      where: { id },
      data,
      include: { product: { select: { id: true, title: true, image: true } } },
    });

    return NextResponse.json(updated);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[Failed to update review]', error);
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { storeId } = await withAuth(request);
    const { id } = await params;

    const review = await db.review.findFirst({ where: { id, storeId } });
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });

    await db.review.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[Failed to delete review]', error);
    return NextResponse.json({ error: 'Failed to delete review' }, { status: 500 });
  }
}
