/**
 * Minimal .xlsx reader and writer, with no dependencies.
 *
 * An .xlsx file is a zip of XML parts. Reading one needs a zip walker, an inflater and a
 * tolerant parse of three parts (shared strings, styles, a worksheet); writing one needs
 * the reverse. Node ships the inflater (zlib) and nothing else, and this project
 * deliberately avoids new packages — the Docker build resolves dependencies loosely and
 * every package added is one more thing that can break a deploy. SheetJS would also bring
 * ~1 MB into a server route that reads a header row and some text cells.
 *
 * Reading handles what spreadsheets actually emit: shared strings (`t="s"`), inline
 * strings (`t="inlineStr"`, which is what Google Sheets and the merchant's own template
 * produce), rich-text runs, booleans, formula cells (their cached value is used), and
 * dates — which Excel stores as a serial number distinguished only by the cell's number
 * format, so the styles part is read to tell `46303` the number from `46303` the
 * 8 October 2026. Everything comes back as strings, the shape the CSV parser produces,
 * so the importer does not care which it was given.
 *
 * Reading is also bounded, because any installed store can upload a file and the parse
 * runs synchronously on the one Node process that serves every merchant's storefront.
 * The XML is walked forward once with indexOf, never with a lazy regex (which rescans to
 * the end of the part for every unclosed tag); the zip is indexed without inflating, and
 * only the parts a read needs are inflated, under a per-part and a per-file byte budget;
 * and a sheet's width and cell count are capped. A crafted file gets an XlsxError in
 * milliseconds instead of holding the event loop for hours or exhausting the heap.
 *
 * Writing emits inline strings, one bold header style, column widths, a frozen header
 * row, formulas (recalculated on open) and list data validations — enough for a template
 * with a product dropdown. Excel, Google Sheets, Numbers and LibreOffice all open it.
 *
 * Deliberately not supported: .xls (a different binary format), ZIP64 archives (an
 * .xlsx over 4 GB), encrypted workbooks, and the 1904 date system on write.
 */

import zlib from 'node:zlib';

export class XlsxError extends Error {}

/** Inflated size cap per zip part — a 10 MB upload that inflates past this is a zip bomb. */
const MAX_PART_BYTES = 64 * 1024 * 1024;

/**
 * Inflated size cap across every part one parse reads. The per-part cap alone did not
 * bound a file: several entries pointing at one ~60 KB deflate stream each inflated to
 * 64 MB, and a 62 KB upload held 750 MB. An import reads five parts (workbook, its
 * relationships, shared strings, styles, one worksheet), which for 50,000 real reviews
 * come to well under half of this.
 */
const MAX_TOTAL_BYTES = 96 * 1024 * 1024;

/**
 * Zip entries a workbook may have. A real one has a dozen, a few hundred with many sheets
 * and images. The zip format allows 65,535, and the central directory is walked in full.
 */
const MAX_ENTRIES = 1000;

/** Columns in Excel's widest sheet (A to XFD). A reference past XFD is not a spreadsheet's. */
const MAX_COLUMN = 16_384;

/**
 * Cells kept per row. The importer maps about a dozen fields and other review apps'
 * exports run to 40 or so columns; 256 (column IV, the whole of an Excel 2003 sheet) is
 * far past either. A cell further right is dropped rather than padded up to: one cell at
 * column AAAAAA made every row twelve million cells wide.
 */
const MAX_COLS = 256;

/**
 * Cells one sheet may produce, blanks a row is padded with included. 50,000 rows of the
 * twelve-column template are 600,000. Without this, 50,000 one-cell rows each placed at
 * the last allowed column would still be a 12.8-million-slot table.
 */
const MAX_CELLS = 4_000_000;

/**
 * Cell formats and number formats read from the styles part. Excel's own limit is about
 * 64,000 cell formats per workbook; a styles part listing millions is not from Excel.
 */
const MAX_STYLES = 65_536;

const TOO_BIG = 'This .xlsx file holds more than an import can read at once. Split the reviews across smaller files and upload them one at a time.';
const DAMAGED = 'This .xlsx file is damaged.';

// ── Zip reading ──────────────────────────────────────────────────────────────────────

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** `PK\x03\x04` — the first four bytes of every .xlsx (and every other zip). */
export function isXlsx(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

interface ZipEntry {
  method: number;
  /** Where this entry's compressed bytes start in the file, and how many there are. */
  start: number;
  size: number;
}

interface ZipReader {
  has(name: string): boolean;
  /** One part as text, inflated now and charged to the file's byte budget. */
  read(name: string): string | undefined;
}

/**
 * Index a zip's central directory without inflating anything.
 *
 * The old reader inflated every entry up front and kept them all, so the cost of a file
 * was set by its entry count, not by what the import used. Now a part is inflated only
 * when asked for, and every inflate is charged to one running budget.
 */
function openZip(buf: Buffer): ZipReader {
  // The end-of-central-directory record is at the tail, followed only by an optional
  // comment of up to 64 KB. Scan back for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('This is not a valid .xlsx file.');

  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff) throw new XlsxError('ZIP64 workbooks are not supported.');
  if (count > MAX_ENTRIES) {
    throw new XlsxError('This .xlsx file has far more parts than a spreadsheet does. Open it in Excel or Google Sheets, save it again as .xlsx, and upload that.');
  }

  const entries = new Map<string, ZipEntry>();
  const localOffsets = new Set<number>();
  /** [local header, end of compressed data) per entry, checked for overlap below. */
  const ranges: Array<[number, number]> = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) throw new XlsxError(DAMAGED);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    // Every entry has its own local header. Two sharing one is how a small file is made
    // to inflate the same stream over and over; no zip tool writes that.
    if (localOffsets.has(localOffset)) throw new XlsxError(DAMAGED);
    localOffsets.add(localOffset);

    if (name.endsWith('/')) continue; // directory entry
    // The declared size can lie, which is why inflating is capped too. When it does not
    // lie, an oversized part is refused here, before any work is spent on it.
    if (usize > MAX_PART_BYTES) throw new XlsxError(TOO_BIG);
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new XlsxError(DAMAGED);
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    if (start + csize > buf.length) throw new XlsxError(DAMAGED);
    entries.set(name.replace(/^\/+/, ''), { method, start, size: csize });
    ranges.push([localOffset, start + csize]);
  }

  // No two entries may share bytes. Distinct local headers are not enough: each header can
  // carry an extra field sized to land every entry's data on ONE deflate stream — say
  // 9 MB of empty blocks that inflate to nothing, so the byte budget never moves while the
  // same 9 MB is inflated a thousand times. Real zips lay entries end to end; with no
  // overlap, everything inflated together is bounded by the size of the upload itself.
  ranges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i][0] < ranges[i - 1][1]) throw new XlsxError(DAMAGED);
  }

  let budget = MAX_TOTAL_BYTES;
  return {
    has: (name) => entries.has(name),
    read(name) {
      const entry = entries.get(name);
      if (!entry) return undefined;
      const raw = buf.subarray(entry.start, entry.start + entry.size);
      const limit = Math.min(MAX_PART_BYTES, budget);
      let data: Buffer;
      if (entry.method === 0) {
        if (raw.length > limit) throw new XlsxError(TOO_BIG);
        data = raw;
      } else if (entry.method === 8) {
        if (limit < 1) throw new XlsxError(TOO_BIG);
        try {
          data = zlib.inflateRawSync(raw, { maxOutputLength: limit });
        } catch (err) {
          throw new XlsxError(
            (err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' ? TOO_BIG : 'This .xlsx file could not be decompressed.'
          );
        }
      } else {
        throw new XlsxError('This .xlsx file uses an unsupported compression.');
      }
      budget -= data.length;
      return data.toString('utf8');
    },
  };
}

// ── XML scanning ─────────────────────────────────────────────────────────────────────
//
// Every walk over a part moves forward only, and stops at the first tag it cannot
// close. The lazy regexes these replaced (/<row\b([^>]*)>([\s\S]*?)<\/row>/g and the like)
// rescanned to the end of the part for each opening tag that had no closing tag: a sheet
// of nothing but `<row>` took 8 s at 400 KB and quadrupled with every doubling, and it
// compresses several hundred to one, so a 96 KB upload would have held the event loop
// for about two days. Each part is now one pass, however it is malformed. The regexes
// that remain run on attribute values and cell text, where every match is local.

/**
 * The index of the next `<tag` at or after `from` that really is that element, not a
 * longer name with the same start (`<c` is not `<cols>`, `<row` is not `<rowBreaks>`).
 */
function findTag(xml: string, tag: string, from: number): number {
  const open = '<' + tag;
  let i = xml.indexOf(open, from);
  while (i >= 0) {
    const c = xml.charCodeAt(i + open.length);
    // The name ends at '>', '/' or whitespace.
    if (c === 62 || c === 47 || c === 32 || c === 9 || c === 10 || c === 13) return i;
    i = xml.indexOf(open, i + open.length);
  }
  return -1;
}

/**
 * Calls `fn(attrs, inner)` for each `<tag …>inner</tag>` in order; a self-closing
 * `<tag …/>` arrives with inner ''. Stops when `fn` returns false, or at the first element
 * with no `>` or no closing tag — everything after an unclosed element is inside it.
 */
function eachElement(xml: string, tag: string, fn: (attrs: string, inner: string) => boolean | void): void {
  const close = `</${tag}>`;
  const nameEnd = tag.length + 1;
  let pos = 0;
  for (;;) {
    const open = findTag(xml, tag, pos);
    if (open < 0) return;
    const gt = xml.indexOf('>', open);
    if (gt < 0) return;
    let keepGoing: boolean | void;
    if (xml.charCodeAt(gt - 1) === 47 /* / */) {
      pos = gt + 1;
      keepGoing = fn(xml.slice(open + nameEnd, gt - 1), '');
    } else {
      const end = xml.indexOf(close, gt + 1);
      if (end < 0) return;
      pos = end + close.length;
      keepGoing = fn(xml.slice(open + nameEnd, gt), xml.slice(gt + 1, end));
    }
    if (keepGoing === false) return;
  }
}

/**
 * Calls `fn(attrs)` for each `<tag …>` opening tag in order, for elements read by their
 * attributes alone. Stops when `fn` returns false or at a tag with no `>`.
 */
function eachTag(xml: string, tag: string, fn: (attrs: string) => boolean | void): void {
  const nameEnd = tag.length + 1;
  let pos = 0;
  for (;;) {
    const open = findTag(xml, tag, pos);
    if (open < 0) return;
    const gt = xml.indexOf('>', open);
    if (gt < 0) return;
    pos = gt + 1;
    if (fn(xml.slice(open + nameEnd, xml.charCodeAt(gt - 1) === 47 ? gt - 1 : gt)) === false) return;
  }
}

/** The text between the first `<tag>` and the `</tag>` after it, or '' (for `<v>`, which has no attributes). */
function firstInner(xml: string, tag: string): string {
  const open = xml.indexOf(`<${tag}>`);
  if (open < 0) return '';
  const start = open + tag.length + 2;
  const end = xml.indexOf(`</${tag}>`, start);
  return end < 0 ? '' : xml.slice(start, end);
}

/**
 * Excel's own ceiling on one cell's text. Nothing longer can have come from a spreadsheet,
 * and the importer keeps at most 5,000 characters of a review anyway.
 */
const MAX_CELL_CHARS = 32_767;

/**
 * Decode XML entities, stopping once `max` characters have been produced.
 *
 * A forward scan that appends slices. `String.replace` with a callback was linear in time
 * but not in memory — V8 collects every match before replacing — and a cell's text can be
 * a whole 64 MB part of `&amp;`. The cap means a hostile cell costs at most `max` output
 * characters however large it is.
 */
function decodeXml(s: string, max = MAX_CELL_CHARS): string {
  if (s.indexOf('&') < 0) return s.length > max ? s.slice(0, max) : s;
  let out = '';
  let pos = 0;
  while (pos < s.length && out.length < max) {
    const amp = s.indexOf('&', pos);
    if (amp < 0) {
      out += s.slice(pos);
      break;
    }
    out += s.slice(pos, amp);
    const semi = s.indexOf(';', amp);
    // Entities are short; a ';' further than 12 characters away is not ending this one.
    if (semi < 0 || semi - amp > 12) {
      out += '&';
      pos = amp + 1;
      continue;
    }
    const e = s.slice(amp + 1, semi);
    let ch: string | null = null;
    if (e === 'amp') ch = '&';
    else if (e === 'lt') ch = '<';
    else if (e === 'gt') ch = '>';
    else if (e === 'quot') ch = '"';
    else if (e === 'apos') ch = "'";
    else if (e[0] === '#') {
      const hex = e[1] === 'x' || e[1] === 'X';
      const digits = hex ? e.slice(2) : e.slice(1);
      if (digits && (hex ? /^[0-9a-fA-F]+$/ : /^\d+$/).test(digits)) {
        const code = parseInt(digits, hex ? 16 : 10);
        // fromCodePoint throws past U+10FFFF, and "&#99999999;" is one keystroke away.
        ch = code <= 0x10ffff ? String.fromCodePoint(code) : '';
      }
    }
    if (ch === null) {
      out += '&'; // not an entity we know: keep the text as written
      pos = amp + 1;
    } else {
      out += ch;
      pos = semi + 1;
    }
  }
  return out.length > max ? out.slice(0, max) : out;
}

/** Attribute values are short in every real part — formatCode, the longest, is 255. */
const MAX_ATTR_CHARS = 4096;

/**
 * One attribute's value from a tag's attribute text. indexOf, not a regex built per call:
 * this runs three times for every cell of a 50,000-row sheet.
 */
function attr(attrs: string, name: string): string | undefined {
  const needle = `${name}="`;
  let i = attrs.indexOf(needle);
  while (i >= 0) {
    // A whole attribute name, not the tail of a longer one (`r=` inside `ref=`).
    const before = i === 0 ? 32 : attrs.charCodeAt(i - 1);
    if (before === 32 || before === 9 || before === 10 || before === 13) {
      const start = i + needle.length;
      const end = attrs.indexOf('"', start);
      if (end < 0) return undefined;
      return decodeXml(attrs.slice(start, Math.min(end, start + MAX_ATTR_CHARS * 8)), MAX_ATTR_CHARS);
    }
    i = attrs.indexOf(needle, i + needle.length);
  }
  return undefined;
}

/** The text of every `<t>` in a run of rich text, phonetic guides dropped. */
function textOf(inner: string): string {
  if (!inner) return '';
  let text = inner;
  if (inner.includes('<rPh')) {
    // Phonetic guides (furigana over Japanese text) carry a <t> of their own that is a
    // reading aid, not part of the cell's text.
    let kept = '';
    let pos = 0;
    for (;;) {
      const open = findTag(inner, 'rPh', pos);
      if (open < 0) break;
      const gt = inner.indexOf('>', open);
      if (gt < 0) break;
      let next = gt + 1; // after a self-closing <rPh/>
      if (inner.charCodeAt(gt - 1) !== 47) {
        const end = inner.indexOf('</rPh>', gt);
        if (end < 0) break;
        next = end + 6;
      }
      kept += inner.slice(pos, open);
      pos = next;
    }
    text = kept + inner.slice(pos);
  }
  // Rich text is many runs; the cell's total is what Excel caps, so the budget is shared.
  let out = '';
  eachElement(text, 't', (_, t) => {
    out += decodeXml(t, MAX_CELL_CHARS - out.length);
    return out.length < MAX_CELL_CHARS; // full: stop walking the runs
  });
  return out;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  // A self-closing <si/> is an empty string, and it still takes its index.
  eachElement(xml, 'si', (_, inner) => {
    // A sheet can use at most MAX_CELLS of them, so a table longer than that is not
    // something an import can need.
    if (out.length >= MAX_CELLS) throw new XlsxError(TOO_BIG);
    out.push(textOf(inner));
  });
  return out;
}

// ── Dates ────────────────────────────────────────────────────────────────────────────

/** Excel's built-in date and time number formats (ids are fixed by the spec). */
const BUILTIN_DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51,
  52, 53, 54, 55, 56, 57, 58,
]);

function isDateFormat(code: string): boolean {
  // Strip quoted literals, bracketed locale/colour codes and escaped characters, then
  // look for a date or time token. "General", "0.00" and '#,##0 "USD"' have none.
  // The bracket pattern stops at the next '[' as well as ']', so a code of nothing but
  // '[' is one pass rather than one pass per bracket.
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^[\]]*\]/g, '').replace(/\\./g, '');
  return /[ymdhs]/i.test(bare) && !/[#0?]/.test(bare.replace(/[ymdhs:\-/ .,]/gi, ''));
}

/** cellXfs index → is it a date style. Read once per workbook. */
function parseDateStyles(xml: string | undefined): Set<number> {
  const dates = new Set<number>();
  if (!xml) return dates;

  const custom = new Map<number, string>();
  eachTag(xml, 'numFmt', (a) => {
    const id = Number(attr(a, 'numFmtId'));
    const code = attr(a, 'formatCode');
    if (Number.isFinite(id) && code !== undefined) custom.set(id, code);
    return custom.size < MAX_STYLES;
  });

  // Only <cellXfs>: <cellStyleXfs> holds <xf> elements too, and a cell's s="" does not
  // index those.
  let xfs = '';
  eachElement(xml, 'cellXfs', (_, inner) => {
    xfs = inner;
    return false;
  });
  // Decided once per format, not once per style that uses it.
  const verdicts = new Map<number, boolean>();
  let index = 0;
  eachTag(xfs, 'xf', (a) => {
    const id = Number(attr(a, 'numFmtId') ?? 0);
    let isDate = verdicts.get(id);
    if (isDate === undefined) {
      const code = custom.get(id);
      isDate = BUILTIN_DATE_FORMATS.has(id) || (code !== undefined && isDateFormat(code));
      verdicts.set(id, isDate);
    }
    if (isDate) dates.add(index);
    index++;
    // Styles past the cap read as not-a-date: their numbers come through as numbers.
    return index < MAX_STYLES;
  });
  return dates;
}

/**
 * Excel serial → ISO date. Serial 1 is 1 January 1900 in the 1900 system, counted from an
 * epoch of 30 December 1899 so that Excel's deliberate "1900 was a leap year" bug lines up
 * for every date after February 1900. A fractional part is a time of day.
 */
function serialToIso(n: number, date1904: boolean): string | null {
  if (!Number.isFinite(n) || n < 1) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(Math.round(epoch + n * 86_400_000));
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  return n % 1 > 1e-9 ? iso.slice(0, 19) : iso.slice(0, 10);
}

// ── Worksheets ───────────────────────────────────────────────────────────────────────

/**
 * Zero-based column of an A1 reference, -1 when it has no letters. Past XFD it returns
 * MAX_COLUMN rather than keep multiplying: "AAAAAAAAAAAA1" is not a column, and a ref of
 * a thousand letters would otherwise come out as Infinity.
 */
function columnIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
    if (n > MAX_COLUMN) return MAX_COLUMN;
  }
  return n - 1;
}

export interface XlsxSheet {
  name: string;
  /** Every non-empty row, cells as strings, trailing empty cells trimmed. */
  rows: string[][];
}

function cellValue(a: string, inner: string, shared: string[], dateStyles: Set<number>, date1904: boolean): string {
  // A value lives in a child (<v> or <is>), so a cell with none is blank whatever its
  // type says. Excel writes one of these for every styled empty cell.
  if (!inner) return '';
  const t = attr(a, 't');
  if (t === 'inlineStr') return textOf(inner);
  const v = firstInner(inner, 'v');
  if (t === 's') return v === '' ? '' : shared[Number(v)] ?? '';
  if (t === 'b') return v === '1' ? 'true' : 'false';
  if (t === 'e') return '';
  if (t === 'str') return decodeXml(v);
  if (v === '') return '';
  // A number. Dates are numbers wearing a date format; large ids may arrive in exponent
  // notation, which Number() normalises back to digits.
  const s = Number(attr(a, 's') ?? 0);
  return (dateStyles.has(s) && serialToIso(Number(v), date1904)) || (/e/i.test(v) ? String(Number(v)) : v);
}

function parseSheet(
  xml: string,
  shared: string[],
  dateStyles: Set<number>,
  date1904: boolean,
  maxRows: number
): string[][] {
  const rows: string[][] = [];
  let cellCount = 0;

  eachElement(xml, 'row', (_, rowXml) => {
    const cells: string[] = [];
    let col = 0;
    eachElement(rowXml, 'c', (a, inner) => {
      const ref = attr(a, 'r');
      if (ref) col = Math.max(col, columnIndex(ref));
      // Cells come in column order, so once one is past the cap the rest of the row is too.
      if (col >= MAX_COLS) return false;
      const value = cellValue(a, inner, shared, dateStyles, date1904);
      // Only a value is stored, with blanks padded up to it. A row therefore never ends
      // in a blank, and a row of styled empty cells costs nothing.
      if (value !== '') {
        while (cells.length < col) cells.push('');
        cells[col] = value;
      }
      col++;
    });
    if (!cells.length) return;
    cellCount += cells.length;
    if (cellCount > MAX_CELLS) {
      throw new XlsxError('This sheet has more cells than an import can read. Delete the columns you do not need, or split the rows across smaller files.');
    }
    rows.push(cells);
    if (rows.length >= maxRows) return false;
  });
  return rows;
}

export interface ParseXlsxOptions {
  /**
   * Stop each sheet after this many non-empty rows. The importer has its own row ceiling
   * and nothing is gained by parsing past it.
   */
  maxRows?: number;
  /**
   * 'all' (the default): every sheet, in tab order.
   *
   * 'reviews': only the sheet an import reads, chosen before any worksheet is inflated —
   * the one whose name says Review, else the first not named for products that has rows,
   * else the first. The template's Reviews sheet sits next to a Products sheet of up to
   * 5,000 rows, and a crafted workbook can point any number of tabs at one large part;
   * neither is read when it is not the one being imported.
   */
  sheet?: 'all' | 'reviews';
}

/** Sheets as rows of strings: every sheet, or with `sheet: 'reviews'` at most the one an import reads. */
export function parseXlsx(input: Uint8Array | ArrayBuffer, opts: ParseXlsxOptions = {}): XlsxSheet[] {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input);
  const zip = openZip(buf);
  const workbook = zip.read('xl/workbook.xml');
  if (!workbook) throw new XlsxError('This file has no workbook — it is not an Excel .xlsx file.');

  let date1904: boolean | undefined;
  eachTag(workbook, 'workbookPr', (a) => {
    if (date1904 !== undefined) return;
    const v = attr(a, 'date1904');
    date1904 = v === '1' || v === 'true';
  });

  // Sheet tab → relationship id → worksheet part.
  const rels = new Map<string, string>();
  eachTag(zip.read('xl/_rels/workbook.xml.rels') ?? '', 'Relationship', (a) => {
    const id = attr(a, 'Id');
    const target = attr(a, 'Target');
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  });

  const tabs: Array<{ name: string; path: string }> = [];
  let fallback = 1;
  eachTag(workbook, 'sheet', (a) => {
    const name = attr(a, 'name') ?? `Sheet${fallback}`;
    const rid = attr(a, 'r:id');
    const path = (rid && rels.get(rid)) || `xl/worksheets/sheet${fallback}.xml`;
    fallback++;
    // A tab whose part is missing is not a sheet anyone can see.
    if (zip.has(path)) tabs.push({ name, path });
  });

  const shared = parseSharedStrings(zip.read('xl/sharedStrings.xml'));
  const dateStyles = parseDateStyles(zip.read('xl/styles.xml'));
  const maxRows = opts.maxRows ?? 1_000_000;

  // Each worksheet part is read at most once, however many tabs point at it.
  const done = new Set<string>();
  const parse = (tab: { name: string; path: string }): XlsxSheet => {
    done.add(tab.path);
    return { name: tab.name, rows: parseSheet(zip.read(tab.path) ?? '', shared, dateStyles, date1904 === true, maxRows) };
  };

  if (opts.sheet === 'reviews') {
    const named = tabs.find((t) => /review/i.test(t.name));
    if (named) return [parse(named)];
    for (const tab of tabs) {
      if (/product/i.test(tab.name) || done.has(tab.path)) continue;
      const sheet = parse(tab);
      if (sheet.rows.length) return [sheet];
    }
    if (!tabs.length) return [];
    // Every candidate was empty. The first tab, then — already known to be empty if it
    // was one of them.
    return [done.has(tabs[0].path) ? { name: tabs[0].name, rows: [] } : parse(tabs[0])];
  }

  const sheets: XlsxSheet[] = [];
  for (const tab of tabs) {
    if (!done.has(tab.path)) sheets.push(parse(tab));
  }
  return sheets;
}

/**
 * A sheet as the importer wants it: the first non-empty row is the header, every later
 * row is keyed by it. Blank header cells get a placeholder name so a stray column cannot
 * collide with a real one.
 */
export function sheetToTable(sheet: XlsxSheet): { headers: string[]; rows: Array<Record<string, string>> } {
  if (!sheet.rows.length) return { headers: [], rows: [] };
  const headers = sheet.rows[0].slice(0, MAX_COLS).map((h, i) => h.trim() || `column_${i + 1}`);
  // Every row becomes an object with a key per header, however short the row itself is,
  // so the header's width multiplies the row count here.
  if (headers.length * (sheet.rows.length - 1) > MAX_CELLS) {
    throw new XlsxError('This sheet has more cells than an import can read. Delete the columns you do not need, or split the rows across smaller files.');
  }
  const rows = sheet.rows.slice(1).map((r) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = r[i] ?? '';
    });
    return row;
  });
  return { headers, rows };
}

// ── Writing ──────────────────────────────────────────────────────────────────────────

export type XlsxCell = string | number | boolean | null | undefined | { formula: string };

export interface XlsxValidation {
  /** A1-style range, e.g. "A2:A5001". */
  range: string;
  /** Either a fixed list of choices or a range formula such as `Products!$A$2:$A$100`. */
  list?: string[];
  formula?: string;
}

export interface XlsxWriteSheet {
  name: string;
  rows: XlsxCell[][];
  /** Character widths per column, left to right. */
  columnWidths?: number[];
  /** Bold the first row and keep it on screen while scrolling. */
  header?: boolean;
  validations?: XlsxValidation[];
}

function escapeXml(s: string): string {
  // Control characters other than tab, newline and return are illegal in XML 1.0.
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnLetters(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXml(ref: string, value: XlsxCell, style: number): string {
  const s = style ? ` s="${style}"` : '';
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : '';
  }
  if (typeof value === 'boolean') return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
  if (typeof value === 'object') return `<c r="${ref}"${s}><f>${escapeXml(value.formula)}</f></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(sheet: XlsxWriteSheet): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
  ];
  if (sheet.header) {
    out.push(
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    );
  }
  if (sheet.columnWidths?.length) {
    out.push('<cols>');
    sheet.columnWidths.forEach((w, i) => {
      out.push(`<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`);
    });
    out.push('</cols>');
  }
  out.push('<sheetData>');
  sheet.rows.forEach((row, r) => {
    const cells = row.map((v, c) => cellXml(`${columnLetters(c)}${r + 1}`, v, sheet.header && r === 0 ? 1 : 0)).join('');
    if (cells) out.push(`<row r="${r + 1}">${cells}</row>`);
  });
  out.push('</sheetData>');
  if (sheet.validations?.length) {
    out.push(`<dataValidations count="${sheet.validations.length}">`);
    for (const v of sheet.validations) {
      const formula = v.list ? `"${v.list.join(',')}"` : v.formula ?? '';
      out.push(
        `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" sqref="${escapeXml(v.range)}"><formula1>${escapeXml(formula)}</formula1></dataValidation>`
      );
    }
    out.push('</dataValidations>');
  }
  out.push('</worksheet>');
  return out.join('');
}

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** Build a workbook. Sheet names are capped at Excel's 31 characters and its forbidden set. */
export function buildXlsx(sheets: XlsxWriteSheet[]): Buffer {
  if (!sheets.length) throw new XlsxError('A workbook needs at least one sheet.');
  const names = sheets.map((s, i) => (s.name.replace(/[\\/?*[\]:]/g, ' ').trim() || `Sheet${i + 1}`).slice(0, 31));

  const files: Array<{ name: string; data: Buffer }> = [];
  files.push({
    name: '[Content_Types].xml',
    data: Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join('') +
        '</Types>'
    ),
  });
  files.push({
    name: '_rels/.rels',
    data: Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    ),
  });
  files.push({
    name: 'xl/workbook.xml',
    data: Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' +
        names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets>' +
        // Formulas are written without cached values; this makes Excel compute them on open.
        '<calcPr fullCalcOnLoad="1"/>' +
        '</workbook>'
    ),
  });
  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        names
          .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
          .join('') +
        `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>'
    ),
  });
  files.push({ name: 'xl/styles.xml', data: Buffer.from(STYLES_XML) });
  sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from(sheetXml(s)) }));

  return buildZip(files);
}

// ── Zip writing ──────────────────────────────────────────────────────────────────────

// Node 22.2 added zlib.crc32; the production image runs Node 20. The table is 1 KB.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function buildZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  // A fixed timestamp: the bytes of a template should not change between two downloads
  // of the same catalogue. 1 January 2026, 00:00 in DOS encoding.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const comp = zlib.deflateRawSync(f.data);
    const crc = crc32(f.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(SIG_CENTRAL, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(f.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);

    offset += local.length + name.length + comp.length;
  }

  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, ...central, eocd]);
}
