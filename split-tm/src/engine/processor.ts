import { mkdirSync, existsSync, rmSync, rmdirSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { Dataset, NO_BRAND } from './dataset.js';
import { FilterCriteria, ScanResult } from './model.js';
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
export interface OutputFileInfo { name: string; path: string; /** Set in 'separate' mode. */ brand?: string; records: number; }
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
  format: OutputFormat; durationMs: number; outputDir: string; outputFiles: string[];
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
  inputs: string[]; filter: FilterCriteria; format: OutputFormat; paths: AppPaths; onProgress?: (p: Progress) => void; now?: () => Date; dataset?: Dataset; outputMode?: OutputMode; marketOutputMode?: MarketOutputMode;
}): Promise<RunResult> {
  const { inputs, filter, format, paths, onProgress } = opts;
  const separate = opts.outputMode === 'separate' && (filter.brands?.length ?? 0) > 1;
  const individualMarkets = opts.marketOutputMode === 'individual';
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
    'Source Language': '', 'Target Languages': '', 'Output Format': format, 'Bilingual/Multilingual': '',
    'Language Mode': '', 'Records Read': 0, 'Records Selected': 0, 'Records Exported': 0, 'Records Skipped': 0, 'Skipped Details': '',
    'Output Mode': separate ? 'Separate Files per Brand' : 'Single File', 'Output File Count': 0, 'Output File Records': '', 'Output File Names': '', 'Processing Status': status, ...extra,
  });

  const openSinks: Sink[] = [], createdFiles: string[] = [];
  let outDirCreated: string | null = null, finished = false;
  try {
    // Pass 1 (only if the caller has not scanned yet): build the compact index. Pass 2 below streams the inputs again.
    const ds = opts.dataset ?? (await scanInputs(inputs, paths, onProgress)).ds;
    const read = ds.index.length + ds.skipped.length;
    onProgress?.({ stage: 'Filtering', recordsScanned: read, recordsSelected: 0 });
    const sel = planSelection(ds.index, filter);
    const mode = { all: 'All', selected: 'Selected', 'all-to-all': 'All-to-All' }[sel.mode];
    if (!sel.count) {
      const sk = skippedSummary(ds, 0, sel.excludedNoTarget);
      await appendLog(paths.logFile, rec('No matching records', { 'Records Read': read, 'Records Skipped': ds.skipped.length, 'Skipped Details': sk.text, 'Language Mode': mode }));
      throw new Error(sel.filteredCount
        ? 'No translation units have both a selected source language and a selected target language. Adjust the language selection and try again.'
        : 'No records match the selected filters. Adjust the selection and try again.');
    }
    const outDir = join(paths.outputRoot, dateFolder(start), runId);
    mkdirSync(outDir, { recursive: true });
    outDirCreated = outDir;
    onProgress?.({ stage: 'Exporting', recordsScanned: read, recordsSelected: sel.count });

    // Output jobs combine brand mode with language-market mode. Individual market files always contain
    // exactly one source/target pair, while combined mode preserves the existing multilingual export.
    interface Job { brand?: string; sel: Selection; file: string; sink: Sink; written: number }
    const jobs: Job[] = [];
    const usedNames = new Set<string>();
    const emptyBrands: string[] = [];
    const brandList = separate ? filter.brands! : [undefined];
    for (const brand of brandList) {
      const brandFilter = brand === undefined ? filter : { ...filter, brands: [brand] };
      const brandSelection = brand === undefined ? sel : planSelection(ds.index, brandFilter);
      if (!brandSelection.count) { if (brand) emptyBrands.push(brand); continue; }

      const plans: Array<{ source?: string; target?: string; selection: Selection }> = [];
      if (individualMarkets) {
        for (const source of brandSelection.sources) {
          for (const target of brandSelection.targetsUsed) {
            if (source === target) continue;
            const pairFilter: FilterCriteria = { ...brandFilter, sourceLanguages: [source], targetLanguages: [target], allToAll: false };
            const pairSelection = planSelection(ds.index, pairFilter);
            if (pairSelection.count) plans.push({ source, target, selection: pairSelection });
          }
        }
      } else {
        plans.push({ selection: brandSelection });
      }

      for (const plan of plans) {
        const selected = plan.selection;
        const baseName = plan.source && plan.target
          ? `${outputBaseName(brandFilter)}_${plan.source}_${plan.target}`
          : outputBaseName(brandFilter);
        let name = baseName, n = 1;
        while (usedNames.has(name.toLowerCase())) name = `${baseName} (${++n})`;
        usedNames.add(name.toLowerCase());
        const file = join(outDir, `${name}.${format}`);
        const customers = new Set<string>();
        for (let i = 0; i < ds.index.length; i++) if (selected.mask[i]) customers.add(ds.index[i].customer);
        const sink = createSink(format, file, {
          columns: selected.columns,
          tmx: { srclang: selected.sources.length === 1 ? selected.sources[0] : '*all*', headerAttrs: ds.headerAttrs, customer: customers.size === 1 && [...customers][0] ? [...customers][0] : undefined },
        });
        openSinks.push(sink); createdFiles.push(file);
        jobs.push({ brand, sel: selected, file, sink, written: 0 });
      }
    }
    if (!jobs.length) throw new Error('No output files could be created for the selected brand and language combinations.');

    // Pass 2: stream the inputs once and route each selected unit to every output file it belongs to.
    const emptyOrdinals = new Set<number>();
    let handled = 0;
    await ds.forEachUnit((u, ord) => {
      for (const j of jobs) {
        if (!j.sel.mask[ord]) continue;
        const t = trimUnit(u, j.sel.sets);
        if (!t) continue;
        if (format !== 'tmx' && !plain(u.source.text)) emptyOrdinals.add(ord);
        j.sink.write(t); j.written++;
      }
      handled++;
    }, (n) => onProgress?.({ stage: 'Exporting', recordsScanned: read, recordsSelected: Math.min(handled, sel.count), currentFile: `${n}` }));
    const closed = await Promise.all(jobs.map((j) => j.sink.close()));
    finished = true;

    const exported = closed.reduce((t, c) => t + c.exported, 0);
    const files: OutputFileInfo[] = jobs.map((j, i) => ({ name: basename(j.file), path: j.file, brand: j.brand, records: closed[i].exported }));
    const sk = skippedSummary(ds, emptyOrdinals.size, sel.excludedNoTarget);
    for (const b of emptyBrands) sk.warnings.push(`No file created for Brand "${b}": no records match the other selected filters and languages`);
    const skipped = ds.skipped.length + emptyOrdinals.size;
    onProgress?.({ stage: 'Logging', recordsScanned: read, recordsSelected: sel.count });
    const end = now();
    await appendLog(paths.logFile, rec('Success', {
      'Source Language': sel.sources.map(outLang).join('; '), 'Target Languages': sel.targetsUsed.map(outLang).join('; '),
      'Bilingual/Multilingual': sel.columns.length > 2 ? 'Multilingual' : 'Bilingual', 'Language Mode': mode,
      'Records Read': read, 'Records Selected': sel.count, 'Records Exported': exported, 'Records Skipped': skipped,
      'Skipped Details': [sk.text, ...emptyBrands.map((b) => `no file for Brand ${b}`)].filter(Boolean).join('; ').slice(0, 3000),
      'Output File Count': files.length, 'Output File Records': files.map((f) => `${f.name}: ${f.records}`).join('; '),
      'Output File Names': files.map((f) => f.name).join('; '), 'End Time': hms(end), 'Duration (s)': Math.round((end.getTime() - start.getTime()) / 100) / 10,
    }));
    onProgress?.({ stage: 'Done', recordsScanned: read, recordsSelected: sel.count });
    return {
      runId, inputFileCount: inputs.length, recordsRead: read, recordsSelected: sel.count, recordsExported: exported, recordsSkipped: skipped,
      warnings: [...sk.warnings, ...ds.warnings], languages: sel.columns.map(outLang), format, durationMs: end.getTime() - start.getTime(), outputDir: outDir,
      outputFiles: files.map((f) => f.path), outputMode: separate ? 'separate' : 'single', files,
    };
  } catch (e) {
    if (!finished && outDirCreated) {
      // An unfinished run must not leave half-written files behind that look like results.
      await Promise.all(openSinks.map((k) => k.close().catch(() => undefined)));
      for (const f of createdFiles) rmSync(f, { force: true });
      try { rmdirSync(outDirCreated); } catch { /* not empty or already gone */ }
    }
    const msg = (e as Error).message;
    if (!msg.startsWith('No records match') && !msg.startsWith('No translation units have')) {
      try { await appendLog(paths.logFile, rec(`Failed: ${msg}`.slice(0, 250))); } catch { /* log failure must not mask the original error */ }
    }
    throw e;
  }
}
export { NO_BRAND };
