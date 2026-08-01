# Data retention policy

**Owner:** Marka Modern Retail Private Limited
**Applies to:** all personal data processed by ReviewMaster
**Last reviewed:** 1 August 2026 · **Review cycle:** annually, or on any change to what the App collects

The enforcing code is `src/lib/retention.ts`, run nightly by `.github/workflows/retention.yml`
against `POST /api/cron/retention`. This document explains the reasoning; the code is the
policy. If the two ever disagree, the code is what actually happened and this file is wrong.

## Principle

Personal data is kept for as long as it is doing work, and no longer. "Doing work" is a
higher bar than "might be handy" — the test applied below is whether removing the data would
break a promise made to a merchant or a shopper.

Two mechanisms, because deletion is not always the safest option:

- **Redaction** — the record still has a job, the personal data in it does not.
- **Deletion** — the record has no remaining job.

## Schedule

| Data | Period | Action | Why |
|---|---|---|---|
| Review invitation — customer name and email | 30 days after the invitation link expires | Redact | The link is dead; the details only remain useful for a merchant asking why a customer did or didn't get an invitation, and a month covers that |
| Review invitation — the record | 24 months after expiry | Delete | The record's last job is preventing a repeat invitation for the same order. A re-delivered `orders/fulfilled` webhook two years later is not a real scenario |
| Storefront analytics — IP address, user agent | 30 days | Redact | Kept only to investigate abuse, which surfaces within days. Counts survive, so merchant analytics don't develop a hole |
| Storefront analytics — the event | 180 days | Delete | Beyond two quarters the individual event tells nobody anything |
| OAuth nonces | On expiry | Delete | CSRF residue, not personal data. Hygiene |

### Why review invitations are redacted, not deleted

The obvious reading of data minimisation is to delete the whole record. It would be worse
for the customer. The record carries the unique key that stops a second invitation for the
same order; delete it and a re-delivered webhook emails them again. Redaction honours the
minimisation duty and keeps the promise. The address is overwritten with
`redacted@retention.invalid` — a domain reserved by RFC 2606 that can never resolve — so any
future code path that tries to mail a redacted record fails loudly rather than reaching
whoever now holds that address.

## Deliberately retained

**Reviews, including the reviewer's email.** Reviews are the merchant's content and the
shopper's published words; they are kept while the App is installed and erased on
`shop/redact` or `customers/redact`. The email is retained alongside because it is what makes
a "verified purchase" badge auditable. A verification claim that cannot be checked is an FTC
misrepresentation risk, which is a worse outcome than holding one address.

**The email suppression list.** Permanent, on purpose, and the one place where deleting
personal data would harm the person it appears to protect: erasing a suppression means
emailing again someone who asked never to be contacted. Held as controller under legitimate
interest — honouring an objection, and protecting the sending reputation every merchant on
the platform shares. It stores the address and the reason, nothing else.

## Backups

Automated and encrypted, retained 35 days, expiring on their own schedule. Backups are never
restored into a non-production environment, and a deletion request is not satisfied by
rewriting history in a backup — the data simply ages out and does not return to service.

## Erasure on request

Handled automatically. Shopify's `customers/redact` erases that customer's reviews,
questions, review requests, incentive grants and analytics events. `shop/redact` erases the
store's data in full 48 hours after uninstall. Neither depends on this scheduled job.
