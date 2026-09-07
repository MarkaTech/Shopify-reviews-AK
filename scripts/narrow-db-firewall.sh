#!/usr/bin/env bash
#
# Replace the blanket "allow all Azure services" database firewall rule with one rule per
# Web App outbound address.
#
# WHY
# ---
# The server carries AllowAllAzureServicesAndResourcesWithinAzureIps, whose IP range is
# 0.0.0.0 — Azure's way of saying "any resource inside Azure". That is not a narrow set: it
# admits a VM in ANY Azure tenant, belonging to anyone, to port 5432. When the admin
# credential leaked, that rule is why it was directly usable from a $5 VM with no network
# foothold at all.
#
# RUN THIS ONLY AFTER
# -------------------
# A deploy has succeeded with the "Open database firewall for this run" and "Close database
# firewall" steps both green. Those steps are what give CI its own access; until they have
# demonstrably worked, this blanket rule is still load-bearing and removing it breaks
# `prisma migrate deploy` on every future deploy.
#
# The script checks for that itself and refuses if it cannot confirm it.
#
# WHAT IT DOES NOT COVER
# ----------------------
# `possibleOutboundIpAddresses` is the set for the CURRENT App Service plan tier. Scaling
# the plan up or down can change it, and the app then loses database access until this is
# re-run. That is the accepted cost of not leaving the door open to all of Azure; the real
# fix is VNet integration with a private endpoint, which is a larger change.
#
# USAGE
#   ./scripts/narrow-db-firewall.sh          # show what it would do
#   ./scripts/narrow-db-firewall.sh --apply  # actually change the firewall

set -euo pipefail

SUB="c06cb7bc-9f8e-4718-85f1-00b344431aca"
RG="reviewmaster-rg"
SERVER="reviewmaster-db-server"
APP="reviewmaster-app"
BLANKET_RULE="AllowAllAzureServicesAndResourcesWithinAzureIps_2026-7-25_20-39-13"
REPO="MarkaTech/Shopify-reviews-AK"

APPLY=false
[ "${1:-}" = "--apply" ] && APPLY=true

echo "==> Checking that CI can reach the database on its own"
# The firewall steps must have succeeded in a real run, or removing the blanket rule locks
# CI out of the database and every future deploy fails at the migration step.
if command -v gh >/dev/null 2>&1; then
  # Scoped to the DEPLOY workflow. Without the workflow filter this picked the most recent
  # successful run of anything — usually one of the hourly crons, which has no firewall
  # steps at all — and refused even after a genuinely good deploy.
  ok="$(gh run list --repo "$REPO" --workflow "Deploy to Azure Web App" --limit 20 \
        --json databaseId,conclusion --jq \
        '[.[] | select(.conclusion=="success")][0].databaseId' 2>/dev/null || true)"
  if [ -z "$ok" ]; then
    echo "    no successful run of the deploy workflow yet — refusing." >&2
    echo "    Deploy successfully once, then re-run this." >&2
    exit 1
  fi
  steps="$(gh run view "$ok" --repo "$REPO" --json jobs --jq \
           '[.jobs[].steps[] | select(.name|test("database firewall")) | .conclusion] | join(",")' 2>/dev/null || true)"
  case "$steps" in
    *success*) echo "    run $ok had the firewall steps green ($steps)" ;;
    *) echo "    run $ok has no green firewall steps ($steps) — refusing." >&2
       echo "    Deploy the workflow that opens a per-run firewall rule first." >&2
       exit 1 ;;
  esac
else
  echo "    gh not installed; cannot verify. Re-run where gh is available." >&2
  exit 1
fi

echo "==> Collecting the Web App's outbound addresses"
# A `while read` loop, not `mapfile`: macOS ships bash 3.2, where mapfile does not exist.
# Under `set -e` that is an immediate exit 127 — safe, but a confusing way to fail.
IPS=()
while IFS= read -r ip; do
  [ -n "$ip" ] && IPS+=("$ip")
done < <(
  az webapp show --subscription "$SUB" -g "$RG" -n "$APP" \
    --query possibleOutboundIpAddresses -o tsv | tr ',' '\n' | sort -u | grep -E '^[0-9.]+$'
)
echo "    ${#IPS[@]} addresses"
if [ "${#IPS[@]}" -eq 0 ]; then
  echo "    none found — refusing to remove the blanket rule" >&2
  exit 1
fi

if [ "$APPLY" != true ]; then
  echo
  echo "DRY RUN. Would add one rule per address:"
  for ip in "${IPS[@]}"; do echo "    webapp-${ip//./-}  ->  $ip"; done
  echo "Would then delete: $BLANKET_RULE"
  echo
  echo "Re-run with --apply to make these changes."
  exit 0
fi

echo "==> Adding a rule per address"
for ip in "${IPS[@]}"; do
  name="webapp-${ip//./-}"
  az postgres flexible-server firewall-rule create \
    --subscription "$SUB" -g "$RG" --server-name "$SERVER" --name "$name" \
    --start-ip-address "$ip" --end-ip-address "$ip" --output none
  echo "    + $name"
done

echo "==> Removing the blanket rule"
az postgres flexible-server firewall-rule delete \
  --subscription "$SUB" -g "$RG" --server-name "$SERVER" --name "$BLANKET_RULE" \
  --yes --output none
echo "    - $BLANKET_RULE"

echo "==> Confirming the app still reaches the database"
# "Unknown store" is a successful query: the route looked the shop up and did not find it.
# A 5xx, or a hang, means the app can no longer connect and the blanket rule must go back.
body="$(curl -s --max-time 20 "https://${APP}.azurewebsites.net/api/storefront/reviews?shop=firewall-check.myshopify.com" || true)"
case "$body" in
  *"Unknown store"*) echo "    app still reaching the database" ;;
  *) echo
     echo "    WARNING: unexpected response: ${body:0:120}" >&2
     echo "    If the app cannot connect, restore access immediately with:" >&2
     echo "      az postgres flexible-server firewall-rule create --subscription $SUB \\" >&2
     echo "        -g $RG --server-name $SERVER --name AllowAllAzureServices \\" >&2
     echo "        --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0" >&2
     exit 1 ;;
esac

echo
echo "Done. Remaining rules:"
az postgres flexible-server firewall-rule list --subscription "$SUB" -g "$RG" -s "$SERVER" \
  --query "[].{rule:name,start:startIpAddress,end:endIpAddress}" -o table
