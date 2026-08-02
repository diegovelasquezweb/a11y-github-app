import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import { CONFIG } from "../src/config.js";
import { getSlackClient } from "../src/slack/client.js";
import {
  formatFixResultBlocks,
  type FixResultSummary,
  type ResultContext,
} from "../src/slack/formatter.js";

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export default async function slackFixResult(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
    return;
  }

  const token = header(req, "x-callback-token");
  if (!CONFIG.domAuditCallbackToken || !token || !safeEqual(token, CONFIG.domAuditCallbackToken)) {
    res.statusCode = 401;
    res.end(JSON.stringify({ ok: false, error: "Invalid token" }));
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
    return;
  }

  const channelId = String(payload.slack_channel_id ?? "");
  const messageTs = String(payload.slack_message_ts ?? "");

  if (!channelId || !messageTs) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, skipped: true }));
    return;
  }

  const client = getSlackClient();
  if (!client) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, skipped: true }));
    return;
  }

  const prUrl = typeof payload.pr_url === "string" && payload.pr_url ? payload.pr_url : undefined;
  const failedStep = typeof payload.failed_step === "string" && payload.failed_step ? payload.failed_step : undefined;
  const reason = typeof payload.reason === "string" && payload.reason ? payload.reason : undefined;
  const results = Array.isArray(payload.results) ? (payload.results as FixResultSummary["results"]) : undefined;

  const summary: FixResultSummary = { prUrl, failedStep, reason, results };
  const context: ResultContext = {
    owner: String(payload.target_owner ?? ""),
    repo: String(payload.target_repo ?? ""),
    branch: typeof payload.branch === "string" ? payload.branch : undefined,
    headSha: typeof payload.head_sha === "string" ? payload.head_sha : undefined,
    headRef: typeof payload.head_ref === "string" ? payload.head_ref : undefined,
    baseRef: typeof payload.base_ref === "string" ? payload.base_ref : undefined,
    pullNumber: Number(payload.pull_number ?? 0) || undefined,
    findingIds: typeof payload.finding_ids === "string" ? payload.finding_ids : undefined,
  };

  const blocks = formatFixResultBlocks(summary, context);

  try {
    const result = await client.chat.update({
      channel: channelId,
      ts: messageTs,
      blocks: blocks as unknown as import("@slack/web-api").KnownBlock[],
      text: prUrl ? "Fix complete" : "Fix failed",
    });
    if (!result.ok) {
      console.error("[slack] fix result update returned not ok:", result.error ?? "unknown_error");
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    const slackError = (err as { data?: { error?: string } })?.data?.error;
    const message = slackError ?? (err instanceof Error ? err.message : String(err));
    console.error("[slack] fix result update failed:", message);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, warning: "Slack update failed", error: message }));
  }
}
