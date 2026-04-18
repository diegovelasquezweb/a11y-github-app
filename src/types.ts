import type { SourcePatternFinding } from "@diegovelasquezweb/a11y-engine";

export type AuditMode = "unified" | "dom" | "source";

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

export interface DomAuditTotals {
  Critical: number;
  Serious: number;
  Moderate: number;
  Minor: number;
}

export interface DomAuditFindingSummary {
  id: string;
  title: string;
  severity: string;
  wcag: string | null;
  url: string;
  selector: string;
  recommendedFix: string | null;
}

export interface PatternFindingSummary {
  id: string;
  title: string;
  severity: string;
  file: string;
  line?: number;
  patternId: string;
}

export interface PatternAuditSummary {
  totalFindings: number;
  totals: DomAuditTotals;
  findings: PatternFindingSummary[];
}

export interface DomAuditSummary {
  scanToken: string;
  targetUrl: string;
  status: "success" | "failure";
  totalFindings: number;
  totals: DomAuditTotals;
  findings?: DomAuditFindingSummary[];
  patternFindings?: PatternAuditSummary;
  error?: string;
  auditMode?: AuditMode;
}

export interface SlackContext {
  channelId: string;
  messageTs: string;
  threadTs?: string;
}
