-- The shop's default currency on Store (ISO 4217, e.g. 'INR').
--
-- Product prices are synced from Shopify in the shop's own currency, but nothing recorded
-- which currency that was, so the products page printed every price with a "$" in front.
-- The code is read from the Admin API (shop { currencyCode }) at install and on every
-- catalogue sync. Only Shopify knows it, so there is no backfill here: an existing store
-- has NULL until its next sync, and the app shows a bare number until then.
--
-- Additive and idempotent, like every migration in this directory: one nullable column with
-- no default, so no existing row is read or rewritten and a live store is untouched by
-- applying it. IF NOT EXISTS, so a database an earlier `db push` already reshaped does not
-- fail the deploy.

ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "currency" TEXT;
