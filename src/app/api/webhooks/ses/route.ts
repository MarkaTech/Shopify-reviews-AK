import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { suppress } from '@/lib/suppression';

/**
 * Amazon SES bounce and complaint notifications, delivered over SNS.
 *
 * SES reports every bounce and every "mark as spam" to an SNS topic; this is the other end
 * of it. Without this endpoint the app would keep mailing addresses that have already
 * failed, and the bounce ratio would climb until AWS suspends the account — taking every
 * merchant's notifications down together, since they all share one sending domain.
 *
 * Signature verification, and why it is not skipped
 * ------------------------------------------------
 * This endpoint is unauthenticated by necessity: SNS will not carry a bearer token. What
 * it does carry is an RSA-SHA1 signature over a canonical string, verifiable against a
 * certificate AWS publishes.
 *
 * Skipping that check would leave an open endpoint that permanently blocks any email
 * address on request — a denial-of-email attack against any merchant whose address someone
 * knows, and a way to silently stop review invitations reaching a competitor's customers.
 * So: the certificate URL is pinned to AWS hosts, the certificate is fetched over HTTPS,
 * and the signature must verify before a single address is touched.
 */

export const dynamic = 'force-dynamic';

/** SNS certificates are only ever served from these hosts. */
function isTrustedCertUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      /^sns\.[a-z0-9-]+\.amazonaws\.com$/.test(parsed.hostname) &&
      parsed.pathname.endsWith('.pem')
    );
  } catch {
    return false;
  }
}

/**
 * The fields SNS signs, in the order it signs them. Order and membership are part of the
 * specification — an extra or reordered field produces a different string and a failed
 * verification, which is the point.
 */
const SIGNED_FIELDS: Record<string, string[]> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};

function canonicalString(payload: Record<string, unknown>): string | null {
  const fields = SIGNED_FIELDS[String(payload.Type)];
  if (!fields) return null;

  let out = '';
  for (const field of fields) {
    const value = payload[field];
    // Subject is optional; it is omitted from the string entirely when absent rather than
    // included as empty.
    if (value === undefined || value === null) continue;
    out += `${field}\n${String(value)}\n`;
  }
  return out;
}

const certCache = new Map<string, string>();

async function fetchCertificate(url: string): Promise<string | null> {
  const cached = certCache.get(url);
  if (cached) return cached;

  const res = await fetch(url);
  if (!res.ok) return null;
  const pem = await res.text();

  // Bounded, because the URL is attacker-influenced up to the hostname check and an
  // unbounded map keyed on it would be a memory-growth vector.
  if (certCache.size > 20) certCache.clear();
  certCache.set(url, pem);
  return pem;
}

async function verifySnsSignature(payload: Record<string, unknown>): Promise<boolean> {
  const certUrl = String(payload.SigningCertURL || payload.SigningCertUrl || '');
  if (!isTrustedCertUrl(certUrl)) return false;

  const message = canonicalString(payload);
  if (!message) return false;

  const signature = String(payload.Signature || '');
  if (!signature) return false;

  const pem = await fetchCertificate(certUrl);
  if (!pem) return false;

  // SignatureVersion 1 is RSA-SHA1; 2 is RSA-SHA256. Anything else is not something we
  // know how to check, so it is rejected rather than assumed.
  const version = String(payload.SignatureVersion || '1');
  const algorithm = version === '2' ? 'RSA-SHA256' : version === '1' ? 'RSA-SHA1' : null;
  if (!algorithm) return false;

  try {
    const verifier = crypto.createVerify(algorithm);
    verifier.update(message, 'utf8');
    return verifier.verify(pem, signature, 'base64');
  } catch {
    return false;
  }
}

interface SesNotification {
  notificationType?: string;
  eventType?: string;
  bounce?: {
    bounceType?: string;
    bounceSubType?: string;
    bouncedRecipients?: Array<{ emailAddress?: string; diagnosticCode?: string }>;
  };
  complaint?: {
    complaintFeedbackType?: string;
    complainedRecipients?: Array<{ emailAddress?: string }>;
  };
}

export async function POST(request: NextRequest) {
  try {
    // SNS sends text/plain, so request.json() cannot be relied on.
    const raw = await request.text();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Malformed payload' }, { status: 400 });
    }

    if (!(await verifySnsSignature(payload))) {
      console.warn('[ses] rejected a notification with an invalid signature');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    }

    const type = String(payload.Type);

    // Confirming the subscription is what activates the topic. Fetching the URL is the
    // documented mechanism — and it is only reached after the signature verified, so an
    // attacker cannot use this endpoint as a generic URL fetcher.
    if (type === 'SubscriptionConfirmation') {
      const subscribeUrl = String(payload.SubscribeURL || '');
      if (isTrustedCertUrl(subscribeUrl.replace(/\.pem$/, '.pem')) || /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(subscribeUrl)) {
        await fetch(subscribeUrl).catch((err) => console.error('[ses] subscribe failed:', err));
        console.log('[ses] subscription confirmed for', payload.TopicArn);
      }
      return NextResponse.json({ ok: true });
    }

    if (type !== 'Notification') return NextResponse.json({ ok: true });

    let notice: SesNotification;
    try {
      notice = JSON.parse(String(payload.Message));
    } catch {
      return NextResponse.json({ ok: true });
    }

    const kind = notice.notificationType || notice.eventType;

    if (kind === 'Bounce' && notice.bounce) {
      const { bounceType, bounceSubType, bouncedRecipients = [] } = notice.bounce;

      // Permanent bounces only. A Transient bounce is a full mailbox or a temporary server
      // problem — suppressing those would throw away deliverable addresses, and SES does
      // not count them against the ratio the same way.
      if (bounceType === 'Permanent') {
        for (const recipient of bouncedRecipients) {
          if (!recipient.emailAddress) continue;
          await suppress(
            recipient.emailAddress,
            'bounce',
            `${bounceSubType ?? 'Permanent'}: ${recipient.diagnosticCode ?? ''}`
          );
        }
        console.log(`[ses] suppressed ${bouncedRecipients.length} permanently bounced address(es)`);
      }
    }

    if (kind === 'Complaint' && notice.complaint) {
      // Every complaint, no exceptions. Someone pressing "this is spam" is the single most
      // damaging signal a sender can collect, and the threshold is 0.1%.
      for (const recipient of notice.complaint.complainedRecipients ?? []) {
        if (!recipient.emailAddress) continue;
        await suppress(
          recipient.emailAddress,
          'complaint',
          notice.complaint.complaintFeedbackType ?? 'complaint'
        );
      }
      console.log('[ses] suppressed complainant(s)');
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    // 200 on an unexpected error, deliberately. SNS retries a failure for hours and then
    // dead-letters the topic; a bug in our parsing must not cost us the whole feedback
    // channel. The error is logged loudly instead.
    console.error('[ses] handler error:', error);
    return NextResponse.json({ ok: true });
  }
}
