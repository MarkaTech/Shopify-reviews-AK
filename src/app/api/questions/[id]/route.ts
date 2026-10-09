import { NextRequest, NextResponse, after } from 'next/server';
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

      const answerBody = body.answer.trim().slice(0, 5000);
      const answeredBy = explicit || store?.name?.trim() || 'Store';
      await db.answer.create({
        data: {
          questionId: id,
          authorName: answeredBy,
          authorType: 'merchant',
          body: answerBody,
          isPublished: true,
        },
      });
      data.isPublished = true;

      // Fulfil what the form promised: "used only to let you know when the shop answers".
      // Once — the first answer that actually reaches the provider notifies; notifiedAt
      // stops a later answer mailing again.
      const asked = await db.question.findUnique({
        where: { id },
        select: { askerName: true, askerEmail: true, body: true, notifiedAt: true, product: { select: { title: true, handle: true } } },
      });
      if (asked?.askerEmail && !asked.notifiedAt) {
        const askerEmail = asked.askerEmail;
        const shopDomain = (await db.store.findUnique({ where: { id: storeId }, select: { shopifyDomain: true, name: true } }));
        after(async () => {
          // Claim before sending, release on failure. Two answers in quick succession (a
          // double-click, a retried PUT) both saw notifiedAt null above; the conditional
          // update lets exactly one of them send, and a failed send gives the claim back
          // so a later answer tries again.
          const claimed = await db.question.updateMany({
            where: { id, storeId, notifiedAt: null },
            data: { notifiedAt: new Date() },
          });
          if (!claimed.count) return;
          const release = () =>
            db.question.updateMany({ where: { id, storeId }, data: { notifiedAt: null } }).catch(() => undefined);
          try {
            const { renderAnswerEmail, sendEmail } = await import('@/lib/email');
            const { unsubscribeToken } = await import('@/app/api/unsubscribe/route');
            const appUrl = process.env.SHOPIFY_APP_URL || '';
            const msg = renderAnswerEmail({
              storeName: shopDomain?.name || shopDomain?.shopifyDomain || 'The store',
              askerName: asked.askerName,
              question: asked.body,
              answer: answerBody,
              answeredBy,
              productTitle: asked.product?.title ?? null,
              productUrl: asked.product?.handle && shopDomain?.shopifyDomain ? `https://${shopDomain.shopifyDomain}/products/${asked.product.handle}` : null,
              unsubscribeUrl: appUrl ? `${appUrl}/api/unsubscribe?t=${encodeURIComponent(unsubscribeToken(askerEmail))}` : undefined,
            });
            const r = await sendEmail({ ...msg, to: askerEmail });
            // Kept only once the provider has accepted the message. It used to be written
            // with the answer itself and never given back, so a not-yet-configured provider
            // or a suppressed address left the shopper untold — and every later answer
            // skipped the mail because the row said it had gone.
            if (!r.sent) {
              console.warn('[questions] answer notification not sent:', r.reason);
              await release();
            }
          } catch (err) {
            console.error('[questions] answer notification failed:', err);
            await release();
          }
        });
      }
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
