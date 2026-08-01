# Environment separation

**Last reviewed:** 1 August 2026

Shopify's Level 2 protected customer data requirements include "keep test and production data
separate". This is what that means here, and how it is set up.

## The rule

**Production personal data never leaves production.** Development and testing run against a
separate database containing synthetic data only. There is no scenario in which a production
dump lands on a laptop — not for debugging, not for a one-off query, not temporarily.

The failure this prevents is mundane and common: a developer pulls a copy of production to
reproduce a bug, and now real customers' email addresses are sitting in a folder on a machine
with no encryption policy, no access log and no retention.

## Setup

### 1. Create the development database

Same Flexible Server is acceptable — separation here is about data, not hardware, and a
second server doubles the bill for no additional protection at this scale.

Azure portal → **reviewmaster-db-server** → **Databases** → **Add**

```
Name: reviewmaster_dev
```

### 2. Point local development at it

In your local `.env` only — never in Azure application settings:

```
DATABASE_URL="postgresql://dbadmin:PASSWORD@reviewmaster-db-server.postgres.database.azure.com:5432/reviewmaster_dev?sslmode=require"
```

Then:

```
npx prisma db push
```

### 3. Populate it with synthetic data

There is no seed script yet. Create reviews through the app against a development store, or
write a short script that generates them — the only rule is that the data is invented.

Never `pg_dump` production into it. If you need data that *looks* real, generate it; a
plausible fake address costs nothing and carries no obligations.

### 4. Confirm which database you are pointed at

Before any destructive local command, and it costs two seconds:

```
node -e "console.log(process.env.DATABASE_URL.split('/').pop().split('?')[0])" --env-file=.env
```

If that prints anything other than `reviewmaster_dev`, stop.

## Production

Production `DATABASE_URL` lives only in Azure application settings, is never committed, and
is never copied into a local file. The deployed application is the only client that uses it,
plus the operator's own IP for occasional read-only inspection through a firewall rule that
is removed when no longer needed.

## Staging (recommended, not yet in place)

A second Azure Web App sharing the development database would let releases be exercised
against the real Shopify OAuth flow without touching merchant data. Worth doing before the
first merchants install; not required for the protected customer data attestation, which is
satisfied by the separation above.

## Development stores

Data from a Shopify development store that you own is your own data, not a merchant's, and it
lives in production because the deployed app is what the store is installed on. That is
acceptable — it is not somebody else's customers. What is not acceptable is the reverse:
using a real merchant's installation as a test bed.
