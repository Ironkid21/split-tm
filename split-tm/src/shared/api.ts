import type { SkippedUnit, FilterCriteria, ScanResult, OutputFormat, OutputMode, MarketOutputMode, Progress, RunResult, UpgradeReport } from '../engine/index';

export type Facets = {
  brands: Record<string, number>; projects: Record<string, number>; customers: Record<string, number>;
  approvalStatuses: Record<string, number>; translationStatuses: Record<string, number>;
  sourceLanguages: Record<string, number>; targetLanguages: Record<string, number>; noBrand: number;
};
export type Scanned = { scan: ScanResult; facets: Facets; skipped: SkippedUnit[] };
/** Live preview: units selected overall and, when several Brands are selected, units per Brand. */
export type Preview = { count: number; perBrand: Record<string, number> };
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
export type AppInfo = { version: string; outputRoot: string; logFile: string; channel: string };

export interface SplitTmApi {
  info(): Promise<Result<AppInfo>>;
  upgradeNotice(): Promise<Result<UpgradeReport | null>>;
  pickFiles(): Promise<Result<string[]>>;
  pathForFile(f: File): string;
  scan(paths: string[]): Promise<Result<Scanned>>;
  count(filter: FilterCriteria): Promise<Result<number>>;
  preview(filter: FilterCriteria): Promise<Result<Preview>>;
  process(filter: FilterCriteria, format: OutputFormat, mode: OutputMode, marketMode: MarketOutputMode): Promise<Result<RunResult>>;
  closeApp(): Promise<Result<true>>;
  chooseOutputRoot(): Promise<Result<AppInfo | null>>;
  openPath(p: string): Promise<Result<true>>;
  onProgress(cb: (p: Progress) => void): () => void;
}
declare global { interface Window { splitTM: SplitTmApi } }
