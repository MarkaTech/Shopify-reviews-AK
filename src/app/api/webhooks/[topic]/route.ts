import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookHmac } from '@/lib/shopify';
import { clearWebhookRegistration } from '@/lib/webhook-health';
import { db } from '@/lib/db';
import { handleComplianceTopic } from '@/lib/compliance';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ topic: string }> }
) {
  try {
    const { topic } = await params;
    const hmacHeader = request.headers.get('x-shopify-hmac-sha256') || '';
    const rawBody = await request.text();

    // Verify webhook HMAC
    if (!verifyWebhookHmac(rawBody, hmacHeader)) {
      return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 });
    }

    const data = JSON.parse(rawBody);
    const shopDomain = request.headers.get('x-shopify-shop-domain') || '';

    // GDPR compliance topics run BEFORE the store lookup. Shopify sends shop/redact 48
    // hours after uninstall, by which point the store row may already be gone, and it
    // requires a 2xx regardless — bailing out early on "unknown store" would leave these
    // permanently failing in the Partner Dashboard.
    // Compliance topics are handled before the store lookup: shop/redact arrives after
    // the store may already be gone. Shared with /api/webhooks/compliance.
    if (await handleComplianceTopic(topic, data, shopDomain)) {
      return NextResponse.json({ received: true });
    }

    // Find the store by shopify domain
    const store = await db.store.findUnique({
      where: { shopifyDomain: shopDomain },
    });

    if (!store) {
      console.error(`Webhook received for unknown store: ${shopDomain}`);
      return NextResponse.json({ received: true });
    }

    // Route to topic-specific handler
    const handler = webhookHandlers[topic];
    if (handler) {
      await handler(data, store.id, shopDomain);
    } else {
      console.log(`No handler for webhook topic: ${topic}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

// ── Webhook Topic Handlers ──
type WebhookHandler = (data: Record<string, unknown>, storeId: string, shop: string) => Promise<void>;

const webhookHandlers: Record<string, WebhookHandler> = {
  'app-uninstalled': async (_data, storeId) => {
    // Deactivate store but keep data for potential re-install
    await db.store.update({
      where: { id: storeId },
      // Drop every credential on uninstall. Leaving the refresh token behind would keep a
      // 90-day renewable grant on file for a store that has revoked us.
      data: {
        isActive: false,
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        refreshTokenExpiresAt: null,
      },
    });

    // Shopify drops the webhook subscriptions along with the installation, so our record
    // that registration succeeded is now false. Clearing it means a reinstall registers
    // again instead of trusting a marker left by the previous install.
    await clearWebhookRegistration(storeId);

    console.log(`Store ${storeId} uninstalled the app`);
  },

  'products-create': async (data, storeId) => {
    const product = data as {
      id: number;
      title: string;
      handle: string;
      body_html?: string;
      image?: { src: string } | null;
      variants?: Array<{ price: string }>;
      vendor?: string;
      product_type?: string;
      tags?: string;
    };

    await db.product.create({
      data: {
        storeId,
        shopifyId: String(product.id),
        title: product.title,
        handle: product.handle,
        description: product.body_html || null,
        image: product.image?.src || null,
        price: product.variants?.[0]?.price ? parseFloat(product.variants[0].price) : null,
        vendor: product.vendor || null,
        productType: product.product_type || null,
        tags: product.tags || null,
      },
    });
  },

  'products-update': async (data, storeId) => {
    const product = data as {
      id: number;
      title: string;
      handle: string;
      body_html?: string;
      image?: { src: string } | null;
      variants?: Array<{ price: string }>;
      vendor?: string;
      product_type?: string;
      tags?: string;
    };

    await db.product.upsert({
      where: {
        storeId_shopifyId: { storeId, shopifyId: String(product.id) },
      },
      update: {
        title: product.title,
        handle: product.handle,
        description: product.body_html || null,
        image: product.image?.src || null,
        price: product.variants?.[0]?.price ? parseFloat(product.variants[0].price) : null,
        vendor: product.vendor || null,
        productType: product.product_type || null,
        tags: product.tags || null,
      },
      create: {
        storeId,
        shopifyId: String(product.id),
        title: product.title,
        handle: product.handle,
        description: product.body_html || null,
        image: product.image?.src || null,
        price: product.variants?.[0]?.price ? parseFloat(product.variants[0].price) : null,
        vendor: product.vendor || null,
        productType: product.product_type || null,
        tags: product.tags || null,
      },
    });
  },

  'products-delete': async (data, storeId) => {
    const product = data as { id: number };
    await db.product.deleteMany({
      where: { storeId, shopifyId: String(product.id) },
    });
  },

  // The buyer has received their order — create the review request that will be emailed
  // to them. This is the entry point of the whole first-party collection flow.
  'orders-fulfilled': async (data, storeId) => {
    const { createRequestForOrder, reviewRequestUrl } = await import('@/lib/review-requests');
    const { SHOPIFY_APP_URL } = await import('@/lib/shopify');

    const created = await createRequestForOrder(storeId, data as never);
    if (!created) return; // no email, no tracked products, or already requested

    const link = reviewRequestUrl(created.token, SHOPIFY_APP_URL);

    const { sendEmail, renderReviewRequestEmail } = await import('@/lib/email');
    const store = await db.store.findUnique({ where: { id: storeId }, select: { name: true, email: true } });

    // One-click unsubscribe. The token is an HMAC of the address, so the link cannot be
    // edited to opt somebody else out — without that, the header would be a way to block
    // any address an attacker can guess.
    const { unsubscribeToken } = await import('@/app/api/unsubscribe/route');
    const unsubscribeUrl =
      `${SHOPIFY_APP_URL}/api/unsubscribe` +
      `?email=${encodeURIComponent(created.email)}` +
      `&t=${encodeURIComponent(unsubscribeToken(created.email))}`;

    const message = renderReviewRequestEmail({
      storeName: store?.name || 'the store',
      customerName: (data as { customer?: { first_name?: string } }).customer?.first_name || null,
      orderNumber: (data as { order_number?: string | number }).order_number?.toString() || null,
      itemTitles: created.lineItems.map(li => li.title),
      reviewUrl: link,
      unsubscribeUrl,
    });

    // Replies go to the merchant, not to us — they own the customer relationship.
    const result = await sendEmail({ ...message, to: created.email, replyTo: store?.email || undefined });

    if (result.sent) {
      await db.reviewRequest.update({
        where: { token: created.token },
        data: { sentAt: new Date() },
      });
      console.log(`[review-request] sent to ${created.email} via ${result.provider}`);
    } else if (result.reason === 'not_configured') {
      // No provider set up yet. The request and its link still exist and still work.
      console.log(`[review-request] no email provider configured; link for ${created.email}: ${link}`);
    } else {
      // Never rethrow: a failed email must not fail the webhook, or Shopify retries it
      // and the merchant's dashboard shows a failing subscription.
      console.error(`[review-request] send failed for ${created.email}: ${result.detail}`);
    }
  },

  'orders-paid': async (data, storeId) => {
    // Log analytics event for potential review request
    const order = data as {
      id: number;
      order_number: number;
      customer?: { email?: string; first_name?: string; last_name?: string };
      total_price: string;
    };

    await db.analyticsEvent.create({
      data: {
        storeId,
        eventType: 'order_paid',
        eventData: JSON.stringify({
          orderId: order.id,
          orderNumber: order.order_number,
          customerEmail: order.customer?.email,
          total: order.total_price,
        }),
      },
    });
  },

  'shop-update': async (data, storeId) => {
    const shop = data as { name?: string; domain?: string; email?: string };
    await db.store.update({
      where: { id: storeId },
      data: {
        name: shop.name || undefined,
        domain: shop.domain || undefined,
        email: shop.email || undefined,
      },
    });
  },

  /**
   * Subscription state changed: approved, declined, cancelled, expired or frozen.
   *
   * Replaces the old 'app-charges-accepted' handler, which listened for a REST topic that
   * does not exist in GraphQL — every paid upgrade webhook was being dropped.
   *
   * The payload's status is NOT trusted for entitlement. It tells us something changed;
   * we then ask Shopify what is actually active. That closes the window where a cancelled
   * or declined subscription leaves a merchant on a paid tier, and it means a downgrade is
   * handled by exactly the same code path as an upgrade.
   */
  'app_subscriptions-update': async (data, storeId, shop) => {
    const payload = data as { app_subscription?: { name?: string; status?: string } };
    const reported = payload.app_subscription?.status ?? 'unknown';

    const { resolveActivePlan } = await import('@/lib/shopify');
    const { getFreshAccessTokenByStoreId, tokenRefresherFor } = await import('@/lib/shopify-token');

    try {
      // No session here — the token is loaded, decrypted, and refreshed if the 60-minute
      // expiring token lapsed since the merchant last opened the app. A webhook arriving
      // hours after the last page load is precisely the case a non-refreshing
      // implementation gets wrong.
      const token = await getFreshAccessTokenByStoreId(storeId);
      const plan = await resolveActivePlan(shop, token, tokenRefresherFor(storeId));

      await db.store.update({ where: { id: storeId }, data: { plan } });
      console.info(`[billing] ${shop} -> ${plan} (subscription status: ${reported})`);
    } catch (err) {
      console.error(`[billing] failed to resolve plan for ${shop}:`, err);
    }
  },
};
