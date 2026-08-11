import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookHmac } from '@/lib/shopify';
import { clearWebhookRegistration } from '@/lib/webhook-health';
import { db } from '@/lib/db';
import { recomputeProductRating } from '@/lib/ratings';
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

/**
 * Re-attach reviews and questions that were detached when this product was deleted.
 *
 * The counterpart to the stamping in `products-delete`. A merchant who deletes a listing
 * and re-creates it — a rework, a re-import, an accidental delete undone in Shopify —
 * gets their reviews back automatically, because the Shopify product id is the same even
 * though our row is new.
 *
 * `productId: null` in the filter is deliberate: only rows still orphaned are claimed. A
 * review that has since been attached to something else is left where it is.
 *
 * The aggregate has to be recomputed afterwards, or the product returns with its reviews
 * visible and a star rating of zero — which looks more like a bug than the detachment did.
 */
async function relinkDetached(storeId: string, shopifyId: string, productId: string): Promise<void> {
  const [reviews] = await Promise.all([
    db.review.updateMany({
      where: { storeId, productId: null, detachedProductShopifyId: shopifyId },
      data: { productId, detachedProductShopifyId: null },
    }),
    db.question.updateMany({
      where: { storeId, productId: null, detachedProductShopifyId: shopifyId },
      data: { productId, detachedProductShopifyId: null },
    }),
  ]);

  if (reviews.count > 0) {
    console.log(`[webhook] re-attached ${reviews.count} review(s) to restored product ${shopifyId}`);
    await recomputeProductRating(storeId, productId);
  }
}

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

    // upsert, not create.
    //
    // Shopify delivers webhooks AT LEAST once, so a duplicate delivery is ordinary
    // traffic rather than an error. `create` hit the (storeId, shopifyId) unique
    // constraint, threw P2002 and returned 500 — at which point Shopify retries the same
    // failure and eventually DELETES the subscription. The store then never hears about
    // a new product again, and every review collected for one saves with productId: null,
    // invisible on the product page it belongs to.
    //
    // The failure compounds: webhook-health.ts only re-registers when its marker is
    // absent, and the marker is present, so nothing repairs it. One duplicate delivery
    // permanently breaks product tracking for that store, silently.
    //
    // products-update in this same file already upserts. The asymmetry was the bug.
    const fields = {
      title: product.title,
      handle: product.handle,
      description: product.body_html || null,
      image: product.image?.src || null,
      price: product.variants?.[0]?.price ? parseFloat(product.variants[0].price) : null,
      vendor: product.vendor || null,
      productType: product.product_type || null,
      tags: product.tags || null,
    };

    const row = await db.product.upsert({
      where: { storeId_shopifyId: { storeId, shopifyId: String(product.id) } },
      create: { storeId, shopifyId: String(product.id), ...fields },
      update: fields,
      select: { id: true },
    });

    await relinkDetached(storeId, String(product.id), row.id);
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
      select: { id: true },
    }).then((row) => relinkDetached(storeId, String(product.id), row.id));
  },

  'products-delete': async (data, storeId) => {
    const product = data as { id: number };
    const shopifyId = String(product.id);

    // Stamp the Shopify id onto the reviews and questions about to lose their link,
    // BEFORE the row goes.
    //
    // `productId` is the only association a review has, and the schema sets it to null
    // when the product is deleted (see the note there for why not Cascade). That left
    // the reviews in the database, attached to nothing, counted nowhere, and
    // unrecoverable — the id that would have identified them died with the row. A
    // merchant reworking a listing, or an importer re-creating one, lost every review on
    // it permanently and was told nothing.
    //
    // Recording the id here costs one indexed update and makes the loss reversible:
    // `relinkDetached` below puts them back the moment the product reappears.
    const existing = await db.product.findUnique({
      where: { storeId_shopifyId: { storeId, shopifyId } },
      select: { id: true },
    });
    if (!existing) return;

    await Promise.all([
      db.review.updateMany({
        where: { storeId, productId: existing.id },
        data: { detachedProductShopifyId: shopifyId },
      }),
      db.question.updateMany({
        where: { storeId, productId: existing.id },
        data: { detachedProductShopifyId: shopifyId },
      }),
    ]);

    await db.product.delete({ where: { id: existing.id } });
  },

  // The order has been fulfilled — create the review request. NOTE: nothing is emailed
  // here any more. The request is scheduled (store-configurable delay, default 14 days)
  // and the cron sweep sends it, because "immediately on fulfilment" means before the
  // parcel arrives, and an inline send that failed was lost forever. See
  // src/lib/request-sender.ts for the whole argument.
  'orders-fulfilled': async (data, storeId, shop) => {
    const { createRequestForOrder } = await import('@/lib/review-requests');
    const { getRequestSettings } = await import('@/lib/request-settings');

    const settings = await getRequestSettings(storeId);
    // `shop` is passed so a redacted payload can be recovered from the Admin API.
    const created = await createRequestForOrder(storeId, data as never, settings.delayDays, shop);
    if (!created) return; // no email, no tracked products, or already requested

    console.log(
      `[review-request] scheduled for ${created.email} in ${settings.delayDays} day(s)`
    );
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
