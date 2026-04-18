import type { AuditModalMetadata, FixModalMetadata } from "./types.js";

export function buildAuditModal(metadata: AuditModalMetadata) {
  return {
    type: "modal" as const,
    callback_id: "a11y_audit_modal",
    title: { type: "plain_text" as const, text: "A11y Audit" },
    submit: { type: "plain_text" as const, text: "Run Audit" },
    close: { type: "plain_text" as const, text: "Cancel" },
    private_metadata: JSON.stringify(metadata),
    blocks: [
      {
        type: "input",
        block_id: "repo_block",
        label: { type: "plain_text" as const, text: "Repository" },
        element: {
          type: "plain_text_input",
          action_id: "repo",
          placeholder: { type: "plain_text" as const, text: "owner/repo" },
        },
      },
      {
        type: "input",
        block_id: "branch_block",
        optional: true,
        label: { type: "plain_text" as const, text: "Branch" },
        element: {
          type: "plain_text_input",
          action_id: "branch",
          placeholder: { type: "plain_text" as const, text: "Leave empty for default branch" },
        },
      },
      {
        type: "input",
        block_id: "audit_mode_block",
        label: { type: "plain_text" as const, text: "Audit Mode" },
        element: {
          type: "static_select",
          action_id: "audit_mode",
          initial_option: { text: { type: "plain_text" as const, text: "Full Audit" }, value: "unified" },
          options: [
            { text: { type: "plain_text" as const, text: "Full Audit" }, value: "unified" },
            { text: { type: "plain_text" as const, text: "DOM Only" }, value: "dom" },
            { text: { type: "plain_text" as const, text: "Source Only" }, value: "source" },
          ],
        },
      },
    ],
  };
}

export function buildFixModal(metadata: FixModalMetadata, initialFindingIds = "all") {
  return {
    type: "modal" as const,
    callback_id: "a11y_fix_modal",
    title: { type: "plain_text" as const, text: "A11y Fix" },
    submit: { type: "plain_text" as const, text: "Apply Fix" },
    close: { type: "plain_text" as const, text: "Cancel" },
    private_metadata: JSON.stringify(metadata),
    blocks: [
      {
        type: "input",
        block_id: "finding_ids_block",
        label: { type: "plain_text" as const, text: "Finding IDs" },
        element: {
          type: "plain_text_input",
          action_id: "finding_ids",
          initial_value: initialFindingIds,
          placeholder: { type: "plain_text" as const, text: "all, or A11Y-001 PAT-002" },
        },
      },
      {
        type: "input",
        block_id: "ai_model_block",
        optional: true,
        label: { type: "plain_text" as const, text: "AI Model" },
        element: {
          type: "static_select",
          action_id: "ai_model",
          initial_option: { text: { type: "plain_text" as const, text: "Haiku (fastest)" }, value: "claude-haiku-4-5-20251001" },
          options: [
            { text: { type: "plain_text" as const, text: "Haiku (fastest)" }, value: "claude-haiku-4-5-20251001" },
            { text: { type: "plain_text" as const, text: "Sonnet (balanced)" }, value: "claude-sonnet-4-5-20241022" },
            { text: { type: "plain_text" as const, text: "Opus (most capable)" }, value: "claude-opus-4-5-20250415" },
          ],
        },
      },
      {
        type: "input",
        block_id: "hint_block",
        optional: true,
        label: { type: "plain_text" as const, text: "Hint" },
        element: {
          type: "plain_text_input",
          action_id: "hint",
          multiline: true,
          placeholder: { type: "plain_text" as const, text: "e.g. use sr-only labels, prefer Tailwind classes" },
        },
      },
    ],
  };
}
