import { mkdirSync, existsSync, rmSync, rmdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { Dataset, NO_BRAND } from './dataset.js';
import { FilterCriteria, ScanResult, OutputConfiguration } from './model.js';
import { planSelection, trimUnit, Selection } from './languages.js';
import { createSink, outLang, plain, Sink } from './exporters.js';
import { AppPaths } from './paths.js';
import { newRunId, dateFolder } from './runId.js';
import { appendLog, LogRecord } from './processingLog.js';
import { APP_VERSION } from './version.js';

export type OutputFormat = 'tmx' | 'xlsx' | 'csv' | 'md';
/** 'separate' only applies when more than one Brand is selected; otherwise a run always produces one file. */
export type OutputMode = 'single' | 'separate';
/** Combined keeps selected languages together; individual creates a bilingual file per source-target market pair. */
export type MarketOutputMode = 'combined' | 'individual';
export interface OutputFileInfo { name: string; path: string; brand?: string; approvalStatus?: string; project?: string; market?: string; format?: OutputFormat; records: number; }
export type Stage = 'Extracting' | 'Scanning' | 'Filtering' | 'Exporting' | 'Logging' | 'Done';
export interface Progress { stage: Stage; currentFile?: string; recordsScanned: number; recordsSelected: number; }

export interface RunResult {
  runId: string; inputFileCount: number;
  /** All translation units found in the inputs, including skipped ones. */
  recordsRead: number;
  /** Units that passed the filters and the language selection. */
  recordsSelected: number;
  /** Rows/units actually written to the output file. */
  recordsExported: number;
  /** Units skipped because of a data problem (missing source-language entry, empty source text). */
  recordsSkipped: number;
  /** Human-readable explanation lines for anything skipped or not exported (first entries only). */
  warnings: string[];
  languages: string[];
  format: OutputFormat; formats: OutputFormat[]; durationMs: number; outputDir: string; outputFiles: string[];
  outputMode: OutputMode;
  /** One entry per generated file (same Run ID / folder for all). */
  files: OutputFileInfo[];
}

const MAX_LISTED = 20;
function skippedSummary(ds: Dataset, emptySource: number, noTarget: number): { text: string; warnings: string[] } {
  const parts: string[] = [];
  if (ds.skipped.length) {
    const shown = ds.skipped.slice(0, MAX_LISTED).map((k) => `${k.tuid || '(no tuid)'} [${k.sourceFile}]`).join(', ');
    const reasons = [...new Set(ds.skipped.map((k) => k.reason))].join(' / ');
    parts.push(`${ds.skipped.length} skipped - ${reasons}: TUID ${shown}${ds.skipped.length > MAX_LISTED ? `, and ${ds.skipped.length - MAX_LISTED} more` : ''}`);
  }
  if (emptySource) parts.push(`${emptySource} skipped - source text empty after removing inline tags`);
  if (noTarget) parts.push(`${noTarget} not exported - none of the selected target languages present`);
  return { text: parts.join('; ').slice(0, 3000), warnings: parts };
}

const p2 = (n: number) => String(n).padStart(2, '0');
const hms = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
const ISSUES = /[<>:"/\\|?*\u0000-\u001f]/g;

export function safeName(s: string, max = 80) {
  const t = s.replace(ISSUES, '_').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return (t || 'Output').slice(0, max);
}

export function outputBaseName(f: FilterCriteria): string {
  const b = (f.brands ?? []).map((x) => x.replace(/_/g, ' '));
  let name = !b.length ? 'All Brands' : b.length <= 2 ? b.join(' + ') : `${b.length} Brands`;
  if (f.approvalStatuses?.length === 1) name += `_${f.approvalStatuses[0]}`;
  return safeName(name);
}

function dimensionFileName(brand: string, approval: string, language: string, project: string) {
  const token = (v: string) => safeName(v.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase(), 48) || 'UNKNOWN';
  return [token(brand), token(approval), token(language), token(project)].join('_');
}

export async function scanInputs(inputs: string[], _paths: AppPaths, onProgress?: (p: Progress) => void) {
  const ds = new Dataset();
  ds.onProgress = (n, file) => onProgress?.({ stage: 'Scanning', currentFile: file, recordsScanned: n, recordsSelected: 0 });
  for (const input of inputs) {
    const ext = extname(input).toLowerCase();
    if (ext !== '.tmx' && ext !== '.zip') throw new Error(`Unsupported file type "${ext || basename(input)}". Add .tmx or .zip files.`);
    if (!existsSync(input)) throw new Error(`File not found: ${input}`);
    onProgress?.({ stage: 'Scanning', currentFile: basename(input), recordsScanned: ds.index.length, recordsSelected: 0 });
    // TMX files are read in place and ZIP entries are streamed from the archive: no copy of the input is ever written to disk.
    if (ext === '.zip') await ds.addZip(input, basename(input)); else await ds.addTmx(input, basename(input));
  }
  return { ds, scan: ds.scan() as ScanResult };
}

export async function processRun(opts: {
  inputs: string[]; filter: FilterCriteria; format?: OutputFormat; formats?: OutputFormat[]; outputConfig?: OutputConfiguration;
  paths: AppPaths; onProgress?: (p: Progress) => void; now?: () => Date; dataset?: Dataset; outputMode?: OutputMode; marketOutputMode?: MarketOutputMode;
}): Promise<RunResult> {
  const { inputs, filter, paths, onProgress } = opts;
  const legacyCall = !opts.outputConfig;
  const config: OutputConfiguration = opts.outputConfig ?? {
    brandMode: opts.outputMode ?? 'single', marketMode: opts.marketOutputMode ?? 'combined',
    approvalMode: 'single', projectMode: 'single', formats: [opts.format ?? 'xlsx'],
  };
  const formats = [...new Set(config.formats.length ? config.formats : [opts.format ?? 'xlsx'])];
  const format = formats[0];
  const now = opts.now ?? (() => new Date());
  const start = now();
  const runId = newRunId(start, paths.outputRoot);
  const rec = (status: string, extra: Partial<LogRecord> = {}): LogRecord => ({
    'Run ID': runId, 'Application Version': APP_VERSION, 'Run Date': dateFolder(start), 'Start Time': hms(start), 'End Time': hms(now()),
    'Duration (s)': Math.round((now().getTime() - start.getTime()) / 100) / 10,
    'Input File Count': inputs.length, 'Input File Names': inputs.map((i) => basename(i)).join('; '),
    'Input File Types': [...new Set(inputs.map((i) => extname(i).slice(1).toLowerCase()))].join('; '),
    'Customer Selection': (filter.customers ?? []).join('; ') || 'All', 'Brand Selection': (filter.brands ?? []).join('; ') || 'All',
    'Project Selection': (filter.projects ?? []).join('; ') || 'All', 'Approval Selection': (filter.approvalStatuses ?? []).join('; ') || 'All',
    'Date Range': filter.dateFrom || filter.dateTo ? `creation date: ${filter.dateFrom?.toISOString().slice(0, 10) ?? ''}..${filter.dateTo?.toISOString().slice(0, 10) ?? ''}` : 'All',
    'Source Language': '', 'Target Languages': '', 'Output Format': formats.join('; '), 'Bilingual/Multilingual': '',
    'Language Mode': '', 'Records Read': 0, 'Records Selected': 0, 'Records Exported': 0, 'Records Skipped': 0, 'Skipped Details': '',
    'Output Mode': legacyCall ? (opts.outputMode === 'separate' && (filter.brands?.length ?? 0) > 1 ? 'Separate Files per Brand' : 'Single File') : `Brand:${config.brandMode}; Market:${config.marketMode}; Approval:${config.approvalMode}; Project:${config.projectMode}`,
    'Output File Count': 0, 'Output File Records': '', 'Output File Names': '', 'Processing Status': status, ...extra,
  });
  const openSinks: Sink[] = [], createdFiles: string[] = [];
  let outDirCreated: string | null = null, finished = false;
  try {
    const ds = opts.dataset ?? (await scanInputs(inputs, paths, onProgress)).ds;
    const read = ds.index.length + ds.skipped.length;
    onProgress?.({ stage: 'Filtering', recordsScanned: read, recordsSelected: 0 });
    const overall = planSelection(ds.index, filter);
    const languageMode = { all: 'All', selected: 'Selected', 'all-to-all': 'All-to-All' }[overall.mode];
    if (!overall.count) {
      const sk = skippedSummary(ds, 0, overall.excludedNoTarget);
      await appendLog(paths.logFile, rec('No matching records', { 'Records Read': read, 'Records Skipped': ds.skipped.length, 'Skipped Details': sk.text, 'Language Mode': languageMode }));
      throw new Error(overall.filteredCount ? 'No translation units have both a selected source language and a selected target language. Adjust the language selection and try again.' : 'No records match the selected filters. Adjust the selection and try again.');
    }
    if (!formats.length || formats.some((f) => !['tmx', 'xlsx', 'csv', 'md'].includes(f))) throw new Error('Select at least one supported output format.');
    const outDir = join(paths.outputRoot, dateFolder(start), runId);
    mkdirSync(outDir, { recursive: true }); outDirCreated = outDir;
    onProgress?.({ stage: 'Exporting', recordsScanned: read, recordsSelected: overall.count });

    type DimGroup = { value?: string; values: string[]; label: string; filterKey: 'brands' | 'approvalStatuses' | 'projects' };
    const unique = (key: 'brands' | 'approvalStatuses' | 'projects') => {
      const values = new Set<string>();
      for (const m of ds.index) {
        const list = key === 'brands' ? (m.brands.length ? m.brands : [NO_BRAND]) : key === 'projects' ? m.projects : [m.approvalStatus];
        for (const v of list) if (v || key === 'approvalStatuses') values.add(v);
      }
      const selected = key === 'brands' ? filter.brands : key === 'projects' ? filter.projects : filter.approvalStatuses;
      // Preserve the user's explicit selection order for predictable output file ordering.
      // When the dimension is unfiltered, keep a stable alphabetical order from the dataset.
      return [...new Set(selected?.length ? selected : [...values].sort())];
    };
    const groups = (key: DimGroup['filterKey'], mode: 'single' | 'separate'): DimGroup[] => {
      const values = unique(key);
      if (mode === 'separate' && values.length > 1) return values.map((v) => ({ value: v, values: [v], label: v, filterKey: key }));
      return [{ values, label: values.length > 1 ? `MULTIPLE_${key === 'brands' ? 'BRANDS' : key === 'projects' ? 'PROJECTS' : 'STATUSES'}` : (values[0] || (key === 'approvalStatuses' ? 'UNKNOWN' : 'ALL')), filterKey: key }];
    };
    const brandGroups = groups('brands', config.brandMode);
    const approvalGroups = groups('approvalStatuses', config.approvalMode);
    const projectGroups = groups('projects', config.projectMode);
    const marketGroups: Array<{ source?: string; target?: string; label: string }> = [];
    if (config.marketMode === 'individual') {
      for (const source of overall.sources) for (const target of overall.targetsUsed) if (source !== target) marketGroups.push({ source, target, label: `${source}-${target}` });
    } else marketGroups.push({ label: overall.sources.length === 1 && overall.targetsUsed.length === 1 ? `${overall.sources[0]}-${overall.targetsUsed[0]}` : 'MULTIPLE_LANGUAGES' });

    interface Job { selection: Selection; file: string; sink: Sink; written: number; format: OutputFormat; brand?: string; approvalStatus?: string; project?: string; market: string }
    const jobs: Job[] = []; const usedNames = new Set<string>(); const emptyCombos: string[] = [];
    const safeToken = (v: string) => safeName(v.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase(), 48) || 'UNKNOWN';
    for (const bg of brandGroups) for (const ag of approvalGroups) for (const pg of projectGroups) for (const mg of marketGroups) {
      const jobFilter: FilterCriteria = { ...filter, brands: bg.values.length ? bg.values : filter.brands, approvalStatuses: filter.approvalStatuses?.length || config.approvalMode === 'separate' ? ag.values : filter.approvalStatuses, projects: filter.projects?.length || config.projectMode === 'separate' ? pg.values : filter.projects, ...(mg.source && mg.target ? { sourceLanguages: [mg.source], targetLanguages: [mg.target], allToAll: false } : {}) };
      const selection = planSelection(ds.index, jobFilter);
      if (!selection.count) { emptyCombos.push(`${bg.label} / ${ag.label} / ${mg.label} / ${pg.label}`); continue; }
      const b = bg.values.length > 1 ? 'MULTIPLE_BRANDS' : safeToken(bg.label);
      const a = ag.values.length > 1 ? 'MULTIPLE_STATUSES' : safeToken(ag.label);
      const l = mg.source && mg.target ? `${safeToken(mg.source)}-${safeToken(mg.target)}` : mg.label === 'MULTIPLE_LANGUAGES' ? 'MULTIPLE_LANGUAGES' : safeToken(mg.label);
      const pr = pg.values.length > 1 ? 'MULTIPLE_PROJECTS' : safeToken(pg.label);
      const legacyBrandFilter: FilterCriteria = bg.value ? { ...filter, brands: [bg.value] } : filter;
      const base = legacyCall ? safeName(`${outputBaseName(legacyBrandFilter)}${mg.source && mg.target ? `_${mg.source}_${mg.target}` : ''}`) : dimensionFileName(b, a, l, pr);
      for (const fmt of formats) {
        let name = base, n = 1;
        while (usedNames.has(`${name}.${fmt}`.toLowerCase())) name = `${base}_${++n}`;
        usedNames.add(`${name}.${fmt}`.toLowerCase());
        const file = join(outDir, `${name}.${fmt}`);
        const customers = new Set<string>();
        for (let i = 0; i < ds.index.length; i++) if (selection.mask[i]) customers.add(ds.index[i].customer);
        const sink = createSink(fmt, file, { columns: selection.columns, tmx: { srclang: selection.sources.length === 1 ? selection.sources[0] : '*all*', headerAttrs: ds.headerAttrs, customer: customers.size === 1 ? [...customers][0] : undefined } });
        openSinks.push(sink); createdFiles.push(file);
        jobs.push({ selection, file, sink, written: 0, format: fmt, brand: bg.value, approvalStatus: ag.value, project: pg.value, market: mg.label });
      }
    }
    if (!jobs.length) throw new Error('No output files could be created for the selected dimension combinations.');

    const emptyOrdinals = new Set<number>(); let handled = 0;
    await ds.forEachUnit((u, ord) => {
      for (const j of jobs) {
        if (!j.selection.mask[ord]) continue;
        const t = trimUnit(u, j.selection.sets); if (!t) continue;
        if (j.format !== 'tmx' && !plain(u.source.text)) emptyOrdinals.add(ord);
        j.sink.write(t); j.written++;
      }
      handled++;
    }, (n) => onProgress?.({ stage: 'Exporting', recordsScanned: read, recordsSelected: Math.min(handled, overall.count), currentFile: `${n}` }));
    const closed = await Promise.all(jobs.map((j) => j.sink.close())); finished = true;
    const exported = closed.reduce((t, c) => t + c.exported, 0);
    const files: OutputFileInfo[] = jobs.map((j, i) => ({ name: basename(j.file), path: j.file, brand: j.brand, approvalStatus: j.approvalStatus, project: j.project, market: j.market, format: j.format, records: closed[i].exported }));
    const sk = skippedSummary(ds, emptyOrdinals.size, overall.excludedNoTarget);
    if (emptyCombos.length) {
      if (legacyCall && config.brandMode === 'separate') {
        const missing = brandGroups.filter((g) => !jobs.some((j) => j.brand === g.value)).map((g) => g.value).filter(Boolean);
        for (const b of missing) sk.warnings.push(`No file created for Brand "${b}": no records match the other selected filters and languages`);
      } else sk.warnings.push(`${emptyCombos.length} empty output combination(s) were skipped: ${emptyCombos.slice(0, 12).join('; ')}${emptyCombos.length > 12 ? '; …' : ''}`);
    }
    const skipped = ds.skipped.length + emptyOrdinals.size;
    onProgress?.({ stage: 'Logging', recordsScanned: read, recordsSelected: overall.count });
    const end = now();
    await appendLog(paths.logFile, rec('Success', {
      'Source Language': overall.sources.map(outLang).join('; '), 'Target Languages': overall.targetsUsed.map(outLang).join('; '),
      'Bilingual/Multilingual': overall.columns.length > 2 ? 'Multilingual' : 'Bilingual', 'Language Mode': languageMode,
      'Records Read': read, 'Records Selected': overall.count, 'Records Exported': exported, 'Records Skipped': skipped,
      'Skipped Details': [...sk.warnings, ...emptyCombos.slice(0, 30)].join('; ').slice(0, 3000),
      'Output File Count': files.length, 'Output File Records': files.map((f) => `${f.name}: ${f.records}`).join('; '),
      'Output File Names': files.map((f) => f.name).join('; '), 'End Time': hms(end), 'Duration (s)': Math.round((end.getTime() - start.getTime()) / 100) / 10,
    }));
    onProgress?.({ stage: 'Done', recordsScanned: read, recordsSelected: overall.count });
    return { runId, inputFileCount: inputs.length, recordsRead: read, recordsSelected: overall.count, recordsExported: exported, recordsSkipped: skipped, warnings: [...sk.warnings, ...ds.warnings], languages: overall.columns.map(outLang), format, formats, durationMs: end.getTime() - start.getTime(), outputDir: outDir, outputFiles: files.map((f) => f.path), outputMode: legacyCall && (filter.brands?.length ?? 0) <= 1 ? 'single' : config.brandMode, files };
  } catch (e) {
    if (!finished && outDirCreated) {
      await Promise.all(openSinks.map((k) => k.close().catch(() => undefined)));
      for (const f of createdFiles) rmSync(f, { force: true });
      try { rmdirSync(outDirCreated); } catch { /* non-empty or already removed */ }
    }
    const msg = (e as Error).message;
    if (!msg.startsWith('No records match') && !msg.startsWith('No translation units have')) {
      try { await appendLog(paths.logFile, rec(`Failed: ${msg}`.slice(0, 250))); } catch { /* preserve original error */ }
    }
    throw e;
  }
}

export { NO_BRAND };
