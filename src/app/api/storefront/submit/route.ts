import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertReviewCapacity, planLimitResponse } from '@/lib/plans';
import { decryptToken } from '@/lib/crypto';
import { validateFiles, uploadToShopify, MediaError } from '@/lib/media';
import { getFreshAccessToken, tokenRefresherFor, TOKEN_SELECT } from '@/lib/shopify-token';

/**
 * Public review submission, from the storefront widget.
 *
 * This is the only unauthenticated *write* endpoint in the app, which makes it the one
 * that has to be hostile-input-proof. Protections, in order of importance:
 *
 *  1. **Nothing is ever published.** Every submission lands isPublished:false and
 *     verificationStatus:'unverified'. Even a fully successful spam run produces a
 *     moderation queue item, never storefront content.
 *  2. **Never claims verification.** Only the tokenised post-purchase flow can set
 *     'verified_buyer', because only it has an order to point at. A form on a public page
 *     proves nothing about a purchase, and claiming otherwise would be an FTC 16 CFR 465
 *     misrepresentation.
 *  3. **Honeypot field.** Bots fill every input they find; humans never see this one.
 *  4. **Per-email, per-product rate limit.** One pending review per person per product.
 *  5. **Plan capacity enforced**, so a spam run cannot silently blow through the
 *     merchant's quota.
 *  6. **Length caps on every field**, applied before anything reaches the database.
 *
 * Deliberately NOT here: any path that sets rating-adjacent state, publishes, or touches
 * aggregates. Aggregates only move when a merchant publishes, which happens in the
 * authenticated route.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function str(form: FormData, key: string, max: number): string {
  const v = form.get(key);
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();

    // Honeypot. The widget renders no field by this name, so anything that fills it is
    // automated. Respond 200 so the bot records a success and does not retry or adapt.
    if (str(form, 'website', 200)) {
      return NextResponse.json({ success: true }, { headers: CORS });
    }

    const shop = str(form, 'shop', 255);
    const shopifyProductId = str(form, 'product_id', 64);
    const name = str(form, 'name', 100);
    const email = str(form, 'email', 200);
    const title = str(form, 'title', 200);
    const body = str(form, 'body', 5000);
    const rating = Math.min(5, Math.max(1, Number(form.get('rating')) || 0));

    if (!shop) {
      return NextResponse.json({ error: 'Missing store' }, { status: 400, headers: CORS });
    }
    if (!name || !body || !rating) {
      return NextResponse.json(
        { error: 'Please provide a rating, your name and your review.' },
        { status: 400, headers: CORS }
      );
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json(
        { error: 'Please provide a valid email address.' },
        { status: 400, headers: CORS }
      );
    }
    if (body.length < 5) {
      return NextResponse.json(
        { error: 'Please write a little more about the product.' },
        { status: 400, headers: CORS }
      );
    }

    const store = await db.store.findUnique({
      where: { shopifyDomain: shop },
      select: { ...TOKEN_SELECT, isActive: true },
    });
    if (!store || !store.isActive) {
      return NextResponse.json({ error: 'Unknown store' }, { status: 404, headers: CORS });
    }

    const product = shopifyProductId
      ? await db.product.findUnique({
          where: { storeId_shopifyId: { storeId: store.id, shopifyId: shopifyProductId } },
          select: { id: true },
        })
      : null;

    // One pending review per person per product. Stops a single actor flooding the
    // moderation queue, without blocking a genuine second review of a different product.
    const duplicate = await db.review.findFirst({
      where: {
        storeId: store.id,
        reviewerEmail: email,
        productId: product?.id ?? null,
        isPublished: false,
      },
      select: { id: true },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: 'You already have a review awaiting approval for this product.' },
        { status: 409, headers: CORS }
      );
    }

    await assertReviewCapacity(store.id, 1);

    // ── Media ──
    //
    // Validated before a byte leaves this process: MIME allowlist, magic-byte sniffing,
    // size and count caps. Uploaded to Shopify Files under the merchant's own token, so
    // the media sits on their CDN at no storage cost to us.
    //
    // Upload failures do NOT sink the review. A shopper who wrote a thoughtful review and
    // attached a photo that Shopify choked on should still have their words saved — losing
    // the review to save the photo is the wrong trade. The text is kept and the media is
    // reported as failed.
    let imageUrls: string[] = [];
    let videoUrl: string | null = null;
    let pendingGids: string[] = [];
    let mediaWarning: string | null = null;

    const rawFiles = form.getAll('media').filter((f): f is File => f instanceof File && f.size > 0);

    if (rawFiles.length) {
      try {
        const validated = await validateFiles(rawFiles);
        const token = await getFreshAccessToken(store);
        const uploaded = await uploadToShopify(
          shop,
          token,
          validated,
          tokenRefresherFor(store.id)
        );

        for (const m of uploaded) {
          if (!m.url) {
            // Still transcoding — keep the GID so the URL can be resolved later rather
            // than making the shopper wait on it.
            pendingGids.push(m.gid);
            continue;
          }
          if (m.kind === 'video') videoUrl = m.url;
          else imageUrls.push(m.url);
        }

        if (pendingGids.length) {
          mediaWarning = 'Your video is still processing and will appear shortly.';
        }
      } catch (err) {
        if (err instanceof MediaError) {
          // A validation problem is the shopper's to fix, so tell them plainly and stop
          // before creating anything — otherwise they resubmit and get a duplicate.
          return NextResponse.json({ error: err.message }, { status: 400, headers: CORS });
        }
        console.error('[storefront/submit] media upload failed:', err);
        mediaWarning = 'Your review was saved, but we could not attach your files.';
      }
    }

    await db.review.create({
      data: {
        storeId: store.id,
        productId: product?.id ?? null,
        reviewerName: name,
        reviewerEmail: email,
        rating,
        title: title || null,
        body,
        source: 'storefront',
        // A public form proves nothing about a purchase.
        verifiedPurchase: false,
        verificationStatus: 'unverified',
        sentiment: rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral',
        // Always moderated. Never publish unauthenticated input to a storefront.
        isPublished: false,
        reviewDate: new Date(),
        images: imageUrls.length ? JSON.stringify(imageUrls) : null,
        videoUrl,
        pendingMedia: pendingGids.length ? JSON.stringify(pendingGids) : null,
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Thank you. Your review has been submitted for approval.',
        warning: mediaWarning,
        media: { images: imageUrls.length, video: videoUrl ? 1 : 0, pending: pendingGids.length },
      },
      { status: 201, headers: CORS }
    );
  } catch (error: unknown) {
    const limit = planLimitResponse(error);
    if (limit) {
      // The merchant being over quota is not the shopper's problem to understand or fix.
      console.warn('[storefront/submit] store at plan limit');
      return NextResponse.json(
        { error: 'Reviews are temporarily closed for this store.' },
        { status: 503, headers: CORS }
      );
    }
    console.error('[storefront/submit]', error);
    return NextResponse.json({ error: 'Could not submit your review.' }, { status: 500, headers: CORS });
  }
}
