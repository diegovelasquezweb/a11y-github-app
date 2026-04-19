import crypto from "node:crypto";
import type { KnownBlock } from "@slack/web-api";
import { CONFIG } from "../config.js";
import { getSlackClient } from "./client.js";

export interface ProgressInput {
  token?: string;
  step: string;
  owner: string;
  repo: string;
  branch: string;
  mode: string;
  slack_channel_id: string;
  slack_message_ts: string;
  total_steps: number;
  current_step: number;
}

export interface ProgressResult {
  status: number;
  body: Record<string, unknown>;
}

function buildProgressBar(current: number, total: number): string {
  const filled = "▓".repeat(current);
  const empty = "░".repeat(total - current);
  return `${filled}${empty}`;
}

function buildProgressBlocks(input: ProgressInput): KnownBlock[] {
  const bar = buildProgressBar(input.current_step, input.total_steps);
  const label = `${input.owner}/${input.repo}`;

  return [
    { type: "header", text: { type: "plain_text", text: `⏳ Auditing ${label}` } },
    { type: "context", elements: [
      { type: "mrkdwn", text: `Branch: \`${input.branch || "default"}\` · Mode: ${input.mode}` },
    ]},
    { type: "section", text: { type: "mrkdwn", text: `${bar}  ${input.step}` } },
  ] as KnownBlock[];
}

export async function processProgressUpdate(input: ProgressInput): Promise<ProgressResult> {
  if (!CONFIG.domAuditCallbackToken) {
    return { status: 503, body: { ok: false, error: "Callback token not configured" } };
  }

  if (!input.token || !safeEqual(input.token, CONFIG.domAuditCallbackToken)) {
    return { status: 401, body: { ok: false, error: "Invalid token" } };
  }

  if (!input.slack_channel_id || !input.slack_message_ts) {
    return { status: 200, body: { ok: true, skipped: true } };
  }

  const client = getSlackClient();
  if (!client) {
    return { status: 200, body: { ok: true, skipped: true } };
  }

  try {
    const blocks = buildProgressBlocks(input);
    await client.chat.update({
      channel: input.slack_channel_id,
      ts: input.slack_message_ts,
      blocks,
      text: `⏳ ${input.step}`,
    });
    return { status: 200, body: { ok: true } };
  } catch (err) {
    console.warn("[slack] progress update failed:", err);
    return { status: 200, body: { ok: true, warning: "Slack update failed" } };
  }
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}
