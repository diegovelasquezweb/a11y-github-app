import type { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import { CONFIG } from "../src/config.js";
import { getSlackClient } from "../src/slack/client.js";

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
  const blocks = payload.blocks;

  if (!channelId || !messageTs || !Array.isArray(blocks)) {
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

  try {
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      blocks: blocks as unknown as import("@slack/web-api").KnownBlock[],
      text: "Fix complete",
    });
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.warn("[slack] fix result update failed:", err);
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true, warning: "Slack update failed" }));
  }
}
