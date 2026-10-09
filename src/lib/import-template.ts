/**
 * The downloadable import template: an Excel workbook with the merchant's own catalogue in it.
 *
 * Two sheets. "Reviews" is where the merchant types or pastes; its first column is a
 * dropdown of every product title in the store, so nobody has to look a title up, copy it
 * exactly, or know what a handle is. The second column fills the handle in by formula from
 * whatever title was picked — the importer matches on the handle, which is unique, and
 * falls back to the title if a spreadsheet tool did not compute the formula. "Products"
 * is the list the dropdown reads from; it is also a plain reference the merchant can
 * search.
 *
 * The shape follows the merchant's own spreadsheet (product, rating, author, title,
 * content, created_at, verified, status, image_urls, email, country) so a file they
 * already maintain imports without being reshaped. `verified` is accepted and ignored:
 * an import cannot prove a purchase, and the importer never awards a Verified badge to an
 * imported row (see bulk-upload/route.ts).
 *
 * One example row is included because an empty grid is where people type the wrong thing
 * in the wrong column. Its author is a sentinel the importer drops, so leaving it in costs
 * nothing.
 */

import { buildXlsx, type XlsxCell } from './xlsx';
import { EXAMPLE_REVIEWER } from './import';

export const TEMPLATE_COLUMNS = [
  'product_title',
  'product_handle',
  'rating',
  'author',
  'title',
  'content',
  'created_at',
  'verified',
  'status',
  'image_urls',
  'email',
  'country',
] as const;

export const TEMPLATE_EXAMPLE = [
  '', // product_title — the first product in the catalogue, filled in below
  '', // product_handle — by formula
  '5',
  EXAMPLE_REVIEWER,
  'Beautiful quality',
  'Very happy with this product.',
  '', // today, filled in below
  'true',
  'approved',
  '',
  '',
  'IN',
] as const;

/** Rows the dropdown and the handle formula cover. Matches the merchant's own file. */
export const TEMPLATE_ROWS = 5000;

const WIDTHS = [44, 36, 8, 22, 28, 60, 12, 9, 11, 40, 28, 10];

export interface TemplateProduct {
  title: string;
  handle: string | null;
}

/**
 * Titles are what the merchant picks, handles are what the importer matches. Two products
 * with the same title would make the lookup ambiguous, so the second and later get their
 * handle appended to the title they show — still a real product, still matched by handle.
 */
export function templateProductRows(products: TemplateProduct[]): Array<[string, string]> {
  const seen = new Map<string, number>();
  return products
    .filter((p) => p.title && p.title.trim())
    .map((p) => ({ title: p.title.trim(), handle: (p.handle ?? '').trim() }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
    .map((p) => {
      const key = p.title.toLowerCase();
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      const display = n === 0 || !p.handle ? p.title : `${p.title} — ${p.handle}`;
      return [display, p.handle] as [string, string];
    });
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildImportTemplate(products: TemplateProduct[], today = new Date()): Buffer {
  const catalogue = templateProductRows(products);
  // The dropdown's source range. At least one row, so the formula is valid for a store
  // with no products yet (the list is simply empty until they sync).
  const lastProductRow = Math.max(2, catalogue.length + 1);
  const handleFormula = (row: number) => ({ formula: `IFERROR(VLOOKUP(A${row},Products!$A:$B,2,FALSE),"")` });

  const example: XlsxCell[] = [...TEMPLATE_EXAMPLE];
  example[0] = catalogue[0]?.[0] ?? '';
  example[1] = handleFormula(2);
  example[6] = isoDate(today);

  const rows: XlsxCell[][] = [[...TEMPLATE_COLUMNS], example];
  for (let r = 3; r <= TEMPLATE_ROWS + 1; r++) rows.push(['', handleFormula(r)]);

  const span = `2:${TEMPLATE_ROWS + 1}`;
  return buildXlsx([
    {
      name: 'Reviews',
      header: true,
      columnWidths: WIDTHS,
      rows,
      validations: [
        { range: `A${span.replace(':', ':A')}`, formula: `Products!$A$2:$A$${lastProductRow}` },
        { range: `C${span.replace(':', ':C')}`, list: ['1', '2', '3', '4', '5'] },
        { range: `H${span.replace(':', ':H')}`, list: ['true', 'false'] },
        { range: `I${span.replace(':', ':I')}`, list: ['approved', 'pending', 'rejected'] },
      ],
    },
    {
      name: 'Products',
      header: true,
      columnWidths: [60, 48],
      rows: [['Product title', 'product_handle'], ...catalogue],
    },
  ]);
}
