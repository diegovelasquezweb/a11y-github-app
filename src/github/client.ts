import type { Octokit } from "@octokit/rest";
import type { ChangedFile } from "../types.js";

export async function listPullRequestFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<ChangedFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  return files.map((file) => ({
    filename: file.filename,
    status: file.status,
    patch: file.patch ?? undefined,
  }));
}

export async function getFileContentAtRef(
  octokit: Octokit,
  owner: string,
  repo: string,
  filePath: string,
  ref: string,
): Promise<string | null> {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref,
    });

    if (Array.isArray(response.data)) {
      return null;
    }

    if (response.data.type !== "file" || !response.data.content) {
      return null;
    }

    const encoded = response.data.content.replace(/\n/g, "");
    return Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return null;
  }
}
