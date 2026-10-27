import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, renameSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AppPaths } from './paths.js';
import { APP_VERSION, LOG_SCHEMA_VERSION } from './version.js';
import { compareVersions } from './semver.js';
import { CONFIG_VERSION, configPath, loadConfig, migrateConfig, saveConfig } from './config.js';
import { migrateLog } from './processingLog.js';

export interface UpgradeReport {
  status: 'fresh' | 'unchanged' | 'upgraded' | 'newer-data' | 'failed';
  from?: string;
  to: string;
  backupDir?: string;
  notes: string[];
  warnings: string[];
}

interface State {
  appVersion: string; configVersion: number; logSchemaVersion: number;
  history: { from: string; to: string; at: string; backup?: string }[];
}

const stateFile = (p: AppPaths) => join(p.appData, 'state.json');
const p2 = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;

function writeState(p: AppPaths, s: State) {
  const tmp = `${stateFile(p)}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, stateFile(p));
}

function readState(p: AppPaths, now: Date, warnings: string[]): State | null {
  const f = stateFile(p);
  if (!existsSync(f)) return null;
  try {
    const s = JSON.parse(readFileSync(f, 'utf8'));
    if (typeof s?.appVersion !== 'string') throw new Error('missing appVersion');
    return { configVersion: 0, logSchemaVersion: 0, history: [], ...s };
  } catch {
    const keep = `${f}.corrupt-${stamp(now)}`;
    try { renameSync(f, keep); } catch { /* ignore */ }
    warnings.push('The saved version information was unreadable and has been set aside. Your data was not changed.');
    return null;
  }
}

function backup(p: AppPaths, from: string, to: string, now: Date): string {
  const root = join(p.appData, 'Backups');
  let dir = join(root, `${from.replace(/[^\w.-]/g, '_')}_to_${to}_${stamp(now)}`), n = 1;
  while (existsSync(dir)) dir = `${dir.replace(/_\d+$/, '')}_${++n}`;
  mkdirSync(dir, { recursive: true });
  for (const f of [configPath(p.appData), stateFile(p), p.logFile]) if (existsSync(f)) copyFileSync(f, join(dir, f.split(/[\\/]/).pop()!));
  return dir;
}

/** Temp data only: abandoned extraction folders from crashed runs. Never touches outputs, logs or config. */
function cleanStaleTemp(p: AppPaths, now: Date) {
  try {
    for (const name of readdirSync(p.tempDir)) {
      if (!name.startsWith('run-')) continue;
      const full = join(p.tempDir, name);
      if (now.getTime() - statSync(full).mtimeMs > 24 * 3600 * 1000) rmSync(full, { recursive: true, force: true });
    }
  } catch { /* no temp dir yet */ }
}

/**
 * Runs once per launch. Only application-owned metadata is migrated (config, processing log schema, state);
 * output files, historical logs rows and user settings are never deleted or reprocessed.
 * Never throws: problems are reported so the app can still start.
 */
export async function runStartupMigration(p: AppPaths, opts: { currentVersion?: string; now?: Date } = {}): Promise<UpgradeReport> {
  const to = opts.currentVersion ?? APP_VERSION;
  const now = opts.now ?? new Date();
  const report: UpgradeReport = { status: 'unchanged', to, notes: [], warnings: [] };
  try {
    mkdirSync(p.appData, { recursive: true });
    cleanStaleTemp(p, now);
    const state = readState(p, now, report.warnings);
    const hadData = existsSync(p.logFile) || existsSync(configPath(p.appData));

    if (!state && !hadData) {
      writeState(p, { appVersion: to, configVersion: CONFIG_VERSION, logSchemaVersion: LOG_SCHEMA_VERSION, history: [] });
      report.status = 'fresh';
      return report;
    }

    const from = state?.appVersion ?? 'unknown';
    const cmp = state ? compareVersions(from, to) : -1;
    report.from = from;

    if (cmp === 0) return report;
    if (cmp === 1) {
      report.status = 'newer-data';
      report.warnings.push(`Your data was last used by a newer version (${from}). Split TM ${to} has left your settings and logs unchanged.`);
      return report;
    }

    // upgrade (or first run on data that predates version tracking)
    report.backupDir = backup(p, from, to, now);
    const cfg = migrateConfig(loadConfig(p.appData));
    if (cfg.changed) { saveConfig(p.appData, cfg.config); report.notes.push('Settings updated.'); }
    const log = await migrateLog(p.logFile);
    if (log.migrated) report.notes.push(`Processing log updated (added columns: ${log.added.join(', ') || 'none'}).`);
    if (log.note) report.warnings.push(log.note);

    writeState(p, {
      appVersion: to, configVersion: CONFIG_VERSION, logSchemaVersion: LOG_SCHEMA_VERSION,
      history: [...(state?.history ?? []), { from, to, at: now.toISOString(), backup: report.backupDir }].slice(-50),
    });
    report.status = 'upgraded';
    return report;
  } catch (e) {
    report.status = 'failed';
    report.warnings.push(`Upgrade check could not finish: ${(e as Error).message}. Your data was not deleted${report.backupDir ? `; a backup is in ${report.backupDir}` : ''}. It will be retried at the next start.`);
    return report;
  }
}
