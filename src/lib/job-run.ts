import crypto from 'crypto';
import { db } from './db';

/**
 * Record that a scheduled job — or a compliance webhook — ran.
 *
 * Why this exists: nothing recorded whether the scheduled jobs were running at all. The
 * hourly review-request sweep IS the product's core loop, and if the scheduler stops
 * firing it (a disabled workflow, a lapsed secret, a suspended account) review invitations
 * silently stop going out. The only symptom is a number that gradually stops moving. Not
 * hypothetical: three consecutive deploys failed unnoticed on 11-12 August 2026 for
 * exactly this class of reason, with no alert anywhere.
 *
 * Raw SQL rather than the typed client, deliberately: `prisma generate` cannot run in the
 * environment this was written in (no network for the engine download), so using
 * `db.jobRun` would mean shipping code nobody could typecheck until CI. The table is
 * declared in schema.prisma and created by its migration; only the access here is raw.
 *
 * Fail-soft in both directions. A job must never break because its own bookkeeping did,
 * and a missing completion is itself the signal — a run that starts and never finishes
 * leaves `finishedAt` null, which is precisely how a process killed mid-sweep announces
 * itself.
 */
export async function recordJobRun<T>(
  job: string,
  fn: () => Promise<T>,
  opts: { shop?: string; summarise?: (result: T) => unknown } = {}
): Promise<T> {
  const id = crypto.randomUUID();
  try {
    await db.$executeRaw`
      INSERT INTO "JobRun" ("id", "job", "shop", "startedAt")
      VALUES (${id}, ${job}, ${opts.shop ?? null}, NOW())`;
  } catch (error) {
    console.error('[job-run] could not open a run row for', job, error);
  }

  const finish = async (ok: boolean, summary: string | null, err: string | null) => {
    try {
      await db.$executeRaw`
        UPDATE "JobRun"
        SET "finishedAt" = NOW(), "ok" = ${ok}, "summary" = ${summary}, "error" = ${err}
        WHERE "id" = ${id}`;
    } catch {
      /* bookkeeping must never mask the job's own outcome */
    }
  };

  try {
    const result = await fn();
    let summary: string | null = null;
    try {
      summary = JSON.stringify(opts.summarise ? opts.summarise(result) : result).slice(0, 2000);
    } catch {
      summary = null;
    }
    await finish(true, summary, null);
    return result;
  } catch (error) {
    await finish(false, null, String(error instanceof Error ? error.message : error).slice(0, 1000));
    throw error;
  }
}

export interface JobRunRow {
  job: string;
  startedAt: Date;
  finishedAt: Date | null;
  ok: boolean | null;
  summary: string | null;
  error: string | null;
  shop: string | null;
}

/** The most recent run of every job we know about, plus recent failures. */
export async function jobHealth(): Promise<{
  latest: JobRunRow[];
  recentFailures: JobRunRow[];
  complianceReceipts: JobRunRow[];
}> {
  const [latest, recentFailures, complianceReceipts] = await Promise.all([
    db.$queryRaw<JobRunRow[]>`
      SELECT DISTINCT ON ("job") "job", "startedAt", "finishedAt", "ok", "summary", "error", "shop"
      FROM "JobRun" WHERE "job" NOT LIKE 'webhook:%'
      ORDER BY "job", "startedAt" DESC`,
    db.$queryRaw<JobRunRow[]>`
      SELECT "job", "startedAt", "finishedAt", "ok", "summary", "error", "shop"
      FROM "JobRun" WHERE "ok" = false AND "startedAt" > NOW() - INTERVAL '7 days'
      ORDER BY "startedAt" DESC LIMIT 20`,
    db.$queryRaw<JobRunRow[]>`
      SELECT "job", "startedAt", "finishedAt", "ok", "summary", "error", "shop"
      FROM "JobRun" WHERE "job" LIKE 'webhook:%' AND "startedAt" > NOW() - INTERVAL '30 days'
      ORDER BY "startedAt" DESC LIMIT 20`,
  ]);
  return { latest, recentFailures, complianceReceipts };
}

/**
 * How often each job should run. Anything older than roughly twice its interval is
 * treated as stale — one missed tick is a blip, two is a pattern.
 */
export const JOB_SCHEDULE: Record<string, { label: string; everyMinutes: number; critical: boolean }> = {
  'review-requests': { label: 'Review request sweep', everyMinutes: 60, critical: true },
  'etsy-sync': { label: 'Etsy review sync', everyMinutes: 24 * 60, critical: false },
  retention: { label: 'Data retention', everyMinutes: 24 * 60, critical: false },
  'weekly-summary': { label: 'Weekly merchant summary', everyMinutes: 7 * 24 * 60, critical: false },
};
