import { homedir } from 'node:os';
import path from 'node:path';

export interface AppPaths { appData: string; logsDir: string; tempDir: string; outputRoot: string; logFile: string; }

/** Everything that differs between operating systems lives here (the platform layer). Shared logic only uses AppPaths. */
export interface PlatformInfo { platform: NodeJS.Platform; home: string; env: Record<string, string | undefined>; }
const hostInfo = (): PlatformInfo => ({ platform: process.platform, home: homedir(), env: process.env });

export function defaultPaths(overrides: Partial<Pick<AppPaths, 'appData' | 'outputRoot'>> = {}, info: PlatformInfo = hostInfo()): AppPaths {
  const { platform, home, env } = info;
  const P = platform === 'win32' ? path.win32 : path.posix; // correct separators even when tested from another OS
  const appData = overrides.appData ?? (platform === 'win32'
    ? P.join(env.APPDATA ?? P.join(home, 'AppData', 'Roaming'), 'Split TM')
    : platform === 'darwin' ? P.join(home, 'Library', 'Application Support', 'Split TM')
    : P.join(env.XDG_DATA_HOME ?? P.join(home, '.local', 'share'), 'Split TM'));
  const outputRoot = overrides.outputRoot ?? P.join(home, 'Documents', 'Split TM', 'TMX Output');
  const logsDir = P.join(appData, 'Logs');
  return { appData, logsDir, tempDir: P.join(appData, 'Temp'), outputRoot, logFile: P.join(logsDir, 'Processing_Log.xlsx') };
}
