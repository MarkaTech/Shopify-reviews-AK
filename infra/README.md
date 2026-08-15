# Scheduling

Four jobs run on a schedule. Three of them can be late without anyone caring. One cannot.

| Job | Every | Scheduler | Late is… |
|---|---|---|---|
| `review-requests` | hour | **Azure Logic App** | visible to merchants |
| `retention` | day | GitHub Actions | fine |
| `etsy-sync` | day | GitHub Actions | fine |
| `weekly-summary` | week | GitHub Actions | fine |

## Why the hourly one moved off GitHub Actions

GitHub's `schedule:` trigger is best-effort, and GitHub says so: runs are delayed under
load and can be dropped entirely. Measured on this app on 14 August 2026:

```
review-requests   every :40    last ran 17:41   missed 18:40 and 19:40
retention         03:20 daily  ran 08:02        4h 42m late
etsy-sync         04:10 daily  ran 08:46        4h 36m late
```

Nothing is *lost* when a tick is missed. `sweepDueRequests` claims every request where
`nextSendAt <= now`, so a late run drains the whole backlog rather than skipping it. But
"your review invitation arrived four hours late" is a merchant-visible defect, and the
sweep is the product's core loop.

The daily jobs stay where they are. A retention pass running at 08:00 instead of 03:20
costs nothing.

## Deploying the Logic App

You need the resource group the Web App lives in, and the `CRON_SECRET` value already set
on the Web App and in GitHub secrets. **The secret is passed at deploy time as a
securestring — do not put it in this file, the template, or a shell history you keep.**

```bash
az deployment group create \
  --resource-group <your-resource-group> \
  --template-file infra/review-requests-scheduler.json \
  --parameters cronSecret="$(read -rsp 'CRON_SECRET: ' s && echo "$s")"
```

Reading it into a variable that way keeps it off your terminal and out of shell history.
If your shell records commands regardless, set it in the portal instead: deploy without
the parameter, then edit the workflow's `cronSecret` parameter under
**Logic app → Development Tools → Logic app code view**.

Confirm the region if the resource group's default is not where you want it:
`--parameters location=centralindia`.

## After deploying

1. **Run it once by hand.** Logic app → **Run Trigger** → **Every_hour**.
2. **Check it landed.** `/admin` → Jobs panel, or `GET /api/admin/jobs`. There should be a
   `review-requests` run timestamped within the last minute, and `staleCritical` back to 0.
3. **Then turn off the GitHub schedule**, so there is one scheduler rather than two:

   ```yaml
   # .github/workflows/review-requests.yml
   on:
     workflow_dispatch:      # keep, for running it by hand
     # schedule:
     #   - cron: '40 * * * *'   # replaced by the Azure Logic App, see infra/README.md
   ```

   Running both is *safe* — the sweep claims rows atomically, so a double run cannot send
   twice — but two schedulers means two places to look when something stops.

## Alerting

The Logic App marks a run **Failed** if the sweep returns anything other than 200 after
four retries. To be told about it rather than having to look:

**Logic app → Alerts → New alert rule → Signal: _Runs Failed_ → Threshold: greater than 0
over 1 hour → action group: your email.**

Worth doing. The whole reason this document exists is that a scheduler stopped and the
only symptom was a number that quietly stopped moving.

## Cost

A Consumption Logic App at one run an hour is roughly 730 runs and ~1,500 actions a month.
That is a few cents. It is the cheapest reliable scheduler available on the stack this app
already runs on.
