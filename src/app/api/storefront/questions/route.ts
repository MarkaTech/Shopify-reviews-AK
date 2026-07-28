import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * Public Q&A — read published questions, and ask a new one.
 *
 * Same posture as the review endpoints: no auth, open CORS, cached reads, and nothing a
 * shopper submits is ever published without a merchant approving it. A public form that
 * writes straight to a storefront is a spam vector and a liability.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const CACHE = 'public, s-maxage=300, stale-while-revalidate=3600';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const shop = searchParams.get('shop');
    const shopifyProductId = searchParams.get('product_id');
    if (!shop) return NextResponse.json({ error: 'shop is required' }, { status: 400, headers: CORS });

    const store = await db.store.findUnique({
      where: { shopifyDomain: shop },
      select: { id: true, isActive: true },
    });
    if (!store?.isActive) {
      return NextResponse.json({ error: 'Unknown store' }, { status: 404, headers: CORS });
    }

    const product = shopifyProductId
      ? await db.product.findUnique({
          where: { storeId_shopifyId: { storeId: store.id, shopifyId: shopifyProductId } },
          select: { id: true },
        })
      : null;

    const questions = await db.question.findMany({
      where: {
        storeId: store.id,
        isPublished: true,
        ...(product ? { productId: product.id } : {}),
      },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      take: 20,
      select: {
        id: true,
        askerName: true,
        body: true,
        createdAt: true,
        helpfulCount: true,
        // askerEmail is deliberately absent — it is never public.
        answers: {
          where: { isPublished: true },
          orderBy: { createdAt: 'asc' },
          select: { id: true, authorName: true, authorType: true, body: true, createdAt: true },
        },
      },
    });

    return NextResponse.json(
      {
        questions: questions.map((q) => ({
          id: q.id,
          author: q.askerName,
          body: q.body,
          date: q.createdAt.toISOString(),
          helpful: q.helpfulCount,
          answers: q.answers.map((a) => ({
            id: a.id,
            author: a.authorName,
            // Shoppers weigh an official answer differently from another shopper's, so the
            // distinction has to reach the storefront.
            isMerchant: a.authorType === 'merchant',
            body: a.body,
            date: a.createdAt.toISOString(),
          })),
        })),
      },
      { headers: { ...CORS, 'Cache-Control': CACHE } }
    );
  } catch (error) {
    console.error('[storefront/questions]', error);
    return NextResponse.json({ error: 'Failed to load questions' }, { status: 500, headers: CORS });
  }
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const get = (k: string, max: number) => {
      const v = form.get(k);
      return typeof v === 'string' ? v.trim().slice(0, max) : '';
    };

    // Honeypot — see the review submit endpoint for the reasoning.
    if (get('website', 200)) return NextResponse.json({ success: true }, { headers: CORS });

    const shop = get('shop', 255);
    const shopifyProductId = get('product_id', 64);
    const name = get('name', 100);
    const email = get('email', 200);
    const body = get('body', 2000);

    if (!shop) return NextResponse.json({ error: 'Missing store' }, { status: 400, headers: CORS });
    if (!name || body.length < 5) {
      return NextResponse.json(
        { error: 'Please add your name and a question.' },
        { status: 400, headers: CORS }
      );
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: 'That email address looks wrong.' }, { status: 400, headers: CORS });
    }

    const store = await db.store.findUnique({
      where: { shopifyDomain: shop },
      select: { id: true, isActive: true },
    });
    if (!store?.isActive) {
      return NextResponse.json({ error: 'Unknown store' }, { status: 404, headers: CORS });
    }

    const product = shopifyProductId
      ? await db.product.findUnique({
          where: { storeId_shopifyId: { storeId: store.id, shopifyId: shopifyProductId } },
          select: { id: true },
        })
      : null;

    // One pending question per person per product, so a single actor cannot flood the
    // merchant's queue.
    if (email) {
      const dupe = await db.question.findFirst({
        where: { storeId: store.id, askerEmail: email, productId: product?.id ?? null, isPublished: false },
        select: { id: true },
      });
      if (dupe) {
        return NextResponse.json(
          { error: 'You already have a question awaiting an answer for this product.' },
          { status: 409, headers: CORS }
        );
      }
    }

    await db.question.create({
      data: {
        storeId: store.id,
        productId: product?.id ?? null,
        askerName: name,
        askerEmail: email || null,
        body,
        isPublished: false,
      },
    });

    return NextResponse.json(
      { success: true, message: 'Thanks — we will answer your question shortly.' },
      { status: 201, headers: CORS }
    );
  } catch (error) {
    console.error('[storefront/questions POST]', error);
    return NextResponse.json({ error: 'Could not submit your question.' }, { status: 500, headers: CORS });
  }
}
