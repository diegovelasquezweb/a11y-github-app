import type { BulkFinding, JiraBulkPayload } from "../jira/types.js";
import type { DomAuditSummary, PatternAuditSummary } from "../types.js";

function severityIcon(severity: string): string {
  const s = severity.trim().toLowerCase();
  if (s === "critical") return ":red_circle:";
  if (s === "serious") return ":large_orange_circle:";
  if (s === "moderate") return ":large_yellow_circle:";
  if (s === "minor") return ":large_blue_circle:";
  return ":white_circle:";
}

function escapeHtmlTags(text: string): string {
  return text.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (_, tag) => `\`<${tag}>\``);
}

function extractPathname(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/index\.html$/, "/").replace(/\.html$/, "").replace(/^\//, "") || "home";
  } catch {
    return "";
  }
}

function buildJiraSingleValue(id: string, severity: string, title: string, owner: string, repo: string): string {
  const MAX = 150;
  const base = { k: "s", i: id, v: severity, o: owner, r: repo };
  const baseJson = JSON.stringify(base);
  const budget = MAX - baseJson.length - 7;
  const t = budget <= 0 ? "" : (title.length <= budget ? title : title.slice(0, budget - 3) + "...");
  const value = JSON.stringify({ ...base, t });
  return value.length <= MAX ? value : baseJson;
}

function buildBulkJiraValue(base: Omit<JiraBulkPayload, "f">, findings: BulkFinding[]): string {
  const MAX = 2000;
  const result: BulkFinding[] = [];
  for (const f of findings) {
    const candidate = JSON.stringify({ ...base, f: [...result, f] });
    if (candidate.length <= MAX) {
      result.push(f);
    } else {
      const withEmpty = JSON.stringify({ ...base, f: [...result, { ...f, t: "" }] });
      const budget = MAX - withEmpty.length;
      if (budget > 3) {
        const truncated = { ...f, t: f.t.slice(0, budget - 3) + "..." };
        if (JSON.stringify({ ...base, f: [...result, truncated] }).length <= MAX) {
          result.push(truncated);
        }
      }
      break;
    }
  }
  return JSON.stringify({ ...base, f: result });
}

export interface ResultContext {
  owner: string;
  repo: string;
  branch?: string;
  headSha?: string;
  headRef?: string;
  baseRef?: string;
  installationId?: number;
  /** When true, Jira buttons use API mode (value JSON payload). When false/absent, use URL mode. */
  jiraApiMode?: boolean;
  /** When true, "Create GitHub Issue" buttons are shown. Hidden by default. */
  githubIssuesEnabled?: boolean;
}

function buildGhBulkBody(summary: DomAuditSummary, context: ResultContext, total: number): string {
  const t = summary.totals;
  const pt = summary.patternFindings?.totals;
  const branch = context.branch ?? "default";
  const header = [
    `## A11y Audit — ${total} findings`,
    ``,
    `| Branch | Critical | Serious | Moderate | Minor |`,
    `|---|---|---|---|---|`,
    `| \`${branch}\` | ${t.Critical + (pt?.Critical ?? 0)} | ${t.Serious + (pt?.Serious ?? 0)} | ${t.Moderate + (pt?.Moderate ?? 0)} | ${t.Minor + (pt?.Minor ?? 0)} |`,
  ].join("\n");

  const findingRows: string[] = [];
  for (const f of (summary.patternFindings?.findings ?? [])) {
    findingRows.push(`| ${f.severity} | ${f.title} | \`${f.file}\` |`);
  }
  for (const f of (summary.findings ?? [])) {
    const pg = f.url ? extractPathname(f.url) : "";
    findingRows.push(`| ${f.severity} | ${f.title} | \`/${pg}\` |`);
  }
  if (findingRows.length === 0) return header;

  const urlPrefix = `https://github.com/${context.owner}/${context.repo}/issues/new?title=${encodeURIComponent(`[A11y] Audit: ${total} findings`)}&body=&labels=${encodeURIComponent("accessibility")}`;
  const findingsPrefix = `\n\n### Top Findings\n\n| Severity | Title | Location |\n|---|---|---|`;
  let body = header + findingsPrefix;
  let added = 0;
  for (const row of findingRows) {
    const candidate = body + "\n" + row;
    if (urlPrefix.length + encodeURIComponent(candidate).length > 2900) break;
    body = candidate;
    added++;
  }
  return added > 0 ? body : header;
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
      domShown.forEach((f) => {
        const pathname = f.url ? extractPathname(f.url) : "";
        const parts = [`${severityIcon(f.severity)} \`${f.id}\` ${escapeHtmlTags(f.title)}`];
        if (pathname) parts.push(`Page: \`${pathname}\``);
        if (f.id) {
          const findingFixValue = JSON.stringify({
            id: f.id, o: context.owner, r: context.repo, s: context.headSha ?? "",
            h: context.headRef ?? context.branch ?? "", b: context.baseRef ?? "",
            i: context.installationId ?? 0,
          });
          const issueTableRows = [
            ...(pathname ? [`| **Page** | \`/${pathname}\` |`] : []),
            ...(f.selector ? [`| **Selector** | \`${f.selector}\` |`] : []),
            `| **Branch** | \`${context.branch ?? "default"}\` |`,
          ];
          const issueBody = `${f.title}\n\n| | |\n|---|---|\n${issueTableRows.join("\n")}`;
          const ghIssueUrl = `https://github.com/${context.owner}/${context.repo}/issues/new?title=${encodeURIComponent(`[A11y] [${f.severity}] ${f.title}`)}&body=${encodeURIComponent(issueBody)}&labels=${encodeURIComponent("accessibility")}`;
          const jiraOption: Record<string, unknown> = context.jiraApiMode
            ? { text: { type: "plain_text", text: "Create Jira Ticket" }, value: buildJiraSingleValue(f.id, f.severity, f.title, context.owner, context.repo) }
            : {
                text: { type: "plain_text", text: "Create Jira Ticket" },
                url: `https://jira.atlassian.net/secure/CreateIssueDetails!init.jspa?summary=${encodeURIComponent(`[${f.severity}] ${f.title}`)}&description=${encodeURIComponent(issueBody)}`,
                value: `jira_${f.id}`,
              };
          const blockBase = `a11y_f_${f.id}|${pathname}|${f.selector ?? ""}|${f.wcag ?? ""}|`;
          const rfBudget = 255 - blockBase.length;
          const blockId = (blockBase + (rfBudget > 0 ? (f.recommendedFix ?? "").slice(0, rfBudget) : "")).slice(0, 255);
          blocks.push({
            type: "section",
            block_id: blockId,
            text: { type: "mrkdwn", text: parts.join("\n") },
            accessory: {
              type: "overflow",
              action_id: `a11y_actions_${f.id}`,
              options: [
                { text: { type: "plain_text", text: "Fix with AI" }, value: findingFixValue },
                ...(context.githubIssuesEnabled ? [{ text: { type: "plain_text", text: "Create GitHub Issue" }, url: ghIssueUrl, value: `gh_issue_${f.id}` }] : []),
                jiraOption,
              ],
            },
          });
        } else {
          blocks.push({ type: "section", text: { type: "mrkdwn", text: parts.join("\n") } });
        }
      });

      if (summary.totalFindings > domShown.length) {
        const overflow = `Showing ${domShown.length} of ${summary.totalFindings} DOM findings.`;
        blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: overflow }] });
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
    const t = summary.totals;
    const pt = summary.patternFindings?.totals;
    const ghBulkUrl = `https://github.com/${context.owner}/${context.repo}/issues/new?title=${encodeURIComponent(`[A11y] Audit: ${total} findings`)}&body=${encodeURIComponent(buildGhBulkBody(summary, context, total))}&labels=${encodeURIComponent("accessibility")}`;
    const allBulkFindings: BulkFinding[] = [];
    if (summary.patternFindings) {
      for (const f of summary.patternFindings.findings) {
        allBulkFindings.push({ v: f.severity, t: f.title });
      }
    }
    if (summary.findings) {
      for (const f of summary.findings) {
        const pg = f.url ? extractPathname(f.url) : "";
        const finding: BulkFinding = { v: f.severity, t: f.title };
        if (pg) finding.pg = pg;
        if (f.selector) finding.sel = f.selector;
        allBulkFindings.push(finding);
      }
    }

    const bulkBase: Omit<JiraBulkPayload, "f"> = {
      kind: "bulk",
      o: context.owner,
      r: context.repo,
      h: context.headRef ?? context.branch ?? "",
      b: context.baseRef ?? "",
      totals: {
        c: t.Critical + (pt?.Critical ?? 0),
        s: t.Serious + (pt?.Serious ?? 0),
        m: t.Moderate + (pt?.Moderate ?? 0),
        mi: t.Minor + (pt?.Minor ?? 0),
      },
      count: total,
    };

    const jiraButton: Record<string, unknown> = context.jiraApiMode
      ? {
          type: "button",
          text: { type: "plain_text", text: "Create Jira Ticket" },
          action_id: "a11y_create_jira_ticket",
          value: buildBulkJiraValue(bulkBase, allBulkFindings),
        }
      : {
          type: "button",
          text: { type: "plain_text", text: "Create Jira Ticket" },
          action_id: "a11y_create_jira_ticket",
          url: `https://jira.atlassian.net/secure/CreateIssueDetails!init.jspa?summary=${encodeURIComponent(`A11y Audit: ${total} findings in ${context.owner}/${context.repo}`)}`,
        };
    actions.push({ type: "button", text: { type: "plain_text", text: "Fix All with AI" }, action_id: "a11y_fix_all", value: fixContext, style: "primary" });
    if (context.githubIssuesEnabled) actions.push({ type: "button", text: { type: "plain_text", text: "Create GitHub Issue" }, action_id: "a11y_create_gh_issue", url: ghBulkUrl });
    actions.push(jiraButton);
  }
  if (actions.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "actions", elements: actions });
  }

  return blocks;
}

function appendPatternFindings(blocks: Record<string, unknown>[], patternFindings: PatternAuditSummary, max: number, context: ResultContext): void {
  const shown = patternFindings.findings.slice(0, max);
  shown.forEach((f) => {
    const location = f.line ? `${f.file}:${f.line}` : f.file;
    const parts = [
      `${severityIcon(f.severity)} \`${f.id}\` ${escapeHtmlTags(f.title)}`,
      `File: \`${location}\``,
    ];
    if (f.id) {
      const findingFixValue = JSON.stringify({
        id: f.id, o: context.owner, r: context.repo, s: context.headSha ?? "",
        h: context.headRef ?? context.branch ?? "", b: context.baseRef ?? "",
        i: context.installationId ?? 0,
      });
      const patIssueBody = `${f.title}\n\n| | |\n|---|---|\n| **File** | \`${location}\` |\n| **Branch** | \`${context.branch ?? "default"}\` |`;
      const ghIssueUrl = `https://github.com/${context.owner}/${context.repo}/issues/new?title=${encodeURIComponent(`[A11y] [${f.severity}] ${f.title}`)}&body=${encodeURIComponent(patIssueBody)}&labels=${encodeURIComponent("accessibility")}`;
      const patJiraOption: Record<string, unknown> = context.jiraApiMode
        ? { text: { type: "plain_text", text: "Create Jira Ticket" }, value: buildJiraSingleValue(f.id, f.severity, f.title, context.owner, context.repo) }
        : {
            text: { type: "plain_text", text: "Create Jira Ticket" },
            url: `https://jira.atlassian.net/secure/CreateIssueDetails!init.jspa?summary=${encodeURIComponent(`[${f.severity}] ${f.title}`)}&description=${encodeURIComponent(patIssueBody)}`,
            value: `jira_${f.id}`,
          };
      const patBlockId = `a11y_p_${f.id}|${f.file}|${f.line ?? ""}`.slice(0, 255);
      blocks.push({
        type: "section",
        block_id: patBlockId,
        text: { type: "mrkdwn", text: parts.join("\n") },
        accessory: {
          type: "overflow",
          action_id: `a11y_actions_${f.id}`,
          options: [
            { text: { type: "plain_text", text: "Fix with AI" }, value: findingFixValue },
            ...(context.githubIssuesEnabled ? [{ text: { type: "plain_text", text: "Create GitHub Issue" }, url: ghIssueUrl, value: `gh_issue_${f.id}` }] : []),
            patJiraOption,
          ],
        },
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
