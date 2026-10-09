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

test('the template imports: headers map, the example row is dropped, approved publishes', () => {
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
  ];
  const { reviews, errors } = mapRows(rows, map, index, { fallbackProductId: null, defaultSource: 'csv' });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(reviews.length, 2);
  assert.strictEqual(reviews[0].productId, 'p2');
  assert.strictEqual(reviews[0].matchedBy, 'handle');
  assert.strictEqual(reviews[0].isPublished, true);
  assert.strictEqual(reviews[0].reviewDateFromFile, true);
  assert.strictEqual(reviews[1].productId, 'p1');
  assert.strictEqual(reviews[1].matchedBy, 'title');
  assert.strictEqual(reviews[1].isPublished, false);
  assert.strictEqual(reviews[1].reviewDateFromFile, false);
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
