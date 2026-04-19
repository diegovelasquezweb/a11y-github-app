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
        const parts = [`${severityIcon(f.severity)} \`${f.id}\` ${escapeHtmlTags(f.title)}`];
        if (f.url) {
          try {
            const pathname = new URL(f.url).pathname.replace(/\/index\.html$/, "/").replace(/\.html$/, "").replace(/^\//, "") || "home";
            parts.push(`Page: \`${pathname}\``);
          } catch { /* ignore */ }
        }
        if (f.id) {
          const findingFixValue = JSON.stringify({
            id: f.id, o: context.owner, r: context.repo, s: context.headSha ?? "",
            h: context.headRef ?? context.branch ?? "", b: context.baseRef ?? "",
            i: context.installationId ?? 0,
          });
          let pathname = "";
          if (f.url) { try { pathname = new URL(f.url).pathname.replace(/\/index\.html$/, "/").replace(/\.html$/, "").replace(/^\//, "") || "home"; } catch { /* ignore */ } }
          const issueBody = [
            `**Finding:** \`${f.id}\``,
            `**Severity:** ${f.severity}`,
            `**Title:** ${f.title}`,
            `**Repo:** ${context.owner}/${context.repo}`,
            `**Branch:** ${context.branch ?? "default"}`,
            ...(pathname ? [`**Page:** \`/${pathname}\``] : []),
            ...(f.selector ? [`**Selector:** \`${f.selector}\``] : []),
            ...(f.wcag ? [`**WCAG:** ${f.wcag}`] : []),
          ].join("\n");
          const ghIssueUrl = `https://github.com/${context.owner}/${context.repo}/issues/new?title=${encodeURIComponent(`[A11y] [${f.severity}] ${f.title}`)}&body=${encodeURIComponent(issueBody)}&labels=${encodeURIComponent("accessibility")}`;
          const jiraOption: Record<string, unknown> = context.jiraApiMode
            ? (() => {
                const base = { k: "s", i: f.id, v: f.severity, o: context.owner, r: context.repo };
                const baseJson = JSON.stringify(base);
                const titleBudget = 151 - baseJson.length - 6;
                const t = titleBudget > 3 ? (f.title.length <= titleBudget ? f.title : `${f.title.slice(0, titleBudget - 1)}…`) : "";
                return { text: { type: "plain_text", text: "Create Jira Ticket" }, value: JSON.stringify({ ...base, t }) };
              })()
            : {
                text: { type: "plain_text", text: "Create Jira Ticket" },
                url: `https://jira.atlassian.net/secure/CreateIssueDetails!init.jspa?summary=${encodeURIComponent(`[${f.severity}] ${f.title}`)}&description=${encodeURIComponent(issueBody)}`,
                value: `jira_${f.id}`,
              };
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: parts.join("\n") },
            accessory: {
              type: "overflow",
              action_id: `a11y_actions_${f.id}`,
              options: [
                { text: { type: "plain_text", text: "Fix with AI" }, value: findingFixValue },
                { text: { type: "plain_text", text: "Create GitHub Issue" }, url: ghIssueUrl, value: `gh_issue_${f.id}` },
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
    const t2 = summary.totals;
    const pt2 = summary.patternFindings?.totals;
    const compactBody = [
      `**Repo:** ${context.owner}/${context.repo}`,
      `**Branch:** \`${context.branch ?? "default"}\``,
      `**Total findings:** ${total}`,
      `- Critical: ${t2.Critical + (pt2?.Critical ?? 0)}`,
      `- Serious: ${t2.Serious + (pt2?.Serious ?? 0)}`,
      `- Moderate: ${t2.Moderate + (pt2?.Moderate ?? 0)}`,
      `- Minor: ${t2.Minor + (pt2?.Minor ?? 0)}`,
    ].join("\n");
    const ghBulkUrl = `https://github.com/${context.owner}/${context.repo}/issues/new?title=${encodeURIComponent(`[A11y] Audit: ${total} findings`)}&body=${encodeURIComponent(compactBody)}&labels=${encodeURIComponent("accessibility")}`;
    const t = summary.totals;
    const pt = summary.patternFindings?.totals;
    const jiraButton: Record<string, unknown> = context.jiraApiMode
      ? {
          type: "button",
          text: { type: "plain_text", text: "Create Jira Ticket" },
          action_id: "a11y_create_jira_ticket",
          value: JSON.stringify({
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
          }),
        }
      : {
          type: "button",
          text: { type: "plain_text", text: "Create Jira Ticket" },
          action_id: "a11y_create_jira_ticket",
          url: `https://jira.atlassian.net/secure/CreateIssueDetails!init.jspa?summary=${encodeURIComponent(`A11y Audit: ${total} findings in ${context.owner}/${context.repo}`)}&description=${encodeURIComponent(compactBody)}`,
        };
    actions.push({ type: "button", text: { type: "plain_text", text: "Fix All with AI" }, action_id: "a11y_fix_all", value: fixContext, style: "primary" });
    actions.push({ type: "button", text: { type: "plain_text", text: "Create GitHub Issue" }, action_id: "a11y_create_gh_issue", url: ghBulkUrl });
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
  shown.forEach((f, i) => {
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
      const patIssueBody = [
        `**Finding:** \`${f.id}\``,
        `**Severity:** ${f.severity}`,
        `**Title:** ${f.title}`,
        `**Repo:** ${context.owner}/${context.repo}`,
        `**Branch:** ${context.branch ?? "default"}`,
        `**File:** \`${location}\``,
        `**Rule:** \`${f.patternId}\``,
      ].join("\n");
      const ghIssueUrl = `https://github.com/${context.owner}/${context.repo}/issues/new?title=${encodeURIComponent(`[A11y] [${f.severity}] ${f.title}`)}&body=${encodeURIComponent(patIssueBody)}&labels=${encodeURIComponent("accessibility")}`;
      const patJiraOption: Record<string, unknown> = context.jiraApiMode
        ? (() => {
            const base = { k: "s", i: f.id, v: f.severity, o: context.owner, r: context.repo };
            const baseJson = JSON.stringify(base);
            const titleBudget = 151 - baseJson.length - 6;
            const t = titleBudget > 3 ? (f.title.length <= titleBudget ? f.title : `${f.title.slice(0, titleBudget - 1)}…`) : "";
            return { text: { type: "plain_text", text: "Create Jira Ticket" }, value: JSON.stringify({ ...base, t }) };
          })()
        : {
            text: { type: "plain_text", text: "Create Jira Ticket" },
            url: `https://jira.atlassian.net/secure/CreateIssueDetails!init.jspa?summary=${encodeURIComponent(`[${f.severity}] ${f.title}`)}&description=${encodeURIComponent(patIssueBody)}`,
            value: `jira_${f.id}`,
          };
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: parts.join("\n") },
        accessory: {
          type: "overflow",
          action_id: `a11y_actions_${f.id}`,
          options: [
            { text: { type: "plain_text", text: "Fix with AI" }, value: findingFixValue },
            { text: { type: "plain_text", text: "Create GitHub Issue" }, url: ghIssueUrl, value: `gh_issue_${f.id}` },
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
