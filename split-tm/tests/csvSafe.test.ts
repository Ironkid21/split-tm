import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { unzipSync, strFromU8 } from 'fflate';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { csvField, neutralizeFormula } from '../src/engine/csvSafe';
import { toCsv, writeExcel, type Table } from '../src/engine/exporters';

/** Minimal RFC 4180 parser, independent of the writer. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false;
  const t = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\r' && t[i + 1] === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const DANGEROUS = ['=SUM(A1:A10)', '+123', '-123', '@example', '=cmd|\' /C calc\'!A0', '  =1+1', '\t=1+1', '\r=1+1'];
const NORMAL = ['Hello world', 'Guarda il film', 'a=b', '1+1', 'x - y', 'email@example.com', 'Café — naïve 日本語 🚗', '', 'Price: 50%'];

describe('CSV formula-injection protection', () => {
  it('prefixes every formula-like field with one apostrophe and keeps the full original text', () => {
    for (const v of DANGEROUS) { const s = neutralizeFormula(v); expect(s).toBe(`'${v}`); expect(s.slice(1)).toBe(v); }
  });
  it('leaves normal content untouched', () => { for (const v of NORMAL) expect(neutralizeFormula(v)).toBe(v); });
  it('quotes commas, quotes and line breaks, also together with formula characters', () => {
    expect(csvField('a,b')).toBe('"a,b"'); expect(csvField('say "hi"')).toBe('"say ""hi"""'); expect(csvField('l1\nl2')).toBe('"l1\nl2"');
    expect(csvField('=A1,B1')).toBe('"\'=A1,B1"'); expect(csvField('+1\n"x"')).toBe('"\'+1\n""x"""');
  });
  it('round-trips a whole table: nothing lost, nothing executable, normal cells unchanged', () => {
    const cells = [...DANGEROUS, ...NORMAL, 'with,comma', 'with "quote"', 'multi\nline', '=SUM(A1:A10),"x"'];
    const t: Table = { header: ['en_GB', 'it_IT'], rows: cells.map((c, i) => [c, cells[(i + 1) % cells.length]]), emptySource: 0 };
    const parsed = parseCsv(toCsv(t));
    expect(parsed[0]).toEqual(['en_GB', 'it_IT']); expect(parsed).toHaveLength(cells.length + 1);
    parsed.slice(1).forEach((r, i) => t.rows[i].forEach((orig, c) => {
      const got = r[c];
      expect(/^(?:\s*[=+\-@]|[\t\r])/.test(got), `executable cell survived: ${JSON.stringify(got)}`).toBe(false);
      expect(got === orig || got === `'${orig}`).toBe(true);
      if (!/^(?:\s*[=+\-@]|[\t\r])/.test(orig)) expect(got).toBe(orig);
    }));
  });
  it('protection can be switched off for raw export tests only', () => {
    expect(csvField('=1+1', false)).toBe('=1+1');
  });
});

describe('Excel output treats text as data', () => {
  it('stores formula-like text as plain strings with no formula elements', async () => {
    const f = join(mkdtempSync(join(tmpdir(), 'x-')), 'o.xlsx');
    // A bare CR cannot survive XML in any xlsx writer (it is normalised to LF), so it is covered by the CSV tests only.
    const xl = DANGEROUS.filter((d) => d !== '\r=1+1');
    const rows = xl.map((d) => [d, 'ok']);
    await writeExcel({ header: ['a', 'b'], rows, emptySource: 0 }, f);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f); const ws = wb.worksheets[0];
    xl.forEach((d, i) => { const c = ws.getRow(i + 2).getCell(1); expect(c.type).toBe(ExcelJS.ValueType.String); expect(c.value).toBe(d); });
    const sheetXml = strFromU8(unzipSync(new Uint8Array(readFileSync(f)))['xl/worksheets/sheet1.xml']);
    expect(sheetXml).not.toMatch(/<f[ >]/);
  });
});
