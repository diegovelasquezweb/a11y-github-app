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
const ISSUE_ACTIONS = new Set(["opened"]);
const ALLOWED_AUDIT_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const processedDeliveries = new Set<string>();
const processedHeads = new Set<string>();
const postedWelcomePrs = new Set<string>();
const postedWelcomeIssues = new Set<string>();

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

async function resolveBranchRef(
  octokit: ReturnType<typeof getInstallationOctokit>,
  owner: string,
  repo: string,
  branch?: string,
): Promise<{ ref: string; sha: string }> {
  if (branch) {
    const { data } = await octokit.rest.repos.getBranch({ owner, repo, branch });
    return { ref: branch, sha: data.commit.sha };
  }
  const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
  const defaultBranch = repoData.default_branch;
  const { data } = await octokit.rest.repos.getBranch({ owner, repo, branch: defaultBranch });
  return { ref: defaultBranch, sha: data.commit.sha };
}


async function handlePullRequestEvent(payload: {
  action?: string;
  installation?: { id?: number };
  repository?: { name?: string; owner?: { login?: string } };
  pull_request?: {
    number?: number;
    head?: { sha?: string; ref?: string };
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

  const headBranch = payload.pull_request?.head?.ref ?? "";
  if ((payload.action === "opened" || payload.action === "reopened") && !headBranch.startsWith("a11y-fix/")) {
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
    "Detect accessibility issues in this PR against **[WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/)**. Use the commands below to run a scan.",
    "",
    "| Command | What it does |",
    "|---|---|",
    "| `/a11y-audit` | Full audit: DOM scan + static source pattern analysis |",
    "| `/a11y-audit dom` | DOM scan only, runs the page in a real browser |",
    "| `/a11y-audit source` | Source pattern scan only, fast static analysis |",
    "",
    "> 📟 Runs [axe-core](https://www.deque.com/axe/) + [CDP](https://chromedevtools.github.io/devtools-protocol/) + [pa11y](https://pa11y.org/) against the live DOM, plus static source pattern analysis.",
    "",
    "### Suggested workflow",
    "",
    "- [ ] Run `/a11y-audit` to scan for accessibility findings",
    "- [ ] Review findings, then fix: `/a11y-fix all` (all at once) or `/a11y-fix <ID>` (per issue)",
    "- [ ] Review and merge the newly generated fix PR",
    "- [ ] Run `/a11y-audit` again to confirm everything passes",
  ].join("\n");
}

function buildIssueWelcomeComment(): string {
  return [
    "## Accessibility Audit Available",
    "",
    "Audit any branch of this repository against **[WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/)**. Comment with one of the commands below.",
    "",
    "| Command | What it does |",
    "|---|---|",
    "| `/a11y-audit` | Full audit on the default branch |",
    "| `/a11y-audit branch:stage` | Full audit on a specific branch |",
    "| `/a11y-audit dom branch:stage` | DOM scan only |",
    "| `/a11y-audit source branch:stage` | Source pattern scan only |",
    "| `/a11y-fix all` | Fix all findings from the last audit |",
    "| `/a11y-fix all branch:stage` | Fix all findings on a specific branch |",
    "| `/a11y-fix <ID>` | Fix a specific finding |",
    "| `/a11y-fix sonnet all` | Fix using a specific model (`haiku` · `sonnet` · `opus`) |",
    "",
    "> 📟 Runs [axe-core](https://www.deque.com/axe/) + [CDP](https://chromedevtools.github.io/devtools-protocol/) + [pa11y](https://pa11y.org/) against the live DOM, plus static source pattern analysis.",
    "",
    "### Suggested workflow",
    "",
    "- [ ] Run `/a11y-audit` to scan for accessibility findings",
    "- [ ] Review findings, then fix: `/a11y-fix all` (all at once) or `/a11y-fix <ID>` (per issue)",
    "- [ ] Review and merge the newly generated fix PR",
    "- [ ] Run `/a11y-audit` again to confirm everything passes",
  ].join("\n");
}

async function handleIssueEvent(payload: {
  action?: string;
  installation?: { id?: number };
  repository?: { name?: string; owner?: { login?: string } };
  issue?: { number?: number; pull_request?: Record<string, unknown> };
}): Promise<ProcessWebhookResult> {
  if (!payload.action || !ISSUE_ACTIONS.has(payload.action)) {
    return { status: 200, body: { ok: true, ignored: `unsupported action: ${payload.action}` } };
  }

  // Only handle plain issues, not PRs (which also fire issues events)
  if (payload.issue?.pull_request) {
    return { status: 200, body: { ok: true, ignored: "issue event on pull request" } };
  }

  const installationId = payload.installation?.id;
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const issueNumber = payload.issue?.number;

  if (!installationId || !owner || !repo || !issueNumber) {
    return { status: 400, body: { ok: false, error: "Missing required issue fields" } };
  }

  const welcomeKey = `${owner}/${repo}#${issueNumber}`;
  if (postedWelcomeIssues.has(welcomeKey)) {
    return { status: 200, body: { ok: true, deduplicated: true } };
  }

  try {
    const octokit = getInstallationOctokit(installationId);
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: buildIssueWelcomeComment(),
    });
    remember(postedWelcomeIssues, welcomeKey, 5000);
  } catch {
    // non-critical
  }

  return { status: 200, body: { ok: true, welcomeCommentPosted: true } };
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

  const isPr = !!payload.issue?.pull_request;

  if (!isPr && !command && !fixCommand.requested) {
    return { status: 200, body: { ok: true, ignored: "no supported command" } };
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
    let headSha: string;
    let headRef: string;
    let baseRef: string;

    if (isPr) {
      const pull = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
      headSha = pull.data.head.sha;
      headRef = pull.data.head.ref;
      baseRef = pull.data.base.ref;
    } else {
      const resolved = await resolveBranchRef(octokit, owner, repo, fixCommand.branch);
      headSha = resolved.sha;
      headRef = resolved.ref;
      baseRef = resolved.ref;
    }
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
      aiModel: fixCommand.model ?? CONFIG.fixAiModel,
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

  let headSha: string;
  let auditBranch: string | undefined;
  if (isPr) {
    const pull = await octokit.rest.pulls.get({ owner, repo, pull_number: pullNumber });
    headSha = pull.data.head.sha;
  } else {
    try {
      const resolved = await resolveBranchRef(octokit, owner, repo, command.branch);
      headSha = resolved.sha;
      auditBranch = resolved.ref;
    } catch {
      const branchName = command.branch ?? "default branch";
      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: `**A11y Audit Error:** Branch \`${branchName}\` was not found in this repository.`,
      });
      return { status: 200, body: { ok: true, error: "branch not found" } };
    }
  }

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
        ...(auditBranch ? { branch: auditBranch } : {}),
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
        ...(auditBranch ? { branch: auditBranch } : {}),
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

    if (input.event === "issues") {
      return await handleIssueEvent(payload as Parameters<typeof handleIssueEvent>[0]);
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
