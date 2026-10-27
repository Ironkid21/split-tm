// Drives the real Electron UI end to end and saves screenshots. Built around the reference sample ZIP
// (expects a Range_Rover brand with 204 units). Uses a throw-away HOME so real user data is never touched.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const zip = process.argv[2] && resolve(process.argv[2]);
if (!zip || !existsSync(zip)) { console.error('Usage: npm run smoke -- <path to the reference sample .zip>'); process.exit(2); }
const home = mkdtempSync(join(tmpdir(), 'split-tm-smoke-'));
const shots = join(home, 'screenshots');
const electron = createRequire(import.meta.url)('electron');
const args = ['.'].concat(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []);
const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData'), SPLITTM_SMOKE: shots, SPLITTM_TEST_FILES: zip };
const child = spawn(electron, args, { env, stdio: ['ignore', 'pipe', 'inherit'] });
let out = ''; child.stdout.on('data', (d) => (out += d));
child.on('exit', () => {
  const line = out.split('\n').find((l) => l.startsWith('SMOKE '));
  console.log(line ?? 'No SMOKE result received.'); console.log(`Screenshots: ${shots}`);
  process.exit(line && !JSON.parse(line.slice(6)).error ? 0 : 1);
});
