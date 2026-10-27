// End-to-end check of a PACKAGED developer-channel build (npm run pack:dev), on any OS:
// launch -> add TMX + ZIP -> scan -> language/filter selection -> all four outputs -> verify files and log
// -> close -> reopen -> process again. Uses a throw-away home folder; real user data is never touched.
// Usage: node scripts/packaged-check.mjs "<path to the packaged executable>"
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import ExcelJS from 'exceljs';

const exe = process.argv[2];
if (!exe || !existsSync(exe)) { console.error('Usage: node scripts/packaged-check.mjs "<packaged executable>"'); process.exit(2); }
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const home = mkdtempSync(join(tmpdir(), 'split-tm-check-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = []; const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  - ' + detail : ''}`); };

const tuv = (l, t) => `<tuv xml:lang="${l}"><seg>${t}</seg></tuv>`;
const tmx = (s, b) => `<?xml version="1.0" encoding="UTF-8"?><tmx version="1.4"><header srclang="${s}" datatype="xml"/><body>${b}</body></tmx>`;
const A = tmx('en-GB', `<tu tuid="1"><prop type="JLR">Defender</prop><prop type="JLR">Discovery</prop>${tuv('en-GB', 'Hello')}${tuv('de-DE', 'Hallo')}${tuv('fr-FR', 'Bonjour')}</tu><tu tuid="2"><prop type="JLR">Discovery</prop>${tuv('en-GB', 'Bye')}${tuv('de-DE', 'Tschüss')}</tu><tu tuid="3"><prop type="JLR">Jaguar</prop>${tuv('en-GB', '=SUM(A1:A10)')}${tuv('fr-FR', 'x')}</tu><tu tuid="4">${tuv('de-DE', 'No source')}${tuv('fr-FR', 'y')}</tu>`);
const B = tmx('de-DE', `<tu tuid="5">${tuv('de-DE', 'Danke')}${tuv('en-GB', 'Thanks')}</tu><tu tuid="6">${tuv('de-DE', 'Nur Deutsch')}</tu>`);
const tmxPath = join(home, 'a.tmx'), zipPath = join(home, 'b.zip');
writeFileSync(tmxPath, A); writeFileSync(zipPath, zipSync({ 'b.tmx': strToU8(B) }));

let port = 9400;
async function launch() {
  const p = ++port;
  const env = { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local') };
  const args = [`--remote-debugging-port=${p}`].concat(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []);
  const child = spawn(exe, args, { env, stdio: 'ignore' });
  let target;
  for (let i = 0; i < 80 && !target; i++) { await sleep(500); try { target = (await (await fetch(`http://127.0.0.1:${p}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ } }
  if (!target) { child.kill(); throw new Error('The app did not start (no window found).'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); pend.get(d.id)?.(d); };
  const ev = (expr) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })); }).then((d) => d.result?.result?.value);
  const api = (call) => ev(`window.splitTM.${call}`);
  await sleep(1500);
  return { api, ev, close: async () => { ws.close(); child.kill(); await sleep(1500); } };
}
const logRows = async () => {
  const f = join(process.env.__LOGDIR, 'Processing_Log.xlsx'); const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f);
  const ws = wb.getWorksheet('Processing Log'); const head = ws.getRow(1).values.slice(1);
  const rows = []; ws.eachRow((r, i) => { if (i > 1) rows.push(Object.fromEntries(head.map((h, c) => [h, r.getCell(c + 1).value]))); }); return rows;
};

try {
  console.log(`Checking ${exe}\n`);
  let app = await launch();
  check('Launch: window shows the Add files screen', (await app.ev(`document.querySelector('h1')?.textContent`)) === 'Drop TMX or ZIP files here');
  const info = (await app.api('info()')).data;
  process.env.__LOGDIR = join(info.logFile, '..');
  check('Version matches package.json', info.version === version, info.version);
  check('Developer-channel build (needed for this check)', info.channel === 'developer', info.channel);
  check('Output location is outside the install folder', !info.outputRoot.includes('Program') && info.outputRoot.startsWith(home), info.outputRoot);

  const bad = await app.api(`scan(['${join(home, 'x.txt').replace(/\\/g, '\\\\')}'])`);
  check('Unsupported file is rejected with a message', bad.ok === false && /\.tmx and \.zip|Unsupported|not found/i.test(bad.error), bad.error);
  const q = (p) => `'${p.replace(/\\/g, '\\\\')}'`;
  const s1 = await app.api(`scan([${q(tmxPath)}])`);
  check('Add TMX + scan', s1.ok && s1.data.scan.unitCount === 3 && s1.data.scan.skippedCount === 1, s1.ok ? `${s1.data.scan.unitCount} units, ${s1.data.scan.skippedCount} skipped` : s1.error);
  const s2 = await app.api(`scan([${q(tmxPath)}, ${q(zipPath)}])`);
  const sc = s2.data?.scan;
  check('Add TMX + ZIP + scan', s2.ok && sc.unitCount === 5 && sc.fileCount === 2 && sc.sourceLanguages.join() === 'de-DE,en-GB', s2.ok ? `${sc.unitCount} units, sources ${sc.sourceLanguages}` : s2.error);
  check('Skipped unit is reported with a reason', s2.data?.skipped?.[0]?.tuid === '4' && /Missing source-language entry/.test(s2.data.skipped[0].reason));
  check('Live count: one source + one target', (await app.api(`count({sourceLanguages:['en-GB'],targetLanguages:['de-DE']})`)).data === 2);
  check('Live count: All-to-All', (await app.api(`count({allToAll:true})`)).data === 4);

  const out = {};
  for (const fmt of ['csv', 'md', 'xlsx', 'tmx']) {
    const r = await app.api(`process({allToAll:true}, '${fmt}')`);
    check(`Generate ${fmt.toUpperCase()}: one output file`, r.ok && r.data.outputFiles.length === 1 && existsSync(r.data.outputFiles[0]) && r.data.recordsExported === 4 && r.data.recordsSkipped === 1, r.ok ? `${r.data.recordsExported} exported, ${r.data.recordsSkipped} skipped` : r.error);
    out[fmt] = r.data; await sleep(1100);
  }
  const csv = readFileSync(out.csv.outputFiles[0], 'utf8');
  check('CSV: language codes, alignment, formula safety', csv.includes('de_DE,en_GB,fr_FR') && csv.includes('Hallo,Hello,Bonjour') && csv.includes(`'=SUM(A1:A10)`));
  check('Markdown: same structure', readFileSync(out.md.outputFiles[0], 'utf8').startsWith('| de_DE | en_GB | fr_FR |'));
  check('Excel: valid workbook, header and rows', await (async () => { const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(out.xlsx.outputFiles[0]); const w = wb.worksheets[0]; return w.getRow(1).getCell(1).value === 'de_DE' && w.rowCount === 5 && w.getRow(4).getCell(2).value === '=SUM(A1:A10)'; })());
  check('TMX: native, several sources', /srclang="\*all\*"/.test(readFileSync(out.tmx.outputFiles[0], 'utf8')));
  let rows = await logRows();
  check('Log: 4 rows with status, language mode and skipped details', rows.length === 4 && rows.every((r) => r['Processing Status'] === 'Success' && r['Language Mode'] === 'All-to-All' && /Missing source-language entry/.test(r['Skipped Details'])), `${rows.length} rows`);
  // Multiple Brand Output Mode: one Run ID, one folder, one file per Brand
  const sepArgs = `{brands:['Defender','Discovery','Jaguar']}`;
  const single = await app.api(`process(${sepArgs}, 'csv', 'single')`);
  check('Multiple brands + Single File: one combined file, each unit once', single.ok && single.data.files.length === 1 && single.data.outputMode === 'single' && single.data.recordsSelected === 3 && single.data.recordsExported === 3, single.ok ? `${single.data.files.map((f) => f.name)}` : single.error);
  await sleep(1100);
  const one = await app.api(`process({brands:['Defender']}, 'csv', 'separate')`);
  check('Single brand: no output-mode effect, one file', one.ok && one.data.files.length === 1 && one.data.outputMode === 'single', one.ok ? one.data.outputMode : one.error);
  await sleep(1100);
  for (const fmt of ['csv', 'md', 'xlsx', 'tmx']) {
    const r = await app.api(`process(${sepArgs}, '${fmt}', 'separate')`);
    const names = r.ok ? r.data.files.map((f) => f.name).sort() : [];
    check(`Multiple brands + Separate Files (${fmt.toUpperCase()}): one file per brand, one run folder`, r.ok && r.data.outputMode === 'separate' && JSON.stringify(names) === JSON.stringify(['Defender', 'Discovery', 'Jaguar'].map((b) => `${b}.${fmt}`)) && r.data.files.every((f) => existsSync(f.path) && f.path.startsWith(r.data.outputDir) && f.path.includes(r.data.runId)) && readdirSync(r.data.outputDir).length === 3, r.ok ? `${r.data.runId}: ${names}` : r.error);
    if (r.ok && fmt === 'csv') check('Separate files: records per brand (1 / 2 / 1) and no cross-contamination', JSON.stringify(r.data.files.map((f) => [f.brand, f.records])) === JSON.stringify([['Defender', 1], ['Discovery', 2], ['Jaguar', 1]]) && readFileSync(r.data.files[2].path, 'utf8').includes(`'=SUM(A1:A10)`) && !readFileSync(r.data.files[0].path, 'utf8').includes('SUM'));
    await sleep(1100);
  }
  rows = await logRows();
  const last = rows[rows.length - 1];
  check('Log: separate run is ONE row with mode, file count and names', rows.length === 10 && last['Output Mode'] === 'Separate Files per Brand' && String(last['Output File Count']) === '3' && /Defender\.tmx; Discovery\.tmx; Jaguar\.tmx/.test(last['Output File Names']) && new Set(rows.map((r) => r['Run ID'])).size === 10, `${rows.length} rows`);
  check('No temp copies of the input are left', !existsSync(join(info.logFile, '..', '..', 'Temp')) || readdirSync(join(info.logFile, '..', '..', 'Temp')).length === 0);
  await app.close();

  console.log('\n-- close and reopen --');
  app = await launch();
  check('Reopen: window starts again, no upgrade/warning banner', (await app.ev(`document.querySelector('.banner')`)) === null || (await app.ev(`document.querySelector('.banner') === null`)));
  await app.api(`scan([${q(tmxPath)}, ${q(zipPath)}])`);
  const again = await app.api(`process({sourceLanguages:['en-GB'],targetLanguages:['de-DE']}, 'xlsx')`);
  check('Process again after reopening', again.ok && again.data.recordsExported === 2, again.ok ? `${again.data.recordsExported} exported` : again.error);
  rows = await logRows();
  check('Log keeps history across restarts (11 rows, unique run IDs)', rows.length === 11 && new Set(rows.map((r) => r['Run ID'])).size === 11, `${rows.length} rows`);
  await app.close();
} catch (e) { check('Check could run to the end', false, e.message); }

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
