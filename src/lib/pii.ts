/**
 * Masking for personal data that reaches somewhere we cannot erase it.
 *
 * The problem this exists for
 * ---------------------------
 * Application logs are outside every erasure and retention path the app has. `runRetention`
 * deletes database rows; `handleCustomerRedact` anonymises database columns. Neither can
 * touch a line already written to stdout, which on Azure is shipped to Log Analytics and
 * kept on that workspace's own schedule.
 *
 * So a raw address in a log line is a copy of protected customer data that survives the
 * erasure request that was supposed to remove it — and the app requests `read_customers`
 * and `read_orders`, which puts it under Shopify's Level 2 obligations, where retention and
 * erasure are requirements rather than good practice. It also contradicts the app's own
 * submitted answers.
 *
 * Diagnostics were the reason those lines existed, and they are a real reason: "which
 * address did that bounce for" is the first question when a send fails. `ja***@example.com`
 * answers it — it is enough to recognise an address you already have in front of you in the
 * merchant's admin, and not enough to be a copy of it.
 *
 * Prefer logging a row id where one exists. Use this only where a human genuinely needs to
 * recognise the address.
 */

/**
 * `jane.doe@example.com` -> `ja***@example.com`.
 *
 * The domain is kept whole: it carries the diagnostic signal (a whole domain bouncing is a
 * different problem from one mailbox bouncing) and is not personal data on its own.
 * Anything that does not parse as an address collapses to `***` rather than being passed
 * through, so a malformed value cannot leak by falling out of the happy path.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '(none)';
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return '***';
  const user = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain.includes('.')) return '***';
  // Proportional, and never the whole local part. `jo@x.com` returned `jo***@x.com` — the
  // complete address plus decoration — and two-character local parts are common at the
  // domains that hand them out.
  if (user.length <= 1) return `***@${domain}`;
  const shown = user.length <= 3 ? user.slice(0, 1) : user.slice(0, 2);
  return `${shown}***@${domain}`;
}
