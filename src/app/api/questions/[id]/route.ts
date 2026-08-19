import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withAuth, unauthorizedResponse } from '@/lib/auth';

const EDITABLE = ['isPublished', 'isPinned'] as const;

/** Publish, pin, or answer a question. */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { storeId } = await withAuth(request);
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    const question = await db.question.findFirst({ where: { id, storeId } });
    if (!question) return NextResponse.json({ error: 'Question not found' }, { status: 404 });

    // Allowlist, for the same reason the review route has one: a spread of the request
    // body would let a merchant rewrite storeId, askerEmail or createdAt.
    const data: Record<string, unknown> = {};
    for (const f of EDITABLE) if (f in body) data[f] = body[f];

    // Answering and publishing are one action in the UI: a question nobody answered is
    // not worth showing a shopper, and publishing it alone just advertises the silence.
    if (typeof body.answer === 'string' && body.answer.trim()) {
      // The fallback used to be the literal string 'Store', and nothing in the UI ever
      // sent `answerAuthor` — so every merchant's answers were signed "Store" on their own
      // product pages. A shopper reading "Store said:" under a question is being shown a
      // placeholder, and it makes a real reply look automated.
      //
      // The store's own name is both truthful and what a shopper expects. 'Store' survives
      // only as the last resort for a store row with no name at all.
      const explicit = typeof body.answerAuthor === 'string' ? body.answerAuthor.trim() : '';
      const store = explicit
        ? null
        : await db.store.findUnique({ where: { id: storeId }, select: { name: true } });

      await db.answer.create({
        data: {
          questionId: id,
          authorName: explicit || store?.name?.trim() || 'Store',
          authorType: 'merchant',
          body: body.answer.trim().slice(0, 5000),
          isPublished: true,
        },
      });
      data.isPublished = true;
    }

    const updated = await db.question.update({
      where: { id },
      data,
      include: { answers: { orderBy: { createdAt: 'asc' } } },
    });

    return NextResponse.json(updated);
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[questions/:id]', error);
    return NextResponse.json({ error: 'Failed to update question' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { storeId } = await withAuth(request);
    const { id } = await params;
    const question = await db.question.findFirst({ where: { id, storeId } });
    if (!question) return NextResponse.json({ error: 'Question not found' }, { status: 404 });
    // Answers cascade — see the relation in schema.prisma.
    await db.question.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    return NextResponse.json({ error: 'Failed to delete question' }, { status: 500 });
  }
}
