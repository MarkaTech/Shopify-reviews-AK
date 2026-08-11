/**
 * Merchant custom-CSS sanitiser.
 *
 * Split out of storefront-config.ts so it can be tested. That file imports the Prisma
 * client, so importing it from a test boots a database connection the test does not need
 * and cannot have — and this is a function whose correctness is a set of strings that
 * must and must not survive. See tests/security.test.ts.
 */

/**
 * Sanitise merchant-authored CSS before it is injected into their storefront.
 *
 * The threat model is not "a merchant attacks themselves" — it is a compromised merchant
 * account, or a staff member with admin access, turning the review widget into a delivery
 * mechanism aimed at shoppers. So:
 *
 *   - `<` and `>` are stripped, which makes `</style>` breakout impossible.
 *   - `@import` is removed: it fetches and executes a stylesheet from a third-party origin,
 *     which is both an exfiltration channel (via selectors) and a hard dependency on
 *     someone else's uptime on the merchant's product page.
 *   - `expression(` (legacy IE) and `javascript:` are removed — both execute script.
 *   - `url()` is restricted to https and data: images. `url(http://…)` is mixed content on
 *     an HTTPS storefront; anything else is a fetch we should not be making.
 *
 * Not a sandbox, and not sold as one. It closes the paths that turn CSS into script.
 */
export function sanitiseCss(raw: string): string {
  // Escapes are resolved BEFORE any keyword matching.
  //
  // CSS resolves `\` escapes while tokenising, so `\75rl(...)` and `@\69mport ...` are
  // the identical token to `url(...)` and `@import` as far as a browser is concerned —
  // and were invisible to the literal string matches this used to do. Both bypasses were
  // verified against the previous implementation: they survived the write pass and the
  // read pass untouched, which defeated the remote-stylesheet ban outright.
  //
  // Rewriting the escape to the character it denotes means the patterns below see what
  // the browser will see. Only the escape forms that can spell an ASCII letter are
  // relevant, so this maps the hex form and drops a backslash before a plain letter.
  const unescaped = String(raw ?? '')
    .slice(0, 20000)
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n]?/g, (_m, hex: string) => {
      const code = parseInt(hex, 16);
      // Only fold escapes back into printable ASCII. Anything else stays escaped rather
      // than becoming a character this function then has to reason about.
      return code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : '';
    })
    .replace(/\\([a-zA-Z:@()])/g, '$1');

  // Applied to a fixed point, because every replacement can reveal a new match.
  // `exprexprexpression(ession(ession(` collapses one layer per pass, so a single pass
  // hands the next stage a live `expression(` it never inspected. Looping until nothing
  // changes removes the nesting trick entirely; the bound stops a pathological input
  // spinning.
  let out = unescaped;
  for (let pass = 0; pass < 8; pass++) {
    const before = out;
    out = out
      .replace(/[<>]/g, '')
      .replace(/@import[^;]*;?/gi, '')
      .replace(/expression\s*\(/gi, '')
      .replace(/javascript\s*:/gi, '')
      // The quote group is required to match consistently — as an optional group it could
      // backtrack to empty and wrongly rewrite a legitimate `url("https://…")` to `none`.
      .replace(/url\s*\(\s*(?:'[^']*'|"[^"]*"|[^)]*)\)/gi, (match: string) =>
        /url\s*\(\s*['"]?(https:|data:image\/)/i.test(match) ? match : 'none'
      );
    if (out === before) break;
  }
  return out;
}
