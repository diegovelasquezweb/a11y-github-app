import type { Octokit } from "@octokit/rest";
import type { DomAuditSummary } from "../types.js";
import { shouldRequestChanges } from "./severity.js";

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
    name: "A11y DOM Audit",
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
      `DOM audit failed for ${summary.targetUrl}.`,
      "",
      summary.error ?? "No error details available.",
    ].join("\n");
  }

  return [
    `DOM audit completed for ${summary.targetUrl}.`,
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
  const severities = [
    ...Array(input.summary.totals.Critical).fill("Critical"),
    ...Array(input.summary.totals.Serious).fill("Serious"),
  ];

  const shouldFail = input.summary.status === "failure" || shouldRequestChanges(severities);

  await input.octokit.rest.checks.update({
    owner: input.owner,
    repo: input.repo,
    check_run_id: input.checkRunId,
    status: "completed",
    conclusion: shouldFail ? "failure" : "success",
    output: {
      title: shouldFail ? "DOM accessibility findings require changes" : "DOM audit passed",
      summary: buildSummaryText(input.summary),
    },
  });
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
