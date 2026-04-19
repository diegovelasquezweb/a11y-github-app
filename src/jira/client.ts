import { CONFIG } from "../config.js";
import type { JiraConfig } from "./types.js";

export function getJiraConfig(): JiraConfig | null {
  const {
    jiraBaseUrl: baseUrl,
    jiraEmail: email,
    jiraApiToken: apiToken,
    jiraProjectKey: projectKey,
    jiraIssueType: issueType,
  } = CONFIG;
  if (!baseUrl || !email || !apiToken) return null;
  const authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    email,
    apiToken,
    ...(projectKey ? { projectKey } : {}),
    ...(issueType ? { issueType } : {}),
    authHeader,
  };
}
