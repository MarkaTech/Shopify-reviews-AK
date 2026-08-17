/**
 * Telling apart the two very different things "a failed import" can mean.
 *
 * Six failed imports showed up on the operator dashboard and took a session to explain.
 * All six turned out to be a merchant pasting listing URLs that had no reviews on them —
 * four attempts, then three successful imports of the same product minutes later. Nothing
 * was broken. But the health row said "Imports failed (30d): 6" and gave an operator no
 * way to know that without going to the database.
 *
 * That is the failure mode of a health check that counts the wrong thing. With real
 * merchants, people pasting bad URLs is constant and unavoidable, so the row would never
 * be zero, and an operator would learn to ignore it — at which point it stops reporting
 * the case it exists for: our importer breaking.
 *
 * So failures are split. A listing failure is the merchant's URL and belongs in their
 * store drawer as history. A platform failure is ours and belongs in Needs attention.
 */

/** `listing` — the merchant's URL had nothing to import. `platform` — our side broke. */
export type ImportFailureKind = 'listing' | 'platform';

/**
 * Messages the importer produces when the *page* is the problem.
 *
 * Matched on the merchant-facing text rather than an error code because that text is what
 * the importer actually writes, and inventing a parallel code system that has to be kept
 * in sync would be a second thing to get wrong. If these strings are ever reworded, a
 * failure reclassifies as `platform` — which is the safe direction: it appears in Needs
 * attention and gets looked at, rather than disappearing.
 */
const LISTING_FAILURE_PATTERNS: RegExp[] = [
  /no reviews found on that listing/i,
  /no structured review data found/i,
  /check the url opens a product page/i,
  /does not look like a .{0,20}product page/i,
  /listing (is )?unavailable/i,
];

/**
 * Unattributable failures count as ours.
 *
 * A failed job with no error message is a bug in whatever failed to record one. Filing it
 * under the merchant would hide it; filing it under us means somebody looks.
 */
export function classifyImportFailure(errorMessage: string | null | undefined): ImportFailureKind {
  if (!errorMessage) return 'platform';
  return LISTING_FAILURE_PATTERNS.some((re) => re.test(errorMessage)) ? 'listing' : 'platform';
}

export interface ImportFailureSummary {
  /** Every failure in the window, however caused. */
  total: number;
  /** The merchant's URL had nothing on it. Expected, and not actionable by an operator. */
  listing: number;
  /** Ours. This is the number that belongs in Needs attention. */
  platform: number;
}

export function summariseImportFailures(
  jobs: Array<{ errorMessage: string | null }>
): ImportFailureSummary {
  let listing = 0;
  let platform = 0;
  for (const job of jobs) {
    if (classifyImportFailure(job.errorMessage) === 'listing') listing++;
    else platform++;
  }
  return { total: jobs.length, listing, platform };
}
