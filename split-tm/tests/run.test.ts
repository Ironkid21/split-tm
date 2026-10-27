import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtempSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { processRun, outputBaseName } from '../src/engine/processor';
import { defaultPaths } from '../src/engine/paths';
import { appendLog, LOG_COLUMNS } from '../src/engine/processingLog';

const fx = 'tests/fixtures/sample.tmx';
const mk = () => { const r = mkdtempSync(join(tmpdir(), 'tm-')); return defaultPaths({ appData: join(r, 'app'), outputRoot: join(r, 'out') }); };
const rows = async (f: string) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f); const ws = wb.getWorksheet('Processing Log')!; return ws.actualRowCount; };

describe('runs', () => {
  it('creates dated run folder, output, and appends one log row per run', async () => {
    const p = mk(); const fixed = new Date(2026, 9, 11, 13, 45, 0);
    const a = await processRun({ inputs: [fx], filter: { brands: ['Range_Rover'] }, format: 'csv', paths: p, now: () => fixed });
    const b = await processRun({ inputs: [fx], filter: { brands: ['Jaguar'] }, format: 'md', paths: p, now: () => fixed });
    expect(a.runId).toBe('RUN_20261011_134500');
    expect(b.runId).not.toBe(a.runId);
    expect(a.outputDir).toContain(join('2026-10-11', a.runId));
    expect(readdirSync(a.outputDir)).toEqual(['Range Rover.csv']);
    expect(await rows(p.logFile)).toBe(3);
    expect(existsSync(join(p.appData, 'Logs'))).toBe(true);
    expect(readdirSync(p.appData)).toEqual(['Logs']); // no Temp folder: inputs are streamed, never copied to disk
  });
  it('writes a clean header on a new log', async () => {
    const p = mk();
    await processRun({ inputs: [fx], filter: { brands: ['Jaguar'] }, format: 'csv', paths: p });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(p.logFile); const ws = wb.getWorksheet('Processing Log')!;
    expect(ws.getRow(1).getCell(1).value).toBe('Run ID');
    expect(ws.columnCount).toBe(LOG_COLUMNS.length);
    expect(ws.getRow(2).getCell(11).value).toBe('Jaguar');
  });
  it('logs no-match and failures without creating output', async () => {
    const p = mk();
    await expect(processRun({ inputs: [fx], filter: { brands: ['Nope'] }, format: 'xlsx', paths: p })).rejects.toThrow(/No records match/);
    const bad = join(tmpdir(), 'x.txt'); writeFileSync(bad, 'x');
    await expect(processRun({ inputs: [bad], filter: {}, format: 'xlsx', paths: p })).rejects.toThrow(/Unsupported/);
    expect(await rows(p.logFile)).toBe(3);
  });
  it('migrates an older log without losing rows or columns', async () => {
    const p = mk(); const { mkdirSync } = await import('node:fs'); mkdirSync(p.logsDir, { recursive: true });
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Processing Log');
    ws.addRow(['Run ID', 'Legacy Column']); ws.addRow(['RUN_OLD', 'keep me']);
    await wb.xlsx.writeFile(p.logFile);
    await appendLog(p.logFile, Object.fromEntries(LOG_COLUMNS.map((c) => [c, c === 'Run ID' ? 'RUN_NEW' : 'x'])) as never);
    const r = new ExcelJS.Workbook(); await r.xlsx.readFile(p.logFile); const s = r.getWorksheet('Processing Log')!;
    expect(s.getRow(1).getCell(2).value).toBe('Legacy Column');
    expect(s.getRow(2).getCell(1).value).toBe('RUN_OLD'); expect(s.getRow(2).getCell(2).value).toBe('keep me');
    expect(s.getRow(3).getCell(1).value).toBe('RUN_NEW');
    expect(readdirSync(p.logsDir).some((f) => f.includes('backup'))).toBe(true);
  });
  it('names outputs safely', () => {
    expect(outputBaseName({ brands: ['Range_Rover'], approvalStatuses: ['approved'] })).toBe('Range Rover_approved');
    expect(outputBaseName({ brands: ['a', 'b', 'c'] })).toBe('3 Brands');
    expect(outputBaseName({ brands: ['A/B:C'] })).toBe('A_B_C');
  });
});
