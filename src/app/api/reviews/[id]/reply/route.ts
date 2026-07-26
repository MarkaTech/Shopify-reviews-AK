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
    const { reply } = await request.json();
    if (!reply) return NextResponse.json({ error: 'Reply text is required' }, { status: 400 });

    const review = await db.review.findFirst({ where: { id, storeId } });
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });

    const updated = await db.review.update({
      where: { id },
      data: { reply, repliedAt: new Date() },
    });
    return NextResponse.json(updated);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    return NextResponse.json({ error: 'Failed to add reply' }, { status: 500 });
  }
}
