import { CONFIG } from "../config.js";
import { findInstallationForRepo, getInstallationOctokit, createInstallationToken } from "../github/auth.js";
import { createDomAuditPendingCheck, createFixPendingCheck } from "../review/dom-reporter.js";
import { createScanToken, dispatchDomAuditWorkflow, dispatchSourceAuditWorkflow } from "../review/dom-workflow.js";
import { dispatchFixWorkflow } from "../review/fix-workflow.js";
import { resolveBranchRef } from "../webhook/process.js";
import { verifySlackSignature } from "./verify.js";
import { buildAuditModal, buildFixModal } from "./modals.js";
import { getSlackClient } from "./client.js";
import { postScanningMessage, postFixProgress } from "./notifier.js";
import type { SlackHandlerResult, SlackInteractionPayload, SlackSlashCommandPayload } from "./types.js";
import type { AuditMode } from "../types.js";

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

export async function processSlackRequest(input: SlackRequestInput): Promise<SlackHandlerResult> {
  if (!CONFIG.slackSigningSecret || !CONFIG.slackBotToken) {
    return { status: 503, body: { ok: false, error: "Slack integration not configured" } };
  }

  if (!verifySlackSignature(input.rawBody, input.timestamp, input.signature, CONFIG.slackSigningSecret)) {
    return { status: 401, body: { ok: false, error: "Invalid signature" } };
  }

  const params = new URLSearchParams(input.rawBody);
  const payloadField = params.get("payload");

  if (payloadField) {
    try {
      const interaction = JSON.parse(payloadField) as SlackInteractionPayload;
      if (interaction.type === "view_submission") {
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
    metadata = JSON.parse(interaction.view?.private_metadata ?? "");
  } catch {
    return { status: 200, body: { response_action: "errors", errors: { ai_model_block: "Session data lost. Please re-run the audit." } } };
  }

  const findingIds = String(metadata.findingIds ?? "all");

  const owner = String(metadata.owner ?? "");
  const repo = String(metadata.repo ?? "");
  const headSha = String(metadata.headSha ?? "");
  const headRef = String(metadata.headRef ?? "");
  const baseRef = String(metadata.baseRef ?? "");
  const installationId = Number(metadata.installationId ?? 0);
  const channelId = String(metadata.channelId ?? "");
  const messageTs = String(metadata.messageTs ?? "");

  if (!owner || !repo || !headSha || !installationId) {
    return { status: 200, body: { response_action: "errors", errors: { finding_ids_block: "Session data lost. Please re-run the audit." } } };
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

async function handleBlockAction(interaction: SlackInteractionPayload): Promise<SlackHandlerResult> {
  const action = interaction.actions?.[0];
  if (!action) return { status: 200, body: "" };

  const client = getSlackClient();
  if (!client) return { status: 200, body: "" };

  if (action.action_id === "a11y_fix_finding" || action.action_id === "a11y_fix_all") {
    const findingLabel = action.action_id === "a11y_fix_all" ? "all" : (action.value ?? "");
    const channelId = interaction.channel?.id ?? "";
    const messageTs = interaction.message?.ts ?? "";

    try {
      await client.views.open({
        trigger_id: interaction.trigger_id,
        view: buildFixModal({
          channelId,
          messageTs,
          userId: interaction.user?.id ?? "",
          owner: "",
          repo: "",
          headSha: "",
          headRef: "",
          baseRef: "",
          pullNumber: 0,
          installationId: 0,
        }, findingLabel) as Parameters<typeof client.views.open>[0]["view"],
      });
    } catch (err) {
      console.warn("[slack] fix modal open failed:", err);
    }
    return { status: 200, body: "" };
  }

  return { status: 200, body: "" };
}
