import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/config.js", () => ({
  CONFIG: {
    webhookSecret: "test-secret",
    domAuditEnabled: true,
    appBaseUrl: "http://localhost:3000",
    domAuditCallbackToken: "test-token",
    sourcePatternsEnabled: true,
    scanRunnerOwner: "",
    scanRunnerRepo: "",
    scanRunnerRef: "main",
    scanRunnerWorkflow: "dom-audit.yml",
    scanSourceWorkflow: "source-audit.yml",
    scanFixWorkflow: "a11y-fix.yml",
    fixAiModel: "claude-haiku-4-5-20251001",
  },
}));

vi.mock("../src/webhook/verify-signature.js", () => ({
  verifyWebhookSignature: vi.fn().mockReturnValue(true),
}));

vi.mock("../src/github/auth.js", () => ({
  getInstallationOctokit: vi.fn(),
  getRepoOctokit: vi.fn(),
  createInstallationToken: vi.fn(),
}));

vi.mock("../src/review/audit-command.js", () => ({
  parseAuditCommand: vi.fn().mockReturnValue(null),
}));

vi.mock("../src/review/fix-command.js", () => ({
  parseFixCommand: vi.fn().mockReturnValue({ requested: false, findingIds: [] }),
}));

vi.mock("../src/review/dom-reporter.js", () => ({
  createDomAuditPendingCheck: vi.fn().mockResolvedValue(10),
  createFixPendingCheck: vi.fn().mockResolvedValue(20),
  failDomAuditCheck: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/review/dom-workflow.js", () => ({
  createScanToken: vi.fn().mockReturnValue("scan-token-001"),
  dispatchDomAuditWorkflow: vi.fn().mockResolvedValue(undefined),
  dispatchSourceAuditWorkflow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/review/fix-workflow.js", () => ({
  dispatchFixWorkflow: vi.fn().mockResolvedValue(undefined),
}));

import { processWebhook } from "../src/webhook/process.js";
import { verifyWebhookSignature } from "../src/webhook/verify-signature.js";
import { getInstallationOctokit, getRepoOctokit, createInstallationToken } from "../src/github/auth.js";
import { parseAuditCommand } from "../src/review/audit-command.js";
import { parseFixCommand } from "../src/review/fix-command.js";
import { dispatchDomAuditWorkflow, dispatchSourceAuditWorkflow } from "../src/review/dom-workflow.js";
import { dispatchFixWorkflow } from "../src/review/fix-workflow.js";

function makeRawBody(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload));
}

function makeInstallationOctokit() {
  return {
    rest: {
      issues: {
        createComment: vi.fn().mockResolvedValue({ data: { id: 99 } }),
      },
      pulls: {
        get: vi.fn().mockResolvedValue({
          data: {
            head: { sha: "abc123", ref: "feature/foo" },
            base: { ref: "main" },
          },
        }),
      },
    },
  };
}

let mockInstallationOctokit: ReturnType<typeof makeInstallationOctokit>;
let deliveryCounter = 0;

function nextDelivery(): string {
  return `delivery-${++deliveryCounter}`;
}

describe("processWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInstallationOctokit = makeInstallationOctokit();
    vi.mocked(getInstallationOctokit).mockReturnValue(mockInstallationOctokit as never);
    vi.mocked(getRepoOctokit).mockResolvedValue(mockInstallationOctokit as never);
    vi.mocked(createInstallationToken).mockResolvedValue("install-token-xyz" as never);
    vi.mocked(verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(parseAuditCommand).mockReturnValue(null);
    vi.mocked(parseFixCommand).mockReturnValue({ requested: false, findingIds: [] });
  });

  describe("signature validation", () => {
    it("returns 401 when verifyWebhookSignature returns false", async () => {
      vi.mocked(verifyWebhookSignature).mockReturnValue(false);

      const result = await processWebhook({
        rawBody: makeRawBody({}),
        event: "pull_request",
        delivery: nextDelivery(),
      });

      expect(result.status).toBe(401);
    });
  });

  describe("pull_request events", () => {
    it("returns 200 with ignored when action is closed", async () => {
      const payload = {
        action: "closed",
        installation: { id: 1 },
        repository: { name: "repo", owner: { login: "org" } },
        pull_request: { number: 1, head: { sha: "sha1" } },
      };

      const result = await processWebhook({
        rawBody: makeRawBody(payload),
        event: "pull_request",
        delivery: nextDelivery(),
      });

      expect(result.status).toBe(200);
      expect(result.body.ignored).toBeTruthy();
    });

    it("returns 400 when missing owner/repo/pullNumber/headSha", async () => {
      const payload = { action: "opened", installation: { id: 1 } };

      const result = await processWebhook({
        rawBody: makeRawBody(payload),
        event: "pull_request",
        delivery: nextDelivery(),
      });

      expect(result.status).toBe(400);
    });

    it("returns 200 with reviewed: true for opened action and posts welcome comment", async () => {
      const payload = {
        action: "opened",
        installation: { id: 1 },
        repository: { name: "repo", owner: { login: "org" } },
        pull_request: { number: 42, head: { sha: "sha-unique-1" } },
      };

      const result = await processWebhook({
        rawBody: makeRawBody(payload),
        event: "pull_request",
        delivery: nextDelivery(),
      });

      expect(result.status).toBe(200);
      expect(result.body.reviewed).toBe(true);
      expect(mockInstallationOctokit.rest.issues.createComment).toHaveBeenCalledOnce();
    });

    it("returns 200 with deduplicated: true when same headSha processed twice", async () => {
      const payload = {
        action: "synchronize",
        installation: { id: 1 },
        repository: { name: "repo", owner: { login: "org" } },
        pull_request: { number: 50, head: { sha: "sha-dup-test" } },
      };

      await processWebhook({
        rawBody: makeRawBody(payload),
        event: "pull_request",
        delivery: nextDelivery(),
      });

      const result = await processWebhook({
        rawBody: makeRawBody(payload),
        event: "pull_request",
        delivery: nextDelivery(),
      });

      expect(result.status).toBe(200);
      expect(result.body.deduplicated).toBe(true);
    });

    it("posts welcome comment only on opened/reopened, not synchronize", async () => {
      const payload = {
        action: "synchronize",
        installation: { id: 1 },
        repository: { name: "repo", owner: { login: "org" } },
        pull_request: { number: 55, head: { sha: "sha-sync-unique" } },
      };

      await processWebhook({
        rawBody: makeRawBody(payload),
        event: "pull_request",
        delivery: nextDelivery(),
      });

      expect(mockInstallationOctokit.rest.issues.createComment).not.toHaveBeenCalled();
    });
  });

  describe("issue_comment events — audit commands", () => {
    const baseIssueCommentPayload = {
      action: "created",
      installation: { id: 1 },
      repository: { name: "repo", owner: { login: "org" } },
      issue: {
        number: 10,
        pull_request: { url: "https://api.github.com/repos/org/repo/pulls/10" },
      },
      comment: {
        body: "/a11y-audit",
        author_association: "OWNER",
        user: { login: "dev-user" },
      },
    };

    it("returns 200 with ignored when comment is outside a PR", async () => {
      const payload = {
        ...baseIssueCommentPayload,
        issue: { number: 10 },
      };

      const result = await processWebhook({
        rawBody: makeRawBody(payload),
        event: "issue_comment",
        delivery: nextDelivery(),
      });

      expect(result.status).toBe(200);
      expect(result.body.ignored).toBeTruthy();
    });

    it("returns 200 with ignored when author association is NONE", async () => {
      const payload = {
        ...baseIssueCommentPayload,
        comment: { ...baseIssueCommentPayload.comment, author_association: "NONE" },
      };

      const result = await processWebhook({
        rawBody: makeRawBody(payload),
        event: "issue_comment",
        delivery: nextDelivery(),
      });

      expect(result.status).toBe(200);
      expect(result.body.ignored).toBeTruthy();
    });

    it("returns 200 with ignored when parseAuditCommand returns null and parseFixCommand not requested", async () => {
      vi.mocked(parseAuditCommand).mockReturnValue(null);
      vi.mocked(parseFixCommand).mockReturnValue({ requested: false, findingIds: [] });

      const payload = {
        ...baseIssueCommentPayload,
        comment: { ...baseIssueCommentPayload.comment, body: "looks good" },
      };

      const result = await processWebhook({
        rawBody: makeRawBody(payload),
        event: "issue_comment",
        delivery: nextDelivery(),
      });

      expect(result.status).toBe(200);
      expect(result.body.ignored).toBeTruthy();
    });

    it("returns 200 with domAuditScheduled: true for unified auditMode", async () => {
      vi.mocked(parseAuditCommand).mockReturnValue({ auditMode: "unified" });
      vi.mocked(parseFixCommand).mockReturnValue({ requested: false, findingIds: [] });

      const result = await processWebhook({
        rawBody: makeRawBody(baseIssueCommentPayload),
        event: "issue_comment",
        delivery: nextDelivery(),
      });

      expect(result.status).toBe(200);
      expect(result.body.domAuditScheduled).toBe(true);
      expect(dispatchDomAuditWorkflow).toHaveBeenCalledOnce();
    });

    it("returns 200 with domAuditScheduled: true for source auditMode and calls dispatchSourceAuditWorkflow", async () => {
      vi.mocked(parseAuditCommand).mockReturnValue({ auditMode: "source" });
      vi.mocked(parseFixCommand).mockReturnValue({ requested: false, findingIds: [] });

      const result = await processWebhook({
        rawBody: makeRawBody(baseIssueCommentPayload),
        event: "issue_comment",
        delivery: nextDelivery(),
      });

      expect(result.status).toBe(200);
      expect(result.body.domAuditScheduled).toBe(true);
      expect(dispatchSourceAuditWorkflow).toHaveBeenCalledOnce();
      expect(dispatchDomAuditWorkflow).not.toHaveBeenCalled();
    });

    it("returns 200 with fixScheduled: true when fix command requested", async () => {
      vi.mocked(parseAuditCommand).mockReturnValue(null);
      vi.mocked(parseFixCommand).mockReturnValue({ requested: true, findingIds: ["A11Y-001"] });

      const result = await processWebhook({
        rawBody: makeRawBody(baseIssueCommentPayload),
        event: "issue_comment",
        delivery: nextDelivery(),
      });

      expect(result.status).toBe(200);
      expect(result.body.fixScheduled).toBe(true);
      expect(dispatchFixWorkflow).toHaveBeenCalledOnce();
    });
  });

  describe("unsupported events", () => {
    it("returns 200 with ignored for unknown event type", async () => {
      const result = await processWebhook({
        rawBody: makeRawBody({ action: "created" }),
        event: "push",
        delivery: nextDelivery(),
      });

      expect(result.status).toBe(200);
      expect(result.body.ignored).toBeTruthy();
    });
  });
});
