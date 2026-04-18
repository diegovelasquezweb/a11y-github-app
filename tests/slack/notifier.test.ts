import { describe, expect, it, vi } from "vitest";
import { postScanningMessage, updateWithAuditResults, postFixProgress } from "../../src/slack/notifier.js";
import type { DomAuditSummary, SlackContext } from "../../src/types.js";

function mockClient(overrides: Record<string, unknown> = {}) {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ok: true, ts: "111.222", ...overrides }),
      update: vi.fn().mockResolvedValue({ ok: true, ...overrides }),
    },
  } as unknown as import("@slack/web-api").WebClient;
}

const slackCtx: SlackContext = { channelId: "C123", messageTs: "111.222", threadTs: "111.222" };

const baseSummary: DomAuditSummary = {
  scanToken: "test",
  targetUrl: "http://localhost",
  status: "success",
  totalFindings: 0,
  totals: { Critical: 0, Serious: 0, Moderate: 0, Minor: 0 },
};

describe("postScanningMessage", () => {
  it("posts a message and returns SlackContext", async () => {
    const client = mockClient();
    const result = await postScanningMessage(client, "C123", "acme", "site", "Full Audit", "main");
    expect(result).toEqual({ channelId: "C123", messageTs: "111.222", threadTs: "111.222" });
    expect(client.chat.postMessage).toHaveBeenCalledOnce();
  });

  it("returns null when API fails", async () => {
    const client = mockClient();
    (client.chat.postMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("api error"));
    const result = await postScanningMessage(client, "C123", "acme", "site", "Full Audit");
    expect(result).toBeNull();
  });

  it("passes thread_ts when provided", async () => {
    const client = mockClient();
    await postScanningMessage(client, "C123", "acme", "site", "Full Audit", "main", "999.000");
    const call = (client.chat.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.thread_ts).toBe("999.000");
  });
});

describe("updateWithAuditResults", () => {
  it("calls chat.update with blocks", async () => {
    const client = mockClient();
    await updateWithAuditResults(client, slackCtx, baseSummary, { owner: "acme", repo: "site" });
    expect(client.chat.update).toHaveBeenCalledOnce();
    const call = (client.chat.update as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.channel).toBe("C123");
    expect(call.ts).toBe("111.222");
  });

  it("falls back to postMessage when message_not_found", async () => {
    const client = mockClient();
    const error = new Error("message_not_found");
    (error as unknown as Record<string, unknown>).data = { error: "message_not_found" };
    (client.chat.update as ReturnType<typeof vi.fn>).mockRejectedValue(error);
    await updateWithAuditResults(client, slackCtx, baseSummary, { owner: "acme", repo: "site" });
    expect(client.chat.postMessage).toHaveBeenCalledOnce();
  });

  it("does not throw when API fails", async () => {
    const client = mockClient();
    (client.chat.update as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network"));
    await expect(updateWithAuditResults(client, slackCtx, baseSummary, { owner: "acme", repo: "site" })).resolves.toBeUndefined();
  });
});

describe("postFixProgress", () => {
  it("posts a threaded message", async () => {
    const client = mockClient();
    const result = await postFixProgress(client, slackCtx, "acme", "site", "all");
    expect(result).not.toBeNull();
    const call = (client.chat.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.thread_ts).toBe("111.222");
  });

  it("returns null when API fails", async () => {
    const client = mockClient();
    (client.chat.postMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
    const result = await postFixProgress(client, slackCtx, "acme", "site", "all");
    expect(result).toBeNull();
  });
});
