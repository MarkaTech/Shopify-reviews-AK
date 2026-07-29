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
 * trades a permanent cost for a temporary one. So the comments live in
 * `extensions/reviewmaster/src/` and the asset Shopify serves is generated from it.
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
const SRC = join(root, 'extensions/reviewmaster/src/reviewmaster.js');
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
const built = stripComments(source);

const banner =
  '/* ReviewMaster storefront widget. Generated from extensions/reviewmaster/src/reviewmaster.js\n' +
  '   by scripts/build-extension.mjs — edit the source, not this file. */\n';

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, banner + built);

const gz = gzipSync(Buffer.from(banner + built)).length;
const pct = Math.round((gz / THRESHOLD) * 100);

console.log(
  `[build-extension] reviewmaster.js  ${built.length} bytes raw, ${gz} gzipped (${pct}% of Shopify's ${THRESHOLD}-byte suggestion)`
);

if (gz > THRESHOLD) {
  // A warning, not a failure: the check is `severity: suggestion` on Shopify's side and a
  // hard exit here would block a deploy over a soft limit. But it must be loud, because
  // the whole point of this script is to notice.
  console.warn(
    `[build-extension] WARNING: over the ${THRESHOLD}-byte suggested limit by ${gz - THRESHOLD} bytes.`
  );
}
