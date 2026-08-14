import { NextRequest, NextResponse, after } from 'next/server';
import { db } from '@/lib/db';
import { resolveToken } from '@/lib/review-requests';
import { assertReviewCapacity, planLimitResponse } from '@/lib/plans';
import { validateFiles, uploadToShopify, MediaError, type ValidatedFile } from '@/lib/media';
import { getFreshAccessToken, tokenRefresherFor, TOKEN_SELECT } from '@/lib/shopify-token';
import { getSubmissionRules } from '@/lib/storefront-config';

/**
 * Public endpoints — the buyer is a customer of the merchant, not a logged-in user of
 * this app, so there is deliberately no session check. The single-use token IS the
 * authorisation: it was generated from a real fulfilled order and emailed to that order's
 * customer.
 */

const REASONS: Record<string, { status: number; message: string }> = {
  not_found: { status: 404, message: 'This review link is not valid.' },
  expired: { status: 410, message: 'This review link has expired.' },
  already_submitted: { status: 409, message: 'A review has already been submitted using this link.' },
};

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const state = await resolveToken(token);

    if (!state.ok) {
      const r = REASONS[state.reason];
      return NextResponse.json({ error: r.message, reason: state.reason }, { status: r.status });
    }

    const store = await db.store.findUnique({
      where: { id: state.request.storeId },
      select: { name: true, isActive: true },
    });

    if (!store?.isActive) {
      return NextResponse.json({ error: 'This store is no longer accepting reviews.' }, { status: 410 });
    }

    // The merchant's photo/video switches apply here exactly as on the storefront widget —
    // this flow produces the reviews most worth having media on (verified buyers), but the
    // merchant's "no videos" choice is still theirs.
    const rules = await getSubmissionRules(state.request.storeId);

    // Record that the customer opened the link, for the merchant's request analytics.
    if (!state.request.openedAt) {
      await db.reviewRequest.update({
        where: { id: state.request.id },
        data: { openedAt: new Date() },
      });
    }

    return NextResponse.json({
      storeName: store.name,
      customerName: state.request.customerName,
      orderNumber: state.request.orderNumber,
      items: state.lineItems,
      allowPhotos: rules.allowPhotos,
      allowVideo: rules.allowVideo,
    });
  } catch (error) {
    console.error('[review-request GET]', error);
    return NextResponse.json({ error: 'Could not load this review request.' }, { status: 500 });
  }
}

interface SubmittedReview {
  /** The form's per-item key — productId when known, `item-<n>` otherwise. Media parts are named `media:<key>`. */
  key?: string;
  productId?: string | null;
  rating?: number;
  title?: string;
  body?: string;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const state = await resolveToken(token);

    if (!state.ok) {
      const r = REASONS[state.reason];
      return NextResponse.json({ error: r.message, reason: state.reason }, { status: r.status });
    }

    // ── Parse the submission ──
    //
    // Two encodings are accepted on purpose. The current form always sends multipart
    // (reviews as a JSON field, files as `media:<key>` parts). Plain JSON is kept for one
    // deploy cycle: a buyer who opened the form before this shipped and submits after
    // must not lose their review to an encoding change.
    let submittedRaw: SubmittedReview[] = [];
    const mediaByKey = new Map<string, File[]>();

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const reviewsField = form.get('reviews');
      if (typeof reviewsField === 'string') {
        try {
          submittedRaw = JSON.parse(reviewsField) as SubmittedReview[];
        } catch {
          return NextResponse.json({ error: 'Could not read your review.' }, { status: 400 });
        }
      }
      for (const [name, value] of form.entries()) {
        if (!name.startsWith('media:') || !(value instanceof File) || value.size === 0) continue;
        const key = name.slice('media:'.length);
        const list = mediaByKey.get(key) ?? [];
        list.push(value);
        mediaByKey.set(key, list);
      }
    } else {
      const body = (await request.json()) as { reviews?: SubmittedReview[] };
      submittedRaw = body.reviews || [];
    }

    const submitted = submittedRaw.filter(r => r && typeof r.rating === 'number' && r.body?.trim());
    if (submitted.length === 0) {
      return NextResponse.json(
        { error: 'Please give a rating and write a short review.' },
        { status: 400 }
      );
    }

    for (const r of submitted) {
      if (!Number.isInteger(r.rating) || r.rating! < 1 || r.rating! > 5) {
        return NextResponse.json({ error: 'Ratings must be between 1 and 5 stars.' }, { status: 400 });
      }
    }

    const storeId = state.request.storeId;

    // The store row is needed up front now: media uploads land in the merchant's own
    // Shopify Files, which takes their shop domain and a fresh access token.
    const store = await db.store.findUnique({
      where: { id: storeId },
      select: { ...TOKEN_SELECT, isActive: true },
    });
    if (!store || !store.isActive) {
      return NextResponse.json({ error: 'This store is no longer accepting reviews.' }, { status: 410 });
    }

    await assertReviewCapacity(storeId, submitted.length);

    // Only allow reviews against products that were actually in this order.
    const allowedProductIds = new Set(
      state.lineItems.map(li => li.productId).filter((v): v is string => !!v)
    );

    // ── Media validation ──
    //
    // Same posture as the storefront widget: the hidden/absent form control is a UI
    // decision, the merchant's switches are the rule, and every byte is sniffed before it
    // goes anywhere. Validation is synchronous so a wrong file is rejected before the
    // review is written — the buyer can fix it and resubmit without creating a duplicate.
    // Fetched once and used twice: media validation below, and the auto-publish decision
    // when the reviews are written. Both are the same merchant's rules.
    const rules = await getSubmissionRules(storeId);

    const validatedByKey = new Map<string, ValidatedFile[]>();
    if (mediaByKey.size) {
      const allFiles = [...mediaByKey.values()].flat();
      const images = allFiles.filter(f => !f.type.startsWith('video/'));
      const videos = allFiles.filter(f => f.type.startsWith('video/'));

      if (images.length && !rules.allowPhotos) {
        return NextResponse.json(
          { error: 'This store is not accepting photos with reviews.' },
          { status: 400 }
        );
      }
      if (videos.length && !rules.allowVideo) {
        return NextResponse.json(
          { error: 'This store is not accepting video reviews.' },
          { status: 400 }
        );
      }

      try {
        for (const [key, files] of mediaByKey) {
          validatedByKey.set(key, await validateFiles(files));
        }
        // The per-key loop enforces per-review caps; also cap the whole submission so a
        // multi-item order cannot exceed what one upload batch should carry.
        await validateFiles(allFiles);
      } catch (err) {
        if (err instanceof MediaError) {
          return NextResponse.json({ error: err.message }, { status: 400 });
        }
        throw err;
      }
    }

    // Created one at a time rather than createMany: media has to attach to a specific
    // review, and createMany does not return IDs. An order has a handful of line items at
    // most, so the loop is a few inserts, not a hot path.
    const createdIds: Array<{ key: string; id: string }> = [];
    for (const r of submitted) {
      const productOk = r.productId && allowedProductIds.has(r.productId);
      const review = await db.review.create({
        data: {
          storeId,
          productId: productOk ? r.productId! : null,
          reviewerName: state.request.customerName || 'Verified Customer',
          reviewerEmail: state.request.customerEmail,
          rating: r.rating!,
          title: r.title?.trim().slice(0, 200) || null,
          body: r.body!.trim().slice(0, 5000),
          source: 'direct',
          // The whole point of this flow: the token was issued against a real paid order,
          // so this is the strongest verification tier Shopify recognises. Everything else
          // — CSV, manual entry, imports — is 'unverified' and must never claim otherwise.
          verifiedPurchase: true,
          verificationStatus: 'verified_buyer',
          shopifyOrderId: state.request.shopifyOrderId,
          sentiment: r.rating! >= 4 ? 'positive' : r.rating! <= 2 ? 'negative' : 'neutral',
          // Honours the merchant's auto-publish setting, exactly as the storefront widget
          // does. This used to be a hardcoded false, which meant a merchant who turned
          // auto-publish on got it applied to anonymous public submissions and silently
          // ignored for these — the reviews arriving through a single-use token issued
          // against a real paid order, which are the most trustworthy ones the product
          // produces. The safer path was the one being held.
          isPublished: rules.autoPublish,
          reviewDate: new Date(),
        },
        select: { id: true },
      });
      // The key must match what the form named the media parts. The form sends it
      // explicitly; older JSON submissions have no media, so the fallback never matters.
      createdIds.push({ key: r.key ?? r.productId ?? `item-${submitted.indexOf(r)}`, id: review.id });
    }

    // Single-use: consume the token so the link cannot be replayed.
    await db.reviewRequest.update({
      where: { id: state.request.id },
      data: { submittedAt: new Date() },
    });

    // ── Media upload, off the response path ──
    //
    // Same reasoning as the storefront widget: handing bytes to Shopify Files is three
    // round trips plus async processing, and the review is going into a moderation queue
    // anyway. The buyer sees their thank-you in ~300ms; the photos attach in the
    // background long before the merchant looks at the queue — which matters, because the
    // photo/video incentive tier is decided from `images`/`videoUrl` at approval time.
    if (validatedByKey.size && store.shopifyDomain) {
      const shop = store.shopifyDomain;
      after(async () => {
        try {
          const accessToken = await getFreshAccessToken(store);
          for (const { key, id } of createdIds) {
            const validated = validatedByKey.get(key);
            if (!validated?.length) continue;

            const uploaded = await uploadToShopify(shop, accessToken, validated, tokenRefresherFor(storeId));

            const images: string[] = [];
            let video: string | null = null;
            const pending: string[] = [];
            for (const m of uploaded) {
              if (!m.url) pending.push(m.gid);
              else if (m.kind === 'video') video = m.url;
              else images.push(m.url);
            }

            await db.review.update({
              where: { id },
              data: {
                images: images.length ? JSON.stringify(images) : null,
                videoUrl: video,
                pendingMedia: pending.length ? JSON.stringify(pending) : null,
              },
            });
          }
        } catch (err) {
          // The review is already saved. Losing a photo is regrettable; losing someone's
          // written review to save the photo would be worse.
          console.error('[review-request] background media upload failed:', err);
        }
      });
    }

    await db.analyticsEvent.create({
      data: {
        storeId,
        eventType: 'review_submitted',
        eventData: JSON.stringify({
          via: 'review_request',
          orderNumber: state.request.orderNumber,
          count: createdIds.length,
          mediaQueued: [...validatedByKey.values()].flat().length,
        }),
      },
    }).catch(() => {});

    return NextResponse.json({ success: true, submitted: createdIds.length }, { status: 201 });
  } catch (error) {
    const limit = planLimitResponse(error);
    if (limit) {
      // The merchant is over their plan; that is not the customer's problem to solve.
      console.warn('[review-request] store at plan limit, review rejected');
      return NextResponse.json(
        { error: 'This store cannot accept new reviews right now. Please try again later.' },
        { status: 503 }
      );
    }
    console.error('[review-request POST]', error);
    return NextResponse.json({ error: 'Could not submit your review.' }, { status: 500 });
  }
}
