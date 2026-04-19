import { getJiraConfig } from "./client.js";
import type { FetchIssueTypesResult, IssueType } from "./types.js";

export async function fetchJiraIssueTypes(projectKey: string): Promise<FetchIssueTypesResult> {
  const config = getJiraConfig();
  if (!config) return { ok: false, errorCode: "missing_config" };

  let response: Response;
  try {
    response = await fetch(
      `${config.baseUrl}/rest/api/3/issuetype/project?projectKey=${encodeURIComponent(projectKey)}`,
      {
        headers: {
          Authorization: config.authHeader,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
  } catch {
    return { ok: false, errorCode: "network_error" };
  }

  if (response.status === 401) return { ok: false, errorCode: "unauthorized" };
  if (response.status === 403) return { ok: false, errorCode: "forbidden" };
  if (response.status === 404) return { ok: false, errorCode: "not_found" };
  if (response.status >= 500) return { ok: false, errorCode: "server_error" };

  const data = (await response.json()) as Array<{ id?: string; name?: string }>;
  const issueTypes: IssueType[] = data.map((t) => ({ id: String(t.id ?? ""), name: String(t.name ?? "") }));
  return { ok: true, issueTypes };
}
