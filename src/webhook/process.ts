import { CONFIG } from "../config.js";
import { createInstallationToken, getInstallationOctokit, getRepoOctokit } from "../github/auth.js";
import { listPullRequestFiles } from "../github/client.js";
import { analyzePullRequest } from "../review/analyze-pr.js";
import { parseAuditCommand } from "../review/audit-command.js";
import { parseFixCommand } from "../review/fix-command.js";
import { parseIgnoreCommand } from "../review/ignore-command.js";
import { dispatchFixWorkflow } from "../review/fix-workflow.js";
import { applyIgnoredFindings, loadIgnoredFindingIds } from "../review/ignore-state.js";
import {
  createDomAuditPendingCheck,
  createFixPendingCheck,
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

async function runPullRequestReview(params: {
  octokit: ReturnType<typeof getInstallationOctokit>;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
}): Promise<{
  findingsCount: number;
  commentsCount: number;
  scannedFiles: number;
  ignoredFindingCount: number;
}> {
  const files = await listPullRequestFiles(params.octokit, params.owner, params.repo, params.pullNumber);
  const analysis = await analyzePullRequest({
    octokit: params.octokit,
    owner: params.owner,
    repo: params.repo,
    headSha: params.headSha,
    files,
    maxInlineComments: CONFIG.maxInlineComments,
  });

  const ignoredFindingIds = await loadIgnoredFindingIds(
    params.octokit,
    params.owner,
    params.repo,
    params.pullNumber,
  );
  const filteredAnalysis = applyIgnoredFindings(analysis, ignoredFindingIds);

  await reportPullRequestReview({
    octokit: params.octokit,
    owner: params.owner,
    repo: params.repo,
    pullNumber: params.pullNumber,
    headSha: params.headSha,
    analysis: filteredAnalysis,
  });

  return {
    findingsCount: filteredAnalysis.findings.length,
    commentsCount: filteredAnalysis.comments.length,
    scannedFiles: filteredAnalysis.scannedFiles,
    ignoredFindingCount: analysis.findings.length - filteredAnalysis.findings.length,
  };
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
  const sourceEnabled = CONFIG.sourcePatternsEnabled;

  let findingsCount = 0;
  let commentsCount = 0;
  let scannedFiles = 0;
  let ignoredFindingCount = 0;

  if (sourceEnabled) {
    const review = await runPullRequestReview({
      octokit,
      owner,
      repo,
      pullNumber,
      headSha,
    });
    findingsCount = review.findingsCount;
    commentsCount = review.commentsCount;
    scannedFiles = review.scannedFiles;
    ignoredFindingCount = review.ignoredFindingCount;
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
      ignoredFindings: ignoredFindingCount,
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
  const fixCommand = parseFixCommand(payload.comment?.body ?? "");
  const ignoreCommand = parseIgnoreCommand(payload.comment?.body ?? "");

  if (!payload.issue?.pull_request) {
    return { status: 200, body: { ok: true, ignored: "command outside pull request" } };
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

  if (ignoreCommand.requested) {
    if (!ignoreCommand.findingId || !ignoreCommand.action) {
      return {
        status: 200,
        body: { ok: true, ignored: "ignore command missing finding id" },
      };
    }

    const pull = await getInstallationOctokit(installationId).rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    const headSha = pull.data.head.sha;
    const octokit = getInstallationOctokit(installationId);
    const review = await runPullRequestReview({
      octokit,
      owner,
      repo,
      pullNumber,
      headSha,
    });

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: [
        ignoreCommand.action === "ignore"
          ? `Ignored finding \`${ignoreCommand.findingId}\` and recalculated the A11y PR Review check.`
          : `Re-included finding \`${ignoreCommand.findingId}\` and recalculated the A11y PR Review check.`,
        "",
        `Active findings: ${review.findingsCount}`,
        `Ignored findings: ${review.ignoredFindingCount}`,
      ].join("\n"),
    });

    return {
      status: 200,
      body: {
        ok: true,
        reviewUpdated: true,
        action: ignoreCommand.action,
        findingId: ignoreCommand.findingId,
        findings: review.findingsCount,
        ignoredFindings: review.ignoredFindingCount,
      },
    };
  }

  if (fixCommand.requested) {
    if (!fixCommand.findingId) {
      return {
        status: 200,
        body: { ok: true, ignored: "fix command missing finding id" },
      };
    }

    const octokit = getInstallationOctokit(installationId);
    const pull = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    const headSha = pull.data.head.sha;
    const baseRef = pull.data.base.ref;
    const runnerOwner = CONFIG.scanRunnerOwner || owner;
    const runnerRepo = CONFIG.scanRunnerRepo || repo;
    const runnerOctokit = await getRepoOctokit(runnerOwner, runnerRepo);
    const targetToken = await createInstallationToken(installationId);
    const checkRunId = await createFixPendingCheck({
      octokit,
      owner,
      repo,
      headSha,
      findingId: fixCommand.findingId,
    });

    await dispatchFixWorkflow({
      runnerOctokit,
      runnerOwner,
      runnerRepo,
      workflow: CONFIG.scanFixWorkflow,
      ref: CONFIG.scanRunnerRef,
      targetOwner: owner,
      targetRepo: repo,
      pullNumber,
      headSha,
      baseRef,
      findingId: fixCommand.findingId,
      requestedBy: payload.comment?.user?.login ?? "unknown",
      targetToken,
      checkRunId,
    });

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: [
        "## A11y Fix Requested",
        "",
        `Preparing an automated fix for \`${fixCommand.findingId}\` in GitHub Actions.`,
        "",
        `**Requested by:** @${payload.comment?.user?.login ?? "unknown"}`,
        "A follow-up comment will be posted after the fix attempt finishes.",
      ].join("\n"),
    });

    return {
      status: 200,
      body: {
        ok: true,
        fixScheduled: true,
        findingId: fixCommand.findingId,
        pullNumber,
      },
    };
  }

  if (!command.requested) {
    return { status: 200, body: { ok: true, ignored: "no supported command" } };
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
    const targetToken = await createInstallationToken(installationId);

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
      targetToken,
    });

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: [
        "## DOM Audit Started",
        "",
        "Running an accessibility scan against a temporary PR runtime in GitHub Actions.",
        "",
        `**Requested by:** @${payload.comment?.user?.login ?? "unknown"}`,
        "Results will be posted here when the audit finishes.",
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
