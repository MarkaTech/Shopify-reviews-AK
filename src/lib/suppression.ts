/**
 * The do-not-email list.
 *
 * Why this is not optional
 * ------------------------
 * Amazon SES measures a sender on two ratios: bounces under 5% and complaints under 0.1%.
 * Cross either and the account goes under review, then gets suspended — and because every
 * merchant on this platform sends from the same domain, that is not one merchant's problem,
 * it is everyone's at once. Gmail and Microsoft apply their own thresholds on top.
 *
 * The single fastest way to fail those ratios is to keep mailing an address that has
 * already hard-bounced. So a bounced or complained address is recorded here and never sent
 * to again, by anyone, ever.
 *
 * Checked in sendEmail() rather than at each call site, so a future feature that sends mail
 * cannot forget. That placement is the whole point: this is a floor, not a convention.
 */

import { db } from './db';

export type SuppressionReason = 'bounce' | 'complaint' | 'unsubscribe' | 'manual';

/** Addresses are compared case-insensitively; SMTP local parts are case-sensitive in
 *  theory and nobody treats them that way in practice. */
function normalise(email: string): string {
  return String(email || '').trim().toLowerCase();
}

/**
 * Record an address as un-mailable.
 *
 * Idempotent — SES retries notifications, and a repeated bounce for the same address must
 * not error. The first reason recorded wins, because a complaint following a bounce tells
 * us nothing new and the original cause is the more useful diagnostic.
 */
export async function suppress(
  email: string,
  reason: SuppressionReason,
  detail?: string
): Promise<void> {
  const address = normalise(email);
  if (!address || !address.includes('@')) return;

  await db.emailSuppression.upsert({
    where: { email: address },
    create: { email: address, reason, detail: detail?.slice(0, 500) ?? null },
    update: {},
  });
}

export async function isSuppressed(email: string): Promise<boolean> {
  const address = normalise(email);
  if (!address) return true;
  const hit = await db.emailSuppression.findUnique({
    where: { email: address },
    select: { id: true },
  });
  return hit !== null;
}

/**
 * Remove an address from the list.
 *
 * Exists for the genuine case of a merchant whose own notification address bounced while
 * their mailbox was full. It is deliberately not exposed to shoppers or to any public
 * endpoint: an attacker who could un-suppress addresses could walk our reputation straight
 * back into a suspension.
 */
export async function unsuppress(email: string): Promise<void> {
  await db.emailSuppression.deleteMany({ where: { email: normalise(email) } });
}

/** Counts for the SES health check, so a drift in bounce rate is visible before AWS acts. */
export async function suppressionSummary(): Promise<Record<SuppressionReason | 'total', number>> {
  const rows = await db.emailSuppression.groupBy({
    by: ['reason'],
    _count: { reason: true },
  });

  const out = { bounce: 0, complaint: 0, unsubscribe: 0, manual: 0, total: 0 };
  for (const row of rows) {
    const key = row.reason as SuppressionReason;
    if (key in out) out[key] = row._count.reason;
    out.total += row._count.reason;
  }
  return out;
}
