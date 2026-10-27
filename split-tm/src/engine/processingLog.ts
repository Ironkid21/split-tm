import ExcelJS from 'exceljs';
import { existsSync, mkdirSync, copyFileSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { LOG_SCHEMA_VERSION } from './version.js';

export const LOG_COLUMNS = [
  'Run ID', 'Application Version', 'Run Date', 'Start Time', 'End Time', 'Duration (s)',
  'Input File Count', 'Input File Names', 'Input File Types', 'Customer Selection', 'Brand Selection',
  'Project Selection', 'Approval Selection', 'Date Range', 'Source Language', 'Target Languages',
  'Output Format', 'Bilingual/Multilingual', 'Language Mode', 'Records Read', 'Records Selected', 'Records Exported', 'Records Skipped',
  'Skipped Details', 'Output Mode', 'Output File Count', 'Output File Records', 'Output File Names', 'Processing Status',
] as const;

export type LogRecord = Record<(typeof LOG_COLUMNS)[number], string | number>;

const SHEET = 'Processing Log';
const META = 'Meta';

function friendly(e: unknown, path: string): Error {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES')
    return new Error(`The processing log is locked or not writable. Close "${path}" in Excel and try again.`);
  return e instanceof Error ? e : new Error(String(e));
}

function fixHeaders(ws: ExcelJS.Worksheet): { final: string[]; added: string[] } {
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (c, i) => { headers[i] = String(c.value ?? ''); });
  const existing = Array.from({ length: Math.max(0, headers.length - 1) }, (_, i) => headers[i + 1] || `Column ${i + 1}`);
  const added = LOG_COLUMNS.filter((c) => !existing.includes(c));
  // keep existing order and any unknown columns; append missing at the end
  const final = [...existing, ...added];
  final.forEach((h, i) => { ws.getRow(1).getCell(i + 1).value = h; });
  return { final, added: [...added] };
}

function setMeta(wb: ExcelJS.Workbook) {
  let meta = wb.getWorksheet(META);
  if (!meta) { meta = wb.addWorksheet(META); meta.state = 'hidden'; }
  meta.getCell('A1').value = 'schemaVersion';
  meta.getCell('B1').value = LOG_SCHEMA_VERSION;
}

async function writeAtomic(wb: ExcelJS.Workbook, logFile: string) {
  const tmp = `${logFile}.tmp`;
  try { await wb.xlsx.writeFile(tmp); renameSync(tmp, logFile); } catch (e) { rmSync(tmp, { force: true }); throw friendly(e, logFile); }
}

/** Brings an existing log up to the current schema without removing rows or columns. */
export async function migrateLog(logFile: string): Promise<{ migrated: boolean; added: string[]; note?: string }> {
  if (!existsSync(logFile)) return { migrated: false, added: [] };
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.readFile(logFile); } catch (e) {
    throw new Error(`The processing log could not be read (${(e as Error).message}). It has not been modified: ${logFile}`);
  }
  const schema = Number(wb.getWorksheet(META)?.getCell('B1').value ?? 0);
  if (schema > LOG_SCHEMA_VERSION) return { migrated: false, added: [], note: 'The processing log was created by a newer version and was left unchanged.' };
  const ws = wb.getWorksheet(SHEET) ?? wb.worksheets[0];
  const { added } = fixHeaders(ws);
  if (!added.length && schema === LOG_SCHEMA_VERSION) return { migrated: false, added: [] };
  ws.getRow(1).font = { bold: true };
  setMeta(wb);
  await writeAtomic(wb, logFile);
  return { migrated: true, added };
}

export async function appendLog(logFile: string, rec: LogRecord): Promise<void> {
  mkdirSync(dirname(logFile), { recursive: true });
  const wb = new ExcelJS.Workbook();
  let ws: ExcelJS.Worksheet;

  if (existsSync(logFile)) {
    try { await wb.xlsx.readFile(logFile); } catch (e) {
      throw new Error(`The processing log could not be read (${(e as Error).message}). It has not been modified: ${logFile}`);
    }
    ws = wb.getWorksheet(SHEET) ?? wb.worksheets[0];
  } else {
    ws = wb.addWorksheet(SHEET);
    LOG_COLUMNS.forEach((h, i) => { ws.getRow(1).getCell(i + 1).value = h; });
  }

  const { final, added } = fixHeaders(ws);
  if (added.length && existsSync(logFile))
    copyFileSync(logFile, logFile.replace(/\.xlsx$/, `.backup-v${LOG_SCHEMA_VERSION}.xlsx`));

  const row = ws.addRow(final.map((h) => (rec as Record<string, string | number>)[h] ?? ''));
  row.commit?.();
  const hr = ws.getRow(1);
  hr.font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  final.forEach((h, i) => { ws.getColumn(i + 1).width = Math.min(60, Math.max(14, h.length + 4)); });

  setMeta(wb);
  await writeAtomic(wb, logFile);
}
