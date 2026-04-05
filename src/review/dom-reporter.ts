import type { Octokit } from "@octokit/rest";
import type { DomAuditSummary } from "../types.js";

interface CreateDomAuditCheckInput {
  octokit: Octokit;
  owner: string;
  repo: string;
  headSha: string;
  targetUrl: string;
}

interface CompleteDomAuditCheckInput {
  octokit: Octokit;
  owner: string;
  repo: string;
  checkRunId: number;
  summary: DomAuditSummary;
}

export async function createDomAuditPendingCheck(
  input: CreateDomAuditCheckInput,
): Promise<number> {
  const response = await input.octokit.rest.checks.create({
    owner: input.owner,
    repo: input.repo,
    name: "A11y Audit",
    head_sha: input.headSha,
    status: "in_progress",
    output: {
      title: "DOM audit started",
      summary: `Running DOM accessibility audit for ${input.targetUrl}`,
    },
  });

  return response.data.id;
}

function buildSummaryText(summary: DomAuditSummary): string {
  if (summary.status === "failure") {
    return [
      "DOM audit failed.",
      "",
      summary.error ?? "No error details available.",
    ].join("\n");
  }

  return [
    "DOM audit completed.",
    "",
    `Total findings: ${summary.totalFindings}`,
    `Critical: ${summary.totals.Critical}`,
    `Serious: ${summary.totals.Serious}`,
    `Moderate: ${summary.totals.Moderate}`,
    `Minor: ${summary.totals.Minor}`,
    "",
    `Scan token: ${summary.scanToken}`,
  ].join("\n");
}

export async function completeDomAuditCheck(input: CompleteDomAuditCheckInput): Promise<void> {
  const shouldFail = input.summary.status === "failure";

  await input.octokit.rest.checks.update({
    owner: input.owner,
    repo: input.repo,
    check_run_id: input.checkRunId,
    status: "completed",
    conclusion: shouldFail ? "failure" : "success",
    output: {
      title: shouldFail
        ? "DOM audit failed"
        : input.summary.totalFindings > 0
          ? "DOM accessibility findings reported"
          : "DOM audit passed",
      summary: buildSummaryText(input.summary),
    },
  });
}

export async function createFixPendingCheck(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
  headSha: string;
  findingIds: string;
}): Promise<number> {
  const summary =
    input.findingIds === "all"
      ? "Generating automated fix for **all** findings from the last audit"
      : `Generating automated fix for ${input.findingIds.split(",").map((id) => `\`${id}\``).join(", ")}`;

  const response = await input.octokit.rest.checks.create({
    owner: input.owner,
    repo: input.repo,
    name: "A11y Fix",
    head_sha: input.headSha,
    status: "in_progress",
    output: {
      title: "Fix in progress",
      summary,
    },
  });

  return response.data.id;
}

export async function failDomAuditCheck(
  octokit: Octokit,
  owner: string,
  repo: string,
  checkRunId: number,
  error: string,
): Promise<void> {
  const summary: DomAuditSummary = {
    scanToken: "dispatch-failed",
    targetUrl: "unknown",
    status: "failure",
    totalFindings: 0,
    totals: { Critical: 0, Serious: 0, Moderate: 0, Minor: 0 },
    error,
  };

  await completeDomAuditCheck({
    octokit,
    owner,
    repo,
    checkRunId,
    summary,
  });
}
