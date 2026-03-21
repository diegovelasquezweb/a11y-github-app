import { CONFIG } from "../config.js";
import { getInstallationOctokit } from "../github/auth.js";
import { listPullRequestFiles } from "../github/client.js";
import { analyzePullRequest } from "../review/analyze-pr.js";
import { reportPullRequestReview } from "../review/reporter.js";
import { verifyWebhookSignature } from "./verify-signature.js";

const PULL_REQUEST_ACTIONS = new Set(["opened", "reopened", "synchronize"]);
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

  if (input.event !== "pull_request") {
    return {
      status: 200,
      body: { ok: true, ignored: `unsupported event: ${input.event}` },
    };
  }

  const payload = parseJsonBody(input.rawBody) as {
    action?: string;
    installation?: { id?: number };
    repository?: { name?: string; owner?: { login?: string } };
    pull_request?: { number?: number; head?: { sha?: string } };
  } | null;

  if (!payload) {
    return { status: 400, body: { ok: false, error: "Invalid JSON payload" } };
  }

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

  try {
    const octokit = getInstallationOctokit(installationId);
    const files = await listPullRequestFiles(octokit, owner, repo, pullNumber);
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

    remember(processedHeads, headKey, 5000);

    return {
      status: 200,
      body: {
        ok: true,
        reviewed: true,
        findings: analysis.findings.length,
        comments: analysis.comments.length,
        scannedFiles: analysis.scannedFiles,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { status: 500, body: { ok: false, error: message } };
  }
}
