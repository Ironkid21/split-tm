import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Dataset, filterUnits } from '../src/engine/dataset';
import { applyLanguages } from '../src/engine/languages';
import { buildTable } from '../src/engine/exporters';
import { processRun } from '../src/engine/processor';
import { defaultPaths } from '../src/engine/paths';
import { langLabel } from '../src/shared/lang';

const tuv = (l: string, t: string) => `<tuv xml:lang="${l}"><seg>${t}</seg></tuv>`;
const tmx = (src: string, body: string) => `<?xml version="1.0"?><tmx version="1.4"><header srclang="${src}"/><body>${body}</body></tmx>`;
const A = tmx('en-GB', [
  `<tu tuid="1">${tuv('en-GB', 'Hello')}${tuv('de-DE', 'Hallo')}${tuv('fr-FR', 'Bonjour')}</tu>`,
  `<tu tuid="2">${tuv('en-GB', 'Bye')}${tuv('de-DE', 'Tschüss')}</tu>`,
  `<tu tuid="3">${tuv('en-GB', '=SUM(A1:A10)')}${tuv('fr-FR', '=SOMME(A1:A10)')}</tu>`,
  `<tu tuid="4">${tuv('de-DE', 'Kein Quelltext')}${tuv('fr-FR', 'Pas de source')}</tu>`,
].join(''));
const B = tmx('de-DE', [
  `<tu tuid="5">${tuv('de-DE', 'Danke')}${tuv('en-GB', 'Thanks')}</tu>`,
  `<tu tuid="6">${tuv('de-DE', 'Nur Deutsch')}</tu>`,
].join(''));

async function load() {
  const dir = mkdtempSync(join(tmpdir(), 'lang-'));
  writeFileSync(join(dir, 'a.tmx'), A); writeFileSync(join(dir, 'b.tmx'), B);
  const ds = new Dataset({ keepUnits: true }); await ds.addFile(join(dir, 'a.tmx'), 'a.tmx'); await ds.addFile(join(dir, 'b.tmx'), 'b.tmx');
  return { ds, dir };
}

describe('multiple source languages', () => {
  it('discovers all sources/targets and logs units with no source entry instead of dropping them silently', async () => {
    const { ds } = await load();
    const s = ds.scan();
    expect(s.unitCount).toBe(5); expect(s.skippedCount).toBe(1);
    expect(s.sourceLanguages).toEqual(['de-DE', 'en-GB']);
    expect(ds.skipped[0]).toMatchObject({ tuid: '4', sourceFile: 'a.tmx' });
    expect(ds.skipped[0].reason).toContain('Missing source-language entry (en-GB)');
    expect(ds.facets().sourceLanguages).toEqual({ 'de-DE': 2, 'en-GB': 3 });
  });

  it('default / All-to-All: one consolidated table, sources first, aligned, blanks kept', async () => {
    const { ds } = await load();
    for (const f of [{}, { allToAll: true }, { allToAll: true, sourceLanguages: ['xx'], targetLanguages: ['yy'] }]) {
      const plan = applyLanguages(filterUnits(ds.units, {}), f);
      expect(plan.columns).toEqual(['de-DE', 'en-GB', 'fr-FR']);
      expect(plan.excludedNoTarget).toBe(1); // tuid 6 has no target at all
      const t = buildTable(plan.units, plan.columns);
      expect(t.header).toEqual(['de_DE', 'en_GB', 'fr_FR']);
      expect(t.rows).toEqual([
        ['Hallo', 'Hello', 'Bonjour'],
        ['Tschüss', 'Bye', ''],
        ['', '=SUM(A1:A10)', '=SOMME(A1:A10)'],
        ['Danke', 'Thanks', ''],
      ]);
    }
  });

  it('one source + one target', async () => {
    const { ds } = await load();
    const plan = applyLanguages(ds.units, { sourceLanguages: ['en-GB'], targetLanguages: ['de-DE'] });
    expect(plan.columns).toEqual(['en-GB', 'de-DE']);
    expect(buildTable(plan.units, plan.columns).rows).toEqual([['Hello', 'Hallo'], ['Bye', 'Tschüss']]);
    expect(plan.excludedNoTarget).toBe(1); // tuid 3 has no German
  });

  it('multiple sources + one target; target column kept when nothing translated', async () => {
    const { ds } = await load();
    const p1 = applyLanguages(ds.units, { sourceLanguages: ['en-GB', 'de-DE'], targetLanguages: ['fr-FR'] });
    expect(p1.columns).toEqual(['en-GB', 'fr-FR']);
    expect(p1.units.map((u) => u.tuid)).toEqual(['1', '3']);
    const p2 = applyLanguages(ds.units, { sourceLanguages: ['de-DE'], targetLanguages: ['en-GB', 'fr-FR'] });
    expect(p2.columns).toEqual(['de-DE', 'en-GB', 'fr-FR']);
    expect(buildTable(p2.units, p2.columns).rows).toEqual([['Danke', 'Thanks', '']]);
  });

  it('one run = one output file, with language mode and skipped records in the log', async () => {
    const { ds, dir } = await load();
    const paths = defaultPaths({ appData: join(dir, 'app'), outputRoot: join(dir, 'out') });
    const r = await processRun({ inputs: [join(dir, 'a.tmx'), join(dir, 'b.tmx')], filter: { allToAll: true }, format: 'csv', paths, dataset: ds });
    expect(readdirSync(r.outputDir)).toHaveLength(1);
    expect(r).toMatchObject({ recordsRead: 6, recordsSelected: 4, recordsExported: 4, recordsSkipped: 1, languages: ['de_DE', 'en_GB', 'fr_FR'] });
    expect(r.warnings.join(' ')).toContain('not exported');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(paths.logFile); const ws = wb.getWorksheet('Processing Log')!;
    const head = (ws.getRow(1).values as string[]).slice(1); const row = ws.getRow(2);
    const cell = (h: string) => String(row.getCell(head.indexOf(h) + 1).value);
    expect(cell('Language Mode')).toBe('All-to-All'); expect(cell('Records Skipped')).toBe('1'); expect(cell('Records Read')).toBe('6');
    expect(cell('Skipped Details')).toContain('Missing source-language entry (en-GB)'); expect(cell('Skipped Details')).toContain('4 [a.tmx]');
    expect(cell('Source Language')).toBe('de_DE; en_GB'); expect(cell('Target Languages')).toBe('de_DE; en_GB; fr_FR');
    expect(readFileSync(r.outputFiles[0], 'utf8')).not.toContain('Kein Quelltext');
  });

  it('TMX output keeps only selected languages and uses *all* for several sources', async () => {
    const { ds, dir } = await load();
    const paths = defaultPaths({ appData: join(dir, 'app2'), outputRoot: join(dir, 'out2') });
    const r = await processRun({ inputs: [join(dir, 'a.tmx')], filter: { sourceLanguages: ['en-GB', 'de-DE'], targetLanguages: ['en-GB', 'fr-FR'] }, format: 'tmx', paths, dataset: ds });
    const out = readFileSync(r.outputFiles[0], 'utf8');
    expect(out).toContain('srclang="*all*"'); expect(out).toContain('xml:lang="fr-FR"'); expect(out).toContain('Danke');
    expect(out).not.toContain('Tschüss'); expect(out).not.toContain('Kein Quelltext'); // de target of an en unit / unit without source
  });

  it('reports a clear error when no unit has both selected languages', async () => {
    const { ds, dir } = await load();
    const paths = defaultPaths({ appData: join(dir, 'app3'), outputRoot: join(dir, 'out3') });
    await expect(processRun({ inputs: [join(dir, 'a.tmx')], filter: { sourceLanguages: ['fr-FR'], targetLanguages: ['de-DE'] }, format: 'csv', paths, dataset: ds })).rejects.toThrow(/selected source language and a selected target language|No records match/);
  });

  it('shows language name and code', () => {
    expect(langLabel('en-GB')).toBe('English — en_GB'); expect(langLabel('de_DE')).toBe('German — de_DE'); expect(langLabel('qq-ZZ')).toBe('qq_ZZ');
  });
});
