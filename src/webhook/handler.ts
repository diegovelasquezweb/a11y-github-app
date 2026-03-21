import type { Request, Response } from "express";
import { CONFIG } from "../config.js";
import { getInstallationOctokit } from "../github/auth.js";
import { listPullRequestFiles } from "../github/client.js";
import { analyzePullRequest } from "../review/analyze-pr.js";
import { reportPullRequestReview } from "../review/reporter.js";
import { verifyWebhookSignature } from "./verify-signature.js";

const PULL_REQUEST_ACTIONS = new Set(["opened", "reopened", "synchronize"]);
const processedDeliveries = new Set<string>();
const processedHeads = new Set<string>();

interface WebhookRequest extends Request {
  rawBody?: Buffer;
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

export async function handleWebhook(req: WebhookRequest, res: Response): Promise<void> {
  const signature = req.header("x-hub-signature-256");
  const event = req.header("x-github-event");
  const delivery = req.header("x-github-delivery") ?? "";

  if (!req.rawBody) {
    res.status(400).json({ ok: false, error: "Missing raw request body" });
    return;
  }

  const valid = verifyWebhookSignature(req.rawBody, signature, CONFIG.webhookSecret);
  if (!valid) {
    res.status(401).json({ ok: false, error: "Invalid webhook signature" });
    return;
  }

  if (delivery && processedDeliveries.has(delivery)) {
    res.status(200).json({ ok: true, deduplicated: true });
    return;
  }

  if (delivery) {
    remember(processedDeliveries, delivery);
  }

  if (event !== "pull_request") {
    res.status(200).json({ ok: true, ignored: `unsupported event: ${event}` });
    return;
  }

  const payload = req.body as {
    action?: string;
    installation?: { id?: number };
    repository?: { name?: string; owner?: { login?: string } };
    pull_request?: { number?: number; head?: { sha?: string } };
  };

  if (!payload.action || !PULL_REQUEST_ACTIONS.has(payload.action)) {
    res.status(200).json({ ok: true, ignored: `unsupported action: ${payload.action}` });
    return;
  }

  const installationId = payload.installation?.id;
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const pullNumber = payload.pull_request?.number;
  const headSha = payload.pull_request?.head?.sha;

  if (!installationId || !owner || !repo || !pullNumber || !headSha) {
    res.status(400).json({ ok: false, error: "Missing required pull_request fields" });
    return;
  }

  const headKey = makeHeadKey(owner, repo, pullNumber, headSha);
  if (processedHeads.has(headKey)) {
    res.status(200).json({ ok: true, deduplicated: true, reason: "head already reviewed" });
    return;
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

    res.status(200).json({
      ok: true,
      reviewed: true,
      findings: analysis.findings.length,
      comments: analysis.comments.length,
      scannedFiles: analysis.scannedFiles,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ ok: false, error: message });
  }
}
