import type { Octokit } from "@octokit/rest";

export type PrInputParsed =
  | { kind: "branch"; value: string }
  | { kind: "pr"; pullNumber: number }
  | { kind: "error"; reason: "url_repo_mismatch" };

export interface ResolvedPr {
  headSha: string;
  headRef: string;
  baseRef: string;
  pullNumber: number;
}

const BARE_NUMBER_RE = /^#?(\d+)$/;
const PR_URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/;

export function parsePrInput(
  input: string,
  expectedOwner: string,
  expectedRepo: string,
): PrInputParsed {
  const trimmed = input.trim();
  if (!trimmed) {
    return { kind: "branch", value: "" };
  }

  const bare = BARE_NUMBER_RE.exec(trimmed);
  if (bare) {
    return { kind: "pr", pullNumber: Number(bare[1]) };
  }

  const url = PR_URL_RE.exec(trimmed);
  if (url) {
    const [, urlOwner, urlRepo, num] = url;
    if (urlOwner !== expectedOwner || urlRepo !== expectedRepo) {
      return { kind: "error", reason: "url_repo_mismatch" };
    }
    return { kind: "pr", pullNumber: Number(num) };
  }

  return { kind: "branch", value: trimmed };
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
