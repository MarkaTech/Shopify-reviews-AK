-- Background job runs and compliance webhook receipts.
-- Idempotent: safe to re-run, and safe against a database that already has the table.
CREATE TABLE IF NOT EXISTS "JobRun" (
  "id"         TEXT NOT NULL,
  "job"        TEXT NOT NULL,
  "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "ok"         BOOLEAN,
  "summary"    TEXT,
  "error"      TEXT,
  "shop"       TEXT,
  CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "JobRun_job_startedAt_idx" ON "JobRun"("job", "startedAt");
CREATE INDEX IF NOT EXISTS "JobRun_startedAt_idx" ON "JobRun"("startedAt");
