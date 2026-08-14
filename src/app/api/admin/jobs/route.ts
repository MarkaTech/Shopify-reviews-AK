import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { jobHealth, JOB_SCHEDULE } from '@/lib/job-run';
import { emailProvider } from '@/lib/email';

/**
 * Are the background jobs actually running?
 *
 * The hourly review-request sweep is the product's core loop. If the scheduler stops
 * firing it, invitations stop going out and nothing anywhere says so — the number just
 * stops moving. A job whose last run is older than twice its interval is reported stale;
 * one missed tick is a blip, two is a pattern.
 */
export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { latest, recentFailures, complianceReceipts, manualRuns } = await jobHealth();
  const byJob = new Map(latest.map((r) => [r.job, r]));
  const now = Date.now();

  const jobs = Object.entries(JOB_SCHEDULE).map(([job, meta]) => {
    const run = byJob.get(job);
    const lastAt = run?.startedAt ? new Date(run.startedAt) : null;
    const ageMinutes = lastAt ? Math.round((now - lastAt.getTime()) / 60000) : null;
    return {
      job,
      label: meta.label,
      critical: meta.critical,
      everyMinutes: meta.everyMinutes,
      lastRunAt: lastAt?.toISOString() ?? null,
      ageMinutes,
      ok: run?.ok ?? null,
      // A run that opened and never closed: the process died mid-job.
      unfinished: Boolean(run && run.finishedAt === null),
      summary: run?.summary ?? null,
      error: run?.error ?? null,
      // null lastRun means never seen, which is as stale as it gets.
      stale: ageMinutes === null || ageMinutes > meta.everyMinutes * 2,
    };
  });

  /**
   * Email delivery configuration.
   *
   * Added because "sent: 1, failures: 0, and the email never arrived" is otherwise
   * unanswerable from inside the app. Both common causes look like success at the API:
   * Resend's shared `onboarding@resend.dev` sender only delivers to the Resend account
   * owner's own address and silently drops everything else, and an unverified sending
   * domain behaves the same way. Neither produces a bounce, because the message never
   * entered the mail system.
   *
   * The provider name and the From address are configuration, not secrets. No key,
   * token or credential is returned here or anywhere in this API.
   */
  const provider = emailProvider();
  const from = process.env.EMAIL_FROM?.trim() || '';
  const usingSharedTestSender = !from || /@resend\.dev>?$/i.test(from);

  return NextResponse.json({
    email: {
      provider,
      from: from || 'ReviewMaster <onboarding@resend.dev>  (default — not configured)',
      configured: Boolean(provider),
      usingSharedTestSender,
      warning: !provider
        ? 'No email provider configured — review requests cannot be sent at all.'
        : usingSharedTestSender
          ? "Sending from Resend's shared test address. It only delivers to the Resend account owner's own email; every other recipient is accepted and silently dropped. Verify a domain and set EMAIL_FROM to it."
          : null,
    },
    jobs,
    staleCritical: jobs.filter((j) => j.critical && j.stale).length,
    recentFailures: recentFailures.map((r) => ({
      job: r.job, startedAt: r.startedAt, error: r.error, shop: r.shop,
    })),
    manualRuns: manualRuns.map((r) => ({
      job: r.job.replace(/:manual$/, ''), startedAt: r.startedAt, ok: r.ok, summary: r.summary,
    })),
    complianceReceipts: complianceReceipts.map((r) => ({
      topic: r.job.replace(/^webhook:/, ''), startedAt: r.startedAt, ok: r.ok, shop: r.shop, summary: r.summary,
    })),
  });
}
