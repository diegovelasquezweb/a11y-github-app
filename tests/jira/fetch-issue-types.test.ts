import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/jira/client.js", () => ({
  getJiraConfig: vi.fn(),
}));

import { getJiraConfig } from "../../src/jira/client.js";
import { fetchJiraIssueTypes } from "../../src/jira/fetch-issue-types.js";

const mockConfig = {
  baseUrl: "https://example.atlassian.net",
  email: "test@example.com",
  apiToken: "token123",
  authHeader: "Basic dGVzdEBleGFtcGxlLmNvbTp0b2tlbjEyMw==",
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

describe("fetchJiraIssueTypes", () => {
  it("returns missing_config when config is null", async () => {
    vi.mocked(getJiraConfig).mockReturnValue(null);
    const result = await fetchJiraIssueTypes("PROJ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("missing_config");
  });

  it("does not call fetch when config is null", async () => {
    vi.mocked(getJiraConfig).mockReturnValue(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await fetchJiraIssueTypes("PROJ");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns ok:true with issueTypes on 200", async () => {
    mockFetch(200, [
      { id: "1", name: "Bug" },
      { id: "2", name: "Story" },
    ]);
    const result = await fetchJiraIssueTypes("PROJ");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issueTypes).toHaveLength(2);
      expect(result.issueTypes[0].name).toBe("Bug");
      expect(result.issueTypes[1].name).toBe("Story");
    }
  });

  it("returns ok:true with empty array when response is empty", async () => {
    mockFetch(200, []);
    const result = await fetchJiraIssueTypes("PROJ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.issueTypes).toHaveLength(0);
  });

  it("returns unauthorized on 401", async () => {
    mockFetch(401, {});
    const result = await fetchJiraIssueTypes("PROJ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("unauthorized");
  });

  it("returns forbidden on 403", async () => {
    mockFetch(403, {});
    const result = await fetchJiraIssueTypes("PROJ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("forbidden");
  });

  it("returns not_found on 404", async () => {
    mockFetch(404, {});
    const result = await fetchJiraIssueTypes("PROJ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("not_found");
  });

  it("returns server_error on 500", async () => {
    mockFetch(500, {});
    const result = await fetchJiraIssueTypes("PROJ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("server_error");
  });

  it("returns network_error when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const result = await fetchJiraIssueTypes("PROJ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("network_error");
  });

  it("includes projectKey in the request URL", async () => {
    mockFetch(200, []);
    await fetchJiraIssueTypes("MYPROJECT");
    const fetchMock = vi.mocked(fetch);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("MYPROJECT");
    expect(url).toContain("/rest/api/3/issuetype/project");
  });

  it("passes AbortSignal in fetch options", async () => {
    mockFetch(200, []);
    await fetchJiraIssueTypes("PROJ");
    const fetchMock = vi.mocked(fetch);
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(options.signal).toBeDefined();
  });
});
