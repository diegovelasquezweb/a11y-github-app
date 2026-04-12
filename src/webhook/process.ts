import { CONFIG } from "../config.js";
import { createInstallationToken, getInstallationOctokit, getRepoOctokit } from "../github/auth.js";
import { parseAuditCommand } from "../review/audit-command.js";
import { parseFixCommand } from "../review/fix-command.js";
import { dispatchFixWorkflow } from "../review/fix-workflow.js";
import {
  createDomAuditPendingCheck,
  createFixPendingCheck,
  failDomAuditCheck,
} from "../review/dom-reporter.js";
import {
  createScanToken,
  dispatchDomAuditWorkflow,
  dispatchSourceAuditWorkflow,
} from "../review/dom-workflow.js";
import type { AuditMode } from "../types.js";
import { verifyWebhookSignature } from "./verify-signature.js";

const PULL_REQUEST_ACTIONS = new Set(["opened", "reopened", "synchronize"]);
const ISSUE_COMMENT_ACTIONS = new Set(["created"]);
const ALLOWED_AUDIT_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const processedDeliveries = new Set<string>();
const processedHeads = new Set<string>();
const postedWelcomePrs = new Set<string>();

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

  let welcomeCommentPosted = false;

  if (payload.action === "opened" || payload.action === "reopened") {
    const welcomeKey = `${owner}/${repo}#${pullNumber}`;
    if (!postedWelcomePrs.has(welcomeKey)) {
      try {
        const octokit = getInstallationOctokit(installationId);
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: pullNumber,
          body: buildWelcomeComment(),
        });
        remember(postedWelcomePrs, welcomeKey, 5000);
        welcomeCommentPosted = true;
      } catch {
        // non-critical — do not fail the webhook
      }
    }
  }

  const headKey = makeHeadKey(owner, repo, pullNumber, headSha);
  if (processedHeads.has(headKey)) {
    return {
      status: 200,
      body: { ok: true, deduplicated: true, reason: "head already reviewed" },
    };
  }

  remember(processedHeads, headKey, 5000);

  return {
    status: 200,
    body: {
      ok: true,
      reviewed: true,
      domAuditScheduled: false,
      ...(welcomeCommentPosted && { welcomeCommentPosted: true }),
    },
  };
}

function buildWelcomeComment(): string {
  return [
    "## Accessibility Audit Available",
    "",
    "Detect accessibility issues in this PR for WCAG compliance. Use the commands below to run a scan.",
    "",
    "| Command | What it does |",
    "|---|---|",
    "| `/a11y-audit` | Full audit — DOM scan + static source pattern analysis |",
    "| `/a11y-audit-dom` | DOM scan only — runs the page in a real browser |",
    "| `/a11y-audit-source` | Source pattern scan only — fast static analysis |",
    "",
    "> 💡 The DOM scan typically takes 1–2 minutes depending on the number of routes.",
    "",
    "### Suggested workflow",
    "",
    "- [ ] Run `/a11y-audit` — scan for accessibility findings",
    "- [ ] Review findings, then fix: `/a11y-fix all` (all at once) or `/a11y-fix <ID>` (per issue)",
    "- [ ] Run `/a11y-audit` again — verify all fixes are clean",
  ].join("\n");
}

function buildInitialAuditComment(requestedBy?: string, mode: AuditMode = "unified"): string {
  const lines: string[] = ["## A11y Audit Report"];

  if (requestedBy) {
    lines.push("", `**Requested by:** @${requestedBy}`);
  }

  if (mode === "source") {
    lines.push(
      "",
      "### Source Pattern Analysis",
      "",
      "Static analysis of source code for common accessibility anti-patterns.",
      "",
      "⏳ **Scan in progress...** Results will appear here when the scan finishes.",
    );
  } else if (mode === "dom") {
    lines.push(
      "",
      "### DOM Audit",
      "",
      "Dynamic scan of the rendered page in a real browser against WCAG standards.",
      "",
      "⏳ **Audit in progress...** Results will appear here when the scan finishes.",
    );
  } else {
    lines.push(
      "",
      "DOM scan + static source pattern analysis against WCAG standards.",
      "",
      "⏳ **Audit in progress...** Results will appear here when the scan finishes.",
    );
  }

  return lines.join("\n");
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

  if (fixCommand.requested) {
    if (fixCommand.findingIds.length === 0) {
      return {
        status: 200,
        body: { ok: true, ignored: "fix command missing finding id" },
      };
    }

    const findingIdsStr = fixCommand.findingIds.join(",");

    const octokit = getInstallationOctokit(installationId);
    const pull = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    const headSha = pull.data.head.sha;
    const headRef = pull.data.head.ref;
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
      findingIds: findingIdsStr,
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
      headRef,
      baseRef,
      findingIds: findingIdsStr,
      requestedBy: payload.comment?.user?.login ?? "unknown",
      targetToken,
      checkRunId,
      aiModel: CONFIG.fixAiModel,
      ...(fixCommand.hint ? { projectHints: fixCommand.hint } : {}),
    });

    const confirmationMessage =
      findingIdsStr === "all"
        ? "Preparing an automated fix for **all** findings from the last audit in GitHub Actions."
        : `Preparing an automated fix for \`${findingIdsStr}\` in GitHub Actions.`;

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: [
        "## A11y Fix Requested",
        "",
        confirmationMessage,
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
        findingIds: findingIdsStr,
        pullNumber,
      },
    };
  }

  if (!command) {
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

  const initialBody = buildInitialAuditComment(payload.comment?.user?.login, command.auditMode);
  const { data: createdComment } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body: initialBody,
  });
  const commentId = createdComment.id;

  const domCheckRunId = await createDomAuditPendingCheck({
    octokit,
    owner,
    repo,
    headSha,
  });

  try {
    const runnerOwner = CONFIG.scanRunnerOwner || owner;
    const runnerRepo = CONFIG.scanRunnerRepo || repo;
    const runnerOctokit = await getRepoOctokit(runnerOwner, runnerRepo);
    const scanToken = createScanToken(owner, repo, pullNumber);
    const targetToken = await createInstallationToken(installationId);

    if (command.auditMode === "source") {
      await dispatchSourceAuditWorkflow({
        runnerOctokit,
        runnerOwner,
        runnerRepo,
        workflow: CONFIG.scanSourceWorkflow,
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
        commentId,
      });
    } else {
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
        commentId,
        sourceScanEnabled: command.auditMode === "dom" ? false : CONFIG.sourcePatternsEnabled,
      });
    }

    return {
      status: 200,
      body: {
        ok: true,
        domAuditScheduled: true,
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
