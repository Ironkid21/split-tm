import ExcelJS from 'exceljs';
import { createWriteStream, writeFileSync, type WriteStream } from 'node:fs';
import { TranslationUnit } from './model.js';
import { APP_VERSION } from './version.js';
import { csvField } from './csvSafe.js';

export interface Table { header: string[]; rows: string[][]; emptySource: number; }
export type TabularFormat = 'xlsx' | 'csv' | 'md';

// ---------- text only (Excel / CSV / Markdown) ----------
const CODE_TAGS = /<(bpt|ept|ph|it|ut)\b[^>]*>[\s\S]*?<\/\1>|<(x|bx|ex)\b[^>]*\/>/g;
const decode = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Text only: inline code elements (bpt/ept/ph/it/ut/x/bx/ex) are removed with their content; wrapper tags (hi/sub) keep their text. */
export const plain = (xml: string) => decode(xml.replace(CODE_TAGS, '').replace(/<[^>]+>/g, '').replace(/ {2,}/g, ' ')).trim();
export const outLang = (code: string) => code.replace(/-/g, '_');

/** Default column order: languages that are a source in the data first (sorted), then the others (sorted). */
export function defaultColumns(units: TranslationUnit[]): string[] {
  const src = new Set(units.map((u) => u.source.language));
  const rest = new Set(units.flatMap((u) => u.targets.map((t) => t.language)).filter((l) => !src.has(l)));
  return [...[...src].sort(), ...[...rest].sort()];
}

/** One row per unit, one text column per language; null when the unit's source has no text after tag removal. */
export function rowOf(u: TranslationUnit, columns: string[]): string[] | null {
  const own = plain(u.source.text);
  if (!own) return null;
  return columns.map((l) => (l === u.source.language ? own : plain(u.targets.find((t) => t.language === l)?.text ?? '')));
}

export function buildTable(units: TranslationUnit[], columns: string[] = defaultColumns(units)): Table {
  const rows: string[][] = []; let emptySource = 0;
  for (const u of units) { const r = rowOf(u, columns); if (r) rows.push(r); else emptySource++; }
  return { header: columns.map(outLang), rows, emptySource };
}

const BOM = '\uFEFF';
export const csvLine = (cells: string[], protect = true) => cells.map((c) => csvField(c, protect)).join(',') + '\r\n';
const mdCell = (v: string) => v.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
export const mdLine = (cells: string[]) => `| ${cells.map(mdCell).join(' | ')} |\n`;
export const mdHead = (header: string[]) => mdLine(header) + `|${header.map(() => '---').join('|')}|\n`;

export const toCsv = (t: Table, protect = true) => BOM + csvLine(t.header, protect) + t.rows.map((r) => csvLine(r, protect)).join('');
export const toMarkdown = (t: Table) => mdHead(t.header) + t.rows.map(mdLine).join('');

// ---------- TMX ----------
const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fmt = (d: Date | null) => (d ? d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') : '');
export interface TmxOptions { customer?: string; srclang: string; headerAttrs?: Record<string, string>; }

export function tmxHeader(opts: TmxOptions): string {
  const h: Record<string, string> = { segtype: 'sentence', 'o-tmf': 'unknown', adminlang: 'en', datatype: 'plaintext', ...(opts.headerAttrs ?? {}) };
  delete h.creationtool; delete h.creationtoolversion; delete h.srclang;
  const hAttrs = Object.entries(h).map(([k, v]) => `${k}="${x(v)}"`).join(' ');
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<tmx version="1.4">',
    `<header creationtool="Split TM" creationtoolversion="${APP_VERSION}" ${hAttrs} srclang="${x(opts.srclang)}">`,
    ...(opts.customer ? [`<prop type="user-defined">CUSTOMER: ${x(opts.customer)}</prop>`] : []), '</header>', '<body>'].join('\n');
}
export function tmxUnit(u: TranslationUnit): string {
  const extra = Object.entries(u.attrs ?? {}).map(([k, v]) => `${k}="${x(v)}"`);
  const attrs = [`tuid="${x(u.tuid)}"`, ...extra, u.creationDate && `creationdate="${fmt(u.creationDate)}"`, u.modifiedDate && `changedate="${fmt(u.modifiedDate)}"`].filter(Boolean).join(' ');
  const out = [`<tu ${attrs}>`];
  for (const [k, vals] of Object.entries(u.metadata)) for (const v of vals) out.push(`<prop type="${x(k)}">${x(v)}</prop>`);
  for (const s of [u.source, ...u.targets]) out.push(`<tuv xml:lang="${x(s.language)}"><seg>${s.text}</seg></tuv>`);
  out.push('</tu>');
  return out.join('\n');
}
export const tmxFooter = '</body>\n</tmx>';
export const toTmx = (units: TranslationUnit[], opts: TmxOptions) => [tmxHeader(opts), ...units.map(tmxUnit), tmxFooter].join('\n');

export const writeText = (path: string, s: string) => writeFileSync(path, s, 'utf8');

// ---------- streaming sinks (used by real runs: nothing but the current unit is held in memory) ----------
export interface Sink {
  write(u: TranslationUnit): void;
  writeRow(cells: string[]): void;
  close(): Promise<{ exported: number; emptySource: number }>;
}

class FileSink {
  protected ws: WriteStream; protected err: Error | null = null; exported = 0; emptySource = 0;
  constructor(file: string) { this.ws = createWriteStream(file, { encoding: 'utf8' }); this.ws.on('error', (e) => { this.err = e; }); }
  protected put(s: string) { if (this.err) throw this.err; this.ws.write(s); }
  protected end(): Promise<void> {
    return new Promise((res, rej) => { if (this.err) return rej(this.err); this.ws.once('error', rej); this.ws.end(() => (this.err ? rej(this.err) : res())); });
  }
}

class TextSink extends FileSink implements Sink {
  constructor(file: string, private columns: string[], private line: (c: string[]) => string, head: string) { super(file); this.put(head); }
  write(u: TranslationUnit) { const r = rowOf(u, this.columns); if (r) this.writeRow(r); else this.emptySource++; }
  writeRow(cells: string[]) { this.put(this.line(cells)); this.exported++; }
  async close() { await this.end(); return { exported: this.exported, emptySource: this.emptySource }; }
}

class TmxSink extends FileSink implements Sink {
  constructor(file: string, opts: TmxOptions) { super(file); this.put(tmxHeader(opts) + '\n'); }
  write(u: TranslationUnit) { this.put(tmxUnit(u) + '\n'); this.exported++; }
  writeRow(): void { throw new Error('TMX output takes units, not rows'); }
  async close() { this.put(tmxFooter + '\n'); await this.end(); return { exported: this.exported, emptySource: 0 }; }
}

/** Excel allows 1,048,576 rows per sheet; the output stays ONE workbook and continues on "TM 2", "TM 3", … when needed. */
export const XLSX_ROWS_PER_SHEET = 1_000_000;

class XlsxSink implements Sink {
  private wb: ExcelJS.stream.xlsx.WorkbookWriter; private ws!: ExcelJS.Worksheet; private rows = 0; private sheets = 0; exported = 0; emptySource = 0;
  constructor(file: string, private header: string[], private rowsPerSheet = XLSX_ROWS_PER_SHEET, private columns: string[] = []) {
    this.wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: true, useSharedStrings: false });
    this.sheet();
  }
  private sheet() {
    this.ws?.commit();
    this.ws = this.wb.addWorksheet(++this.sheets === 1 ? 'TM' : `TM ${this.sheets}`, { views: [{ state: 'frozen', ySplit: 1 }] });
    this.ws.columns = this.header.map(() => ({ width: 50 }));
    const h = this.ws.addRow(this.header); h.font = { bold: true }; h.commit();
    this.rows = 0;
  }
  write(u: TranslationUnit) { const r = rowOf(u, this.columns); if (r) this.writeRow(r); else this.emptySource++; }
  writeRow(cells: string[]) {
    if (this.rows >= this.rowsPerSheet) this.sheet();
    const r = this.ws.addRow(cells);
    r.eachCell((c) => { c.alignment = { wrapText: true, vertical: 'top' }; });
    r.commit(); this.rows++; this.exported++;
  }
  async close() { this.ws.commit(); await this.wb.commit(); return { exported: this.exported, emptySource: this.emptySource }; }
}

export function createSink(format: TabularFormat | 'tmx', file: string, o: { columns: string[]; tmx?: TmxOptions; rowsPerSheet?: number }): Sink {
  const header = o.columns.map(outLang);
  if (format === 'tmx') return new TmxSink(file, o.tmx!);
  if (format === 'xlsx') return new XlsxSink(file, header, o.rowsPerSheet, o.columns);
  if (format === 'csv') return new TextSink(file, o.columns, csvLine, BOM + csvLine(header));
  return new TextSink(file, o.columns, mdLine, mdHead(header));
}

/** In-memory table -> Excel file (same writer as real runs). */
export async function writeExcel(t: Table, path: string, rowsPerSheet?: number) {
  const s = createSink('xlsx', path, { columns: t.header, rowsPerSheet });
  t.rows.forEach((r) => s.writeRow(r));
  await s.close();
}
