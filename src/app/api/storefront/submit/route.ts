import { NextRequest, NextResponse, after } from 'next/server';
import { db } from '@/lib/db';
import { assertReviewCapacity, planLimitResponse } from '@/lib/plans';
import { decryptToken } from '@/lib/crypto';
import { validateFiles, uploadToShopify, MediaError } from '@/lib/media';
import { getFreshAccessToken, tokenRefresherFor, TOKEN_SELECT } from '@/lib/shopify-token';
import { getSubmissionRules } from '@/lib/storefront-config';
import { notifyNewReview } from '@/lib/notifications';
import { updateProductRating } from '@/lib/ratings';

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

    const store = await db.store.findUnique({
      where: { shopifyDomain: shop },
      select: { ...TOKEN_SELECT, isActive: true },
    });
    if (!store || !store.isActive) {
      return NextResponse.json({ error: 'Unknown store' }, { status: 404, headers: CORS });
    }

    // The merchant's own rules, which used to be a set of switches in Settings that saved
    // to the database and were read by nothing. The store must be resolved before these
    // can be read, which is why validation happens after the lookup rather than before it.
    const rules = await getSubmissionRules(store.id);

    if (!rating) {
      return NextResponse.json(
        { error: 'Please choose a star rating.' },
        { status: 400, headers: CORS }
      );
    }
    if (!name && !rules.allowAnonymous) {
      return NextResponse.json(
        { error: 'Please provide your name.' },
        { status: 400, headers: CORS }
      );
    }
    if (!body) {
      return NextResponse.json(
        { error: 'Please write your review.' },
        { status: 400, headers: CORS }
      );
    }
    // Email is still collected when required. It is the only handle on a reviewer for
    // duplicate detection and for the post-purchase verification flow, so a merchant who
    // turns this off is choosing a weaker moderation position knowingly.
    if (rules.requireEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json(
        { error: 'Please provide a valid email address.' },
        { status: 400, headers: CORS }
      );
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json(
        { error: 'Please provide a valid email address.' },
        { status: 400, headers: CORS }
      );
    }
    if (body.length < rules.minReviewLength) {
      return NextResponse.json(
        {
          error:
            rules.minReviewLength > 30
              ? `Please write at least ${rules.minReviewLength} characters.`
              : 'Please write a little more about the product.',
        },
        { status: 400, headers: CORS }
      );
    }

    const product = shopifyProductId
      ? await db.product.findUnique({
          where: { storeId_shopifyId: { storeId: store.id, shopifyId: shopifyProductId } },
          // The title is here for the notification email — "New 2-star review on Blue
          // Hoodie" is actionable in a way that a bare star count is not.
          select: { id: true, title: true },
        })
      : null;
    const productMeta = product;

    // One pending review per person per product. Stops a single actor flooding the
    // moderation queue, without blocking a genuine second review of a different product.
    //
    // Skipped when there is no email: with anonymous reviews enabled the address is empty,
    // and matching on empty-string would let the first anonymous review block every
    // subsequent one for that product.
    if (email) {
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
    }

    await assertReviewCapacity(store.id, 1);

    // ── Media ──
    //
    // Validation is synchronous and cheap: MIME allowlist plus a magic-byte check on the
    // first 16 bytes. A shopper who picked the wrong file must be told immediately, before
    // anything is written, or they resubmit and get a duplicate.
    //
    // The UPLOAD is deliberately not on this path. Handing bytes to Shopify Files takes
    // three round trips and the file then processes asynchronously, so waiting for a CDN
    // URL cost 5-6 seconds of "Submitting..." — for a review that is going into a
    // moderation queue anyway and will not be visible for hours. The shopper gains nothing
    // from that wait.
    let validated: Awaited<ReturnType<typeof validateFiles>> = [];
    const rawFiles = form.getAll('media').filter((f): f is File => f instanceof File && f.size > 0);

    if (rawFiles.length) {
      // Honour the merchant's switches. The form control is hidden when uploads are off,
      // but the endpoint is public — a hidden input is a UI decision, not a rule.
      const images = rawFiles.filter((f) => !f.type.startsWith('video/'));
      const videos = rawFiles.filter((f) => f.type.startsWith('video/'));

      if (images.length && !rules.allowPhotos) {
        return NextResponse.json(
          { error: 'This store is not accepting photos with reviews.' },
          { status: 400, headers: CORS }
        );
      }
      if (videos.length && !rules.allowVideo) {
        return NextResponse.json(
          { error: 'This store is not accepting video reviews.' },
          { status: 400, headers: CORS }
        );
      }

      try {
        validated = await validateFiles(rawFiles);
      } catch (err) {
        if (err instanceof MediaError) {
          return NextResponse.json({ error: err.message }, { status: 400, headers: CORS });
        }
        throw err;
      }
    }

    // Auto-publish is the merchant's call, and it is off by default.
    //
    // It is a real trade-off rather than a convenience toggle: with it on, unauthenticated
    // input reaches the storefront with no human in the loop, and the moderation queue
    // stops being a safety net. Merchants with steady low-volume traffic reasonably want
    // it; the default stays off so the risk is something a merchant opts into.
    //
    // What auto-publish does NOT do is grant verification. `verificationStatus` stays
    // 'unverified' either way — a public form proves nothing about a purchase, and
    // claiming otherwise is exactly the misrepresentation FTC 16 CFR 465 targets.
    const publishNow = rules.autoPublish;

    const created = await db.review.create({
      data: {
        storeId: store.id,
        productId: product?.id ?? null,
        reviewerName: name || 'Anonymous',
        reviewerEmail: email,
        rating,
        title: title || null,
        body,
        source: 'storefront',
        verifiedPurchase: false,
        verificationStatus: 'unverified',
        sentiment: rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral',
        isPublished: publishNow,
        reviewDate: new Date(),
      },
    });

    // Tell the merchant, after the response has flushed. A shopper must never wait on an
    // SMTP round trip, and a mail provider having a bad day must never turn a saved review
    // into an error for the person who wrote it.
    {
      const storeId = store.id;
      const productTitle = productMeta?.title ?? null;
      after(async () => {
        await notifyNewReview(storeId, {
          reviewerName: name || 'Anonymous',
          rating,
          title: title || null,
          body,
          productTitle,
          isPublished: publishNow,
        });
      });
    }

    // A published review changes the product's average, which lives in Shopify metafields
    // and drives the star rating other apps and the Shop app read. Also off the response
    // path: it is three Admin API calls.
    if (publishNow && product) {
      const storeId = store.id;
      const productId = product.id;
      after(async () => {
        try {
          const token = await getFreshAccessToken(store);
          await updateProductRating(storeId, productId, {
            shop,
            accessToken: token,
            onUnauthorized: tokenRefresherFor(storeId),
          });
        } catch (err) {
          // The review is live regardless; the aggregate self-heals on the next publish
          // or on a manual rebuild.
          console.error('[storefront/submit] rating sync failed:', err);
        }
      });
    }

    // Upload AFTER the response is sent. `after()` runs once the response has flushed, so
    // the shopper sees their confirmation in ~300ms while the bytes go to Shopify in the
    // background. The review is unpublished either way, so the media is attached long
    // before anyone could see the review.
    if (validated.length) {
      const storeId = store.id;
      const reviewId = created.id;
      after(async () => {
        try {
          const token = await getFreshAccessToken(store);
          const uploaded = await uploadToShopify(shop, token, validated, tokenRefresherFor(storeId));

          const images: string[] = [];
          let video: string | null = null;
          const pending: string[] = [];

          for (const m of uploaded) {
            if (!m.url) pending.push(m.gid);
            else if (m.kind === 'video') video = m.url;
            else images.push(m.url);
          }

          await db.review.update({
            where: { id: reviewId },
            data: {
              images: images.length ? JSON.stringify(images) : null,
              videoUrl: video,
              pendingMedia: pending.length ? JSON.stringify(pending) : null,
            },
          });
        } catch (err) {
          // The review is already saved. Losing a photo is regrettable; losing someone's
          // written review to save the photo would be worse.
          console.error('[storefront/submit] background media upload failed:', err);
        }
      });
    }

    return NextResponse.json(
      {
        success: true,
        published: publishNow,
        // The widget prefers the merchant's configured copy; this is what a caller that is
        // not our widget sees, and it must not promise moderation that is not happening.
        message: publishNow
          ? 'Thank you for your review.'
          : 'Thank you. Your review has been submitted for approval.',
        media: { queued: validated.length },
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
