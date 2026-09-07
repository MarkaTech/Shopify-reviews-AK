import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAdminRequest } from '@/lib/admin-auth';
import { maskEmail } from '@/lib/pii';

/**
 * The email suppression list.
 *
 * A wrongly-suppressed address is a merchant whose customer will never be asked for a
 * review again, silently and forever. Soft bounces from a full mailbox and one-off
 * provider blips both land here, so there has to be a way to look and to undo.
 *
 * Addresses are MASKED in the listing.
 *
 * This table is not scoped by store — `EmailSuppression.email` is globally unique — so an
 * unmasked listing was a browsable, searchable directory of shoppers' email addresses
 * belonging to every merchant on the platform, returned to a session authenticated by one
 * shared password. The admin page's own header claims "customer emails are masked"; this
 * endpoint was the exception.
 *
 * Masking does not break the support workflow, because that workflow starts from an address
 * the operator has already been given ("this customer says they stopped getting emails").
 * `?q=` still matches on the full stored address, so looking up a known address works; what
 * is no longer possible is reading addresses out that you did not already have.
 */
/** Replace any email address embedded in free text with its masked form. */
function scrubAddresses(text: string | null): string | null {
  if (!text) return text;
  return text.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, (m) => maskEmail(m));
}

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const q = (request.nextUrl.searchParams.get('q') || '').trim();
  const rows = await db.emailSuppression.findMany({
    where: q ? { email: { contains: q, mode: 'insensitive' } } : undefined,
    // `id` so the operator can still un-suppress a row whose address they cannot see.
    select: { id: true, email: true, reason: true, detail: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  const total = await db.emailSuppression.count();

  // Personal data was read. Level 2 obligations include monitoring staff access to it, and
  // this endpoint reached it across every tenant while logging nothing at all.
  console.info(
    `[admin] suppression list read: ${rows.length} row(s)${q ? ` matching a search term` : ' (unfiltered)'}`
  );

  return NextResponse.json({
    // `detail` is masked as well as `email`. It holds the raw SMTP diagnostic or SES
    // complaint reason, and those routinely quote the recipient back verbatim
    // ("550 5.1.1 <jane@example.com>: Recipient address rejected") — so masking only the
    // email column left the address sitting in plain sight one field to the right.
    suppressions: rows.map((r) => ({
      ...r,
      email: maskEmail(r.email),
      detail: scrubAddresses(r.detail),
    })),
    total,
    showing: rows.length,
  });
}

/** Remove an address from the list so it can be mailed again. */
export async function DELETE(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let email = '';
  let id = '';
  try {
    const body = await request.json();
    email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    id = typeof body?.id === 'string' ? body.id.trim() : '';
  } catch {
    /* handled below */
  }

  // `id` is the path the UI uses, because the listing no longer hands out addresses. `email`
  // still works for an operator acting on an address a merchant gave them.
  if (id) {
    const row = await db.emailSuppression.findUnique({ where: { id }, select: { email: true } });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    email = row.email;
  }

  if (!email) return NextResponse.json({ error: 'email or id required' }, { status: 400 });
  const { unsuppress } = await import('@/lib/suppression');
  await unsuppress(email);
  console.warn(`[admin] ${maskEmail(email)} removed from the suppression list by operator`);
  return NextResponse.json({ ok: true });
}
