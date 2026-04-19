import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { CreateIssueInput } from "../../src/jira/types.js";

vi.mock("../../src/jira/client.js", () => ({
  getJiraConfig: vi.fn(),
}));

import { getJiraConfig } from "../../src/jira/client.js";
import { createJiraIssue } from "../../src/jira/create-issue.js";

const mockConfig = {
  baseUrl: "https://example.atlassian.net",
  email: "test@example.com",
  apiToken: "token123",
  authHeader: "Basic dGVzdEBleGFtcGxlLmNvbTp0b2tlbjEyMw==",
};

const mockInput: CreateIssueInput = {
  summary: "[Critical] Missing alt text",
  body: { version: 1, type: "doc", content: [] },
  projectKey: "A11Y",
  issueType: "Bug",
};

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    status,
    json: () => Promise.resolve(body),
  }));
}

beforeEach(() => {
  vi.mocked(getJiraConfig).mockReturnValue(mockConfig);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("createJiraIssue", () => {
  it("returns ok:true with issueKey and issueUrl on 201", async () => {
    mockFetch(201, { key: "A11Y-42" });
    const result = await createJiraIssue(mockInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issueKey).toBe("A11Y-42");
      expect(result.issueUrl).toBe("https://example.atlassian.net/browse/A11Y-42");
    }
  });

  it("returns ok:true on 200 status as well", async () => {
    mockFetch(200, { key: "A11Y-10" });
    const result = await createJiraIssue(mockInput);
    expect(result.ok).toBe(true);
  });

  it("returns unauthorized on 401", async () => {
    mockFetch(401, {});
    const result = await createJiraIssue(mockInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("unauthorized");
  });

  it("returns forbidden on 403", async () => {
    mockFetch(403, {});
    const result = await createJiraIssue(mockInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("forbidden");
  });

  it("returns bad_request on 400", async () => {
    mockFetch(400, {});
    const result = await createJiraIssue(mockInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("bad_request");
  });

  it("returns not_found on 404", async () => {
    mockFetch(404, {});
    const result = await createJiraIssue(mockInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("not_found");
  });

  it("returns server_error on 500", async () => {
    mockFetch(500, {});
    const result = await createJiraIssue(mockInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("server_error");
  });

  it("returns network_error when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const result = await createJiraIssue(mockInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("network_error");
  });

  it("returns missing_config and does NOT call fetch when config is null", async () => {
    vi.mocked(getJiraConfig).mockReturnValue(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await createJiraIssue(mockInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("missing_config");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does NOT include a priority field in the request body", async () => {
    mockFetch(201, { key: "A11Y-1" });
    await createJiraIssue(mockInput);
    const fetchMock = vi.mocked(fetch);
    const callArgs = fetchMock.mock.calls[0];
    const body = JSON.parse(callArgs[1]?.body as string) as { fields: Record<string, unknown> };
    expect(body.fields).not.toHaveProperty("priority");
  });

  it("passes AbortSignal in fetch options", async () => {
    mockFetch(201, { key: "A11Y-99" });
    await createJiraIssue(mockInput);
    const fetchMock = vi.mocked(fetch);
    const callArgs = fetchMock.mock.calls[0];
    expect(callArgs[1]?.signal).toBeDefined();
  });
});
