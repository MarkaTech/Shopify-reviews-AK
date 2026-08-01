# Security incident response policy

**Owner:** Marka Modern Retail Private Limited
**Last reviewed:** 1 August 2026 · **Review cycle:** annually, and after any Sev-1 or Sev-2 incident

## Scope

Any event that may compromise the confidentiality, integrity or availability of personal data
processed by ReviewMaster, or of the systems holding it. This covers suspected as well as
confirmed events — the policy starts when there is a reason to worry, not when there is proof.

## Severity

| Level | Definition | Examples |
|---|---|---|
| **Sev-1** | Confirmed unauthorised access to, or loss of, personal data | Database exfiltration; credential compromise with evidence of use; ransomware |
| **Sev-2** | Credible risk of the above, unconfirmed | Leaked credential with no evidence of use; exploitable vulnerability in a data path; anomalous bulk queries |
| **Sev-3** | Security-relevant, no personal data at risk | Vulnerable dependency not on a data path; failed intrusion attempt; sub-processor advisory |
| **Sev-4** | Availability only | Outage with no data exposure |

When severity is unclear, treat it as the higher one until evidence says otherwise. It is
cheap to downgrade and expensive to have started late.

## Roles

One person operates this service, which makes the roles a checklist rather than an org chart —
but the roles still have to be discharged, and naming them stops steps being skipped under
pressure.

- **Incident lead** — decides severity, directs the response, owns the timeline. Default: the
  operator.
- **Communications** — merchant and regulator notification. Default: the operator.
- **External counsel** — engaged for any Sev-1, before merchant notification goes out where
  time allows.

## Procedure

### 1. Detect and record (immediately)

Open a dated incident log. From this point, every action gets a timestamp. This log is the
evidence, and reconstructing it afterwards from memory is worth very little.

Record: what was seen, when, by what means, and what is not yet known.

### 2. Contain (within 1 hour of detection)

Priority is stopping the bleeding, not diagnosis.

- Rotate the credential in question — Shopify client secret, database password, AWS keys,
  `CRON_SECRET` — as applicable
- Restrict database firewall rules to the application only
- If the application itself is the vector, stop the Web App. An outage is preferable to
  continuing exfiltration
- Preserve logs before anything expires: Azure diagnostics, application logs, database logs

### 3. Assess (within 24 hours)

- Which categories of personal data, and roughly how many records
- Which merchants are affected
- Whether data was accessed or merely accessible — and say which, because they are not the
  same and conflating them misleads everyone downstream
- Root cause, and whether the vector is still open elsewhere

### 4. Notify

| Who | When | Content |
|---|---|---|
| **Affected merchants** | Within **48 hours** of becoming aware (Sev-1 and Sev-2 with confirmed exposure) | What happened, data categories, approximate numbers, likely consequences, what we have done, what they should do |
| **Shopify** | Sev-1, promptly, via Partner support | As above |
| **Supervisory authority** | The merchant's obligation, as controller. We supply what they need to meet 72 hours | Assessment output |
| **Data subjects** | The merchant's decision, as controller. We assist | — |

Notify with what is known rather than waiting for a complete picture, and follow up. The
merchant's own 72-hour clock runs from *our* notification, which is why ours is 48.

### 5. Recover

Patch, restore service, confirm the vector is closed, and verify no persistence remains.

### 6. Review (within 14 days)

Written post-incident review: timeline, root cause, what worked, what didn't, and concrete
changes with owners and dates. Circulated to anyone who was involved and kept permanently.

The test of this step is whether a specific change was made. "Be more careful" is not a change.

## Contacts

| | |
|---|---|
| Incident lead | tech@houseofmarka.com |
| Shopify Partner support | partners.shopify.com |
| Azure support | Azure portal, subscription support request |
| AWS support | AWS console |

## Preparation

The point of the drills below is that the first time you rotate a production secret should
not be during an incident.

- Credentials are rotatable without a code change; every one lives in Azure application
  settings
- Database firewall rules can be narrowed to the App alone in seconds
- Backups are tested by confirming restore points exist and are current
- Reviewed annually, and after every Sev-1 or Sev-2
