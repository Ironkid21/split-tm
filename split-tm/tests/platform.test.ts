import { describe, it, expect } from 'vitest';
import { defaultPaths } from '../src/engine/paths';

describe('platform layer: per-OS locations', () => {
  it('Windows: %APPDATA%, backslashes, Documents under the user profile', () => {
    const p = defaultPaths({}, { platform: 'win32', home: 'C:\\Users\\Muthu', env: { APPDATA: 'C:\\Users\\Muthu\\AppData\\Roaming' } });
    expect(p.appData).toBe('C:\\Users\\Muthu\\AppData\\Roaming\\Split TM');
    expect(p.logFile).toBe('C:\\Users\\Muthu\\AppData\\Roaming\\Split TM\\Logs\\Processing_Log.xlsx');
    expect(p.outputRoot).toBe('C:\\Users\\Muthu\\Documents\\Split TM\\TMX Output');
  });
  it('Windows without APPDATA falls back to the profile folder', () => {
    expect(defaultPaths({}, { platform: 'win32', home: 'C:\\Users\\A', env: {} }).appData).toBe('C:\\Users\\A\\AppData\\Roaming\\Split TM');
  });
  it('macOS: ~/Library/Application Support, forward slashes, no AppData assumption', () => {
    const p = defaultPaths({}, { platform: 'darwin', home: '/Users/muthu', env: { APPDATA: 'C:\\ignored' } });
    expect(p.appData).toBe('/Users/muthu/Library/Application Support/Split TM');
    expect(p.logFile).toBe('/Users/muthu/Library/Application Support/Split TM/Logs/Processing_Log.xlsx');
    expect(p.outputRoot).toBe('/Users/muthu/Documents/Split TM/TMX Output');
  });
  it('Linux (development/CI): XDG data dir', () => {
    expect(defaultPaths({}, { platform: 'linux', home: '/home/dev', env: {} }).appData).toBe('/home/dev/.local/share/Split TM');
    expect(defaultPaths({}, { platform: 'linux', home: '/home/dev', env: { XDG_DATA_HOME: '/data' } }).appData).toBe('/data/Split TM');
  });
  it('overrides (configured output folder) win on every platform; user data stays outside the install folder', () => {
    for (const platform of ['win32', 'darwin', 'linux'] as const) {
      const p = defaultPaths({ outputRoot: '/custom/out' }, { platform, home: '/h', env: {} });
      expect(p.outputRoot).toBe('/custom/out'); expect(p.logsDir).toContain('Split TM');
    }
  });
});
