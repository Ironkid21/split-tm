export interface Segment { language: string; text: string; }

export interface SkippedUnit { tuid: string; sourceFile: string; reason: string; }

export interface TranslationUnit {
  tuid: string;
  sourceFile: string;
  customer: string;
  projects: string[];
  brands: string[];
  approvalStatus: string;
  translationStatus: string;
  creationDate: Date | null;
  modifiedDate: Date | null;
  source: Segment;
  targets: Segment[];
  originalXml: string;
  attrs: Record<string, string>;
  metadata: Record<string, string[]>;
}

/** Compact per-unit record kept in memory after scanning (no segment text). Strings and arrays are shared between units. */
export interface UnitMeta {
  customer: string; projects: string[]; brands: string[]; approvalStatus: string; translationStatus: string;
  creation: number | null; modified: number | null; srcLang: string; tgtLangs: string[];
  /** 32-bit fingerprint of the TUID, used to detect that the input changed between the scan and the export. */
  fp: number;
}

export interface ScanResult {
  fileCount: number;
  unitCount: number;
  skippedCount: number;
  customers: string[];
  projects: string[];
  brands: string[];
  brandAssignments: number;
  approvalStatuses: string[];
  translationStatuses: string[];
  sourceLanguages: string[];
  targetLanguages: string[];
  minCreation: Date | null; maxCreation: Date | null;
  minModified: Date | null; maxModified: Date | null;
}

export interface FilterCriteria {
  customers?: string[];
  brands?: string[];
  projects?: string[];
  approvalStatuses?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  /** Languages to use as source. Empty/absent = all sources. */
  sourceLanguages?: string[];
  /** Languages to include as targets. Empty/absent = all targets. */
  targetLanguages?: string[];
  /** Explicit All-to-All: every source and target language in the input (same selection as leaving both lists empty). */
  allToAll?: boolean;
}
