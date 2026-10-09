import { NextRequest, NextResponse, after } from 'next/server';
import { db } from '@/lib/db';
import { resolveToken, isPageDataFetch } from '@/lib/review-requests';
import { assertReviewCapacity, planLimitResponse, getStorePlan, PLANS } from '@/lib/plans';
import { validateFiles, uploadToShopify, MediaError, type ValidatedFile } from '@/lib/media';
import { getFreshAccessToken, tokenRefresherFor, TOKEN_SELECT } from '@/lib/shopify-token';
import { getSubmissionRules, getRatingLook } from '@/lib/storefront-config';
import { describeActiveIncentive } from '@/lib/incentives';
import { notifyNewReview } from '@/lib/notifications';
import { syncReviewToShop, isSyndicationEnabled } from '@/lib/syndication';

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

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
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
    // The store's star shape and colour, so this page matches the widget on its storefront.
    const look = await getRatingLook(state.request.storeId);

    // Two more things the page may show, both plan-gated exactly as the widget's are.
    //
    // The incentive offer and its disclosure, shown before the buyer writes. The widget
    // did this; this page returned nothing, so the buyers arriving from the invitation —
    // the ones rewardPublishedReview actually pays on this path — were never told a
    // reward existed and the thank-you code arrived unannounced. Gated on the plan as
    // grantIncentive is, so a downgraded store never advertises a reward it will not pay.
    //
    // The "Verified by Marka" mark. It is truthful here (every review from this page is
    // tied to the order the token was issued for), but a white-label plan pays for a page
    // with nothing of ours on it, and the invitation that linked here already honoured
    // that — the page then showed the mark anyway.
    const plan = await getStorePlan(state.request.storeId);
    const offer = PLANS[plan].incentives ? await describeActiveIncentive(state.request.storeId) : null;

    // Record that the customer opened the link, for the merchant's request analytics —
    // but only for the page's own fetch. Mail gateways and link scanners GET this URL at
    // delivery time, and an unconditional stamp counted every one of them as an open.
    if (!state.request.openedAt && isPageDataFetch(request.headers)) {
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
      starStyle: look.starStyle,
      starColor: look.starColor,
      offer,
      showBadge: !PLANS[plan].whiteLabel,
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

    // Only allow reviews against products that were actually in this order.
    const allowedProductIds = new Set(
      state.lineItems.map(li => li.productId).filter((v): v is string => !!v)
    );

    // Bounded to the order. `reviews[]` is caller-supplied; it used to be written out one
    // Review per element with no ceiling and no per-product dedupe, so a single valid
    // single-use link could mint any number of `verified_buyer` reviews — the strongest
    // trust signal the app has, for an order of one item. One review per purchased
    // product, nothing for products not on the order, body length capped like every other
    // ingest path.
    const seenProducts = new Set<string>();
    const submitted = submittedRaw
      .filter(r => r && typeof r.rating === 'number' && typeof r.body === 'string' && r.body.trim())
      .filter(r => {
        const pid = r.productId ?? '';
        if (pid && !allowedProductIds.has(pid)) return false;
        if (seenProducts.has(pid)) return false;
        seenProducts.add(pid);
        return true;
      })
      .slice(0, Math.max(1, state.lineItems.length))
      .map(r => ({ ...r, body: r.body!.slice(0, 5000), title: r.title?.slice(0, 200) }));
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

    // ── Tell the merchant, after the response has flushed ──
    //
    // Only the storefront widget did this. The reviews arriving here are the ones the
    // negative-review alert exists for — a verified buyer's one-star, with a reply window
    // measured in hours — and the merchant heard nothing, while an anonymous storefront
    // submission of the same rating sent the alert. Same call as the widget's, one notice
    // per review since each is its own product. notifyNewReview never throws, and a mail
    // provider having a bad day must never turn a saved review into an error for the buyer.
    {
      const reviewerName = state.request.customerName || 'Verified Customer';
      const notices = submitted.map((r) => ({
        reviewerName,
        rating: r.rating!,
        title: r.title?.trim().slice(0, 200) || null,
        body: r.body!.trim().slice(0, 5000),
        productTitle:
          r.productId && allowedProductIds.has(r.productId)
            ? state.lineItems.find((li) => li.productId === r.productId)?.title ?? null
            : null,
        isPublished: rules.autoPublish,
      }));
      after(async () => {
        for (const notice of notices) await notifyNewReview(storeId, notice);
      });
    }

    // ── Aggregates and reward, for reviews that went live immediately ──
    //
    // Both were missing here. This route had neither an import of @/lib/ratings nor any
    // call to updateProductRating, so with auto-publish on the widget listed the new review
    // while the header average and the `reviews.rating` metafield stayed at their old
    // values — visible to shoppers, to Google, and to the Shop app, and only corrected by
    // the next moderation action or a manual rebuild. Shopify's syndication rules require
    // the displayed aggregate to track reality.
    //
    // The reward had the same root cause as the storefront path: the grant hangs off a
    // false->true publish transition, and a row born published never has one.
    //
    // Declared here, RUN below in one sequential after() with the media upload and the
    // Shop syndication. See "One chain" further down for why the order matters.
    let settlePublished: (() => Promise<void>) | null = null;
    if (rules.autoPublish && store.shopifyDomain) {
      const shop = store.shopifyDomain;
      const publishedProductIds = [
        ...new Set(
          submitted
            .filter((r) => r.productId && allowedProductIds.has(r.productId))
            .map((r) => r.productId!)
        ),
      ];
      // ONE reward per order, not one per line item.
      //
      // An order with twelve reviewable products produced twelve reviews, and rewarding each
      // of them minted twelve real Shopify discount codes and sent twelve emails to the same
      // buyer. The unique on IncentiveGrant.reviewId does not prevent that — it is scoped to
      // a review, and these are twelve distinct reviews. `usageLimit` does not either: it is
      // nullable and unset by default, and it counts grants across the whole incentive
      // rather than per customer.
      //
      // The richest review wins, so the buyer gets the tier they actually earned: a video
      // review anywhere in the order beats a photo review, which beats text.
      const mediaKindFor = (key: string) => {
        const files = validatedByKey.get(key) ?? [];
        return {
          hasVideo: files.some((f) => f.kind === 'video'),
          hasPhoto: files.some((f) => f.kind === 'image'),
        };
      };
      const rewardTarget = [...createdIds]
        .sort((a, b) => {
          const A = mediaKindFor(a.key);
          const B = mediaKindFor(b.key);
          return (
            Number(B.hasVideo) - Number(A.hasVideo) || Number(B.hasPhoto) - Number(A.hasPhoto)
          );
        })[0];
      const rewardMedia = rewardTarget ? mediaKindFor(rewardTarget.key) : null;
      const customerEmail = state.request.customerEmail;
      const customerName = state.request.customerName;

      settlePublished = async () => {
        try {
          const token = await getFreshAccessToken(store);
          const ctx = { shop, accessToken: token, onUnauthorized: tokenRefresherFor(storeId) };

          const { updateProductRating } = await import('@/lib/ratings');
          for (const productId of publishedProductIds) {
            await updateProductRating(storeId, productId, ctx);
          }

          // Media flags come from the VALIDATED UPLOADS, not from the review row.
          //
          // The row cannot be trusted here: the media upload runs in a separate after()
          // block further down, so at this moment `images` and `videoUrl` are still null on
          // every row. Reading them meant the photo and video tiers never applied, and an
          // incentive with `requiresMedia` never granted at all — it bailed out on a review
          // whose photos were, at that instant, still in flight.
          if (rewardTarget && rewardMedia) {
            const { rewardPublishedReview } = await import('@/lib/incentives');
            await rewardPublishedReview(
              storeId,
              shop,
              token,
              {
                id: rewardTarget.id,
                reviewerEmail: customerEmail,
                reviewerName: customerName,
                images: rewardMedia.hasPhoto || null,
                videoUrl: rewardMedia.hasVideo || null,
              },
              ctx.onUnauthorized
            );
          }
        } catch (err) {
          // The reviews are saved and live either way. Aggregates self-heal on the next
          // publish or a manual rebuild; a missing code is recoverable by the merchant.
          console.error('[review-request] post-publish aggregate/reward step failed:', err);
        }
      };
    }

    // ── Shop app syndication, for reviews that went live immediately ──
    //
    // syncReviewToShop was only called from the merchant's PUT handler, and a review born
    // published never gets one — so with syndication on, nothing from this route reached
    // Shop. The program's rule is "syndicate everything"; isSyndicationEnabled is the
    // plan gate, so on a store not paying for Shop sync this resolves to nothing.
    //
    // Runs last in the chain below, after the media upload and the incentive grant, so the
    // push carries the photos and refuses a review that turned out to be incentivised.
    const syndicate = async () => {
      const shop = store.shopifyDomain;
      if (!rules.autoPublish || !shop) return;
      try {
        if (!(await isSyndicationEnabled(storeId))) return;
        const accessToken = await getFreshAccessToken(store);
        const ctx = { shop, accessToken, onUnauthorized: tokenRefresherFor(storeId) };
        for (const { id } of createdIds) await syncReviewToShop(storeId, id, ctx);
      } catch (err) {
        // Best effort: the reviews are live on the storefront regardless, and the
        // merchant's next edit re-syncs.
        console.error('[review-request] Shop syndication failed:', err);
      }
    };

    // ── Media upload, off the response path ──
    //
    // Same reasoning as the storefront widget: handing bytes to Shopify Files is three
    // round trips plus async processing, and the review is going into a moderation queue
    // anyway. The buyer sees their thank-you in ~300ms; the photos attach in the
    // background long before the merchant looks at the queue — which matters, because the
    // photo/video incentive tier is decided from `images`/`videoUrl` at approval time.
    const uploadMedia = async () => {
      const shop = store.shopifyDomain;
      if (!validatedByKey.size || !shop) return;
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
              // Kept so the files can be deleted later — on review delete or erasure.
              mediaGids: JSON.stringify(uploaded.map((m) => m.gid)),
            },
          });
        }
      } catch (err) {
        // The review is already saved. Losing a photo is regrettable; losing someone's
        // written review to save the photo would be worse.
        console.error('[review-request] background media upload failed:', err);
      }
    };

    // ── One chain: media, then aggregates and reward, then Shop ──
    //
    // These were three after() callbacks, and Next runs after() callbacks concurrently.
    // Syndication therefore read the row before the incentive grant had stamped
    // `isIncentivized` — the grant is two Shopify round trips away — and pushed a review the
    // buyer was rewarded for to the Shop app as an ordinary one. The syndication module's
    // hard rule is that incentivised reviews never go to Shop, and an upsert cannot be
    // taken back by a later refusal. Run in order, each step sees what the one before it
    // wrote: syndication gets the photos and the incentive flag.
    if (store.shopifyDomain && (validatedByKey.size || rules.autoPublish)) {
      after(async () => {
        await uploadMedia();
        if (settlePublished) await settlePublished();
        await syndicate();
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
