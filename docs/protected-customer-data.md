# Protected customer data — request pack

Everything Shopify's *Data protection details* form asks, the answer to give, and where the
evidence is if we are selected for a data protection review.

**Where:** Partner Dashboard → Apps → ReviewMaster → **API access requests** → *Protected
customer data access*. Not the Dev Dashboard — listing, distribution and API access stayed in
the Partner Dashboard when monitoring and configuration moved.

## Step 1 — data use and reasons (done)

| Item | Reason selected |
|---|---|
| Protected customer data | App functionality |
| Name | App functionality |
| Email | App functionality |
| Phone | **not requested** |
| Address | **not requested** |

Approval turns on data minimisation: Shopify grants "the minimum amount required by your app
to provide the merchant with the app functionality". Two fields, one reason, and no marketing
claim is the strongest position available.

Why not the others: *Marketing or advertising* would reclassify a transactional invitation as
marketing, raising the review bar and contradicting the AWS SES production access request.
*Analytics* describes measuring app performance using customer data, which we do not — the
dashboard measures reviews. *Customer service* means answering customers on the merchant's
behalf. *Personalization* means recommendations.

## Step 2 — data protection details (16 questions)

### Purpose

| Question | Answer | Evidence |
|---|---|---|
| Minimum personal data required? | **Yes** | Name and email only; phone and address never requested and redacted by Shopify. `/dpa` §2 |
| Tell merchants what you process and why? | **Yes** | `/privacy` §2–3 lists each scope and its purpose; `/dpa` §2 |
| Limit use to that purpose? | **Yes** | `/dpa` §3, §12. No model training, no secondary use |

### Consent

| Question | Answer | Evidence |
|---|---|---|
| Privacy and data protection agreements with merchants? | **Yes** | `/dpa`, incorporated into `/terms` §10, effective on install |
| Respect customers' consent decisions? | **Yes** | One-click unsubscribe (`List-Unsubscribe-Post`), HMAC-authenticated opt-out link, global suppression list checked before every send |
| Respect opt-out of data being sold? | **Not applicable** | No sale or sharing ever occurs. `/dpa` §12 certifies this |
| Automated decision-making with legal effects? | **Not applicable** | No automated decisions are made about individuals |

### Storage

| Question | Answer | Evidence |
|---|---|---|
| Retention periods? | **Yes** | `src/lib/retention.ts`, enforced nightly; `docs/data-retention.md` |
| Encrypt at rest and in transit? | **Yes** | HTTPS everywhere; Postgres `require_secure_transport`; Azure storage encryption; Shopify access token encrypted at the application layer |
| Encrypt backups? | **Yes** | Azure Flexible Server backups encrypted by default, 35-day retention |
| Separate test and production data? | **Yes** | `docs/environments.md`; separate `reviewmaster_dev` database; production dumps prohibited |
| Data loss prevention strategy? | **Yes** | `docs/data-loss-prevention.md` |

### Access

| Question | Answer | Evidence |
|---|---|---|
| Limit staff access? | **Yes** | Single operator; production credentials only in Azure application settings; database firewalled |
| Strong staff passwords? | **Yes** | Strong passwords and MFA on Shopify Partner, Azure and AWS accounts |
| Log access to personal data? | **Yes** | Azure diagnostic settings on the Postgres server; application logs record authentication events |
| Security incident response policy? | **Yes** | `docs/incident-response.md` |

### Audits and certifications

Leave blank. There are none, and inventing one is the worst possible entry on this form.

## Prerequisites before answering Yes

Five of these were **No** before this work. Each needs its change actually in place, not just
documented:

1. Retention — deploy `/api/cron/retention` and enable the nightly workflow ✅ code ready
2. Environments — create `reviewmaster_dev`, repoint local `.env`
3. DLP — `docs/data-loss-prevention.md` ✅ written
4. Incident response — `docs/incident-response.md` ✅ written
5. Access logging — enable Azure diagnostic settings on the Postgres server
6. DPA — `/dpa` and `/subprocessors` live, linked from `/terms` ✅ written

Confirm MFA is genuinely enabled on all three accounts before answering the password question.

## Ongoing

These are continuing obligations, not a one-time gate. Come back to this form when a
sub-processor is added, retention changes, or a new category of personal data is introduced —
and update `/subprocessors` 30 days before, not after.
