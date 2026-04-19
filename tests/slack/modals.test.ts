import { describe, expect, it } from "vitest";
import { buildAuditModal, buildFixModal } from "../../src/slack/modals.js";
import type { AuditModalMetadata, FixModalMetadata } from "../../src/slack/types.js";

const auditMeta: AuditModalMetadata = {
  channelId: "C12345678",
  userId: "U12345678",
};

const fixMeta: FixModalMetadata = {
  channelId: "C12345678",
  messageTs: "1234567890.123456",
  userId: "U12345678",
  owner: "acme",
  repo: "site",
  headSha: "abc1234",
  headRef: "feat/new-page",
  baseRef: "main",
  pullNumber: 42,
  installationId: 99,
};

describe("buildAuditModal", () => {
  it("has correct callback_id and blocks", () => {
    const modal = buildAuditModal(auditMeta);
    expect(modal.callback_id).toBe("a11y_audit_modal");
    expect(modal.blocks.length).toBeGreaterThanOrEqual(4);
  });

  it("has a description section", () => {
    const modal = buildAuditModal(auditMeta);
    expect(modal.blocks[0].type).toBe("section");
  });

  it("round-trips private_metadata", () => {
    const modal = buildAuditModal(auditMeta);
    expect(JSON.parse(modal.private_metadata)).toEqual(auditMeta);
  });

  it("has repo, branch, and mode input blocks", () => {
    const modal = buildAuditModal(auditMeta);
    const inputBlockIds = modal.blocks.filter((b: { block_id?: string }) => b.block_id).map((b: { block_id?: string }) => b.block_id);
    expect(inputBlockIds).toEqual(["repo_block", "branch_block", "audit_mode_block"]);
  });

  it("branch block is optional", () => {
    const modal = buildAuditModal(auditMeta);
    const branch = modal.blocks.find((b: { block_id?: string }) => b.block_id === "branch_block");
    expect(branch).toHaveProperty("optional", true);
  });

  it("mode select has 3 options", () => {
    const modal = buildAuditModal(auditMeta);
    const mode = modal.blocks.find((b: { block_id?: string }) => b.block_id === "audit_mode_block")!;
    expect(mode.element!.options).toHaveLength(3);
  });

  it("defaults mode to unified", () => {
    const modal = buildAuditModal(auditMeta);
    const mode = modal.blocks.find((b: { block_id?: string }) => b.block_id === "audit_mode_block")!;
    expect(mode.element!.initial_option!.value).toBe("unified");
  });

  it("preserves threadTs in metadata", () => {
    const modal = buildAuditModal({ ...auditMeta, threadTs: "111.222" });
    expect(JSON.parse(modal.private_metadata).threadTs).toBe("111.222");
  });
});

describe("buildFixModal", () => {
  it("has correct callback_id and blocks", () => {
    const modal = buildFixModal(fixMeta, "all");
    expect(modal.callback_id).toBe("a11y_fix_modal");
    expect(modal.blocks.length).toBeGreaterThanOrEqual(3);
  });

  it("stores findingIds in private_metadata", () => {
    const modal = buildFixModal(fixMeta, "A11Y-001");
    const meta = JSON.parse(modal.private_metadata);
    expect(meta.findingIds).toBe("A11Y-001");
  });

  it("has description section for fix all", () => {
    const modal = buildFixModal(fixMeta, "all");
    const content = JSON.stringify(modal.blocks[0]);
    expect(content).toContain("all findings");
  });

  it("has description section for single finding", () => {
    const modal = buildFixModal(fixMeta, "A11Y-001");
    const content = JSON.stringify(modal.blocks[0]);
    expect(content).toContain("A11Y-001");
  });

  it("title changes based on findingLabel", () => {
    expect(buildFixModal(fixMeta, "all").title.text).toBe("Fix All Findings");
    expect(buildFixModal(fixMeta, "A11Y-001").title.text).toBe("Fix Finding");
  });

  it("no finding_ids input block", () => {
    const modal = buildFixModal(fixMeta, "all");
    const ids = modal.blocks.find((b: { block_id?: string }) => b.block_id === "finding_ids_block");
    expect(ids).toBeUndefined();
  });

  it("model and hint blocks are optional", () => {
    const modal = buildFixModal(fixMeta, "all");
    const model = modal.blocks.find((b: { block_id?: string }) => b.block_id === "ai_model_block")!;
    const hint = modal.blocks.find((b: { block_id?: string }) => b.block_id === "hint_block")!;
    expect(model).toHaveProperty("optional", true);
    expect(hint).toHaveProperty("optional", true);
  });

  it("model select has 3 options", () => {
    const modal = buildFixModal(fixMeta, "all");
    const model = modal.blocks.find((b: { block_id?: string }) => b.block_id === "ai_model_block")!;
    expect(model.element!.options).toHaveLength(3);
  });
});
