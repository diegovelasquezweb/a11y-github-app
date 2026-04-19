import type { IncomingMessage, ServerResponse } from "node:http";
import { processProgressUpdate } from "../src/slack/progress.js";

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

export default async function slackProgress(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
    return;
  }

  const result = await processProgressUpdate({
    token: header(req, "x-callback-token"),
    step: String(payload.step ?? ""),
    owner: String(payload.owner ?? ""),
    repo: String(payload.repo ?? ""),
    branch: String(payload.branch ?? ""),
    mode: String(payload.mode ?? ""),
    slack_channel_id: String(payload.slack_channel_id ?? ""),
    slack_message_ts: String(payload.slack_message_ts ?? ""),
    total_steps: Number(payload.total_steps ?? 0),
    current_step: Number(payload.current_step ?? 0),
  });

  res.statusCode = result.status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(result.body));
}
