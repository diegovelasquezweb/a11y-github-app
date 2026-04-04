import crypto from "node:crypto";
import { CONFIG } from "../config.js";
import { getRepoOctokit } from "../github/auth.js";
import { completeDomAuditCheck } from "../review/dom-reporter.js";
import type { DomAuditFindingSummary, DomAuditSummary } from "../types.js";

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

function normalizeFinding(input: unknown): DomAuditFindingSummary | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const finding = input as Record<string, unknown>;
  const title = typeof finding.title === "string" ? finding.title.trim() : "";
  const severity = typeof finding.severity === "string" ? finding.severity.trim() : "";

  if (!title || !severity) {
    return null;
  }

  return {
    id: typeof finding.id === "string" ? finding.id.trim() : "",
    title,
    severity,
    wcag: typeof finding.wcag === "string" && finding.wcag.trim() ? finding.wcag.trim() : null,
    url: typeof finding.url === "string" ? finding.url.trim() : "",
    selector: typeof finding.selector === "string" ? finding.selector.trim() : "",
    recommendedFix:
      typeof finding.recommendedFix === "string" && finding.recommendedFix.trim()
        ? finding.recommendedFix.trim()
        : null,
  };
}

function normalizeFindings(input: unknown): DomAuditFindingSummary[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((finding) => normalizeFinding(finding))
    .filter((finding): finding is DomAuditFindingSummary => Boolean(finding));
}

function severityIcon(severity: string): string {
  const normalized = severity.trim().toLowerCase();
  if (normalized === "critical") return "🔴";
  if (normalized === "serious") return "🟠";
  if (normalized === "moderate") return "🟡";
  if (normalized === "minor") return "🔵";
  return "⚪";
}

function buildFinalComment(summary: DomAuditSummary): string {
  if (summary.status === "failure") {
    return [
      "## DOM Audit Failed",
      "",
      `**Error:** ${summary.error ?? "Unknown error"}`,
      "",
      "Run `/audit` to retry.",
    ].join("\n");
  }

  const findingsSection =
    summary.findings && summary.findings.length > 0
      ? [
          "",
          "### Top Findings",
          "",
          `Showing **${summary.findings.length}**${summary.totalFindings > summary.findings.length ? ` of **${summary.totalFindings}**` : ""}`,
          "",
          summary.findings
            .map((finding, index) =>
              [
                `${index + 1}. **${severityIcon(finding.severity)} [${finding.severity}]** ${finding.title}`,
                finding.id ? `   **Finding ID:** \`${finding.id}\`` : "",
                finding.wcag ? `   **WCAG:** ${finding.wcag}` : "",
                finding.selector ? `   **Selector:** \`${finding.selector}\`` : "",
                finding.recommendedFix ? `   **Fix:** ${finding.recommendedFix}` : "",
                finding.id ? `   **Auto-fix:** \`/a11y-fix ${finding.id}\`` : "",
                finding.id ? `   **Ignore:** \`/a11y-ignore ${finding.id}\`` : "",
              ]
                .filter(Boolean)
                .join("\n"),
            )
            .join("\n\n"),
        ]
      : [];

  return [
    "## DOM Audit Finished",
    "",
    "### Summary",
    "",
    `**Total findings:** ${summary.totalFindings}`,
    `**Severity:** 🔴 Critical: ${summary.totals.Critical} | 🟠 Serious: ${summary.totals.Serious} | 🟡 Moderate: ${summary.totals.Moderate} | 🔵 Minor: ${summary.totals.Minor}`,
    ...findingsSection,
    "",
    `**Scan token:** \`${summary.scanToken}\``,
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
  const findings = normalizeFindings(input.payload.findings);

  if (!owner || !repo || !checkRunId) {
    return { status: 400, body: { ok: false, error: "Missing callback target fields" } };
  }

  const summary: DomAuditSummary = {
    scanToken,
    targetUrl,
    status,
    totalFindings,
    totals,
    findings,
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
