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
    const body = (await request.json()) as { reply?: unknown };
    // Typed and capped. `reply` was accepted as anything truthy: an object became a Prisma
    // 500, and an unbounded string was stored and shipped to every shopper in the
    // storefront payload. 5000 matches the answer cap on the Q&A route.
    const reply = typeof body.reply === 'string' ? body.reply.trim().slice(0, 5000) : '';
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
    console.error('[Failed to add reply]', error);
    return NextResponse.json({ error: 'Failed to add reply' }, { status: 500 });
  }
}
