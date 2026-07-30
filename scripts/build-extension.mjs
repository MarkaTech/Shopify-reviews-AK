#!/usr/bin/env node
/**
 * Build the theme app extension's shipped JavaScript from its documented source.
 *
 * Why this exists
 * ---------------
 * Shopify's `AssetSizeAppBlockJavascript` theme check flags app block JavaScript over
 * 10,000 bytes *compressed*. It is currently a suggestion rather than a hard failure, but
 * this file runs on product and collection pages, which carry 83% of the weight in the
 * storefront Lighthouse score a merchant is judged on. It is worth staying under.
 *
 * The widget source is heavily commented on purpose — the FTC disclosure rules, the CLS
 * reasoning, the escaping rules and the carousel's autoplay behaviour are all things the
 * next person to touch this needs to know, and deleting the explanation to save bytes
 * trades a permanent cost for a temporary one. So the comments live in `extension-src/`
 * and the asset Shopify serves is generated from it.
 *
 * Why `extension-src/` and not `extensions/reviewmaster/src/`
 * ----------------------------------------------------------
 * A theme app extension may only contain `assets`, `blocks`, `snippets` and `locales`.
 * The source lived in a `src/` folder inside the extension for exactly one deploy, and the
 * CLI dutifully bundled it — which makes `shopify app deploy` fail validation, so no new
 * version is created and the storefront silently carries on serving the previous release.
 * That failure mode is quiet and easy to misread as "the deploy worked but nothing
 * changed", so: the source stays outside the extension directory.
 *
 * Comment stripping only
 * ----------------------
 * Deliberately not a minifier. Renaming identifiers and rewriting control flow would mean
 * the deployed widget no longer corresponds line-for-line to anything readable, and when a
 * merchant reports "the carousel jumps on iOS" a stack trace pointing at `a.b(c)` is worth
 * nothing. Comments are ~5KB compressed here; removing just those is enough.
 *
 * The scanner tracks string, template and regex literal state rather than running a naive
 * regex over the file. A `//` inside a URL string, or a `/` that starts a regex literal,
 * would otherwise silently corrupt the output — the kind of bug that ships green and
 * breaks a shopper's product page.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SRC = join(root, 'extension-src/reviewmaster.js');
const OUT = join(root, 'extensions/reviewmaster/assets/reviewmaster.js');
const THRESHOLD = 10_000;

/** Characters after which a `/` starts a regex literal rather than a division. */
const REGEX_PRECEDERS = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '\n', '+', '-', '*', '%', '<', '>', '~', '^',
]);

function lastMeaningful(out) {
  for (let i = out.length - 1; i >= 0; i--) {
    const c = out[i];
    if (c !== ' ' && c !== '\t' && c !== '\r') return c;
  }
  return '\n';
}

function stripComments(src) {
  let out = '';
  let i = 0;

  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];

    // Line comment
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }

    // Block comment. Newlines inside it are preserved so line numbers in a stack trace
    // still land near the right place in the source file.
    if (c === '/' && next === '*') {
      i += 2;
      let newlines = '';
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') newlines += '\n';
        i++;
      }
      i += 2;
      out += newlines;
      continue;
    }

    // String literal
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Regex literal, distinguished from division by what precedes it.
    if (c === '/' && REGEX_PRECEDERS.has(lastMeaningful(out))) {
      out += c;
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        out += src[i];
        if (src[i] === '/' && !inClass) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    out += c;
    i++;
  }

  // Collapse the blank lines the comments left behind.
  return out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, '');
}

if (!existsSync(SRC)) {
  // Exit 0, not 1.
  //
  // `.dockerignore` excludes `scripts/` and `tests/` from the Azure image, so if this ever
  // gets wired into `npm run build` again it would run inside a container where the source
  // tree is not present — and a hard failure there would break the deploy over an asset
  // the container does not even serve. The theme extension ships through
  // `shopify app deploy`, never through Docker.
  console.warn(`[build-extension] source not found, skipping: ${SRC}`);
  process.exit(0);
}

const source = readFileSync(SRC, 'utf8');
let built = stripComments(source);

/**
 * Minify, if a minifier happens to be available.
 *
 * `@swc/core` ships as a transitive dependency of Next, so it is usually there — but it is
 * a native binary and it is nobody's declared dependency, so this must never be required
 * for a successful build. If it will not load, the comment-stripped output ships instead;
 * that is what was shipping before, and it works.
 *
 * The output is parse-checked with `new Function` before it is accepted. `new Function`
 * compiles without executing, so a mangling bug that produced invalid syntax gets caught
 * here rather than on a shopper's product page — where the failure mode is a review widget
 * that renders nothing and reports nothing.
 */
async function tryMinify(code) {
  let swc;
  try {
    swc = await import('@swc/core');
  } catch {
    return { code, applied: false, reason: '@swc/core not available' };
  }

  try {
    const result = await swc.minify(code, {
      compress: { defaults: true, drop_console: false },
      mangle: true,
      // The widget is deliberately ES5 — it runs on whatever a merchant's shoppers use,
      // and a theme app extension has no transpile step behind it.
      ecma: 5,
      format: { comments: false },
    });

    if (!result?.code) return { code, applied: false, reason: 'minifier returned nothing' };

    try {
      new Function(result.code);
    } catch (err) {
      return { code, applied: false, reason: `output failed to parse: ${err.message}` };
    }

    // Refuse a "minified" result that is not actually smaller. Cheap insurance against a
    // future options change that silently makes things worse.
    if (result.code.length >= code.length) {
      return { code, applied: false, reason: 'no size reduction' };
    }

    return { code: result.code, applied: true };
  } catch (err) {
    return { code, applied: false, reason: err.message };
  }
}

const strippedBytes = built.length;
const min = await tryMinify(built);
built = min.code;

const banner =
  '/* ReviewMaster storefront widget. Generated from extension-src/reviewmaster.js\n' +
  '   by scripts/build-extension.mjs — edit the source, not this file. */\n';

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, banner + built);

const total = (banner + built).length;
const gz = gzipSync(Buffer.from(banner + built)).length;

console.log(
  `[build-extension] reviewmaster.js  ${total} bytes raw, ${gz} gzipped` +
    (min.applied
      ? `  (minified from ${strippedBytes})`
      : `  (not minified — ${min.reason})`)
);

if (total > THRESHOLD) {
  // Shopify's AssetSizeAppBlockJavaScript check measures the file on disk, not the
  // compressed size, despite what the docs imply. It is severity `suggestion` and does not
  // block a release today — the CLI prints it as an error and publishes anyway — but it is
  // a real number on the pages Shopify scores hardest, so it should never pass silently.
  console.warn(
    `[build-extension] over Shopify's ${THRESHOLD}-byte suggestion by ${total - THRESHOLD} bytes. ` +
      `Not release-blocking today; revisit if the App Store pre-submission check hardens.`
  );
}
