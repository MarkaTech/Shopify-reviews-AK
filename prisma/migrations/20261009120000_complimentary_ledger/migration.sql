-- A complimentary plan ledger keyed by shop domain, so an operator's gift survives
-- shop/redact the way the trial ledger does (see TrialLedger in the previous migration).
-- Additive and idempotent, like every migration in this directory: nothing existing is
-- read or rewritten, so a live store is untouched by applying it.

CREATE TABLE IF NOT EXISTS "ComplimentaryLedger" (
  "shopifyDomain" TEXT NOT NULL,
  "plan"          TEXT NOT NULL,
  "grantedAt"     TIMESTAMP(3) NOT NULL,
  "endedAt"       TIMESTAMP(3),
  CONSTRAINT "ComplimentaryLedger_pkey" PRIMARY KEY ("shopifyDomain")
);
