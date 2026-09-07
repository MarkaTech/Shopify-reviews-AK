# ReviewMaster — screencast script

Shopify requires a screencast demonstrating onboarding and the features described in the
listing, with clear step-by-step instructions, in English or with English subtitles.

**Target length: 3 to 4 minutes.** Reviewers watch a lot of these. Everything below is
sequenced so that each shot proves a claim the listing makes, in the order a merchant would
actually meet it.

---

## Before recording

- Record at **1280×720 or larger**, browser in **full screen with no bookmarks bar**. Listing
  images may not show browser chrome; the same instinct applies to the video.
- Close every other tab. A visible Gmail tab or another store is a distraction and a
  potential privacy leak.
- **Open the app once and let it load before you start recording.** It can take several
  seconds to paint inside Shopify's iframe on a cold load, and a blank panel is a bad
  opening shot.
- Have ready: the QA store admin, a product page on the storefront, and your inbox.
- Speak or subtitle. Silent video with no captions fails the English requirement.

---

## Shot 1 — What it is (0:00–0:20)

**On screen:** Shopify admin → Apps → ReviewMaster → Home.

> ReviewMaster collects product reviews from your real orders, you moderate them, and they
> appear on your product pages. This store has twenty-seven published reviews.

**Read the product count off your own dashboard** if you want to say one out loud — don't
quote a number from this script. A figure the reviewer can see is wrong on screen costs more
than it adds.

Let the dashboard sit for a beat so the numbers are readable.

---

## Shot 2 — The result first (0:20–0:50)

**On screen:** the storefront, **The Videographer Snowboard**, scrolled to the reviews block.

> This is what a shopper sees. The rating summary, the distribution, and the reviews
> themselves.

Hover the **Verified Purchase** badge.

> This badge only appears when the review came from an order the app matched. Imported
> reviews never get it.

Scroll to the 2-star review with the reply.

> Negative reviews are published like any other. There is no setting anywhere in this app
> that filters by star rating.

**Why this shot is second:** showing the outcome before the mechanics tells the reviewer what
they're about to watch being built.

---

## Shot 3 — Collecting a review from an order (0:50–1:40)

This is the core loop and deserves the most time.

**On screen:** Shopify admin → Orders → open a fulfilled order.

> When an order is fulfilled, the app queues a review invitation. Timing is up to the
> merchant — the default is fourteen days after fulfilment, one reminder, seven days later.

**Cut to:** app → Settings → Notifications → Review request timing.

**Cut to:** your inbox, showing the invitation email.

> The customer gets this. One link, no account needed.

**Cut to:** the review form opened from that link, and submit a short review.

**Cut to:** app → Reviews, showing it arrive.

> It arrives verified, because the app matched it to that order.

---

## Shot 4 — Moderation and replies (1:40–2:05)

**On screen:** app → Reviews, with the two pending reviews visible.

> Reviews can be held for approval or published automatically. Two are waiting here.

Publish one.

> And the merchant can reply publicly. That reply appears under the review on the product
> page.

Open the reply on the 2-star review.

---

## Shot 5 — Widgets (2:05–2:35)

**On screen:** app → Widgets.

> Nine layouts. The preview updates as you change anything.

Change the star colour and the corner radius so the preview visibly moves. Switch to the
mobile view.

> Colours, layout, how many reviews, what each card shows.

Click **Add to my product page**.

> And this puts the block on your product template in one click — no theme code.

**Why the preview matters:** it is the most screenshot-worthy screen in the app and the
easiest way to show polish without narration.

---

## Shot 6 — Importing (2:35–2:55)

**On screen:** app → Import.

> Reviews you already own can be brought in. CSV from another app, typed in by hand, or
> pulled from an AliExpress listing you dropship.

Point at the notice on that screen.

> Amazon and eBay are deliberately not supported — those reviews describe a different
> seller's transaction. Imported reviews are never marked as verified purchases.

**Say this out loud.** A reviewer wondering why the two biggest marketplaces are missing is
better answered before they ask.

---

## Shot 7 — Growth features (2:55–3:30)

Move briskly; three screens, ten seconds each.

**Q&A** — app → Questions, showing a question with the merchant's answer beneath it. Then
cut to the product page showing the same question answered under the Questions & answers
block.

> Shoppers ask questions on the product page. You answer in the app, and the answer
> publishes there.

**Incentives** — app → Incentives.

> A discount for leaving a review — more for a photo, more again for video.

<!-- Do not say the offer is shown to the shopper up front. describeActiveIncentive() has no
     callers, so no storefront surface announces the offer; the code is minted and emailed
     after the review is published. Say what happens, not what a shopper sees beforehand. -->

Pause on the compliance text.

> Every incentivised review carries a disclosure, and there is no minimum-rating condition —
> the discount is issued regardless of what the review says. That is what the FTC rule
> requires.

**Google Shopping** — app → Settings → Integrations.

> And this feed puts your star ratings on Google Shopping. Paste it into Merchant Center
> once.

---

## Shot 8 — Plans (3:30–3:45)

**On screen:** app → Settings → Plan.

> Free, Growth and Scale. Merchants upgrade and downgrade here, through Shopify's own
> billing.

<!-- "and the change takes effect immediately" was cut. Approval returns through Shopify and
     the plan lands when APP_SUBSCRIPTIONS_UPDATE arrives — seconds, usually, but it is not
     synchronous with the click, and the claim is easy for a reviewer to disprove on camera. -->

End on the plan screen. Don't fade to a logo — the last frame should be the product.

---

## What to leave out

- **The operator portal at `/admin`.** Internal, not part of the merchant product, and
  showing it raises questions about data access that the video can't answer.
- **Anything with a real customer's email address visible.** Mask or crop.
- **Loading states.** Cut them. They are honest but they read as slowness.
- **Every setting.** The listing describes what it does; the video shows that it works.

---

## If you only have time for ninety seconds

Shots 2, 3 and 4 in that order. The result, where reviews come from, and what the merchant
does with them. Everything else is elaboration.
