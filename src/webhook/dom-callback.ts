import crypto from "node:crypto";
import { CONFIG } from "../config.js";
import { getRepoOctokit } from "../github/auth.js";
import { completeDomAuditCheck } from "../review/dom-reporter.js";
import type { DomAuditFindingSummary, DomAuditSummary, PatternAuditSummary, PatternFindingSummary } from "../types.js";


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

function normalizePatternFindings(input: unknown): PatternAuditSummary | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const findings = Array.isArray(raw.findings)
    ? (raw.findings as unknown[])
        .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === "object")
        .map((f): PatternFindingSummary => ({
          id: typeof f.id === "string" ? f.id.trim() : "",
          title: typeof f.title === "string" ? f.title.trim() : "",
          severity: typeof f.severity === "string" ? f.severity.trim() : "",
          file: typeof f.file === "string" ? f.file.trim() : "",
          line: typeof f.line === "number" ? f.line : undefined,
          patternId: typeof f.patternId === "string" ? f.patternId.trim() : "",
        }))
        .filter((f) => f.id && f.title && f.severity)
    : [];
  const totals = {
    Critical: Number((raw.totals as Record<string, unknown>)?.Critical ?? 0),
    Serious: Number((raw.totals as Record<string, unknown>)?.Serious ?? 0),
    Moderate: Number((raw.totals as Record<string, unknown>)?.Moderate ?? 0),
    Minor: Number((raw.totals as Record<string, unknown>)?.Minor ?? 0),
  };
  return { totalFindings: Number(raw.totalFindings ?? findings.length), totals, findings };
}

function severityIcon(severity: string): string {
  const normalized = severity.trim().toLowerCase();
  if (normalized === "critical") return "🔴";
  if (normalized === "serious") return "🟠";
  if (normalized === "moderate") return "🟡";
  if (normalized === "minor") return "🔵";
  return "⚪";
}

function buildPatternSection(patternFindings: PatternAuditSummary): string {
  const summaryLine = `🔴 Critical: ${patternFindings.totals.Critical} | 🟠 Serious: ${patternFindings.totals.Serious} | 🟡 Moderate: ${patternFindings.totals.Moderate} | 🔵 Minor: ${patternFindings.totals.Minor}`;

  if (patternFindings.findings.length === 0) {
    return [
      "### Source Pattern Analysis",
      "",
      "Static analysis of changed source files. Detects known accessibility anti-patterns before the code runs.",
      "",
      "No source pattern issues found.",
    ].join("\n");
  }

  const list = patternFindings.findings
    .map((finding, index) => {
      const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      const lines = [
        `${index + 1}. ${severityIcon(finding.severity)} **[${finding.severity}]** ${finding.title}`,
        `   **File:** \`${location}\``,
        `   **Rule:** \`${finding.patternId}\``,
        `   **Fix:** \`/a11y-fix ${finding.id}\``,
      ];
      return lines.join("\n");
    })
    .join("\n\n");

  return [
    "### Source Pattern Analysis",
    "",
    "Static analysis of changed source files. Detects known accessibility anti-patterns before the code runs.",
    "",
    summaryLine,
    "",
    list,
  ].join("\n");
}

export function buildFinalComment(summary: DomAuditSummary): string {
  const mode = summary.auditMode ?? "unified";

  if (mode === "source") {
    if (summary.status === "failure") {
      return [
        "### Source Pattern Analysis",
        "",
        "Static analysis of changed source files. Detects known accessibility anti-patterns before the code runs.",
        "",
        `**Error:** ${summary.error ?? "Unknown error"}`,
        "",
        "Run `/a11y-audit-source` to retry.",
      ].join("\n");
    }

    const hasFindings = summary.patternFindings && summary.patternFindings.totalFindings > 0;
    const quickFixSection = hasFindings
      ? [
          "",
          "---",
          "",
          "### Quick Fix",
          "",
          "Fix a single finding: `/a11y-fix <ID>`",
          "Fix several: `/a11y-fix <ID1> <ID2> <ID3>`",
          "Fix all: `/a11y-fix all`",
          "",
          "> 💡 Pass a hint to guide the fix: `/a11y-fix all \"use sr-only labels\"` or `/a11y-fix <ID> \"prefer Tailwind classes\"`",
        ]
      : [];

    const patternBody = summary.patternFindings
      ? buildPatternSection(summary.patternFindings)
      : [
          "### Source Pattern Analysis",
          "",
          "Static analysis of changed source files. Detects known accessibility anti-patterns before the code runs.",
          "",
          "No source pattern issues found.",
        ].join("\n");

    return [patternBody, ...quickFixSection].join("\n");
  }

  if (summary.status === "failure") {
    return [
      "### DOM Audit",
      "",
      "Dynamic scan of the rendered page in a real browser. Evaluates the live DOM against WCAG standards.",
      "",
      `**Error:** ${summary.error ?? "Unknown error"}`,
      "",
      "Run `/a11y-audit` to retry.",
    ].join("\n");
  }

  const findingsSection =
    summary.findings && summary.findings.length > 0
      ? [
          "",
          summary.totalFindings > summary.findings.length
            ? `Showing **${summary.findings.length}** of **${summary.totalFindings}**`
            : "",
          "",
          summary.findings
            .map((finding, index) => {
              const lines = [
                `${index + 1}. ${severityIcon(finding.severity)} **[${finding.severity}]** ${finding.title}`,
              ];
              if (finding.url) {
                try {
                  const pathname = new URL(finding.url).pathname;
                  const name = pathname.replace(/\/index\.html$/, "/").replace(/\.html$/, "").replace(/^\//, "") || "home";
                  lines.push(`   **Page:** \`${name}\``);
                } catch { /* ignore unparseable URLs */ }
              }
              if (finding.wcag && /\d+\.\d+\.\d+/.test(finding.wcag)) lines.push(`   **WCAG:** ${finding.wcag}`);
              if (finding.selector) lines.push(`   **Selector:** \`${finding.selector}\``);
              if (finding.id) lines.push(`   **Fix:** \`/a11y-fix ${finding.id}\``);
              return lines.join("\n");
            })
            .join("\n\n"),
        ].filter((line) => line !== "")
      : [];

  const hasAnyFindings =
    summary.totalFindings > 0 || (summary.patternFindings && summary.patternFindings.totalFindings > 0);

  const quickFixSection = hasAnyFindings
    ? [
        "",
        "---",
        "",
        "### Quick Fix",
        "",
        "Fix a single finding: `/a11y-fix <ID>`",
        "Fix several: `/a11y-fix <ID1> <ID2> <ID3>`",
        "Fix all: `/a11y-fix all`",
        "",
        "> 💡 Pass a hint to guide the fix: `/a11y-fix all \"use sr-only labels\"` or `/a11y-fix <ID> \"prefer Tailwind classes\"`",
      ]
    : [];

  const domSection = summary.totalFindings === 0
    ? [
        "### DOM Audit",
        "",
        "Dynamic scan of the rendered page in a real browser. Evaluates the live DOM against WCAG standards.",
        "",
        "No DOM accessibility issues found.",
      ].join("\n")
    : [
        "### DOM Audit",
        "",
        "Dynamic scan of the rendered page in a real browser. Evaluates the live DOM against WCAG standards.",
        "",
        `**Total findings:** ${summary.totalFindings}`,
        `🔴 Critical: ${summary.totals.Critical} | 🟠 Serious: ${summary.totals.Serious} | 🟡 Moderate: ${summary.totals.Moderate} | 🔵 Minor: ${summary.totals.Minor}`,
        ...findingsSection,
        ...quickFixSection,
      ].join("\n");

  if (mode === "dom") {
    return domSection;
  }

  if (summary.patternFindings) {
    return `${buildPatternSection(summary.patternFindings)}\n\n---\n\n${domSection}`;
  }

  return domSection;
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
  const patternFindings = normalizePatternFindings(input.payload.pattern_findings);
  const rawAuditMode = typeof input.payload.audit_mode === "string" ? input.payload.audit_mode : "";
  const auditMode: DomAuditSummary["auditMode"] =
    rawAuditMode === "dom" || rawAuditMode === "source" || rawAuditMode === "unified"
      ? rawAuditMode
      : "unified";

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
    patternFindings,
    error,
    auditMode,
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
      const commentId = Number(input.payload.comment_id ?? 0);

      const finalBody = buildFinalComment(summary);

      if (commentId > 0) {
        try {
          await octokit.rest.issues.updateComment({ owner, repo, comment_id: commentId, body: finalBody });
        } catch (updateErr) {
          const status = (updateErr as { status?: number }).status;
          if (status !== 404) throw updateErr;
          await octokit.rest.issues.createComment({ owner, repo, issue_number: pullNumber, body: finalBody });
        }
      } else {
        await octokit.rest.issues.createComment({ owner, repo, issue_number: pullNumber, body: finalBody });
      }
    }

    return { status: 200, body: { ok: true, updated: true } };
  } catch (callbackError) {
    const message = callbackError instanceof Error ? callbackError.message : "Unknown error";
    return { status: 500, body: { ok: false, error: message } };
  }
}
