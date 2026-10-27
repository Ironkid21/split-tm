import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const CONFIG_VERSION = 1;
export interface UserConfig { configVersion?: number; outputRoot?: string; [k: string]: unknown }

export const configPath = (appData: string) => join(appData, 'config.json');

export function loadConfig(appData: string): UserConfig {
  try { const c = JSON.parse(readFileSync(configPath(appData), 'utf8')); return c && typeof c === 'object' && !Array.isArray(c) ? c : {}; } catch { return {}; }
}

export function saveConfig(appData: string, cfg: UserConfig) {
  const f = configPath(appData);
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  renameSync(tmp, f);
}

/** Ordered, additive migrations. Unknown keys and user values are always preserved. */
const MIGRATIONS: { to: number; run: (c: UserConfig) => UserConfig }[] = [
  { to: 1, run: (c) => ({ ...c }) },
];

export function migrateConfig(cfg: UserConfig): { config: UserConfig; changed: boolean } {
  let c = { ...cfg };
  const from = typeof c.configVersion === 'number' ? c.configVersion : 0;
  if (from > CONFIG_VERSION) return { config: cfg, changed: false };
  for (const m of MIGRATIONS) if (m.to > from) c = m.run(c);
  c.configVersion = CONFIG_VERSION;
  return { config: c, changed: from !== CONFIG_VERSION };
}
