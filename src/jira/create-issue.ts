import { getJiraConfig } from "./client.js";
import type { CreateIssueErrorCode, CreateIssueInput, CreateIssueResult } from "./types.js";

function mapStatus(status: number): CreateIssueErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 400) return "bad_request";
  if (status === 404) return "not_found";
  return "server_error";
}

export async function createJiraIssue(input: CreateIssueInput): Promise<CreateIssueResult> {
  const config = getJiraConfig();
  if (!config) return { ok: false, errorCode: "missing_config" };

  const payload = {
    fields: {
      project: { key: input.projectKey },
      summary: input.summary,
      description: input.body,
      issuetype: { name: input.issueType },
    },
  };

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: {
        Authorization: config.authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    console.warn("[jira] network error during issue create");
    return { ok: false, errorCode: "network_error" };
  }

  if (response.status === 201 || response.status === 200) {
    const data = (await response.json()) as { key?: string };
    const key = String(data.key ?? "");
    if (!key) return { ok: false, errorCode: "server_error" };
    return { ok: true, issueKey: key, issueUrl: `${config.baseUrl}/browse/${key}` };
  }

  console.warn(`[jira] issue create failed status=${response.status}`);
  return { ok: false, errorCode: mapStatus(response.status) };
}
