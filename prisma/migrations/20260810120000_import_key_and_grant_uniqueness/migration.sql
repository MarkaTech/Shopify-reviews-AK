-- Import deduplication key, and one incentive grant per review.
--
-- Both replace application-level guards that could not hold under concurrency:
--   * importers deduplicated against a Set built from a snapshot SELECT, which cannot see
--     a concurrent run, so overlapping imports wrote every review twice;
--   * the "one code per review" check was a findFirst separated from its insert by a
--     Shopify API round trip, wide enough for a double-clicked Approve to mint two codes.
--
-- Purely additive. The new column is nullable and the indexes are unique-on-nullable, and
-- Postgres treats NULLs as distinct — so every existing row (storefront submissions, CSV
-- and manual entries all carry a NULL key) is unaffected. Verified against a
-- production-shaped table: 3 rows in, 3 rows out, existing NULL keys not in collision.
--
-- IF NOT EXISTS throughout, so this is safe to run against a database where an earlier
-- `db push` already applied part of it. That is the exact state production may be in
-- depending on deploy ordering, and a migration that cannot tolerate it would fail the
-- first deploy after the switch.

ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "sourceReviewKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Review_storeId_source_sourceReviewKey_key"
  ON "Review"("storeId", "source", "sourceReviewKey");

CREATE UNIQUE INDEX IF NOT EXISTS "IncentiveGrant_reviewId_key"
  ON "IncentiveGrant"("reviewId");
