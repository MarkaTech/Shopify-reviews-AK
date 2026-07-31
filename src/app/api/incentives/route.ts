import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { assertFeature, planLimitResponse } from '@/lib/plans';

/**
 * Review incentives — merchant CRUD.
 *
 * What is deliberately absent
 * ---------------------------
 * There is no minimum-rating field anywhere in this endpoint, because there is none in the
 * model. FTC 16 CFR 465.4 prohibits conditioning compensation on the sentiment of a review,
 * expressly or by implication, at up to roughly $53,000 per instance — and the EU Omnibus
 * Directive and the UK DMCC Act 2024 say the same. "Leave a 5-star review, get 10% off" is
 * the textbook violation.
 *
 * So the illegal idea is not validated against; it is simply not expressible. A `minRating`
 * column with a comment saying "do not set this above 1" would eventually get set.
 *
 * `requiresMedia` is lawful and is offered, because a photo is a content type rather than
 * an opinion: a one-star review with a photo earns exactly what a five-star one earns.
 *
 * Only one incentive is ever active at a time. grantIncentive() picks the newest active
 * row, so two active incentives would mean the older one silently never fires — a
 * confusing state to leave a merchant in.
 */

const REWARD_TYPES = new Set(['percentage', 'fixed_amount', 'free_shipping']);

export async function GET(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);

    const incentives = await db.incentive.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { grants: true } } },
    });

    // Redemption stats, so a merchant can see whether this is working before deciding to
    // keep paying for the plan that unlocks it.
    const grants = await db.incentiveGrant.findMany({
      where: { incentive: { storeId } },
      select: { redeemedAt: true, expiresAt: true },
    });

    const now = new Date();
    return NextResponse.json({
      incentives,
      stats: {
        issued: grants.length,
        redeemed: grants.filter((g) => g.redeemedAt).length,
        expired: grants.filter((g) => !g.redeemedAt && g.expiresAt < now).length,
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[incentives GET]', error);
    return NextResponse.json({ error: 'Failed to load incentives' }, { status: 500 });
  }
}

interface IncentiveInput {
  name?: unknown;
  rewardType?: unknown;
  rewardValue?: unknown;
  requiresMedia?: unknown;
  disclosureText?: unknown;
  expiryDays?: unknown;
  usageLimit?: unknown;
  isActive?: unknown;
}

/** The exact set of columns a merchant may write. Typed, so Prisma can check the call. */
interface NormalisedIncentive {
  name: string;
  rewardType: string;
  rewardValue: number;
  requiresMedia: boolean;
  disclosureText: string;
  expiryDays: number;
  usageLimit: number | null;
  isActive: boolean;
}

/** Validate and normalise, or return the reason it was rejected. */
function normalise(body: IncentiveInput): { data: NormalisedIncentive } | { error: string } {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
  if (!name) return { error: 'Give the incentive a name.' };

  const rewardType = typeof body.rewardType === 'string' ? body.rewardType : 'percentage';
  if (!REWARD_TYPES.has(rewardType)) return { error: 'Unknown reward type.' };

  let rewardValue = Number(body.rewardValue);
  if (rewardType === 'free_shipping') {
    rewardValue = 0;
  } else if (!Number.isFinite(rewardValue) || rewardValue <= 0) {
    return { error: 'Set a reward amount above zero.' };
  } else if (rewardType === 'percentage' && rewardValue > 100) {
    return { error: 'A percentage discount cannot exceed 100%.' };
  }

  const disclosureText =
    typeof body.disclosureText === 'string' && body.disclosureText.trim()
      ? body.disclosureText.trim().slice(0, 300)
      : 'This reviewer received a discount in exchange for an honest review.';

  const expiryDays = Math.min(365, Math.max(1, Math.round(Number(body.expiryDays) || 30)));

  const rawLimit = Number(body.usageLimit);
  const usageLimit =
    body.usageLimit === null || body.usageLimit === '' || !Number.isFinite(rawLimit) || rawLimit <= 0
      ? null
      : Math.min(1_000_000, Math.round(rawLimit));

  return {
    data: {
      name,
      rewardType,
      rewardValue,
      requiresMedia: body.requiresMedia === true,
      disclosureText,
      expiryDays,
      usageLimit,
      isActive: body.isActive === true,
    },
  };
}

/**
 * Only one active incentive per store.
 *
 * Enforced by deactivating the others rather than by rejecting the request: a merchant who
 * just switched on a new offer means it, and making them go and turn the old one off first
 * is friction for no safety gain.
 */
async function deactivateOthers(storeId: string, keepId: string): Promise<void> {
  await db.incentive.updateMany({
    where: { storeId, isActive: true, NOT: { id: keepId } },
    data: { isActive: false },
  });
}

export async function POST(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    await assertFeature(storeId, 'incentives');

    const result = normalise((await request.json()) as IncentiveInput);
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });

    const incentive = await db.incentive.create({ data: { storeId, ...result.data } });
    if (incentive.isActive) await deactivateOthers(storeId, incentive.id);

    return NextResponse.json(incentive, { status: 201 });
  } catch (error: unknown) {
    const limit = planLimitResponse(error);
    if (limit) return NextResponse.json(limit.body, { status: limit.status });
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[incentives POST]', error);
    return NextResponse.json({ error: 'Failed to create the incentive' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const body = (await request.json()) as IncentiveInput & { id?: string };
    if (!body.id) return NextResponse.json({ error: 'Incentive ID required' }, { status: 400 });

    // Scoped to the store, so an id from another merchant simply is not found.
    const existing = await db.incentive.findFirst({ where: { id: body.id, storeId } });
    if (!existing) return NextResponse.json({ error: 'Incentive not found' }, { status: 404 });

    // Activating requires the plan; editing a already-active one does not, so a merchant
    // who downgrades can still turn theirs off.
    if (body.isActive === true && !existing.isActive) {
      await assertFeature(storeId, 'incentives');
    }

    const result = normalise({ ...existing, ...body });
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });

    const updated = await db.incentive.update({ where: { id: existing.id }, data: result.data });
    if (updated.isActive) await deactivateOthers(storeId, updated.id);

    return NextResponse.json(updated);
  } catch (error: unknown) {
    const limit = planLimitResponse(error);
    if (limit) return NextResponse.json(limit.body, { status: limit.status });
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[incentives PUT]', error);
    return NextResponse.json({ error: 'Failed to update the incentive' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const { id } = (await request.json()) as { id?: string };
    if (!id) return NextResponse.json({ error: 'Incentive ID required' }, { status: 400 });

    const existing = await db.incentive.findFirst({ where: { id, storeId } });
    if (!existing) return NextResponse.json({ error: 'Incentive not found' }, { status: 404 });

    // Grants cascade with the incentive. The discount codes themselves live in Shopify and
    // stay valid until they expire — deleting our record must not silently invalidate a
    // code a customer is holding.
    await db.incentive.delete({ where: { id: existing.id } });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[incentives DELETE]', error);
    return NextResponse.json({ error: 'Failed to delete the incentive' }, { status: 500 });
  }
}
