import type { DomAuditSummary, PatternAuditSummary } from "../types.js";

function severityIcon(severity: string): string {
  const s = severity.trim().toLowerCase();
  if (s === "critical") return "■■■■";
  if (s === "serious") return "■■■◻";
  if (s === "moderate") return "■■◻◻";
  if (s === "minor") return "■◻◻◻";
  return "◻◻◻◻";
}

function escapeHtmlTags(text: string): string {
  return text.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (_, tag) => `\`<${tag}>\``);
}

interface ResultContext {
  owner: string;
  repo: string;
  branch?: string;
  githubCommentUrl?: string;
}

export function formatAuditResultBlocks(
  summary: DomAuditSummary,
  context: ResultContext,
): Record<string, unknown>[] {
  const label = `${context.owner}/${context.repo}`;

  if (summary.status === "failure") {
    return [
      { type: "header", text: { type: "plain_text", text: `❌ Audit Failed — ${label}` } },
      { type: "context", elements: [
        { type: "mrkdwn", text: `Branch: \`${context.branch ?? "default"}\`` },
      ]},
      { type: "section", text: { type: "mrkdwn", text: `*Error:* ${summary.error ?? "Unknown error"}` } },
      { type: "actions", elements: [
        { type: "button", text: { type: "plain_text", text: "Retry Audit" }, action_id: "a11y_retry_audit" },
      ]},
    ];
  }

  const blocks: Record<string, unknown>[] = [];
  const total = summary.totalFindings + (summary.patternFindings?.totalFindings ?? 0);

  if (total === 0) {
    blocks.push(
      { type: "header", text: { type: "plain_text", text: `✅ Audit Complete — ${label}` } },
      { type: "context", elements: [
        { type: "mrkdwn", text: `Branch: \`${context.branch ?? "default"}\` · 0 findings` },
      ]},
      { type: "section", text: { type: "mrkdwn", text: "No accessibility issues found." } },
    );
  } else {
    blocks.push(
      { type: "header", text: { type: "plain_text", text: `🔍 A11y Audit Results — ${label}` } },
      { type: "context", elements: [
        { type: "mrkdwn", text: `Branch: \`${context.branch ?? "default"}\` · ${total} findings` },
      ]},
    );

    const t = summary.totals;
    const pt = summary.patternFindings?.totals;
    const combinedTotals = {
      Critical: t.Critical + (pt?.Critical ?? 0),
      Serious: t.Serious + (pt?.Serious ?? 0),
      Moderate: t.Moderate + (pt?.Moderate ?? 0),
      Minor: t.Minor + (pt?.Minor ?? 0),
    };
    blocks.push({ type: "section", text: { type: "mrkdwn", text:
      `■■■■ Critical: ${combinedTotals.Critical}  ■■■◻ Serious: ${combinedTotals.Serious}  ■■◻◻ Moderate: ${combinedTotals.Moderate}  ■◻◻◻ Minor: ${combinedTotals.Minor}`,
    }});

    if (summary.patternFindings && summary.patternFindings.findings.length > 0) {
      blocks.push({ type: "divider" });
      blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Source Pattern Analysis*" } });
      appendPatternFindings(blocks, summary.patternFindings, 10);
    }

    if (summary.findings && summary.findings.length > 0) {
      blocks.push({ type: "divider" });
      blocks.push({ type: "section", text: { type: "mrkdwn", text: "*DOM Audit*" } });
      const maxDom = 20 - Math.min(summary.patternFindings?.findings.length ?? 0, 10);
      const domShown = summary.findings.slice(0, maxDom);
      domShown.forEach((f, i) => {
        const text = [`*${i + 1}. ${severityIcon(f.severity)} [${f.severity}] ${escapeHtmlTags(f.title)}*`];
        if (f.url) {
          try {
            const pathname = new URL(f.url).pathname.replace(/\/index\.html$/, "/").replace(/\.html$/, "").replace(/^\//, "") || "home";
            text.push(`Page: \`${pathname}\` · Selector: \`${f.selector}\``);
          } catch {
            if (f.selector) text.push(`Selector: \`${f.selector}\``);
          }
        } else if (f.selector) {
          text.push(`Selector: \`${f.selector}\``);
        }
        blocks.push({ type: "section", text: { type: "mrkdwn", text: text.join("\n") } });
        if (f.id) {
          blocks.push({ type: "actions", elements: [
            { type: "button", text: { type: "plain_text", text: `Fix ${f.id}` }, action_id: "a11y_fix_finding", value: f.id },
          ]});
        }
      });

      if (summary.totalFindings > domShown.length) {
        const overflow = `Showing ${domShown.length} of ${summary.totalFindings} DOM findings.`;
        const link = context.githubCommentUrl ? ` <${context.githubCommentUrl}|View full list on GitHub>` : "";
        blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: overflow + link }] });
      }
    }
  }

  const actions: Record<string, unknown>[] = [];
  if (total > 0) {
    actions.push({ type: "button", text: { type: "plain_text", text: "Fix All" }, action_id: "a11y_fix_all", style: "primary" });
  }
  if (context.githubCommentUrl) {
    actions.push({ type: "button", text: { type: "plain_text", text: "View on GitHub" }, action_id: "a11y_view_github", url: context.githubCommentUrl });
  }
  if (actions.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "actions", elements: actions });
  }

  return blocks;
}

function appendPatternFindings(blocks: Record<string, unknown>[], patternFindings: PatternAuditSummary, max: number): void {
  const shown = patternFindings.findings.slice(0, max);
  shown.forEach((f, i) => {
    const location = f.line ? `${f.file}:${f.line}` : f.file;
    const text = [
      `*${i + 1}. ${severityIcon(f.severity)} [${f.severity}] ${escapeHtmlTags(f.title)}*`,
      `File: \`${location}\` · Rule: \`${f.patternId}\``,
    ];
    blocks.push({ type: "section", text: { type: "mrkdwn", text: text.join("\n") } });
    if (f.id) {
      blocks.push({ type: "actions", elements: [
        { type: "button", text: { type: "plain_text", text: `Fix ${f.id}` }, action_id: "a11y_fix_finding", value: f.id },
      ]});
    }
  });

  if (patternFindings.totalFindings > shown.length) {
    blocks.push({ type: "context", elements: [
      { type: "mrkdwn", text: `Showing ${shown.length} of ${patternFindings.totalFindings} pattern findings.` },
    ]});
  }
}

export function formatScanningBlocks(owner: string, repo: string, mode: string, branch?: string): Record<string, unknown>[] {
  return [
    { type: "header", text: { type: "plain_text", text: `⏳ Auditing ${owner}/${repo}` } },
    { type: "context", elements: [
      { type: "mrkdwn", text: `Branch: \`${branch ?? "default"}\` · Mode: ${mode}` },
    ]},
    { type: "section", text: { type: "mrkdwn", text: "Scanning in progress…" } },
  ];
}

export function formatFixProgressBlocks(owner: string, repo: string, findingIds: string): Record<string, unknown>[] {
  return [
    { type: "header", text: { type: "plain_text", text: `🔧 Applying Fix — ${owner}/${repo}` } },
    { type: "context", elements: [
      { type: "mrkdwn", text: `Finding IDs: ${findingIds}` },
    ]},
    { type: "section", text: { type: "mrkdwn", text: "Fix in progress…" } },
  ];
}
