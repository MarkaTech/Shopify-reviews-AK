import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookHmac } from '@/lib/shopify';
import { db } from '@/lib/db';

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
    const complianceHandler = complianceHandlers[topic];
    if (complianceHandler) {
      await complianceHandler(data, shopDomain);
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

// ── Mandatory GDPR Compliance Webhooks ──
//
// Shopify requires all three of these for every public app. They are configured in the
// Partner Dashboard under App setup > Compliance webhooks (they cannot be registered via
// the webhook API), and must be reachable, HMAC-verified, and return 2xx. Missing or
// failing compliance webhooks are the single most common App Store rejection reason.
//
// URLs to enter in the Partner Dashboard:
//   customers/data_request -> {APP_URL}/api/webhooks/customers-data_request
//   customers/redact       -> {APP_URL}/api/webhooks/customers-redact
//   shop/redact            -> {APP_URL}/api/webhooks/shop-redact

type ComplianceHandler = (data: Record<string, unknown>, shop: string) => Promise<void>;

const complianceHandlers: Record<string, ComplianceHandler> = {
  // A merchant asked what personal data we hold about one of their customers.
  // We have 30 days to supply it to the merchant.
  'customers-data_request': async (data, shop) => {
    const payload = data as {
      customer?: { id?: number; email?: string };
      orders_requested?: number[];
    };
    const email = payload.customer?.email || null;

    const store = await db.store.findUnique({ where: { shopifyDomain: shop } });
    if (!store) {
      console.log(`[GDPR] data_request for unknown store ${shop} — nothing held`);
      return;
    }

    // The only customer personal data this app stores is on reviews.
    const reviews = email
      ? await db.review.findMany({
          where: { storeId: store.id, reviewerEmail: email },
          select: {
            id: true,
            reviewerName: true,
            reviewerEmail: true,
            reviewerLocation: true,
            rating: true,
            title: true,
            body: true,
            reviewDate: true,
          },
        })
      : [];

    // Recorded for the audit trail. Fulfilment is manual within the 30-day window:
    // export this record and send it to the merchant.
    await db.analyticsEvent.create({
      data: {
        storeId: store.id,
        eventType: 'gdpr_data_request',
        eventData: JSON.stringify({
          shop,
          customerId: payload.customer?.id ?? null,
          customerEmail: email,
          reviewCount: reviews.length,
          reviews,
          requestedAt: new Date().toISOString(),
        }),
      },
    });

    console.log(`[GDPR] data_request for ${shop}: ${reviews.length} review(s) held`);
  },

  // A customer asked to be erased. Must delete their personal data.
  'customers-redact': async (data, shop) => {
    const payload = data as { customer?: { id?: number; email?: string } };
    const email = payload.customer?.email;

    const store = await db.store.findUnique({ where: { shopifyDomain: shop } });
    if (!store || !email) return;

    // Anonymise rather than delete: the rating and body are the merchant's business data
    // and legitimately survive, but everything identifying the person must go.
    const { count } = await db.review.updateMany({
      where: { storeId: store.id, reviewerEmail: email },
      data: {
        reviewerName: 'Anonymous',
        reviewerEmail: null,
        reviewerAvatar: null,
        reviewerLocation: null,
        seoTitle: null,
        seoDescription: null,
        customFields: null,
      },
    });

    console.log(`[GDPR] customers-redact for ${shop}: anonymised ${count} review(s)`);
  },

  // Sent 48 hours after uninstall. Erase everything belonging to the shop.
  'shop-redact': async (_data, shop) => {
    const store = await db.store.findUnique({ where: { shopifyDomain: shop } });
    if (!store) {
      console.log(`[GDPR] shop-redact for ${shop} — already erased`);
      return;
    }

    const storeId = store.id;

    // Children first: Review and Product carry FK references to Store.
    await db.review.deleteMany({ where: { storeId } });
    await db.product.deleteMany({ where: { storeId } });
    await db.importJob.deleteMany({ where: { storeId } });
    await db.widgetConfig.deleteMany({ where: { storeId } });
    await db.storeSetting.deleteMany({ where: { storeId } });
    await db.analyticsEvent.deleteMany({ where: { storeId } });
    await db.store.delete({ where: { id: storeId } });

    console.log(`[GDPR] shop-redact complete for ${shop}`);
  },
};

// ── Webhook Topic Handlers ──
type WebhookHandler = (data: Record<string, unknown>, storeId: string, shop: string) => Promise<void>;

const webhookHandlers: Record<string, WebhookHandler> = {
  'app-uninstalled': async (_data, storeId) => {
    // Deactivate store but keep data for potential re-install
    await db.store.update({
      where: { id: storeId },
      data: { isActive: false, accessToken: null },
    });
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

  'app-charges-accepted': async (data, storeId, shop) => {
    const charge = data as {
      recurring_application_charge?: {
        name: string;
        price: number;
        status: string;
      };
    };

    if (charge.recurring_application_charge) {
      const planName = charge.recurring_application_charge.name.toLowerCase();
      let plan = 'free';
      if (planName.includes('starter')) plan = 'starter';
      else if (planName.includes('pro')) plan = 'pro';
      else if (planName.includes('enterprise')) plan = 'enterprise';

      await db.store.update({
        where: { id: storeId },
        data: { plan },
      });

      // Activate the charge. The stored token is encrypted at rest, so decrypt before use.
      const { activateCharge } = await import('@/lib/shopify');
      const { decryptToken } = await import('@/lib/crypto');
      const store = await db.store.findUnique({ where: { id: storeId } });
      const token = decryptToken(store?.accessToken);
      if (token) {
        try {
          const chargeId = String((data as Record<string, unknown>).id);
          await activateCharge(shop, token, chargeId);
        } catch (err) {
          console.error('Failed to activate charge:', err);
        }
      }
    }
  },
};
