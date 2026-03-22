import { CONFIG } from "../config.js";
import { getInstallationOctokit, getRepoOctokit } from "../github/auth.js";
import { listPullRequestFiles } from "../github/client.js";
import { analyzePullRequest } from "../review/analyze-pr.js";
import { parseAuditCommand } from "../review/audit-command.js";
import {
  createDomAuditPendingCheck,
  failDomAuditCheck,
} from "../review/dom-reporter.js";
import {
  createScanToken,
  dispatchDomAuditWorkflow,
} from "../review/dom-workflow.js";
import { reportPullRequestReview } from "../review/reporter.js";
import { verifyWebhookSignature } from "./verify-signature.js";

const PULL_REQUEST_ACTIONS = new Set(["opened", "reopened", "synchronize"]);
const ISSUE_COMMENT_ACTIONS = new Set(["created"]);
const ALLOWED_AUDIT_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const processedDeliveries = new Set<string>();
const processedHeads = new Set<string>();

export interface ProcessWebhookInput {
  rawBody: Buffer;
  signature?: string;
  event?: string;
  delivery?: string;
}

export interface ProcessWebhookResult {
  status: number;
  body: Record<string, unknown>;
}

function makeHeadKey(owner: string, repo: string, pullNumber: number, sha: string): string {
  return `${owner}/${repo}#${pullNumber}@${sha}`;
}

function remember(set: Set<string>, value: string, max = 1000): void {
  set.add(value);
  if (set.size > max) {
    const oldest = set.values().next().value;
    if (oldest) {
      set.delete(oldest);
    }
  }
}

function parseJsonBody(rawBody: Buffer): Record<string, unknown> | null {
  try {
    return JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getCallbackUrl(): string {
  return CONFIG.appBaseUrl
    ? `${CONFIG.appBaseUrl.replace(/\/$/, "")}/api/scan-callback`
    : "";
}

async function handlePullRequestEvent(payload: {
  action?: string;
  installation?: { id?: number };
  repository?: { name?: string; owner?: { login?: string } };
  pull_request?: {
    number?: number;
    head?: { sha?: string };
  };
}): Promise<ProcessWebhookResult> {
  if (!payload.action || !PULL_REQUEST_ACTIONS.has(payload.action)) {
    return {
      status: 200,
      body: { ok: true, ignored: `unsupported action: ${payload.action}` },
    };
  }

  const installationId = payload.installation?.id;
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const pullNumber = payload.pull_request?.number;
  const headSha = payload.pull_request?.head?.sha;

  if (!installationId || !owner || !repo || !pullNumber || !headSha) {
    return {
      status: 400,
      body: { ok: false, error: "Missing required pull_request fields" },
    };
  }

  const headKey = makeHeadKey(owner, repo, pullNumber, headSha);
  if (processedHeads.has(headKey)) {
    return {
      status: 200,
      body: { ok: true, deduplicated: true, reason: "head already reviewed" },
    };
  }

  const octokit = getInstallationOctokit(installationId);
  const files = await listPullRequestFiles(octokit, owner, repo, pullNumber);
  const sourceEnabled = CONFIG.sourcePatternsEnabled;

  let findingsCount = 0;
  let commentsCount = 0;
  let scannedFiles = 0;

  if (sourceEnabled) {
    const analysis = await analyzePullRequest({
      octokit,
      owner,
      repo,
      headSha,
      files,
      maxInlineComments: CONFIG.maxInlineComments,
    });

    await reportPullRequestReview({
      octokit,
      owner,
      repo,
      pullNumber,
      headSha,
      analysis,
    });

    findingsCount = analysis.findings.length;
    commentsCount = analysis.comments.length;
    scannedFiles = analysis.scannedFiles;
  }

  remember(processedHeads, headKey, 5000);

  return {
    status: 200,
    body: {
      ok: true,
      reviewed: true,
      findings: findingsCount,
      comments: commentsCount,
      scannedFiles,
      sourcePatternsEnabled: sourceEnabled,
      domAuditScheduled: false,
    },
  };
}

async function handleIssueCommentEvent(payload: {
  action?: string;
  installation?: { id?: number };
  repository?: { name?: string; owner?: { login?: string } };
  issue?: { number?: number; pull_request?: Record<string, unknown> };
  comment?: {
    body?: string;
    author_association?: string;
    user?: { login?: string };
  };
}): Promise<ProcessWebhookResult> {
  if (!payload.action || !ISSUE_COMMENT_ACTIONS.has(payload.action)) {
    return {
      status: 200,
      body: { ok: true, ignored: `unsupported action: ${payload.action}` },
    };
  }

  const command = parseAuditCommand(payload.comment?.body ?? "");
  if (!command.requested) {
    return { status: 200, body: { ok: true, ignored: "no audit command" } };
  }

  if (!payload.issue?.pull_request) {
    return { status: 200, body: { ok: true, ignored: "audit command outside pull request" } };
  }

  const association = payload.comment?.author_association ?? "";
  if (!ALLOWED_AUDIT_ASSOCIATIONS.has(association)) {
    return {
      status: 200,
      body: { ok: true, ignored: `author association not allowed: ${association}` },
    };
  }

  const installationId = payload.installation?.id;
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const pullNumber = payload.issue?.number;

  if (!installationId || !owner || !repo || !pullNumber) {
    return {
      status: 400,
      body: { ok: false, error: "Missing required issue_comment fields" },
    };
  }

  if (!CONFIG.domAuditEnabled) {
    return {
      status: 200,
      body: { ok: true, ignored: "DOM audit is disabled by config" },
    };
  }

  const octokit = getInstallationOctokit(installationId);

  const callbackUrl = getCallbackUrl();
  if (!callbackUrl || !CONFIG.domAuditCallbackToken) {
    return {
      status: 503,
      body: { ok: false, error: "DOM audit callback configuration is incomplete" },
    };
  }

  const pull = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
  });
  const headSha = pull.data.head.sha;
  const targetUrl = "local://pr-runtime";

  const domCheckRunId = await createDomAuditPendingCheck({
    octokit,
    owner,
    repo,
    headSha,
    targetUrl,
  });

  try {
    const runnerOwner = CONFIG.scanRunnerOwner || owner;
    const runnerRepo = CONFIG.scanRunnerRepo || repo;
    const runnerOctokit = await getRepoOctokit(runnerOwner, runnerRepo);
    const scanToken = createScanToken(owner, repo, pullNumber);

    await dispatchDomAuditWorkflow({
      runnerOctokit,
      runnerOwner,
      runnerRepo,
      workflow: CONFIG.scanRunnerWorkflow,
      ref: CONFIG.scanRunnerRef,
      scanToken,
      callbackUrl,
      callbackToken: CONFIG.domAuditCallbackToken,
      targetOwner: owner,
      targetRepo: repo,
      pullNumber,
      headSha,
      checkRunId: domCheckRunId,
    });

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: [
        "DOM audit requested. Spinning local runtime in GitHub Actions and running scan.",
        "",
        "Target: local runtime from PR head commit",
        `Requested by: @${payload.comment?.user?.login ?? "unknown"}`,
      ].join("\n"),
    });

    return {
      status: 200,
      body: {
        ok: true,
        domAuditScheduled: true,
        targetUrl,
        pullNumber,
        checkRunId: domCheckRunId,
      },
    };
  } catch (dispatchError) {
    const message =
      dispatchError instanceof Error
        ? dispatchError.message
        : "Failed to dispatch DOM audit workflow";

    await failDomAuditCheck(octokit, owner, repo, domCheckRunId, message);
    return { status: 500, body: { ok: false, error: message } };
  }
}

export async function processWebhook(
  input: ProcessWebhookInput,
): Promise<ProcessWebhookResult> {
  const valid = verifyWebhookSignature(
    input.rawBody,
    input.signature,
    CONFIG.webhookSecret,
  );

  if (!valid) {
    return { status: 401, body: { ok: false, error: "Invalid webhook signature" } };
  }

  const delivery = input.delivery ?? "";
  if (delivery && processedDeliveries.has(delivery)) {
    return { status: 200, body: { ok: true, deduplicated: true } };
  }

  if (delivery) {
    remember(processedDeliveries, delivery);
  }

  const payload = parseJsonBody(input.rawBody);

  if (!payload) {
    return { status: 400, body: { ok: false, error: "Invalid JSON payload" } };
  }

  try {
    if (input.event === "pull_request") {
      return await handlePullRequestEvent(payload as Parameters<typeof handlePullRequestEvent>[0]);
    }

    if (input.event === "issue_comment") {
      return await handleIssueCommentEvent(payload as Parameters<typeof handleIssueCommentEvent>[0]);
    }

    return {
      status: 200,
      body: { ok: true, ignored: `unsupported event: ${input.event}` },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { status: 500, body: { ok: false, error: message } };
  }
}
