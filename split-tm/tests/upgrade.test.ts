import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, utimesSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultPaths } from '../src/engine/paths';
import { runStartupMigration } from '../src/engine/upgrade';
import { compareVersions } from '../src/engine/semver';
import { LOG_COLUMNS } from '../src/engine/processingLog';

const mk = () => { const r = mkdtempSync(join(tmpdir(), 'up-')); return defaultPaths({ appData: join(r, 'app'), outputRoot: join(r, 'out') }); };
const sha = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
async function oldLog(file: string, schema?: number) {
  mkdirSync(join(file, '..'), { recursive: true });
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Processing Log');
  ws.addRow(['Run ID', 'Application Version', 'Legacy Column']); ws.addRow(['RUN_OLD_1', '0.1.0', 'keep me']); ws.addRow(['RUN_OLD_2', '0.1.0', 'and me']);
  if (schema !== undefined) { const m = wb.addWorksheet('Meta'); m.state = 'hidden'; m.getCell('A1').value = 'schemaVersion'; m.getCell('B1').value = schema; }
  await wb.xlsx.writeFile(file);
}
const seed = async (p: ReturnType<typeof mk>, version = '0.1.0') => {
  await oldLog(p.logFile);
  writeFileSync(join(p.appData, 'config.json'), JSON.stringify({ outputRoot: '/custom/out', futureSetting: { a: 1 } }));
  writeFileSync(join(p.appData, 'state.json'), JSON.stringify({ appVersion: version, history: [] }));
  const out = join(p.outputRoot, '2026-01-01', 'RUN_X'); mkdirSync(out, { recursive: true });
  const f = join(out, 'Range Rover.xlsx'); writeFileSync(f, 'precious output');
  return f;
};

describe('startup migration', () => {
  it('fresh install writes state only', async () => {
    const p = mk(); const r = await runStartupMigration(p, { currentVersion: '0.2.0' });
    expect(r.status).toBe('fresh'); expect(existsSync(join(p.appData, 'state.json'))).toBe(true); expect(existsSync(join(p.appData, 'Backups'))).toBe(false);
  });

  it('upgrade keeps outputs, log rows, legacy columns and user settings; backs up first; second launch is a no-op', async () => {
    const p = mk(); const outFile = await seed(p); const outHash = sha(outFile);
    const r = await runStartupMigration(p, { currentVersion: '0.2.0' });
    expect(r.status).toBe('upgraded'); expect(r.from).toBe('0.1.0');
    expect(sha(outFile)).toBe(outHash);
    expect(readdirSync(r.backupDir!).sort()).toEqual(['Processing_Log.xlsx', 'config.json', 'state.json']);
    const cfg = JSON.parse(readFileSync(join(p.appData, 'config.json'), 'utf8'));
    expect(cfg.outputRoot).toBe('/custom/out'); expect(cfg.futureSetting).toEqual({ a: 1 }); expect(cfg.configVersion).toBe(1);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(p.logFile); const ws = wb.getWorksheet('Processing Log')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header.slice(0, 3)).toEqual(['Run ID', 'Application Version', 'Legacy Column']);
    for (const c of LOG_COLUMNS) expect(header).toContain(c);
    expect(ws.getRow(2).getCell(3).value).toBe('keep me'); expect(ws.getRow(3).getCell(1).value).toBe('RUN_OLD_2');
    expect(JSON.parse(readFileSync(join(p.appData, 'state.json'), 'utf8')).appVersion).toBe('0.2.0');
    const again = await runStartupMigration(p, { currentVersion: '0.2.0' });
    expect(again.status).toBe('unchanged'); expect(readdirSync(join(p.appData, 'Backups'))).toHaveLength(1);
  });

  it('older data from a newer app version is never modified', async () => {
    const p = mk(); await seed(p, '9.0.0');
    const before = [sha(p.logFile), sha(join(p.appData, 'config.json')), sha(join(p.appData, 'state.json'))];
    const r = await runStartupMigration(p, { currentVersion: '0.2.0' });
    expect(r.status).toBe('newer-data'); expect(r.warnings[0]).toContain('9.0.0');
    expect([sha(p.logFile), sha(join(p.appData, 'config.json')), sha(join(p.appData, 'state.json'))]).toEqual(before);
    expect(existsSync(join(p.appData, 'Backups'))).toBe(false);
  });

  it('data that predates version tracking is upgraded safely', async () => {
    const p = mk(); await seed(p); (await import('node:fs')).rmSync(join(p.appData, 'state.json'));
    const r = await runStartupMigration(p, { currentVersion: '0.2.0' });
    expect(r.status).toBe('upgraded'); expect(r.from).toBe('unknown'); expect(existsSync(r.backupDir!)).toBe(true);
  });

  it('corrupt state file is set aside, not fatal', async () => {
    const p = mk(); await seed(p); writeFileSync(join(p.appData, 'state.json'), '{not json');
    const r = await runStartupMigration(p, { currentVersion: '0.2.0' });
    expect(r.warnings.join(' ')).toContain('unreadable'); expect(r.status).toBe('upgraded');
    expect(readdirSync(p.appData).some((f) => f.startsWith('state.json.corrupt-'))).toBe(true);
  });

  it('corrupt log: no crash, log bytes untouched, version not bumped so it retries', async () => {
    const p = mk(); await seed(p); writeFileSync(p.logFile, 'this is not an xlsx');
    const h = sha(p.logFile);
    const r = await runStartupMigration(p, { currentVersion: '0.2.0' });
    expect(r.status).toBe('failed'); expect(r.warnings.join(' ')).toContain('retried'); expect(sha(p.logFile)).toBe(h);
    expect(JSON.parse(readFileSync(join(p.appData, 'state.json'), 'utf8')).appVersion).toBe('0.1.0');
    expect(existsSync(r.backupDir!)).toBe(true);
  });

  it('log written by a newer schema is left unchanged with a warning', async () => {
    const p = mk(); await seed(p); await oldLog(p.logFile, 99); const h = sha(p.logFile);
    const r = await runStartupMigration(p, { currentVersion: '0.2.0' });
    expect(sha(p.logFile)).toBe(h); expect(r.warnings.join(' ')).toContain('newer version');
  });

  it('cleans only stale run-* temp folders', async () => {
    const p = mk(); mkdirSync(p.tempDir, { recursive: true });
    const old = join(p.tempDir, 'run-old'), fresh = join(p.tempDir, 'run-new'), other = join(p.tempDir, 'keep-me');
    for (const d of [old, fresh, other]) mkdirSync(d);
    const past = new Date(Date.now() - 3 * 24 * 3600 * 1000); utimesSync(old, past, past); utimesSync(other, past, past);
    await runStartupMigration(p, { currentVersion: '0.2.0' });
    expect(existsSync(old)).toBe(false); expect(existsSync(fresh)).toBe(true); expect(existsSync(other)).toBe(true);
  });

  it('compares semantic versions', () => {
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1); expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0); expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
    expect(compareVersions('abc', '1.0.0')).toBeNull();
  });
});
