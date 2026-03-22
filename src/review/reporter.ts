import type { Octokit } from "@octokit/rest";
import type { ReviewAnalysisResult } from "../types.js";
import { normalizeSeverity, shouldRequestChanges } from "./severity.js";

interface ReportInput {
  octokit: Octokit;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  analysis: ReviewAnalysisResult;
}

function buildSeveritySummary(analysis: ReviewAnalysisResult): Record<string, number> {
  const summary: Record<string, number> = {
    Critical: 0,
    Serious: 0,
    Moderate: 0,
    Minor: 0,
  };

  for (const item of analysis.findings) {
    const severity = normalizeSeverity(item.finding.severity);
    summary[severity] = (summary[severity] ?? 0) + 1;
  }

  return summary;
}

function buildCheckSummary(analysis: ReviewAnalysisResult): string {
  if (analysis.findings.length === 0) {
    return [
      "No accessibility code-pattern findings were detected in changed files.",
      "",
      `Scanned files: ${analysis.scannedFiles}`,
      `Ignored files: ${analysis.ignoredFiles}`,
    ].join("\n");
  }

  const severity = buildSeveritySummary(analysis);
  const inline = analysis.comments.length;
  const overflow = Math.max(analysis.findings.length - inline, 0);

  return [
    `Detected ${analysis.findings.length} accessibility finding(s) in changed files.`,
    "",
    `Critical: ${severity.Critical}`,
    `Serious: ${severity.Serious}`,
    `Moderate: ${severity.Moderate}`,
    `Minor: ${severity.Minor}`,
    "",
    `Inline comments posted: ${inline}`,
    overflow > 0 ? `Additional findings in summary only: ${overflow}` : "",
    "",
    "Source: @diegovelasquezweb/a11y-engine intelligence layer",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildReviewBody(analysis: ReviewAnalysisResult): string {
  if (analysis.findings.length === 0) {
    return "No accessibility issues were detected in changed files by the a11y-engine source-pattern scan.";
  }

  const severity = buildSeveritySummary(analysis);
  const exampleFindingId = analysis.findings[0]?.finding.id;
  return [
    `A11y review found ${analysis.findings.length} issue(s) in this PR.`,
    `Critical: ${severity.Critical} | Serious: ${severity.Serious} | Moderate: ${severity.Moderate} | Minor: ${severity.Minor}`,
    "",
    exampleFindingId ? `Ignore one finding with: \`/a11y-ignore ${exampleFindingId}\`` : "",
    "",
    "This review is generated from the a11y-engine intelligence layer.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function reportPullRequestReview(input: ReportInput): Promise<void> {
  const severities = input.analysis.findings.map((item) => item.finding.severity);
  const hasBlockingFindings = shouldRequestChanges(severities);
  const conclusion = hasBlockingFindings ? "failure" : "success";

  await input.octokit.rest.checks.create({
    owner: input.owner,
    repo: input.repo,
    name: "A11y PR Review",
    head_sha: input.headSha,
    status: "completed",
    conclusion,
    output: {
      title: hasBlockingFindings
        ? "Accessibility findings require changes"
        : "Accessibility review passed",
      summary: buildCheckSummary(input.analysis),
    },
  });

  const comments = input.analysis.comments.map((comment) => ({
    path: comment.path,
    line: comment.line,
    side: "RIGHT" as const,
    body: comment.body,
  }));

  await input.octokit.rest.pulls.createReview({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
    commit_id: input.headSha,
    event: hasBlockingFindings ? "REQUEST_CHANGES" : "COMMENT",
    body: buildReviewBody(input.analysis),
    comments: comments.length > 0 ? comments : undefined,
  });
}
