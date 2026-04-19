import type { DomAuditSummary, PatternAuditSummary } from "../types.js";

function severityTag(severity: string): string {
  const s = severity.trim().toLowerCase();
  if (s === "critical") return ":red_circle: `Critical`";
  if (s === "serious") return ":large_orange_circle: `Serious`";
  if (s === "moderate") return ":large_yellow_circle: `Moderate`";
  if (s === "minor") return ":large_blue_circle: `Minor`";
  return ":white_circle: `Unknown`";
}

function escapeHtmlTags(text: string): string {
  return text.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (_, tag) => `\`<${tag}>\``);
}

export interface ResultContext {
  owner: string;
  repo: string;
  branch?: string;
  githubCommentUrl?: string;
  headSha?: string;
  headRef?: string;
  baseRef?: string;
  installationId?: number;
}

export function formatAuditResultBlocks(
  summary: DomAuditSummary,
  context: ResultContext,
): Record<string, unknown>[] {
  const label = `${context.owner}/${context.repo}`;

  if (summary.status === "failure") {
    return [
      { type: "header", text: { type: "plain_text", text: `Audit Failed — ${label}` } },
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
      { type: "header", text: { type: "plain_text", text: `Audit Complete — ${label}` } },
      { type: "context", elements: [
        { type: "mrkdwn", text: `Branch: \`${context.branch ?? "default"}\` · 0 findings` },
      ]},
      { type: "section", text: { type: "mrkdwn", text: "No accessibility issues found." } },
    );
  } else {
    blocks.push(
      { type: "header", text: { type: "plain_text", text: `A11y Audit Results — ${label}` } },
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
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text:
      `:red_circle: Critical: ${combinedTotals.Critical}  :large_orange_circle: Serious: ${combinedTotals.Serious}  :large_yellow_circle: Moderate: ${combinedTotals.Moderate}  :large_blue_circle: Minor: ${combinedTotals.Minor}`,
    }]});

    if (summary.patternFindings && summary.patternFindings.findings.length > 0) {
      blocks.push({ type: "divider" });
      blocks.push({ type: "section", text: { type: "mrkdwn", text: "*Source Pattern Analysis*" } });
      appendPatternFindings(blocks, summary.patternFindings, 10, context);
    }

    if (summary.findings && summary.findings.length > 0) {
      blocks.push({ type: "divider" });
      blocks.push({ type: "section", text: { type: "mrkdwn", text: "*DOM Audit*" } });
      const maxDom = 20 - Math.min(summary.patternFindings?.findings.length ?? 0, 10);
      const domShown = summary.findings.slice(0, maxDom);
      domShown.forEach((f, i) => {
        const parts = [`${severityTag(f.severity)} ${escapeHtmlTags(f.title)}`];
        if (f.url) {
          try {
            const pathname = new URL(f.url).pathname.replace(/\/index\.html$/, "/").replace(/\.html$/, "").replace(/^\//, "") || "home";
            parts.push(`Page: \`${pathname}\` · Selector: \`${f.selector}\``);
          } catch {
            if (f.selector) parts.push(`Selector: \`${f.selector}\``);
          }
        } else if (f.selector) {
          parts.push(`Selector: \`${f.selector}\``);
        }
        if (f.id) {
          const findingFixValue = JSON.stringify({
            id: f.id, o: context.owner, r: context.repo, s: context.headSha ?? "",
            h: context.headRef ?? context.branch ?? "", b: context.baseRef ?? "",
            i: context.installationId ?? 0,
          });
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: parts.join("\n") },
            accessory: { type: "button", text: { type: "plain_text", text: "Fix" }, action_id: `a11y_fix_${f.id}`, value: findingFixValue },
          });
        } else {
          blocks.push({ type: "section", text: { type: "mrkdwn", text: parts.join("\n") } });
        }
      });

      if (summary.totalFindings > domShown.length) {
        const overflow = `Showing ${domShown.length} of ${summary.totalFindings} DOM findings.`;
        const link = context.githubCommentUrl ? ` <${context.githubCommentUrl}|View full list on GitHub>` : "";
        blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: overflow + link }] });
      }
    }
  }

  const fixContext = JSON.stringify({
    o: context.owner, r: context.repo, s: context.headSha ?? "",
    h: context.headRef ?? context.branch ?? "", b: context.baseRef ?? "",
    i: context.installationId ?? 0,
  });

  const actions: Record<string, unknown>[] = [];
  if (total > 0) {
    actions.push({ type: "button", text: { type: "plain_text", text: "Fix All" }, action_id: "a11y_fix_all", value: fixContext, style: "primary" });
  }
  if (context.githubCommentUrl) {
    actions.push({ type: "button", text: { type: "plain_text", text: "View on GitHub" }, action_id: "a11y_view_github", url: context.githubCommentUrl });
  }
  if (actions.length > 0) {
    blocks.push({ type: "divider" });
    if (total > 0) {
      blocks.push({ type: "context", elements: [
        { type: "mrkdwn", text: ":rocket: Fix all issues at once — a Pull Request will be created with all patches applied and verified" },
      ]});
    }
    blocks.push({ type: "actions", elements: actions });
  }

  return blocks;
}

function appendPatternFindings(blocks: Record<string, unknown>[], patternFindings: PatternAuditSummary, max: number, context: ResultContext): void {
  const shown = patternFindings.findings.slice(0, max);
  shown.forEach((f, i) => {
    const location = f.line ? `${f.file}:${f.line}` : f.file;
    const parts = [
      `${severityTag(f.severity)} ${escapeHtmlTags(f.title)}`,
      `File: \`${location}\` · Rule: \`${f.patternId}\``,
    ];
    if (f.id) {
      const findingFixValue = JSON.stringify({
        id: f.id, o: context.owner, r: context.repo, s: context.headSha ?? "",
        h: context.headRef ?? context.branch ?? "", b: context.baseRef ?? "",
        i: context.installationId ?? 0,
      });
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: parts.join("\n") },
        accessory: { type: "button", text: { type: "plain_text", text: "Fix" }, action_id: `a11y_fix_${f.id}`, value: findingFixValue },
      });
    } else {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: parts.join("\n") } });
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
    { type: "header", text: { type: "plain_text", text: `Auditing ${owner}/${repo}` } },
    { type: "context", elements: [
      { type: "mrkdwn", text: `Branch: \`${branch ?? "default"}\` · Mode: ${mode}` },
    ]},
    { type: "section", text: { type: "mrkdwn", text: "Scanning in progress…" } },
  ];
}

export function formatFixProgressBlocks(owner: string, repo: string, findingIds: string): Record<string, unknown>[] {
  return [
    { type: "header", text: { type: "plain_text", text: `Applying Fix — ${owner}/${repo}` } },
    { type: "context", elements: [
      { type: "mrkdwn", text: `Finding IDs: ${findingIds}` },
    ]},
    { type: "section", text: { type: "mrkdwn", text: "Fix in progress…" } },
  ];
}
