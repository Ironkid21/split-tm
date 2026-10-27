import type { MenuItemConstructorOptions } from 'electron';

export type BuildChannel = 'production' | 'developer';

/** Developer Tools: always in development (not packaged) and in packaged *developer* builds; never in production builds. */
export const devToolsAllowed = (isPackaged: boolean, channel: string): boolean => !isPackaged || channel === 'developer';

/** Chromium/Node switches that open a remote debugging surface. A production build refuses to start with them. */
export const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe', 'remote-allow-origins', 'inspect', 'inspect-brk', 'inspect-port', 'js-flags'];

interface KeyInput { type: string; key: string; control: boolean; meta: boolean; shift: boolean; alt: boolean }

/** Keyboard shortcuts that open DevTools or reload the page (reload is also blocked in production). */
export function isBlockedShortcut(i: KeyInput): boolean {
  if (i.type !== 'keyDown') return false;
  const k = i.key.toLowerCase();
  const mod = i.control || i.meta;
  if (k === 'f12' || k === 'f5') return true;
  if (mod && i.shift && ['i', 'j', 'c'].includes(k)) return true;
  if (i.meta && i.alt && ['i', 'j', 'c'].includes(k)) return true;
  if (mod && k === 'r') return true;
  return false;
}

/** Production macOS menu: only what normal use needs (copy/paste, minimize, quit). No View menu, no developer items. */
export function productionMacMenu(appName: string): MenuItemConstructorOptions[] {
  return [
    { label: appName, submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ];
}
