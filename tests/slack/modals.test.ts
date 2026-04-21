import { describe, expect, it } from "vitest";
import { buildAuditModal, buildFixModal, buildJiraProjectKeyModal, buildJiraLoadingModal, buildJiraIssueTypeModal, buildJiraErrorModal } from "../../src/slack/modals.js";
import type { AuditModalMetadata, FixModalMetadata, JiraModalMetadata } from "../../src/slack/types.js";
import type { IssueType } from "../../src/jira/types.js";

const jiraMeta: JiraModalMetadata = {
  payload: JSON.stringify({ kind: "single", id: "A11Y-001" }),
  channelId: "C123",
  userId: "U123",
};

const jiraIssueTypes: IssueType[] = [
  { id: "1", name: "Bug" },
  { id: "2", name: "Story" },
];

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
    const modal = buildFixModal(fixMeta, "all", "");
    expect(modal.callback_id).toBe("a11y_fix_modal");
    expect(modal.blocks.length).toBeGreaterThanOrEqual(3);
  });

  it("stores findingIds in private_metadata", () => {
    const modal = buildFixModal(fixMeta, "A11Y-001", "");
    const meta = JSON.parse(modal.private_metadata);
    expect(meta.findingIds).toBe("A11Y-001");
  });

  it("has description section for fix all", () => {
    const modal = buildFixModal(fixMeta, "all", "");
    const content = JSON.stringify(modal.blocks[0]);
    expect(content).toContain("all findings");
  });

  it("has description section for single finding", () => {
    const modal = buildFixModal(fixMeta, "A11Y-001", "");
    const content = JSON.stringify(modal.blocks[0]);
    expect(content).toContain("A11Y-001");
  });

  it("title changes based on findingLabel", () => {
    expect(buildFixModal(fixMeta, "all", "").title.text).toBe("Fix All Findings");
    expect(buildFixModal(fixMeta, "A11Y-001", "").title.text).toBe("Fix Finding");
  });

  it("no finding_ids input block", () => {
    const modal = buildFixModal(fixMeta, "all", "");
    const ids = modal.blocks.find((b: { block_id?: string }) => b.block_id === "finding_ids_block");
    expect(ids).toBeUndefined();
  });

  it("model and hint blocks are optional", () => {
    const modal = buildFixModal(fixMeta, "all", "");
    const model = modal.blocks.find((b: { block_id?: string }) => b.block_id === "ai_model_block")!;
    const hint = modal.blocks.find((b: { block_id?: string }) => b.block_id === "hint_block")!;
    expect(model).toHaveProperty("optional", true);
    expect(hint).toHaveProperty("optional", true);
  });

  it("model select has 3 options", () => {
    const modal = buildFixModal(fixMeta, "all", "");
    const model = modal.blocks.find((b: { block_id?: string }) => b.block_id === "ai_model_block")!;
    expect(model.element!.options).toHaveLength(3);
  });
});

describe("buildJiraProjectKeyModal", () => {
  it("has correct callback_id and title", () => {
    const modal = buildJiraProjectKeyModal(jiraMeta);
    expect(modal.callback_id).toBe("a11y_jira_project_modal");
    expect(modal.title.text).toBe("Create Jira Ticket");
  });

  it("has submit Create Ticket and close Cancel", () => {
    const modal = buildJiraProjectKeyModal(jiraMeta);
    expect(modal.submit?.text).toBe("Create Ticket");
    expect(modal.close?.text).toBe("Cancel");
  });

  it("has project_key_block input", () => {
    const modal = buildJiraProjectKeyModal(jiraMeta);
    const block = modal.blocks.find((b: { block_id?: string }) => b.block_id === "project_key_block");
    expect(block).toBeDefined();
  });

  it("sets initial_value when initialKey is provided", () => {
    const modal = buildJiraProjectKeyModal(jiraMeta, "PROJ");
    const block = modal.blocks.find((b: { block_id?: string }) => b.block_id === "project_key_block") as {
      element?: { initial_value?: string };
    };
    expect(block?.element?.initial_value).toBe("PROJ");
  });

  it("omits initial_value when initialKey is not provided", () => {
    const modal = buildJiraProjectKeyModal(jiraMeta);
    const block = modal.blocks.find((b: { block_id?: string }) => b.block_id === "project_key_block") as {
      element?: { initial_value?: string };
    };
    expect(block?.element?.initial_value).toBeUndefined();
  });

  it("serializes metadata in private_metadata", () => {
    const modal = buildJiraProjectKeyModal(jiraMeta);
    const parsed = JSON.parse(modal.private_metadata) as JiraModalMetadata;
    expect(parsed.channelId).toBe("C123");
    expect(parsed.userId).toBe("U123");
  });
});

describe("buildJiraLoadingModal", () => {
  it("has correct callback_id and title", () => {
    const modal = buildJiraLoadingModal("PROJ");
    expect(modal.callback_id).toBe("a11y_jira_loading_modal");
    expect(modal.title.text).toBe("Create Jira Ticket");
  });

  it("has no submit button", () => {
    const modal = buildJiraLoadingModal("PROJ") as { submit?: unknown };
    expect(modal.submit).toBeUndefined();
  });

  it("includes project key in loading text", () => {
    const modal = buildJiraLoadingModal("MYPROJ");
    const section = modal.blocks[0] as { text?: { text: string } };
    expect(section.text?.text).toContain("MYPROJ");
  });
});

describe("buildJiraIssueTypeModal", () => {
  it("has correct callback_id and title", () => {
    const modal = buildJiraIssueTypeModal(jiraMeta, jiraIssueTypes, "PROJ");
    expect(modal.callback_id).toBe("a11y_jira_issuetype_modal");
    expect(modal.title.text).toBe("Create Jira Ticket");
  });

  it("has submit Create Ticket", () => {
    const modal = buildJiraIssueTypeModal(jiraMeta, jiraIssueTypes, "PROJ");
    expect(modal.submit?.text).toBe("Create Ticket");
  });

  it("includes project key in section text", () => {
    const modal = buildJiraIssueTypeModal(jiraMeta, jiraIssueTypes, "PROJ");
    const section = modal.blocks[0] as { text?: { text: string } };
    expect(section.text?.text).toContain("PROJ");
  });

  it("has back button with action_id a11y_jira_back_to_project", () => {
    const modal = buildJiraIssueTypeModal(jiraMeta, jiraIssueTypes, "PROJ");
    const actions = modal.blocks[1] as { elements?: Array<{ action_id: string }> };
    expect(actions.elements?.[0].action_id).toBe("a11y_jira_back_to_project");
  });

  it("has issuetype_block with correct options mapped from issue types", () => {
    const modal = buildJiraIssueTypeModal(jiraMeta, jiraIssueTypes, "PROJ");
    const input = modal.blocks[2] as {
      block_id?: string;
      element?: { type: string; action_id: string; options: Array<{ value: string }> };
    };
    expect(input.block_id).toBe("issuetype_block");
    expect(input.element?.type).toBe("static_select");
    expect(input.element?.action_id).toBe("issuetype");
    expect(input.element?.options).toHaveLength(2);
    expect(input.element?.options[0].value).toBe("Bug");
  });

  it("includes projectKey in private_metadata", () => {
    const modal = buildJiraIssueTypeModal(jiraMeta, jiraIssueTypes, "PROJ");
    const parsed = JSON.parse(modal.private_metadata) as { projectKey: string };
    expect(parsed.projectKey).toBe("PROJ");
  });
});

describe("buildJiraErrorModal", () => {
  it("has correct callback_id and title", () => {
    const modal = buildJiraErrorModal(jiraMeta, "Something failed", "PROJ");
    expect(modal.callback_id).toBe("a11y_jira_error_modal");
    expect(modal.title.text).toBe("Create Jira Ticket");
  });

  it("has close button and no submit", () => {
    const modal = buildJiraErrorModal(jiraMeta, "err", "PROJ") as { close?: { text: string }; submit?: unknown };
    expect(modal.close?.text).toBe("Close");
    expect(modal.submit).toBeUndefined();
  });

  it("includes error message in section text", () => {
    const modal = buildJiraErrorModal(jiraMeta, "Project not found", "PROJ");
    const section = modal.blocks[0] as { text?: { text: string } };
    expect(section.text?.text).toContain("Project not found");
  });

  it("has try again button with correct action_id", () => {
    const modal = buildJiraErrorModal(jiraMeta, "err", "PROJ");
    const actions = modal.blocks[1] as { elements?: Array<{ action_id: string; text: { text: string } }> };
    expect(actions.elements?.[0].action_id).toBe("a11y_jira_back_to_project");
    expect(actions.elements?.[0].text.text).toContain("Try Again");
  });

  it("includes projectKey in private_metadata", () => {
    const modal = buildJiraErrorModal(jiraMeta, "err", "MYPROJ");
    const parsed = JSON.parse(modal.private_metadata) as { projectKey: string };
    expect(parsed.projectKey).toBe("MYPROJ");
  });
});
