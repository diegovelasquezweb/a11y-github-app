import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SlackInteractionPayload } from "../../src/slack/types.js";

vi.mock("../../src/config.js", () => ({
  CONFIG: {
    slackSigningSecret: "test-secret",
    slackBotToken: "xoxb-test",
    jiraBaseUrl: "https://example.atlassian.net",
    jiraEmail: "test@example.com",
    jiraApiToken: "token",
    jiraProjectKey: "A11Y",
  },
}));

vi.mock("../../src/jira/client.js", () => ({
  getJiraConfig: vi.fn(),
}));

vi.mock("../../src/jira/create-issue.js", () => ({
  createJiraIssue: vi.fn(),
}));


vi.mock("../../src/slack/verify.js", () => ({
  verifySlackSignature: vi.fn().mockReturnValue(true),
}));

vi.mock("../../src/slack/client.js", () => ({
  getSlackClient: vi.fn(),
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: vi.fn((p: Promise<unknown>) => p),
}));

import { errorCodeToMessage, executeDeferredWork, verifyAndRoute } from "../../src/slack/handler.js";
import { createJiraIssue } from "../../src/jira/create-issue.js";
import { getSlackClient } from "../../src/slack/client.js";

const mockViewsOpen = vi.fn().mockResolvedValue({ ok: true });
const mockViewsUpdate = vi.fn().mockResolvedValue({ ok: true });
const mockChatPostEphemeral = vi.fn().mockResolvedValue({ ok: true });

function makeSingleValue(overrides?: Partial<{ id: string; title: string; severity: string }>) {
  return JSON.stringify({
    k: "s",
    i: overrides?.id ?? "A11Y-001",
    t: overrides?.title ?? "Missing alt text",
    v: overrides?.severity ?? "Critical",
    o: "acme",
    r: "site",
  });
}

function makeBulkValue() {
  return JSON.stringify({
    kind: "bulk",
    o: "acme",
    r: "site",
    h: "feat/fix",
    b: "main",
    totals: { c: 1, s: 2, m: 3, mi: 4 },
    count: 10,
  });
}

function makeBlockActionPayload(value: string, actionId = "a11y_actions_A11Y-001"): string {
  const payload = {
    type: "block_actions",
    trigger_id: "trig123",
    user: { id: "U123", username: "testuser" },
    channel: { id: "C123" },
    response_url: "https://hooks.slack.com/resp/xxx",
    actions: [{ action_id: actionId, block_id: "blk", value }],
  };
  return `payload=${encodeURIComponent(JSON.stringify(payload))}`;
}

function makeViewSubmissionPayload(callbackId: string, stateValues: Record<string, unknown>, privateMetadata = "{}"): string {
  const payload = {
    type: "view_submission",
    trigger_id: "trig123",
    user: { id: "U123", username: "testuser" },
    view: {
      id: "V123",
      callback_id: callbackId,
      private_metadata: privateMetadata,
      state: { values: stateValues },
    },
  };
  return `payload=${encodeURIComponent(JSON.stringify(payload))}`;
}

beforeEach(() => {
  vi.mocked(getSlackClient).mockReturnValue({
    views: { open: mockViewsOpen, update: mockViewsUpdate },
    chat: { postEphemeral: mockChatPostEphemeral },
  } as any);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("errorCodeToMessage", () => {
  it("maps missing_config", () => {
    expect(errorCodeToMessage("missing_config")).toContain("not configured");
  });
  it("maps unauthorized", () => {
    expect(errorCodeToMessage("unauthorized")).toContain("credentials");
  });
  it("maps forbidden", () => {
    expect(errorCodeToMessage("forbidden")).toContain("authorized");
  });
  it("maps bad_request", () => {
    expect(errorCodeToMessage("bad_request")).toContain("rejected");
  });
  it("maps not_found", () => {
    expect(errorCodeToMessage("not_found")).toContain("not found");
  });
  it("maps server_error", () => {
    expect(errorCodeToMessage("server_error")).toContain("server error");
  });
  it("maps network_error", () => {
    expect(errorCodeToMessage("network_error")).toContain("reach Jira");
  });
});

describe("Jira button click → opens project key modal", () => {
  it("opens modal with a11y_jira_project_modal callback_id for single payload", async () => {
    const result = await verifyAndRoute({
      rawBody: makeBlockActionPayload(makeSingleValue()),
      timestamp: "12345",
      signature: "v0=fake",
    });

    expect(result.status).toBe(200);
    expect(result.body).toBe("");
    expect(mockViewsOpen).toHaveBeenCalledOnce();
    const callArg = mockViewsOpen.mock.calls[0][0] as { view: { callback_id: string } };
    expect(callArg.view.callback_id).toBe("a11y_jira_project_modal");
  });

  it("opens modal for bulk payload", async () => {
    const result = await verifyAndRoute({
      rawBody: makeBlockActionPayload(makeBulkValue()),
      timestamp: "12345",
      signature: "v0=fake",
    });

    expect(result.status).toBe(200);
    expect(mockViewsOpen).toHaveBeenCalledOnce();
    const callArg = mockViewsOpen.mock.calls[0][0] as { view: { callback_id: string } };
    expect(callArg.view.callback_id).toBe("a11y_jira_project_modal");
  });
});

describe("Jira project key modal submission", () => {
  it("returns errors when project key is empty", async () => {
    const result = await verifyAndRoute({
      rawBody: makeViewSubmissionPayload(
        "a11y_jira_project_modal",
        { project_key_block: { project_key: { type: "plain_text_input", value: "" } } },
        JSON.stringify({ payload: makeSingleValue(), channelId: "C1", userId: "U1" }),
      ),
      timestamp: "12345",
      signature: "v0=fake",
    });

    expect(result.status).toBe(200);
    const body = result.body as { response_action: string; errors?: Record<string, string> };
    expect(body.response_action).toBe("errors");
    expect(body.errors?.project_key_block).toBeTruthy();
  });

  it("returns clear and triggers ticket creation when project key is valid", async () => {
    vi.mocked(createJiraIssue).mockResolvedValue({ ok: true, issueKey: "PROJ-1", issueUrl: "https://example.atlassian.net/browse/PROJ-1" });

    const result = await verifyAndRoute({
      rawBody: makeViewSubmissionPayload(
        "a11y_jira_project_modal",
        { project_key_block: { project_key: { type: "plain_text_input", value: "PROJ" } } },
        JSON.stringify({ payload: makeSingleValue(), channelId: "C1", userId: "U1" }),
      ),
      timestamp: "12345",
      signature: "v0=fake",
    });

    expect(result.status).toBe(200);
    const body = result.body as { response_action: string };
    expect(body.response_action).toBe("clear");
  });
});

describe("executeDeferredWork block_actions", () => {
  it("handles block_actions deferred work without throwing", async () => {
    const interaction: SlackInteractionPayload = {
      type: "block_actions",
      trigger_id: "t",
      user: { id: "U1", username: "u" },
      actions: [{ action_id: "a11y_open_audit", block_id: "b" }],
    };
    await expect(executeDeferredWork({ type: "block_actions", interaction })).resolves.toBeUndefined();
  });
});
