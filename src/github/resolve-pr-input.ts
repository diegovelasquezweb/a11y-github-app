import type { Octokit } from "@octokit/rest";

export interface ResolvedPr {
  headSha: string;
  headRef: string;
  baseRef: string;
  pullNumber: number;
}

export async function resolvePr(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<ResolvedPr> {
  const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
  return {
    headSha: data.head.sha,
    headRef: data.head.ref,
    baseRef: data.base.ref,
    pullNumber: data.number,
  };
}
