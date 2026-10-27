import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { Dataset } from '../src/engine/dataset';
import { processRun, OutputFormat, OutputMode } from '../src/engine/processor';
import { defaultPaths } from '../src/engine/paths';
import type { FilterCriteria } from '../src/engine/model';

const tuv = (l: string, t: string) => `<tuv xml:lang="${l}"><seg>${t}</seg></tuv>`;
const tu = (id: number, brands: string[], project: string, approval: string, status: string, langs: [string, string][], created = '20260301T100000Z') =>
  `<tu tuid="${id}" creationdate="${created}"><prop type="x-Project">${project}</prop>${brands.map((b) => `<prop type="JLR">${b}</prop>`).join('')}` +
  `<prop type="x-xtm-status">${approval}</prop><prop type="Status">${status}</prop>${langs.map(([l, t]) => tuv(l, t)).join('')}</tu>`;
const file = (src: string, customer: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><tmx version="1.4"><header srclang="${src}"><prop type="user-defined">CUSTOMER: ${customer}</prop></header><body>${body}</body></tmx>`;

const A = file('en-GB', 'Cust1', [
  tu(1, ['A', 'B'], 'P1', 'approved', 'translated', [['en-GB', 'One <ph x="1">{1}</ph> tag'], ['de-DE', 'Eins'], ['fr-FR', 'Un']], '20260110T100000Z'),
  tu(2, ['A'], 'P1', 'approved', 'new', [['en-GB', 'Two'], ['de-DE', 'Zwei']], '20260210T100000Z'),
  tu(3, ['B'], 'P2', 'not approved', 'translated', [['en-GB', 'Three'], ['fr-FR', 'Trois']], '20260310T100000Z'),
  tu(4, ['C'], 'P2', 'approved', 'translated', [['en-GB', 'Four'], ['de-DE', 'Vier']], '20260410T100000Z'),
  tu(5, [], 'P1', 'approved', 'translated', [['en-GB', 'Five'], ['de-DE', 'Fünf']]),
  tu(6, ['A', 'C'], 'P2', 'approved', 'translated', [['en-GB', 'Six'], ['de-DE', 'Sechs'], ['fr-FR', 'Six fr']], '20260510T100000Z'),
  tu(9, ['X_Y'], 'P1', 'approved', 'translated', [['en-GB', 'Nine'], ['de-DE', 'Neun']]),
  tu(10, ['X Y'], 'P1', 'approved', 'translated', [['en-GB', 'Ten'], ['de-DE', 'Zehn']]),
].join(''));
const B = file('de-DE', 'Cust2', [
  tu(7, ['B'], 'P1', 'approved', 'translated', [['de-DE', 'Sieben'], ['en-GB', 'Seven']]),
  tu(8, ['D'], 'P3', 'approved', 'new', [['de-DE', 'Acht'], ['fr-FR', 'Huit']]),
].join(''));

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'bo-'));
  writeFileSync(join(dir, 'a.tmx'), A); writeFileSync(join(dir, 'b.tmx'), B);
  const ds = new Dataset(); await ds.addTmx(join(dir, 'a.tmx'), 'a.tmx'); await ds.addTmx(join(dir, 'b.tmx'), 'b.tmx');
  const paths = defaultPaths({ appData: join(dir, 'app'), outputRoot: join(dir, 'out') });
  const run = (filter: FilterCriteria, format: OutputFormat = 'csv', outputMode?: OutputMode) =>
    processRun({ inputs: [join(dir, 'a.tmx'), join(dir, 'b.tmx')], filter, format, paths, dataset: ds, outputMode });
  return { dir, ds, paths, run };
}
const rowsOf = async (path: string): Promise<string[][]> => {
  const ext = extname(path);
  if (ext === '.csv') return readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim().split('\r\n').map((l) => l.split(','));
  if (ext === '.md') return readFileSync(path, 'utf8').trim().split('\n').filter((l, i) => i !== 1).map((l) => l.slice(2, -2).split(' | '));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path);
  return wb.worksheets[0].getSheetValues().slice(1).map((r) => (r as string[]).slice(1));
};
const tuidsOfTmx = async (path: string) => { const d = new Dataset({ keepUnits: true }); await d.addTmx(path, 'x'); return d.units.map((u) => u.tuid).sort(); };

describe('Multiple Brand output mode', () => {
  it('single brand: one file, mode forced to single even if "separate" is requested', async () => {
    const { run } = await setup();
    const r = await run({ brands: ['A'] }, 'csv', 'separate');
    expect(r.outputMode).toBe('single'); expect(r.files).toHaveLength(1); expect(r.files[0].name).toBe('A.csv');
    expect(r.recordsSelected).toBe(3);
  });

  it('three brands, Single File: one combined file, each unit once', async () => {
    const { run } = await setup();
    const r = await run({ brands: ['A', 'B', 'C'] }, 'tmx', 'single');
    expect(r.outputMode).toBe('single'); expect(r.files.map((f) => f.name)).toEqual(['3 Brands.tmx']);
    expect(await tuidsOfTmx(r.files[0].path)).toEqual(['1', '2', '3', '4', '6', '7']); // tu 1 and tu 6 carry two selected brands but appear once
    expect(r).toMatchObject({ recordsSelected: 6, recordsExported: 6 });
  });

  it('default mode (not passed) behaves as before: single file', async () => {
    const { run } = await setup();
    expect((await run({ brands: ['A', 'B'] })).files).toHaveLength(1);
  });

  it('three brands, Separate Files: one file per brand, ONE run id and ONE run folder', async () => {
    const { run, paths } = await setup();
    const r = await run({ brands: ['A', 'B', 'C'] }, 'csv', 'separate');
    expect(r.outputMode).toBe('separate');
    expect(r.files.map((f) => f.name)).toEqual(['A.csv', 'B.csv', 'C.csv']);
    expect(r.files.every((f) => f.path.includes(r.runId) && f.path.startsWith(r.outputDir))).toBe(true);
    expect(readdirSync(r.outputDir).sort()).toEqual(['A.csv', 'B.csv', 'C.csv']);
    expect(r.files.map((f) => f.records)).toEqual([3, 3, 2]);            // A: tu1,2,6  B: tu1,3,7  C: tu4,6
    expect(r.recordsSelected).toBe(6); expect(r.recordsExported).toBe(8);  // multi-brand units appear in each of their brand files
    expect(readdirSync(join(paths.outputRoot)).length).toBe(1);           // a single dated folder
    expect(readdirSync(join(paths.outputRoot, readdirSync(paths.outputRoot)[0]))).toEqual([r.runId]);
  });

  for (const format of ['tmx', 'xlsx', 'csv', 'md'] as const) {
    it(`Separate Files works for ${format.toUpperCase()}: right extension and only that brand's units`, async () => {
      const { run } = await setup();
      const r = await run({ brands: ['A', 'B', 'C'] }, format, 'separate');
      expect(r.files.map((f) => f.name)).toEqual([`A.${format}`, `B.${format}`, `C.${format}`]);
      const want: Record<string, string[]> = { A: ['1', '2', '6'], B: ['1', '3', '7'], C: ['4', '6'] };
      for (const f of r.files) {
        if (format === 'tmx') expect(await tuidsOfTmx(f.path)).toEqual(want[f.brand!]);
        else expect((await rowsOf(f.path)).length - 1).toBe(want[f.brand!].length);
      }
    });
  }

  it('each brand file is its own consolidated dataset: columns follow that brand\'s languages, blanks stay blank', async () => {
    const { run } = await setup();
    const r = await run({ brands: ['A', 'B'] }, 'csv', 'separate');
    const a = await rowsOf(r.files[0].path), b = await rowsOf(r.files[1].path);
    expect(a[0]).toEqual(['en_GB', 'de_DE', 'fr_FR']);
    expect(a.slice(1)).toEqual([['One tag', 'Eins', 'Un'], ['Two', 'Zwei', ''], ['Six', 'Sechs', 'Six fr']]);
    expect(b[0]).toEqual(['de_DE', 'en_GB', 'fr_FR']);                       // B also has a German-source unit (tu 7)
    expect(b.slice(1)).toEqual([['Eins', 'One tag', 'Un'], ['', 'Three', 'Trois'], ['Sieben', 'Seven', '']]);
  });

  it('language selection still gives consolidated files per brand (1 source + 1 target, multi source, All-to-All)', async () => {
    const { run } = await setup();
    let r = await run({ brands: ['A', 'B', 'C'], sourceLanguages: ['en-GB'], targetLanguages: ['de-DE'] }, 'csv', 'separate');
    expect(r.files.map((f) => f.records)).toEqual([3, 1, 2]);                // B keeps only tu1 (tu3 has no German; tu7 is German-source)
    expect((await rowsOf(r.files[0].path))[0]).toEqual(['en_GB', 'de_DE']);
    r = await run({ brands: ['A', 'B'], sourceLanguages: ['en-GB', 'de-DE'], targetLanguages: ['fr-FR'] }, 'csv', 'separate');
    expect((await rowsOf(r.files[0].path))[0]).toEqual(['en_GB', 'fr_FR']);
    r = await run({ brands: ['A', 'B'], allToAll: true }, 'csv', 'separate');
    expect(r.files).toHaveLength(2);
    r = await run({ brands: ['A', 'B'], allToAll: true }, 'csv', 'single');
    expect(r.files).toHaveLength(1);                                         // normal language selection => one consolidated file
  });

  it('a brand with no matching records gets no file and a warning; the run still succeeds', async () => {
    const { run } = await setup();
    const r = await run({ brands: ['A', 'Zzz'] }, 'csv', 'separate');
    expect(r.files.map((f) => f.name)).toEqual(['A.csv']);
    expect(r.warnings.join(' ')).toContain('No file created for Brand "Zzz"');
    await expect(run({ brands: ['Nope', 'Zzz'] }, 'csv', 'separate')).rejects.toThrow(/No records match/);
  });

  it('(No Brand) is a selectable brand and gets its own file; colliding names get a suffix', async () => {
    const { run } = await setup();
    let r = await run({ brands: ['A', '(No Brand)'] }, 'csv', 'separate');
    expect(r.files.map((f) => f.name)).toEqual(['A.csv', '(No Brand).csv']); expect(r.files[1].records).toBe(1);
    r = await run({ brands: ['X_Y', 'X Y'] }, 'csv', 'separate');
    expect(r.files.map((f) => f.name)).toEqual(['X Y.csv', 'X Y (2).csv']);
  });

  it('writes ONE log row per run with mode, file count, file names and per-file records', async () => {
    const { run, paths } = await setup();
    const r = await run({ brands: ['A', 'B', 'C'], customers: [], approvalStatuses: ['approved'] }, 'xlsx', 'separate');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(paths.logFile); const ws = wb.getWorksheet('Processing Log')!;
    expect(ws.actualRowCount).toBe(2);
    const head = (ws.getRow(1).values as string[]).slice(1), row = ws.getRow(2);
    const c = (h: string) => String(row.getCell(head.indexOf(h) + 1).value);
    expect(c('Run ID')).toBe(r.runId); expect(c('Output Mode')).toBe('Separate Files per Brand'); expect(c('Output File Count')).toBe('3');
    expect(c('Output File Names')).toBe('A_approved.xlsx; B_approved.xlsx; C_approved.xlsx'); expect(c('Output File Records')).toBe('A_approved.xlsx: 3; B_approved.xlsx: 2; C_approved.xlsx: 2');
    expect(c('Brand Selection')).toBe('A; B; C'); expect(c('Approval Selection')).toBe('approved'); expect(c('Processing Status')).toBe('Success');
    expect(c('Records Read')).toBe('10'); expect(c('Output Format')).toBe('xlsx');
    await run({ brands: ['A'] }, 'csv');
    const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.readFile(paths.logFile);
    expect(wb2.getWorksheet('Processing Log')!.actualRowCount).toBe(3);                  // history kept, new row appended
    expect(String(wb2.getWorksheet('Processing Log')!.getRow(3).getCell(head.indexOf('Output Mode') + 1).value)).toBe('Single File');
  });

  it('an older log (before output mode existed) is extended, not replaced', async () => {
    const { run, paths } = await setup();
    const { mkdirSync } = await import('node:fs'); mkdirSync(paths.logsDir, { recursive: true });
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Processing Log'); ws.addRow(['Run ID', 'Output File Names']); ws.addRow(['RUN_OLD', 'old.xlsx']); await wb.xlsx.writeFile(paths.logFile);
    await run({ brands: ['A', 'B'] }, 'csv', 'separate');
    const r = new ExcelJS.Workbook(); await r.xlsx.readFile(paths.logFile); const s = r.getWorksheet('Processing Log')!;
    expect(s.getRow(2).getCell(1).value).toBe('RUN_OLD'); expect(s.getRow(2).getCell(2).value).toBe('old.xlsx');
    expect((s.getRow(1).values as string[]).slice(1)).toEqual(expect.arrayContaining(['Output Mode', 'Output File Count', 'Output File Records']));
  });

  it('a failed run leaves no partial files or empty run folder, and is logged', async () => {
    const { run, dir, paths } = await setup();
    writeFileSync(join(dir, 'a.tmx'), A.replace('tuid="3"', 'tuid="333"'));         // input changed after the scan
    await expect(run({ brands: ['A', 'B', 'C'] }, 'csv', 'separate')).rejects.toThrow(/changed after they were scanned/);
    const day = join(paths.outputRoot, readdirSync(paths.outputRoot)[0] ?? '');
    expect(existsSync(day) ? readdirSync(day) : []).toEqual([]);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(paths.logFile); const ws = wb.getWorksheet('Processing Log')!;
    const head = (ws.getRow(1).values as string[]).slice(1);
    expect(String(ws.getRow(2).getCell(head.indexOf('Processing Status') + 1).value)).toContain('Failed');
  });
});

describe('regression: filters, status, alignment, tags, CSV safety through the new pipeline', () => {
  it('Customer, Project, Approval, Date and Translation Status filters', async () => {
    const { ds, run } = await setup();
    const count = async (f: FilterCriteria) => (await run(f)).recordsSelected;
    expect(await count({ customers: ['Cust1'] })).toBe(8); expect(await count({ customers: ['Cust2'] })).toBe(2);
    expect(await count({ projects: ['P2'] })).toBe(3); expect(await count({ projects: ['P3'] })).toBe(1);
    expect(await count({ approvalStatuses: ['not approved'] })).toBe(1);
    expect(await count({ dateFrom: new Date('2026-04-01T00:00:00Z'), dateTo: new Date('2026-06-30T23:59:59Z') })).toBe(2); // tu 4 and tu 6, by CREATION date
    const statuses = ds.scan().translationStatuses; expect(statuses).toEqual(['new', 'translated']);       // translation status is not approval status
    expect(ds.scan().approvalStatuses).toEqual(['approved', 'not approved']);
  });
  it('TMX keeps inline tags; Excel/CSV/Markdown are tag-free', async () => {
    const { run } = await setup();
    const t = await run({ brands: ['A'] }, 'tmx'); expect(readFileSync(t.files[0].path, 'utf8')).toContain('<ph x="1">{1}</ph>');
    const c = await run({ brands: ['A'] }, 'csv'); expect(readFileSync(c.files[0].path, 'utf8')).not.toMatch(/<ph|\{1\}/);
  });
  it('CSV stays formula-safe in separate mode', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bo-')); const p = join(dir, 'f.tmx');
    writeFileSync(p, file('en-GB', 'C', tu(1, ['A'], 'P', 'approved', 'new', [['en-GB', '=SUM(A1:A10)'], ['de-DE', '+1,5 "x"']]) + tu(2, ['B'], 'P', 'approved', 'new', [['en-GB', '@name'], ['de-DE', '-3']])));
    const ds = new Dataset(); await ds.addTmx(p, 'f.tmx');
    const r = await processRun({ inputs: [p], filter: { brands: ['A', 'B'] }, format: 'csv', paths: defaultPaths({ appData: join(dir, 'app'), outputRoot: join(dir, 'out') }), dataset: ds, outputMode: 'separate' });
    expect(readFileSync(r.files[0].path, 'utf8')).toContain(`'=SUM(A1:A10),"'+1,5 ""x"""`);
    expect(readFileSync(r.files[1].path, 'utf8')).toContain(`'@name,'-3`);
  });
});
