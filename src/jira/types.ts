export interface JiraAdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: JiraAdfNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface JiraAdfDoc {
  version: 1;
  type: "doc";
  content: JiraAdfNode[];
}

export type AdfSection =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: "paragraph"; label?: string; value: string };

export interface CreateIssueInput {
  summary: string;
  body: JiraAdfDoc;
  projectKey: string;
  issueType: string;
}

export type CreateIssueErrorCode =
  | "missing_config"
  | "unauthorized"
  | "forbidden"
  | "bad_request"
  | "not_found"
  | "server_error"
  | "network_error";

export type CreateIssueResult =
  | { ok: true; issueKey: string; issueUrl: string }
  | { ok: false; errorCode: CreateIssueErrorCode };

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey?: string;
  issueType?: string;
  authHeader: string;
}

export interface IssueType {
  id: string;
  name: string;
}

export type FetchIssueTypesErrorCode =
  | "missing_config"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "server_error"
  | "network_error";

export type FetchIssueTypesResult =
  | { ok: true; issueTypes: IssueType[] }
  | { ok: false; errorCode: FetchIssueTypesErrorCode };

export interface JiraSinglePayload {
  kind: "single";
  id: string;
  title: string;
  severity: string;
  o: string;
  r: string;
  h: string;
  b: string;
}

export interface JiraBulkPayload {
  kind: "bulk";
  o: string;
  r: string;
  h: string;
  b: string;
  totals: { c: number; s: number; m: number; mi: number };
  count: number;
}

export type JiraSlackPayload = JiraSinglePayload | JiraBulkPayload;
