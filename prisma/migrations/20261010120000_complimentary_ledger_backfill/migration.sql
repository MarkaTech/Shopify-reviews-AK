-- Copy the complimentary plans that already exist into ComplimentaryLedger.
--
-- Gifts went live on 8 Oct 2026 stored only in StoreSetting 'admin.complimentaryPlan', and
-- the previous migration created the ledger empty. Only a new grant from the operator
-- portal writes a ledger row, so every gift given before this deploy had none, and
-- shop/redact (which deletes every StoreSetting row 48 hours after an uninstall) still
-- erased it for good: the merchant reinstalled onto Free with no trace of the gift. That is
-- the failure the ledger exists to prevent.
--
-- A migration of its own rather than a line added to 20261009120000, so a database that has
-- already applied that one never sees its checksum change.
--
-- Idempotent, like every migration in this directory:
--   - ON CONFLICT DO NOTHING. A ledger row that already exists was written by the portal
--     after the ledger existed (a grant, or the end of one), so it is newer than the
--     setting it would be copied from, and it stands.
--   - Only live gifts are copied. An ended gift is stored as '' and matches nothing, and a
--     store with no shop domain has no key to survive redact under.
--   - The value is matched by pattern, not cast with ::jsonb, so a malformed value is
--     skipped instead of failing the deploy. serialiseComplimentary (src/lib/plans.ts)
--     writes JSON.stringify({ plan, grantedAt }), which has no whitespace, and only the
--     operator portal writes this key (the merchant settings route refuses 'admin.' keys).
--     substring() with a pattern returns its first parenthesised group: the plan id.
--   - grantedAt is the row's updatedAt rather than the date inside the value. The grant
--     writes that value in a single upsert, which stamps updatedAt in the same request, and
--     nothing else writes a live gift's row (ending one writes ''; restoring from the
--     ledger cannot have run, the ledger being empty until now). So the two agree to within
--     milliseconds, and reading a column needs no text-to-timestamp cast that could fail.

-- "endedAt" is left to its column default, NULL: every gift copied here is live.
INSERT INTO "ComplimentaryLedger" ("shopifyDomain", "plan", "grantedAt")
SELECT
  s."shopifyDomain",
  substring(ss."value" from '"plan":"(growth|scale)"'),
  ss."updatedAt"
FROM "StoreSetting" ss
JOIN "Store" s ON s."id" = ss."storeId"
WHERE ss."key" = 'admin.complimentaryPlan'
  AND s."shopifyDomain" IS NOT NULL
  AND ss."value" ~ '"plan":"(growth|scale)"'
ON CONFLICT ("shopifyDomain") DO NOTHING;
