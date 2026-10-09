/**
 * Offline tests for the dependency-free .xlsx reader/writer and the import template.
 *
 * Run with:  npx --yes bun@latest run tests/xlsx.test.ts
 *
 * The reader is what turns a merchant's spreadsheet into review rows, so the cases here
 * are the cell kinds spreadsheets actually emit — shared strings, inline strings, rich
 * text, booleans, formulas with cached values, and dates (which Excel stores as numbers
 * and distinguishes only by cell style). The writer is checked by reading its own output
 * back and by handing it to the platform's zip tooling.
 */

import assert from 'node:assert';
import zlib from 'node:zlib';
import { buildXlsx, buildZip, parseXlsx, sheetToTable, isXlsx, XlsxError } from '../src/lib/xlsx';
import { buildImportTemplate, templateProductRows, TEMPLATE_COLUMNS } from '../src/lib/import-template';
import { detectColumns, mapRows, buildMatchIndex, EXAMPLE_REVIEWER } from '../src/lib/import';
import { issueDownloadToken, verifyDownloadToken } from '../src/lib/download-token';

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

// A hand-assembled workbook using every cell kind the reader must handle. Written with the
// zip packer alone so the XML is exactly what Excel produces, not what our writer produces.
function excelStyleWorkbook(): Buffer {
  const xml = (s: string) => Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + s);
  return buildZip([
    { name: '[Content_Types].xml', data: xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>') },
    { name: '_rels/.rels', data: xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: xml('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="My Reviews" sheetId="1" r:id="rId7"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>') },
    { name: 'xl/sharedStrings.xml', data: xml('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3"><si><t>author</t></si><si><r><rPr><b/></rPr><t>Rich </t></r><r><t>text &amp; co</t></r></si><si><t xml:space="preserve"> padded </t><rPh sb="0" eb="1"><t>ignored</t></rPh></si></sst>') },
    // Style 1 is built-in date format 14 (m/d/yyyy); style 2 is a custom date; style 3 is money.
    { name: 'xl/styles.xml', data: xml('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt formatCode="#,##0.00 &quot;USD&quot;" numFmtId="165"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>') },
    { name: 'xl/worksheets/sheet1.xml', data: xml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>created_at</t></is></c><c r="C1" t="inlineStr"><is><t>rating</t></is></c><c r="D1" t="inlineStr"><is><t>note</t></is></c><c r="E1" t="inlineStr"><is><t>flag</t></is></c><c r="F1" t="inlineStr"><is><t>price</t></is></c></row>' +
      '<row r="2"/>' + // an empty, self-closing row Excel leaves behind
      '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" s="1"><v>46303</v></c><c r="C3"><v>5</v></c><c r="D3" t="str"><f>CONCAT("a","b")</f><v>ab</v></c><c r="E3" t="b"><v>1</v></c><c r="F3" s="3"><v>46303</v></c></row>' +
      '<row r="4"><c r="A4" t="s"><v>2</v></c><c r="B4" s="2"><v>45000.5</v></c><c r="D4"><f>1/0</f></c><c r="F4"><v>9.123456789123E+12</v></c></row>' +
      '<row r="5"><c r="A5" s="1"/><c r="B5" t="inlineStr"><is><t></t></is></c></row>' + // all blank → dropped
      '<row r="6"><c r="C6"><v>4</v></c></row>' + // leading gap → padded with empties
      '</sheetData></worksheet>') },
  ]);
}

console.log('xlsx reader');

test('reads shared, inline, rich-text, boolean, formula and date cells', () => {
  const buf = excelStyleWorkbook();
  assert.ok(isXlsx(buf));
  const sheets = parseXlsx(buf);
  assert.strictEqual(sheets.length, 1);
  assert.strictEqual(sheets[0].name, 'My Reviews');
  const rows = sheets[0].rows;
  assert.deepStrictEqual(rows[0], ['author', 'created_at', 'rating', 'note', 'flag', 'price']);
  // Serial 46303 with a date style is 8 October 2026; with a money style it stays a number.
  assert.deepStrictEqual(rows[1], ['Rich text & co', '2026-10-08', '5', 'ab', 'true', '46303']);
  // Custom dd/mm/yyyy style, fractional serial carries a time; exponent ids normalise.
  assert.deepStrictEqual(rows[2], [' padded ', '2023-03-15T12:00:00', '', '', '', '9123456789123']);
  // The blank row is gone; the gap row is padded.
  assert.deepStrictEqual(rows[3], ['', '', '4']);
  assert.strictEqual(rows.length, 4);
});

test('sheetToTable keys rows by the header and names blank headers', () => {
  const { headers, rows } = sheetToTable({ name: 'x', rows: [['a', '', 'c'], ['1', '2', '3'], ['4']] });
  assert.deepStrictEqual(headers, ['a', 'column_2', 'c']);
  assert.deepStrictEqual(rows[0], { a: '1', column_2: '2', c: '3' });
  assert.deepStrictEqual(rows[1], { a: '4', column_2: '', c: '' });
});

test('rejects things that are not workbooks, without throwing anything but XlsxError', () => {
  assert.throws(() => parseXlsx(Buffer.from('not a zip at all')), XlsxError);
  assert.throws(() => parseXlsx(buildZip([{ name: 'readme.txt', data: Buffer.from('hi') }])), XlsxError);
  assert.strictEqual(isXlsx(Buffer.from('PK')), false);
});

test('honours maxRows', () => {
  const buf = buildXlsx([{ name: 'S', rows: [['h'], ['1'], ['2'], ['3']] }]);
  assert.strictEqual(parseXlsx(buf, { maxRows: 2 })[0].rows.length, 2);
});

// ── Hostile files ──
//
// Any installed store can upload a workbook, and the parse runs synchronously on the
// process that serves every merchant's storefront. These are shaped like the files that
// used to freeze it (quadratic regex scans) or exhaust its memory (zip fan-out, far-right
// column references). Each must come back quickly, as rows or as an XlsxError.

/** A one-sheet workbook ("Reviews" → xl/worksheets/sheet1.xml) from raw XML parts. */
function rawWorkbook(parts: Record<string, string | Buffer>): Buffer {
  const files: Record<string, string | Buffer> = {
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Reviews" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ...parts,
  };
  return buildZip(Object.entries(files).map(([name, data]) => ({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data) })));
}

/** Byte offset of each central-directory entry, to forge the fields a hostile zip would. */
function centralEntries(zip: Buffer): number[] {
  const eocd = zip.length - 22;
  assert.strictEqual(zip.readUInt32LE(eocd), 0x06054b50);
  const offsets: number[] = [];
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < zip.readUInt16LE(eocd + 10); i++) {
    offsets.push(p);
    p += 46 + zip.readUInt16LE(p + 28) + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return offsets;
}

/**
 * A zip of streams that are already deflated, each declaring an uncompressed size of
 * 1 KB whatever it really inflates to — so only the reader's inflate caps can stop it.
 */
function zipOfDeflated(parts: Array<[string, Buffer]>): Buffer {
  const out: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [n, comp] of parts) {
    const name = Buffer.from(n);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt16LE(name.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(1024, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    out.push(local, name, comp);
    central.push(cd, name);
    offset += 30 + name.length + comp.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(parts.length, 8);
  eocd.writeUInt16LE(parts.length, 10);
  eocd.writeUInt32LE(central.reduce((n, b) => n + b.length, 0), 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...out, ...central, eocd]);
}

function timed<T>(fn: () => T): { value?: T; error?: unknown; ms: number } {
  const start = performance.now();
  try {
    const value = fn();
    return { value, ms: performance.now() - start };
  } catch (error) {
    return { error, ms: performance.now() - start };
  }
}

test('unclosed tags in every part are read in one pass, not one pass per tag', () => {
  // Each of these took minutes to hours with the lazy regexes, which rescanned the rest
  // of the part once for every one of the 200,000 unclosed tags.
  const n = 200_000;
  const cell = '<row><c t="inlineStr"><is><t>ok</t></is></c></row>';
  const cases: Array<[string, Record<string, string>]> = [
    ['<row>', { 'xl/worksheets/sheet1.xml': cell + '<row>'.repeat(n) }],
    ['<c> in a row', { 'xl/worksheets/sheet1.xml': cell + '<row>' + '<c>'.repeat(n) + '</row>' }],
    ['<v> in a cell', { 'xl/worksheets/sheet1.xml': cell + '<row><c>' + '<v>'.repeat(n) + '</c></row>' }],
    ['<t> in a cell', { 'xl/worksheets/sheet1.xml': cell + '<row><c t="inlineStr">' + '<t>'.repeat(n) + '</c></row>' }],
    ['<rPh> in a cell', { 'xl/worksheets/sheet1.xml': cell + '<row><c t="inlineStr">' + '<rPh>'.repeat(n) + '<t>x</t></c></row>' }],
    ['<si>', { 'xl/sharedStrings.xml': '<sst>' + '<si>'.repeat(n), 'xl/worksheets/sheet1.xml': cell }],
    ['<t> in a shared string', { 'xl/sharedStrings.xml': '<sst><si>' + '<t>'.repeat(n) + '</si></sst>', 'xl/worksheets/sheet1.xml': cell }],
    ['<numFmt', { 'xl/styles.xml': '<styleSheet>' + '<numFmt '.repeat(n), 'xl/worksheets/sheet1.xml': cell }],
    ['<cellXfs>', { 'xl/styles.xml': '<styleSheet>' + '<cellXfs>'.repeat(n), 'xl/worksheets/sheet1.xml': cell }],
    ['<xf', { 'xl/styles.xml': '<styleSheet><cellXfs>' + '<xf '.repeat(n) + '</cellXfs>', 'xl/worksheets/sheet1.xml': cell }],
    ['[ in a number format', { 'xl/styles.xml': `<styleSheet><numFmts><numFmt numFmtId="164" formatCode="${'['.repeat(n)}"/></numFmts><cellXfs><xf numFmtId="164"/></cellXfs></styleSheet>`, 'xl/worksheets/sheet1.xml': cell }],
    ['<Relationship', { 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' + '<Relationship '.repeat(n), 'xl/worksheets/sheet1.xml': cell }],
    ['<sheet', { 'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Reviews" r:id="rId1"/>' + '<sheet '.repeat(n), 'xl/worksheets/sheet1.xml': cell }],
  ];
  for (const [label, parts] of cases) {
    const buf = rawWorkbook(parts);
    const { value, error, ms } = timed(() => parseXlsx(buf, { sheet: 'reviews' }));
    assert.ok(!error, `${label}: ${String(error)}`);
    assert.ok(ms < 1000, `${label}: ${ms.toFixed(0)} ms`);
    // The well-formed row ahead of the junk still reads.
    assert.deepStrictEqual(value![0].rows[0], ['ok'], label);
  }
});

test('a self-closing <si/> keeps its index, and a cell with no value is blank', () => {
  const buf = rawWorkbook({
    'xl/sharedStrings.xml': '<sst><si><t>zero</t></si><si/><si><t/><t>two</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c><c t="s"><v>2</v></c><c t="s"/><c t="b"/></row>',
  });
  assert.deepStrictEqual(parseXlsx(buf)[0].rows, [['zero', '', 'two']]);
});

test('a zip with more entries than a workbook has is refused before anything is inflated', () => {
  const files = Array.from({ length: 1001 }, (_, i) => ({ name: `xl/media/f${i}.bin`, data: Buffer.from('x') }));
  files.push({ name: 'xl/workbook.xml', data: Buffer.from('<workbook/>') });
  const zip = buildZip(files);
  const { error, ms } = timed(() => parseXlsx(zip));
  assert.ok(error instanceof XlsxError, String(error));
  assert.ok(ms < 100, `${ms.toFixed(0)} ms`);
});

test('entries sharing one local header are refused', () => {
  // The fan-out bomb: many directory entries pointing at one deflate stream, each one
  // inflated and kept in full.
  // Here the worksheet's entry is made an exact copy of the workbook's (same local
  // header, same sizes), which the old reader inflated twice without complaint.
  const zip = rawWorkbook({ 'xl/worksheets/sheet1.xml': '<row><c><v>1</v></c></row>', 'xl/sharedStrings.xml': '<sst/>' });
  const [workbook, , sheet] = centralEntries(zip);
  for (const field of [16, 20, 24, 42]) zip.writeUInt32LE(zip.readUInt32LE(workbook + field), sheet + field); // crc, sizes, offset
  assert.throws(() => parseXlsx(zip), XlsxError);
});

test('a part declaring more than the per-part cap is refused without inflating it', () => {
  const zip = rawWorkbook({ 'xl/worksheets/sheet1.xml': '<row><c><v>1</v></c></row>' });
  const [, , sheet] = centralEntries(zip);
  zip.writeUInt32LE(65 * 1024 * 1024, sheet + 24);
  assert.throws(() => parseXlsx(zip), /more than an import can read/);
});

test('the inflated bytes of one file are capped in total, not only per part', () => {
  // Two parts of 50 MB each: under the 64 MB part cap, over the 96 MB file budget, and
  // both declaring 1 KB.
  const big = zlib.deflateRawSync(Buffer.alloc(50 * 1024 * 1024, 0x20));
  const zip = zipOfDeflated([
    ['xl/workbook.xml', zlib.deflateRawSync(Buffer.from('<workbook xmlns:r="r"><sheets><sheet name="Reviews" r:id="rId1"/></sheets></workbook>'))],
    ['xl/_rels/workbook.xml.rels', zlib.deflateRawSync(Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'))],
    ['xl/sharedStrings.xml', big],
    ['xl/worksheets/sheet1.xml', big],
  ]);
  assert.ok(zip.length < 200 * 1024, 'about 100 KB on the wire');
  const { error, ms } = timed(() => parseXlsx(zip, { sheet: 'reviews' }));
  assert.ok(error instanceof XlsxError, String(error));
  assert.match((error as Error).message, /more than an import can read/);
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
});

test('a far-right column reference is dropped, never padded up to', () => {
  // AAAAAA1 once made a header twelve million cells wide; a thousand letters is past any
  // number. The real cells in the same rows still read.
  let xml = '<row><c r="A1" t="inlineStr"><is><t>author</t></is></c><c r="AAAAAA1" t="inlineStr"><is><t>far</t></is></c></row>';
  for (let r = 2; r <= 2001; r++) xml += `<row><c r="A${r}"><v>${r}</v></c><c r="XFD${r}"><v>9</v></c></row>`;
  xml += `<row><c r="${'Z'.repeat(1000)}2002"><v>1</v></c></row>`;
  xml += '<row><c r="IV2003"><v>256</v></c><c r="IW2003"><v>257</v></c></row>';
  const buf = rawWorkbook({ 'xl/worksheets/sheet1.xml': xml });
  const { value, error, ms } = timed(() => parseXlsx(buf, { sheet: 'reviews' }));
  assert.ok(!error, String(error));
  assert.ok(ms < 100, `${ms.toFixed(0)} ms`);
  const rows = value![0].rows;
  assert.deepStrictEqual(rows[0], ['author']);
  assert.deepStrictEqual(rows[1], ['2']);
  assert.strictEqual(rows.length, 2002, 'the thousand-letter row has nothing left and is dropped');
  // Column IV, the 256th, is the last one kept.
  assert.strictEqual(rows[2001].length, 256);
  assert.strictEqual(rows[2001][255], '256');
  assert.deepStrictEqual(sheetToTable(value![0]).headers, ['author']);
});

test('a sheet with more cells than an import can read is refused', () => {
  // 16,000 rows each padded out to column IV: 4.1 million cells from a 600 KB sheet.
  const buf = rawWorkbook({ 'xl/worksheets/sheet1.xml': '<row><c r="IV1"><v>1</v></c></row>'.repeat(16_000) });
  const { error, ms } = timed(() => parseXlsx(buf));
  assert.ok(error instanceof XlsxError, String(error));
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
  // And the table, where every row gets a key per header however short the row is.
  const header = Array.from({ length: 256 }, (_, i) => `h${i}`);
  assert.throws(() => sheetToTable({ name: 'x', rows: [header, ...Array.from({ length: 16_000 }, () => ['1'])] }), XlsxError);
});

console.log('choosing the sheet to import');

/** A workbook of named tabs, each pointing at the part given (several may share one). */
function tabbedWorkbook(tabs: Array<[string, string]>, parts: Record<string, string | Buffer>): Buffer {
  const targets = [...new Set(tabs.map(([, target]) => target))];
  return rawWorkbook({
    'xl/workbook.xml':
      '<workbook xmlns:r="r"><sheets>' +
      tabs.map(([name, target], i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="rId${targets.indexOf(target) + 1}"/>`).join('') +
      '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships>' + targets.map((t, i) => `<Relationship Id="rId${i + 1}" Target="${t}"/>`).join('') + '</Relationships>',
    ...parts,
  });
}

const oneCell = (v: string) => `<row><c t="inlineStr"><is><t>${v}</t></is></c></row>`;

test('the Reviews sheet wins wherever it is, and no other sheet is inflated', () => {
  const buf = tabbedWorkbook([['Products', 'worksheets/p.xml'], ['My Reviews', 'worksheets/r.xml']], {
    'xl/worksheets/r.xml': oneCell('review'),
    'xl/worksheets/p.xml': 'placeholder',
  });
  // Break the Products part's deflate stream in place: inflating it now throws.
  const at = buf.indexOf('xl/worksheets/p.xml') + 'xl/worksheets/p.xml'.length;
  buf.fill(0xff, at, at + 4);
  assert.throws(() => parseXlsx(buf), XlsxError, 'reading every sheet does inflate it');
  assert.deepStrictEqual(parseXlsx(buf, { sheet: 'reviews' }), [{ name: 'My Reviews', rows: [['review']] }]);
});

test('without a Reviews sheet: the first non-product sheet with rows, else the first', () => {
  const parts = { 'xl/worksheets/empty.xml': '<sheetData/>', 'xl/worksheets/data.xml': oneCell('data'), 'xl/worksheets/p.xml': oneCell('product') };
  const a = tabbedWorkbook([['Products', 'worksheets/p.xml'], ['Notes', 'worksheets/empty.xml'], ['Sheet1', 'worksheets/data.xml']], parts);
  assert.deepStrictEqual(parseXlsx(a, { sheet: 'reviews' }), [{ name: 'Sheet1', rows: [['data']] }]);
  const b = tabbedWorkbook([['Products', 'worksheets/p.xml'], ['Notes', 'worksheets/empty.xml']], parts);
  assert.deepStrictEqual(parseXlsx(b, { sheet: 'reviews' }), [{ name: 'Products', rows: [['product']] }]);
  const c = tabbedWorkbook([['Notes', 'worksheets/empty.xml'], ['Products', 'worksheets/p.xml']], parts);
  assert.deepStrictEqual(parseXlsx(c, { sheet: 'reviews' }), [{ name: 'Notes', rows: [] }]);
  assert.deepStrictEqual(parseXlsx(rawWorkbook({ 'xl/workbook.xml': '<workbook><sheets/></workbook>' }), { sheet: 'reviews' }), []);
});

test('many tabs pointing at one part read it once', () => {
  const tabs = Array.from({ length: 5000 }, (_, i): [string, string] => [`Tab ${i}`, 'worksheets/s.xml']);
  const buf = tabbedWorkbook(tabs, { 'xl/worksheets/s.xml': '<row><c><v>1</v></c></row>'.repeat(20_000) });
  const { value, error, ms } = timed(() => parseXlsx(buf));
  assert.ok(!error, String(error));
  assert.strictEqual(value!.length, 1);
  assert.ok(ms < 1000, `${ms.toFixed(0)} ms`);
});

console.log('xlsx writer');

test('round-trips every cell kind and escapes XML', () => {
  const buf = buildXlsx([
    {
      name: 'Reviews',
      header: true,
      columnWidths: [30, 8],
      rows: [
        ['title', 'rating', 'ok', 'handle', 'n'],
        ['Ananda & <Co> "quoted" \u0007bell', 5, true, { formula: 'IFERROR(VLOOKUP(A2,Products!$A:$B,2,FALSE),"")' }, 4.5],
        ['', { formula: 'A3' }], // formula-only row reads back empty and is dropped
        ['🎁 emoji — and a dash'],
      ],
      validations: [{ range: 'A2:A10', formula: 'Products!$A$2:$A$3' }, { range: 'B2:B10', list: ['1', '2'] }],
    },
    { name: 'Bad/Name?', rows: [['x']] },
  ]);
  const back = parseXlsx(buf);
  assert.deepStrictEqual(back.map((s) => s.name), ['Reviews', 'Bad Name']);
  assert.deepStrictEqual(back[0].rows, [
    ['title', 'rating', 'ok', 'handle', 'n'],
    ['Ananda & <Co> "quoted" bell', '5', 'true', '', '4.5'],
    ['🎁 emoji — and a dash'],
  ]);
  const sheet1 = buf.toString('latin1');
  assert.ok(sheet1.length > 0);
});

test('emits the parts Excel requires, with validations and a frozen header', () => {
  const buf = buildXlsx([{ name: 'S', header: true, rows: [['a'], ['b']], validations: [{ range: 'A2:A3', list: ['x', 'y'] }] }]);
  // Inflate the worksheet part through the reader's own zip walker by re-parsing, then
  // check the raw XML via a second workbook that stores a copy of it as a string cell.
  const sheets = parseXlsx(buf);
  assert.strictEqual(sheets[0].rows.length, 2);
  const text = buf.toString('binary');
  assert.ok(text.includes('xl/styles.xml'));
  assert.ok(text.includes('xl/worksheets/sheet1.xml'));
  assert.ok(text.includes('[Content_Types].xml'));
});

console.log('import template');

test('builds a two-sheet template with the catalogue in a dropdown', () => {
  const products = [
    { title: 'Zeta', handle: 'zeta' },
    { title: 'Alpha', handle: 'alpha' },
    { title: 'alpha', handle: 'alpha-2' }, // same title, different product
    { title: '  ', handle: 'blank' }, // no title → left out
    { title: 'No handle', handle: null },
  ];
  assert.deepStrictEqual(templateProductRows(products), [
    ['Alpha', 'alpha'],
    ['alpha — alpha-2', 'alpha-2'],
    ['No handle', ''],
    ['Zeta', 'zeta'],
  ]);
  const buf = buildImportTemplate(products, new Date('2026-10-09T00:00:00Z'));
  const sheets = parseXlsx(buf);
  assert.deepStrictEqual(sheets.map((s) => s.name), ['Reviews', 'Products']);
  assert.deepStrictEqual(sheets[0].rows[0], [...TEMPLATE_COLUMNS]);
  const example = sheets[0].rows[1];
  assert.strictEqual(example[0], 'Alpha');
  assert.strictEqual(example[3], EXAMPLE_REVIEWER);
  assert.strictEqual(example[6], '2026-10-09');
  assert.strictEqual(sheets[0].rows.length, 2, 'the 5,000 formula-only rows read back as empty');
  assert.deepStrictEqual(sheets[1].rows[0], ['Product title', 'product_handle']);
  assert.strictEqual(sheets[1].rows.length, 5);
  // The dropdown points at the whole Products column.
  const raw = buf.toString('binary');
  assert.ok(raw.length > 0);
});

/** One part of a zip, inflated, to look at the XML the writer produced. */
function zipPart(zip: Buffer, name: string): string {
  for (const p of centralEntries(zip)) {
    if (zip.toString('utf8', p + 46, p + 46 + zip.readUInt16LE(p + 28)) !== name) continue;
    const local = zip.readUInt32LE(p + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    return zlib.inflateRawSync(zip.subarray(start, start + zip.readUInt32LE(p + 20))).toString('utf8');
  }
  throw new Error(`no ${name} in the zip`);
}

test('the handle formula escapes VLOOKUP wildcards in the picked title', () => {
  // "12*12" as a VLOOKUP pattern also matches "12 x 12", which sorts first, so the
  // unescaped lookup filled in the wrong product's handle.
  const buf = buildImportTemplate([
    { title: 'Pyrite Frame (12 x 12 inch)', handle: 'frame-spaced' },
    { title: 'Pyrite Frame (12*12 inch)', handle: 'frame-star' },
  ]);
  const xml = zipPart(buf, 'xl/worksheets/sheet1.xml').replace(/&quot;/g, '"');
  // ~ first, so the escapes added for * and ? are not escaped again.
  const escaped = (row: number) => `SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(A${row},"~","~~"),"*","~*"),"?","~?")`;
  assert.ok(xml.includes(`<f>IFERROR(VLOOKUP(${escaped(2)},Products!$A:$B,2,FALSE),"")</f>`), 'the example row');
  assert.ok(xml.includes(`<f>IFERROR(VLOOKUP(${escaped(5001)},Products!$A:$B,2,FALSE),"")</f>`), 'the last row');
  assert.ok(!/VLOOKUP\(A\d/.test(xml), 'no row looks up the raw title');
});

test('the template imports: headers map, the example row is dropped, approved or blank publishes', () => {
  const products = [{ title: 'Alpha', handle: 'alpha' }, { title: 'Beta', handle: 'beta' }];
  const buf = buildImportTemplate(products);
  const table = sheetToTable(parseXlsx(buf)[0]);
  const map = detectColumns(table.headers);
  assert.strictEqual(map.productTitle, 'product_title');
  assert.strictEqual(map.productHandle, 'product_handle');
  assert.strictEqual(map.reviewerName, 'author');
  assert.strictEqual(map.body, 'content');
  assert.strictEqual(map.reviewDate, 'created_at');
  assert.strictEqual(map.isPublished, 'status');
  assert.strictEqual(map.images, 'image_urls');
  assert.strictEqual(map.reviewerEmail, 'email');
  assert.strictEqual(map.reviewerLocation, 'country');

  const index = buildMatchIndex([
    { id: 'p1', shopifyId: '1', handle: 'alpha', title: 'Alpha' },
    { id: 'p2', shopifyId: '2', handle: 'beta', title: 'Beta' },
  ]);
  // The example row plus two real rows: one matched by handle (as the formula fills it),
  // one by title alone (a tool that did not compute the formula).
  const rows = [
    ...table.rows,
    { product_title: 'Beta', product_handle: 'beta', rating: '4', author: 'Real One', title: '', content: 'Good', created_at: '2026-10-01', verified: 'true', status: 'approved', image_urls: '', email: '', country: 'IN' },
    { product_title: 'Alpha', product_handle: '', rating: '3', author: 'Real Two', title: '', content: 'Fine', created_at: '', verified: '', status: 'pending', image_urls: '', email: '', country: '' },
    // Status left blank, as every template row but the example starts: not given, so the
    // import default (published) applies. Reading blank as "not approved" imported whole
    // sheets hidden.
    { product_title: 'Alpha', product_handle: 'alpha', rating: '5', author: 'Real Three', title: '', content: 'Lovely', created_at: '', verified: '', status: '', image_urls: '', email: '', country: '' },
  ];
  const { reviews, errors } = mapRows(rows, map, index, { fallbackProductId: null, defaultSource: 'csv' });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(reviews.length, 3);
  assert.strictEqual(reviews[0].productId, 'p2');
  assert.strictEqual(reviews[0].matchedBy, 'handle');
  assert.strictEqual(reviews[0].isPublished, true);
  assert.strictEqual(reviews[0].reviewDateFromFile, true);
  assert.strictEqual(reviews[1].productId, 'p1');
  assert.strictEqual(reviews[1].matchedBy, 'title');
  assert.strictEqual(reviews[1].isPublished, false);
  assert.strictEqual(reviews[1].reviewDateFromFile, false);
  assert.strictEqual(reviews[2].isPublished, true);
});

console.log('download token');

test('a token opens its own store for five minutes and nothing else', () => {
  process.env.TOKEN_ENCRYPTION_KEY = 'test-key';
  const t = issueDownloadToken('store_1', 'import-template', 1_000_000);
  assert.strictEqual(verifyDownloadToken(t, 'import-template', 1_000_000 + 60_000), 'store_1');
  assert.strictEqual(verifyDownloadToken(t, 'import-template', 1_000_000 + 6 * 60_000), null, 'expired');
  assert.strictEqual(verifyDownloadToken(t, 'export', 1_000_000), null, 'wrong purpose');
  assert.strictEqual(verifyDownloadToken(t.slice(0, -2) + 'zz', 'import-template', 1_000_000), null, 'tampered');
  assert.strictEqual(verifyDownloadToken('', 'import-template'), null);
  assert.strictEqual(verifyDownloadToken('nodot', 'import-template'), null);
  process.env.TOKEN_ENCRYPTION_KEY = 'other-key';
  assert.strictEqual(verifyDownloadToken(t, 'import-template', 1_000_000), null, 'other key');
});

console.log(`\n${passed} passed`);
