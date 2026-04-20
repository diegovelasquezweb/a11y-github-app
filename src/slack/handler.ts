import { waitUntil } from "@vercel/functions";
import { CONFIG } from "../config.js";
import { findInstallationForRepo, getInstallationOctokit, createInstallationToken } from "../github/auth.js";
import { createDomAuditPendingCheck, createFixPendingCheck } from "../review/dom-reporter.js";
import { createScanToken, dispatchDomAuditWorkflow, dispatchSourceAuditWorkflow } from "../review/dom-workflow.js";
import { dispatchFixWorkflow } from "../review/fix-workflow.js";
import { resolveBranchRef } from "../webhook/process.js";
import { verifySlackSignature } from "./verify.js";
import {
  buildAuditModal,
  buildFixModal,
  buildJiraProjectKeyModal,
} from "./modals.js";
import { getSlackClient } from "./client.js";
import { postScanningMessage, postFixProgress } from "./notifier.js";
import type { SlackHandlerResult, SlackInteractionPayload, SlackSlashCommandPayload, JiraModalMetadata } from "./types.js";
import type { AuditMode } from "../types.js";
import { buildSingleFindingBody, buildSingleFindingSummary, buildBulkBody, buildBulkSummary } from "../jira/build-body.js";
import { createJiraIssue } from "../jira/create-issue.js";
import type { JiraSlackPayload, JiraSinglePayload, JiraBulkPayload, CreateIssueErrorCode } from "../jira/types.js";

function parseRepoInput(input: string): [string, string] | null {
  const githubUrl = input.match(/github\.com\/([^/]+)\/([^/\s?#]+)/);
  if (githubUrl) {
    return [githubUrl[1], githubUrl[2].replace(/\.git$/, "")];
  }
  const parts = input.split("/");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return [parts[0], parts[1]];
  }
  return null;
}

export interface SlackRequestInput {
  rawBody: string;
  timestamp?: string;
  signature?: string;
}

export type DeferredWork =
  | { type: "block_actions"; interaction: SlackInteractionPayload };

export interface VerifyResult extends SlackHandlerResult {
  work?: DeferredWork;
}

/** Verify signature and determine what to do. Runs inline for view_submissions (need response_action). */
export async function verifyAndRoute(input: SlackRequestInput): Promise<VerifyResult> {
  if (!CONFIG.slackSigningSecret || !CONFIG.slackBotToken) {
    return { status: 503, body: { ok: false, error: "Slack integration not configured" } };
  }

  if (!verifySlackSignature(input.rawBody, input.timestamp, input.signature, CONFIG.slackSigningSecret)) {
    return { status: 401, body: { ok: false, error: "Invalid signature" } };
  }

  // Check if body is JSON (Events API) or form-encoded (slash commands / interactions)
  const trimmed = input.rawBody.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      if (event.type === "url_verification") {
        return { status: 200, body: { challenge: event.challenge } };
      }
      if (event.type === "event_callback") {
        await handleEvent(event);
        return { status: 200, body: "" };
      }
    } catch {
      return { status: 200, body: "" };
    }
  }

  const params = new URLSearchParams(input.rawBody);
  const payloadField = params.get("payload");

  if (payloadField) {
    try {
      const interaction = JSON.parse(payloadField) as SlackInteractionPayload;
      if (interaction.type === "view_submission") {
        // view_submissions must return inline — Slack needs response_action for validation errors
        return handleViewSubmission(interaction);
      }
      if (interaction.type === "block_actions") {
        return handleBlockAction(interaction);
      }
      return { status: 200, body: "" };
    } catch {
      return { status: 200, body: "" };
    }
  }

  if (params.get("command") === "/a11y") {
    return handleSlashCommand(params);
  }

  return { status: 200, body: "" };
}

async function handleEvent(event: Record<string, unknown>): Promise<void> {
  const inner = event.event as Record<string, unknown> | undefined;
  if (!inner) return;

  if (inner.type === "member_joined_channel") {
    const client = getSlackClient();
    if (!client) return;

    // Only post welcome when the bot itself joins (not other users)
    const botUserId = String(inner.user ?? "");
    const channelId = String(inner.channel ?? "");
    if (!channelId) return;

    try {
      // Check if bot is the one who joined by comparing with auth.test
      const auth = await client.auth.test();
      if (botUserId !== auth.user_id) return;

      const result = await client.chat.postMessage({
        channel: channelId,
        text: "A11y Audit is ready. Click the button below to scan a repository.",
        blocks: [
          { type: "header", text: { type: "plain_text", text: "A11y Audit" } },
          {
            type: "section",
            text: { type: "mrkdwn", text: "Scan any GitHub repository for *WCAG 2.2 AA* accessibility issues and auto-fix them with AI.\n\nClick the button or type `/a11y` to get started." },
          },
          { type: "divider" },
          {
            type: "actions",
            elements: [
              { type: "button", text: { type: "plain_text", text: "Run Audit" }, action_id: "a11y_open_audit", style: "primary" },
            ],
          },
        ] as unknown as import("@slack/web-api").KnownBlock[],
      });

      if (result.ts) {
        await client.pins.add({ channel: channelId, timestamp: result.ts });
      }
      console.log("[slack] welcome message posted and pinned", { channelId });
    } catch (err) {
      console.warn("[slack] welcome message failed:", err);
    }
  }
}

export function errorCodeToMessage(code: CreateIssueErrorCode): string {
  switch (code) {
    case "missing_config": return "Jira is not configured. Ask your admin to set JIRA_* environment variables.";
    case "unauthorized": return "Jira credentials are invalid. Check JIRA_EMAIL and JIRA_API_TOKEN.";
    case "forbidden": return "Not authorized to create issues in this Jira project. Check JIRA_PROJECT_KEY permissions.";
    case "bad_request": return "Jira rejected the request. Check the project key and project configuration.";
    case "not_found": return "Jira project or resource not found. Check JIRA_BASE_URL and JIRA_PROJECT_KEY.";
    case "server_error": return "Jira returned a server error. Please try again later.";
    case "network_error": return "Could not reach Jira. Check JIRA_BASE_URL and network connectivity.";
  }
}

/** Async — runs AFTER the HTTP response is sent to Slack. */
export async function executeDeferredWork(work: DeferredWork): Promise<void> {
  try {
    if (work.type === "block_actions") {
      await handleBlockAction(work.interaction);
    }
  } catch (err) {
    console.error("[slack] deferred work failed:", err);
  }
}

async function handleJiraProjectSubmit(interaction: SlackInteractionPayload): Promise<SlackHandlerResult> {
  const values = (interaction.view as any)?.state?.values ?? {};
  const projectKey = (values.project_key_block?.project_key?.value ?? "").trim();
  if (!projectKey) {
    return { status: 200, body: { response_action: "errors", errors: { project_key_block: "Project key is required" } } };
  }
  const metadata = JSON.parse((interaction.view as any)?.private_metadata ?? "{}") as JiraModalMetadata;
  waitUntil(executeJiraCreateV2(metadata, projectKey, "Task"));
  return { status: 200, body: { response_action: "clear" } };
}

async function executeJiraCreateV2(metadata: JiraModalMetadata, projectKey: string, issueType: string): Promise<void> {
  let payload: JiraSlackPayload;
  try {
    payload = JSON.parse(metadata.payload) as JiraSlackPayload;
  } catch {
    console.warn("[slack] jira modal: failed to parse payload");
    return;
  }
  const isSingle = (payload as JiraSinglePayload).k === "s";
  const summary = isSingle ? buildSingleFindingSummary(payload as JiraSinglePayload) : buildBulkSummary(payload as JiraBulkPayload);
  const body = isSingle ? buildSingleFindingBody(payload as JiraSinglePayload) : buildBulkBody(payload as JiraBulkPayload);
  const result = await createJiraIssue({ summary, body, projectKey, issueType });
  const slackClient = getSlackClient();
  if (!slackClient) return;
  const text = result.ok
    ? `🎟️ Jira ticket created: <${result.issueUrl}|${result.issueKey}>`
    : `❌ Failed to create Jira ticket: ${errorCodeToMessage(result.errorCode)}`;
  try {
    await slackClient.chat.postMessage({
      channel: metadata.channelId,
      text,
      ...(metadata.messageTs ? { thread_ts: metadata.messageTs } : {}),
    });
  } catch (err) {
    console.warn("[slack] jira postMessage failed:", err);
  }
}

async function handleSlashCommand(params: URLSearchParams): Promise<SlackHandlerResult> {
  const triggerId = params.get("trigger_id") ?? "";
  const channelId = params.get("channel_id") ?? "";
  const userId = params.get("user_id") ?? "";

  const client = getSlackClient();
  if (!client) return { status: 503, body: { ok: false, error: "Slack client not available" } };

  try {
    await client.views.open({
      trigger_id: triggerId,
      view: buildAuditModal({ channelId, userId }) as Parameters<typeof client.views.open>[0]["view"],
    });
    return { status: 200, body: "", contentType: "text/plain" };
  } catch (err) {
    console.warn("[slack] views.open failed:", err);
    return { status: 200, body: { text: "Could not open audit form. Please try again." } };
  }
}

async function handleViewSubmission(interaction: SlackInteractionPayload): Promise<SlackHandlerResult> {
  const callbackId = interaction.view?.callback_id;

  if (callbackId === "a11y_jira_project_modal") return handleJiraProjectSubmit(interaction);

  if (callbackId === "a11y_audit_modal") {
    return handleAuditSubmit(interaction);
  }
  if (callbackId === "a11y_fix_modal") {
    return handleFixSubmit(interaction);
  }
  return { status: 200, body: { response_action: "clear" } };
}

async function handleAuditSubmit(interaction: SlackInteractionPayload): Promise<SlackHandlerResult> {
  const values = interaction.view?.state?.values ?? {};
  const repoRaw = values.repo_block?.repo?.value?.trim() ?? "";
  const branchRaw = values.branch_block?.branch?.value?.trim() ?? "";
  const modeRaw = values.audit_mode_block?.audit_mode?.selected_option?.value ?? "unified";

  const parsed = parseRepoInput(repoRaw);
  if (!parsed) {
    return { status: 200, body: { response_action: "errors", errors: { repo_block: "Paste a valid GitHub repository URL" } } };
  }
  const [owner, repo] = parsed;

  const installationId = await findInstallationForRepo(owner, repo);
  if (!installationId) {
    return { status: 200, body: { response_action: "errors", errors: { repo_block: "Repository not found or not accessible" } } };
  }

  const octokit = getInstallationOctokit(installationId);
  let ref: string;
  let sha: string;
  try {
    const resolved = await resolveBranchRef(octokit, owner, repo, branchRaw || undefined);
    ref = resolved.ref;
    sha = resolved.sha;
  } catch {
    return { status: 200, body: { response_action: "errors", errors: { branch_block: "Branch not found" } } };
  }

  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(interaction.view?.private_metadata ?? "{}");
  } catch {
    metadata = {};
  }
  const channelId = String(metadata.channelId ?? "");
  const userId = String(metadata.userId ?? "");

  const mode: AuditMode = modeRaw === "dom" ? "dom" : modeRaw === "source" ? "source" : "unified";
  const modeLabel = mode === "dom" ? "DOM Only" : mode === "source" ? "Source Only" : "Full Audit";

  const client = getSlackClient();
  let slackChannelId = "";
  let slackMessageTs = "";
  let slackThreadTs = "";

  if (client && channelId) {
    const ctx = await postScanningMessage(client, channelId, owner, repo, modeLabel, ref);
    if (ctx) {
      slackChannelId = ctx.channelId;
      slackMessageTs = ctx.messageTs;
      slackThreadTs = ctx.threadTs ?? "";
    }
  }

  const scanToken = createScanToken(owner, repo, 0);
  const targetToken = await createInstallationToken(installationId);
  const runnerOctokit = getInstallationOctokit(installationId);

  const runnerOwner = CONFIG.scanRunnerOwner || owner;
  const runnerRepo = CONFIG.scanRunnerRepo || repo;

  const checkRunId = await createDomAuditPendingCheck({ octokit, owner, repo, headSha: sha });

  if (mode === "source") {
    await dispatchSourceAuditWorkflow({
      runnerOctokit,
      runnerOwner,
      runnerRepo,
      workflow: CONFIG.scanSourceWorkflow,
      ref: CONFIG.scanRunnerRef,
      scanToken,
      callbackUrl: `${CONFIG.appBaseUrl}/api/scan-callback`,
      callbackToken: CONFIG.domAuditCallbackToken,
      targetOwner: owner,
      targetRepo: repo,
      pullNumber: 0,
      headSha: sha,
      checkRunId,
      targetToken,
      commentId: 0,
      branch: ref,
      slackChannelId,
      slackMessageTs,
      slackThreadTs,
    });
  } else {
    await dispatchDomAuditWorkflow({
      runnerOctokit,
      runnerOwner,
      runnerRepo,
      workflow: CONFIG.scanRunnerWorkflow,
      ref: CONFIG.scanRunnerRef,
      scanToken,
      callbackUrl: `${CONFIG.appBaseUrl}/api/scan-callback`,
      callbackToken: CONFIG.domAuditCallbackToken,
      targetOwner: owner,
      targetRepo: repo,
      pullNumber: 0,
      headSha: sha,
      checkRunId,
      targetToken,
      commentId: 0,
      sourceScanEnabled: mode === "unified" && CONFIG.sourcePatternsEnabled,
      branch: ref,
      slackChannelId,
      slackMessageTs,
      slackThreadTs,
    });
  }

  return { status: 200, body: { response_action: "clear" } };
}

async function handleFixSubmit(interaction: SlackInteractionPayload): Promise<SlackHandlerResult> {
  const values = interaction.view?.state?.values ?? {};
  const aiModel = values.ai_model_block?.ai_model?.selected_option?.value ?? CONFIG.fixAiModel;

  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(interaction.view?.private_metadata ?? "{}");
  } catch {
    return { status: 200, body: { response_action: "errors", errors: { ai_model_block: "Session data lost. Please re-run the audit." } } };
  }

  const findingIds = String(metadata.findingIds ?? "all");

  const owner = String(metadata.owner ?? "");
  const repo = String(metadata.repo ?? "");
  const headSha = String(metadata.headSha ?? "");
  const headRef = String(metadata.headRef ?? "");
  const baseRef = String(metadata.baseRef ?? "");
  const channelId = String(metadata.channelId ?? "");
  const messageTs = String(metadata.messageTs ?? "");

  if (!owner || !repo || !headSha) {
    return { status: 200, body: { response_action: "errors", errors: { ai_model_block: "Session data lost. Please re-run the audit." } } };
  }

  const installationId = Number(metadata.installationId) || await findInstallationForRepo(owner, repo);
  if (!installationId) {
    return { status: 200, body: { response_action: "errors", errors: { ai_model_block: "Repository not accessible" } } };
  }

  const client = getSlackClient();
  let slackChannelId = "";
  let slackMessageTs = "";
  let slackThreadTs = "";

  if (client && channelId && messageTs) {
    const slackCtx = { channelId, messageTs, threadTs: messageTs };
    const fixCtx = await postFixProgress(client, slackCtx, owner, repo, findingIds);
    if (fixCtx) {
      slackChannelId = fixCtx.channelId;
      slackMessageTs = fixCtx.messageTs;
      slackThreadTs = fixCtx.threadTs ?? "";
    }
  }

  const targetToken = await createInstallationToken(installationId);
  const runnerOctokit = getInstallationOctokit(installationId);
  const runnerOwner = CONFIG.scanRunnerOwner || owner;
  const runnerRepo = CONFIG.scanRunnerRepo || repo;
  const requestedBy = interaction.user?.username ?? "slack-user";

  const octokit = getInstallationOctokit(installationId);
  const checkRunId = await createFixPendingCheck({ octokit, owner, repo, headSha, findingIds });

  await dispatchFixWorkflow({
    runnerOctokit,
    runnerOwner,
    runnerRepo,
    workflow: CONFIG.scanFixWorkflow,
    ref: CONFIG.scanRunnerRef,
    targetOwner: owner,
    targetRepo: repo,
    pullNumber: 0,
    headSha,
    headRef: headRef || "main",
    baseRef: baseRef || "main",
    findingIds,
    requestedBy,
    targetToken,
    checkRunId,
    aiModel,
    callbackUrl: `${CONFIG.appBaseUrl}/api/scan-callback`,
    callbackToken: CONFIG.domAuditCallbackToken,
    slackChannelId,
    slackMessageTs,
    slackThreadTs,
  });

  return { status: 200, body: { response_action: "clear" } };
}

function enrichJiraPayload(value: string, blockId: string): string {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (blockId.startsWith("a11y_f_")) {
      const parts = blockId.split("|");
      const pg = parts[1] ?? "";
      const sel = parts[2] ?? "";
      const wcag = parts[3] ?? "";
      const rf = parts[4] ?? "";
      if (pg) parsed.pg = pg;
      if (sel) parsed.sel = sel;
      if (wcag) parsed.wcag = wcag;
      if (rf) parsed.rf = rf;
    } else if (blockId.startsWith("a11y_p_")) {
      const parts = blockId.split("|");
      const file = parts[1] ?? "";
      const ln = parts[2] ? Number(parts[2]) : undefined;
      if (file) parsed.file = file;
      if (ln) parsed.ln = ln;
    }
    return JSON.stringify(parsed);
  } catch {
    return value;
  }
}

async function handleBlockAction(interaction: SlackInteractionPayload): Promise<SlackHandlerResult> {
  const action = interaction.actions?.[0];
  if (!action) return { status: 200, body: "" };

  const client = getSlackClient();
  if (!client) return { status: 200, body: "" };

  const value = (action as { value?: string; selected_option?: { value?: string } }).selected_option?.value ?? (action as { value?: string }).value ?? "";
  if (value.startsWith('{"k":"s"') || value.startsWith('{"kind":"bulk"')) {
    const blockId = (action as { block_id?: string }).block_id ?? "";
    const enrichedPayload = enrichJiraPayload(value, blockId);
    const meta: JiraModalMetadata = {
      payload: enrichedPayload,
      channelId: interaction.channel?.id ?? "",
      userId: interaction.user?.id ?? "",
      messageTs: interaction.message?.ts,
    };
    try {
      await client.views.open({
        trigger_id: interaction.trigger_id!,
        view: buildJiraProjectKeyModal(meta, CONFIG.jiraProjectKey || undefined) as any,
      });
    } catch (err) {
      console.warn("[slack] jira modal open failed:", err);
    }
    return { status: 200, body: "" };
  }

  if (action.action_id === "a11y_open_audit") {
    const channelId = interaction.channel?.id ?? "";
    const userId = interaction.user?.id ?? "";
    try {
      await client.views.open({
        trigger_id: interaction.trigger_id,
        view: buildAuditModal({ channelId, userId }) as Parameters<typeof client.views.open>[0]["view"],
      });
    } catch (err) {
      console.warn("[slack] audit modal open from button failed:", err);
    }
    return { status: 200, body: "" };
  }

  // Overflow menu selection — "Fix with AI" option
  if (action.action_id.startsWith("a11y_actions_")) {
    const selected = (action as unknown as { selected_option?: { value?: string } }).selected_option;
    if (selected?.value) {
      // Treat as fix action — rewrite action for the fix handler below
      action.value = selected.value;
      action.action_id = "a11y_fix_trigger";
    }
  }

  if (action.action_id.startsWith("a11y_fix_") || action.action_id === "a11y_fix_all" || action.action_id === "a11y_fix_trigger") {
    const channelId = interaction.channel?.id ?? "";
    const messageTs = interaction.message?.ts ?? "";

    let fixCtx: Record<string, unknown> = {};
    let findingLabel = "all";
    try {
      fixCtx = JSON.parse(action.value ?? "{}");
      findingLabel = action.action_id === "a11y_fix_all" ? "all" : String(fixCtx.id ?? "");
    } catch {
      findingLabel = action.value ?? "all";
    }

    // Open modal immediately — no GitHub API calls before this
    try {
      await client.views.open({
        trigger_id: interaction.trigger_id,
        view: buildFixModal({
          channelId,
          messageTs,
          userId: interaction.user?.id ?? "",
          owner: String(fixCtx.o ?? ""),
          repo: String(fixCtx.r ?? ""),
          headSha: String(fixCtx.s ?? ""),
          headRef: String(fixCtx.h ?? ""),
          baseRef: String(fixCtx.b ?? ""),
          pullNumber: 0,
          installationId: 0,
        }, findingLabel) as Parameters<typeof client.views.open>[0]["view"],
      });
    } catch (err) {
      console.error("[slack] fix modal open failed:", err);
    }
    return { status: 200, body: "" };
  }

  return { status: 200, body: "" };
}
