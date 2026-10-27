import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { Dataset, planSelection, processRun, scanInputs, defaultPaths, APP_VERSION, runStartupMigration, loadConfig, saveConfig } from '../engine/index';
import type { UpgradeReport } from '../engine/index';
import type { FilterCriteria, OutputFormat, OutputMode, MarketOutputMode } from '../engine/index';
import type { Result, Scanned } from '../shared/api';
import { runSmoke } from './smoke';
import { DEBUG_SWITCHES, devToolsAllowed, isBlockedShortcut, productionMacMenu } from './security';

// Injected at build time by scripts/build-main.mjs ('production' unless built with --channel developer).
declare const __BUILD_CHANNEL__: string;
const CHANNEL = typeof __BUILD_CHANNEL__ === 'string' ? __BUILD_CHANNEL__ : 'production';
const DEVTOOLS = devToolsAllowed(app.isPackaged, CHANNEL);
// Production builds do not expose any remote debugging surface.
if (!DEVTOOLS && DEBUG_SWITCHES.some((sw) => app.commandLine.hasSwitch(sw))) app.exit(2);

// Keep Electron's own profile/cache inside the single Split TM data folder (not scattered elsewhere).
app.setPath('userData', join(defaultPaths().appData, 'Browser'));

let win: BrowserWindow | null = null;
let session: { inputs: string[]; ds: Dataset } | null = null;
let busy = false;

const appData = () => defaultPaths().appData;
let upgrade: UpgradeReport | null = null;
const paths = () => defaultPaths({ outputRoot: loadConfig(appData()).outputRoot });
const info = () => { const p = paths(); return { version: APP_VERSION, outputRoot: p.outputRoot, logFile: p.logFile, channel: CHANNEL }; };

async function wrap<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try { return { ok: true, data: await fn() }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

function register() {
  ipcMain.handle('info', () => wrap(info));
  ipcMain.handle('upgradeNotice', () => wrap(() => upgrade));
  ipcMain.handle('pickFiles', () => wrap(async () => {
    if (!app.isPackaged && process.env.SPLITTM_TEST_FILES) return process.env.SPLITTM_TEST_FILES.split('|');
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'TMX or ZIP', extensions: ['tmx', 'zip'] }] });
    return r.canceled ? [] : r.filePaths;
  }));
  ipcMain.handle('scan', (_e, inputs: string[]) => wrap<Scanned>(async () => {
    if (busy) throw new Error('A run is already in progress.');
    if (!Array.isArray(inputs) || inputs.some((i) => typeof i !== 'string' || !['.tmx', '.zip'].includes(extname(i).toLowerCase())))
      throw new Error('Only .tmx and .zip files can be added.');
    session = null;
    const { ds, scan } = await scanInputs(inputs, paths(), (p) => win?.webContents.send('progress', p));
    session = { inputs, ds };
    return { scan, facets: ds.facets(), skipped: ds.skipped.slice(0, 50) };
  }));
  ipcMain.handle('count', (_e, f: FilterCriteria) => wrap(() => (session ? planSelection(session.ds.index, f).count : 0)));
  ipcMain.handle('preview', (_e, f: FilterCriteria) => wrap(() => {
    if (!session) return { count: 0, perBrand: {} };
    const perBrand: Record<string, number> = {};
    if ((f.brands?.length ?? 0) > 1) for (const b of f.brands!) perBrand[b] = planSelection(session.ds.index, { ...f, brands: [b] }).count;
    return { count: planSelection(session.ds.index, f).count, perBrand };
  }));
  ipcMain.handle('closeApp', () => wrap(() => { app.quit(); return true as const; }));
  ipcMain.handle('process', (_e, filter: FilterCriteria, format: OutputFormat, mode: OutputMode = 'single', marketMode: MarketOutputMode = 'combined') => wrap(async () => {
    if (!session) throw new Error('Add files and scan them first.');
    if (busy) throw new Error('A run is already in progress.');
    if (!['tmx', 'xlsx', 'csv', 'md'].includes(format)) throw new Error('Unknown output format.');
    if (!['single', 'separate'].includes(mode)) throw new Error('Unknown output mode.');
    if (!['combined', 'individual'].includes(marketMode)) throw new Error('Unknown market output mode.');
    busy = true;
    try {
      return await processRun({ inputs: session.inputs, filter, format, paths: paths(), dataset: session.ds, outputMode: mode, marketOutputMode: marketMode, onProgress: (p) => win?.webContents.send('progress', p) });
    } finally { busy = false; }
  }));
  ipcMain.handle('chooseOutputRoot', () => wrap(async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    saveConfig(appData(), { ...loadConfig(appData()), outputRoot: r.filePaths[0] });
    return info();
  }));
  ipcMain.handle('openPath', (_e, p: string) => wrap(async () => {
    if (typeof p !== 'string' || !existsSync(p)) throw new Error('That folder no longer exists.');
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
    return true as const;
  }));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1024, minHeight: 700, backgroundColor: '#000000', title: 'Split TM', show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: DEVTOOLS },
  });
  win.once('ready-to-show', () => win?.show());
  if (!DEVTOOLS) {
    win.webContents.on('before-input-event', (e, input) => { if (isBlockedShortcut(input)) e.preventDefault(); });
    win.webContents.on('devtools-opened', () => win?.webContents.closeDevTools());
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate(productionMacMenu(app.name)) : null);
  }
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(process.env.SPLITTM_DEV_URL ?? 'file://')) e.preventDefault(); });
  if (process.env.SPLITTM_DEV_URL) void win.loadURL(process.env.SPLITTM_DEV_URL);
  else void win.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  void app.whenReady().then(async () => {
    upgrade = await runStartupMigration(defaultPaths());
    register(); createWindow();
    if (!app.isPackaged && process.env.SPLITTM_SMOKE) win!.webContents.once('did-finish-load', () => void runSmoke(win!, process.env.SPLITTM_SMOKE!).then(() => app.quit()));
  });
  app.on('window-all-closed', () => app.quit());
}
