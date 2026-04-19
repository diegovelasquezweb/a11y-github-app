import crypto from "node:crypto";
import type { KnownBlock } from "@slack/web-api";
import { CONFIG } from "../config.js";
import { getSlackClient } from "./client.js";

export interface ProgressInput {
  token?: string;
  owner: string;
  repo: string;
  branch: string;
  mode: string;
  slack_channel_id: string;
  slack_message_ts: string;
  current_step: number;
  steps: string[];
}

export interface ProgressResult {
  status: number;
  body: Record<string, unknown>;
}

function buildProgressBar(current: number, total: number): string {
  const filled = "▓".repeat(current);
  const empty = "░".repeat(total - current);
  return `\`${filled}${empty}\` Step ${current}/${total}`;
}

function buildStepList(steps: string[], current: number): string {
  return steps.map((name, i) => {
    const num = i + 1;
    if (num < current) return `:white_check_mark:  ~${name}~`;
    if (num === current) return `:arrows_counterclockwise:  *${name}…*`;
    return `:white_square:  ${name}`;
  }).join("\n");
}

function buildProgressBlocks(input: ProgressInput): KnownBlock[] {
  const label = `${input.owner}/${input.repo}`;
  const total = input.steps.length;

  return [
    { type: "header", text: { type: "plain_text", text: `⏳ Auditing ${label}` } },
    { type: "context", elements: [
      { type: "mrkdwn", text: `Branch: \`${input.branch || "default"}\` · Mode: ${input.mode}` },
    ]},
    { type: "section", text: { type: "mrkdwn", text: buildProgressBar(input.current_step, total) } },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: buildStepList(input.steps, input.current_step) } },
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
    const currentName = input.steps[input.current_step - 1] ?? "Processing";
    await client.chat.update({
      channel: input.slack_channel_id,
      ts: input.slack_message_ts,
      blocks,
      text: `⏳ ${currentName}…`,
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
