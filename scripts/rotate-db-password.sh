#!/usr/bin/env bash
#
# Rotate the production Postgres admin password, and update everything that uses it.
#
# WHY THIS EXISTS
# ---------------
# The previous credential was committed to DEPLOY-RUNBOOK.md in the repository's first
# commit (2026-07-25) and pushed to a PUBLIC GitHub repository, where it stayed for roughly
# six weeks. It has been removed from the working tree and purged from local git history,
# but it must be treated as harvested: GitHub retains unreferenced objects after a
# force-push, so the old blob can remain reachable by SHA until GitHub garbage-collects it.
#
# WHY A HUMAN RUNS THIS AND NOT AN AGENT
# --------------------------------------
# There is an unavoidable window between the password changing and the Web App picking up
# the new connection string, during which every request fails. That window needs someone
# watching who can roll forward or back. The database is also firewalled to Azure IPs, so
# the new credential cannot be verified from a laptop without adding a firewall rule.
#
# ORDER MATTERS. Rotating first and updating settings second means a short outage.
# Updating settings first means an immediate outage until the rotation lands. Rotate first
# is the shorter of the two, so that is what this does.
#
# USAGE
#   ./scripts/rotate-db-password.sh
#
# Requires: az CLI logged in with write access to subscription c06cb7bc-…

set -euo pipefail

SUB="c06cb7bc-9f8e-4718-85f1-00b344431aca"
RG="reviewmaster-rg"
SERVER="reviewmaster-db-server"
APP="reviewmaster-app"
DBNAME="reviewmaster"
ADMIN="dbadmin"

echo "==> Generating a new password"
# No '#', '@', '/', ':' or '?' — every one of those has to be percent-encoded inside a
# connection URL, and getting that wrong is how the last one ended up documented with a
# "note the %23" caveat beside it. Alphanumeric avoids the whole class of problem.
NEW_PW="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40)"

echo "==> Rotating the server admin password"
az postgres flexible-server update \
  --subscription "$SUB" -g "$RG" -n "$SERVER" \
  --admin-password "$NEW_PW" \
  --output none

DSN="postgresql://${ADMIN}:${NEW_PW}@${SERVER}.postgres.database.azure.com:5432/${DBNAME}?sslmode=require"

echo "==> Updating the Web App setting (this restarts the container)"
az webapp config appsettings set \
  --subscription "$SUB" -g "$RG" -n "$APP" \
  --settings DATABASE_URL="$DSN" \
  --output none

echo "==> Waiting for the app to come back"
for i in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "https://${APP}.azurewebsites.net/api/store" || true)"
  # 401 is a healthy response here: the route requires a session, and answering at all
  # means the process booted and reached the database.
  if [ "$code" = "401" ] || [ "$code" = "200" ]; then
    echo "    app responding (HTTP $code) after ${i}0s"
    break
  fi
  echo "    still starting (HTTP $code) …"
  sleep 10
done

echo
echo "==> REMAINING MANUAL STEPS"
echo
echo "1. Update the GitHub Actions secret so deploys can still run migrations:"
echo "     https://github.com/MarkaTech/Shopify-reviews-AK/settings/secrets/actions"
echo "   Secret name: DATABASE_URL"
echo "   Value is printed once below — copy it now, it is not stored anywhere."
echo
echo "   $DSN"
echo
echo "2. Narrow the firewall. The server currently carries"
echo "   'AllowAllAzureServicesAndResourcesWithinAzureIps' (0.0.0.0), which admits any VM"
echo "   in ANY Azure tenant to port 5432 — so the credential alone was enough, with no"
echo "   network foothold. Replace it with the Web App's outbound IPs:"
echo
echo "     az webapp show --subscription $SUB -g $RG -n $APP --query possibleOutboundIpAddresses -o tsv"
echo "     # then add one rule per address, and delete the 0.0.0.0 rule:"
echo "     az postgres flexible-server firewall-rule delete --subscription $SUB \\"
echo "       -g $RG -s $SERVER -r AllowAllAzureServicesAndResourcesWithinAzureIps --yes"
echo
echo "3. Ask GitHub Support to garbage-collect unreferenced objects on the repository."
echo "   The force-push removed the old commits from every branch, but GitHub keeps"
echo "   unreferenced blobs reachable by SHA until it collects them."
echo
