import { TranslationUnit, FilterCriteria, UnitMeta } from './model.js';
import { matchesFilter, metaOf } from './dataset.js';

type LangSel = Pick<FilterCriteria, 'sourceLanguages' | 'targetLanguages' | 'allToAll'>;
export type LangSets = { S: Set<string> | null; T: Set<string> | null; mode: 'all' | 'selected' | 'all-to-all' };

/** null = "all". All-to-All is the explicit form of selecting every source and every target. */
export function langSets(f: LangSel): LangSets {
  const S = !f.allToAll && f.sourceLanguages?.length ? new Set(f.sourceLanguages) : null;
  const T = !f.allToAll && f.targetLanguages?.length ? new Set(f.targetLanguages) : null;
  return { S, T, mode: f.allToAll ? 'all-to-all' : S || T ? 'selected' : 'all' };
}

/** Target languages kept for a unit; null = its source language is not selected; 'no-target' = nothing selected is present. */
export function keptTargets(src: string, tgts: string[], { S, T }: LangSets): string[] | null | 'no-target' {
  if (S && !S.has(src)) return null;
  const kept = tgts.filter((l) => l !== src && (!T || T.has(l)));
  return kept.length ? kept : 'no-target';
}

export interface Selection {
  /** mask[i] = 1 when the i-th scanned unit is exported. */
  mask: Uint8Array;
  count: number;
  /** Units that passed the metadata filters (before language selection). */
  filteredCount: number;
  columns: string[]; sources: string[]; targets: string[];
  /** Every language that is a target of at least one exported unit (can include languages that are also sources). */
  targetsUsed: string[];
  mode: LangSets['mode'];
  /** Units of a selected source language with none of the selected target languages. Reported, not exported. */
  excludedNoTarget: number;
  sets: LangSets;
}

/**
 * One consolidated selection: filters first, then languages. A unit is exported when its source language is selected and it has
 * at least one selected target. Columns: source languages actually used (sorted) first, then the other languages (sorted).
 */
export function planSelection(index: UnitMeta[], f: FilterCriteria): Selection {
  const sets = langSets(f);
  const mask = new Uint8Array(index.length);
  const usedS = new Set<string>(), usedT = new Set<string>();
  let count = 0, filteredCount = 0, excludedNoTarget = 0;
  for (let i = 0; i < index.length; i++) {
    const m = index[i];
    if (!matchesFilter(m, f)) continue;
    filteredCount++;
    const k = keptTargets(m.srcLang, m.tgtLangs, sets);
    if (k === null) continue;
    if (k === 'no-target') { excludedNoTarget++; continue; }
    mask[i] = 1; count++; usedS.add(m.srcLang);
    for (const l of k) usedT.add(l);
  }
  const sources = [...usedS].sort();
  const targets = [...(sets.T ?? usedT)].filter((l) => !usedS.has(l)).sort();
  return { mask, count, filteredCount, columns: [...sources, ...targets], sources, targets, targetsUsed: [...usedT].sort(), mode: sets.mode, excludedNoTarget, sets };
}

/** The unit with its targets reduced to the selected target languages (a copy). */
export function trimUnit(u: TranslationUnit, sets: LangSets): TranslationUnit | null {
  const k = keptTargets(u.source.language, u.targets.map((t) => t.language), sets);
  if (!Array.isArray(k)) return null;
  return { ...u, targets: u.targets.filter((t) => k.includes(t.language)) };
}

export interface LanguagePlan {
  units: TranslationUnit[]; columns: string[]; sources: string[]; targets: string[]; mode: LangSets['mode']; excludedNoTarget: number;
}
/** In-memory convenience (tests, small inputs): same rules as planSelection/trimUnit, without metadata filters. */
export function applyLanguages(units: TranslationUnit[], f: LangSel): LanguagePlan {
  const sel = planSelection(units.map(metaOf), f);
  const out: TranslationUnit[] = [];
  units.forEach((u, i) => { if (sel.mask[i]) out.push(trimUnit(u, sel.sets)!); });
  return { units: out, columns: sel.columns, sources: sel.sources, targets: sel.targets, mode: sel.mode, excludedNoTarget: sel.excludedNoTarget };
}
