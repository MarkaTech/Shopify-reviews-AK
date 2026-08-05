import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withAuth, unauthorizedResponse } from '@/lib/auth';

/**
 * Setup progress for the first-run checklist.
 *
 * Every step is DERIVED from real state rather than from a "step completed" flag a
 * merchant could tick without doing anything. That matters more than it sounds: a
 * checklist that congratulates you for work you have not done is worse than no
 * checklist, because the one screen that is supposed to tell you whether the app is
 * live starts lying. If a merchant deletes their only incentive, that step un-ticks.
 *
 * The single piece of stored state is dismissal — the merchant's decision to stop
 * seeing it, which nothing else can infer.
 */

const DISMISS_KEY = 'onboarding.dismissedAt';

export async function GET(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);

    const [products, reviews, published, incentive, widget, dismissed, requests] =
      await Promise.all([
        db.product.count({ where: { storeId } }),
        db.review.count({ where: { storeId } }),
        db.review.count({ where: { storeId, isPublished: true } }),
        db.incentive.findFirst({ where: { storeId, isActive: true }, select: { id: true } }),
        db.widgetConfig.findFirst({ where: { storeId }, select: { id: true } }),
        db.storeSetting.findUnique({
          where: { storeId_key: { storeId, key: DISMISS_KEY } },
          select: { value: true },
        }),
        db.reviewRequest.count({ where: { storeId } }),
      ]);

    const steps = [
      {
        id: 'products',
        done: products > 0,
        // Product sync runs automatically at install, so this is a health signal as
        // much as a task — if it is not done, something went wrong rather than
        // something being left undone.
        auto: true,
      },
      { id: 'reviews', done: reviews > 0, auto: false },
      { id: 'widget', done: !!widget, auto: false },
      { id: 'requests', done: requests > 0, auto: false },
      { id: 'publish', done: published > 0, auto: false },
      { id: 'incentive', done: !!incentive, auto: false, optional: true },
    ];

    const required = steps.filter((s) => !s.optional);
    const completed = required.filter((s) => s.done).length;

    return NextResponse.json({
      steps,
      completed,
      total: required.length,
      complete: completed === required.length,
      dismissedAt: dismissed?.value ?? null,
      counts: { products, reviews, published, requests },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return unauthorizedResponse();
    }
    console.error('[onboarding]', error);
    return NextResponse.json({ error: 'Could not load setup progress' }, { status: 500 });
  }
}

/** Dismiss (or restore) the checklist. */
export async function POST(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const body = (await request.json().catch(() => ({}))) as { dismissed?: boolean };

    if (body.dismissed === false) {
      await db.storeSetting
        .delete({ where: { storeId_key: { storeId, key: DISMISS_KEY } } })
        .catch(() => undefined);
      return NextResponse.json({ dismissedAt: null });
    }

    const now = new Date().toISOString();
    await db.storeSetting.upsert({
      where: { storeId_key: { storeId, key: DISMISS_KEY } },
      create: { storeId, key: DISMISS_KEY, value: now },
      update: { value: now },
    });
    return NextResponse.json({ dismissedAt: now });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return unauthorizedResponse();
    }
    console.error('[onboarding POST]', error);
    return NextResponse.json({ error: 'Could not save' }, { status: 500 });
  }
}
