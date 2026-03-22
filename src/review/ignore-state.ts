import type { Octokit } from "@octokit/rest";
import type { ReviewAnalysisResult } from "../types.js";
import { parseIgnoreCommand } from "./ignore-command.js";

export async function loadIgnoredFindingIds(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<Set<string>> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pullNumber,
    per_page: 100,
  });

  const ignoredFindingIds = new Set<string>();

  for (const comment of comments) {
    const command = parseIgnoreCommand(comment.body ?? "");
    if (!command.requested || !command.action || !command.findingId) {
      continue;
    }

    if (command.action === "ignore") {
      ignoredFindingIds.add(command.findingId);
      continue;
    }

    ignoredFindingIds.delete(command.findingId);
  }

  return ignoredFindingIds;
}

export function applyIgnoredFindings(
  analysis: ReviewAnalysisResult,
  ignoredFindingIds: Set<string>,
): ReviewAnalysisResult {
  if (ignoredFindingIds.size === 0) {
    return analysis;
  }

  const findings = analysis.findings.filter((item) => !ignoredFindingIds.has(item.finding.id));
  const allowedIds = new Set(findings.map((item) => item.finding.id));
  const comments = analysis.comments.filter((comment) => {
    const marker = /Finding ID: `([^`]+)`/.exec(comment.body);
    return !marker || allowedIds.has(marker[1]);
  });

  return {
    ...analysis,
    findings,
    comments,
  };
}
