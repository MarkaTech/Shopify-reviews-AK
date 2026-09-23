-- Shopify File GIDs behind review media, so files can be deleted on review delete and
-- on customer erasure; and a trial ledger keyed by shop domain that survives shop/redact.
-- Idempotent, like every migration in this directory.

ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "mediaGids" TEXT;

CREATE TABLE IF NOT EXISTS "TrialLedger" (
  "shopifyDomain" TEXT NOT NULL,
  "usedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrialLedger_pkey" PRIMARY KEY ("shopifyDomain")
);
