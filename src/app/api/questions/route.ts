import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withAuth, unauthorizedResponse } from '@/lib/auth';

/** Merchant-facing Q&A list. */
export async function GET(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // pending | published | answered | unanswered
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = Math.min(50, Number(searchParams.get('limit')) || 20);

    const where: Record<string, unknown> = { storeId };
    if (status === 'pending') where.isPublished = false;
    if (status === 'published') where.isPublished = true;
    if (status === 'unanswered') where.answers = { none: {} };
    if (status === 'answered') where.answers = { some: {} };

    const [questions, total] = await Promise.all([
      db.question.findMany({
        where,
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          answers: { orderBy: { createdAt: 'asc' } },
          product: { select: { id: true, title: true, image: true } },
        },
      }),
      db.question.count({ where }),
    ]);

    return NextResponse.json({ questions, total, page, limit });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[questions]', error);
    return NextResponse.json({ error: 'Failed to load questions' }, { status: 500 });
  }
}
