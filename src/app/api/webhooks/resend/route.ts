import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { suppress } from '@/lib/suppression';

/**
 * Resend bounce and complaint events — the counterpart of /api/webhooks/ses.
 *
 * Without this, a switch to Resend silently disables the suppression pipeline: the
 * sending function keeps checking a list that nothing feeds, and the app re-mails
 * hard-bounced addresses forever — the exact failure the list exists to prevent.
 *
 * Resend signs webhooks with Svix. The signature is an HMAC-SHA256 over
 * "<id>.<timestamp>.<body>" with the base64 secret (after its whsec_ prefix), delivered
 * as space-separated "v1,<base64>" candidates. Verified before anything is touched, with
 * a timestamp window against replays — an unauthenticated endpoint that blocks arbitrary
 * addresses on request would be a denial-of-email attack surface.
 *
 * Unlike SNS (self-authenticating against Amazon's published certificate), Svix needs a
 * shared secret. When it is unset the endpoint refuses outright rather than accepting
 * unverified events.
 */

export const dynamic = 'force-dynamic';

const TOLERANCE_SEC = 300;

function verifySvix(secret: string, id: string, timestamp: string, signatures: string, body: string): boolean {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SEC) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();

  for (const candidate of signatures.split(' ')) {
    const [version, sig] = candidate.split(',');
    if (version !== 'v1' || !sig) continue;
    let provided: Buffer;
    try {
      provided = Buffer.from(sig, 'base64');
    } catch {
      continue;
    }
    if (provided.length === expected.length && crypto.timingSafeEqual(provided, expected)) return true;
  }
  return false;
}

interface ResendEvent {
  type?: string;
  data?: {
    to?: string | string[];
    bounce?: { type?: string; subType?: string };
  };
}

export async function POST(request: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error('[resend] RESEND_WEBHOOK_SECRET is not set; refusing to process events');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }

  const body = await request.text();
  const id = request.headers.get('svix-id') || '';
  const timestamp = request.headers.get('svix-timestamp') || '';
  const signatures = request.headers.get('svix-signature') || '';

  if (!id || !timestamp || !signatures || !verifySvix(secret, id, timestamp, signatures, body)) {
    console.warn('[resend] rejected an event with an invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
  }

  const recipients = Array.isArray(event.data?.to) ? event.data.to : event.data?.to ? [event.data.to] : [];

  if (event.type === 'email.bounced') {
    // Resend does not always classify transience; when it does, honour it. An
    // unclassified bounce is treated as permanent — the conservative direction for a
    // shared sending domain.
    const bounceType = event.data?.bounce?.type?.toLowerCase() ?? '';
    if (bounceType !== 'transient' && bounceType !== 'soft') {
      for (const to of recipients) {
        await suppress(to, 'bounce', `resend: ${bounceType || 'unclassified'} ${event.data?.bounce?.subType ?? ''}`.trim());
      }
      console.log(`[resend] suppressed ${recipients.length} bounced address(es)`);
    }
  } else if (event.type === 'email.complained') {
    for (const to of recipients) {
      await suppress(to, 'complaint', 'resend: complaint');
    }
    console.log('[resend] suppressed complainant(s)');
  }

  // Everything else (delivered, opened, clicked) is acknowledged and ignored.
  return NextResponse.json({ ok: true });
}
