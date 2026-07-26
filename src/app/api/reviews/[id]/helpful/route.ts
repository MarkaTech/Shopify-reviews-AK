import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { storeId } = await withAuth(request);
    const { id } = await params;
    const { type } = await request.json();

    const review = await db.review.findFirst({ where: { id, storeId } });
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });

    const data = type === 'helpful'
      ? { helpfulCount: { increment: 1 } }
      : { notHelpfulCount: { increment: 1 } };

    const updated = await db.review.update({
      where: { id },
      data,
    });
    return NextResponse.json(updated);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[Failed to update review]', error);
    return NextResponse.json({ error: 'Failed to update review' }, { status: 500 });
  }
}
