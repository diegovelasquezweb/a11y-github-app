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
  it("has correct callback_id and 3 blocks", () => {
    const modal = buildAuditModal(auditMeta);
    expect(modal.callback_id).toBe("a11y_audit_modal");
    expect(modal.blocks).toHaveLength(3);
  });

  it("round-trips private_metadata", () => {
    const modal = buildAuditModal(auditMeta);
    expect(JSON.parse(modal.private_metadata)).toEqual(auditMeta);
  });

  it("has repo, branch, and mode blocks", () => {
    const modal = buildAuditModal(auditMeta);
    const blockIds = modal.blocks.map((b: { block_id: string }) => b.block_id);
    expect(blockIds).toEqual(["repo_block", "branch_block", "audit_mode_block"]);
  });

  it("branch block is optional", () => {
    const modal = buildAuditModal(auditMeta);
    const branch = modal.blocks.find((b: { block_id: string }) => b.block_id === "branch_block");
    expect(branch).toHaveProperty("optional", true);
  });

  it("mode select has 3 options", () => {
    const modal = buildAuditModal(auditMeta);
    const mode = modal.blocks.find((b: { block_id: string }) => b.block_id === "audit_mode_block");
    expect(mode.element.options).toHaveLength(3);
  });

  it("defaults mode to unified", () => {
    const modal = buildAuditModal(auditMeta);
    const mode = modal.blocks.find((b: { block_id: string }) => b.block_id === "audit_mode_block");
    expect(mode.element.initial_option.value).toBe("unified");
  });

  it("preserves threadTs in metadata", () => {
    const modal = buildAuditModal({ ...auditMeta, threadTs: "111.222" });
    expect(JSON.parse(modal.private_metadata).threadTs).toBe("111.222");
  });
});

describe("buildFixModal", () => {
  it("has correct callback_id and 3 blocks", () => {
    const modal = buildFixModal(fixMeta);
    expect(modal.callback_id).toBe("a11y_fix_modal");
    expect(modal.blocks).toHaveLength(3);
  });

  it("round-trips private_metadata", () => {
    const modal = buildFixModal(fixMeta);
    expect(JSON.parse(modal.private_metadata)).toEqual(fixMeta);
  });

  it("pre-fills finding_ids with provided value", () => {
    const modal = buildFixModal(fixMeta, "A11Y-001");
    const ids = modal.blocks.find((b: { block_id: string }) => b.block_id === "finding_ids_block");
    expect(ids.element.initial_value).toBe("A11Y-001");
  });

  it("defaults finding_ids to 'all'", () => {
    const modal = buildFixModal(fixMeta);
    const ids = modal.blocks.find((b: { block_id: string }) => b.block_id === "finding_ids_block");
    expect(ids.element.initial_value).toBe("all");
  });

  it("model and hint blocks are optional", () => {
    const modal = buildFixModal(fixMeta);
    const model = modal.blocks.find((b: { block_id: string }) => b.block_id === "ai_model_block");
    const hint = modal.blocks.find((b: { block_id: string }) => b.block_id === "hint_block");
    expect(model).toHaveProperty("optional", true);
    expect(hint).toHaveProperty("optional", true);
  });

  it("model select has 3 options", () => {
    const modal = buildFixModal(fixMeta);
    const model = modal.blocks.find((b: { block_id: string }) => b.block_id === "ai_model_block");
    expect(model.element.options).toHaveLength(3);
  });
});
