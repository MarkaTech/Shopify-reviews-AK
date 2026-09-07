# ReviewMaster — Deployment Runbook

Everything below runs in **your Terminal**, from the project folder:

```bash
cd ~/Downloads/shopify-review-app
```

Your Azure resources already exist (`reviewmaster-rg`, `reviewmaster-db-server`, `reviewmaster-app`). The code fixes are already applied to your files. Originals are preserved in `_backup_pre_fix/` if you want to diff anything.

---

## Step 1 — Generate the token encryption key

Shopify access tokens are now encrypted at rest. Generate the key **before** the first install, and keep it somewhere durable — if you lose it, every merchant has to reinstall.

```bash
openssl rand -base64 32
```

Save the output. Referred to below as `<TOKEN_KEY>`.

---

## Step 2 — Fix the Azure app settings

Two problems with the current settings: the `DATABASE_URL` is an invalid URL (the `#` in the password terminates it), and `TOKEN_ENCRYPTION_KEY` doesn't exist yet.

```bash
az webapp config appsettings set \
  --resource-group reviewmaster-rg \
  --name reviewmaster-app \
  --settings \
    DATABASE_URL='postgresql://dbadmin:<DB_PASSWORD>@reviewmaster-db-server.postgres.database.azure.com:5432/reviewmaster?sslmode=require' \
    TOKEN_ENCRYPTION_KEY='<TOKEN_KEY>' \
    CRON_SECRET='<CRON_SECRET>' \
    SES_TOPIC_ARN='<SNS_TOPIC_ARN>' \
  --output none
```

`CRON_SECRET` gates the four cron routes — unset, they return 503 forever and no review
invitation is ever sent. `SES_TOPIC_ARN` gates `/api/webhooks/ses`, which refuses every
notification (including the SNS subscription confirmation) while it is unset; see
`docs/ses-production-access.md`, and note the topic must exist before this is set.

If the password contains a `#`, percent-encode it as `%23` here and anywhere else it
appears inside a URL — an unencoded `#` truncates the connection string at that point.

---

## Step 3 — Create the database tables

The Prisma schema now targets PostgreSQL instead of SQLite, so this will actually work:

```bash
export DATABASE_URL='postgresql://dbadmin:<DB_PASSWORD>@reviewmaster-db-server.postgres.database.azure.com:5432/reviewmaster?sslmode=require'
npx prisma generate
npx prisma db push
```

Expect 9 tables, including the new `OAuthNonce`. If `db push` hangs, your IP may not be allowed through the Postgres firewall — the provisioning script only opened Azure services.

---

## Step 4 — Initialise git

I created a `.git` directory while checking things, but it's broken (the folder is mounted in a way that blocks git's file operations). Remove it and start clean:

```bash
rm -rf .git
git init -b main
git add -A
```

**Before committing, confirm no secrets are staged:**

```bash
git status --short | grep -E '^\A?\s*\.env$' && echo "STOP - .env is staged" || echo "OK"
git diff --cached --stat | tail -1
```

`.env` is covered by `.gitignore`, as are `skills/` (59 MB), `download/`, `upload/`, `db/` and the backup folder. Expect roughly 200 files, not thousands. Then:

```bash
git commit -m "ReviewMaster: production fixes for Azure deployment and App Store submission"
```

---

## Step 5 — Create the new repository and push

Using the GitHub CLI:

```bash
gh repo create reviewmaster-app --private --source=. --remote=origin --push
```

Or manually: create an empty repo at github.com/new (no README, no .gitignore), then:

```bash
git remote add origin https://github.com/<YOUR_USERNAME>/<REPO_NAME>.git
git push -u origin main
```

The workflow derives the image name from the repo name automatically, so any name works.

---

## Step 6 — Add the deploy secret

The first push will trigger the workflow, and it will fail without this.

```bash
cat /Users/kanishka/reviewmaster-azure-credentials.json | pbcopy
```

Then in the new repo: **Settings → Secrets and variables → Actions → New repository secret**

- Name: `AZURE_CREDENTIALS` (exactly)
- Value: paste

Also check **Settings → Actions → General → Workflow permissions** is set to *Read and write permissions*, or the push to GHCR will 403.

Re-run the failed workflow after adding the secret.

---

## Step 7 — Configure the Shopify Partner Dashboard

**App setup → URLs**

- App URL: `https://reviewmaster-app.azurewebsites.net`
- Allowed redirection URL: `https://reviewmaster-app.azurewebsites.net/api/auth/callback`

That path matters. The deployment guide says `/api/auth/callback/shopify`, but the code's route is `/api/auth/callback`. Use the code's path — a mismatch fails the install with `redirect_uri is not whitelisted`.

**App setup → Compliance webhooks** — all three are mandatory:

| Topic | URL |
|---|---|
| Customer data request | `https://reviewmaster-app.azurewebsites.net/api/webhooks/customers-data_request` |
| Customer redact | `https://reviewmaster-app.azurewebsites.net/api/webhooks/customers-redact` |
| Shop redact | `https://reviewmaster-app.azurewebsites.net/api/webhooks/shop-redact` |

Handlers for all three now exist and verify HMAC. Missing these is the most common reason for App Store rejection.

Confirm the API key and secret in the dashboard match `NEXT_PUBLIC_SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` in your Azure settings.

---

## Step 8 — Verify

The workflow includes a smoke test, but check yourself:

```bash
curl -sI https://reviewmaster-app.azurewebsites.net/ | head -1
az webapp log tail --resource-group reviewmaster-rg --name reviewmaster-app
```

Then install on a development store from the Partner Dashboard and confirm:

1. OAuth completes and lands on the dashboard — **not** `?error=auth_failed`
2. The embedded app renders inside the Shopify admin without logging you out on navigation
3. `Store` has a row, and its `accessToken` starts with `v1.` (encrypted, not `shpat_`)
4. `OAuthNonce` is empty afterwards — nonces are consumed on use

If OAuth fails, the log line tells you which check rejected it: `invalid_hmac`, `invalid_state`, `invalid_shop`, or `auth_failed`.

---

## What changed, and why

| Area | Problem | Fix |
|---|---|---|
| `prisma/schema.prisma` | Provider was still `sqlite` despite the guide claiming otherwise | `postgresql`; added `@@unique([storeId, shopifyId])` that the product-update webhook upsert requires; added `OAuthNonce` |
| `src/lib/shopify.ts` | The OAuth callback stripped `hmac` before verifying, so `timingSafeEqual` compared a 0-byte buffer to a 64-byte digest and threw `RangeError` on **every** install | Length-guarded constant-time compare; verify the full query string |
| `src/lib/shopify.ts` | `topic.replace('/', '-')` replaces only the first slash, so `app/charges/accepted` produced a 404 URL and paid upgrades were silently lost | `replaceAll` |
| `src/lib/session.ts` | Session cookie carried the raw Shopify access token, signed but not encrypted | Cookie holds `shop` + `storeId`; token loaded server-side |
| `src/lib/auth.ts` | `SameSite=Lax` cookies aren't sent inside the Shopify admin iframe | `SameSite=None; Secure`; `withAuth` is now async |
| `src/lib/crypto.ts` | Access tokens stored in plaintext | AES-256-GCM at rest, with pass-through for existing plaintext rows |
| `src/lib/nonce.ts` | OAuth nonces in an in-memory `Map` — lost on every container restart | Database-backed, single-use, shop-bound |
| `api/webhooks/[topic]` | No GDPR compliance handlers | All three implemented, running before the store lookup so `shop/redact` still succeeds after deletion |
| `azure-deploy.yml` | Deploy referenced `:${{ github.sha }}`, a tag `metadata-action` never publishes; image name kept repo casing | Publishes a matching `type=raw` tag; lowercased name; GHCR pull credentials; post-deploy smoke test |

Verified offline: 20 unit checks over the HMAC logic, topic mapping and encryption round-trip all pass. **Not** verified: a real `next build`, and any live Shopify call — neither is possible from my sandbox.

---

## The day Shopify approves the app

**Set `SHOPIFY_BILLING_TEST=false` before anyone installs.**

```bash
az webapp config appsettings set \
  --subscription c06cb7bc-9f8e-4718-85f1-00b344431aca \
  --resource-group reviewmaster-rg --name reviewmaster-app \
  --settings SHOPIFY_BILLING_TEST=false --output none
```

It is deliberately `true` today so the Shopify review team can complete an upgrade on their
development store. That reason has since expired: `createRecurringCharge` and
`resolveActivePlan` both decide test-vs-live from the SHOP's own plan class
(`shopify.ts:873` and `:1152`), so a development store gets a test charge and is entitled by
it whether the flag is set or not. Shopify will not accept a live charge on a development
store in any case.

While the flag is on, **every** store that subscribes gets a test subscription — real money
never moves. That is fine with no real installs, and becomes a problem the moment there are
any:

- A merchant who subscribes while it is `true` is on a test charge, so they are never billed.
- When it is later set to `false`, `resolveActivePlan` stops honouring test subscriptions for
  non-development stores, and that merchant silently drops to Free at the next plan reconcile
  (hourly, `src/app/api/store/route.ts`). Nothing charged them, and nothing explains it.

So flip it at approval, before the first install, and the window never opens. If it is missed
and a merchant is caught by it, the recovery is to have them re-subscribe once the flag is
off — there is no charge to refund, because none was ever made.

## Still outstanding for App Store submission

- `next.config.ts` now sets `typescript.ignoreBuildErrors: false` and the tree typechecks clean. Keep it that way — this setting is what let the broken upsert reach production.
- `shopify.app.toml` is committed and is the source of truth for scopes, webhooks and the application URL.
- Listing assets: 128×128 icon, 5+ screenshots at 1024×768, 200+ word description, privacy policy URL, terms URL.
- Billing plans exist in code (free / growth / scale) and need matching listing entries.
- **The Postgres admin password must be rotated.** An earlier revision of this file carried
  the real `DATABASE_URL` — host, `dbadmin` username and password — in the two commands
  above. That revision was committed on 2026-07-25 and pushed to a public GitHub
  repository, so the credential is in public git history and removing it from the working
  tree (done) does not remediate it. Rotate in Azure, update the `DATABASE_URL` app setting
  and the GitHub Actions secret, then purge the history with `git-filter-repo` or BFG and
  force-push. Treat the old password as harvested.
