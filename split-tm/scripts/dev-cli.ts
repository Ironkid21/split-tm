/* Developer CLI: test TMX processing and validate outputs without the UI.
   Never touches real user data: app data and output go to a temp folder unless --app-data / --out are given. */
import { mkdtempSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Dataset, planSelection, processRun, scanInputs, defaultPaths } from '../src/engine/index';
import type { FilterCriteria, OutputFormat, TranslationUnit } from '../src/engine/index';

const [cmd, ...rest] = process.argv.slice(2);
const flags: Record<string, string[]> = {}; const pos: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--all-to-all') flags['all-to-all'] = [''];
  else if (rest[i].startsWith('--')) (flags[rest[i].slice(2)] ??= []).push(rest[++i] ?? '');
  else pos.push(rest[i]);
}
const list = (k: string) => (flags[k] ?? []).flatMap((v) => v.split(',')).map((s) => s.trim()).filter(Boolean);
const root = flags['app-data']?.[0] ?? mkdtempSync(join(tmpdir(), 'split-tm-dev-'));
const paths = defaultPaths({ appData: flags['app-data']?.[0] ?? join(root, 'app'), outputRoot: flags.out?.[0] ?? join(root, 'out') });
const filter: FilterCriteria = {
  brands: list('brand'), projects: list('project'), customers: list('customer'), approvalStatuses: list('approval'),
  sourceLanguages: list('source'), targetLanguages: list('target'), allToAll: 'all-to-all' in flags,
  dateFrom: flags.from?.[0] ? new Date(`${flags.from[0]}T00:00:00Z`) : undefined, dateTo: flags.to?.[0] ? new Date(`${flags.to[0]}T23:59:59Z`) : undefined,
};

const usage = `Split TM dev CLI
  npm run cli -- scan <file.tmx|file.zip>...
  npm run cli -- run <inputs>... [--brand A,B] [--project P] [--approval approved] [--customer C]
                     [--from YYYY-MM-DD --to YYYY-MM-DD]  (dates filter on the creation date)
                     [--source en-GB,de-DE] [--target fr-FR] [--all-to-all]
                     [--output-mode single|separate]   (separate = one file per Brand; needs 2+ --brand values)
                     [--format xlsx|csv|md|tmx] [--out <output root>] [--app-data <dir>]
  npm run cli -- gen-large <out.tmx> [--units 500000] [--langs 3]      (synthetic TMX for stress tests)
  npm run cli -- validate-tmx <original.tmx|zip> <exported.tmx>   (exported must be a subset, byte-faithful per unit)`;

async function load(inputs: string[]) { const { ds, scan } = await scanInputs(inputs, paths); return { ds, scan }; }
const norm = (u: TranslationUnit) => JSON.stringify([u.source, [...u.targets].sort((a, b) => a.language.localeCompare(b.language)), Object.entries(u.metadata).sort(), Object.entries(u.attrs).sort(), u.creationDate?.getTime(), u.modifiedDate?.getTime()]);

const mb = (b: number) => `${Math.round(b / 1048576)} MB`;
function genLarge(file: string, units: number, langs: number) {
  const targets = ['de-DE', 'fr-FR', 'it-IT', 'es-ES', 'nl-NL'].slice(0, Math.max(1, langs - 1));
  const out = createWriteStream(file);
  out.write(`<?xml version="1.0" encoding="UTF-8"?>\n<tmx version="1.4"><header srclang="en-GB" datatype="xml" creationtool="gen"><prop type="user-defined">CUSTOMER: Stress_1</prop></header><body>\n`);
  const brands = ['Range_Rover', 'Jaguar', 'Defender', 'Discovery', 'Jaguar_App'];
  return new Promise<void>((resolve) => {
    let i = 0;
    const pump = () => {
      while (i < units) {
        const b = brands[i % brands.length], b2 = brands[(i * 7 + 3) % brands.length];
        const seg = `Sentence number ${i} about ${b} with some typical length text to be translated, including <ph x="1">{1}</ph> a tag, &amp; entities.`;
        const ctx = `x-previous-source-text`;
        const tu = `<tu tuid="${i}" creationdate="2026${String(1 + (i % 12)).padStart(2, '0')}10T101010Z" changedate="20260909T141014Z" creationid="user${i % 9}">` +
          `<prop type="x-Project">P-${i % 40}</prop><prop type="JLR">${b}</prop>${i % 3 === 0 ? `<prop type="JLR">${b2}</prop>` : ''}` +
          `<prop type="x-xtm-status">${i % 17 === 0 ? 'not approved' : 'approved'}</prop><prop type="Status">translated</prop>` +
          `<prop type="${ctx}">Previous sentence of context number ${i} used by XTM for matching purposes.</prop><prop type="x-next-source-text">Next sentence of context ${i} for matching.</prop>` +
          `<tuv xml:lang="en-GB"><seg>${seg}</seg></tuv>` + targets.map((l) => `<tuv xml:lang="${l}"><seg>[${l}] ${seg}</seg></tuv>`).join('') + `</tu>\n`;
        i++;
        if (!out.write(tu)) { out.once('drain', pump); return; }
      }
      out.end('</body></tmx>\n', () => resolve());
    };
    pump();
  });
}

async function main() {
  const t0 = Date.now();
  process.on('exit', () => { if (['scan', 'run', 'validate-tmx', 'gen-large'].includes(cmd ?? '')) console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s, peak memory ${mb(process.resourceUsage().maxRSS * 1024)})`); });
  if (cmd === 'gen-large' && pos.length) { await genLarge(pos[0], Number(flags.units?.[0] ?? 500000), Number(flags.langs?.[0] ?? 3)); console.log(`wrote ${pos[0]}`); return; }
  if (cmd === 'scan' && pos.length) {
    const { ds, scan } = await load(pos);
    console.log(JSON.stringify({ ...scan, facets: ds.facets(), skippedSample: ds.skipped.slice(0, 20) }, null, 2));
  } else if (cmd === 'run' && pos.length) {
    const format = (flags.format?.[0] ?? 'xlsx') as OutputFormat;
    if (!['xlsx', 'csv', 'md', 'tmx'].includes(format)) throw new Error(`Unknown format "${format}"`);
    const { ds } = await load(pos);
    console.log(`selected ${planSelection(ds.index, filter).count} of ${ds.index.length} units`);
    const r = await processRun({ inputs: pos, filter, format, paths, dataset: ds, outputMode: flags['output-mode']?.[0] === 'separate' ? 'separate' : 'single', onProgress: (p) => console.log(`  ${p.stage}`) });
    console.log(JSON.stringify(r, null, 2)); console.log(`log: ${paths.logFile}`);
  } else if (cmd === 'validate-tmx' && pos.length === 2) {
    const orig = new Dataset({ keepUnits: true });
    await (/\.zip$/i.test(pos[0]) ? orig.addZip(pos[0], 'original') : orig.addTmx(pos[0], 'original'));
    const exp = new Dataset({ keepUnits: true }); await exp.addTmx(pos[1], 'exported');
    const byId = new Map(orig.units.map((u) => [u.tuid, u]));
    let missing = 0, differing = 0;
    for (const u of exp.units) { const o = byId.get(u.tuid); if (!o) missing++; else if (norm(o) !== norm(u)) differing++; }
    console.log(JSON.stringify({ originalUnits: orig.units.length, exportedUnits: exp.units.length, notInOriginal: missing, differing, ok: !missing && !differing }, null, 2));
    process.exitCode = missing || differing ? 1 : 0;
  } else { console.log(usage); process.exitCode = cmd ? 2 : 0; }
}
main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
