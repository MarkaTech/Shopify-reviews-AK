/**
 * What a return from Shopify's approval screen means, judged against what the merchant
 * went there to do.
 *
 * The Plan page writes `{ from, to }` under PENDING_PLAN_KEY just before it hands the
 * merchant to Shopify. Without it, the shell took any paid plan coming back from
 * /api/billing/confirm as a purchase: a store on Growth that opened Scale's approval
 * screen and declined came back still on Growth, confirm said `activated` (Growth is not
 * Free), and the Plan page announced "You just unlocked these" over features it already
 * had. The same was true of an approved move DOWN from Scale to Growth.
 *
 * Pure and client-safe — no storage, no fetch, no database — so the app shell can use it
 * and tests/billing.test.ts can hold it to the cases. src/lib/plans.ts cannot be imported
 * from the browser (it reads the database), hence the small copies of rank and label here.
 */

/** The plan change in flight at Shopify, as the Plan page recorded it. */
export interface PendingPlanChange {
  from?: string;
  to?: string;
  /** Set by the shell, never stored: the return looked like a decline but may not be one. */
  unsure?: boolean;
}

/** Plan order. Mirrors PLAN_ORDER in src/lib/plans.ts. */
const PLAN_RANK: Record<string, number> = { free: 0, growth: 1, scale: 2 };

/** The plan's name as the merchant sees it. Mirrors PLANS[...].label in src/lib/plans.ts. */
const PLAN_LABEL: Record<string, string> = { free: 'Free', growth: 'Growth', scale: 'Scale' };

export function planName(planId: string): string {
  return PLAN_LABEL[planId] ?? planId;
}

/**
 * Read what the Plan page stored. Null for nothing stored, or anything that is not the
 * shape it writes — sessionStorage is the page's own, but a value from an older build
 * should be ignored rather than trusted.
 */
export function parsePendingPlan(raw: string | null | undefined): PendingPlanChange | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const { from, to } = value as Record<string, unknown>;
  const change: PendingPlanChange = {};
  if (typeof from === 'string' && from) change.from = from;
  if (typeof to === 'string' && to) change.to = to;
  return change.from || change.to ? change : null;
}

/**
 * - `upgraded`: the merchant is on a higher plan than they left on, or there is nothing to
 *   compare against (no record, or no plan in confirm's answer) — the long-standing
 *   behaviour, which marks the upgrade on the Plan page.
 * - `switched`: the plan changed, to a LOWER one. True, but nothing was unlocked.
 * - `unchanged`: back on the plan they left on, which is what declining looks like when
 *   the starting plan was a paid one.
 */
export type PlanReturnOutcome = 'upgraded' | 'switched' | 'unchanged';

/** Only meaningful when confirm said `activated` — a paid plan is active. */
export function classifyPlanReturn(
  confirmedPlan: string | undefined,
  expected: PendingPlanChange | null
): PlanReturnOutcome {
  if (!confirmedPlan || !expected?.from) return 'upgraded';
  if (confirmedPlan === expected.from) return 'unchanged';
  const now = PLAN_RANK[confirmedPlan];
  const before = PLAN_RANK[expected.from];
  // A plan id this build does not know: keep the old behaviour rather than guess.
  if (now === undefined || before === undefined) return 'upgraded';
  return now > before ? 'upgraded' : 'switched';
}

/**
 * Has the plan the merchant paid for shown up yet? The stop signal for the shell's poll
 * after a payment confirm could not yet classify.
 *
 * "Any paid plan" is only the fallback when nothing was recorded: a store already on
 * Growth buying Scale would otherwise stop at once on its old Growth, announce an upgrade
 * it had not got yet, and never see Scale arrive.
 */
/**
 * Back on the plan they left, having gone to buy a HIGHER one: a decline, or an approval
 * Shopify has not finished swapping in yet. One read cannot tell them apart, so the shell
 * keeps asking for a little while before it says "no change was made" — telling someone
 * who has just paid for Scale that they are still on Growth is the worse mistake.
 */
export function upgradeMayStillLand(confirmedPlan: string | undefined, expected: PendingPlanChange | null): boolean {
  if (!confirmedPlan || !expected?.from || !expected.to || confirmedPlan !== expected.from) return false;
  const from = PLAN_RANK[expected.from];
  const to = PLAN_RANK[expected.to];
  return from !== undefined && to !== undefined && to > from;
}

export function planArrived(plan: string | undefined, expected: PendingPlanChange | null): boolean {
  if (!plan) return false;
  if (expected?.to) return plan === expected.to;
  if (expected?.from) return plan !== expected.from;
  return plan !== 'free';
}
