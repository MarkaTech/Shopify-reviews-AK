# Data loss prevention strategy

**Owner:** Marka Modern Retail Private Limited
**Last reviewed:** 1 August 2026 · **Review cycle:** annually, and on any change to hosting or sub-processors

Data loss prevention is usually sold as a product. At this size it is a set of rules about
where personal data is allowed to exist, enforced mostly by architecture rather than by
tooling — because a control that depends on someone remembering is not a control.

## 1. Where personal data is allowed to be

Exactly one place: the production PostgreSQL database on Azure, plus its encrypted backups.

It is **not** permitted:

- on a laptop, in a spreadsheet, or in a local database copy
- in source control, in a `.env` file, or in a fixture
- in a screenshot, a support ticket, a chat message or an issue tracker
- in any analytics, logging or monitoring service outside the App
- in a prompt to any AI service

A production dump onto a developer machine is the single most likely way this data escapes,
so it is prohibited outright rather than discouraged. Development uses a separate database
with synthetic data (`docs/environments.md`).

## 2. Reducing the amount there is to lose

The strongest control is not holding the data:

- Only **name** and **email** are requested from Shopify. Phone and address are not, and
  Shopify redacts them from every response we receive — they cannot leak because they never
  arrive.
- Review photos and video go into the **merchant's own Shopify Files**, not our storage. A
  compromise of our infrastructure does not expose them.
- Retention runs nightly, so the volume of live personal data stays roughly flat instead of
  growing with age.

## 3. Preventing bulk extraction

- **No bulk export endpoint.** Nothing in the App returns "all customers" or "all email
  addresses". Every read is scoped to one store, and ownership is asserted server-side.
- **Tenant isolation is enforced in queries**, not in the UI. A merchant cannot reach another
  merchant's data by changing an identifier, because the identifier is checked against their
  store before use.
- **Database access is firewalled** to known addresses. There is no public route to port 5432.
- **The database admin credential is not in source control** and is held only in Azure
  application settings.
- **The Shopify access token is encrypted at the application layer**, so a database
  disclosure alone does not yield the ability to call merchant stores and pull more data.

## 4. Egress paths, and what constrains each

| Path | Control |
|---|---|
| Application API | Store-scoped queries; session-token authentication verified per request |
| Email (SES) | Sends only to the address on the order being processed; suppression list checked before every send |
| Webhooks out | None. The App does not push data to third-party endpoints |
| Logs | Application logs record identifiers and outcomes, not message bodies or customer records |
| Backups | Encrypted, platform-managed, never restored outside production |
| Sub-processors | Two, both listed publicly, both bound by equivalent terms |

## 5. Logging and detection

Database connection and query logging is enabled through Azure diagnostic settings, retained
for 30 days. Application logs record authentication events, webhook verification failures,
suppression writes and retention runs.

What is watched for: authentication failures in bursts, webhook signature failures, and
database connections from an address that is not the App.

## 6. Prohibited practices

- Copying production data anywhere, for any reason, including debugging
- Sharing database credentials, or reusing them anywhere else
- Adding a third-party script to a page that renders customer data
- Sending personal data to an AI service, including for feature development
- Granting a person access "temporarily" without removing it afterwards

## 7. Review

This document is reviewed annually and whenever hosting changes, a sub-processor is added, or
a new category of personal data is introduced. Any of those three is a trigger to re-read
section 1 and ask whether it is still true.
