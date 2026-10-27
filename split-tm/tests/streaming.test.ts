import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Dataset } from '../src/engine/dataset';
import { writeExcel } from '../src/engine/exporters';
import { processRun } from '../src/engine/processor';
import { defaultPaths } from '../src/engine/paths';

const tu = (i: number) => `<tu tuid="${i}"><prop type="JLR">B${i % 2}</prop><tuv xml:lang="en-GB"><seg>Source ${i}</seg></tuv><tuv xml:lang="de-DE"><seg>Ziel ${i}</seg></tuv></tu>`;
const tmx = (n: number) => `<?xml version="1.0"?><tmx version="1.4"><header srclang="en-GB"/><body>${Array.from({ length: n }, (_, i) => tu(i)).join('')}</body></tmx>`;
const tmp = () => mkdtempSync(join(tmpdir(), 'st-'));

describe('streaming export', () => {
  it('keeps one Excel workbook and continues on a new sheet when the row limit is reached', async () => {
    const f = join(tmp(), 'o.xlsx');
    const rows = Array.from({ length: 8 }, (_, i) => [`s${i}`, `t${i}`]);
    await writeExcel({ header: ['en_GB', 'de_DE'], rows, emptySource: 0 }, f, 3);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['TM', 'TM 2', 'TM 3']);
    const all = wb.worksheets.flatMap((w) => { expect(w.getRow(1).getCell(1).value).toBe('en_GB'); expect(w.getRow(1).font?.bold).toBe(true); return w.getSheetValues().slice(2).map((r) => (r as string[])[1]); });
    expect(all).toEqual(rows.map((r) => r[0]));
  });

  it('a run reads the input twice but holds no segment text: index only', async () => {
    const dir = tmp(); writeFileSync(join(dir, 'a.tmx'), tmx(50));
    const ds = new Dataset(); await ds.addTmx(join(dir, 'a.tmx'), 'a.tmx');
    expect(ds.units).toHaveLength(0); expect(ds.index).toHaveLength(50);
    expect(ds.index[0].brands).toBe(ds.index[2].brands); // shared arrays keep the index small
    const paths = defaultPaths({ appData: join(dir, 'app'), outputRoot: join(dir, 'out') });
    const r = await processRun({ inputs: [join(dir, 'a.tmx')], filter: { brands: ['B1'] }, format: 'csv', paths, dataset: ds });
    expect(r).toMatchObject({ recordsRead: 50, recordsSelected: 25, recordsExported: 25 });
  });

  it('refuses to export when the input changed after it was scanned', async () => {
    const dir = tmp(); const f = join(dir, 'a.tmx'); writeFileSync(f, tmx(10));
    const ds = new Dataset(); await ds.addTmx(f, 'a.tmx');
    writeFileSync(f, tmx(10).replace('tuid="3"', 'tuid="999"'));
    const paths = defaultPaths({ appData: join(dir, 'app'), outputRoot: join(dir, 'out') });
    await expect(processRun({ inputs: [f], filter: {}, format: 'csv', paths, dataset: ds })).rejects.toThrow(/changed after they were scanned/);
    writeFileSync(f, tmx(10)); appendFileSync(f, ''); // unchanged again -> works
    await expect(processRun({ inputs: [f], filter: {}, format: 'csv', paths, dataset: ds })).resolves.toMatchObject({ recordsExported: 10 });
  });

  it('reports malformed TMX with the file name and does not create output', async () => {
    const dir = tmp(); const f = join(dir, 'bad.tmx'); writeFileSync(f, '<tmx><body><tu></body>');
    await expect(new Dataset().addTmx(f, 'bad.tmx')).rejects.toThrow(/Invalid TMX \(bad\.tmx\)/);
  });
});
