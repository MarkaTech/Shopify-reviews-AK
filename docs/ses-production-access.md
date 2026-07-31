# AWS SES production access — request pack

Everything needed to get out of the SES sandbox, in the order it has to happen.

**Current state**, confirmed in the console on 31 July 2026:

| | |
|---|---|
| Account | House of Marka (865000064134) |
| Sandbox | Yes — 200 messages / 24h, 1 per second, verified recipients only |
| Domain identity | `aavyro.com` — **Verified** |
| DKIM | **Successful**, signatures enabled, RSA-2048 |
| Account health | Healthy |
| Bounce / Complaint SNS topic | **Not set** — this is the gap |
| SNS topics in the account | **None** |
| `EMAIL_FROM` | **Empty** |

Published while still in the sandbox, review invitations and merchant notifications fail
silently for every merchant but you.

**Region:** `us-east-1` (from `.env.example` → `AWS_SES_REGION`). Production access is granted
**per region** — if you later add `eu-west-1` for EU merchants, that is a separate request.

---

## Step 1 — Sending identity (already done)

`aavyro.com` is verified in `us-east-1` with Easy DKIM signing at RSA-2048. Nothing to do
here — this is usually the slow part and it is already behind you.

**Sending address:** `reviews@aavyro.com`

Set in Azure app settings:

```
EMAIL_FROM = ReviewMaster <reviews@aavyro.com>
```

Nothing sends until this is set — `emailProvider()` returns SES because the AWS keys are
present, but the From address is what SES actually validates against the identity.

### Check SPF and DMARC before you apply

DKIM alone is enough for SES to accept the mail, but Gmail and Yahoo weigh SPF and DMARC
heavily for bulk senders, and reviewers of the production-access request look at them.

**Careful with SPF if `aavyro.com` already sends mail** (Google Workspace, a CRM, invoicing).
A domain may have only ONE SPF TXT record — publishing a second breaks both. Check first:

```
dig +short TXT aavyro.com | grep spf1
```

- Nothing returned → publish a new record:
  `v=spf1 include:amazonses.com ~all`
- Something returned → **edit the existing record**, adding `include:amazonses.com` before
  the closing `~all` or `-all`. Do not add a second record.

DMARC, if `_dmarc.aavyro.com` has no record yet:

```
_dmarc.aavyro.com   TXT   "v=DMARC1; p=none; rua=mailto:dmarc@aavyro.com"
```

`p=none` reports without rejecting, so you can watch for a fortnight before tightening to
`quarantine`. If a DMARC record already exists, leave it alone — SES mail will pass on DKIM
alignment regardless.

### Worth knowing about reputation

You are sending review invitations from the same domain that presumably carries other
`aavyro.com` mail. That is fine at this volume, and it is the fastest path to launch. If
invitation volume grows into the thousands per day, move to a dedicated subdomain
(`mail.aavyro.com`) so a bad week for review invitations cannot follow your business mail.
Not now — just know where the line is.

## Step 2 — Wire up bounce and complaint handling

**Do this before you apply.** The form asks how you handle bounces and complaints, and a
vague answer is the most common reason these requests are rejected. It is also the thing
that keeps the account alive afterwards: SES suspends senders above a **5% bounce rate** or
a **0.1% complaint rate**, and because every merchant shares one sending domain, one bad
week takes down everyone's notifications at once.

The code is already in place — `/api/webhooks/ses` verifies the SNS signature and records
suppressions, and `sendEmail()` refuses to send to a suppressed address. It just needs
connecting:

1. **SNS console → Topics → Create topic** → Standard → name it `reviewmaster-ses-feedback`
2. **Create subscription** on that topic:
   - Protocol: **HTTPS**
   - Endpoint: `https://reviewmaster-app.azurewebsites.net/api/webhooks/ses`
   - Leave "Enable raw message delivery" **off** — the handler expects the SNS envelope,
     which is what carries the signature
3. The endpoint confirms the subscription automatically. Refresh; status should move from
   *Pending confirmation* to *Confirmed* within a few seconds.
4. **SES console → Identities → `aavyro.com` → Notifications → Feedback notifications**
   → Edit. Set **Bounce** and **Complaint** to the SNS topic. Leave Delivery off — it is
   high volume and tells you nothing you need.

   Note the existing **Email feedback forwarding: Enabled** setting on that page is not a
   substitute. It emails a human about bounces; it never reaches the app, so it cannot
   populate the suppression list. Leave it on as a backstop, but the SNS topic is what does
   the work.

Verify it works before applying: SES provides mailbox simulator addresses that cost nothing
and never touch a real inbox.

```
bounce@simulator.amazonses.com      → should create an EmailSuppression row, reason "bounce"
complaint@simulator.amazonses.com   → should create one, reason "complaint"
success@simulator.amazonses.com     → should deliver and create nothing
```

Send to each from Settings → Notifications → **Send a test** (temporarily set the
notification address), then check the `EmailSuppression` table. If rows appear, the loop is
closed and you can say so truthfully on the form.

---

## Step 3 — Submit the request

**SES console → Account dashboard → Request production access.**

### Form answers

| Field | Answer |
|---|---|
| Mail type | **Transactional** |
| Website URL | `https://reviewmaster-app.azurewebsites.net` |
| Use case description | *(below)* |
| Additional contacts | your ops address, if any |
| Preferred contact language | English |

### Use case description — paste this

> ReviewMaster is a product review application for Shopify merchants, distributed through
> the Shopify App Store. Email is used for two transactional purposes only.
>
> **1. Post-purchase review invitations.** When a merchant's order is marked fulfilled,
> Shopify sends us an `orders/fulfilled` webhook and we email that customer once, asking
> them to review what they bought. The recipient is a real customer of that merchant who has
> completed and received a purchase; the address comes from the order itself, via Shopify's
> API, and is never purchased, scraped, guessed or shared between merchants. One message per
> order — there is no follow-up sequence and no reminder.
>
> **2. Merchant account notifications.** Alerts to the merchant's own address about reviews
> awaiting moderation, plus an optional weekly summary. These go only to the account holder
> who installed the app, are off by default, and are configurable per store.
>
> We send no marketing, no newsletters and no promotional campaigns.
>
> **Bounce and complaint handling.** SES bounce and complaint notifications are delivered to
> an SNS topic subscribed to a signed HTTPS endpoint in our application. Signatures are
> verified against the AWS-published certificate before any action is taken. Permanent
> bounces and all complaints are written to a global suppression list, and our sending
> function checks that list before every send, so a suppressed address can never be
> contacted again by any merchant on the platform. Transient bounces are not suppressed.
>
> **Unsubscribe.** Customer-facing invitations carry `List-Unsubscribe` and
> `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, plus a visible opt-out link in the
> message body. The link is authenticated with an HMAC of the recipient address so it cannot
> be altered to opt out a third party. An unsubscribe applies globally and immediately.
>
> **Volume.** We expect fewer than 1,000 messages per day initially, growing with merchant
> installs. Sending is spread across the day by order fulfilment rather than batched.
>
> **Data handling.** Customer email addresses are stored only for the review invitation and
> for duplicate detection, are never displayed publicly, and are erased on receipt of
> Shopify's mandatory `customers/redact` webhook. Our privacy policy is at
> https://reviewmaster-app.azurewebsites.net/privacy

### Then tick the acknowledgement

You will be asked to confirm you only send to recipients who have specifically requested
your mail. That is accurate here — the recipient is a customer who bought from that merchant
and is being asked about that specific order.

---

## What happens next

AWS usually responds within **24 hours**, sometimes 48. Outcomes:

- **Approved** — you get a 50,000/day quota and 14 messages/second to start. Both rise
  automatically as you send cleanly.
- **More information requested** — normal, not a rejection. Reply in the same support case
  with specifics; do not open a new request.
- **Denied** — almost always means the use case read as marketing, or the bounce answer was
  thin. Both are addressed above.

## After approval

- Set up a **CloudWatch alarm** on `Reputation.BounceRate` above 3% and
  `Reputation.ComplaintRate` above 0.05% — well under the limits, so you hear about a
  problem while it is still small.
- Watch the `EmailSuppression` table for the first few weeks. A cluster of bounces usually
  means a merchant imported bad addresses, not that anything is broken.
- Tighten DMARC to `p=quarantine` once the reports look clean.
