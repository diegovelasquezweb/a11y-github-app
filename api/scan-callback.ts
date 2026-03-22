import type { IncomingMessage, ServerResponse } from "node:http";
import { processDomAuditCallback } from "../src/webhook/dom-callback.js";

async function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function json(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export default async function scanCallback(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  const payload = await readJson(req);
  if (!payload) {
    json(res, 400, { ok: false, error: "Invalid JSON payload" });
    return;
  }

  const result = await processDomAuditCallback({
    token: header(req, "x-callback-token"),
    payload,
  });

  json(res, result.status, result.body);
}
