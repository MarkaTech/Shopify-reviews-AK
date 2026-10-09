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

// ── Zip reading ──────────────────────────────────────────────────────────────────────

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** `PK\x03\x04` — the first four bytes of every .xlsx (and every other zip). */
export function isXlsx(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function readZip(buf: Buffer): Map<string, Buffer> {
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

  const entries = new Map<string, Buffer>();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw new XlsxError('This .xlsx file is damaged.');
    }
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // directory entry
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new XlsxError('This .xlsx file is damaged.');
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const raw = buf.subarray(start, start + csize);

    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(raw);
    } else if (method === 8) {
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: MAX_PART_BYTES });
      } catch {
        throw new XlsxError('This .xlsx file could not be decompressed.');
      }
    } else {
      throw new XlsxError('This .xlsx file uses an unsupported compression.');
    }
    entries.set(name.replace(/^\/+/, ''), data);
  }
  return entries;
}

// ── XML helpers ──────────────────────────────────────────────────────────────────────

function decodeXml(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : '';
  });
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? decodeXml(m[1]) : undefined;
}

/** The text of every `<t>` in a run of rich text, phonetic guides dropped. */
function textOf(inner: string): string {
  const cleaned = inner.includes('<rPh') ? inner.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '') : inner;
  const parts: string[] = [];
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned))) parts.push(decodeXml(m[1]));
  return parts.join('');
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(textOf(m[1]));
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
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[ymdhs]/i.test(bare) && !/[#0?]/.test(bare.replace(/[ymdhs:\-/ .,]/gi, ''));
}

/** cellXfs index → is it a date style. Read once per workbook. */
function parseDateStyles(xml: string | undefined): Set<number> {
  const dates = new Set<number>();
  if (!xml) return dates;

  const custom = new Map<number, string>();
  const nf = /<numFmt\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = nf.exec(xml))) {
    const id = Number(attr(m[1], 'numFmtId'));
    const code = attr(m[1], 'formatCode');
    if (Number.isFinite(id) && code !== undefined) custom.set(id, code);
  }

  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  const xf = /<xf\b([^>]*)\/?>/g;
  let index = 0;
  while ((m = xf.exec(xfs))) {
    const id = Number(attr(m[1], 'numFmtId') ?? 0);
    const code = custom.get(id);
    if (BUILTIN_DATE_FORMATS.has(id) || (code !== undefined && isDateFormat(code))) dates.add(index);
    index++;
  }
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

function columnIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

export interface XlsxSheet {
  name: string;
  /** Every non-empty row, cells as strings, trailing empty cells trimmed. */
  rows: string[][];
}

function parseSheet(
  xml: string,
  shared: string[],
  dateStyles: Set<number>,
  date1904: boolean,
  maxRows: number
): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let rm: RegExpExecArray | null;

  while ((rm = rowRe.exec(xml))) {
    const cells: string[] = [];
    let col = 0;
    let cm: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(rm[2]))) {
      const a = cm[1];
      const inner = cm[2] ?? '';
      const ref = attr(a, 'r');
      if (ref) col = Math.max(col, columnIndex(ref));
      const t = attr(a, 't');
      let value = '';
      if (t === 'inlineStr') {
        value = textOf(inner);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
        if (t === 's') value = shared[Number(v)] ?? '';
        else if (t === 'b') value = v === '1' ? 'true' : 'false';
        else if (t === 'e') value = '';
        else if (t === 'str') value = decodeXml(v);
        else if (v !== '') {
          // A number. Dates are numbers wearing a date format; large ids may arrive in
          // exponent notation, which Number() normalises back to digits.
          const s = Number(attr(a, 's') ?? 0);
          value = (dateStyles.has(s) && serialToIso(Number(v), date1904)) || (/e/i.test(v) ? String(Number(v)) : v);
        }
      }
      while (cells.length < col) cells.push('');
      cells[col] = value;
      col++;
    }
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    if (cells.some((c) => c !== '')) {
      rows.push(cells);
      if (rows.length >= maxRows) break;
    }
  }
  return rows;
}

/**
 * Every sheet in the workbook, in tab order, as rows of strings.
 *
 * `maxRows` bounds the work per sheet; the importer has its own row ceiling and nothing
 * is gained by parsing past it.
 */
export function parseXlsx(input: Uint8Array | ArrayBuffer, opts: { maxRows?: number } = {}): XlsxSheet[] {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input instanceof ArrayBuffer ? new Uint8Array(input) : input);
  const parts = readZip(buf);
  const workbook = parts.get('xl/workbook.xml')?.toString('utf8');
  if (!workbook) throw new XlsxError('This file has no workbook — it is not an Excel .xlsx file.');

  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(workbook);
  const shared = parseSharedStrings(parts.get('xl/sharedStrings.xml')?.toString('utf8'));
  const dateStyles = parseDateStyles(parts.get('xl/styles.xml')?.toString('utf8'));

  // Sheet tab → relationship id → worksheet part.
  const rels = new Map<string, string>();
  const relsXml = parts.get('xl/_rels/workbook.xml.rels')?.toString('utf8') ?? '';
  const relRe = /<Relationship\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = relRe.exec(relsXml))) {
    const id = attr(m[1], 'Id');
    const target = attr(m[1], 'Target');
    if (id && target) rels.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }

  const sheets: XlsxSheet[] = [];
  const sheetRe = /<sheet\b([^>]*)\/?>/g;
  const maxRows = opts.maxRows ?? 1_000_000;
  let fallback = 1;
  while ((m = sheetRe.exec(workbook))) {
    const name = attr(m[1], 'name') ?? `Sheet${fallback}`;
    const rid = attr(m[1], 'r:id');
    const path = (rid && rels.get(rid)) || `xl/worksheets/sheet${fallback}.xml`;
    fallback++;
    const xml = parts.get(path)?.toString('utf8');
    if (!xml) continue;
    sheets.push({ name, rows: parseSheet(xml, shared, dateStyles, date1904, maxRows) });
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
  const headers = sheet.rows[0].map((h, i) => h.trim() || `column_${i + 1}`);
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
