import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAdminRequest } from '@/lib/admin-auth';

/**
 * The email suppression list.
 *
 * A wrongly-suppressed address is a merchant whose customer will never be asked for a
 * review again, silently and forever. Soft bounces from a full mailbox and one-off
 * provider blips both land here, so there has to be a way to look and to undo.
 */
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const q = (request.nextUrl.searchParams.get('q') || '').trim();
  const rows = await db.emailSuppression.findMany({
    where: q ? { email: { contains: q, mode: 'insensitive' } } : undefined,
    select: { email: true, reason: true, detail: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const total = await db.emailSuppression.count();
  return NextResponse.json({ suppressions: rows, total, showing: rows.length });
}

/** Remove an address from the list so it can be mailed again. */
export async function DELETE(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let email = '';
  try {
    const body = await request.json();
    email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  } catch {
    /* handled below */
  }
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });
  const { unsuppress } = await import('@/lib/suppression');
  await unsuppress(email);
  console.warn(`[admin] ${email} removed from the suppression list by operator`);
  return NextResponse.json({ ok: true });
}
