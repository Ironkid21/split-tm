import { TranslationUnit, ScanResult, FilterCriteria, SkippedUnit, UnitMeta } from './model.js';
import { parseTmx, parseTmxStream } from './tmxParser.js';
import { forEachTmxInZip } from './zipStream.js';
import { NO_BRAND } from '../shared/constants.js';
export { NO_BRAND };

const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };

export const metaOf = (u: TranslationUnit): UnitMeta => ({
  customer: u.customer, projects: u.projects, brands: u.brands, approvalStatus: u.approvalStatus, translationStatus: u.translationStatus,
  creation: u.creationDate?.getTime() ?? null, modified: u.modifiedDate?.getTime() ?? null,
  srcLang: u.source.language, tgtLangs: u.targets.map((t) => t.language), fp: fnv(u.tuid),
});

/** Single filtering rule used for the live count, every exporter and the tests. Empty list = no filter; OR inside a dimension, AND across. */
export function matchesFilter(m: UnitMeta, f: FilterCriteria): boolean {
  const has = (sel: string[] | undefined, vals: string[]) => !sel?.length || vals.some((v) => sel.includes(v));
  if (!has(f.customers, [m.customer])) return false;
  if (!has(f.brands, m.brands.length ? m.brands : [NO_BRAND])) return false;
  if (!has(f.projects, m.projects)) return false;
  if (!has(f.approvalStatuses, [m.approvalStatus])) return false;
  if (f.dateFrom || f.dateTo) {
    const d = m.creation; // the date filter always uses the creation date
    if (d === null) return false;
    if (f.dateFrom && d < f.dateFrom.getTime()) return false;
    if (f.dateTo && d > f.dateTo.getTime()) return false;
  }
  return true;
}
export const filterUnits = (units: TranslationUnit[], f: FilterCriteria): TranslationUnit[] => units.filter((u) => matchesFilter(metaOf(u), f));

type Source = { kind: 'tmx' | 'zip'; path: string; label: string };
const TICK = 2000;

export class Dataset {
  index: UnitMeta[] = [];
  skipped: SkippedUnit[] = [];
  warnings: string[] = [];
  sources: Source[] = [];
  fileCount = 0;
  headerAttrs: Record<string, string> = {};
  /** Only filled when constructed with keepUnits (tests, validation). Real runs never hold segment text in memory. */
  units: TranslationUnit[] = [];
  onProgress?: (units: number, file: string) => void;
  private pool = new Map<string, string>();
  private arrays = new Map<string, string[]>();
  private current = '';

  constructor(private opts: { keepUnits?: boolean } = {}) {}

  private s(v: string) { const e = this.pool.get(v); if (e !== undefined) return e; this.pool.set(v, v); return v; }
  private a(v: string[]) { const k = v.join('\u0001'); let e = this.arrays.get(k); if (!e) { e = v.map((x) => this.s(x)); this.arrays.set(k, e); } return e; }

  private ingest(u: TranslationUnit) {
    const m = metaOf(u);
    this.index.push({ ...m, customer: this.s(m.customer), projects: this.a(m.projects), brands: this.a(m.brands), approvalStatus: this.s(m.approvalStatus), translationStatus: this.s(m.translationStatus), srcLang: this.s(m.srcLang), tgtLangs: this.a(m.tgtLangs) });
    if (this.opts.keepUnits) this.units.push(u);
    if (this.index.length % TICK === 0) this.onProgress?.(this.index.length, this.current);
  }
  private noteHeader(attrs: Record<string, string>) { if (!this.fileCount) this.headerAttrs = attrs; this.fileCount++; }

  async addTmx(path: string, label: string) {
    this.current = label;
    const h = await parseTmx(path, { sourceFile: label, onUnit: (u) => this.ingest(u), onSkip: (k) => this.skipped.push(k) });
    this.noteHeader(h.attrs);
    this.sources.push({ kind: 'tmx', path, label });
  }
  addFile(path: string, label: string) { return this.addTmx(path, label); }

  async addZip(path: string, label: string) {
    const r = await forEachTmxInZip(path, async (name, stream) => {
      this.current = `${label}:${name}`;
      const h = await parseTmxStream(stream, { sourceFile: this.current, onUnit: (u) => this.ingest(u), onSkip: (k) => this.skipped.push(k) });
      this.noteHeader(h.attrs);
    });
    for (const n of r.unsafe) this.warnings.push(`Ignored unsafe entry "${n}" in ${label}.`);
    this.sources.push({ kind: 'zip', path, label });
  }

  /** Re-reads the inputs in the same order as the scan and calls back with each full unit and its index ordinal. */
  async forEachUnit(cb: (u: TranslationUnit, ordinal: number) => void, onTick?: (n: number) => void) {
    let ord = 0;
    const visit = (u: TranslationUnit) => {
      const m = this.index[ord];
      if (!m || m.fp !== fnv(u.tuid) || m.srcLang !== u.source.language)
        throw new Error('The input files changed after they were scanned. Please add them again.');
      cb(u, ord++);
      if (onTick && ord % TICK === 0) onTick(ord);
    };
    for (const src of this.sources) {
      if (src.kind === 'tmx') await parseTmx(src.path, { sourceFile: src.label, onUnit: visit });
      else await forEachTmxInZip(src.path, (name, stream) => parseTmxStream(stream, { sourceFile: `${src.label}:${name}`, onUnit: visit }).then(() => undefined));
    }
    if (ord !== this.index.length) throw new Error('The input files changed after they were scanned. Please add them again.');
  }

  facets() {
    const count = (k: (m: UnitMeta) => string[]) => {
      const mp = new Map<string, number>();
      for (const m of this.index) for (const v of new Set(k(m))) if (v) mp.set(v, (mp.get(v) ?? 0) + 1);
      return Object.fromEntries([...mp].sort((x, y) => x[0].localeCompare(y[0])));
    };
    let noBrand = 0;
    for (const m of this.index) if (!m.brands.length) noBrand++;
    return {
      brands: count((m) => m.brands), projects: count((m) => m.projects), customers: count((m) => [m.customer]),
      approvalStatuses: count((m) => [m.approvalStatus]), translationStatuses: count((m) => [m.translationStatus]),
      sourceLanguages: count((m) => [m.srcLang]), targetLanguages: count((m) => m.tgtLangs), noBrand,
    };
  }

  scan(): ScanResult {
    const set = (k: (m: UnitMeta) => string[]) => { const x = new Set<string>(); for (const m of this.index) for (const v of k(m)) if (v) x.add(v); return [...x].sort(); };
    const range = (k: 'creation' | 'modified'): [Date | null, Date | null] => {
      let lo = Infinity, hi = -Infinity;
      for (const m of this.index) { const v = m[k]; if (v !== null) { if (v < lo) lo = v; if (v > hi) hi = v; } }
      return lo === Infinity ? [null, null] : [new Date(lo), new Date(hi)];
    };
    const [c0, c1] = range('creation'), [m0, m1] = range('modified');
    let assignments = 0;
    for (const m of this.index) assignments += m.brands.length;
    return {
      fileCount: this.fileCount, unitCount: this.index.length, skippedCount: this.skipped.length,
      customers: set((m) => [m.customer]), projects: set((m) => m.projects), brands: set((m) => m.brands), brandAssignments: assignments,
      approvalStatuses: set((m) => [m.approvalStatus]), translationStatuses: set((m) => [m.translationStatus]),
      sourceLanguages: set((m) => [m.srcLang]), targetLanguages: set((m) => m.tgtLangs),
      minCreation: c0, maxCreation: c1, minModified: m0, maxModified: m1,
    };
  }
}
