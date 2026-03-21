import type { SourcePatternFinding } from "@diegovelasquezweb/a11y-engine";

export interface ChangedFile {
  filename: string;
  status: string;
  patch?: string;
}

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
}

export interface AnalyzedFinding {
  finding: SourcePatternFinding;
  path: string;
  line: number;
  hasInlineLocation: boolean;
}

export interface ReviewAnalysisResult {
  findings: AnalyzedFinding[];
  comments: ReviewComment[];
  scannedFiles: number;
  ignoredFiles: number;
}
