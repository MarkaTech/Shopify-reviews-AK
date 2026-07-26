import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveToken } from '@/lib/review-requests';
import { assertReviewCapacity, planLimitResponse } from '@/lib/plans';

/**
 * Public endpoints — the buyer is a customer of the merchant, not a logged-in user of
 * this app, so there is deliberately no session check. The single-use token IS the
 * authorisation: it was generated from a real fulfilled order and emailed to that order's
 * customer.
 */

const REASONS: Record<string, { status: number; message: string }> = {
  not_found: { status: 404, message: 'This review link is not valid.' },
  expired: { status: 410, message: 'This review link has expired.' },
  already_submitted: { status: 409, message: 'A review has already been submitted using this link.' },
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const state = await resolveToken(token);

    if (!state.ok) {
      const r = REASONS[state.reason];
      return NextResponse.json({ error: r.message, reason: state.reason }, { status: r.status });
    }

    const store = await db.store.findUnique({
      where: { id: state.request.storeId },
      select: { name: true, isActive: true },
    });

    if (!store?.isActive) {
      return NextResponse.json({ error: 'This store is no longer accepting reviews.' }, { status: 410 });
    }

    // Record that the customer opened the link, for the merchant's request analytics.
    if (!state.request.openedAt) {
      await db.reviewRequest.update({
        where: { id: state.request.id },
        data: { openedAt: new Date() },
      });
    }

    return NextResponse.json({
      storeName: store.name,
      customerName: state.request.customerName,
      orderNumber: state.request.orderNumber,
      items: state.lineItems,
    });
  } catch (error) {
    console.error('[review-request GET]', error);
    return NextResponse.json({ error: 'Could not load this review request.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const state = await resolveToken(token);

    if (!state.ok) {
      const r = REASONS[state.reason];
      return NextResponse.json({ error: r.message, reason: state.reason }, { status: r.status });
    }

    const body = (await request.json()) as {
      reviews?: Array<{ productId?: string | null; rating?: number; title?: string; body?: string }>;
    };

    const submitted = (body.reviews || []).filter(r => r && typeof r.rating === 'number' && r.body?.trim());
    if (submitted.length === 0) {
      return NextResponse.json(
        { error: 'Please give a rating and write a short review.' },
        { status: 400 }
      );
    }

    for (const r of submitted) {
      if (!Number.isInteger(r.rating) || r.rating! < 1 || r.rating! > 5) {
        return NextResponse.json({ error: 'Ratings must be between 1 and 5 stars.' }, { status: 400 });
      }
    }

    const storeId = state.request.storeId;
    await assertReviewCapacity(storeId, submitted.length);

    // Only allow reviews against products that were actually in this order.
    const allowedProductIds = new Set(
      state.lineItems.map(li => li.productId).filter((v): v is string => !!v)
    );

    const created = await db.review.createMany({
      data: submitted.map(r => ({
        storeId,
        productId: r.productId && allowedProductIds.has(r.productId) ? r.productId : null,
        reviewerName: state.request.customerName || 'Verified Customer',
        reviewerEmail: state.request.customerEmail,
        rating: r.rating!,
        title: r.title?.trim().slice(0, 200) || null,
        body: r.body!.trim().slice(0, 5000),
        source: 'direct',
        // The whole point of this flow: the order is real, so the badge is earned.
        verifiedPurchase: true,
        sentiment: r.rating! >= 4 ? 'positive' : r.rating! <= 2 ? 'negative' : 'neutral',
        // Merchants moderate before anything appears on the storefront.
        isPublished: false,
        reviewDate: new Date(),
      })),
    });

    // Single-use: consume the token so the link cannot be replayed.
    await db.reviewRequest.update({
      where: { id: state.request.id },
      data: { submittedAt: new Date() },
    });

    await db.analyticsEvent.create({
      data: {
        storeId,
        eventType: 'review_submitted',
        eventData: JSON.stringify({
          via: 'review_request',
          orderNumber: state.request.orderNumber,
          count: created.count,
        }),
      },
    }).catch(() => {});

    return NextResponse.json({ success: true, submitted: created.count }, { status: 201 });
  } catch (error) {
    const limit = planLimitResponse(error);
    if (limit) {
      // The merchant is over their plan; that is not the customer's problem to solve.
      console.warn('[review-request] store at plan limit, review rejected');
      return NextResponse.json(
        { error: 'This store cannot accept new reviews right now. Please try again later.' },
        { status: 503 }
      );
    }
    console.error('[review-request POST]', error);
    return NextResponse.json({ error: 'Could not submit your review.' }, { status: 500 });
  }
}
