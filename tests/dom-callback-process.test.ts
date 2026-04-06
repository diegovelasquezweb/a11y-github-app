import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  CONFIG: {
    domAuditCallbackToken: "test-callback-token",
    webhookSecret: "test-secret",
    domAuditEnabled: true,
    appBaseUrl: "http://localhost:3000",
    maxInlineComments: 10,
    scanRunnerOwner: "",
    scanRunnerRepo: "",
    scanRunnerRef: "main",
    scanRunnerWorkflow: "dom-audit.yml",
    scanFixWorkflow: "a11y-fix.yml",
  },
}));

vi.mock("../src/github/auth.js", () => ({
  getRepoOctokit: vi.fn(),
  getInstallationOctokit: vi.fn(),
  createInstallationToken: vi.fn(),
}));

vi.mock("../src/review/dom-reporter.js", () => ({
  completeDomAuditCheck: vi.fn(),
}));

import { processDomAuditCallback } from "../src/webhook/dom-callback.js";
import { getRepoOctokit } from "../src/github/auth.js";
import { completeDomAuditCheck } from "../src/review/dom-reporter.js";
import { CONFIG } from "../src/config.js";

function makeOctokit() {
  return {
    rest: {
      issues: {
        createComment: vi.fn().mockResolvedValue({ data: { id: 42 } }),
        updateComment: vi.fn().mockResolvedValue({ data: { id: 42 } }),
      },
    },
  };
}

function basePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    target_owner: "my-org",
    target_repo: "my-repo",
    check_run_id: 99,
    scan_token: "tok-001",
    target_url: "http://localhost:4173",
    status: "success",
    total_findings: 0,
    totals: { Critical: 0, Serious: 0, Moderate: 0, Minor: 0 },
    ...overrides,
  };
}

describe("processDomAuditCallback", () => {
  let mockOctokit: ReturnType<typeof makeOctokit>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOctokit = makeOctokit();
    vi.mocked(getRepoOctokit).mockResolvedValue(mockOctokit as never);
    vi.mocked(completeDomAuditCheck).mockResolvedValue(undefined);
  });

  it("returns 503 when domAuditCallbackToken is not configured", async () => {
    const original = CONFIG.domAuditCallbackToken;
    (CONFIG as Record<string, unknown>).domAuditCallbackToken = "";

    const result = await processDomAuditCallback({ token: "any", payload: basePayload() });

    expect(result.status).toBe(503);
    expect(result.body.error).toBeTruthy();

    (CONFIG as Record<string, unknown>).domAuditCallbackToken = original;
  });

  it("returns 401 when token is wrong", async () => {
    const result = await processDomAuditCallback({ token: "wrong-token", payload: basePayload() });

    expect(result.status).toBe(401);
  });

  it("returns 400 when missing owner/repo/checkRunId", async () => {
    const result = await processDomAuditCallback({
      token: "test-callback-token",
      payload: { scan_token: "tok", target_url: "http://x" },
    });

    expect(result.status).toBe(400);
  });

  it("returns 200 and calls completeDomAuditCheck when valid payload with no pullNumber", async () => {
    const result = await processDomAuditCallback({
      token: "test-callback-token",
      payload: basePayload(),
    });

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(completeDomAuditCheck).toHaveBeenCalledOnce();
    expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("returns 200, calls completeDomAuditCheck and creates PR comment when pullNumber > 0 and no commentId", async () => {
    const result = await processDomAuditCallback({
      token: "test-callback-token",
      payload: basePayload({ pull_number: 7 }),
    });

    expect(result.status).toBe(200);
    expect(completeDomAuditCheck).toHaveBeenCalledOnce();
    expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledOnce();
  });

  it("updates comment when commentId > 0 and falls back to createComment on 404", async () => {
    const notFoundError = Object.assign(new Error("Not Found"), { status: 404 });
    mockOctokit.rest.issues.updateComment.mockRejectedValueOnce(notFoundError);

    const result = await processDomAuditCallback({
      token: "test-callback-token",
      payload: basePayload({ pull_number: 7, comment_id: 55 }),
    });

    expect(result.status).toBe(200);
    expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledOnce();
    expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledOnce();
  });

  it("updates comment successfully when commentId > 0 and update succeeds", async () => {
    const result = await processDomAuditCallback({
      token: "test-callback-token",
      payload: basePayload({ pull_number: 7, comment_id: 55 }),
    });

    expect(result.status).toBe(200);
    expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledOnce();
    expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("returns 500 when completeDomAuditCheck throws", async () => {
    vi.mocked(completeDomAuditCheck).mockRejectedValueOnce(new Error("Check failed"));

    const result = await processDomAuditCallback({
      token: "test-callback-token",
      payload: basePayload(),
    });

    expect(result.status).toBe(500);
    expect(result.body.error).toBe("Check failed");
  });
});
