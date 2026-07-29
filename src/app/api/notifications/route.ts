import { NextRequest, NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import {
  getNotificationSettings,
  saveNotificationSettings,
  DEFAULT_NOTIFICATIONS,
  notifyNewReview,
} from '@/lib/notifications';
import { emailProvider } from '@/lib/email';
import { db } from '@/lib/db';

/**
 * Merchant notification preferences.
 *
 * `provider` and `fallbackEmail` travel with the settings because the Notifications screen
 * is otherwise a set of switches that quietly do nothing: with no mail provider configured
 * on the server, every toggle is decorative, and the merchant deserves to be told that
 * rather than discover it by not receiving an email.
 */
export async function GET(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const [settings, store] = await Promise.all([
      getNotificationSettings(storeId),
      db.store.findUnique({ where: { id: storeId }, select: { email: true } }),
    ]);
    return NextResponse.json({
      settings,
      defaults: DEFAULT_NOTIFICATIONS,
      provider: emailProvider(),
      fallbackEmail: store?.email ?? null,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[notifications GET]', error);
    return NextResponse.json({ error: 'Failed to load notification settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);
    const body = (await request.json()) as { updates?: Record<string, string> };
    if (!body.updates || typeof body.updates !== 'object') {
      return NextResponse.json({ error: 'updates object is required' }, { status: 400 });
    }

    const result = await saveNotificationSettings(storeId, body.updates);
    const settings = await getNotificationSettings(storeId);
    return NextResponse.json({ success: true, ...result, settings });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[notifications PUT]', error);
    return NextResponse.json({ error: 'Failed to save notification settings' }, { status: 500 });
  }
}

/**
 * Send a sample notification to the configured address.
 *
 * A "Send test" button is the difference between a merchant trusting these switches and a
 * merchant assuming they are as inert as they used to be. It goes through the real
 * notification path — same template, same recipient resolution — so a success here means
 * the real thing will arrive too.
 */
export async function POST(request: NextRequest) {
  try {
    const { storeId } = await withAuth(request);

    if (!emailProvider()) {
      return NextResponse.json(
        { error: 'No email provider is configured on the server yet.' },
        { status: 400 }
      );
    }

    const settings = await getNotificationSettings(storeId);
    const store = await db.store.findUnique({ where: { id: storeId }, select: { email: true } });
    const to = settings.email || store?.email;
    if (!to) {
      return NextResponse.json(
        { error: 'No recipient. Add a notification email address first.' },
        { status: 400 }
      );
    }

    // Rating 1 so it takes the negative-alert path, which is the one merchants most need
    // to see working. Temporarily forced on for this single send.
    const result = await notifyNewReview(storeId, {
      reviewerName: 'Test Reviewer',
      rating: settings.negativeReview ? 1 : 5,
      title: 'This is a test notification',
      body: 'If you can read this, review notifications are working. No real review was created.',
      productTitle: 'Sample product',
      isPublished: false,
    });

    if (!result.sent) {
      const reason =
        result.reason === 'disabled'
          ? 'Turn on at least one notification type, then save, then test.'
          : result.reason === 'no_recipient'
          ? 'No recipient address is set.'
          : 'The mail provider rejected the message.';
      return NextResponse.json({ error: reason }, { status: 400 });
    }

    return NextResponse.json({ success: true, to });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('[notifications POST]', error);
    return NextResponse.json({ error: 'Could not send the test notification' }, { status: 500 });
  }
}
