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
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Scan a repository for *WCAG 2.2 AA* accessibility issues. Results will appear in this channel when the scan finishes.",
        },
      },
      { type: "divider" },
      {
        type: "input",
        block_id: "repo_block",
        label: { type: "plain_text" as const, text: "Repository" },
        element: {
          type: "plain_text_input",
          action_id: "repo",
          placeholder: { type: "plain_text" as const, text: "https://github.com/owner/repo" },
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
          initial_option: {
            text: { type: "plain_text" as const, text: "Full Audit" },
            description: { type: "plain_text" as const, text: "DOM scan + source pattern analysis" },
            value: "unified",
          },
          options: [
            {
              text: { type: "plain_text" as const, text: "Full Audit" },
              description: { type: "plain_text" as const, text: "DOM scan + source pattern analysis" },
              value: "unified",
            },
            {
              text: { type: "plain_text" as const, text: "DOM Only" },
              description: { type: "plain_text" as const, text: "Live browser scan — best for deployed sites" },
              value: "dom",
            },
            {
              text: { type: "plain_text" as const, text: "Source Only" },
              description: { type: "plain_text" as const, text: "Static code analysis — fast, no browser needed" },
              value: "source",
            },
          ],
        },
      },
    ],
  };
}

export function buildFixModal(metadata: FixModalMetadata, findingLabel: string) {
  const isAll = findingLabel === "all";
  const description = isAll
    ? "Apply AI-powered fixes to *all findings* from the last audit. A new PR will be created with the patches."
    : `Apply an AI-powered fix for *\`${findingLabel}\`*. A new PR will be created with the patch.`;

  return {
    type: "modal" as const,
    callback_id: "a11y_fix_modal",
    title: { type: "plain_text" as const, text: isAll ? "Fix All Findings" : "Fix Finding" },
    submit: { type: "plain_text" as const, text: "Apply Fix" },
    close: { type: "plain_text" as const, text: "Cancel" },
    private_metadata: JSON.stringify({ ...metadata, findingIds: findingLabel }),
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: description },
      },
      { type: "divider" },
      {
        type: "input",
        block_id: "ai_model_block",
        optional: true,
        label: { type: "plain_text" as const, text: "AI Model" },
        element: {
          type: "static_select",
          action_id: "ai_model",
          initial_option: {
            text: { type: "plain_text" as const, text: "Haiku (fastest)" },
            description: { type: "plain_text" as const, text: "Low cost, good for most fixes" },
            value: "claude-haiku-4-5-20251001",
          },
          options: [
            {
              text: { type: "plain_text" as const, text: "Haiku (fastest)" },
              description: { type: "plain_text" as const, text: "Low cost, good for most fixes" },
              value: "claude-haiku-4-5-20251001",
            },
            {
              text: { type: "plain_text" as const, text: "Sonnet (balanced)" },
              description: { type: "plain_text" as const, text: "Better reasoning, moderate cost" },
              value: "claude-sonnet-4-5-20241022",
            },
            {
              text: { type: "plain_text" as const, text: "Opus (most capable)" },
              description: { type: "plain_text" as const, text: "Best results, highest cost" },
              value: "claude-opus-4-5-20250415",
            },
          ],
        },
      },
      {
        type: "input",
        block_id: "hint_block",
        optional: true,
        label: { type: "plain_text" as const, text: "Hint" },
        hint: { type: "plain_text" as const, text: "Guide the AI on how to apply the fix" },
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
