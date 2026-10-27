import type { BrowserWindow } from 'electron';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function runSmoke(win: BrowserWindow, outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const js = <T>(code: string) => win.webContents.executeJavaScript(code, true) as Promise<T>;
  const shot = async (name: string) => writeFileSync(join(outDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  const waitFor = (cond: string, ms = 20000) => js<boolean>(`new Promise(r=>{const t0=Date.now();const i=setInterval(()=>{let ok=false;try{ok=!!(${cond})}catch{};if(ok||Date.now()-t0>${ms}){clearInterval(i);r(ok)}},100)})`);
  const log: Record<string, unknown> = {};
  const btn = (text: string) => `[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(text)}))`;
  try {
    await waitFor(`document.querySelector('h1')`); await new Promise((r) => setTimeout(r, 600));
    await shot('1-intake-empty');
    await js(`${btn('Add files')}.click()`);
    log.scanned = await waitFor(`!${btn('Continue')}.disabled`);
    log.scanText = await js(`document.querySelector('.status.ok')?.textContent`);
    await shot('2-intake-scanned');
    await js(`${btn('Continue')}.click()`);
    await waitFor(`document.querySelector('.stats')`);
    log.stats = await js(`[...document.querySelectorAll('.stat')].map(s=>s.textContent)`);
    await new Promise((r) => setTimeout(r, 400));
    await shot('3-select');
    await js(`[...document.querySelectorAll('.check.primary label')].find(l=>l.textContent.startsWith('Range_Rover')).click()`);
    await waitFor(`document.querySelector('.sel b')?.textContent==='204'`);
    log.selectedAfterBrand = await js(`document.querySelector('.sel')?.textContent`);
    await js(`[...document.querySelectorAll('.check label')].find(l=>l.textContent.startsWith('approved')).click()`);
    await new Promise((r) => setTimeout(r, 400));
    log.selectedAfterApproval = await js(`document.querySelector('.sel')?.textContent`);
    await shot('4-select-filtered');
    await js(`${btn('Process')}.click()`);
    log.done = await waitFor(`document.querySelector('.done h1')`);
    log.doneText = await js(`[...document.querySelectorAll('.done dl div')].map(d=>d.textContent)`);
    await shot('5-done');
    // multiple brands: mode panel appears, Separate Files -> one file per brand under one run
    await js(`${btn('New run')}.click()`);
    await js(`${btn('Add files')}.click()`);
    await waitFor(`!${btn('Continue')}.disabled`);
    await js(`${btn('Continue')}.click()`);
    await waitFor(`document.querySelector('.stats')`);
    log.modePanelWithOneBrand = await js(`!!document.querySelector('.modebar')`);
    const pick = (name: string) => js(`[...document.querySelectorAll('.check.primary label')].find(l=>l.textContent.startsWith(${JSON.stringify(name)})).click()`);
    await pick('Range_Rover');
    log.modePanelWithOneBrandSelected = await js(`!!document.querySelector('.modebar')`);
    await pick('Jaguar'); await pick('Defender');
    await waitFor(`document.querySelector('.modebar')`); await new Promise((r) => setTimeout(r, 500));
    log.modePanelText = await js(`document.querySelector('.modebar')?.textContent`);
    await shot('6-multi-brand-mode');
    await js(`[...document.querySelectorAll('.mode')].find(b=>b.textContent.startsWith('Separate')).click()`);
    await js(`[...document.querySelectorAll('.seg button')].find(b=>b.textContent.startsWith('CSV')).click()`);
    await new Promise((r) => setTimeout(r, 400));
    log.countText = await js(`document.querySelector('.sel')?.textContent`);
    await js(`${btn('Process')}.click()`);
    log.done2 = await waitFor(`document.querySelector('.done h1')`);
    log.doneFiles = await js(`[...document.querySelectorAll('.filesout li')].map(l=>l.textContent)`);
    log.doneRows2 = await js(`[...document.querySelectorAll('.done dl div')].map(d=>d.textContent)`);
    await shot('7-done-separate');
  } catch (e) { log.error = String(e); }
  writeFileSync(join(outDir, 'smoke.json'), JSON.stringify(log, null, 2));
  console.log('SMOKE ' + JSON.stringify(log));
}
