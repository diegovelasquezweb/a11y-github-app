import crypto from "node:crypto";
import { CONFIG } from "../config.js";
import { getRepoOctokit } from "../github/auth.js";
import { completeDomAuditCheck } from "../review/dom-reporter.js";
import type { DomAuditSummary } from "../types.js";

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function normalizeTotals(input?: Partial<Record<keyof DomAuditSummary["totals"], number>>) {
  return {
    Critical: Number(input?.Critical ?? 0),
    Serious: Number(input?.Serious ?? 0),
    Moderate: Number(input?.Moderate ?? 0),
    Minor: Number(input?.Minor ?? 0),
  };
}

export interface DomCallbackInput {
  token?: string;
  payload: Record<string, unknown>;
}

export interface DomCallbackResult {
  status: number;
  body: Record<string, unknown>;
}

function buildFinalComment(summary: DomAuditSummary): string {
  if (summary.status === "failure") {
    return [
      "DOM audit finished with an execution error.",
      "",
      `Target URL: ${summary.targetUrl || "unknown"}`,
      `Error: ${summary.error ?? "Unknown error"}`,
      "",
      "Run `/audit` to retry.",
    ].join("\n");
  }

  return [
    "DOM audit finished.",
    "",
    `Target URL: ${summary.targetUrl}`,
    `Total findings: ${summary.totalFindings}`,
    `Critical: ${summary.totals.Critical} | Serious: ${summary.totals.Serious} | Moderate: ${summary.totals.Moderate} | Minor: ${summary.totals.Minor}`,
    "",
    `Scan token: ${summary.scanToken}`,
  ].join("\n");
}

export async function processDomAuditCallback(
  input: DomCallbackInput,
): Promise<DomCallbackResult> {
  if (!CONFIG.domAuditCallbackToken) {
    return { status: 503, body: { ok: false, error: "Callback token is not configured" } };
  }

  if (!input.token || !safeEqual(input.token, CONFIG.domAuditCallbackToken)) {
    return { status: 401, body: { ok: false, error: "Invalid callback token" } };
  }

  const owner = String(input.payload.target_owner ?? "");
  const repo = String(input.payload.target_repo ?? "");
  const checkRunId = Number(input.payload.check_run_id ?? 0);
  const pullNumber = Number(input.payload.pull_number ?? 0);
  const scanToken = String(input.payload.scan_token ?? "");
  const targetUrl = String(input.payload.target_url ?? "");
  const status = input.payload.status === "failure" ? "failure" : "success";
  const totalFindings = Number(input.payload.total_findings ?? 0);
  const error = typeof input.payload.error === "string" ? input.payload.error : undefined;
  const totals = normalizeTotals(
    (input.payload.totals as Partial<Record<keyof DomAuditSummary["totals"], number>>) ?? {},
  );

  if (!owner || !repo || !checkRunId) {
    return { status: 400, body: { ok: false, error: "Missing callback target fields" } };
  }

  const summary: DomAuditSummary = {
    scanToken,
    targetUrl,
    status,
    totalFindings,
    totals,
    error,
  };

  try {
    const octokit = await getRepoOctokit(owner, repo);
    await completeDomAuditCheck({
      octokit,
      owner,
      repo,
      checkRunId,
      summary,
    });

    if (pullNumber > 0) {
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: buildFinalComment(summary),
      });
    }

    return { status: 200, body: { ok: true, updated: true } };
  } catch (callbackError) {
    const message = callbackError instanceof Error ? callbackError.message : "Unknown error";
    return { status: 500, body: { ok: false, error: message } };
  }
}
