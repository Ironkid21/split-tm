const cache = new Map<string, Intl.DisplayNames>();

/** Human-readable language name from the language part of a code ("en-GB" -> "English"), or '' if unknown. */
export function langName(code: string, ui = 'en'): string {
  try {
    const base = code.split(/[-_]/)[0];
    let dn = cache.get(ui);
    if (!dn) { dn = new Intl.DisplayNames([ui], { type: 'language' }); cache.set(ui, dn); }
    const n = dn.of(base);
    return n && n.toLowerCase() !== base.toLowerCase() ? n : '';
  } catch { return ''; }
}

/** "English — en_GB". Falls back to the bare code when the language name is unknown. */
export function langLabel(code: string): string {
  const c = code.replace(/-/g, '_');
  const n = langName(code);
  return n ? `${n} — ${c}` : c;
}
