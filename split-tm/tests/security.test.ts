import { describe, it, expect } from 'vitest';
import { DEBUG_SWITCHES, devToolsAllowed, isBlockedShortcut, productionMacMenu } from '../src/main/security';

const key = (k: string, o: Partial<Record<'control' | 'meta' | 'shift' | 'alt', boolean>> = {}) => ({ type: 'keyDown', key: k, control: false, meta: false, shift: false, alt: false, ...o });

describe('Developer Tools policy', () => {
  it('enabled in development and developer builds, disabled in production', () => {
    expect(devToolsAllowed(false, 'production')).toBe(true);   // npm run dev
    expect(devToolsAllowed(true, 'developer')).toBe(true);     // packaged developer build
    expect(devToolsAllowed(true, 'production')).toBe(false);   // packaged production build
    expect(devToolsAllowed(true, 'anything-else')).toBe(false);
  });
  it('blocks DevTools and reload shortcuts', () => {
    for (const k of [key('F12'), key('I', { control: true, shift: true }), key('j', { control: true, shift: true }), key('C', { control: true, shift: true }),
      key('i', { meta: true, alt: true }), key('i', { meta: true, shift: true }), key('F5'), key('r', { control: true }), key('R', { meta: true })]) expect(isBlockedShortcut(k)).toBe(true);
  });
  it('does not block normal typing and copy/paste', () => {
    for (const k of [key('c', { control: true }), key('v', { meta: true }), key('a', { control: true }), key('i'), key('r'), key('F11')]) expect(isBlockedShortcut(k)).toBe(false);
    expect(isBlockedShortcut({ ...key('F12'), type: 'keyUp' })).toBe(false);
  });
  it('production macOS menu has no developer/reload items but keeps copy/paste', () => {
    const flat = JSON.stringify(productionMacMenu('Split TM'));
    for (const bad of ['toggleDevTools', 'reload', 'forceReload', 'DevTools', 'Inspect']) expect(flat).not.toContain(bad);
    for (const good of ['copy', 'paste', 'quit']) expect(flat).toContain(good);
  });
  it('lists remote-debugging switches that production refuses', () => {
    expect(DEBUG_SWITCHES).toEqual(expect.arrayContaining(['remote-debugging-port', 'remote-debugging-pipe', 'inspect']));
  });
});
